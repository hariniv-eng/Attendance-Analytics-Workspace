/**
 * One-time cleanup: removes the manually-seeded CDU recovery curriculum and
 * recovery session data that was hand-typed early on (before BigQuery had
 * the prod sequence table) just to work out the recovery-tracker logic.
 *
 * Run this once, then run `sync:recovery-curriculum` to repopulate the
 * curriculum straight from the live BigQuery prod sequence instead. Campus
 * instructor roster data is left untouched — that's a real operational
 * roster, not test data.
 *
 *   pnpm --filter @workspace/api-server run reset:cdu-recovery
 */
import { db, recoverySessionsTable, recoveryTopicsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CDU_CAMPUS } from "./seed/cdu-curriculum.js";
import { logger } from "./lib/logger.js";

async function main() {
  // Deleting recovery_sessions cascades recovery_session_topics (session_id FK).
  const deletedSessions = await db
    .delete(recoverySessionsTable)
    .where(eq(recoverySessionsTable.campus, CDU_CAMPUS))
    .returning({ id: recoverySessionsTable.id });

  // Deleting recovery_topics cascades recovery_progress and any remaining
  // recovery_session_topics (topic_id FK).
  const deletedTopics = await db
    .delete(recoveryTopicsTable)
    .where(eq(recoveryTopicsTable.campus, CDU_CAMPUS))
    .returning({ id: recoveryTopicsTable.id });

  logger.info(
    {
      campus: CDU_CAMPUS,
      deletedSessions: deletedSessions.length,
      deletedTopics: deletedTopics.length,
    },
    "Cleared manually-seeded CDU recovery data",
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "CDU recovery data reset failed");
  process.exit(1);
});
