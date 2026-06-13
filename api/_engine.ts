/* Rating engine: replays the game log chronologically through openskill.js.
 *
 * TypeScript port of backend/engine.py. Model: Bradley-Terry (full pairing) with
 * margin-of-victory enabled (openskill's `bradleyTerryFull` + `score` + `margin`).
 * Scores are normalized to an 11-point scale before rating so that a 21-15 game and
 * an 11-8 game carry comparable margin information.
 *
 * Note vs. the old Python engine: openskill.js applies margin as an external,
 * monotonic multiplier on the rating delta (log1p(diff - margin)), whereas
 * openskill.py folded it into the win-probability term (log1p(diff / margin)).
 * Both make blowouts move ratings more; the JS form is monotonic, so it does NOT
 * exhibit the old "inverse blowout" quirk among upsets. Behavior is fundamentally
 * the same — conservative mu-3sigma leaderboard, margin-aware updates.
 */
import { predictDraw, predictWin, rate, rating } from "openskill";
import { bradleyTerryFull } from "openskill/models";
import type {
  Game,
  HeadToHead,
  LeagueStats,
  Player,
  PlayerStats,
  ProcessedGame,
  RatingSnapshot,
  Superlative,
} from "../src/types";
import type { ApiState } from "../src/engine";

export const PROVISIONAL_THRESHOLD = 5;
export const MARGIN = Number(process.env.MARGIN ?? "2.0");

type OSRating = { mu: number; sigma: number };
const RATE_OPTS = { model: bradleyTerryFull, margin: MARGIN } as const;

const snap = (r: OSRating): RatingSnapshot => ({
  mu: r.mu,
  sigma: r.sigma,
  exposed: r.mu - 3 * r.sigma,
});

/** Scale scores to an 11-point-equivalent so margins are comparable across game lengths. */
const normScores = (aScore: number, bScore: number, target: number): [number, number] => {
  const k = 11 / target;
  return [aScore * k, bScore * k];
};

const hist = (s: RatingSnapshot) => ({ exposed: s.exposed, mu: s.mu });

const avg = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

const winProb = (a: OSRating, b: OSRating): number => predictWin([[a], [b]])[0];

export function compute(players: Player[], games: Game[]): ApiState {
  const ratings = new Map<string, OSRating>(players.map((p) => [p.id, rating()]));
  const history = new Map<string, PlayerStats["ratingHistory"]>(
    players.map((p) => [
      p.id,
      [{ gameIndex: 0, playedAt: p.createdAt, ...hist(snap(ratings.get(p.id)!)) }],
    ]),
  );

  const processed: ProcessedGame[] = [];
  const ordered = [...games].sort((x, y) => x.playedAt - y.playedAt);
  ordered.forEach((g, idx) => {
    const ra = ratings.get(g.aId);
    const rb = ratings.get(g.bId);
    if (!ra || !rb) return;

    const aWon = g.aScore > g.bScore;
    const winnerId = aWon ? g.aId : g.bId;
    const loserId = aWon ? g.bId : g.aId;
    const winnerR = aWon ? ra : rb;
    const loserR = aWon ? rb : ra;

    const winnerPreProb = winProb(winnerR, loserR);
    const aBefore = snap(ra);
    const bBefore = snap(rb);

    const winScore = Math.max(g.aScore, g.bScore);
    const loseScore = Math.min(g.aScore, g.bScore);
    const [[newWinner], [newLoser]] = rate([[winnerR], [loserR]], {
      ...RATE_OPTS,
      score: normScores(winScore, loseScore, g.target),
    });
    ratings.set(winnerId, newWinner);
    ratings.set(loserId, newLoser);

    const aAfter = snap(ratings.get(g.aId)!);
    const bAfter = snap(ratings.get(g.bId)!);
    processed.push({
      ...g,
      winnerId,
      loserId,
      winnerScore: winScore,
      loserScore: loseScore,
      margin: winScore - loseScore,
      isDeuce: winScore > g.target,
      winnerPreProb,
      aBefore,
      bBefore,
      aAfter,
      bAfter,
    });
    history.get(g.aId)!.push({ gameIndex: idx + 1, playedAt: g.playedAt, ...hist(aAfter) });
    history.get(g.bId)!.push({ gameIndex: idx + 1, playedAt: g.playedAt, ...hist(bAfter) });
  });

  const playerStats: Record<string, PlayerStats> = {};
  for (const p of players) {
    playerStats[p.id] = computePlayerStats(p, processed, ratings, history, players);
  }

  const ranked = Object.values(playerStats).sort(
    (a, b) =>
      Number(a.provisional) - Number(b.provisional) || b.rating.exposed - a.rating.exposed,
  );
  ranked.forEach((s, i) => {
    s.rank = i + 1;
    const h = s.ratingHistory;
    if (h.length > 5) {
      const past = h[h.length - 6].exposed;
      const now = s.rating.exposed;
      s.rankDelta = Math.abs(now - past) < 0.05 ? 0 : now > past ? 1 : -1;
    }
  });

  const matchups: Record<string, Record<string, number>> = {};
  for (const a of players) {
    matchups[a.id] = {};
    for (const b of players) {
      if (b.id === a.id) continue;
      matchups[a.id][b.id] = winProb(ratings.get(a.id)!, ratings.get(b.id)!);
    }
  }

  return {
    players,
    games,
    processedGames: processed,
    playerStats,
    rankedIds: ranked.map((s) => s.player.id),
    league: leagueStats(processed, ranked, players, ratings, matchups),
    matchups,
    config: { model: "BradleyTerryFull", margin: MARGIN, provisionalThreshold: PROVISIONAL_THRESHOLD },
  };
}

/** Pick the element with the maximum (key[0], key[1]) tuple, like Python's max(..., key=). */
function maxBy<T>(xs: T[], key: (x: T) => [number, number]): T | null {
  let best: T | null = null;
  let bestKey: [number, number] | null = null;
  for (const x of xs) {
    const k = key(x);
    if (!bestKey || k[0] > bestKey[0] || (k[0] === bestKey[0] && k[1] > bestKey[1])) {
      best = x;
      bestKey = k;
    }
  }
  return best;
}

/** Population standard deviation (0 for fewer than 2 values). */
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/** The player at the extreme of a metric (dir 1 = max, -1 = min), as a Superlative. */
function topSuperlative(
  list: PlayerStats[],
  metric: (s: PlayerStats) => number,
  dir: 1 | -1,
): Superlative | null {
  if (!list.length) return null;
  let best = list[0];
  for (const s of list) if (metric(s) * dir > metric(best) * dir) best = s;
  return { player: best.player, value: metric(best) };
}

function computePlayerStats(
  p: Player,
  processed: ProcessedGame[],
  ratings: Map<string, OSRating>,
  history: Map<string, PlayerStats["ratingHistory"]>,
  players: Player[],
): PlayerStats {
  const pid = p.id;
  const mine = processed.filter((g) => g.aId === pid || g.bId === pid);
  const wins = mine.filter((g) => g.winnerId === pid);
  const losses = mine.filter((g) => g.loserId === pid);

  const pointsFor = mine.reduce((acc, g) => acc + (g.aId === pid ? g.aScore : g.bScore), 0);
  const pointsAgainst = mine.reduce((acc, g) => acc + (g.aId === pid ? g.bScore : g.aScore), 0);

  let currentStreak: PlayerStats["currentStreak"] = null;
  let longestW = 0;
  let longestL = 0;
  let runKind: "W" | "L" | null = null;
  let runLen = 0;
  for (const g of mine) {
    const kind: "W" | "L" = g.winnerId === pid ? "W" : "L";
    runLen = kind === runKind ? runLen + 1 : 1;
    runKind = kind;
    if (kind === "W") longestW = Math.max(longestW, runLen);
    else longestL = Math.max(longestL, runLen);
  }
  if (runKind) currentStreak = { kind: runKind, length: runLen };

  const biggestWin = maxBy(wins, (g) => [g.margin, g.winnerScore]);
  const biggestLoss = maxBy(losses, (g) => [g.margin, g.winnerScore]);
  const deuce = mine.filter((g) => g.isDeuce);

  const h2h: HeadToHead[] = [];
  for (const opp of players) {
    const oid = opp.id;
    if (oid === pid) continue;
    const vs = mine.filter((g) => g.aId === oid || g.bId === oid);
    const w = vs.filter((g) => g.winnerId === pid);
    const l = vs.filter((g) => g.loserId === pid);
    const pf = vs.reduce((acc, g) => acc + (g.aId === pid ? g.aScore : g.bScore), 0);
    const pa = vs.reduce((acc, g) => acc + (g.aId === pid ? g.bScore : g.aScore), 0);
    h2h.push({
      opponentId: oid,
      wins: w.length,
      losses: l.length,
      pointsFor: pf,
      pointsAgainst: pa,
      winProb: winProb(ratings.get(pid)!, ratings.get(oid)!),
      avgMarginInWins: avg(w.map((g) => g.margin)),
      avgMarginInLosses: avg(l.map((g) => g.margin)),
      netAvgMargin: vs.length ? (pf - pa) / vs.length : null,
      lastResults: vs.slice(-5).map((g) => (g.winnerId === pid ? "W" : "L")),
    });
  }

  const contested = h2h.filter((m) => m.wins + m.losses >= 2);
  const byWinPct = [...contested].sort(
    (a, b) => a.wins / (a.wins + a.losses) - b.wins / (b.wins + b.losses),
  );
  const nemesis = byWinPct.length ? byWinPct[0] : null;
  const bestMatchup = byWinPct.length ? byWinPct[byWinPct.length - 1] : null;

  const hist = history.get(pid)!;
  const r = snap(ratings.get(pid)!);

  // Pre-game rating context per game, from this player's perspective.
  const ownBefore = (g: ProcessedGame) => (g.aId === pid ? g.aBefore.exposed : g.bBefore.exposed);
  const oppBefore = (g: ProcessedGame) => (g.aId === pid ? g.bBefore.exposed : g.aBefore.exposed);
  const oppIdOf = (g: ProcessedGame) => (g.aId === pid ? g.bId : g.aId);
  const exposedNow = (id: string) => {
    const rr = ratings.get(id);
    return rr ? rr.mu - 3 * rr.sigma : 0;
  };

  const expectedWins = mine.reduce(
    (acc, g) => acc + (g.winnerId === pid ? g.winnerPreProb : 1 - g.winnerPreProb),
    0,
  );

  const vsStronger = { wins: 0, losses: 0 };
  const vsWeaker = { wins: 0, losses: 0 };
  for (const g of mine) {
    const bucket = oppBefore(g) > ownBefore(g) ? vsStronger : vsWeaker;
    if (g.winnerId === pid) bucket.wins++;
    else bucket.losses++;
  }

  const closeMine = mine.filter((g) => g.margin <= 2);
  const recentN = Math.min(10, mine.length);
  const momentumK = Math.min(5, mine.length);

  const muDeltas: number[] = [];
  for (let i = 1; i < hist.length; i++) muDeltas.push(hist[i].mu - hist[i - 1].mu);

  // Recency-weighted exposed rating (EWMA over post-game snapshots).
  const postExposed = hist.slice(1).map((e) => e.exposed);
  const formExposed = postExposed.length
    ? postExposed.reduce((ewma, v, i) => (i === 0 ? v : 0.4 * v + 0.6 * ewma), 0)
    : r.exposed;

  const peakRating = Math.max(...hist.map((e) => e.exposed));
  const upsetsPulled = wins.filter((g) => g.winnerPreProb < 0.5).length;
  const mostPlayed = h2h.reduce<HeadToHead | null>(
    (best, m) => (best && best.wins + best.losses >= m.wins + m.losses ? best : m),
    null,
  );

  return {
    player: p,
    rating: r,
    rank: 0,
    provisional: mine.length < PROVISIONAL_THRESHOLD,
    games: mine.length,
    wins: wins.length,
    losses: losses.length,
    winRate: mine.length ? wins.length / mine.length : 0,
    currentStreak,
    longestWinStreak: longestW,
    longestLossStreak: longestL,
    pointsFor,
    pointsAgainst,
    pointDiff: pointsFor - pointsAgainst,
    avgPointsFor: mine.length ? pointsFor / mine.length : 0,
    avgPointsAgainst: mine.length ? pointsAgainst / mine.length : 0,
    avgMarginInWins: avg(wins.map((g) => g.margin)),
    avgMarginInLosses: avg(losses.map((g) => g.margin)),
    biggestWin,
    biggestLoss,
    deuceGames: deuce.length,
    deuceRecord: {
      wins: deuce.filter((g) => g.winnerId === pid).length,
      losses: deuce.filter((g) => g.loserId === pid).length,
    },
    recordBy11: {
      wins: wins.filter((g) => g.target === 11).length,
      losses: losses.filter((g) => g.target === 11).length,
    },
    recordBy21: {
      wins: wins.filter((g) => g.target === 21).length,
      losses: losses.filter((g) => g.target === 21).length,
    },
    upsetsPulled,
    upsetsSuffered: losses.filter((g) => 1 - g.winnerPreProb < 0.5).length,
    peakRating,
    form: mine.slice(-10).map((g) => (g.winnerId === pid ? "W" : "L")),
    ratingHistory: hist,
    headToHead: h2h,
    nemesis,
    bestMatchup,
    rankDelta: null,

    ratingPlusMinus: 2 * r.sigma,
    volatility: stddev(muDeltas),
    expectedWins,
    winsAboveExpectation: wins.length - expectedWins,
    expectedWinRate: mine.length ? expectedWins / mine.length : 0,
    clutchWinRate: deuce.length
      ? deuce.filter((g) => g.winnerId === pid).length / deuce.length
      : null,
    closeGameRecord: {
      wins: closeMine.filter((g) => g.winnerId === pid).length,
      losses: closeMine.filter((g) => g.loserId === pid).length,
    },
    vsStronger,
    vsWeaker,
    strengthOfSchedule: mine.length
      ? mine.reduce((acc, g) => acc + exposedNow(oppIdOf(g)), 0) / mine.length
      : null,
    momentum: mine.length ? r.exposed - hist[hist.length - 1 - momentumK].exposed : 0,
    recentWinRate: recentN
      ? mine.slice(-recentN).filter((g) => g.winnerId === pid).length / recentN
      : null,
    formExposed,
    bestWinByRating: maxBy(wins, (g) => [oppBefore(g) - ownBefore(g), g.margin]),
    worstLossByRating: maxBy(losses, (g) => [-(oppBefore(g) - ownBefore(g)), g.margin]),
    pointWinRate: pointsFor + pointsAgainst > 0 ? pointsFor / (pointsFor + pointsAgainst) : 0,
    upsetRate: mine.length ? upsetsPulled / mine.length : 0,
    ratingFromPeak: r.exposed - peakRating,
    mostPlayedOpponentId:
      mostPlayed && mostPlayed.wins + mostPlayed.losses > 0 ? mostPlayed.opponentId : null,
    lastPlayedAt: mine.length ? Math.max(...mine.map((g) => g.playedAt)) : null,
  };
}

function leagueStats(
  processed: ProcessedGame[],
  ranked: PlayerStats[],
  players: Player[],
  ratings: Map<string, OSRating>,
  matchups: Record<string, Record<string, number>>,
): LeagueStats {
  const byId = new Map(players.map((p) => [p.id, p]));
  const byUpset = [...processed].sort((a, b) => a.winnerPreProb - b.winnerPreProb);
  const byMargin = [...processed].sort(
    (a, b) => a.margin - b.margin || b.winnerScore - a.winnerScore,
  );
  const byBlowout = [...processed].sort((a, b) => b.margin - a.margin);
  const biggestUpsets = byUpset.filter((g) => g.winnerPreProb < 0.5).slice(0, 5);

  let longestActive: LeagueStats["longestActiveStreak"] = null;
  for (const s of ranked) {
    const cs = s.currentStreak;
    if (cs && cs.kind === "W") {
      if (longestActive === null || cs.length > longestActive.length) {
        longestActive = { player: s.player, length: cs.length };
      }
    }
  }

  let mostActive: PlayerStats | null = null;
  for (const s of ranked) {
    if (mostActive === null || s.games > mostActive.games) mostActive = s;
  }

  // Player superlatives (derived from the per-player stats).
  const played2 = ranked.filter((s) => s.games >= 2);
  const played3 = ranked.filter((s) => s.games >= 3);
  const clutchEligible = ranked.filter((s) => s.deuceGames >= 2 && s.clutchWinRate !== null);
  const improved = topSuperlative(played2, (s) => s.momentum, 1);
  const topUpset = biggestUpsets[0];

  // Rivalries: frequent, evenly-split, tight pairings.
  const pairs = new Map<
    string,
    { aId: string; bId: string; games: number; aWins: number; bWins: number; marginSum: number }
  >();
  for (const g of processed) {
    const [x, y] = g.aId < g.bId ? [g.aId, g.bId] : [g.bId, g.aId];
    const key = `${x}|${y}`;
    let e = pairs.get(key);
    if (!e) {
      e = { aId: x, bId: y, games: 0, aWins: 0, bWins: 0, marginSum: 0 };
      pairs.set(key, e);
    }
    e.games++;
    e.marginSum += g.margin;
    if (g.winnerId === x) e.aWins++;
    else e.bWins++;
  }
  const rivalries = [...pairs.values()]
    .filter((e) => e.games >= 3 && byId.has(e.aId) && byId.has(e.bId))
    .map((e) => {
      const evenness = 1 - Math.abs(e.aWins - e.bWins) / e.games;
      const avgMargin = e.marginSum / e.games;
      return {
        aId: e.aId,
        bId: e.bId,
        games: e.games,
        aWins: e.aWins,
        bWins: e.bWins,
        avgMargin,
        closeness: evenness * (1 / (1 + avgMargin)),
      };
    })
    .sort((p, q) => q.closeness * q.games - p.closeness * p.games)
    .slice(0, 4);

  // Fairest matches: most balanced pairings among players who've played.
  const statById = new Map(ranked.map((s) => [s.player.id, s]));
  const eligible = players.filter((p) => (statById.get(p.id)?.games ?? 0) >= 1);
  const fairestMatches: LeagueStats["fairestMatches"] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      const ra = ratings.get(a.id);
      const rb = ratings.get(b.id);
      if (!ra || !rb) continue;
      const winProbA = matchups[a.id]?.[b.id] ?? 0.5;
      fairestMatches.push({
        aId: a.id,
        bId: b.id,
        winProbA,
        quality: 1 - 2 * Math.abs(winProbA - 0.5),
        drawProbability: predictDraw([[ra], [rb]]),
      });
    }
  }
  fairestMatches.sort((x, y) => y.quality - x.quality);

  return {
    totalGames: processed.length,
    totalPoints: processed.reduce((acc, g) => acc + g.aScore + g.bScore, 0),
    deuceGames: processed.filter((g) => g.isDeuce).length,
    gamesTo11: processed.filter((g) => g.target === 11).length,
    gamesTo21: processed.filter((g) => g.target === 21).length,
    avgMargin: processed.length
      ? processed.reduce((acc, g) => acc + g.margin, 0) / processed.length
      : 0,
    biggestUpsets,
    closestGames: byMargin.slice(0, 5),
    mostLopsided: byBlowout.slice(0, 5),
    longestActiveStreak: longestActive,
    mostActive: mostActive ? { player: mostActive.player, games: mostActive.games } : null,
    mostImproved: improved && improved.value > 0 ? improved : null,
    giantSlayer:
      topUpset && byId.has(topUpset.winnerId)
        ? { player: byId.get(topUpset.winnerId)!, game: topUpset }
        : null,
    mostClutch: topSuperlative(clutchEligible, (s) => s.clutchWinRate ?? 0, 1),
    steadiest: topSuperlative(played3, (s) => s.volatility, -1),
    streakiest: topSuperlative(played3, (s) => s.volatility, 1),
    overachiever: topSuperlative(played3, (s) => s.winsAboveExpectation, 1),
    underachiever: topSuperlative(played3, (s) => s.winsAboveExpectation, -1),
    rivalries,
    fairestMatches: fairestMatches.slice(0, 4),
  };
}
