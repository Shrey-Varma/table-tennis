/* Pong Rank API — a single Vercel serverless function (Node runtime) that routes
 * all endpoints with Hono. vercel.json rewrites every /api/* request to this
 * function, and Hono's basePath("/api") dispatches internally. Mirrors the old
 * FastAPI surface in backend/main.py: every mutation returns the full recomputed
 * state, and errors are returned as { detail } JSON so the frontend is unchanged. */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { handle } from "hono/vercel";
import type { Game, Player } from "../src/types";
import { compute } from "./_engine.js";
import {
  countGames,
  countPlayers,
  deleteGame,
  deletePlayer,
  gamesForPlayer,
  insertGame,
  insertPlayer,
  isUniqueViolation,
  load,
  playersPresent,
  replaceLeague,
} from "./_db.js";
import { PLAYER_COLORS, checkKey, uid, validateGame } from "./_validate.js";

export const app = new Hono().basePath("/api");
app.use("*", cors());

/** Mutations require the league passcode (if one is configured). */
const requireKey: MiddlewareHandler = async (c, next) => {
  checkKey(c.req.header("X-League-Key"));
  await next();
};

async function getState() {
  const { players, games } = await load();
  return compute(players, games);
}

app.get("/health", (c) => c.json({ ok: true }));
app.get("/state", async (c) => c.json(await getState()));
app.get("/export", async (c) => c.json(await load()));

app.post("/players", requireKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  if (name.length < 1 || name.length > 40) {
    throw new HTTPException(422, { message: "A player name must be 1–40 characters." });
  }
  const color = PLAYER_COLORS[(await countPlayers()) % PLAYER_COLORS.length];
  try {
    await insertPlayer({ id: uid(), name, color, createdAt: Date.now() });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new HTTPException(409, { message: "That name is already on the board." });
    }
    throw e;
  }
  return c.json(await getState());
});

app.delete("/players/:id", requireKey, async (c) => {
  const id = c.req.param("id");
  if ((await gamesForPlayer(id)) > 0) {
    throw new HTTPException(409, { message: "That player has games on record. Delete their games first." });
  }
  await deletePlayer(id);
  return c.json(await getState());
});

app.post("/games", requireKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const g = {
    aId: String(body?.aId ?? ""),
    bId: String(body?.bId ?? ""),
    aScore: Number(body?.aScore),
    bScore: Number(body?.bScore),
    target: Number(body?.target),
  };
  validateGame(g);
  if ((await playersPresent(g.aId, g.bId)) < 2) {
    throw new HTTPException(404, { message: "Unknown player." });
  }
  await insertGame({ id: uid(), playedAt: Date.now(), ...g, target: g.target as 11 | 21 });
  return c.json(await getState());
});

app.delete("/games/:id", requireKey, async (c) => {
  await deleteGame(c.req.param("id"));
  return c.json(await getState());
});

app.post("/import", requireKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body?.players) || !Array.isArray(body?.games)) {
    throw new HTTPException(422, { message: "Import needs a { players, games } payload." });
  }
  const players: Player[] = body.players.map((p: Record<string, unknown>) => ({
    id: String(p.id),
    name: String(p.name),
    color: String(p.color ?? PLAYER_COLORS[0]),
    createdAt: Number(p.createdAt ?? 0),
  }));
  const games: Game[] = body.games.map((g: Record<string, unknown>) => ({
    id: String(g.id),
    playedAt: Number(g.playedAt),
    aId: String(g.aId),
    bId: String(g.bId),
    aScore: Number(g.aScore),
    bScore: Number(g.bScore),
    target: Number(g.target) as 11 | 21,
  }));
  await replaceLeague(players, games);
  return c.json(await getState());
});

app.post("/seed", requireKey, async (c) => {
  if ((await countGames()) > 0) {
    throw new HTTPException(409, { message: "League already has games — demo seed only works on an empty league." });
  }
  await replaceLeague(...demoSeason());
  return c.json(await getState());
});

/** Build a synthetic 42-game demo season (mirrors the old backend seed). */
function demoSeason(): [Player[], Game[]] {
  const names = ["Shrey", "Saihej", "Arjun", "Maya"];
  const skill = [0.9, 0.65, 0.45, 0.3];
  const DAY = 86_400_000;
  const now = Date.now();
  const players: Player[] = names.map((name, i) => ({
    id: uid(),
    name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    createdAt: now - 30 * DAY,
  }));
  const games: Game[] = [];
  let t = now - 28 * DAY;
  for (let n = 0; n < 42; n++) {
    const a = Math.floor(Math.random() * 4);
    let b = Math.floor(Math.random() * 4);
    while (b === a) b = Math.floor(Math.random() * 4);
    const target: 11 | 21 = Math.random() < 0.8 ? 11 : 21;
    const aWins = Math.random() < skill[a] / (skill[a] + skill[b]);
    let win: number;
    let lose: number;
    if (Math.random() < 0.12) {
      win = target + 1 + (Math.random() < 0.4 ? 2 : 0);
      lose = win - 2;
    } else {
      win = target;
      lose = Math.floor(Math.random() * (target - 1));
    }
    games.push({
      id: uid(),
      playedAt: t,
      aId: players[a].id,
      bId: players[b].id,
      aScore: aWins ? win : lose,
      bScore: aWins ? lose : win,
      target,
    });
    t += Math.floor(DAY * (0.3 + Math.random()));
  }
  return [players, games];
}

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ detail: err.message }, err.status);
  }
  console.error(err);
  return c.json({ detail: "Something went wrong on the league server." }, 500);
});

// Vercel's Node runtime treats a default export as the legacy (req, res) => void
// signature and ignores a returned Response. Export named HTTP-method handlers
// instead — Vercel recognizes these as Web fetch-style (Request -> Response), and
// Hono dispatches every method/path internally. We use GET/POST/DELETE; OPTIONS
// covers CORS preflight.
const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
