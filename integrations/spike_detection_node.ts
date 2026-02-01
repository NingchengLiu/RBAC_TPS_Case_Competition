export type CrimeEvent = {
  stationId: string;
  timestamp: string | number | Date;
};

export type SpikeResult = {
  station_id: string;
  baseline_2hr: number;
  recent_2hr: number;
  percentageAbove: number;
  spike: boolean;
  recommended_units: number;
  ui_flag: { color: "red" | "blue"; blink: boolean };
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

type BaselineMap = Map<string, Map<number, number>>;

type NumericMap = Map<string, number>;

function toDate(value: CrimeEvent["timestamp"]): Date {
  const ts = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(ts.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return ts;
}

function bucketKey(ts: Date): number {
  return Math.floor(ts.getTime() / TWO_HOURS_MS);
}

export function computeBaseline2hr(events: CrimeEvent[]): NumericMap {
  const perStation: BaselineMap = new Map();
  for (const event of events) {
    const ts = toDate(event.timestamp);
    const station = event.stationId;
    if (!station) continue;
    const stationBuckets = perStation.get(station) ?? new Map<number, number>();
    const key = bucketKey(ts);
    stationBuckets.set(key, (stationBuckets.get(key) ?? 0) + 1);
    perStation.set(station, stationBuckets);
  }

  const baseline: NumericMap = new Map();
  perStation.forEach((buckets, station) => {
    const total = Array.from(buckets.values()).reduce((sum, count) => sum + count, 0);
    baseline.set(station, total / buckets.size);
  });
  return baseline;
}

export function computeRecent2hr(
  events: CrimeEvent[],
  asOf: string | number | Date,
): NumericMap {
  const asOfDate = toDate(asOf);
  const windowStart = new Date(asOfDate.getTime() - TWO_HOURS_MS);
  const counts: NumericMap = new Map();
  for (const event of events) {
    const ts = toDate(event.timestamp);
    if (ts < windowStart || ts >= asOfDate) continue;
    const station = event.stationId;
    if (!station) continue;
    counts.set(station, (counts.get(station) ?? 0) + 1);
  }
  return counts;
}

function buildUiFlag(spike: boolean): SpikeResult["ui_flag"] {
  return spike ? { color: "red", blink: true } : { color: "blue", blink: false };
}

export function detectSpike(
  stationId: string,
  recent2hr: number,
  baseline2hr: number,
): SpikeResult {
  const safeBaseline = Math.max(baseline2hr, 0);
  const safeRecent = Math.max(recent2hr, 0);
  const percentage = safeBaseline === 0
    ? (safeRecent > 0 ? 100 : 0)
    : Math.max(((safeRecent / safeBaseline) - 1) * 100, 0);
  const roundedPct = Number(percentage.toFixed(1));
  const spike = roundedPct > 30;
  return {
    station_id: stationId,
    baseline_2hr: Number(safeBaseline.toFixed(2)),
    recent_2hr: Number(safeRecent.toFixed(2)),
    percentageAbove: roundedPct,
    spike,
    recommended_units: spike ? 2 : 0,
    ui_flag: buildUiFlag(spike),
  };
}

export function buildStationSnapshot(
  events: CrimeEvent[],
  asOf: string | number | Date,
  stationFilter?: Iterable<string>,
): SpikeResult[] {
  const baselines = computeBaseline2hr(events);
  const recents = computeRecent2hr(events, asOf);
  const baselineStations = new Set(baselines.keys());
  const recentStations = new Set(recents.keys());
  const stationIds = new Set([...baselineStations, ...recentStations]);
  if (stationFilter) {
    const filterSet = new Set(Array.from(stationFilter).map(String));
    if (filterSet.size > 0) {
      for (const station of Array.from(stationIds)) {
        if (!filterSet.has(String(station))) stationIds.delete(station);
      }
      if (stationIds.size === 0) {
        filterSet.forEach((station) => stationIds.add(station));
      }
    }
  }

  const payloads: SpikeResult[] = [];
  stationIds.forEach((stationId) => {
    const baseline = baselines.get(stationId) ?? 0;
    const recent = recents.get(stationId) ?? 0;
    payloads.push(detectSpike(stationId, recent, baseline));
  });
  return payloads.sort((a, b) => b.percentageAbove - a.percentageAbove);
}

export function exampleSpikeOutputs(): SpikeResult[] {
  return [
    detectSpike("ST-101", 5, 5),
    detectSpike("ST-204", 5.9, 4.5),
    detectSpike("ST-317", 4.8, 3),
  ];
}
