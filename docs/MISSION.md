# Strategic Mission

**Goal:** Build VitoBudgetTracker — an Android-only, offline-first budgeting app (React + TypeScript + Capacitor) that automatically captures Revolut push notifications, parses financial metadata, stores transactions locally in SQLite (sql.js), and provides a full UI for viewing, editing, tagging, and exporting spending data.

**Values:**
- Privacy first — all data stays on-device; zero network transmission, no analytics SDKs
- Zero-friction capture — passive notification interception requires no manual user action
- TDD-driven — strict test-first development with Vitest; real in-memory sql.js databases per test
- Thin native layer — only the Kotlin Capacitor notification listener bridge is native; all business logic lives in TypeScript

**Trade-offs:**
- Prefer simplicity over abstraction — no DI container, no state management library; plain module imports and React hooks suffice
- Prefer local-only over cloud sync — data privacy trumps cross-device availability
- Prefer soft-delete over hard-delete — enables auto-soft-delete of recurring unwanted notifications
- Prefer eager loading (JOINs) over lazy loading — avoid N+1 queries at the cost of slightly larger result sets
- Prefer HUF as default currency — primary user locale is Hungarian

**Escalation:** Call *researcher* agent if not sure about implementation best practice.
