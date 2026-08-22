---
name: Custom staff authentication
description: Project decision about preserving the NIAT SPI staff sign-in system.
---

Keep the existing custom email/password and Google Workspace staff sign-in flow. Improve its usability and presentation in place rather than adding or migrating to another authentication system unless the user explicitly requests a new flow.

**Why:** The user chose to improve the established staff sign-in experience instead of adding a new authentication capability.

**How to apply:** Preserve the current auth API, session cookie, RBAC, and authenticated dashboard routing during login-related work. Treat migrations to Clerk, Replit Auth, or another provider as separate scope requiring explicit approval.