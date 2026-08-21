# Territory Allocation & Scoring Model

The scoring formula must be simple enough to explain in a viva, while still rewarding difficulty, correctness, efficiency, and penalizing excessive attempts.

## Formula

**PerformanceScore = (DifficultyWeight × Correctness) − AttemptsPenalty + TimeEfficiencyBonus**

- **DifficultyWeight** — fixed per problem tier: Easy = 10, Medium = 25, Hard = 50.
- **Correctness** — fraction of test cases passed on the final submission (0 to 1; only submissions that reach AC count toward territory progression).
- **AttemptsPenalty** — `min(attempts − 1, 5) × (0.05 × DifficultyWeight)`. Caps at 5 penalized attempts so retrying isn't punished indefinitely, but still discourages pure brute-forcing.
- **TimeEfficiencyBonus** — up to `0.2 × DifficultyWeight`, scaled by how fast the AC submission came relative to that problem's median solve time across all users (faster = closer to full bonus; capped, never negative).

## Sample Calculations

| Case | Difficulty | Attempts | Time Percentile | Calculation | Score |
|---|---|---|---|---|---|
| Easy, first try, fast | Easy (10) | 1 | Top 20% (bonus ≈ 0.18×10) | 10×1 − 0 + 1.8 | 11.8 |
| Medium, 3 attempts, average speed | Medium (25) | 3 | Median (bonus ≈ 0.10×25) | 25×1 − (2×0.05×25) + 2.5 | 25 |
| Hard, 2 attempts, fast | Hard (50) | 2 | Top 10% (bonus ≈ 0.19×50) | 50×1 − (1×0.05×50) + 9.5 | 57 |

## Territory Tier Mapping

| Score Range | Territory Tier | Map Footprint |
|---|---|---|
| 0 – 15 | Outpost | Smallest single-tile territory. |
| 15 – 35 | Settlement | Small cluster (2–3 tiles). |
| 35 – 55 | Stronghold | Medium region, visually distinct color. |
| 55+ | Citadel | Largest available region; reserved for Hard problems solved efficiently. |

A student's total map presence is the sum of currently-owned territories, not a single running score — the leaderboard reflects cumulative territorial control, while each individual solve is scored independently against this formula.

## Daily Limit Policy

**Decision:** after the 6th qualifying problem in a day, students may continue solving problems freely, but further AC submissions do not generate PerformanceScore or affect territory/leaderboard standing that day (a "soft cap").

### Rationale

- A hard block actively discourages practice — the opposite of the platform's stated goal of daily DSA consistency.
- A soft cap keeps the judge/execution pipeline useful at all times, so students still get compiler feedback after their 6 qualifying solves.
- It closes the main abuse vector (mass-farming territory in one sitting) without shutting down engagement.
- UI should clearly indicate "practice mode" once the cap is hit.

### Implementation

`DailyProgress.qualifyingCount` is checked before committing a PerformanceScore; the check-and-increment happens atomically via a Redis counter (fast path) synced back to the `DailyProgress` table, reset at midnight IST via a scheduled job.
