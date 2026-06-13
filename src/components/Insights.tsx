import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { EngineResult } from "../engine";
import type { Player } from "../types";
import { fmtDate, pct } from "./common";

export function Insights({
  engine,
  players,
  onOpenPlayer,
}: {
  engine: EngineResult;
  players: Player[];
  onOpenPlayer: (id: string) => void;
}) {
  const { league, processedGames } = engine;
  const byId = new Map(players.map((p) => [p.id, p]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "?";

  if (processedGames.length === 0) {
    return (
      <div className="empty">
        <span className="display">Insights unlock with games</span>
        <p>Once a few games are logged, the rating race, upsets, and league records appear here.</p>
      </div>
    );
  }

  // Rating race: one row per game index, columns per player (carry-forward).
  const race: Record<string, number | string>[] = [];
  const lastVal = new Map<string, number>();
  processedGames.forEach((g, i) => {
    lastVal.set(g.aId, +g.aAfter.exposed.toFixed(2));
    lastVal.set(g.bId, +g.bAfter.exposed.toFixed(2));
    const row: Record<string, number | string> = { i: i + 1, label: fmtDate(g.playedAt) };
    for (const [pid, v] of lastVal) row[pid] = v;
    race.push(row);
  });

  const activePlayers = players.filter((p) => lastVal.has(p.id));

  const gameRow = (g: (typeof processedGames)[number], note: string) => (
    <tr key={g.id + note}>
      <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(g.playedAt)}</td>
      <td>
        <span className="row-click winner" onClick={() => onOpenPlayer(g.winnerId)} style={{ fontWeight: 600 }}>{nameOf(g.winnerId)}</span>
        <span style={{ color: "var(--faint)" }}> def. </span>
        <span className="row-click" onClick={() => onOpenPlayer(g.loserId)}>{nameOf(g.loserId)}</span>
      </td>
      <td className="scoreline num">{g.winnerScore}–{g.loserScore}</td>
      <td className="num" style={{ color: "var(--muted)" }}>{note}</td>
    </tr>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>League insights</h2>
          <p className="page-sub">The story of the season so far, in numbers.</p>
        </div>
      </div>

      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile"><div className="v num">{league.totalGames}</div><div className="k">Games played</div><div className="s">{league.gamesTo11} to 11 · {league.gamesTo21} to 21</div></div>
        <div className="tile"><div className="v num">{league.totalPoints.toLocaleString()}</div><div className="k">Points scored</div></div>
        <div className="tile"><div className="v num">{league.avgMargin.toFixed(1)}</div><div className="k">Avg margin</div></div>
        <div className="tile"><div className="v num">{league.deuceGames}</div><div className="k">Deuce games</div><div className="s">{league.totalGames ? pct(league.deuceGames / league.totalGames) : "0%"} of all games</div></div>
        {league.longestActiveStreak && (
          <div className="tile">
            <div className="v">{league.longestActiveStreak.player.name}</div>
            <div className="k">Hottest hand</div>
            <div className="s">{league.longestActiveStreak.length} wins running</div>
          </div>
        )}
        {league.mostActive && (
          <div className="tile">
            <div className="v">{league.mostActive.player.name}</div>
            <div className="k">Most games</div>
            <div className="s">{league.mostActive.games} played</div>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>The rating race</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={race} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="rgba(239,245,252,0.08)" vertical={false} />
            <XAxis dataKey="i" tick={{ fill: "#8da4c0", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(239,245,252,0.2)" }} label={undefined} />
            <YAxis tick={{ fill: "#8da4c0", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#101d31", border: "1px solid rgba(239,245,252,0.3)", borderRadius: 8, fontSize: 12.5 }}
              labelFormatter={(v) => `Game ${v}`}
              formatter={(v, key) => [String(v), nameOf(String(key))]}
            />
            <Legend formatter={(key) => <span style={{ color: "#8da4c0", fontSize: 12 }}>{nameOf(String(key))}</span>} />
            {activePlayers.map((p) => (
              <Line key={p.id} type="monotone" dataKey={p.id} stroke={p.color} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="hint-text">Conservative rating (μ − 3σ) after every game in the league, in order played.</p>
      </div>

      <div className="grid-2 section-gap">
        <div className="panel" style={{ overflow: "auto" }}>
          <h3>Biggest upsets</h3>
          {league.biggestUpsets.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No upsets yet — the favorites keep winning.</p>
          ) : (
            <table className="data">
              <thead><tr><th>When</th><th>Result</th><th className="num">Score</th><th className="num">Win odds</th></tr></thead>
              <tbody>{league.biggestUpsets.map((g) => gameRow(g, pct(g.winnerPreProb)))}</tbody>
            </table>
          )}
        </div>

        <div className="panel" style={{ overflow: "auto" }}>
          <h3>Closest games</h3>
          <table className="data">
            <thead><tr><th>When</th><th>Result</th><th className="num">Score</th><th className="num">Margin</th></tr></thead>
            <tbody>{league.closestGames.map((g) => gameRow(g, `+${g.margin}`))}</tbody>
          </table>
        </div>

        <div className="panel" style={{ overflow: "auto" }}>
          <h3>Most lopsided</h3>
          <table className="data">
            <thead><tr><th>When</th><th>Result</th><th className="num">Score</th><th className="num">Margin</th></tr></thead>
            <tbody>{league.mostLopsided.map((g) => gameRow(g, `+${g.margin}`))}</tbody>
          </table>
        </div>

        <div className="panel" style={{ overflow: "auto" }}>
          <h3>Win probability matrix</h3>
          <MatchupMatrix engine={engine} players={players} onOpenPlayer={onOpenPlayer} />
        </div>
      </div>
    </div>
  );
}

function MatchupMatrix({
  engine, onOpenPlayer,
}: { engine: EngineResult; players: Player[]; onOpenPlayer: (id: string) => void }) {
  const ranked = engine.ranked.filter((s) => s.games > 0).map((s) => s.player);
  if (ranked.length < 2) return <p style={{ color: "var(--muted)" }}>Needs at least two active players.</p>;
  return (
    <table className="data" style={{ fontSize: 12.5 }}>
      <thead>
        <tr>
          <th />
          {ranked.map((p) => <th key={p.id} className="num" style={{ color: p.color }}>{p.name.slice(0, 6)}</th>)}
        </tr>
      </thead>
      <tbody>
        {ranked.map((row) => {
          const stats = engine.playerStats.get(row.id)!;
          return (
            <tr key={row.id}>
              <td className="row-click" style={{ fontWeight: 600, color: row.color }} onClick={() => onOpenPlayer(row.id)}>
                {row.name.slice(0, 10)}
              </td>
              {ranked.map((col) => {
                if (col.id === row.id) return <td key={col.id} className="num" style={{ color: "var(--faint)" }}>—</td>;
                const m = stats.headToHead.find((h) => h.opponentId === col.id);
                const p = m ? m.winProb : 0.5;
                return (
                  <td key={col.id} className="num" title={`${row.name} beats ${col.name}: ${pct(p)}`}
                    style={{ color: p >= 0.5 ? "var(--ball)" : "var(--muted)" }}>
                    {pct(p)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
