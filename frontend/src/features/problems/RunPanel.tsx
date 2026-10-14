import type { RunResult } from './api';
import { Icon } from '../../components/ui/Icon';
import { fmt, inputLines } from './format';

const LANGUAGE_NAME: Record<string, string> = { python: 'Python', 'c++': 'C++' };

const STATUS_TEXT: Record<string, string> = {
  AC: 'Passed',
  WA: 'Wrong answer',
  TLE: 'Time limit',
  RE: 'Runtime error',
  CE: 'Compile error',
};

/** Pretty-prints a program's output when it is JSON (the runner prints results as JSON), otherwise leaves it as is. */
function showOutput(text: string): string {
  if (text === '') return '(no output)';
  try {
    return fmt(JSON.parse(text));
  } catch {
    return text;
  }
}

/** What "Run" found: one card per example of the problem, with what the code printed next to what was expected. */
export function RunPanel({ result, flavor }: { result: RunResult; flavor: boolean }) {
  const allPassed = result.verdict === 'AC';
  const tone = allPassed ? 'text-emerald-300' : 'text-rose-300';

  return (
    <div
      className="hud-panel animate-pop-in p-4 md:p-5"
      style={{ borderColor: allPassed ? '#34d39966' : '#fb718566' }}
      role="region"
      aria-label="Result of running your code on the examples"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="hud-label !text-[0.64rem]">{flavor ? 'Test flight' : 'Example run'}</p>
          <p className={`font-display text-2xl font-bold uppercase tracking-wide ${tone}`}>
            {result.passed}/{result.total} {result.total === 1 ? 'example' : 'examples'} passed
          </p>
        </div>
        <p className="max-w-[11rem] text-right text-[0.7rem] leading-snug text-slate-500">
          {LANGUAGE_NAME[result.language] ?? result.language} · only the examples above ran. Nothing was saved or scored.
        </p>
      </div>

      <ul className="mt-3 space-y-2.5">
        {result.results.map((r) => (
          <li key={r.index} className="overflow-hidden rounded-lg border border-slate-700/70 bg-black/40">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-1.5">
              <span className="hud-label !text-[0.62rem] text-slate-400">Example {r.index + 1}</span>
              <span className="flex items-center gap-2 text-xs font-bold">
                <span className="font-mono font-normal text-slate-500">{r.runtimeMs} ms</span>
                <span className={`inline-flex items-center gap-1 ${r.passed ? 'text-emerald-300' : 'text-rose-300'}`}>
                  <Icon name={r.passed ? 'check' : 'x'} className="h-3.5 w-3.5" />
                  {STATUS_TEXT[r.status] ?? r.status}
                </span>
              </span>
            </div>
            <dl className="grid grid-cols-[4.5rem_1fr] text-sm">
              <dt className="hud-label !text-[0.62rem] px-3 py-1.5 text-slate-500">Input</dt>
              <dd className="min-w-0 space-y-0.5 py-1.5 pr-3 font-mono text-[0.8rem] text-slate-200">
                {inputLines(r.input).map((line, i) => (
                  <p key={i} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {line}
                  </p>
                ))}
              </dd>
              <dt className="hud-label !text-[0.62rem] px-3 py-1.5 text-slate-500">Expected</dt>
              <dd className="min-w-0 whitespace-pre-wrap py-1.5 pr-3 font-mono text-[0.8rem] text-emerald-300 [overflow-wrap:anywhere]">{showOutput(r.expectedOutput)}</dd>
              <dt className="hud-label !text-[0.62rem] px-3 py-1.5 text-slate-500">Yours</dt>
              <dd className={`min-w-0 whitespace-pre-wrap py-1.5 pr-3 font-mono text-[0.8rem] [overflow-wrap:anywhere] ${r.passed ? 'text-emerald-300' : 'text-rose-300'}`}>
                {showOutput(r.actualOutput)}
              </dd>
            </dl>
            {r.error && <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-slate-800 bg-rose-950/30 px-3 py-2 font-mono text-[0.74rem] text-rose-200 [overflow-wrap:anywhere]">{r.error}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}
