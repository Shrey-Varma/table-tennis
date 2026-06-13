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
