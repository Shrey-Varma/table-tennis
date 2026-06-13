import type { ApiState } from "./engine";

const BASE = import.meta.env.VITE_API_URL ?? "";
const KEY_STORAGE = "pong-rank:league-key";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call(path: string, init?: RequestInit, retried = false): Promise<ApiState> {
  const key = localStorage.getItem(KEY_STORAGE);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-League-Key": key } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 && !retried) {
    const entered = prompt("This league is passcode-protected. Enter the league passcode:");
    if (entered) {
      localStorage.setItem(KEY_STORAGE, entered);
      return call(path, init, true);
    }
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* keep default */ }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export const fetchState = () => call("/api/state");
export const addPlayer = (name: string) => call("/api/players", { method: "POST", body: JSON.stringify({ name }) });
export const deletePlayer = (id: string) => call(`/api/players/${id}`, { method: "DELETE" });
export const addGame = (g: { aId: string; bId: string; aScore: number; bScore: number; target: 11 | 21 }) =>
  call("/api/games", { method: "POST", body: JSON.stringify(g) });
export const deleteGame = (id: string) => call(`/api/games/${id}`, { method: "DELETE" });
export const seedDemo = () => call("/api/seed", { method: "POST" });
export const importLeague = (raw: { players: unknown[]; games: unknown[] }) =>
  call("/api/import", { method: "POST", body: JSON.stringify(raw) });

export async function exportLeague(): Promise<void> {
  const res = await fetch(`${BASE}/api/export`);
  const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pong-rank-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
