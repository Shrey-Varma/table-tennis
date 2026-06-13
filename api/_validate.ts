/* Mutation guards ported from backend/main.py: passcode check, real-table-tennis
 * score validation, player colors, and id generation. */
import { randomBytes } from "node:crypto";
import { HTTPException } from "hono/http-exception";

export const PLAYER_COLORS = [
  "#FFA31A", "#5BC8F5", "#4CC38A", "#F76C8A", "#C792EA",
  "#FFD166", "#7DD3C0", "#FF8E5B", "#9DB8FF", "#E8C547",
];

/** 12-char hex id, equivalent to Python's secrets.token_hex(6). */
export const uid = (): string => randomBytes(6).toString("hex");

const PASSCODE = process.env.LEAGUE_PASSCODE ?? "";
export function checkKey(key: string | undefined): void {
  if (PASSCODE && key !== PASSCODE) {
    throw new HTTPException(401, { message: "Missing or wrong league passcode." });
  }
}

export interface GameInput {
  aId: string;
  bId: string;
  aScore: number;
  bScore: number;
  target: number;
}

/** Validate a real table-tennis result: win by 2, deuce past the target. */
export function validateGame(g: GameInput): void {
  if (g.target !== 11 && g.target !== 21) {
    throw new HTTPException(422, { message: "Games are to 11 or 21 points." });
  }
  if (g.aId === g.bId) {
    throw new HTTPException(422, { message: "A player can't play themselves." });
  }
  for (const s of [g.aScore, g.bScore]) {
    if (!Number.isInteger(s) || s < 0 || s > 200) {
      throw new HTTPException(422, { message: "Scores must be whole numbers between 0 and 200." });
    }
  }
  if (g.aScore === g.bScore) {
    throw new HTTPException(422, { message: "Table tennis games can't end in a tie." });
  }
  const hi = Math.max(g.aScore, g.bScore);
  const lo = Math.min(g.aScore, g.bScore);
  if (hi < g.target) {
    throw new HTTPException(422, { message: `The winner needs at least ${g.target} points.` });
  }
  if (hi > g.target && hi - lo !== 2) {
    throw new HTTPException(422, { message: `Past ${g.target}, games end on a 2-point lead.` });
  }
  if (hi === g.target && hi - lo < 2 && lo !== g.target - 1) {
    throw new HTTPException(422, {
      message: `A ${g.target}–${lo} score isn't possible — at ${g.target - 1}-all the game goes to deuce.`,
    });
  }
}
