# Pong Rank

A shared leaderboard for a summer table-tennis league. A TypeScript serverless
backend runs [openskill.js](https://github.com/philihp/openskill.js)'s
Bradley-Terry model with **margin-of-victory enabled** — an 11-2 moves ratings
more than an 11-9 — and the whole friend group shares one league because the
game log lives in a serverless Postgres database (Neon).

## Architecture

```
src/        React + TS frontend (Vite) — thin client, renders API state
api/        Vercel serverless functions (Node) — own the data and ALL rating math
  _engine.ts    replays the game log through openskill.js bradleyTerryFull(margin)
  _db.ts        Neon Postgres data layer (stateless HTTP driver)
  _validate.ts  passcode + real-table-tennis score validation
  [[...route]].ts  one function; Hono routes every endpoint, serves { detail } errors
```

Every request recomputes the season from the raw game list, so deleting a game
cleanly recomputes history, and the database only ever stores players and
games — never derived ratings. One Hono function handles all `/api/*` routes;
Vercel serves the built frontend for everything else.

## Run it locally

You need a Postgres connection string. The easiest is a free **Neon** database
(a dev branch is ideal); put it in `.env.local`:

```bash
echo 'DATABASE_URL="postgres://…neon.tech/neondb?sslmode=require"' > .env.local
npm install
npm run init-db          # create the tables (idempotent)
npx vercel dev           # serves the SPA + /api on one port (http://localhost:3000)
```

- `npm run dev` runs the **frontend only** (no API) for pure UI work.
- `npm test` runs the engine + API test suites — no database required.

## Deploy (Vercel + Neon, free tier)

1. **Neon**: create a project; copy the **pooled** connection string.
2. **Vercel**: import the repo (it auto-detects Vite + the `api/` functions).
   Set environment variables: `DATABASE_URL` (the Neon string), and optionally
   `MARGIN` / `LEAGUE_PASSCODE` (below).
3. Initialize the schema once: `DATABASE_URL="…" npm run init-db` (or hit any
   endpoint — the tables are created on first use).
4. Deploy. The same project hosts the SPA and the API; no server to manage and
   no persistent disk to attach (Neon is the storage).

### Options (env vars)

- `DATABASE_URL` — Neon Postgres connection string (**required**)
- `MARGIN` — margin-of-victory parameter (default `2.0`; set `0` to disable
  margin-of-victory entirely)
- `LEAGUE_PASSCODE` — if set, all mutations require this passcode; the frontend
  prompts for it once and remembers it

## How the rating works

`api/_engine.ts` replays games chronologically through openskill.js's
`bradleyTerryFull` model:

- **Margin of victory**: normalized scores are passed to `rate(…, { score, margin })`.
  openskill.js scales the rating update by `1 + log1p(scoreDiff − margin)`, so
  wins by more than the margin move ratings more. The effect is logarithmic, so
  an extreme score can't wreck the system. (This is a monotonic multiplier on the
  update — bigger margins always count for at least as much.)
- **11 vs 21 games**: scores are normalized to an 11-point scale before rating,
  so a 21-15 carries roughly the same margin signal as an 11-8.
- **Leaderboard value**: μ − 3σ (ordinal/conservative rating). Players with
  fewer than 5 games are provisional and listed below the field.
- **Win probabilities** (profiles, matchup matrix, log-game preview) come from
  the model's `predictWin`.

> Migration note: the rating math moved from `openskill.py` to `openskill.js`.
> The Bradley-Terry base update is identical; only margin-of-victory is applied
> slightly differently (an external monotonic multiplier here vs. an internal
> divisor in the Python version). Ratings track each other closely; the JS form
> has the nice property that a bigger margin never counts for *less* — so the
> old "inverse blowout" quirk among upsets is gone.

## API

`GET /api/state` · `POST /api/players` · `DELETE /api/players/{id}` ·
`POST /api/games` · `DELETE /api/games/{id}` · `GET /api/export` ·
`POST /api/import` · `POST /api/seed` (empty league only) · `GET /api/health`

All mutation endpoints validate real table-tennis scores (win by 2, deuce past
the target) and return the full recomputed state.
