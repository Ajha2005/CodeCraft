# Development Roadmap

**MVP** = Auth + Problem Solving + Judge Execution + Basic Scoring + Basic Map Visualization. Real-time 1v1 contests and the full anti-cheating engine are explicitly post-MVP.

| Phase | Objective | Key Deliverable |
|---|---|---|
| 0 | Requirements & system design | SRS, architecture diagram, ER diagram, API spec draft |
| 1 | Authentication + user profiles | Working signup/login restricted to Thapar email, profile page |
| 2 | Problem management + coding interface | Problem browsing + Monaco editor UI, dataset-backed problem list |
| 3 | Code execution / judge integration | End-to-end submit → verdict pipeline via Piston + harness |
| 4 | Scoring + territory engine | Working scoring formula + territory assignment on AC |
| 5 | Map + leaderboard | Live map view, college-wide + territory leaderboard pages |
| 6 | Anti-cheating system | Working multi-signal flag system with admin-visible review queue |
| 7 | Real-time contests | End-to-end 1v1 contest flow with WebSocket gateway |
| 8 | Testing + security hardening | Security checklist signed off, integration test coverage report |
| 9 | Deployment + monitoring | Dockerized deployment, health checks, logging |

## Risks & Assumptions

### Assumptions

- The Kaggle dataset's licensing permits use in an academic project deployment (to be confirmed before public demo/deployment).
- A small team is building this incrementally; the roadmap is scoped accordingly.
- Thapar institutional email format is stable and whitelist-able via a simple domain pattern.

### Risks

| Risk | Mitigation |
|---|---|
| Test-case harness complexity underestimated | Scope v1 to a small fixed set of input shapes actually present in the dataset; expand incrementally. |
| Anti-cheating false positives frustrate legitimate fast typists | Per-user adaptive baseline + mandatory admin review before ban is enforced. |
| Piston self-hosting operational complexity | Piston is lightweight and container-based; scope Phase 3 testing specifically around worker crash/timeout recovery. |
| WebSocket scaling under concurrent contests | Redis adapter for cross-instance room broadcast, planned explicitly in Phase 2 scaling. |
| Daily-limit / territory-assignment race conditions | All territory-affecting writes wrapped in Postgres transactions. |

## Future Scope

- Multi-institution support beyond Thapar
- Team/clan-based competition modes
- Pause (rather than auto-forfeit) handling for contest disconnects
- Expanded harness support for a broader range of structured input types (graphs, matrices, custom objects)
- Editorial/reference solution metadata, where licensing permits
- Kubernetes-based orchestration once concurrent load exceeds what Docker Compose comfortably serves
