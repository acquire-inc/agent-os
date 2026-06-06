# Phase 37 — hydrate-restart integration test

14 assertions across 4 groups simulating a runner process boundary via a shared in-memory persister: rehydration of in-flight reservations across tracker instances, sequence counter advances past hydrated max, post-hydration breach math respects rehydrated total, empty-persister and no-persister code paths are well-defined. Script: `test:hydrate-restart`.
