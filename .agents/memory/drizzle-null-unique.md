---
name: Nullable unique identities
description: How to model a unique identity containing a nullable key with the current Drizzle Kit schema-push workflow.
---

# Prefer schema-compatible paired indexes

For a multi-column identity containing a nullable key, use complementary
partial unique indexes: one for null-key rows and one for non-null-key rows.
Point pooled/null-key upserts at the null-key index columns and use the same
null predicate.

**Why:** Drizzle Kit 0.31.10 generates `UNIQUE NULLS NOT DISTINCT` correctly but
introspects an existing constraint as ordinary uniqueness. Every later schema
push then tries to add the constraint again and can show a destructive
truncation prompt, even though PostgreSQL already enforces it.

**How to apply:** Use this paired-index pattern whenever a nullable identity
must treat null as one shared value on this toolchain. Before first creating
the indexes on an existing table, deduplicate under a write-blocking lock and
create the indexes in that same transaction. Reconsider the native constraint
after upgrading and confirming that a second schema push is clean.
