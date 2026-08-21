# Anti-Cheating System

Core principle: cheating rarely shows up as a single damning signal — it shows up as a pattern across several weaker signals. The system is explicitly a **risk-scoring model, not an AI-generated-code detector**, and is presented that way in all documentation and to users.

## Signals

### Signal 1 — Paste Blocking (deterrent, not detection)

Monaco's `onKeyDown` is used to intercept Ctrl+V and Shift+Insert and swallow the event. This is bypassable via DevTools, so its real value is the counter it produces: every blocked attempt is logged server-side per submission.

### Signal 2 — Keystroke / Typing Telemetry

Keystroke timestamps and character deltas are batched client-side and sent every few seconds. Two derived signals:

- A mismatch between characters that appeared in the editor and keydown events fired in the same window indicates text injected outside tracked input.
- A chunk of syntactically complete code appearing in under ~1 second is flagged regardless of raw WPM.

### Signal 3 — Submission Diffing

Each submission is diffed against the student's last saved snapshot for that problem. A near-instant jump from an empty editor to a fully correct solution, with no incremental snapshots in between, is the single strongest signal available.

## Human Typing Velocity Model

A fixed WPM threshold is explicitly rejected: legitimate fast typists routinely exceed generic "human" thresholds, producing false positives, and source code typing (autocomplete, indentation, brackets) doesn't behave like prose typing.

Instead, the model compares each submission's insert-rate against that same user's **own historical baseline** (a rolling per-user average), and separately checks for burst patterns — large contiguous well-formed code blocks appearing faster than incremental typing would produce, regardless of the user's average speed.

## Flag Scoring & Lifecycle

**score = (pasteAttempts × 1) + (burstAnomaly ? 3 : 0) + (velocityDeviation × 2)**

If score ≥ threshold, a `CheatingFlag` is created for that submission, storing `signalType`, `severity`, and the underlying evidence (keystroke summary, diff snapshot, paste-attempt count) for admin review.

| Flag Count | Consequence |
|---|---|
| 1st flag | Warning shown to user; flag logged, queued for admin visibility. |
| 2nd flag | Second warning; account marked for closer monitoring. |
| 3rd flag | Automatic 1-week account ban + territory/map progress reset to zero. Account itself is NOT deleted. Queued for mandatory admin review — the ban can be overturned if review finds the flags unjustified. |

## Explicit Non-Goals

- The system does **not** claim to perfectly detect AI-generated code, and AI-code-detection is not used as a primary or standalone enforcement mechanism.
- Tab-switching is deliberately not used as a cheating signal (too many legitimate reasons to switch tabs; high false-positive risk).
- Client-side paste blocking is not claimed to be foolproof — it is one layer in a defense-in-depth approach.
