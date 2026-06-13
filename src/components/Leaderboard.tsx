import type { EngineResult } from "../engine";
import { PROVISIONAL_THRESHOLD } from "../types";
import { Sparkline, fmt1, pct } from "./common";

export function Leaderboard({
  engine,
  onOpenPlayer,
  onLogGame,
  onAddPlayer,
}: {
  engine: EngineResult;
  onOpenPlayer: (id: string) => void;
  onLogGame: () => void;
  onAddPlayer: () => void;
}) {
  const { ranked } = engine;

  if (ranked.length === 0) {
    return (
      <div className="empty">
        <span className="display">No players yet</span>
        <p>Add your friends, log your first game, and the table fills itself in.</p>
        <button className="btn btn-primary" onClick={onAddPlayer}>Add a player</button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Standings</h2>
          <p className="page-sub">
            Ranked by TrueSkill conservative rating (μ − 3σ). Players with fewer than{" "}
            {PROVISIONAL_THRESHOLD} games are provisional and listed below the field.
          </p>
        </div>
        <button className="btn btn-primary" onClick={onLogGame}>+ Log game</button>
      </div>

      <div role="list">
        {ranked.map((s) => {
          const streak = s.currentStreak;
          return (
            <button
              key={s.player.id}
              role="listitem"
              className={`slab ${s.rank === 1 && !s.provisional ? "rank-1" : ""} ${s.provisional ? "provisional" : ""}`}
              onClick={() => onOpenPlayer(s.player.id)}
            >
              <span className="slab-id">
                <span className="slab-rank num">{s.rank}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="slab-name">{s.player.name}</span>
                  <div className="slab-streak">
                    {s.provisional
                      ? `Provisional · ${s.games}/${PROVISIONAL_THRESHOLD} games`
                      : streak
                        ? `${streak.kind === "W" ? "Won" : "Lost"} last ${streak.length}`
                        : "No games yet"}
                  </div>
                </span>
              </span>

              <span className="slab-stats">
                <span className="slab-stat slab-rating">
                  <div className="v num">
                    {fmt1(s.rating.exposed)}
                    {s.rankDelta !== null && s.rankDelta !== 0 && (
                      <span className={s.rankDelta > 0 ? "delta-up" : "delta-down"} style={{ fontSize: 14, marginLeft: 5 }}>
                        {s.rankDelta > 0 ? "▲" : "▼"}
                      </span>
                    )}
                  </div>
                  <div className="k">Rating · ±{s.ratingPlusMinus.toFixed(1)}</div>
                </span>
                <span className="slab-stat">
                  <div className="v num">{s.wins}–{s.losses}</div>
                  <div className="k">Record</div>
                </span>
                <span className="slab-stat">
                  <div className="v num">{s.games ? pct(s.winRate) : "—"}</div>
                  <div className="k">Win rate</div>
                </span>
                <span className="slab-stat">
                  <div className="v num">{s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}</div>
                  <div className="k">Pt diff</div>
                </span>
                <span className="slab-stat slab-spark">
                  <Sparkline values={s.ratingHistory.map((h) => h.exposed)} />
                  <div className="k">Trend</div>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
