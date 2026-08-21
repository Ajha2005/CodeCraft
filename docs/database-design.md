# Database Design

PostgreSQL, accessed via Prisma. Core entities and relationships:

| Entity | Key Fields | Relationships |
|---|---|---|
| User | id, email, password_hash, created_at | 1—N Submission, 1—N TerritoryOwnership, 1—N CheatingFlag, 1—1 DailyProgress (per day) |
| Problem | id, title, description, difficulty_level, examples (JSON), constraints (JSON), test_cases (JSON), created_at, updated_at | 1—N Submission, 1—N TestResult (via Submission) |
| Submission | id, userId, problemId, code, language, status, createdAt | N—1 User, N—1 Problem, 1—N TestResult, 1—1 PerformanceScore (nullable) |
| TestResult | id, submissionId, testCaseIndex, passed, actualOutput | N—1 Submission |
| PerformanceScore | id, submissionId, difficultyScore, correctness, attemptsPenalty, timeEfficiency, totalScore | 1—1 Submission |
| Territory | id, name, mapRegionId, tier, baseValue | N—1 MapRegion, 1—1 TerritoryOwnership (current) |
| TerritoryOwnership | id, territoryId, userId, assignedAt, sourceType (solve/contest) | N—1 Territory, N—1 User |
| MapRegion | id, name, coordinates/zone, territoryId | 1—1 Territory |
| Contest | id, territoryId, challengerId, defenderId, status, startedAt, durationSeconds | N—1 Territory, N—1 User (x2) |
| ContestParticipant | id, contestId, userId, submissionId, solvedAt | N—1 Contest, N—1 User, N—1 Submission |
| DailyProgress | id, userId, date, qualifyingCount | N—1 User |
| CheatingFlag | id, userId, submissionId, signalType, severity, createdAt, reviewStatus | N—1 User, N—1 Submission |
| Ban | id, userId, flagCount, bannedAt, expiresAt, reason | N—1 User |
| Leaderboard | materialized/cached view: userId, totalScore, rank | Derived from PerformanceScore + TerritoryOwnership |

## Design Notes

- `examples`, `constraints`, and `test_cases` are stored as native Postgres JSON columns — this matches the dataset's existing structure exactly and avoids an unnecessary normalization step for v1.
- Territory reassignment (via contest) is a transaction: close old `TerritoryOwnership`, open new one, update `Contest.status` — wrapped in a single DB transaction to avoid race conditions.
- `DailyProgress` is checked and incremented atomically (Redis counter, synced to Postgres) before any territory-affecting score is committed.
