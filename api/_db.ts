/* Neon Postgres data layer. The DB only ever stores players and games — never
 * derived ratings; every read recomputes the season (see _engine.ts). Uses the
 * stateless HTTP driver so there is no connection pool to exhaust across
 * serverless invocations. All SQL lives here; the router just orchestrates. */
import { neon } from "@neondatabase/serverless";
import type { Game, Player } from "../src/types";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — point it at your Neon connection string.");
}

const sql = neon(connectionString);

/** Postgres unique_violation — surfaces a duplicate player name as a 409. */
export const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

let schemaReady: Promise<void> | null = null;
/** Idempotent schema creation, run once per cold container. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = initSchema();
  return schemaReady;
}
async function initSchema(): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS citext`;
  await sql`CREATE TABLE IF NOT EXISTS players (
    id text PRIMARY KEY,
    name citext NOT NULL UNIQUE,
    color text NOT NULL,
    created_at bigint NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS games (
    id text PRIMARY KEY,
    played_at bigint NOT NULL,
    a_id text NOT NULL REFERENCES players(id),
    b_id text NOT NULL REFERENCES players(id),
    a_score integer NOT NULL,
    b_score integer NOT NULL,
    target integer NOT NULL CHECK (target IN (11, 21))
  )`;
  await sql`CREATE INDEX IF NOT EXISTS games_played_at_idx ON games (played_at)`;
}

/** Load the raw league. bigint columns come back as strings, so coerce timestamps. */
export async function load(): Promise<{ players: Player[]; games: Game[] }> {
  await ensureSchema();
  const [players, games] = await Promise.all([
    sql`SELECT id, name, color, created_at FROM players ORDER BY created_at`,
    sql`SELECT id, played_at, a_id, b_id, a_score, b_score, target FROM games ORDER BY played_at`,
  ]);
  return {
    players: players.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      createdAt: Number(r.created_at),
    })),
    games: games.map((r) => ({
      id: r.id,
      playedAt: Number(r.played_at),
      aId: r.a_id,
      bId: r.b_id,
      aScore: r.a_score,
      bScore: r.b_score,
      target: r.target as 11 | 21,
    })),
  };
}

export async function countPlayers(): Promise<number> {
  await ensureSchema();
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM players`;
  return count;
}

export async function countGames(): Promise<number> {
  await ensureSchema();
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM games`;
  return count;
}

export async function gamesForPlayer(id: string): Promise<number> {
  await ensureSchema();
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM games WHERE a_id = ${id} OR b_id = ${id}`;
  return count;
}

/** How many of the two ids exist (used to reject games with unknown players). */
export async function playersPresent(aId: string, bId: string): Promise<number> {
  await ensureSchema();
  const rows = await sql`SELECT id FROM players WHERE id = ${aId} OR id = ${bId}`;
  return rows.length;
}

export async function insertPlayer(p: Player): Promise<void> {
  await ensureSchema();
  await sql`INSERT INTO players (id, name, color, created_at)
    VALUES (${p.id}, ${p.name}, ${p.color}, ${p.createdAt})`;
}

export async function deletePlayer(id: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM players WHERE id = ${id}`;
}

export async function insertGame(g: Game): Promise<void> {
  await ensureSchema();
  await sql`INSERT INTO games (id, played_at, a_id, b_id, a_score, b_score, target)
    VALUES (${g.id}, ${g.playedAt}, ${g.aId}, ${g.bId}, ${g.aScore}, ${g.bScore}, ${g.target})`;
}

export async function deleteGame(id: string): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM games WHERE id = ${id}`;
}

/** Atomically replace the entire league (used by import and seed). */
export async function replaceLeague(players: Player[], games: Game[]): Promise<void> {
  await ensureSchema();
  await sql.transaction([
    sql`DELETE FROM games`,
    sql`DELETE FROM players`,
    ...players.map(
      (p) => sql`INSERT INTO players (id, name, color, created_at)
        VALUES (${p.id}, ${p.name}, ${p.color}, ${p.createdAt})`,
    ),
    ...games.map(
      (g) => sql`INSERT INTO games (id, played_at, a_id, b_id, a_score, b_score, target)
        VALUES (${g.id}, ${g.playedAt}, ${g.aId}, ${g.bId}, ${g.aScore}, ${g.bScore}, ${g.target})`,
    ),
  ]);
}
