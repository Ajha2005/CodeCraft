# Team & Current Progress

## Team Structure

This is a 3-member team project, split across three phase-owned workstreams:

| Person | Ownership | Scope |
|---|---|---|
| Person A | Phase 1 — Auth | Signup/login, OTP + JWT, institutional email restriction |
| Person B | Phase 2 — Problem Data & Frontend Shell | Problem model, seed data, `GET /problems` API, React problem browsing UI |
| Person C | Phase 3 — Judge Infrastructure | Piston, Redis/BullMQ, Monaco editor, test-case harness |

Work is tracked on separate Git branches (`phase1-auth`, `phase2-problems`, `phase3-judge`) off `main`, in a fork of the teacher-provided template repo (`tiet-ucs503/ucs503p-202627odd-template`).

## Current Status

- ✅ **Phase 2 (Person B) — Complete.** Prisma `Problem` model migrated; 100 problems seeded from a Kaggle CSV (50 Easy / 30 Medium / 20 Hard); NestJS `GET /problems` and `GET /problems/:id` endpoints live with filtering + pagination; React frontend displaying all problems with a difficulty filter and detail view hitting the real API.
- 🔄 **Phase 3 (Person C) — In progress.** Piston, Redis/BullMQ, Monaco editor, and the structured-JSON test-case harness. Switched execution engine from Judge0 to self-hosted Piston after Judge0 proved unstable.
- 🔄 **Phase 1 (Person A) — In progress.** Auth foundation.

## Next Steps

1. Person C completes and pushes the final Phase 3 branch.
2. All three phase branches (`phase1-auth`, `phase2-problems`, `phase3-judge`) are merged sequentially into `main`, with a Prisma migration validation pass between each merge.
3. Phase 4 begins: scoring + territory engine backend logic.
4. Phase 5: SVG campus map frontend, with territories bound to the `Territory` table via ID slugs (e.g. `central-park`, `library`, `csed-block`).

This documentation site is currently hosted from a personal repository for early submission purposes and will be migrated into the team's forked template repository once Phase 3 lands on `main`.
