# Real-Time 1v1 Territory Contests

## Challenge / Accept Flow

Initiated over REST, executed over WebSocket.

- `POST /challenges { toUserId, territoryId, problemId? }` creates a pending Challenge; the target user is notified over their existing socket if online, or sees it on next dashboard load.
- `POST /challenges/:id/accept` creates the Contest and both `ContestParticipant` rows, and both clients join a dedicated WebSocket room for that contest.

## WebSocket Gateway Design

A dedicated NestJS Gateway (namespace: `contest`) handles per-contest rooms. On join, a client is added to `contest:{contestId}` and the room is notified of opponent-online status. On each submission result, the gateway broadcasts only the verdict and timestamp to the room — **never the opponent's actual code**.

## Timer & Fairness

The server is the sole source of truth for contest timing: `startedAt` and `durationSeconds` are stored on the `Contest` row, and clients compute remaining time locally from those values rather than running an independently-driven countdown that could drift or be manipulated.

## Disconnect / Reconnect Handling

A disconnect does not end the contest. The participant is marked offline and a server-side grace period (e.g. 30 seconds) starts. On reconnect within that window, the client rejoins the room and resyncs state from the database. If the grace period expires, the disconnected participant auto-forfeits — simpler to test and reason about than a pause mechanism (noted as a possible future enhancement).

## Scoring & Tie-Break

Contest correctness and difficulty reuse the Performance Score service, but ranking within a contest is primarily by `solvedAt` timestamp: the first correct AC wins. If both participants fail to reach AC, whichever passed more test cases wins. A true simultaneous tie is defined as a draw, with no territory transfer.

---

# Code Execution Architecture

## Pipeline
CodeCraft Backend → Submission Queue (Redis/BullMQ) → Sandboxed Judge Service (Piston)
→ Isolated Container → Compiler + Test Cases → Result → CodeCraft Backend → User

The backend never executes arbitrary student code directly; it only ever enqueues a job and reads back a structured result from Piston.

| Concern | Mechanism |
|---|---|
| CPU / memory / time limits | Enforced per-submission by Piston's container configuration; violations return TLE/MLE-equivalent verdicts. |
| Network restrictions | Piston execution containers run with no outbound network access. |
| Filesystem isolation | Each submission runs in its own ephemeral container filesystem, destroyed after execution. |
| Process isolation | Standard container/process isolation prevents a submission from observing or affecting other concurrent submissions. |
| Queue management | BullMQ controls submission throughput to Piston workers, preventing overload during traffic spikes. |
| Concurrent submissions | Multiple Piston worker containers process the queue in parallel; queue depth is monitored to trigger horizontal worker scaling. |

## Test-Case Harness — Resolving the Dataset Format Gap

The dataset's test cases are structured JSON (function-call style), not raw stdin/stdout text, which is what Piston expects by default. This is resolved with a per-language harness layer that wraps the student's submitted function before it is sent to Piston:

1. The student is told the exact function signature to implement per problem (e.g. `def solve(nums: List[int]) -> int:`), derived from the shape of that problem's `test_cases.input`.
2. Before queueing, the backend generates a small wrapper script per submission: it deserializes each test case's input JSON into native language objects (including custom deserialization for structured types like binary trees), calls the student's function, and serializes the return value.
3. The wrapper prints one line of JSON per test case to stdout, which Piston then returns as normal program output.
4. The backend parses that stdout, compares each line against `test_cases[i].expected_output`, and produces the AC/WA verdict — Piston itself never needs to understand the problem's data shape.

This harness is problem-type-aware (array, tree, and graph problems each need a different deserialization helper), so v1 scope launches with a small, fixed set of supported input types matched to what's actually common in the dataset.
