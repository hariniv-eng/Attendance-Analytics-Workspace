---
name: Seed & RBAC scope quirks
description: Non-obvious rules for seeding NIAT SPI staff accounts and how empty scope arrays are interpreted by RBAC.
---

# Superadmin cannot be created through the admin API
The admin API's `manageableRoles` never includes `superadmin`, so any superadmin
account must be created by a direct DB insert (e.g. the seed script), not via
`useCreateUser`/the admin routes.
**Why:** intentional guard so no session can escalate to superadmin through the UI.
**How to apply:** when bootstrapping/seeding, insert superadmin rows directly with a
bcrypt hash; do not route them through admin endpoints.

# Empty scope arrays usually mean "no filter"; instructors are the exception
For non-instructor scoped roles, a subject or campus filter is only applied when
the array length is greater than zero. Instructors instead deny by default when
either assigned campus or subject scope is empty.
**Why:** campus-only visibility remains useful for operational roles, but an
unscoped instructor must never inherit campus-wide recovery access.
**How to apply:** always populate both campus and subject arrays for instructors.
For other scoped roles, check the route's scope semantics before treating an empty
array as no access.

# Production seeding happens via one-time startup backfill
The agent cannot write to the production DB (read-only replica), so staff-account
seeding runs inside the API server at boot: if NONE of the seed emails exist, all
are created; if ANY exist, seeding is skipped entirely.
**Why:** guarantees prod gets accounts on first publish while never resurrecting
admin-deleted accounts or overwriting changed passwords/roles on restarts.
**How to apply:** to add new seed accounts for prod, extend the seed list AND
remember the skip-if-any-exist guard — a one-off manual creation via Manage Users
is usually simpler for already-seeded databases.
