import { useState } from "react";
import type { EngineResult } from "../engine";
import type { Player } from "../types";
import { fmtDateTime, pct } from "./common";

export function GamesView({
  engine,
  players,
  onDeleteGame,
  onLogGame,
  onOpenPlayer,
}: {
  engine: EngineResult;
  players: Player[];
  onDeleteGame: (id: string) => void;
  onLogGame: () => void;
  onOpenPlayer: (id: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const byId = new Map(players.map((p) => [p.id, p]));

  const games = [...engine.processedGames]
    .reverse()
    .filter((g) => filter === "all" || g.aId === filter || g.bId === filter);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Match history</h2>
          <p className="page-sub">
            {engine.processedGames.length} game{engine.processedGames.length === 1 ? "" : "s"} logged.
            Ratings shown are each player's change from the result.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by player"
            style={{
              background: "var(--ink-2)", color: "var(--text)",
              border: "1px solid var(--line-strong)", borderRadius: 7, padding: "8px 10px",
            }}
          >
            <option value="all">All players</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={onLogGame}>+ Log game</button>
        </div>
      </div>

      {games.length === 0 ? (
        <div className="empty">
          <span className="display">No games yet</span>
          <p>Log a game and it shows up here with the full rating math.</p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflow: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Match</th>
                <th>Score</th>
                <th>To</th>
                <th className="num">Δ Winner</th>
                <th className="num">Δ Loser</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const winner = byId.get(g.winnerId);
                const loser = byId.get(g.loserId);
                if (!winner || !loser) return null;
                const winnerWasA = g.winnerId === g.aId;
                const dWin = (winnerWasA ? g.aAfter.exposed - g.aBefore.exposed : g.bAfter.exposed - g.bBefore.exposed);
                const dLose = (winnerWasA ? g.bAfter.exposed - g.bBefore.exposed : g.aAfter.exposed - g.aBefore.exposed);
                const upset = g.winnerPreProb < 0.45;
                return (
                  <tr key={g.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>{fmtDateTime(g.playedAt)}</td>
                    <td>
                      <span className="row-click winner" onClick={() => onOpenPlayer(winner.id)} style={{ fontWeight: 600 }}>
                        {winner.name}
                      </span>
                      <span style={{ color: "var(--faint)" }}> def. </span>
                      <span className="row-click" onClick={() => onOpenPlayer(loser.id)}>{loser.name}</span>
                    </td>
                    <td className="scoreline num">{g.winnerScore}–{g.loserScore}</td>
                    <td className="num" style={{ color: "var(--muted)" }}>{g.target}</td>
                    <td className="num" style={{ color: "var(--green)" }}>+{(dWin).toFixed(2)}</td>
                    <td className="num" style={{ color: "var(--red)" }}>{(dLose).toFixed(2)}</td>
                    <td>
                      {upset && <span className="pill upset" title={`Winner had a ${pct(g.winnerPreProb)} pre-game chance`}>Upset {pct(g.winnerPreProb)}</span>}{" "}
                      {g.isDeuce && <span className="pill deuce">Deuce</span>}
                    </td>
                    <td>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          if (confirm(`Delete ${winner.name} ${g.winnerScore}–${g.loserScore} ${loser.name}? All ratings recompute.`))
                            onDeleteGame(g.id);
                        }}
                        aria-label="Delete game"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
