import { divIcon, Marker } from "leaflet";

export type SpikePayload = {
  station_id: string;
  baseline_2hr: number;
  recent_2hr: number;
  percentageAbove: number;
  spike: boolean;
  recommended_units: number;
  ui_flag: { color: string; blink: boolean };
};

const COLOR_MAP: Record<string, string> = {
  red: "#e53935",
  blue: "#1e88e5",
};

function ensureSpikeStyles(): void {
  if (document.getElementById("spike-style")) return;
  const style = document.createElement("style");
  style.id = "spike-style";
  style.textContent = `
    .spike-marker {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 0 10px rgba(0,0,0,0.35);
    }
    .spike-marker.blink {
      animation: spikeBlink 1s linear infinite;
    }
    @keyframes spikeBlink {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.25); opacity: 0.5; }
      100% { transform: scale(1); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

export function applyLeafletSpikeState(marker: Marker, payload: SpikePayload): void {
  ensureSpikeStyles();
  const { color, blink } = payload.ui_flag;
  const fill = COLOR_MAP[color] ?? color ?? "#1e88e5";
  marker.setIcon(
    divIcon({
      className: "spike-marker-wrapper",
      html: `<div class="spike-marker ${blink ? "blink" : ""}" style="background:${fill}"></div>`,
    }),
  );
}

export function mapboxCirclePaint(payload: SpikePayload): Record<string, unknown> {
  const { color, blink } = payload.ui_flag;
  const fill = COLOR_MAP[color] ?? color ?? "#1e88e5";
  return {
    "circle-color": fill,
    "circle-opacity": blink ? 0.95 : 0.7,
    "circle-radius": blink ? 12 : 8,
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2,
  };
}

export function markerPopupHtml(payload: SpikePayload): string {
  return `
    <div style="font-size:12px; line-height:1.4">
      <strong>Station ${payload.station_id}</strong><br/>
      Baseline 2hr: ${payload.baseline_2hr}<br/>
      Recent 2hr: ${payload.recent_2hr}<br/>
      Above baseline: ${payload.percentageAbove}%<br/>
      Recommended units: ${payload.recommended_units}
    </div>
  `;
}
