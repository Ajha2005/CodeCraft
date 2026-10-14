/** Compact, readable values: `[1, 2, 3]` rather than JSON's `[1,2,3]`. */
export function fmt(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fmt).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${fmt(v)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

/** An example's input as one `name = value` line per argument. */
export function inputLines(input: unknown): string[] {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return Object.entries(input as Record<string, unknown>).map(([name, v]) => `${name} = ${fmt(v)}`);
  }
  return [fmt(input)];
}
