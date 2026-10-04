// What a problem looks like to the outside world. This is a hand-written shape,
// not a database row: the hidden test cases (`testCases`) are inputs to the
// judge and are never part of any response. If a field is not listed here, it
// does not leave the server.

export interface ProblemSummaryDto {
  id: number;
  title: string;
  difficultyLevel: string;
}

export interface ProblemDetailDto extends ProblemSummaryDto {
  description: string;
  /** The sample cases shown on the problem page: `{ input, output }`. Safe to publish. */
  examples: unknown;
  constraints: unknown;
  /** Starter code per language, generated from the hidden cases' shapes (not from their values). */
  boilerplate: Record<string, string>;
}
