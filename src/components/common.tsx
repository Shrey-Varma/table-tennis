import type { Player } from "../types";

export const PLAYER_COLORS = [
  "#FFA31A", "#5BC8F5", "#4CC38A", "#F76C8A", "#C792EA",
  "#FFD166", "#7DD3C0", "#FF8E5B", "#9DB8FF", "#E8C547",
];

export function nextColor(existing: Player[]): string {
  return PLAYER_COLORS[existing.length % PLAYER_COLORS.length];
}

export function Avatar({ player, size = 34 }: { player: Player; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: player.color, width: size, height: size, fontSize: size * 0.44 }}
      aria-hidden
    >
      {player.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function FormDots({ form }: { form: ("W" | "L")[] }) {
  if (form.length === 0) return <span style={{ color: "var(--faint)" }}>—</span>;
  return (
    <span className="form-dots" title={form.join(" ")}>
      {form.map((r, i) => (
        <span key={i} className={r === "W" ? "w" : "l"} />
      ))}
    </span>
  );
}

export function ProbBar({ p }: { p: number }) {
  return (
    <div className="prob-bar" title={`${Math.round(p * 100)}%`}>
      <div style={{ width: `${Math.round(p * 100)}%` }} />
    </div>
  );
}

/** Tiny inline SVG sparkline of a player's conservative rating over time. */
export function Sparkline({
  values,
  width = 110,
  height = 30,
  stroke = "rgba(239,245,252,0.9)",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (values.length < 2)
    return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",").map(Number);
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill="var(--ball)" />
    </svg>
  );
}

export const fmt1 = (n: number) => n.toFixed(1);
export const fmt0 = (n: number) => Math.round(n).toString();
export const pct = (n: number) => `${Math.round(n * 100)}%`;

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
