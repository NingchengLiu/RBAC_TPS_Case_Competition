import { CircleMarker, divIcon, Marker } from "leaflet";

export type RollingTrendPayload = {
  station_id: string;
  rolling30: number;
  rolling60: number;
  delta: number;
  trendText: string;
  expectedRisk: "HIGH" | "STABLE" | "DECREASING";
  recommendation: string;
  map_flag: { color: string };
};

const COLOR_MAP: Record<string, string> = {
  darkorange: "#e65100",
  yellow: "#fdd835",
  green: "#43a047",
};

export function leafletTrendBadge(marker: Marker, payload: RollingTrendPayload): void {
  const color = COLOR_MAP[payload.map_flag.color] ?? payload.map_flag.color;
  marker.setIcon(
    divIcon({
      className: "trend-badge",
      html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #ffffff"></div>`
    }),
  );
}

export function addTrendHalo(
  marker: CircleMarker,
  payload: RollingTrendPayload,
): CircleMarker {
  const color = COLOR_MAP[payload.map_flag.color] ?? payload.map_flag.color;
  marker.setStyle({
    color,
    fillColor: color,
    fillOpacity: 0.5,
  });
  return marker;
}

export function mapboxTrendLayer(payload: RollingTrendPayload) {
  const color = COLOR_MAP[payload.map_flag.color] ?? payload.map_flag.color;
  return {
    "circle-color": color,
    "circle-radius": ["interpolate", ["linear"], ["get", "delta"], 0.8, 6, 1.5, 10],
    "circle-blur": payload.expectedRisk === "HIGH" ? 0.2 : 0,
  };
}
