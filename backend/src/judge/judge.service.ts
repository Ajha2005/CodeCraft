import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const LANGUAGE_VERSIONS: Record<string, string> = {
  python: '3.10.0',
  'c++': '10.2.0',
};

@Injectable()
export class JudgeService {
  private readonly pistonUrl = 'http://localhost:2000/api/v2/execute';

  constructor(private readonly httpService: HttpService) {}

  async runCode(code: string, language: string, version: string) {
    const response = await firstValueFrom(
      this.httpService.post(this.pistonUrl, {
        language,
        version,
        files: [{ content: code }],
      }),
    );
    return response.data;
  }

  buildPythonWrapper(studentCode: string, input: Record<string, any>): string {
    const args = Object.entries(input)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(', ');
    return `
${studentCode}
import json
result = solve(${args})
print(json.dumps(result))
`;
  }

  private inferCppType(value: any): string {
    if (Array.isArray(value)) return 'vector<int>';
    return 'int';
  }

  private cppLiteral(value: any): string {
    if (Array.isArray(value)) {
      return `{${value.join(', ')}}`;
    }
    return String(value);
  }

  buildCppWrapper(studentCode: string, input: Record<string, any>): string {
    const paramDecls = Object.entries(input)
      .map(([key, value]) => `    ${this.inferCppType(value)} ${key} = ${this.cppLiteral(value)};`)
      .join('\n');
    const argNames = Object.keys(input).join(', ');

    return `
#include <bits/stdc++.h>
using namespace std;

void printResult(int x) {
    cout << x;
}

void printResult(vector<int> x) {
    cout << "[";
    for (size_t i = 0; i < x.size(); i++) {
        cout << x[i];
        if (i + 1 < x.size()) cout << ",";
    }
    cout << "]";
}

${studentCode}

int main() {
${paramDecls}
    auto result = solve(${argNames});
    printResult(result);
    return 0;
}
`;
  }

  buildWrapper(language: string, studentCode: string, input: Record<string, any>): string {
    if (language === 'python') {
      return this.buildPythonWrapper(studentCode, input);
    }
    if (language === 'c++') {
      return this.buildCppWrapper(studentCode, input);
    }
    throw new Error(`Unsupported language: ${language}`);
  }

  async runSingleTestCase(
    studentCode: string,
    input: Record<string, any>,
    expectedOutput: any,
    language: string = 'python',
  ) {
    const wrapper = this.buildWrapper(language, studentCode, input);
    const version = LANGUAGE_VERSIONS[language];
    const result = await this.runCode(wrapper, language, version);

    const compileStderr = result.compile?.stderr;
    const runStderr = result.run.stderr;
    const signal = result.run.signal;
    const actualOutput = result.run.stdout?.trim();
    const expected = JSON.stringify(expectedOutput);

    let status: 'AC' | 'WA' | 'TLE' | 'RE' | 'CE';
    if (compileStderr && compileStderr.trim().length > 0) {
      status = 'CE';
    } else if (signal === 'SIGKILL' || result.run.status === 'TO') {
      status = 'TLE';
    } else if (runStderr && runStderr.trim().length > 0) {
      status = 'RE';
    } else if (actualOutput === expected) {
      status = 'AC';
    } else {
      status = 'WA';
    }

    return {
      passed: status === 'AC',
      status,
      input,
      actualOutput,
      expectedOutput: expected,
      stderr: compileStderr || runStderr,
    };
  }

  async runAllTestCases(
    studentCode: string,
    testCases: { input: Record<string, any>; expected_output: any }[],
    language: string = 'python',
  ) {
    const results: any[] = [];
    for (const tc of testCases) {
      const result = await this.runSingleTestCase(
        studentCode,
        tc.input,
        tc.expected_output,
        language,
      );
      results.push(result);
    }

    const totalPassed = results.filter((r) => r.passed).length;

    let verdict: 'AC' | 'WA' | 'TLE' | 'RE' | 'CE' = 'AC';
    if (totalPassed === testCases.length) {
      verdict = 'AC';
    } else {
      const hasCE = results.some((r) => r.status === 'CE');
      const hasRE = results.some((r) => r.status === 'RE');
      const hasTLE = results.some((r) => r.status === 'TLE');
      if (hasCE) verdict = 'CE';
      else if (hasRE) verdict = 'RE';
      else if (hasTLE) verdict = 'TLE';
      else verdict = 'WA';
    }

    return {
      verdict,
      totalPassed,
      totalTests: testCases.length,
      results,
    };
  }
}
