---
name: GitHub push via connector API
description: How to push local commits to GitHub when git CLI auth fails — Git Data API via connector proxy; binary file pitfall.
---
The GitHub connector never exposes a raw token (client.auth() returns type=unauthenticated), so `git push` over HTTPS cannot be authenticated. Push instead via the Git Data API through `conn.proxyFetch` (blobs → tree with base_tree → commit → PATCH refs/heads/main), then `git fetch` + `git merge -s ours origin/main` locally to reconcile histories.

**Why:** git CLI has no credentials in this workspace; the proxy injects auth server-side only.

**How to apply:** For binary files, base64-encode them with node:fs *inside the same "use impure" function* that makes the API call. Do NOT pipe base64 through shellExec/readFile — sandbox output caps silently truncate large outputs and produce corrupt blobs (verify with `git hash-object` vs the returned blob sha).
