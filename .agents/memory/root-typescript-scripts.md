---
name: Root TypeScript scripts
description: How to run one-off TypeScript scripts reliably in this workspace.
---
Do not assume `pnpm tsx` or `pnpm exec tsx` works from the workspace root. The root package does not declare `tsx`, even though hidden transitive binaries may exist.

**Why:** Root/package `tsx` execution and ad-hoc externalized bundling both failed for the recovery seed. A package-owned build entry and named script used the API's existing workspace-aware bundler reliably.

**How to apply:** Prefer a script owned by the package that runs the file. If root execution is intended to be supported, explicitly declare `tsx` and a named package script rather than depending on a transitive binary path.