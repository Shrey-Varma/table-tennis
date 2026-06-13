/* Router tests: exercise the Hono app against an in-memory mock of the data
 * layer, so routing, validation, the passcode gate, and the { detail } error
 * contract are verified without a live database. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  store: { players: [] as Record<string, unknown>[], games: [] as Record<string, unknown>[] },
}));

vi.mock("../api/_db", () => ({
  ensureSchema: vi.fn(async () => {}),
  load: vi.fn(async () => ({ players: h.store.players, games: h.store.games })),
  countPlayers: vi.fn(async () => h.store.players.length),
  countGames: vi.fn(async () => h.store.games.length),
  gamesForPlayer: vi.fn(async (id: string) =>
    h.store.games.filter((g) => g.aId === id || g.bId === id).length),
  playersPresent: vi.fn(async (a: string, b: string) =>
    h.store.players.filter((p) => p.id === a || p.id === b).length),
  insertPlayer: vi.fn(async (p: Record<string, unknown>) => {
    if (h.store.players.some((x) => String(x.name).toLowerCase() === String(p.name).toLowerCase())) {
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    }
    h.store.players.push(p);
  }),
  deletePlayer: vi.fn(async (id: string) => {
    h.store.players = h.store.players.filter((p) => p.id !== id);
  }),
  insertGame: vi.fn(async (g: Record<string, unknown>) => {
    h.store.games.push(g);
  }),
  deleteGame: vi.fn(async (id: string) => {
    h.store.games = h.store.games.filter((g) => g.id !== id);
  }),
  replaceLeague: vi.fn(async (players: unknown[], games: unknown[]) => {
    h.store.players = [...(players as Record<string, unknown>[])];
    h.store.games = [...(games as Record<string, unknown>[])];
  }),
  isUniqueViolation: (e: unknown) => (e as { code?: string })?.code === "23505",
}));

const { app } = await import("../api/[[...route]]");

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });

beforeEach(() => {
  h.store.players = [];
  h.store.games = [];
});

describe("API routing & validation", () => {
  it("GET /api/health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("adds a player and returns recomputed state", async () => {
    const res = await post("/api/players", { name: "  Ada  " });
    expect(res.status).toBe(200);
    const state = await res.json();
    expect(state.players).toHaveLength(1);
    expect(state.players[0].name).toBe("Ada"); // trimmed
    expect(state.rankedIds).toHaveLength(1);
  });

  it("rejects an empty player name with a { detail } 422", async () => {
    const res = await post("/api/players", { name: "   " });
    expect(res.status).toBe(422);
    expect((await res.json()).detail).toMatch(/1–40 characters/);
  });

  it("rejects a duplicate player name with 409", async () => {
    await post("/api/players", { name: "Bo" });
    const res = await post("/api/players", { name: "bo" }); // case-insensitive dup
    expect(res.status).toBe(409);
    expect((await res.json()).detail).toMatch(/already on the board/);
  });

  it("rejects an impossible score with 422", async () => {
    await post("/api/players", { name: "A" });
    await post("/api/players", { name: "B" });
    const [a, b] = h.store.players.map((p) => p.id);
    const tie = await post("/api/games", { aId: a, bId: b, aScore: 11, bScore: 11, target: 11 });
    expect(tie.status).toBe(422);
    const notWinBy2 = await post("/api/games", { aId: a, bId: b, aScore: 12, bScore: 11, target: 11 });
    expect(notWinBy2.status).toBe(422);
    expect((await notWinBy2.json()).detail).toMatch(/2-point lead/);
  });

  it("rejects a game with an unknown player (404)", async () => {
    await post("/api/players", { name: "A" });
    const [a] = h.store.players.map((p) => p.id);
    const res = await post("/api/games", { aId: a, bId: "ghost", aScore: 11, bScore: 5, target: 11 });
    expect(res.status).toBe(404);
  });

  it("logs a valid game and recomputes", async () => {
    await post("/api/players", { name: "A" });
    await post("/api/players", { name: "B" });
    const [a, b] = h.store.players.map((p) => p.id);
    const res = await post("/api/games", { aId: a, bId: b, aScore: 11, bScore: 5, target: 11 });
    expect(res.status).toBe(200);
    const state = await res.json();
    expect(state.processedGames).toHaveLength(1);
    expect(state.processedGames[0].winnerId).toBe(a);
  });

  it("won't delete a player who has games on record (409)", async () => {
    await post("/api/players", { name: "A" });
    await post("/api/players", { name: "B" });
    const [a, b] = h.store.players.map((p) => p.id);
    await post("/api/games", { aId: a, bId: b, aScore: 11, bScore: 5, target: 11 });
    const blocked = await app.request(`/api/players/${a}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);
  });

  it("seeds a demo season only when empty", async () => {
    const first = await post("/api/seed", {});
    expect(first.status).toBe(200);
    expect((await first.json()).league.totalGames).toBe(42);
    const second = await post("/api/seed", {});
    expect(second.status).toBe(409);
  });

  it("export round-trips through import", async () => {
    await post("/api/seed", {});
    const exported = await (await app.request("/api/export")).json();
    const res = await post("/api/import", exported);
    expect(res.status).toBe(200);
    expect((await res.json()).league.totalGames).toBe(42);
  });
});

describe("passcode gate", () => {
  it("blocks mutations without the key and allows them with it", async () => {
    vi.resetModules();
    process.env.LEAGUE_PASSCODE = "open-sesame";
    const { app: guarded } = await import("../api/[[...route]]");
    const blocked = await guarded.request("/api/players", {
      method: "POST",
      body: JSON.stringify({ name: "X" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(blocked.status).toBe(401);
    const allowed = await guarded.request("/api/players", {
      method: "POST",
      body: JSON.stringify({ name: "X" }),
      headers: { "Content-Type": "application/json", "X-League-Key": "open-sesame" },
    });
    expect(allowed.status).toBe(200);
    delete process.env.LEAGUE_PASSCODE;
  });
});
