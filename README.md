# Pong Rank

A shared leaderboard for a summer table-tennis league. Python backend runs
OpenSkill's Bradley-Terry model with **margin-of-victory enabled** — an 11-2
moves ratings more than an 11-9 — and the whole friend group shares one
league because the game log lives server-side (SQLite).

## Architecture

```
src/        React + TS frontend (Vite) — thin client, renders API state
backend/    FastAPI + openskill.py — owns the data and ALL rating math
  engine.py   replays the game log through BradleyTerryFull(margin=2.0)
  main.py     REST API + SQLite + serves the built frontend at /
```

Every request recomputes the season from the raw game list, so deleting a
game cleanly recomputes history, and the database only ever stores players
and games — never derived ratings.

## Run it locally

```bash
# terminal 1 — backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# terminal 2 — frontend dev server (proxies /api to :8000)
npm install
npm run dev
```

Or single-process: `npm run build`, then just run the backend — FastAPI
serves the built frontend at http://localhost:8000.

## Deploy

The easiest path is the included **Dockerfile** (builds frontend, runs the
API, serves both from one container on port 8000) on any host with a
persistent volume:

- **Railway / Fly.io**: deploy the repo, attach a volume, set `DATA_DIR` to
  the volume mount path. Done.
- **Render**: same, but note free-tier disks are not persistent — use a paid
  disk or an external DB.
- **Vercel**: can host the *frontend* only (set `VITE_API_URL` to your
  backend's URL); the Python backend needs a real host because SQLite
  requires a persistent filesystem.

### Options (env vars)

- `DATA_DIR` — where `league.db` lives (default `./data`)
- `MARGIN` — OpenSkill margin parameter (default `2.0`; set `0` to disable
  margin-of-victory entirely)
- `LEAGUE_PASSCODE` — if set, all mutations require this passcode; the
  frontend prompts for it once and remembers it

## How the rating works

`backend/engine.py` replays games chronologically through
[openskill.py](https://openskill.me)'s `BradleyTerryFull` model:

- **Margin of victory**: scores are passed to `rate(..., scores=[w, l])`
  with `margin=2.0`, so wins by more than 2 points scale the update by
  `log1p(diff / margin)`. Blowouts move ratings more; the effect is
  logarithmic so an extreme score can't wreck the system.
- **11 vs 21 games**: scores are normalized to an 11-point scale before
  rating, so a 21-15 carries the same margin signal as an 11-8.
- **Leaderboard value**: μ − 3σ (ordinal/conservative rating). Players with
  fewer than 5 games are provisional and listed below the field.
- **Win probabilities** (profiles, matchup matrix, log-game preview) come
  from the model's `predict_win`.

One known quirk of OpenSkill's margin formulation: for *upsets*, a blowout
upset moves ratings slightly **less** than a narrow upset (the divisor
flattens the expected win probability toward 50%). Upsets still always pay
far more than expected wins; the inversion is only among upset sizes.

## API

`GET /api/state` · `POST /api/players` · `DELETE /api/players/{id}` ·
`POST /api/games` · `DELETE /api/games/{id}` · `GET /api/export` ·
`POST /api/import` · `POST /api/seed` (empty league only) · `GET /api/health`

All mutation endpoints validate real table-tennis scores (win by 2, deuce
past the target) and return the full recomputed state.
