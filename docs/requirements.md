# Requirements

## Functional Requirements

| ID | Requirement |
|---|---|
| FR-1 | Users can sign up and log in only with a verified Thapar institutional email, via OTP + JWT-based sessions. |
| FR-2 | Users can browse, filter (by difficulty/tags), and open coding problems sourced from the CodeCraft dataset. |
| FR-3 | Users can write and submit code in an in-browser editor (Monaco) with language selection. |
| FR-4 | Submitted code is executed in an isolated sandbox (Piston) and returns a verdict (AC / WA / TLE / RE). |
| FR-5 | A correct (AC) submission generates a Performance Score based on difficulty, correctness, attempts, and time efficiency. |
| FR-6 | Performance Score maps to territory assignment or upgrade on the map, subject to the daily qualifying-problem limit (6/day). |
| FR-7 | Users can challenge another user for a specific owned territory; the contest starts only after both parties accept. |
| FR-8 | Accepted contests run in real time (WebSocket), with live opponent status, a server-authoritative timer, and an objective winner determination. |
| FR-9 | The platform maintains a college-wide leaderboard and territory-level rankings. |
| FR-10 | The platform detects and flags suspicious submission behavior (paste attempts, abnormal typing bursts, instant full-solution submissions) and enforces a 3-flag ban policy. |
| FR-11 | Admins can review flags, submissions, and bans through an audit-logged review queue. |

## Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Leaderboard and problem-list queries return in <300ms at hundreds of concurrent users, via indexing + Redis caching. |
| Reliability | Judge execution failures (Piston worker crash, timeout) must not corrupt submission state; retried or marked RE, never silently lost. |
| Security | Student code never executes on the main backend; sandbox isolation is process- and filesystem-level. |
| Scalability | Backend, judge workers, and WebSocket gateway must scale horizontally and independently. |
| Availability | Core practice flow (browse → submit → verdict) should degrade gracefully if real-time contest or map subsystems fail. |
| Maintainability | Modular NestJS architecture (controllers/services/modules) with clear separation between scoring, judge, contest, and anti-cheating services. |
| Fairness | Anti-cheating flags must be evidence-backed and admin-reviewable, not silent auto-bans, to bound false-positive harm. |
| Auditability | All bans, flag resolutions, and territory transfers from contests are logged with actor, timestamp, and reason. |
