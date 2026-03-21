---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: milestone
status: in_progress
last_updated: "2026-03-21T22:00:00Z"
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 4
  completed_plans: 3
---

# Project State: Linux Support (v2.0)

## Project Reference

**Core Value**: Enable developers on Linux to use `claude-remote` to control Claude Code from Discord, with feature parity comparable to Windows experience.

**Current Focus**: Phase 4 (Documentation & Release) – README, CHANGELOG complete, version bumped to 2.0.0; manual release steps pending.

---

## Current Position

Phase: 04 (documentation-&-release) — IN_PROGRESS (manual release pending)
Plans: 2 of 4 completed (P4.1, P4.2 done; P4.3, P4.4 pending)

## Recent Decisions

| Date | Decision |
|------|----------|
| 2026-03-21 | Fixed 7 critical bugs from paused session (HANDOFF) |
| 2026-03-21 | Implemented `--configs` feature: setup wizard prompts for additional claude CLI args |
| 2026-03-21 | Admitted `getPackageRoot()` and `getInstalledPath()` utilities for reliable runtime path resolution |
| 2026-03-21 | Removed invalid PostCompact hook, added missing UserPromptSubmit hook |
| 2026-03-21 | Changed alias install default to false to avoid surprising users |
| 2026-03-21 | Implemented first-run auto-setup (runs setup automatically when no config exists) |
| 2026-03-21 | Updated config directory to be XDG-compliant on Linux: `~/.config/claude-remote` instead of `~/.claude/claude-remote` |
| 2025-03-20 | Adopted GSD workflow for v2.0 development |
| 2025-03-20 | Platform abstraction approach confirmed: use process.platform detection and centralized platform.ts module |
| 2025-03-20 | IPC strategy: Unix domain sockets for Linux, Windows named pipes unchanged |
| 2025-03-20 | Shell integration: Support bash, zsh, fish with marker-based idempotent installation |

---

## Pending Todos

_No pending todos captured yet._

---

## Blockers / Concerns

_No blockers or concerns identified._

---

## Session Continuity

**Last session**: 2026-03-21 22:00 GMT+2

**Stopped at**: Resumed from HANDOFF, implemented all bug fixes and added `--configs` support. Build successful; ready for release steps.

**Resume file**: This STATE.md file

**Next action**: Complete P4.3 (npm publish) and P4.4 (GitHub release), then run `/gsd:execute-phase 4` to finalize.

---

## Key Files

- `.planning/ROADMAP.md` – Phase breakdown and tasks
- `.planning/REQUIREMENTS.md` – Full functional requirements
- `.planning/research/` – Research documents (STACK.md, PITFALLS.md, FEATURES.md, SUPRAPLANNING_SUMMARY.md)
- `.planning/codebase/` – Codebase analysis (ARCHITECTURE.md, CONCERNS.md, CONVENTIONS.md, STRUCTURE.md, TESTING.md, INTEGRATIONS.md)
