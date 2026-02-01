"""Spike detection helpers for the TPS two-hour surge rule."""

from __future__ import annotations

from typing import Any, Iterable, Sequence

import pandas as pd

TWO_HOURS = pd.Timedelta(hours=2)
__all__ = [
    "compute_baseline_2hr",
    "compute_recent_2hr",
    "detect_spike",
    "build_station_snapshot",
    "build_example_outputs",
]


def _ensure_columns(df: pd.DataFrame, columns: Iterable[str]) -> None:
    missing = [col for col in columns if col not in df.columns]
    if missing:
        raise KeyError(f"DataFrame missing columns: {missing}")


def _prepare_frame(
    df: pd.DataFrame,
    station_col: str,
    ts_col: str,
) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=[station_col, ts_col])
    _ensure_columns(df, [station_col, ts_col])
    prepared = df[[station_col, ts_col]].dropna()
    if prepared.empty:
        return prepared
    prepared[station_col] = prepared[station_col].astype(str)
    prepared[ts_col] = pd.to_datetime(prepared[ts_col], errors="coerce")
    return prepared.dropna(subset=[ts_col])


def compute_baseline_2hr(
    df: pd.DataFrame,
    station_col: str = "station_id",
    ts_col: str = "timestamp",
) -> pd.Series:
    """Average crimes per rolling two-hour window per station across history."""
    prepared = _prepare_frame(df, station_col, ts_col)
    if prepared.empty:
        return pd.Series(dtype=float, name="baseline_2hr")
    prepared = prepared.set_index(ts_col).sort_index()
    window_counts = (
        prepared.groupby(station_col, group_keys=True)
        .resample("2H", closed="right", label="right")
        .size()
    )
    if window_counts.empty:
        return pd.Series(dtype=float, name="baseline_2hr")
    baseline = window_counts.groupby(level=0).mean().rename("baseline_2hr")
    return baseline.astype(float)


def compute_recent_2hr(
    df: pd.DataFrame,
    as_of: Any,
    station_col: str = "station_id",
    ts_col: str = "timestamp",
) -> pd.Series:
    """Crimes per station inside the trailing two-hour window ending at as_of."""
    if as_of is None:
        raise ValueError("as_of timestamp is required")
    prepared = _prepare_frame(df, station_col, ts_col)
    if prepared.empty:
        return pd.Series(dtype=float, name="recent_2hr")
    as_of_ts = pd.Timestamp(as_of)
    window_start = as_of_ts - TWO_HOURS
    windowed = prepared[(prepared[ts_col] >= window_start) & (prepared[ts_col] < as_of_ts)]
    if windowed.empty:
        return pd.Series(dtype=float, name="recent_2hr")
    return windowed.groupby(station_col).size().astype(float).rename("recent_2hr")


def _ui_flag(spike: bool) -> dict[str, Any]:
    return {"color": "red", "blink": True} if spike else {"color": "blue", "blink": False}


def _describe_flag(flag: dict[str, Any]) -> str:
    if not isinstance(flag, dict):
        return "Unknown"
    color = str(flag.get("color", "unknown")).capitalize()
    blink = bool(flag.get("blink"))
    return f"{color} / {'blinking' if blink else 'steady'}"


def detect_spike(
    station_id: str,
    recent_2hr: float,
    baseline_2hr: float,
    precision: int = 1,
) -> dict[str, Any]:
    """Detect whether the TPS spike rule triggers for one station."""
    baseline_val = max(float(baseline_2hr), 0.0)
    recent_val = max(float(recent_2hr), 0.0)
    if baseline_val == 0.0:
        percentage = 100.0 if recent_val > 0 else 0.0
    else:
        percentage = max(((recent_val / baseline_val) - 1.0) * 100.0, 0.0)
    percentage = round(percentage, precision)
    spike = percentage > 30.0
    flag = _ui_flag(spike)
    return {
        "station_id": str(station_id),
        "baseline_2hr": round(baseline_val, 2),
        "recent_2hr": round(recent_val, 2),
        "percentageAbove": percentage,
        "spike": spike,
        "recommended_units": 2 if spike else 0,
        "ui_flag": flag,
        "ui_state": _describe_flag(flag),
    }


def build_station_snapshot(
    df: pd.DataFrame,
    as_of: Any,
    station_col: str = "station_id",
    ts_col: str = "timestamp",
    station_filter: Sequence[str] | set[str] | None = None,
) -> list[dict[str, Any]]:
    """Return spike payloads for every station (optionally filtered)."""
    baselines = compute_baseline_2hr(df, station_col=station_col, ts_col=ts_col)
    recents = compute_recent_2hr(df, as_of=as_of, station_col=station_col, ts_col=ts_col)
    baseline_idx = set(baselines.index.astype(str)) if not baselines.empty else set()
    recent_idx = set(recents.index.astype(str)) if not recents.empty else set()
    candidate_ids = baseline_idx.union(recent_idx)
    if station_filter:
        wanted = {str(sid) for sid in station_filter}
        candidate_ids = candidate_ids.intersection(wanted)
    # Evaluate all if no baseline and no recent data exist
    if not candidate_ids and station_filter:
        candidate_ids = {str(sid) for sid in station_filter}
    results: list[dict[str, Any]] = []
    for station_id in sorted(candidate_ids):
        baseline_val = float(baselines.get(station_id, 0.0)) if not baselines.empty else 0.0
        recent_val = float(recents.get(station_id, 0.0)) if not recents.empty else 0.0
        results.append(detect_spike(station_id, recent_val, baseline_val))
    return sorted(results, key=lambda item: item["percentageAbove"], reverse=True)


def build_example_outputs() -> list[dict[str, Any]]:
    """Return canned payloads for documentation, demos, or tests."""
    examples = [
        ("ST-101", 5.0, 5.0),        # no spike
        ("ST-204", 4.5, 5.9),        # borderline spike (~31%)
        ("ST-317", 3.0, 4.8),        # strong spike (60%)
    ]
    return [detect_spike(station, recent, baseline) for station, baseline, recent in examples]
