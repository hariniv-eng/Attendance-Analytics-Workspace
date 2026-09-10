/**
 * Syncs the recovery curriculum ("broad sequence") for every live campus
 * directly from BigQuery's live prod sequence table, replacing the old
 * hand-typed seed data entirely -- sequence order, topic titles and delivery
 * status all come straight from prod now. Campuses are discovered live via
 * getCampusList() (the same source every other multi-campus dashboard
 * feature uses) rather than a hardcoded list, so a newly onboarded college
 * gets its recovery curriculum automatically the next time this runs.
 *
 *   pnpm --filter @workspace/api-server run sync:recovery-curriculum
 *
 * Idempotent and safe to re-run on a schedule: topics are matched to
 * existing rows by (campus, subject, topic title) and updated in place, so
 * their ids -- and anything in recovery_progress / recovery_session_topics
 * that references them -- survive. A topic that no longer appears in the
 * live prod sequence is deactivated (isActive = false), never deleted.
 */
import { db, recoveryTopicsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  getProdSequence,
  getCampusList,
  type ProdSequenceTopic,
} from "./lib/queries.js";
import { BIGQUERY_TO_CURRICULUM_SUBJECT } from "./seed/cdu-curriculum.js";
import { logger } from "./lib/logger.js";

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
        sequenceNo: recoveryTopicsTable.sequenceNo,
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

    // Move every existing row for this subject to a scratch sequence number
    // first, guaranteed to be lower than anything already in the table for
    // this (campus, subject) -- including any stray negative values left
    // over from an earlier run that hit an error partway through -- so this
    // reassignment can never collide with the (campus, subject, sequence_no)
    // unique index while we're mid-transaction.
    const minExistingSeq = existing.length
      ? Math.min(...existing.map((row) => row.sequenceNo))
      : 0;
    const scratchBase = Math.min(minExistingSeq, 0) - 1;
    for (const [index, row] of existing.entries()) {
      await tx
        .update(recoveryTopicsTable)
        .set({ sequenceNo: scratchBase - index })
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

  if (rows.length === 0) {
    logger.warn(
      { campus },
      "No prod sequence rows found for this campus -- skipping (no recovery curriculum data available yet)",
    );
    return;
  }

  // Group by the *curriculum* subject name (after mapping), not the raw
  // BigQuery subject_title. Some colleges' live scheduling data uses more
  // than one raw subject_title that maps to the same curriculum subject
  // (e.g. two differently-entered "English" sections) -- syncing those as
  // separate calls would make each one wrongly deactivate the other's
  // topics as "stale". Merging first, then sorting the merged list by
  // date, keeps both the topic set and the sequence order correct.
  const byCurriculumSubject = new Map<string, ProdSequenceTopic[]>();
  for (const row of rows) {
    const curriculumSubject =
      BIGQUERY_TO_CURRICULUM_SUBJECT[row.subjectTitle] ?? row.subjectTitle;
    const list = byCurriculumSubject.get(curriculumSubject) ?? [];
    list.push(row);
    byCurriculumSubject.set(curriculumSubject, list);
  }

  for (const [curriculumSubject, topics] of byCurriculumSubject) {
    topics.sort((a, b) => a.firstDate.localeCompare(b.firstDate));
    await syncSubject(campus, curriculumSubject, topics);
  }
}

async function main() {
  const campuses = await getCampusList();
  logger.info(
    { campuses },
    "Syncing recovery curriculum for every live campus",
  );
  for (const campus of campuses) {
    await syncCampus(campus);
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Recovery curriculum sync failed");
  process.exit(1);
});
