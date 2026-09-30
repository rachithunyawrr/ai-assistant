---
name: Next dev preview origins
description: Configure Next.js development origin checks for Replit artifact previews.
---

When a Next.js app runs behind a Replit artifact preview, browser requests can arrive from both `127.0.0.1` and a `.pike.replit.dev` hostname. Next's dev origin protection can block `/_next/hmr`; logs report a blocked cross-origin request, and the client may remain in server-rendered loading UI. Allow the observed preview origins with `allowedDevOrigins` and list the HMR path in the artifact service's `paths`.

**Why:** Replit's preview proxy separates the browser-visible origin from the Next service origin, while Next.js blocks cross-origin dev resources by default.

**How to apply:** If an artifact preview serves its HTML but stays in a hydration/loading state, inspect Next dev logs for blocked cross-origin resources before changing application state logic.