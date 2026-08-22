import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

try {
  await client.query("BEGIN");

  const tableResult = await client.query(
    "select to_regclass('public.recovery_progress') is not null as exists",
  );

  if (!tableResult.rows[0]?.exists) {
    await client.query("COMMIT");
    console.log(
      "recovery_progress does not exist yet; schema push will create it",
    );
  } else {
    await client.query(
      "lock table recovery_progress in share row exclusive mode",
    );

    const dedupeResult = await client.query(`
      with ranked as (
        select
          id,
          row_number() over (
            partition by campus, subject, section, topic_id
            order by
              case status
                when 'completed' then 0
                when 'scheduled' then 1
                else 2
              end,
              completed_at asc nulls last,
              updated_at desc,
              created_at asc,
              id asc
          ) as duplicate_rank
        from recovery_progress
      ),
      deleted as (
        delete from recovery_progress as progress
        using ranked
        where progress.id = ranked.id
          and ranked.duplicate_rank > 1
        returning progress.id
      )
      select count(*)::integer as deleted_count from deleted
    `);

    await client.query(`
      create unique index if not exists recovery_progress_identity_unique_idx
        on recovery_progress (campus, subject, section, topic_id)
    `);
    await client.query(`
      create unique index if not exists recovery_progress_pooled_identity_unique_idx
        on recovery_progress (campus, subject, topic_id)
        where section is null
    `);

    await client.query("COMMIT");

    console.log(
      `recovery_progress identity prepared; removed ${dedupeResult.rows[0]?.deleted_count ?? 0} duplicate row(s)`,
    );
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}