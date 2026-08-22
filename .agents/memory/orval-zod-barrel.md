---
name: Orval Zod split-output barrel
description: Preventing duplicate type exports when generating split Zod schemas.
---

# Keep the Zod public barrel operation-schema-only
When Orval generates Zod output in split mode with a separate schemas directory,
disable generated index files. Keep the package's public index exporting the main
generated operation-schema module rather than also re-exporting generated types.

**Why:** the generated operation module and generated type index can export the
same request-parameter names, causing TypeScript duplicate-export errors after an
otherwise successful contract generation.

**How to apply:** retain `indexFiles: false` on the Zod output configuration. If
the generator is upgraded, run codegen and the full library typecheck together to
confirm the collision has not returned.