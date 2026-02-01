"""Rolling trend risk analysis helpers."""

from __future__ import annotations

from typing import Any, Iterable, Sequence

import pandas as pd

ROLLING_SHORT = 30
ROLLING_LONG = 60
TREND_COLORS = {
    "HIGH": "darkorange",
    "STABLE": "yellow",
    "DECREASING": "green",
}

__all__ = [
    "compute_daily_counts",
    "compute_rolling_average",
    "build_trend_snapshot",
    "build_trend_example_outputs",
]


def _ensure_columns(df: pd.DataFrame, columns: Iterable[str]) -> None:
    missing = [col for col in columns if col not in df.columns]
    if missing:
        raise KeyError(f"DataFrame missing columns: {missing}")


def compute_daily_counts(
    df: pd.DataFrame,
    station_col: str = "station_id",
    ts_col: str = "timestamp",
) -> pd.DataFrame:
    """Return daily crime counts per station, with zero-filled gaps."""
    if df.empty:
        return pd.DataFrame(columns=[station_col, "date", "count"])
    _ensure_columns(df, [station_col, ts_col])
    data = df[[station_col, ts_col]].dropna()
    if data.empty:
        return pd.DataFrame(columns=[station_col, "date", "count"])
    data = data.copy()
    data[station_col] = data[station_col].astype(str)
    data[ts_col] = pd.to_datetime(data[ts_col], errors="coerce")
    data = data.dropna(subset=[ts_col])
    if data.empty:
        return pd.DataFrame(columns=[station_col, "date", "count"])
    data["date"] = data[ts_col].dt.normalize()
    grouped = (
        data.groupby([station_col, "date"])
        .size()
        .rename("count")
        .reset_index()
    )
    if grouped.empty:
        return grouped
    all_stations = grouped[station_col].unique()
    full_dates = pd.date_range(grouped["date"].min(), grouped["date"].max(), freq="D")
    full_index = pd.MultiIndex.from_product(
        [all_stations, full_dates],
        names=[station_col, "date"],
    )
    complete = (
        grouped.set_index([station_col, "date"])
        .reindex(full_index, fill_value=0)
        .reset_index()
    )
    return complete


def compute_rolling_average(
    daily_counts: pd.DataFrame,
    window_days: int,
    station_col: str = "station_id",
) -> pd.Series:
    """Compute per-station rolling means over the provided window."""
    if daily_counts.empty:
        return pd.Series(dtype=float, name=f"rolling{window_days}")
    rolled = (
        daily_counts.set_index("date")
        .groupby(station_col)["count"]
        .rolling(window=window_days, min_periods=window_days)
        .mean()
        .rename(f"rolling{window_days}")
        .reset_index()
    )
    latest = (
        rolled.sort_values("date")
        .groupby(station_col)
        .tail(1)
        .set_index(station_col)[f"rolling{window_days}"]
    )
    return latest.astype(float)


def _classify_delta(delta: float) -> tuple[str, str, str]:
    if delta > 1.15:
        return "HIGH", TREND_COLORS["HIGH"], "Allocate +1 unit tonight (upward short-term trend)."
    if delta < 0.9:
        return "DECREASING", TREND_COLORS["DECREASING"], "Maintain baseline coverage; consider redeploying if this holds."
    return "STABLE", TREND_COLORS["STABLE"], "Monitor; no additional allocation needed tonight."


def _trend_text(delta: float) -> str:
    pct = (delta - 1.0) * 100.0
    direction = "increase" if pct >= 0 else "decrease"
    formatted = f"{pct:+.0f}%"
    return f"Recent Trend: {formatted} {direction} (30-day vs 60-day)"


def build_trend_snapshot(
    df: pd.DataFrame,
    station_col: str = "station_id",
    ts_col: str = "timestamp",
    station_filter: Sequence[str] | set[str] | None = None,
    short_window: int = ROLLING_SHORT,
    long_window: int = ROLLING_LONG,
) -> list[dict[str, Any]]:
    """Return rolling trend payloads for each station (short vs long window)."""
    if short_window <= 0 or long_window <= 0:
        raise ValueError("Window sizes must be positive")
    if short_window >= long_window:
        raise ValueError("short_window must be smaller than long_window")

    daily = compute_daily_counts(df, station_col=station_col, ts_col=ts_col)
    if daily.empty:
        return []

    rolling_short = compute_rolling_average(daily, window_days=short_window, station_col=station_col)
    rolling_long = compute_rolling_average(daily, window_days=long_window, station_col=station_col)
    trend_frame = pd.concat([rolling_short, rolling_long], axis=1).fillna(0.0)
    trend_frame = trend_frame.rename(columns={
        f"rolling{short_window}": "rolling30",
        f"rolling{long_window}": "rolling60",
    })
    candidate_ids = set(trend_frame.index.astype(str))
    if station_filter:
        wanted = {str(sid) for sid in station_filter}
        candidate_ids = candidate_ids.intersection(wanted)
        if not candidate_ids:
            candidate_ids = wanted

    results: list[dict[str, Any]] = []
    for station_id in sorted(candidate_ids):
        if station_id in trend_frame.index:
            row = trend_frame.loc[station_id]
            short_val = float(row.get("rolling30", 0.0))
            long_val = float(row.get("rolling60", 0.0))
        else:
            short_val = 0.0
            long_val = 0.0
        delta = short_val / long_val if long_val > 0 else (short_val if short_val > 0 else 0.0)
        delta = float(round(delta, 2))
        risk, color, recommendation = _classify_delta(delta)
        payload = {
            "station_id": str(station_id),
            "rolling30": round(short_val, 2),
            "rolling60": round(long_val, 2),
            "delta": delta,
            "trendText": _trend_text(delta),
            "expectedRisk": risk,
            "recommendation": recommendation,
            "map_flag": {"color": color},
        }
        results.append(payload)
    return sorted(results, key=lambda item: item["delta"], reverse=True)


def build_trend_example_outputs() -> list[dict[str, Any]]:
    """Provide canned examples for documentation/tests."""
    sample = [
        ("ST-410", 5.2, 4.0),  # HIGH (~1.30)
        ("ST-515", 3.8, 3.6),  # STABLE (~1.06)
        ("ST-622", 2.1, 3.0),  # DECREASING (~0.70)
    ]
    outputs = []
    for station_id, short_val, long_val in sample:
        delta = round(short_val / long_val, 2) if long_val else short_val
        risk, color, recommendation = _classify_delta(delta)
        outputs.append(
            {
                "station_id": station_id,
                "rolling30": short_val,
                "rolling60": long_val,
                "delta": delta,
                "trendText": _trend_text(delta),
                "expectedRisk": risk,
                "recommendation": recommendation,
                "map_flag": {"color": color},
            }
        )
    return outputs
