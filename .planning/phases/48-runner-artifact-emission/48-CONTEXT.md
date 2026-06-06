# Phase 48 — Runner artifact emission

`packages/db/src/artifacts.ts` ships `registerArtifact(db, args)` + `listArtifactsForRun(db, tenantId, runId)`. `apps/runner/src/custom-tools.ts` calls `registerArtifact` at the end of every successful tool dispatch — registering `kind: "json"`, `name: "<tool.key> result"`, `uri: file://<resultPath>`. Best-effort; logs and skips when DB is unavailable. Closes the loop from "agent produced something" to "operator sees it in the artifacts feed."
