import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { EngineResult } from "../engine";
import type { Player } from "../types";
import { PROVISIONAL_THRESHOLD } from "../types";
import { Avatar, FormDots, ProbBar, fmt1, fmtDate, pct } from "./common";

export function Profile({
  playerId,
  engine,
  players,
  onBack,
  onOpenPlayer,
  onLogGame,
}: {
  playerId: string;
  engine: EngineResult;
  players: Player[];
  onBack: () => void;
  onOpenPlayer: (id: string) => void;
  onLogGame: (defaultA: string) => void;
}) {
  const s = engine.playerStats.get(playerId);
  if (!s) return null;
  const byId = new Map(players.map((p) => [p.id, p]));

  const chartData = s.ratingHistory.map((h, i) => ({
    i,
    label: i === 0 ? "Start" : fmtDate(h.playedAt),
    rating: +h.exposed.toFixed(2),
    mu: +h.mu.toFixed(2),
  }));

  const recent = [...engine.processedGames]
    .filter((g) => g.aId === playerId || g.bId === playerId)
    .reverse()
    .slice(0, 8);

  const nameOf = (id: string) => byId.get(id)?.name ?? "?";

  return (
    <div>
      <button className="back-link" onClick={onBack}>← Back to standings</button>

      <div className="profile-hero">
        <Avatar player={s.player} size={64} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="name">{s.player.name}</div>
          <div className="meta">
            Rank #{s.rank}{s.provisional ? ` · provisional (${s.games}/${PROVISIONAL_THRESHOLD} games)` : ""} · μ {fmt1(s.rating.mu)} · σ {s.rating.sigma.toFixed(2)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="big-rating num">{fmt1(s.rating.exposed)}</div>
          <div className="meta">Conservative rating (μ − 3σ)</div>
        </div>
        <button className="btn btn-primary" onClick={() => onLogGame(playerId)} style={{ position: "relative", zIndex: 1 }}>
          + Log game
        </button>
      </div>

      {/* core stat tiles */}
      <div className="tiles">
        <div className="tile"><div className="v num">{s.wins}–{s.losses}</div><div className="k">Record</div><div className="s">{s.games} games</div></div>
        <div className="tile"><div className="v num">{s.games ? pct(s.winRate) : "—"}</div><div className="k">Win rate</div></div>
        <div className="tile">
          <div className="v num">{s.currentStreak ? `${s.currentStreak.kind}${s.currentStreak.length}` : "—"}</div>
          <div className="k">Current streak</div>
          <div className="s">Best: W{s.longestWinStreak} · Worst: L{s.longestLossStreak}</div>
        </div>
        <div className="tile"><div className="v num">{fmt1(s.peakRating)}</div><div className="k">Peak rating</div></div>
        <div className="tile">
          <div className="v num">{s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}</div>
          <div className="k">Point diff</div>
          <div className="s">{s.pointsFor} for · {s.pointsAgainst} against</div>
        </div>
        <div className="tile">
          <div className="v num">{s.avgPointsFor.toFixed(1)}–{s.avgPointsAgainst.toFixed(1)}</div>
          <div className="k">Avg scoreline</div>
        </div>
        <div className="tile">
          <div className="v num">{s.avgMarginInWins !== null ? `+${s.avgMarginInWins.toFixed(1)}` : "—"}</div>
          <div className="k">Avg win margin</div>
          <div className="s">{s.avgMarginInLosses !== null ? `Loses by ${s.avgMarginInLosses.toFixed(1)}` : ""}</div>
        </div>
        <div className="tile">
          <div className="v num">{s.deuceRecord.wins}–{s.deuceRecord.losses}</div>
          <div className="k">Deuce record</div>
          <div className="s">{s.deuceGames} games past target</div>
        </div>
        <div className="tile">
          <div className="v num">{s.recordBy11.wins}–{s.recordBy11.losses}</div>
          <div className="k">To 11</div>
          <div className="s">To 21: {s.recordBy21.wins}–{s.recordBy21.losses}</div>
        </div>
        <div className="tile">
          <div className="v num">{s.upsetsPulled}</div>
          <div className="k">Upsets pulled</div>
          <div className="s">{s.upsetsSuffered} suffered</div>
        </div>
        <div className="tile">
          <div className="v"><FormDots form={s.form} /></div>
          <div className="k">Last {s.form.length || 0} games</div>
        </div>
        {s.biggestWin && (
          <div className="tile">
            <div className="v num">{s.biggestWin.winnerScore}–{s.biggestWin.loserScore}</div>
            <div className="k">Biggest win</div>
            <div className="s">vs {nameOf(s.biggestWin.loserId)}</div>
          </div>
        )}
        {s.biggestLoss && (
          <div className="tile">
            <div className="v num">{s.biggestLoss.loserScore}–{s.biggestLoss.winnerScore}</div>
            <div className="k">Worst loss</div>
            <div className="s">vs {nameOf(s.biggestLoss.winnerId)}</div>
          </div>
        )}
        {s.nemesis && (
          <div className="tile">
            <div className="v">{nameOf(s.nemesis.opponentId)}</div>
            <div className="k">Nemesis</div>
            <div className="s">{s.nemesis.wins}–{s.nemesis.losses} against them</div>
          </div>
        )}
        {s.bestMatchup && s.bestMatchup !== s.nemesis && (
          <div className="tile">
            <div className="v">{nameOf(s.bestMatchup.opponentId)}</div>
            <div className="k">Favorite opponent</div>
            <div className="s">{s.bestMatchup.wins}–{s.bestMatchup.losses} against them</div>
          </div>
        )}

        {/* rating-quality & performance */}
        <div className="tile">
          <div className="v num">±{s.ratingPlusMinus.toFixed(1)}</div>
          <div className="k">Confidence</div>
          <div className="s">{s.provisional ? "still settling" : "rating is well-established"}</div>
        </div>
        <div className="tile">
          <div className="v num">{fmt1(s.formExposed)}</div>
          <div className="k">Form rating</div>
          <div className="s">{s.momentum >= 0 ? "+" : ""}{s.momentum.toFixed(1)} over last {Math.min(5, s.games)}</div>
        </div>
        <div className="tile">
          <div className="v num" style={{ color: s.winsAboveExpectation >= 0 ? "var(--green)" : "var(--red)" }}>
            {s.winsAboveExpectation >= 0 ? "+" : ""}{s.winsAboveExpectation.toFixed(1)}
          </div>
          <div className="k">Wins vs expected</div>
          <div className="s">expected {s.expectedWins.toFixed(1)} of {s.games}</div>
        </div>
        <div className="tile">
          <div className="v num">{s.clutchWinRate !== null ? pct(s.clutchWinRate) : "—"}</div>
          <div className="k">Clutch (deuce) win%</div>
          <div className="s">{s.deuceRecord.wins}–{s.deuceRecord.losses} in deuce games</div>
        </div>
        <div className="tile">
          <div className="v num">{s.vsStronger.wins}–{s.vsStronger.losses}</div>
          <div className="k">vs higher-rated</div>
          <div className="s">vs lower-rated: {s.vsWeaker.wins}–{s.vsWeaker.losses}</div>
        </div>
        <div className="tile">
          <div className="v num">{s.volatility.toFixed(2)}</div>
          <div className="k">Volatility</div>
          <div className="s">lower = steadier</div>
        </div>
        <div className="tile">
          <div className="v num">{s.strengthOfSchedule !== null ? fmt1(s.strengthOfSchedule) : "—"}</div>
          <div className="k">Strength of schedule</div>
          <div className="s">avg opponent rating</div>
        </div>
        <div className="tile">
          <div className="v num">{pct(s.pointWinRate)}</div>
          <div className="k">Points won</div>
          <div className="s">{s.recentWinRate !== null ? `${pct(s.recentWinRate)} recent game win%` : ""}</div>
        </div>
        {s.bestWinByRating && (() => {
          const g = s.bestWinByRating;
          const isA = g.aId === playerId;
          const gap = (isA ? g.bBefore.exposed : g.aBefore.exposed) - (isA ? g.aBefore.exposed : g.bBefore.exposed);
          return (
            <div className="tile">
              <div className="v num">{g.winnerScore}–{g.loserScore}</div>
              <div className="k">Signature win</div>
              <div className="s">vs {nameOf(g.loserId)}{gap > 0 ? ` (+${gap.toFixed(1)} rated)` : ""}</div>
            </div>
          );
        })()}
        <div className="tile">
          <div className="v num">{s.avgOpponentRatingInWins !== null ? fmt1(s.avgOpponentRatingInWins) : "—"}</div>
          <div className="k">Avg rating beaten</div>
          <div className="s">{s.avgOpponentRatingInLosses !== null ? `lost to ${fmt1(s.avgOpponentRatingInLosses)}` : "quality of wins"}</div>
        </div>
        <div className="tile">
          <div className="v num">{s.blowoutsDealt}–{s.blowoutsSuffered}</div>
          <div className="k">Blowouts (≥7)</div>
          <div className="s">{s.whitewashesDealt} whitewash{s.whitewashesDealt === 1 ? "" : "es"} dealt</div>
        </div>
        {!s.provisional && (
          <div className="tile">
            <div className="v num">{s.ratingGapToFirst <= 0.05 ? "Leader" : `-${s.ratingGapToFirst.toFixed(1)}`}</div>
            <div className="k">Gap to #1</div>
            <div className="s">rating points behind top</div>
          </div>
        )}
      </div>

      {/* rating history */}
      <div className="panel section-gap">
        <h3>Rating over time</h3>
        {chartData.length < 2 ? (
          <p style={{ color: "var(--muted)" }}>Play a game to start the line.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="rgba(239,245,252,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#8da4c0", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "rgba(239,245,252,0.2)" }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#8da4c0", fontSize: 11 }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#101d31", border: "1px solid rgba(239,245,252,0.3)", borderRadius: 8, fontSize: 12.5 }}
                labelStyle={{ color: "#8da4c0" }}
                formatter={(v, k) => [String(v), k === "rating" ? "Rating (μ−3σ)" : "Skill estimate (μ)"]}
              />
              <ReferenceLine y={0} stroke="rgba(239,245,252,0.25)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="mu" stroke="rgba(239,245,252,0.35)" strokeWidth={1.4} dot={false} strokeDasharray="5 4" />
              <Line type="monotone" dataKey="rating" stroke="#ffa31a" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* head to head */}
      <div className="panel section-gap" style={{ overflow: "auto" }}>
        <h3>Head to head</h3>
        {s.headToHead.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No other players yet.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Opponent</th>
                <th className="num">Record</th>
                <th className="num">Points</th>
                <th className="num">Avg win by</th>
                <th className="num">Net pts/game</th>
                <th>Last 5</th>
                <th style={{ width: 190 }}>Chance to win next game</th>
              </tr>
            </thead>
            <tbody>
              {[...s.headToHead].sort((a, b) => b.winProb - a.winProb).map((m) => {
                const opp = byId.get(m.opponentId);
                if (!opp) return null;
                return (
                  <tr key={m.opponentId} className="row-click" onClick={() => onOpenPlayer(m.opponentId)}>
                    <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar player={opp} size={24} /> {opp.name}
                    </td>
                    <td className="num">{m.wins}–{m.losses}</td>
                    <td className="num">{m.pointsFor}–{m.pointsAgainst}</td>
                    <td className="num">{m.avgMarginInWins !== null ? `+${m.avgMarginInWins.toFixed(1)}` : "—"}</td>
                    <td className="num" style={{ color: m.netAvgMargin == null ? undefined : m.netAvgMargin >= 0 ? "var(--green)" : "var(--red)" }}>
                      {m.netAvgMargin !== null ? `${m.netAvgMargin >= 0 ? "+" : ""}${m.netAvgMargin.toFixed(1)}` : "—"}
                    </td>
                    <td><FormDots form={m.lastResults} /></td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="num" style={{ width: 38, fontWeight: 600 }}>{pct(m.winProb)}</span>
                        <div style={{ flex: 1 }}><ProbBar p={m.winProb} /></div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* recent games */}
      <div className="panel section-gap" style={{ overflow: "auto" }}>
        <h3>Recent games</h3>
        {recent.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>Nothing yet — log the first one.</p>
        ) : (
          <table className="data">
            <thead>
              <tr><th>When</th><th>Result</th><th className="num">Score</th><th className="num">Rating Δ</th><th /></tr>
            </thead>
            <tbody>
              {recent.map((g) => {
                const won = g.winnerId === playerId;
                const oppId = won ? g.loserId : g.winnerId;
                const isA = g.aId === playerId;
                const delta = isA ? g.aAfter.exposed - g.aBefore.exposed : g.bAfter.exposed - g.bBefore.exposed;
                const mine = won ? g.winnerScore : g.loserScore;
                const theirs = won ? g.loserScore : g.winnerScore;
                return (
                  <tr key={g.id}>
                    <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(g.playedAt)}</td>
                    <td>
                      <span style={{ color: won ? "var(--ball)" : "var(--red)", fontWeight: 600 }}>{won ? "Won" : "Lost"}</span>
                      {" vs "}
                      <span className="row-click" onClick={() => onOpenPlayer(oppId)}>{nameOf(oppId)}</span>
                    </td>
                    <td className="scoreline num">{mine}–{theirs}</td>
                    <td className="num" style={{ color: delta >= 0 ? "var(--green)" : "var(--red)" }}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                    </td>
                    <td>
                      {won && g.winnerPreProb < 0.45 && <span className="pill upset">Upset</span>}{" "}
                      {g.isDeuce && <span className="pill deuce">Deuce</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
