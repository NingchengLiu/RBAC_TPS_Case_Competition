export type CrimeEvent = {
  stationId: string;
  timestamp: string | number | Date;
};

export type RollingTrendResult = {
  station_id: string;
  rolling30: number;
  rolling60: number;
  delta: number;
  trendText: string;
  expectedRisk: "HIGH" | "STABLE" | "DECREASING";
  recommendation: string;
  map_flag: { color: "darkorange" | "yellow" | "green" };
};

const DAY_MS = 24 * 60 * 60 * 1000;

const CLASSIFICATION = {
  HIGH: {
    color: "darkorange",
    recommendation: "Allocate +1 unit tonight (upward short-term trend).",
  },
  STABLE: {
    color: "yellow",
    recommendation: "Monitor; no additional allocation needed tonight.",
  },
  DECREASING: {
    color: "green",
    recommendation: "Maintain baseline coverage; consider redeploying if this holds.",
  },
} as const;

type DailyCounts = Map<string, Map<number, number>>;

type NumericMap = Map<string, number>;

function toDate(value: CrimeEvent["timestamp"]): Date {
  const ts = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(ts.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return ts;
}

function dayKey(ts: Date): number {
  return Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate());
}

export function computeDailyCounts(events: CrimeEvent[]): DailyCounts {
  const counts: DailyCounts = new Map();
  for (const event of events) {
    if (!event.stationId) continue;
    const station = event.stationId;
    const day = dayKey(toDate(event.timestamp));
    const stationMap = counts.get(station) ?? new Map<number, number>();
    stationMap.set(day, (stationMap.get(day) ?? 0) + 1);
    counts.set(station, stationMap);
  }
  return counts;
}

function computeRollingAverage(
  dailyCounts: DailyCounts,
  windowDays: number,
): NumericMap {
  const result: NumericMap = new Map();
  dailyCounts.forEach((dayMap, stationId) => {
    if (!dayMap.size) {
      result.set(stationId, 0);
      return;
    }
    const sortedDays = Array.from(dayMap.keys()).sort((a, b) => a - b);
    let pointer = 0;
    const minDay = sortedDays[0];
    const maxDay = sortedDays[sortedDays.length - 1];
    const window: number[] = [];
    let runningSum = 0;
    let latestValue = 0;
    for (let day = minDay; day <= maxDay; day += DAY_MS) {
      const count = dayMap.get(day) ?? 0;
      window.push(count);
      runningSum += count;
      if (window.length > windowDays) {
        runningSum -= window.shift() ?? 0;
      }
      if (window.length === windowDays) {
        latestValue = runningSum / windowDays;
      }
      pointer += 1;
    }
    result.set(stationId, Number(latestValue.toFixed(2)));
  });
  return result;
}

function trendText(delta: number): string {
  const pct = (delta - 1) * 100;
  const formatted = `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  const direction = pct >= 0 ? "increase" : "decrease";
  return `Recent Trend: ${formatted} ${direction} (30-day vs 60-day)`;
}

function classifyDelta(delta: number) {
  if (delta > 1.15) return { risk: "HIGH" as const, ...CLASSIFICATION.HIGH };
  if (delta < 0.9) return { risk: "DECREASING" as const, ...CLASSIFICATION.DECREASING };
  return { risk: "STABLE" as const, ...CLASSIFICATION.STABLE };
}

function buildPayload(
  stationId: string,
  shortAvg: number,
  longAvg: number,
): RollingTrendResult {
  const safeShort = Math.max(shortAvg, 0);
  const safeLong = Math.max(longAvg, 0);
  const delta = safeLong > 0 ? safeShort / safeLong : safeShort > 0 ? safeShort : 0;
  const roundedDelta = Number(delta.toFixed(2));
  const { risk, color, recommendation } = classifyDelta(roundedDelta);
  return {
    station_id: stationId,
    rolling30: Number(safeShort.toFixed(2)),
    rolling60: Number(safeLong.toFixed(2)),
    delta: roundedDelta,
    trendText: trendText(roundedDelta),
    expectedRisk: risk,
    recommendation,
    map_flag: { color },
  };
}

export function buildRollingTrendSnapshot(
  events: CrimeEvent[],
  stationFilter?: Iterable<string>,
): RollingTrendResult[] {
  const daily = computeDailyCounts(events);
  const rolling30 = computeRollingAverage(daily, 30);
  const rolling60 = computeRollingAverage(daily, 60);
  const stationIds = new Set([
    ...rolling30.keys(),
    ...rolling60.keys(),
  ]);
  if (stationFilter) {
    const filterSet = new Set(Array.from(stationFilter).map(String));
    if (filterSet.size) {
      for (const station of Array.from(stationIds)) {
        if (!filterSet.has(String(station))) stationIds.delete(station);
      }
      if (!stationIds.size) filterSet.forEach((id) => stationIds.add(id));
    }
  }
  const payloads: RollingTrendResult[] = [];
  stationIds.forEach((stationId) => {
    const shortAvg = rolling30.get(stationId) ?? 0;
    const longAvg = rolling60.get(stationId) ?? 0;
    payloads.push(buildPayload(stationId, shortAvg, longAvg));
  });
  return payloads.sort((a, b) => b.delta - a.delta);
}

export function exampleRollingTrendOutputs(): RollingTrendResult[] {
  return [
    buildPayload("ST-410", 5.2, 4.0),
    buildPayload("ST-515", 3.8, 3.6),
    buildPayload("ST-622", 2.1, 3.0),
  ];
}
