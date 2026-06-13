export interface Player {
  id: string;
  name: string;
  color: string; // accent hue used in charts & avatars
  createdAt: number;
}

export interface Game {
  id: string;
  playedAt: number; // ms epoch
  aId: string;
  bId: string;
  aScore: number;
  bScore: number;
  target: 11 | 21;
}

export interface LeagueData {
  players: Player[];
  games: Game[]; // stored in insertion order; replayed chronologically
}

/** A game enriched with rating context at the moment it was played. */
export interface ProcessedGame extends Game {
  winnerId: string;
  loserId: string;
  winnerScore: number;
  loserScore: number;
  margin: number;
  isDeuce: boolean; // went past the target score
  /** Pre-game probability (per TrueSkill) that the eventual winner would win. */
  winnerPreProb: number;
  /** Rating (conservative) of each player before and after this game. */
  aBefore: RatingSnapshot;
  bBefore: RatingSnapshot;
  aAfter: RatingSnapshot;
  bAfter: RatingSnapshot;
}

export interface RatingSnapshot {
  mu: number;
  sigma: number;
  exposed: number; // mu - 3*sigma, the leaderboard value
}

export interface HeadToHead {
  opponentId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  /** TrueSkill probability of beating this opponent right now. */
  winProb: number;
  avgMarginInWins: number | null;
  avgMarginInLosses: number | null;
  /** Avg of (my points − their points) across all games vs them. >0 = dominant. */
  netAvgMargin: number | null;
  lastResults: ("W" | "L")[]; // most recent last
}

export interface PlayerStats {
  player: Player;
  rating: RatingSnapshot;
  rank: number; // 1-based among ranked players; provisional players still get one
  provisional: boolean;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: { kind: "W" | "L"; length: number } | null;
  longestWinStreak: number;
  longestLossStreak: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  avgPointsFor: number;
  avgPointsAgainst: number;
  avgMarginInWins: number | null;
  avgMarginInLosses: number | null;
  biggestWin: ProcessedGame | null;
  biggestLoss: ProcessedGame | null;
  deuceGames: number;
  deuceRecord: { wins: number; losses: number };
  recordBy11: { wins: number; losses: number };
  recordBy21: { wins: number; losses: number };
  upsetsPulled: number; // won with pre-game prob < 0.5
  upsetsSuffered: number;
  peakRating: number;
  form: ("W" | "L")[]; // last 10, most recent last
  ratingHistory: { gameIndex: number; playedAt: number; exposed: number; mu: number }[];
  headToHead: HeadToHead[];
  nemesis: HeadToHead | null; // worst win% against (min 2 games)
  bestMatchup: HeadToHead | null;
  rankDelta: number | null; // movement vs. 5 games ago, null if not enough data

  // --- Rating quality / confidence ---
  /** ±half-width of the skill estimate (2σ). Big = still settling. */
  ratingPlusMinus: number;
  /** Std-dev of game-to-game μ swings. High = streaky, low = metronomic. */
  volatility: number;

  // --- Performance vs. expectation ---
  /** Sum of this player's own pre-game win probabilities across their games. */
  expectedWins: number;
  /** actual wins − expectedWins. Positive = over-performing their rating. */
  winsAboveExpectation: number;
  /** expectedWins / games — how often they'd be expected to win given who they played. */
  expectedWinRate: number;

  // --- Clutch / close games ---
  /** Win rate in deuce (past-target) games; null if none. */
  clutchWinRate: number | null;
  /** Record in games decided by ≤ 2 points. */
  closeGameRecord: { wins: number; losses: number };

  // --- Record by opponent strength (pre-game rating) ---
  vsStronger: { wins: number; losses: number };
  vsWeaker: { wins: number; losses: number };
  /** Average current rating of opponents faced. null if no games. */
  strengthOfSchedule: number | null;

  // --- Momentum / form ---
  /** Exposed-rating change over the last (≤5) games. */
  momentum: number;
  /** Win rate over the last (≤10) games; null if none. */
  recentWinRate: number | null;
  /** Recency-weighted exposed rating (EWMA) — current "form" vs career standing. */
  formExposed: number;

  // --- Signature games (by opponent rating) ---
  /** Win against the highest-rated opponent relative to self. */
  bestWinByRating: ProcessedGame | null;
  /** Loss to the lowest-rated opponent relative to self. */
  worstLossByRating: ProcessedGame | null;

  // --- Misc ---
  /** Share of total points won: pointsFor / (pointsFor + pointsAgainst). */
  pointWinRate: number;
  /** upsetsPulled / games. */
  upsetRate: number;
  /** exposed − peakRating (≤ 0). How far off their best. */
  ratingFromPeak: number;
  mostPlayedOpponentId: string | null;
  lastPlayedAt: number | null;

  // --- Quality of competition ---
  /** Avg current rating of opponents this player has beaten; null if no wins. */
  avgOpponentRatingInWins: number | null;
  /** Avg current rating of opponents this player has lost to; null if no losses. */
  avgOpponentRatingInLosses: number | null;
  /** Rating points behind the #1 player (0 if they are #1). */
  ratingGapToFirst: number;

  // --- Blowouts ---
  blowoutsDealt: number; // wins by ≥7
  blowoutsSuffered: number; // losses by ≥7
  whitewashesDealt: number; // wins where opponent scored ≤1
  whitewashesSuffered: number; // losses where this player scored ≤1
}

/** A league award: a player plus the metric value that earned it. */
export interface Superlative {
  player: Player;
  value: number;
  detail?: string;
}

/** A close, frequently-played, evenly-split pairing. */
export interface Rivalry {
  aId: string;
  bId: string;
  games: number;
  aWins: number;
  bWins: number;
  avgMargin: number; // average absolute point margin (tightness)
  closeness: number; // 0..1 — evenness × tightness
}

/** A suggested pairing, ranked by how balanced it would be. */
export interface MatchSuggestion {
  aId: string;
  bId: string;
  winProbA: number; // P(a beats b)
  quality: number; // 0..1 closeness, 1 = a perfect coin-flip
  drawProbability: number; // model's predicted draw likelihood
}

export interface LeagueStats {
  totalGames: number;
  totalPoints: number;
  deuceGames: number;
  gamesTo11: number;
  gamesTo21: number;
  avgMargin: number;
  biggestUpsets: ProcessedGame[]; // lowest winnerPreProb first
  closestGames: ProcessedGame[];
  mostLopsided: ProcessedGame[];
  longestActiveStreak: { player: Player; length: number } | null;
  mostActive: { player: Player; games: number } | null;

  // --- Player superlatives (derived from per-player stats) ---
  mostImproved: Superlative | null; // biggest exposed gain over last ≤5 games
  giantSlayer: { player: Player; game: ProcessedGame } | null; // pulled the biggest upset
  mostClutch: Superlative | null; // best deuce win rate (≥2 deuce games)
  steadiest: Superlative | null; // lowest rating volatility (≥3 games)
  streakiest: Superlative | null; // highest rating volatility (≥3 games)
  overachiever: Superlative | null; // most wins above expectation (≥3 games)
  underachiever: Superlative | null; // most wins below expectation (≥3 games)

  // --- Pairings ---
  rivalries: Rivalry[]; // closest, most-contested matchups
  fairestMatches: MatchSuggestion[]; // most balanced pairings to schedule next

  mostFeared: Superlative | null; // highest average win probability across the field
  /** Std-dev of ratings across active players. Lower = tighter, more competitive league. */
  ratingSpread: number;
}

export const PROVISIONAL_THRESHOLD = 5;
