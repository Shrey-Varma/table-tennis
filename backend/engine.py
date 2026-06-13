"""Rating engine: replays the game log chronologically through openskill.py.

Model: Bradley-Terry (full pairing) with margin-of-victory enabled.
Scores are normalized to an 11-point scale before rating so that a 21-15
game and an 11-8 game carry comparable margin information.
"""

from __future__ import annotations

import math
import os
from typing import Any

from openskill.models import BradleyTerryFull

PROVISIONAL_THRESHOLD = 5
MARGIN = float(os.environ.get("MARGIN", "2.0"))

_model = BradleyTerryFull(margin=MARGIN)


def _snap(r) -> dict[str, float]:
    return {"mu": r.mu, "sigma": r.sigma, "exposed": r.mu - 3 * r.sigma}


def _norm_scores(a_score: int, b_score: int, target: int) -> list[float]:
    """Scale scores to an 11-point-equivalent so margins are comparable
    across game lengths."""
    k = 11.0 / target
    return [a_score * k, b_score * k]


def compute(players: list[dict], games: list[dict]) -> dict[str, Any]:
    ratings = {p["id"]: _model.rating(name=p["id"]) for p in players}
    history: dict[str, list[dict]] = {
        p["id"]: [
            {"gameIndex": 0, "playedAt": p["createdAt"], **_hist(_snap(ratings[p["id"]]))}
        ]
        for p in players
    }

    processed: list[dict] = []
    for idx, g in enumerate(sorted(games, key=lambda x: x["playedAt"])):
        ra, rb = ratings.get(g["aId"]), ratings.get(g["bId"])
        if ra is None or rb is None:
            continue

        a_won = g["aScore"] > g["bScore"]
        winner_id = g["aId"] if a_won else g["bId"]
        loser_id = g["bId"] if a_won else g["aId"]
        winner_r = ra if a_won else rb
        loser_r = rb if a_won else ra

        winner_pre_prob = _model.predict_win([[winner_r], [loser_r]])[0]
        a_before, b_before = _snap(ra), _snap(rb)

        win_score = max(g["aScore"], g["bScore"])
        lose_score = min(g["aScore"], g["bScore"])
        [[new_winner], [new_loser]] = _model.rate(
            [[winner_r], [loser_r]],
            scores=_norm_scores(win_score, lose_score, g["target"]),
        )
        ratings[winner_id], ratings[loser_id] = new_winner, new_loser

        a_after, b_after = _snap(ratings[g["aId"]]), _snap(ratings[g["bId"]])
        processed.append(
            {
                **g,
                "winnerId": winner_id,
                "loserId": loser_id,
                "winnerScore": win_score,
                "loserScore": lose_score,
                "margin": win_score - lose_score,
                "isDeuce": win_score > g["target"],
                "winnerPreProb": winner_pre_prob,
                "aBefore": a_before,
                "bBefore": b_before,
                "aAfter": a_after,
                "bAfter": b_after,
            }
        )
        history[g["aId"]].append(
            {"gameIndex": idx + 1, "playedAt": g["playedAt"], **_hist(a_after)}
        )
        history[g["bId"]].append(
            {"gameIndex": idx + 1, "playedAt": g["playedAt"], **_hist(b_after)}
        )

    player_stats = {
        p["id"]: _player_stats(p, processed, ratings, history, players)
        for p in players
    }

    ranked = sorted(
        player_stats.values(),
        key=lambda s: (s["provisional"], -s["rating"]["exposed"]),
    )
    for i, s in enumerate(ranked):
        s["rank"] = i + 1
        hist = s["ratingHistory"]
        if len(hist) > 5:
            past, now = hist[-6]["exposed"], s["rating"]["exposed"]
            s["rankDelta"] = 0 if abs(now - past) < 0.05 else (1 if now > past else -1)

    matchups = {
        a["id"]: {
            b["id"]: _model.predict_win([[ratings[a["id"]]], [ratings[b["id"]]]])[0]
            for b in players
            if b["id"] != a["id"]
        }
        for a in players
    }

    return {
        "players": players,
        "games": games,
        "processedGames": processed,
        "playerStats": player_stats,
        "rankedIds": [s["player"]["id"] for s in ranked],
        "league": _league_stats(processed, ranked),
        "matchups": matchups,
        "config": {"model": "BradleyTerryFull", "margin": MARGIN, "provisionalThreshold": PROVISIONAL_THRESHOLD},
    }


def _hist(snap: dict) -> dict:
    return {"exposed": snap["exposed"], "mu": snap["mu"]}


def _avg(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _player_stats(p, processed, ratings, history, players) -> dict:
    pid = p["id"]
    mine = [g for g in processed if pid in (g["aId"], g["bId"])]
    wins = [g for g in mine if g["winnerId"] == pid]
    losses = [g for g in mine if g["loserId"] == pid]

    points_for = sum(g["aScore"] if g["aId"] == pid else g["bScore"] for g in mine)
    points_against = sum(g["bScore"] if g["aId"] == pid else g["aScore"] for g in mine)

    current_streak = None
    longest_w = longest_l = 0
    run_kind, run_len = None, 0
    for g in mine:
        kind = "W" if g["winnerId"] == pid else "L"
        run_len = run_len + 1 if kind == run_kind else 1
        run_kind = kind
        if kind == "W":
            longest_w = max(longest_w, run_len)
        else:
            longest_l = max(longest_l, run_len)
    if run_kind:
        current_streak = {"kind": run_kind, "length": run_len}

    biggest_win = max(wins, key=lambda g: (g["margin"], g["winnerScore"]), default=None)
    biggest_loss = max(losses, key=lambda g: (g["margin"], g["winnerScore"]), default=None)
    deuce = [g for g in mine if g["isDeuce"]]

    h2h = []
    for opp in players:
        oid = opp["id"]
        if oid == pid:
            continue
        vs = [g for g in mine if oid in (g["aId"], g["bId"])]
        w = [g for g in vs if g["winnerId"] == pid]
        l = [g for g in vs if g["loserId"] == pid]
        pf = sum(g["aScore"] if g["aId"] == pid else g["bScore"] for g in vs)
        pa = sum(g["bScore"] if g["aId"] == pid else g["aScore"] for g in vs)
        h2h.append(
            {
                "opponentId": oid,
                "wins": len(w),
                "losses": len(l),
                "pointsFor": pf,
                "pointsAgainst": pa,
                "winProb": _model.predict_win([[ratings[pid]], [ratings[oid]]])[0],
                "avgMarginInWins": _avg([g["margin"] for g in w]),
                "avgMarginInLosses": _avg([g["margin"] for g in l]),
                "lastResults": ["W" if g["winnerId"] == pid else "L" for g in vs[-5:]],
            }
        )

    contested = [m for m in h2h if m["wins"] + m["losses"] >= 2]
    by_win_pct = sorted(contested, key=lambda m: m["wins"] / (m["wins"] + m["losses"]))
    nemesis = by_win_pct[0] if by_win_pct else None
    best_matchup = by_win_pct[-1] if by_win_pct else None

    snap = _snap(ratings[pid])
    return {
        "player": p,
        "rating": snap,
        "rank": 0,
        "provisional": len(mine) < PROVISIONAL_THRESHOLD,
        "games": len(mine),
        "wins": len(wins),
        "losses": len(losses),
        "winRate": len(wins) / len(mine) if mine else 0.0,
        "currentStreak": current_streak,
        "longestWinStreak": longest_w,
        "longestLossStreak": longest_l,
        "pointsFor": points_for,
        "pointsAgainst": points_against,
        "pointDiff": points_for - points_against,
        "avgPointsFor": points_for / len(mine) if mine else 0.0,
        "avgPointsAgainst": points_against / len(mine) if mine else 0.0,
        "avgMarginInWins": _avg([g["margin"] for g in wins]),
        "avgMarginInLosses": _avg([g["margin"] for g in losses]),
        "biggestWin": biggest_win,
        "biggestLoss": biggest_loss,
        "deuceGames": len(deuce),
        "deuceRecord": {
            "wins": sum(1 for g in deuce if g["winnerId"] == pid),
            "losses": sum(1 for g in deuce if g["loserId"] == pid),
        },
        "recordBy11": {
            "wins": sum(1 for g in wins if g["target"] == 11),
            "losses": sum(1 for g in losses if g["target"] == 11),
        },
        "recordBy21": {
            "wins": sum(1 for g in wins if g["target"] == 21),
            "losses": sum(1 for g in losses if g["target"] == 21),
        },
        "upsetsPulled": sum(1 for g in wins if g["winnerPreProb"] < 0.5),
        "upsetsSuffered": sum(1 for g in losses if 1 - g["winnerPreProb"] < 0.5),
        "peakRating": max(h["exposed"] for h in history[pid]),
        "form": ["W" if g["winnerId"] == pid else "L" for g in mine[-10:]],
        "ratingHistory": history[pid],
        "headToHead": h2h,
        "nemesis": nemesis,
        "bestMatchup": best_matchup,
        "rankDelta": None,
    }


def _league_stats(processed: list[dict], ranked: list[dict]) -> dict:
    by_upset = sorted(processed, key=lambda g: g["winnerPreProb"])
    by_margin = sorted(processed, key=lambda g: (g["margin"], -g["winnerScore"]))
    by_blowout = sorted(processed, key=lambda g: -g["margin"])

    longest_active = None
    for s in ranked:
        cs = s["currentStreak"]
        if cs and cs["kind"] == "W":
            if longest_active is None or cs["length"] > longest_active["length"]:
                longest_active = {"player": s["player"], "length": cs["length"]}

    most_active = max(ranked, key=lambda s: s["games"], default=None)
    return {
        "totalGames": len(processed),
        "totalPoints": sum(g["aScore"] + g["bScore"] for g in processed),
        "deuceGames": sum(1 for g in processed if g["isDeuce"]),
        "gamesTo11": sum(1 for g in processed if g["target"] == 11),
        "gamesTo21": sum(1 for g in processed if g["target"] == 21),
        "avgMargin": (sum(g["margin"] for g in processed) / len(processed)) if processed else 0.0,
        "biggestUpsets": [g for g in by_upset if g["winnerPreProb"] < 0.5][:5],
        "closestGames": by_margin[:5],
        "mostLopsided": by_blowout[:5],
        "longestActiveStreak": longest_active,
        "mostActive": {"player": most_active["player"], "games": most_active["games"]} if most_active else None,
    }
