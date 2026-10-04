import { Fragment } from 'react';
import type { ProblemExample } from './api';

/** `like this` in a statement becomes inline code. Unbalanced backticks are left alone. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split('`');
  if (parts.length % 2 === 0) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // a span, not <code>: the global code styles are meant for the docs pages
          <span key={i} className="mx-px rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[0.86em] text-cyan-200">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Compact, readable values: `[1, 2, 3]` rather than JSON's `[1,2,3]`. */
function fmt(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fmt).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${fmt(v)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function inputLines(input: unknown): string[] {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return Object.entries(input as Record<string, unknown>).map(([name, v]) => `${name} = ${fmt(v)}`);
  }
  return [fmt(input)];
}

export function ExampleBlock({ example }: { example: ProblemExample }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700/70 bg-black/40">
      <div className="grid grid-cols-[4.5rem_1fr] border-b border-slate-800 text-sm">
        <span className="hud-label !text-[0.62rem] px-3 py-2 text-slate-500">Input</span>
        <div className="min-w-0 space-y-0.5 py-2 pr-3 font-mono text-[0.82rem] text-slate-200">
          {inputLines(example.input).map((line, i) => (
            <p key={i} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {line}
            </p>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[4.5rem_1fr] text-sm">
        <span className="hud-label !text-[0.62rem] px-3 py-2 text-slate-500">Output</span>
        <span className="block min-w-0 whitespace-pre-wrap py-2 pr-3 font-mono text-[0.82rem] text-emerald-300 [overflow-wrap:anywhere]">{fmt(example.output)}</span>
      </div>
    </div>
  );
}
