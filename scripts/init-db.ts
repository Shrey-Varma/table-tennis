/* One-shot schema initializer. Run against your Neon database:
 *     DATABASE_URL="postgres://..." npm run init-db
 * Safe to re-run — all DDL is IF NOT EXISTS. */
import { ensureSchema } from "../api/_db";

await ensureSchema();
console.log("✓ Pong Rank schema is ready.");
