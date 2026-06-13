"""Pong Rank API.

Run locally:  uvicorn main:app --reload --port 8000  (from backend/)
Data lives in a SQLite file at $DATA_DIR/league.db (default ./data).
If a built frontend exists at ../dist it is served at /.
Set LEAGUE_PASSCODE to require an X-League-Key header on all mutations.
"""

from __future__ import annotations

import os
import random
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import engine

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "league.db"
PASSCODE = os.environ.get("LEAGUE_PASSCODE", "")

PLAYER_COLORS = [
    "#FFA31A", "#5BC8F5", "#4CC38A", "#F76C8A", "#C792EA",
    "#FFD166", "#7DD3C0", "#FF8E5B", "#9DB8FF", "#E8C547",
]

app = FastAPI(title="Pong Rank API")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


with db() as conn:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            color TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY, played_at INTEGER NOT NULL,
            a_id TEXT NOT NULL REFERENCES players(id),
            b_id TEXT NOT NULL REFERENCES players(id),
            a_score INTEGER NOT NULL, b_score INTEGER NOT NULL,
            target INTEGER NOT NULL CHECK (target IN (11, 21))
        );
        """
    )


def _load() -> tuple[list[dict], list[dict]]:
    with db() as conn:
        players = [
            {"id": r["id"], "name": r["name"], "color": r["color"], "createdAt": r["created_at"]}
            for r in conn.execute("SELECT * FROM players ORDER BY created_at")
        ]
        games = [
            {
                "id": r["id"], "playedAt": r["played_at"], "aId": r["a_id"], "bId": r["b_id"],
                "aScore": r["a_score"], "bScore": r["b_score"], "target": r["target"],
            }
            for r in conn.execute("SELECT * FROM games ORDER BY played_at")
        ]
    return players, games


def _state() -> dict:
    players, games = _load()
    return engine.compute(players, games)


def _check_key(key: str | None):
    if PASSCODE and key != PASSCODE:
        raise HTTPException(401, "Missing or wrong league passcode.")


def _uid() -> str:
    return secrets.token_hex(6)


class PlayerIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class GameIn(BaseModel):
    aId: str
    bId: str
    aScore: int = Field(ge=0, le=200)
    bScore: int = Field(ge=0, le=200)
    target: int


class LeagueIn(BaseModel):
    players: list[dict]
    games: list[dict]


def _validate_game(g: GameIn):
    if g.target not in (11, 21):
        raise HTTPException(422, "Games are to 11 or 21 points.")
    if g.aId == g.bId:
        raise HTTPException(422, "A player can't play themselves.")
    if g.aScore == g.bScore:
        raise HTTPException(422, "Table tennis games can't end in a tie.")
    hi, lo = max(g.aScore, g.bScore), min(g.aScore, g.bScore)
    if hi < g.target:
        raise HTTPException(422, f"The winner needs at least {g.target} points.")
    if hi > g.target and hi - lo != 2:
        raise HTTPException(422, f"Past {g.target}, games end on a 2-point lead.")
    if hi == g.target and hi - lo < 2 and lo != g.target - 1:
        raise HTTPException(422, f"A {g.target}\u2013{lo} score isn't possible \u2014 at {g.target - 1}-all the game goes to deuce.")


@app.get("/api/state")
def get_state():
    return _state()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/players")
def add_player(body: PlayerIn, x_league_key: str | None = Header(default=None)):
    _check_key(x_league_key)
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) c FROM players").fetchone()["c"]
        try:
            conn.execute(
                "INSERT INTO players VALUES (?, ?, ?, ?)",
                (_uid(), body.name.strip(), PLAYER_COLORS[count % len(PLAYER_COLORS)], int(time.time() * 1000)),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "That name is already on the board.")
    return _state()


@app.delete("/api/players/{player_id}")
def delete_player(player_id: str, x_league_key: str | None = Header(default=None)):
    _check_key(x_league_key)
    with db() as conn:
        n = conn.execute(
            "SELECT COUNT(*) c FROM games WHERE a_id = ? OR b_id = ?", (player_id, player_id)
        ).fetchone()["c"]
        if n:
            raise HTTPException(409, "That player has games on record. Delete their games first.")
        conn.execute("DELETE FROM players WHERE id = ?", (player_id,))
    return _state()


@app.post("/api/games")
def add_game(body: GameIn, x_league_key: str | None = Header(default=None)):
    _check_key(x_league_key)
    _validate_game(body)
    with db() as conn:
        ids = {r["id"] for r in conn.execute("SELECT id FROM players")}
        if body.aId not in ids or body.bId not in ids:
            raise HTTPException(404, "Unknown player.")
        conn.execute(
            "INSERT INTO games VALUES (?, ?, ?, ?, ?, ?, ?)",
            (_uid(), int(time.time() * 1000), body.aId, body.bId, body.aScore, body.bScore, body.target),
        )
    return _state()


@app.delete("/api/games/{game_id}")
def delete_game(game_id: str, x_league_key: str | None = Header(default=None)):
    _check_key(x_league_key)
    with db() as conn:
        conn.execute("DELETE FROM games WHERE id = ?", (game_id,))
    return _state()


@app.get("/api/export")
def export_league():
    players, games = _load()
    return {"players": players, "games": games}


@app.post("/api/import")
def import_league(body: LeagueIn, x_league_key: str | None = Header(default=None)):
    _check_key(x_league_key)
    with db() as conn:
        conn.execute("DELETE FROM games")
        conn.execute("DELETE FROM players")
        for p in body.players:
            conn.execute(
                "INSERT INTO players VALUES (?, ?, ?, ?)",
                (p["id"], p["name"], p.get("color", PLAYER_COLORS[0]), p.get("createdAt", 0)),
            )
        for g in body.games:
            conn.execute(
                "INSERT INTO games VALUES (?, ?, ?, ?, ?, ?, ?)",
                (g["id"], g["playedAt"], g["aId"], g["bId"], g["aScore"], g["bScore"], g["target"]),
            )
    return _state()


@app.post("/api/seed")
def seed_demo(x_league_key: str | None = Header(default=None)):
    _check_key(x_league_key)
    players, games = _load()
    if games:
        raise HTTPException(409, "League already has games \u2014 demo seed only works on an empty league.")
    names = ["Shrey", "Saihej", "Arjun", "Maya"]
    skill = [0.9, 0.65, 0.45, 0.3]
    now = int(time.time() * 1000)
    with db() as conn:
        conn.execute("DELETE FROM players")
        pids = []
        for i, name in enumerate(names):
            pid = _uid()
            pids.append(pid)
            conn.execute(
                "INSERT INTO players VALUES (?, ?, ?, ?)",
                (pid, name, PLAYER_COLORS[i % len(PLAYER_COLORS)], now - 30 * 86400000),
            )
        t = now - 28 * 86400000
        for _ in range(42):
            a = random.randrange(4)
            b = random.randrange(4)
            while b == a:
                b = random.randrange(4)
            target = 11 if random.random() < 0.8 else 21
            p_a = skill[a] / (skill[a] + skill[b])
            a_wins = random.random() < p_a
            if random.random() < 0.12:  # deuce game
                win = target + 1 + (2 if random.random() < 0.4 else 0)
                lose = win - 2
            else:
                win, lose = target, random.randrange(target - 1)
            conn.execute(
                "INSERT INTO games VALUES (?, ?, ?, ?, ?, ?, ?)",
                (_uid(), t, pids[a], pids[b], win if a_wins else lose, lose if a_wins else win, target),
            )
            t += int(86400000 * (0.3 + random.random()))
    return _state()


# Serve the built frontend, if present, so one process hosts everything.
_dist = Path(__file__).resolve().parent.parent / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
