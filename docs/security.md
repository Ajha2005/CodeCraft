# Security Considerations

| Area | Approach |
|---|---|
| Authentication | JWT + refresh tokens; institutional email domain whitelist enforced at signup; OTP verification. |
| Authorization | NestJS guards on all mutating routes; contest actions restricted to the two named participants; admin routes gated by role. |
| Session security | Short-lived access tokens, rotated refresh tokens, revocation on ban. |
| Rate limiting | Applied to all public APIs and to the contest WebSocket gateway's `submissionResult` event, not just REST endpoints. |
| Secure code execution | Sandboxed, network-isolated Piston containers; backend never runs student code directly. |
| Database security | Parameterized queries via Prisma; least-privilege DB roles; secrets in environment variables, never committed. |
| API security / input validation | `class-validator` DTOs on all NestJS endpoints; strict schema validation on submission payloads. |
| Anti-abuse | Daily-limit enforcement, flag-based cheating detection, per-user rate limits on challenges and submissions. |
| Audit logs | All admin actions, bans, flag resolutions, and territory transfers are logged with actor, timestamp, and reason. |

Anti-cheating is explicitly treated as defense-in-depth: no single control (paste-blocking, typing model, or diffing) is claimed to be individually sufficient or foolproof.

## Testing Strategy

- Unit tests for the Scoring Service (pure function) against sample easy/medium/hard inputs, including edge cases at the daily-limit boundary.
- Unit tests for the Flag Evaluation Service against synthetic fast-typist data (should not flag) and synthetic paste-bypass data (should flag).
- Integration tests for the full submit → queue → Piston → verdict → score pipeline.
- Load testing with concurrent submissions to validate queue behavior and sandbox isolation under load.
- Sandbox escape / security testing: attempted filesystem/network access, infinite loops, TLE and malicious-input edge cases.
- Concurrency testing for contests: both participants submitting simultaneously, WebSocket disconnect/reconnect within and beyond the grace period.
- Manual auth testing: non-institutional email rejection, OTP flow, token expiry/refresh.
- Basic OWASP Top 10 checklist review before deployment.
