---
name: Next dev workflow handoff
description: Replacing a Replit workflow that runs a root Next.js dev server.
---

When moving a root Next.js dev server from a standalone workflow to an artifact-managed workflow, verify the old process tree has exited before starting the new service against the same `.next` directory. Removing the workflow configuration alone may leave its child server process running.

**Why:** A leftover Next process can retain the development lock and make the artifact workflow fail even though its own configured port is free.

**How to apply:** During a workflow handoff, inspect the old process tree and verify that no prior `next dev` process remains before restarting the artifact service.