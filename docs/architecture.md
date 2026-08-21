# System Architecture & Tech Stack

The stack is locked and should not be relitigated mid-project.

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Tailwind CSS | Reusable components for independent, frequently-updating UI pieces (map, leaderboard, editor, contest room); type safety for complex nested data models. |
| Code Editor | Monaco Editor | Same engine as VS Code; strong syntax highlighting, multi-language support, and paste-event interception APIs needed for anti-cheating. |
| Backend | Node.js + NestJS | Opinionated, modular controller/service/module architecture; built-in WebSocket + guard (auth) support; same language as frontend. |
| Database | PostgreSQL | Strongly relational data (User, Problem, Submission, Territory, Contest); ACID transactions needed for territory assignment and daily-limit checks. |
| Real-time | WebSockets via NestJS Gateway | Push-based updates for contest status, timers, and leaderboard/map changes; per-contest rooms give clean isolation between simultaneous matches. |
| Cache / Queue | Redis + BullMQ | Submission queueing at a controlled rate to the judge; leaderboard caching; fast daily-limit counters. |
| Code Execution | Piston (self-hosted) | Lightweight, container-based multi-language sandboxed execution; chosen after Judge0 proved unstable/crash-prone in dev, including on Windows. |
| Deployment | Docker + Docker Compose | Consistent dev/prod environment per service; can extend into Kubernetes later if needed. |
| Auth | JWT + institutional email domain restriction | Stateless auth that integrates easily with WebSocket connections; signup gated to `@thapar.edu`-pattern emails. |

## High-Level Architecture
Client (React)
↕
NestJS API (REST + WebSocket Gateway)
↕
PostgreSQL (primary data) + Redis (cache/queue)
↕
Piston workers (isolated execution)


The backend never executes student code directly — it only ever queues a job to Piston and reads back a verdict.

## Data Flow

### Submission Flow

1. Student writes code in Monaco and clicks Submit.
2. Frontend sends `code + language + problemId` to `POST /submissions`.
3. Backend validates input, creates a `Submission` row (`status: queued`), and pushes a job to the Redis/BullMQ submission queue.
4. A Piston worker picks up the job, runs the code against the problem's test cases inside an isolated container, and returns per-test results.
5. Backend writes `TestResult` rows and updates `Submission` status (AC/WA/TLE/RE).
6. On AC, the Scoring Service computes a Performance Score and (if under the daily limit) triggers territory assignment.
7. Backend pushes a WebSocket event to the student's client with the verdict; if in an active contest, also broadcasts opponent status to the contest room.

### Contest Flow

1. Student A sends `POST /challenges` with the target territory owner and (optionally) a problem set.
2. Student B is notified (via socket if online, else on next dashboard load) and accepts via `POST /challenges/:id/accept`.
3. A `Contest` and two `ContestParticipant` rows are created; both clients join a WebSocket room for that contest.
4. Each submission during the contest window is scored and broadcast as a status update (never the opponent's code).
5. On contest end (time limit or both submit), the Contest Scoring Service determines a winner and updates `TerritoryOwnership`.

## Scalability Plan

| Phase | Scale Target | Key Techniques |
|---|---|---|
| Phase 1 | Hundreds of concurrent users (initial rollout) | Single backend instance, single Postgres, single Redis, small Piston worker pool. |
| Phase 2 | Thousands of concurrent users | Horizontal backend scaling behind a load balancer; Postgres read replicas; Redis-backed leaderboard cache; independently scaled Piston worker pool; WebSocket gateway scaled with a Redis adapter. |
| Phase 3 (future) | Multi-institution (out of current scope) | Tenant-aware schema or separate deployments per institution; CDN for static assets; Kubernetes replacing Compose. |
