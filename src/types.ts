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
}

export const PROVISIONAL_THRESHOLD = 5;
