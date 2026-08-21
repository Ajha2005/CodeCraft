# Product Vision & Scope

## Vision

The gamification exists to solve a specific, real problem: students practice DSA in inconsistent bursts before placements and then stop. A visible, persistent, competitive artifact — owned territory — is intended to sustain daily engagement.

## Target Users & Scope

Target users are enrolled Thapar students only. Authentication is restricted to institutional email domains (e.g. `@thapar.edu`), verified via OTP at signup. There is no public registration path for external users, and no teams/clans in the initial version — competition is purely individual, 1v1.

### In Scope (v1)

- Authentication
- Problem practice
- Judge execution
- Scoring
- Map / territory system
- Leaderboard
- Anti-cheating
- Real-time 1v1 contests

### Out of Scope (v1)

- Multi-institution support
- Team-based play
- AI-generated-code detection as a primary enforcement mechanism

## Actors

| Actor | Role |
|---|---|
| Student | Primary user — solves problems, earns territory, participates in contests |
| Admin / Faculty Reviewer | Reviews cheating flags, manages bans, monitors platform health |
| System (Judge Service) | Automated actor that executes code and returns verdicts |
| System (Anti-Cheating Engine) | Automated actor that scores behavioral signals and raises flags |

## Representative Use Cases

- **UC-1:** Student signs up with institutional email and verifies via OTP.
- **UC-2:** Student browses problems filtered by difficulty and tag, opens one, and submits a solution.
- **UC-3:** System executes submission via Piston and returns a verdict; on AC, scoring service computes a Performance Score.
- **UC-4:** Student's score results in a new territory claim or upgrade, subject to the daily limit.
- **UC-5:** Student A challenges Student B for a contested territory; Student B accepts; both enter a live 1v1 contest room.
- **UC-6:** Anti-cheating engine flags a submission for an abnormal typing burst; on the 3rd flag, the user is auto-banned for 1 week and territory progress is reset, pending admin review.
- **UC-7:** Admin reviews a flagged submission's stored evidence and overturns or upholds the flag.
