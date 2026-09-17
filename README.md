<div align="center">

# 🏰 CodeCraft

**A gamified DSA practice platform for Thapar Institute of Engineering & Technology**

Solve problems → earn a Performance Score → claim territory on a live campus map → challenge rivals in real-time 1v1 contests → climb the leaderboard.

[![Frontend](https://img.shields.io/badge/frontend-React%2019%20%2B%20TypeScript-61DAFB?logo=react&logoColor=white)](./frontend)
[![Backend](https://img.shields.io/badge/backend-NestJS%2011-E0234E?logo=nestjs&logoColor=white)](./backend)
[![Database](https://img.shields.io/badge/database-PostgreSQL%20%2F%20Prisma-336791?logo=postgresql&logoColor=white)](./backend/prisma)
[![Execution](https://img.shields.io/badge/execution-Piston-blueviolet)](https://github.com/engineer-man/piston)
[![Docs](https://img.shields.io/badge/docs-MkDocs%20Material-526CFE?logo=materialformkdocs&logoColor=white)](https://ajha2005.github.io/CodeCraft/)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Core Loop](#core-loop)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
  - [High-Level System](#high-level-system)
  - [Submission Flow](#submission-flow)
  - [1v1 Contest Flow](#1v1-contest-flow)
  - [Data Model](#data-model)
- [Territory & Scoring Model](#territory--scoring-model)
- [Anti-Cheating](#anti-cheating)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone & install](#1-clone--install)
  - [2. Start Piston (code execution)](#2-start-piston-code-execution)
  - [3. Configure environment variables](#3-configure-environment-variables)
  - [4. Set up the database](#4-set-up-the-database)
  - [5. Run the app](#5-run-the-app)
- [Available Scripts](#available-scripts)
- [Deployment](#deployment)
- [Documentation Site](#documentation-site)
- [Implementation Status](#implementation-status)
- [Team](#team)
- [License](#license)

---

## Overview

CodeCraft is a DSA practice platform built exclusively for Thapar students. Unlike a plain problem list (LeetCode/Codeforces-style), every solve is wrapped in a persistent, visible, competitive layer: a fictional interactive **grid map of the Thapar campus**, where each cell can be owned by a student. Territory is won by solving problems well — and can only change hands through a **voluntary, mutually-accepted real-time 1v1 contest**, never by force or decay.

Access is gated to verified `@thapar.edu` accounts (password or Google OAuth), so the leaderboard and map reflect one real, closed cohort rather than an open internet leaderboard.

## Core Loop

```mermaid
flowchart LR
    A[Browse problems<br/>filter by difficulty/tag] --> B[Write & submit code<br/>Monaco editor]
    B --> C{Judged by Piston<br/>sandboxed execution}
    C -- WA / TLE / RE --> B
    C -- Accepted --> D[Performance Score<br/>computed]
    D --> E[Claim / upgrade<br/>a territory cell]
    E --> F{Cell contested?}
    F -- Challenge accepted --> G[Live 1v1 contest<br/>WebSocket room]
    G --> H[Cell ownership<br/>transfers to winner]
    F -- No challenge --> I[Climb the leaderboard]
    H --> I
```

## Features

**Practice & Judging**
- Problem browser with difficulty/tag filtering, backed by a 100-problem Kaggle-sourced dataset (50 Easy / 30 Medium / 20 Hard)
- In-browser Monaco editor (same engine as VS Code) with multi-language support
- Submissions run in isolated, self-hosted [Piston](https://github.com/engineer-man/piston) containers — the backend never executes student code directly
- A structured-JSON test-case harness translates LeetCode-style `{input, expected_output}` cases into per-language wrapper code (including custom tree deserialization) before handing the job to Piston
- Submission queueing via Redis + BullMQ to keep judge throughput controlled under load

**Gamification**
- A live, zoomable/pannable SVG campus map (`react-zoom-pan-pinch`) divided into a grid of ownable `TerritoryCell`s, generated via point-in-polygon rasterization of campus zones
- Territory tier (Outpost → Settlement → Stronghold → Citadel) is driven by the Performance Score formula, not manual admin assignment
- A soft daily qualifying-problem cap (6/day) so territory farming is bounded without discouraging practice
- Streak badges, confetti, and toggleable "flavor text" for a lighter tone

**Real-Time 1v1 Contests**
- Challenge/accept flow: `POST /challenges` → target notified live or on next load → `POST /challenges/:id/accept` opens a dedicated WebSocket room
- Server-authoritative timers (`startedAt` + `durationSeconds` stored server-side; clients never drive their own countdown)
- Disconnect grace period with auto-forfeit on timeout, handled by a dedicated timeout processor
- Contests target a single map cell — winner takes exactly that cell, atomically, the same transfer path a solo AC uses

**Leaderboard & Accounts**
- College-wide leaderboard plus per-territory rankings
- Auth via email/password or Google OAuth, both restricted server-side to `@thapar.edu` addresses, backed by JWT sessions

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript + Tailwind CSS 4 + Vite | Component-driven UI for the map, editor, contest room, and leaderboard; full type safety across nested data models |
| Code Editor | Monaco Editor (`@monaco-editor/react`) | VS Code's engine — syntax highlighting, multi-language support, input interception hooks |
| Backend | Node.js + NestJS 11 | Modular controller/service/module architecture; first-class WebSocket gateways and guards |
| Database | PostgreSQL via Prisma 7 | Strongly relational schema (User, Problem, Submission, Territory Cells, Contest); transactional territory/daily-limit writes |
| Real-time | Socket.IO via NestJS Gateways | Dedicated `territory` and `contest` namespaces/rooms for isolated, push-based updates |
| Cache / Queue | Redis + BullMQ (`ioredis`) | Submission queueing, daily-limit counters, leaderboard caching |
| Code Execution | [Piston](https://github.com/engineer-man/piston) (self-hosted, Dockerized) | Lightweight, sandboxed, network-isolated multi-language execution — swapped in after Judge0 proved unstable in dev |
| Auth | JWT + Passport (local + Google OAuth20) | Stateless sessions, domain-restricted signup (`@thapar.edu`) enforced on both auth paths |
| Deployment | Vercel (frontend) · AWS EC2 + Docker + Nginx + pm2 (backend/Piston) · Supabase (Postgres) · Redis Cloud | See [`DEPLOYMENT.md`](./DEPLOYMENT.md) |
| Docs | MkDocs Material, auto-deployed to GitHub Pages | See [Documentation Site](#documentation-site) |

## Architecture

### High-Level System

```mermaid
flowchart TD
    Client["React Client\n(Map · Editor · Contest Room · Leaderboard)"]
    API["NestJS API\nREST controllers"]
    GW["NestJS Gateways\nterritory · contest (Socket.IO)"]
    Queue["Redis + BullMQ\nsubmission queue · daily-limit counters"]
    DB[("PostgreSQL\nvia Prisma")]
    Piston["Piston Workers\nisolated, network-off containers"]

    Client <-- REST --> API
    Client <-- WebSocket --> GW
    API --> DB
    API --> Queue
    GW --> DB
    Queue --> Piston
    Piston --> Queue

    style Piston fill:#7c3aed,color:#fff
    style DB fill:#336791,color:#fff
```

The backend never executes student code itself — it only ever enqueues a job on Redis/BullMQ and reads back a structured verdict from a Piston worker.

### Submission Flow

```mermaid
sequenceDiagram
    participant U as Student
    participant FE as React Client
    participant BE as NestJS API
    participant Q as Redis / BullMQ
    participant P as Piston Worker
    participant DB as PostgreSQL

    U->>FE: Write code, click Submit
    FE->>BE: POST /submissions { code, language, problemId }
    BE->>DB: Create Submission (status: queued)
    BE->>Q: Enqueue judge job
    Q->>P: Dispatch to worker
    P->>P: Run against test cases\n(isolated, no network)
    P-->>Q: Per-test results
    Q-->>BE: Verdict (AC / WA / TLE / RE)
    BE->>DB: Write TestResults, update Submission
    alt Verdict is AC
        BE->>BE: Compute Performance Score
        BE->>DB: Assign/upgrade TerritoryCell (if under daily cap)
    end
    BE-->>FE: WebSocket: verdict + score
```

### 1v1 Contest Flow

```mermaid
sequenceDiagram
    participant A as Challenger
    participant B as Defender
    participant BE as NestJS API
    participant GW as Contest Gateway

    A->>BE: POST /challenges { toUserId, cellId, problemId? }
    BE-->>B: Notify (live socket or next dashboard load)
    B->>BE: POST /challenges/:id/accept
    BE->>BE: Create Contest + 2 ContestParticipant rows
    A->>GW: Join room contest:{id}
    B->>GW: Join room contest:{id}
    par Live play
        A->>BE: Submit solution
        B->>BE: Submit solution
    end
    BE-->>GW: Broadcast verdict + timestamp only\n(never opponent's code)
    Note over BE: First correct AC wins.\nDisconnect grace period -> auto-forfeit if not rejoined.
    BE->>BE: Determine winner, transfer cell ownership (atomic)
    BE-->>GW: Contest resolved
```

### Data Model

```mermaid
erDiagram
    User ||--o{ Submission : submits
    User ||--o{ TerritoryCellOwnership : owns
    User ||--o{ DailyProgress : tracks
    User ||--o{ Contest : "challenges / defends"

    Problem ||--o{ Submission : "attempted via"

    Submission ||--o| PerformanceScore : scores
    Submission }o--o| Contest : "made during"

    Territory ||--o{ TerritoryCell : "divided into"
    TerritoryCell ||--o{ TerritoryCellOwnership : "owned via"
    TerritoryCell ||--o{ Contest : "contested for"

    Contest ||--o{ ContestParticipant : has
    ContestParticipant }o--|| Submission : "best submission"
```

Full schema: [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma) · Design rationale: [`docs/database-design.md`](./docs/database-design.md)

## Territory & Scoring Model

```
PerformanceScore = (DifficultyWeight × Correctness) − AttemptsPenalty + TimeEfficiencyBonus
```

| Component | Rule |
|---|---|
| DifficultyWeight | Easy = 10 · Medium = 25 · Hard = 50 |
| Correctness | Fraction of test cases passed on the final (AC) submission |
| AttemptsPenalty | `min(attempts − 1, 5) × (0.05 × DifficultyWeight)` — capped so retries aren't punished indefinitely |
| TimeEfficiencyBonus | Up to `0.2 × DifficultyWeight`, scaled against that problem's median solve time across all users |

| Score | Territory Tier |
|---|---|
| 0 – 15 | Outpost |
| 15 – 35 | Settlement |
| 35 – 55 | Stronghold |
| 55+ | Citadel |

A **soft daily cap** (6 qualifying solves/day) stops score/territory accrual for the day without blocking further practice — the judge pipeline stays useful even after the cap is hit. Full rationale: [`docs/scoring.md`](./docs/scoring.md).

## Anti-Cheating

Designed as a **risk-scoring model, not an AI-code detector** — no single signal is treated as individually sufficient:

| Signal | Mechanism |
|---|---|
| Paste blocking | Monaco intercepts Ctrl+V/Shift+Insert as a deterrent; bypassable, so its real value is the logged attempt count |
| Keystroke telemetry | Per-user typing baseline (not a fixed WPM threshold) + burst detection for well-formed code appearing too fast |
| Submission diffing | Near-instant empty→complete jumps with no incremental snapshots are the strongest signal |
| Flag lifecycle | 1st = warning, 2nd = monitoring, 3rd = auto 1-week ban + territory reset, pending mandatory admin review |

> **Status:** the full flag-scoring/ban pipeline and admin review queue are designed (see [`docs/anti-cheating.md`](./docs/anti-cheating.md)) but not yet implemented server-side — only client-side paste interception exists today. Tab-switching is deliberately **not** used as a signal (too many legitimate reasons, high false-positive risk).

## Project Structure

```
CodeCraft/
├── backend/                 # NestJS API + WebSocket gateways
│   ├── prisma/               # Schema, migrations, seed & grid-generation scripts
│   └── src/
│       ├── auth/              # Password + Google OAuth, JWT, @thapar.edu domain guard
│       ├── problems/          # Problem browsing/filtering
│       ├── judge/              # Piston client + language harnesses
│       ├── submissions/       # Queueing, processing, verdicts
│       ├── scoring/            # Performance Score service
│       ├── territory/          # Grid-cell map, ownership, territory gateway
│       ├── contest/             # Challenge/accept, contest gateway, timeout processor
│       ├── leaderboard/       # College-wide & territory rankings
│       └── common/             # Redis client, shared color utils
├── frontend/                # React + TypeScript + Vite client
│   └── src/
│       ├── auth/                # Login, OAuth callback, protected routes
│       ├── features/map/        # Campus map, territory leaderboard panel
│       ├── features/contest/    # Challenges list, live contest room
│       ├── pages/                # Scoring dashboard
│       └── lib/                  # API client, Monaco setup, sockets, toasts
├── judge0/                  # Legacy Judge0 config (superseded by Piston, kept for reference)
├── docs/                    # Full system design docs (MkDocs source)
├── DEPLOYMENT.md            # Production topology + runbook
└── mkdocs.yml
```

## Getting Started

### Prerequisites

- Node.js ≥ 20
- PostgreSQL (local instance or a hosted URL, e.g. Supabase)
- Redis (local instance or a hosted URL, e.g. Redis Cloud)
- Docker (to run Piston locally)

### 1. Clone & install

```bash
git clone https://github.com/Ajha2005/CodeCraft.git
cd CodeCraft

cd backend && npm install
cd ../frontend && npm install
```

### 2. Start Piston (code execution)

```bash
docker run -d --name piston-api --restart always -p 2000:2000 \
  --privileged -v piston-packages:/piston/packages \
  ghcr.io/engineer-man/piston

# Install the language runtimes the judge harness targets
curl -X POST http://localhost:2000/api/v2/packages \
  -H "Content-Type: application/json" \
  -d '{"language": "python", "version": "3.10.0"}'

curl -X POST http://localhost:2000/api/v2/packages \
  -H "Content-Type: application/json" \
  -d '{"language": "gcc", "version": "10.2.0"}'
```

### 3. Configure environment variables

`backend/.env`:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string (session pooler if using Supabase — not the transaction pooler) |
| `REDIS_URL` | `redis://default:PASSWORD@host:port` |
| `JWT_SECRET` | `openssl rand -base64 32` |
| `JWT_EXPIRES_IN` | e.g. `1d` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google Cloud Console → Credentials |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3000/auth/google/callback` locally |
| `FRONTEND_URL` | `http://localhost:5173` locally |
| `PORT` | Optional, defaults to `3000` |

`frontend/.env` (see [`frontend/.env.example`](./frontend/.env.example)):

| Variable | Notes |
|---|---|
| `VITE_API_BASE` | `http://localhost:3000` locally |

### 4. Set up the database

```bash
cd backend
npx prisma migrate deploy
npm run seed              # seeds the 100-problem dataset
npx tsx prisma/generate-grid.ts   # rasterizes the campus map into TerritoryCells
```

### 5. Run the app

```bash
# Terminal 1 — backend
cd backend
npm run start:dev

# Terminal 2 — frontend
cd frontend
npm run dev
```

Frontend: `http://localhost:5173` · Backend: `http://localhost:3000`

## Available Scripts

**Backend** (`backend/package.json`)

| Script | Purpose |
|---|---|
| `npm run start:dev` | Start the API in watch mode |
| `npm run seed` | Seed the problem dataset |
| `npm run reset-grid` | Regenerate territory cells from the campus map SVG |
| `npm run lint` / `format` | ESLint / Prettier |
| `npm test` / `test:e2e` / `test:cov` | Unit / e2e / coverage |

**Frontend** (`frontend/package.json`)

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run lint` | ESLint |
| `npm run preview` | Preview the production build |

## Deployment

| Component | Where |
|---|---|
| Frontend | Vercel (root dir `frontend`, auto-deploys `main`) |
| Backend | AWS EC2 (Ubuntu), via pm2 behind Nginx |
| Piston | Same EC2 instance, Docker |
| PostgreSQL | Supabase |
| Redis | Redis Cloud |

Full runbook (server recreation, Nginx config, SSL, known gotchas) lives in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Documentation Site

The complete system design — vision, requirements, architecture, database design, scoring model, anti-cheating design, real-time contest spec, security checklist, and roadmap — is written up in [`docs/`](./docs) and published via MkDocs Material:

📘 **https://ajha2005.github.io/CodeCraft/**

| Doc | Covers |
|---|---|
| [`vision.md`](./docs/vision.md) | Problem statement, scope, actors, use cases |
| [`requirements.md`](./docs/requirements.md) | Functional & non-functional requirements |
| [`architecture.md`](./docs/architecture.md) | Stack rationale, data flow, scalability plan |
| [`database-design.md`](./docs/database-design.md) | Entity/relationship design |
| [`dataset.md`](./docs/dataset.md) | Problem dataset structure & harness rationale |
| [`scoring.md`](./docs/scoring.md) | Territory & scoring formula |
| [`anti-cheating.md`](./docs/anti-cheating.md) | Signal design & flag lifecycle |
| [`contests.md`](./docs/contests.md) | 1v1 contest & execution architecture |
| [`security.md`](./docs/security.md) | Security controls & test strategy |
| [`roadmap.md`](./docs/roadmap.md) | Phased plan, risks, future scope |

## Implementation Status

Reflects a scan of the current codebase, not the phase doc's original ordering:

- [x] Auth — email/password + Google OAuth, both gated to `@thapar.edu`, JWT sessions
- [x] Problem browsing — filtering, dataset-backed detail view
- [x] Judge execution — Piston integration, function-call harness (array/tree inputs), queued via BullMQ
- [x] Scoring engine — Performance Score service, daily soft-cap
- [x] Territory system — grid-cell map, SVG rasterization, live territory gateway
- [x] Real-time 1v1 contests — challenge/accept, contest gateway, disconnect grace period, atomic cell transfer
- [x] Leaderboard — college-wide + territory rankings


## Team

3-member team, split by ownership:

| Workstream | Scope |
|---|---|
| Auth | Signup/login, OAuth, institutional email restriction |
| Problem Data & Frontend Shell | Problem model, seed data, problem browsing UI |
| Judge Infrastructure | Piston, Redis/BullMQ, Monaco editor, test-case harness |

See [`docs/team-progress.md`](./docs/team-progress.md) for the detailed workstream log.

## License

No license file is currently published in this repository. Until one is added, all rights are reserved by the authors — add a `LICENSE` file (e.g. MIT) before any public reuse or distribution.
