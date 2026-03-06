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

**Escalation:** 
- Call *researcher* agent if not sure about implementation best practice.
- Call *researcher* agent if cannot decide on a User-facing issue. Researcher should use web search to look up best UX and uI design practives, that achieve the most user satisfaction.

**Agent-specific guidance**
- *Planner*: Balance technical and UX trade-offs. Remember that a performant software brings user satisfaction, but bugs dissatisfy humans. Ask *researcher* agent if not sure about what makes humans satisfied.
- *Debugger*: Look for causal relationships in error messages and code behavior. After a failed fix attempt, drill down in error logging one level at a time. Self-reflect: Did I check every variable and function input/output that is causing the issue? Ask *researcher* agent if you need credible documentation on the error.
- *QA Judge*: Verify by seeing output from Android Studio or a terminal or third-party logs. Do NOT accept behavioral inconsistency or lazy evidences. You are the guardian of Definition of Done. Double-check if the all the flows/cases in *scenarios.md* are verified. 
- *Refactorer*: Always check for regressions. Self-reflect on every logic change: Is this change REALLY necessary for better performance or maintainability?
- *Researcher*: Rely on credible web sources. Technical questions should direct you to official documentations. User experience questions should direct you to look for UX/UI statistics.
- *Security Auditor*: Always look for back doors.
- *Worker*: You MUST follow the specification. Self-reflect: Is this logic will CAUSE the specified behavior? If unsure about a business logic or you detect a logical contradiction, ask *Planner* for clarification.