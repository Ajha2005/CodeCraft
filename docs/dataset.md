# Problem Dataset Structure

Problems are sourced from an existing Kaggle dataset (imported via `kagglehub`), not scraped — this avoids the copyright/ToS concerns of pulling from Codeforces directly.

## Dataset Columns

| Column | Type | Notes |
|---|---|---|
| id | integer | Primary key, maps directly. |
| title | text | Direct column. |
| description | text | Direct column; full problem statement. |
| difficulty_level | text (Easy/Medium/Hard) | Maps to the difficulty tiers used in scoring. |
| created_at / updated_at | timestamp | Carried over as-is. |
| examples | JSON array | Sample input/output pairs shown to the student on the problem page. |
| constraints | JSON array of strings | Displayed as-is under the problem statement. |
| test_cases | JSON array of `{input, expected_output}` | Used by the judge harness; inputs are structured objects, not raw stdin text. |

## Function-Call vs. stdin/stdout

The dataset's test cases are LeetCode-style: input is a structured JSON object (e.g. a tree, a nested config, an array with named parameters), and `expected_output` is a value to compare — **not** a stdin/stdout text stream.

Standard Piston usage assumes a program reading stdin and writing stdout. This mismatch is resolved by an adapter/harness layer (see the Real-Time Contests / Execution section) — it's called out here because it affects the required function signature students must write.

### Confirmed `test_cases.input` shapes

All `test_cases.input` values are named-key JSON objects matching function parameter names — never positional arrays or raw stdin:

- Scalar: `{"n": 4}`
- 1D array + scalar: `{"nums": [...], "target": 9}`
- 2D array: `{"cost": [[...]]}`
- Tree: `{"root": {"val": 1, ...}, "target": 2}` (root can be `null`)
