/* Behavioral tests for the rating engine: we don't require bit-parity with the
 * old Python engine, only that the leaderboard moves make sense in relation to
 * the games played — winning helps, bigger wins help more, beating stronger
 * opponents helps more, win probabilities are coherent, etc. */
import { describe, expect, it } from "vitest";
import { compute } from "../api/_engine";
import type { Game, Player } from "../src/types";

const player = (id: string, createdAt: number): Player => ({
  id,
  name: id,
  color: "#888888",
  createdAt,
});

let gc = 0;
const game = (
  aId: string,
  bId: string,
  aScore: number,
  bScore: number,
  target: 11 | 21 = 11,
): Game => ({ id: `g${gc++}`, playedAt: gc, aId, bId, aScore, bScore, target });

const freshPair = (): Player[] => [player("a", 1), player("b", 2)];
/** Winner's exposed-rating gain from a single fresh game (initial exposed is 0). */
const winnerGain = (aScore: number, bScore: number, target: 11 | 21 = 11): number =>
  compute(freshPair(), [game("a", "b", aScore, bScore, target)]).playerStats.a.rating.exposed;

/** Deterministic, skill-weighted 40-game season among 5 players. */
function season() {
  const names = ["P0", "P1", "P2", "P3", "P4"];
  const skill = [0.9, 0.7, 0.5, 0.4, 0.25];
  const players = names.map((n, i) => player(n, 100 + i));
  const games: Game[] = [];
  let seed = 42;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = () => Math.floor(rand() * 5);
  for (let n = 0; n < 40; n++) {
    const a = pick();
    let b = pick();
    while (b === a) b = pick();
    const target: 11 | 21 = rand() < 0.8 ? 11 : 21;
    const aWins = rand() < skill[a] / (skill[a] + skill[b]);
    const win = target;
    const lose = Math.floor(rand() * (target - 1));
    games.push(
      game(names[a], names[b], aWins ? win : lose, aWins ? lose : win, target),
    );
  }
  return { players, games };
}

describe("rating engine behavior", () => {
  it("is deterministic: same log -> same standings", () => {
    const { players, games } = season();
    const a = compute(players, games);
    const b = compute(players, games);
    expect(a.rankedIds).toEqual(b.rankedIds);
    for (const id of a.rankedIds) {
      expect(b.playerStats[id].rating.exposed).toBe(a.playerStats[id].rating.exposed);
    }
  });

  it("winning raises your rating and losing lowers it", () => {
    const g = compute(freshPair(), [game("a", "b", 11, 5)]).processedGames[0];
    expect(g.aAfter.exposed).toBeGreaterThan(g.aBefore.exposed); // winner up
    expect(g.bAfter.exposed).toBeLessThan(g.bBefore.exposed); // loser down
  });

  it("a bigger victory margin moves ratings more", () => {
    expect(winnerGain(11, 2)).toBeGreaterThan(winnerGain(11, 9));
  });

  it("normalizes game length: a 21-15 ≈ an 11-8 in margin signal", () => {
    // 21-15 normalizes to ~11-7.86 (diff 3.14) vs 11-8 (diff 3.0): comparable,
    // not identical. Without normalization the raw diffs (6 vs 3) would diverge wildly.
    const a = winnerGain(21, 15, 21);
    const b = winnerGain(11, 8);
    expect(Math.abs(a - b) / b).toBeLessThan(0.1); // within 10% of each other
  });

  it("beating a stronger opponent is worth more than beating a weaker one", () => {
    // Warm up: S becomes strong, W becomes weak; then a fresh C beats one of them.
    const gainBeating = (target: "S" | "W"): number => {
      const players = [player("S", 1), player("W", 2), player("F", 3), player("C", 4)];
      const games: Game[] = [];
      for (let i = 0; i < 6; i++) games.push(game("S", "F", 11, 3));
      for (let i = 0; i < 6; i++) games.push(game("F", "W", 11, 3));
      games.push(game("C", target, 11, 5)); // C is fresh in both variants
      return compute(players, games).playerStats.C.rating.exposed;
    };
    expect(gainBeating("S")).toBeGreaterThan(gainBeating("W"));
  });

  it("a player who wins everything outranks one who loses everything", () => {
    const players = [player("X", 1), player("Y", 2), player("Z", 3)];
    const games: Game[] = [];
    for (let i = 0; i < 6; i++) {
      games.push(game("X", "Y", 11, 4));
      games.push(game("X", "Z", 11, 4));
      games.push(game("Y", "Z", 11, 7));
    }
    const st = compute(players, games);
    expect(st.rankedIds[0]).toBe("X");
    expect(st.rankedIds[2]).toBe("Z");
  });

  it("the first game between fresh players is a coin flip", () => {
    const st = compute(freshPair(), [game("a", "b", 11, 5)]);
    expect(st.processedGames[0].winnerPreProb).toBeCloseTo(0.5, 10);
  });

  it("produces valid, complementary win probabilities", () => {
    const { players, games } = season();
    const st = compute(players, games);
    for (const a of players) {
      for (const b of players) {
        if (a.id === b.id) continue;
        const p = st.matchups[a.id][b.id];
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
        expect(p + st.matchups[b.id][a.id]).toBeCloseTo(1, 9);
      }
    }
  });

  it("flags <5-game players as provisional and ranks them below the field", () => {
    const players = [player("vet1", 1), player("vet2", 2), player("rookie", 3)];
    const games: Game[] = [];
    for (let i = 0; i < 5; i++) games.push(game("vet1", "vet2", 11, i + 1)); // both reach 5 games
    games.push(game("vet1", "rookie", 11, 6)); // rookie has 1 game
    const st = compute(players, games);
    expect(st.playerStats.rookie.provisional).toBe(true);
    expect(st.playerStats.vet1.provisional).toBe(false);
    expect(st.rankedIds[st.rankedIds.length - 1]).toBe("rookie"); // provisional sorts last
  });

  it("handles deuce and 21-point games without error", () => {
    const players = freshPair();
    const st = compute(players, [
      game("a", "b", 13, 11), // deuce
      game("a", "b", 21, 18, 21), // 21-point
    ]);
    expect(st.processedGames[0].isDeuce).toBe(true);
    expect(st.processedGames[1].target).toBe(21);
    expect(st.processedGames[1].isDeuce).toBe(false);
  });
});

describe("rating-quality & performance stats", () => {
  it("ratingPlusMinus is 2σ", () => {
    const { players, games } = season();
    const st = compute(players, games);
    for (const p of players) {
      const s = st.playerStats[p.id];
      expect(s.ratingPlusMinus).toBeCloseTo(2 * s.rating.sigma, 9);
    }
  });

  it("expected wins are conserved: Σ winsAboveExpectation ≈ 0", () => {
    const { players, games } = season();
    const st = compute(players, games);
    const total = Object.values(st.playerStats).reduce((a, s) => a + s.winsAboveExpectation, 0);
    expect(Math.abs(total)).toBeLessThan(1e-6);
  });

  it("stronger/weaker buckets partition each player's games", () => {
    const { players, games } = season();
    const st = compute(players, games);
    for (const p of players) {
      const s = st.playerStats[p.id];
      const bucketed =
        s.vsStronger.wins + s.vsStronger.losses + s.vsWeaker.wins + s.vsWeaker.losses;
      expect(bucketed).toBe(s.games);
    }
  });

  it("momentum is positive on a win streak, negative on a losing streak", () => {
    const st = compute(
      [player("X", 1), player("Y", 2)],
      Array.from({ length: 6 }, () => game("X", "Y", 11, 5)),
    );
    expect(st.playerStats.X.momentum).toBeGreaterThan(0);
    expect(st.playerStats.Y.momentum).toBeLessThan(0);
  });

  it("clutch win rate matches the deuce record, and is null without deuce games", () => {
    const clutch = compute(
      [player("A", 1), player("B", 2)],
      [game("A", "B", 13, 11), game("A", "B", 11, 9)],
    ).playerStats.A;
    expect(clutch.deuceGames).toBe(1);
    expect(clutch.clutchWinRate).toBeCloseTo(
      clutch.deuceRecord.wins / (clutch.deuceRecord.wins + clutch.deuceRecord.losses),
      9,
    );
    const noDeuce = compute([player("A", 1), player("B", 2)], [game("A", "B", 11, 5)]).playerStats.A;
    expect(noDeuce.clutchWinRate).toBeNull();
  });

  it("head-to-head netAvgMargin is equal and opposite for the two sides", () => {
    const st = compute(
      [player("X", 1), player("Y", 2)],
      [game("X", "Y", 11, 2), game("X", "Y", 11, 3), game("Y", "X", 11, 9)],
    );
    const xVsY = st.playerStats.X.headToHead.find((h) => h.opponentId === "Y")!;
    const yVsX = st.playerStats.Y.headToHead.find((h) => h.opponentId === "X")!;
    expect(xVsY.netAvgMargin!).toBeGreaterThan(0);
    expect(xVsY.netAvgMargin!).toBeCloseTo(-yVsX.netAvgMargin!, 9);
  });
});

describe("league superlatives & pairings", () => {
  it("crowns the biggest upset's winner as giant slayer", () => {
    const games: Game[] = [];
    for (let i = 0; i < 6; i++) games.push(game("S", "F", 11, 2)); // S strong
    for (let i = 0; i < 6; i++) games.push(game("F", "W", 11, 2)); // W weak
    games.push(game("W", "S", 11, 7)); // weak beats strong = upset
    const st = compute([player("S", 1), player("F", 2), player("W", 3)], games);
    expect(st.league.giantSlayer).not.toBeNull();
    expect(st.league.giantSlayer!.player.id).toBe("W");
  });

  it("ranks an even, tight, frequent pairing as the top rivalry", () => {
    const games: Game[] = [
      game("R1", "R2", 11, 9),
      game("R2", "R1", 11, 9),
      game("R1", "R2", 13, 11),
      game("R2", "R1", 11, 9), // R1/R2: 2-2, tight
      game("D1", "D2", 11, 1),
      game("D1", "D2", 11, 2),
      game("D1", "D2", 11, 0), // D1/D2: 3-0, blowouts
    ];
    const players = [player("R1", 1), player("R2", 2), player("D1", 3), player("D2", 4)];
    const riv = compute(players, games).league.rivalries;
    expect(riv.length).toBeGreaterThan(0);
    const key = [riv[0].aId, riv[0].bId].sort().join("|");
    expect(key).toBe("R1|R2");
  });

  it("suggests fairest matches sorted by balance, each a valid probability", () => {
    const { players, games } = season();
    const fm = compute(players, games).league.fairestMatches;
    expect(fm.length).toBeGreaterThan(0);
    for (let i = 1; i < fm.length; i++) {
      expect(fm[i - 1].quality).toBeGreaterThanOrEqual(fm[i].quality);
    }
    expect(fm[0].quality).toBeGreaterThanOrEqual(0);
    expect(fm[0].quality).toBeLessThanOrEqual(1);
    expect(fm[0].winProbA).toBeGreaterThan(0);
    expect(fm[0].winProbA).toBeLessThan(1);
  });
});

describe("quality, blowouts, parity", () => {
  it("counts blowouts and whitewashes, and tracks quality of wins", () => {
    const st = compute(
      [player("A", 1), player("B", 2)],
      [game("A", "B", 11, 1), game("A", "B", 11, 0)],
    );
    expect(st.playerStats.A.blowoutsDealt).toBe(2); // both margins ≥7
    expect(st.playerStats.A.whitewashesDealt).toBe(2); // opponent scored ≤1
    expect(st.playerStats.B.blowoutsSuffered).toBe(2);
    expect(st.playerStats.B.whitewashesSuffered).toBe(2);
    expect(st.playerStats.A.avgOpponentRatingInWins).not.toBeNull();
    expect(st.playerStats.A.avgOpponentRatingInLosses).toBeNull(); // A never lost
  });

  it("computes gap to #1, most feared, and a positive rating spread", () => {
    const players = [player("X", 1), player("Y", 2), player("Z", 3)];
    const games: Game[] = [];
    for (let i = 0; i < 6; i++) {
      games.push(game("X", "Y", 11, 4));
      games.push(game("X", "Z", 11, 4));
      games.push(game("Y", "Z", 11, 7));
    }
    const st = compute(players, games);
    const leader = st.rankedIds[0];
    expect(leader).toBe("X");
    expect(st.playerStats[leader].ratingGapToFirst).toBeCloseTo(0, 6);
    for (const id of st.rankedIds.slice(1)) {
      expect(st.playerStats[id].ratingGapToFirst).toBeGreaterThan(0);
    }
    expect(st.league.mostFeared?.player.id).toBe("X");
    expect(st.league.ratingSpread).toBeGreaterThan(0);
  });
});
