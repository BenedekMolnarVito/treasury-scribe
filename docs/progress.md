# 📈 Dark Factory Progress Log

## 🎯 Current Focus

* **Goal:** Build VitoBudgetTracker — React + TypeScript + Capacitor Android budgeting app with automatic Revolut notification capture, local SQLite storage, tagging, and export.
* **Status:** ACTIVE

## 🛠 Next Microtask (2-hour unit)

> [!IMPORTANT]
> NEXT_TASK: AC-1 — Project scaffolding & configuration. Initialize package.json with all required dependencies (React 18, TypeScript 5.x, Vite 7.x, Capacitor 8.x, sql.js 1.14, Vitest 4.x, React Router 6.x, Testing Library 16.x). Set up tsconfig.json (strict mode), vite.config.ts, index.html, and the canonical src/ directory structure.

## ✅ Completed Tasks

* [ ] MISSION.md created (Cycle #0 - Planning)
* [ ] SPECIFICATION.md created (Cycle #0 - Planning)
* [ ] progress.md created (Cycle #0 - Planning)

## 🛑 Obstacles and Dependencies

* None

## 🧠 Agent Notes (Memory Continuity)

* SPECIFICATION.md contains 15 acceptance criteria (AC-1 through AC-15) with a recommended implementation order.
* AC-1 (scaffolding) must be completed before any other AC can begin.
* TDD workflow: write tests before implementation for data/service layers.
* All data layer tests use real in-memory sql.js databases — no mocks.
* Default currency is HUF. Primary user locale is Hungarian.
* Kotlin Capacitor plugin is intentionally thin — all business logic stays in TypeScript.

## Iteration Cycle Log
* CURRENT_CYCLE: 1
* MAX_CYCLES: 50 (default limit to prevent infinite loops)
