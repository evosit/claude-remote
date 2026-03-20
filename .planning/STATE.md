---
title: Project State
description: Current project status, position, and continuity
type: state
---

# Project State: Linux Support (v2.0)

## Project Reference

**Core Value**: Enable developers on Linux to use `claude-remote` to control Claude Code from Discord, with feature parity comparable to Windows experience.

**Current Focus**: Planning Phase 1 (Platform Abstraction) – research and requirements are complete, ready to begin detailed planning.

---

## Current Position

**Milestone**: v2.0 — Cross-platform claude-remote

**Phase**: Phase 1 (Platform Abstraction) — planning complete

**Status**: Execution pending (plan created, ready to run)

**Progress**: ███░░░░░░░ 20%

- Planning artifacts: ✓ Complete
- Phase 1 (Platform Abstraction): ◆ Plan ready (7 tasks, 1 wave)
- Phase 2 (Linux Shell Integration): ⬜ Not started
- Phase 3 (Testing & Polish): ⬜ Not started
- Phase 4 (Documentation & Release): ⬜ Not started

---

## Recent Decisions

| Date | Decision |
|------|----------|
| 2025-03-20 | Adopted GSD workflow for v2.0 development |
| 2025-03-20 | Platform abstraction approach confirmed: use process.platform detection and centralized platform.ts module |
| 2025-03-20 | IPC strategy: Unix domain sockets for Linux, Windows named pipes unchanged |
| 2025-03-20 | Config directory: Keep `~/.claude/claude-remote/` for consistency (no XDG change) |
| 2025-03-20 | Shell integration: Support bash, zsh, fish with marker-based idempotent installation |
| 2025-03-20 | Phase 1 planning complete — 7 tasks, 1 wave; research synthesized from existing domain studies |

---

## Pending Todos

_No pending todos captured yet._

---

## Blockers / Concerns

_No blockers or concerns identified._

---

## Session Continuity

**Last session**: 2025-03-20 22:38 GMT+2

**Stopped at**: Project resumed – STATE.md reconstructed from planning artifacts. Roadmap and requirements complete. No phase planning has been executed yet.

**Resume file**: This STATE.md file

**Next action**: Execute Phase 1 (`/gsd:execute-phase 1`)

---

## Key Files

- `.planning/ROADMAP.md` – Phase breakdown and tasks
- `.planning/REQUIREMENTS.md` – Full functional requirements
- `.planning/research/` – Research documents (STACK.md, PITFALLS.md, FEATURES.md, SUPRAPLANNING_SUMMARY.md)
- `.planning/codebase/` – Codebase analysis (ARCHITECTURE.md, CONCERNS.md, CONVENTIONS.md, STRUCTURE.md, TESTING.md, INTEGRATIONS.md)
