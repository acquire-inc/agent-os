# Phase 51 — Knowledge-driven TaskProfile generation

**Status:** planned
**Triggered by:** Operator's strategic question: "think about how the knowledge base in the backend would work to guide what agents to spin up." The Phase 43 chat dispatch endpoint currently expects the front-end to supply a `TaskProfile`. This phase generates one from intent + knowledge.

## Goal

When a user types intent in the chat workspace, infer a `TaskProfile` automatically by consulting the tenant's knowledge base + skill registry. The chat endpoint should accept just `intent: string` and return a recommendation — no front-end profile-authoring required.

## Architecture

```
intent string
  ↓
intentClassifier (small/cheap LLM call via T-cheap)
  → infers: primary task category, secondary task categories,
    capability hints, hard requirements
  ↓
inferTaskProfile(intent, classification, knowledgeContext)
  → blends classifier output with:
    - tenant's existing skill registry (skills.task_profile aggregates)
    - tenant's knowledge index (folder/tag signals)
    - canonical task→capability mapping table
  ↓
TaskProfile (returned to caller; flows into pickBestModel)
```

## Deliverables

1. **Migration 0024** — `task_categories` lookup table seeded with canonical
   categories (research, draft, classify, summarize, analyze, decide,
   schedule, monitor, communicate) and their default capability weights.

2. **`packages/core/src/router/task-profile-inference.ts`** — pure functions:
   - `mergeKnowledgeContext(category, knowledgeRows)` — uses tenant's
     knowledge tags to bias capability weights (e.g. heavily-tagged
     `code-review` knowledge → boost `code_generation` weight)
   - `categoryToProfile(category, opts)` — canonical category → starting
     TaskProfile

3. **`packages/core/src/router/intent-classifier.ts`** — small wrapper
   around OpenRouter that takes an intent string + returns
   `{ primaryCategory, secondaryCategories, requiresTools, requiresVision,
   requiresLongContext, costSensitivityHint }`. Uses T-cheap tier; budget
   $0.005 per classification. Falls back to keyword-match if LLM
   unavailable.

4. **API endpoint upgrade** — `POST /api/admin/chat/dispatch` body shape:
   - When `profile` is absent but `intent` is present → run inference
   - Return both `inferredProfile` and the picker output

5. **Tests** — pure-function inference + classifier-output-blender +
   API integration smoke.

## Out of scope

- Multi-turn chat history (single-turn intent → profile only)
- Live vector search against knowledge (uses tag aggregates only)
- Operator override of inferred profile (front-end can post profile
  directly to skip inference)

## Acceptance

- Posting `{ intent: "summarize last quarter's deals" }` returns a
  profile with `summarization` weight 1 + `factuality` weight 0.5
- Posting `{ intent: "find adversarial creative angles for ad-ops" }`
  returns a profile with `reasoning` weight 1 + `code_generation` 0
- Existing endpoint usage with explicit `profile` still works
  unchanged (back-compat)
- Inference call budget never exceeds $0.005 per dispatch
