/**
 * Syncs the recovery curriculum ("broad sequence") for a campus directly
 * from BigQuery's live prod sequence table, replacing the old hand-typed
 * seed data entirely — sequence order, topic titles and delivery status all
 * come straight from prod now.
 *
 *   pnpm --filter @workspace/api-server run sync:recovery-curriculum
 *
 * Idempotent and safe to re-run on a schedule: topics are matched to
 * existing rows by (campus, subject, topic title) and updated in place, so
 * their ids — and anything in recovery_progress / recovery_session_topics
 * that references them — survive. A topic that no longer appears in the
 * live prod sequence is deactivated (isActive = false), never deleted.
 */
import { db, recoveryTopicsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getProdSequence, type ProdSequenceTopic } from "./lib/queries.js";
import { CDU_CAMPUS, BIGQUERY_TO_CURRICULUM_SUBJECT } from "./seed/cdu-curriculum.js";
import { logger } from "./lib/logger.js";

/** Add more campuses here once their prod sequence data is populated in BigQuery. */
const CAMPUSES = [CDU_CAMPUS];

async function syncSubject(
  campus: string,
  curriculumSubject: string,
  topics: ProdSequenceTopic[],
) {
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: recoveryTopicsTable.id,
        topicTitle: recoveryTopicsTable.topicTitle,
      })
      .from(recoveryTopicsTable)
      .where(
        and(
          eq(recoveryTopicsTable.campus, campus),
          eq(recoveryTopicsTable.subject, curriculumSubject),
        ),
      );
    const existingByTitle = new Map(
      existing.map((row) => [row.topicTitle, row.id]),
    );

    // Move every existing row for this subject to a scratch, guaranteed-
    // unique negative sequence number first. The unique index is on
    // (campus, subject, sequence_no), and prod's order can shift topic
    // numbers around between runs — updating in the final order directly
    // could momentarily collide with another row that hasn't moved yet.
    for (const [index, row] of existing.entries()) {
      await tx
        .update(recoveryTopicsTable)
        .set({ sequenceNo: -(index + 1) })
        .where(eq(recoveryTopicsTable.id, row.id));
    }

    const seenTitles = new Set<string>();
    for (const [index, topic] of topics.entries()) {
      const sequenceNo = index + 1;
      seenTitles.add(topic.topicTitle);
      const existingId = existingByTitle.get(topic.topicTitle);
      if (existingId) {
        await tx
          .update(recoveryTopicsTable)
          .set({
            sequenceNo,
            bigquerySessionTitle: topic.topicTitle,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(recoveryTopicsTable.id, existingId));
      } else {
        await tx.insert(recoveryTopicsTable).values({
          campus,
          subject: curriculumSubject,
          sequenceNo,
          weekNo: null,
          moduleName: null,
          topicTitle: topic.topicTitle,
          unitId: null,
          bigquerySessionTitle: topic.topicTitle,
          isActive: true,
        });
      }
    }

    const stale = existing.filter((row) => !seenTitles.has(row.topicTitle));
    for (const row of stale) {
      await tx
        .update(recoveryTopicsTable)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(recoveryTopicsTable.id, row.id));
    }

    logger.info(
      {
        campus,
        subject: curriculumSubject,
        topicCount: topics.length,
        deactivated: stale.length,
      },
      "Synced curriculum subject from prod sequence",
    );
  });
}

async function syncCampus(campus: string) {
  const rows = await getProdSequence(campus);
  logger.info(
    { campus, rowCount: rows.length },
    "Fetched prod sequence from BigQuery",
  );

  const bySubject = new Map<string, ProdSequenceTopic[]>();
  for (const row of rows) {
    const list = bySubject.get(row.subjectTitle) ?? [];
    list.push(row);
    bySubject.set(row.subjectTitle, list);
  }

  for (const [bqSubject, topics] of bySubject) {
    const curriculumSubject =
      BIGQUERY_TO_CURRICULUM_SUBJECT[bqSubject] ?? bqSubject;
    await syncSubject(campus, curriculumSubject, topics);
  }
}

async function main() {
  for (const campus of CAMPUSES) {
    await syncCampus(campus);
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Recovery curriculum sync failed");
  process.exit(1);
});
