/* The rating engine lives in the serverless API (api/_engine.ts), which runs
   openskill.js's Bradley-Terry model with margin-of-victory.
   This module just adapts the API payload into the shapes components use. */
import type { Game, LeagueStats, Player, PlayerStats, ProcessedGame } from "./types";

export interface ApiState {
  players: Player[];
  games: Game[];
  processedGames: ProcessedGame[];
  playerStats: Record<string, PlayerStats>;
  rankedIds: string[];
  league: LeagueStats;
  matchups: Record<string, Record<string, number>>;
  config: { model: string; margin: number; provisionalThreshold: number };
}

export interface EngineResult {
  processedGames: ProcessedGame[];
  playerStats: Map<string, PlayerStats>;
  ranked: PlayerStats[];
  league: LeagueStats;
  matchups: Record<string, Record<string, number>>;
}

export function toEngine(api: ApiState): EngineResult {
  const playerStats = new Map(Object.entries(api.playerStats));
  return {
    processedGames: api.processedGames,
    playerStats,
    ranked: api.rankedIds.map((id) => playerStats.get(id)!).filter(Boolean),
    league: api.league,
    matchups: api.matchups,
  };
}

/** Probability that `a` beats `b` given current ratings. */
export function matchupProbability(engine: EngineResult, aId: string, bId: string): number {
  return engine.matchups[aId]?.[bId] ?? 0.5;
}

export function playerById(players: Player[], id: string): Player | undefined {
  return players.find((p) => p.id === id);
}
