import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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

  async runSingleTestCase(
    studentCode: string,
    input: Record<string, any>,
    expectedOutput: any,
  ) {
    const wrapper = this.buildPythonWrapper(studentCode, input);
    const result = await this.runCode(wrapper, 'python', '3.10.0');

    const actualOutput = result.run.stdout?.trim();
    const expected = JSON.stringify(expectedOutput);

    return {
      passed: actualOutput === expected,
      input,
      actualOutput,
      expectedOutput: expected,
      stderr: result.run.stderr,
    };
  }

  async runAllTestCases(
    studentCode: string,
    testCases: { input: Record<string, any>; expected_output: any }[],
  ) {
    const results: any[] = [];
    for (const tc of testCases) {
      const result = await this.runSingleTestCase(
        studentCode,
        tc.input,
        tc.expected_output,
      );
      results.push(result);
    }

    const totalPassed = results.filter((r) => r.passed).length;
    const verdict = totalPassed === testCases.length ? 'AC' : 'WA';

    return {
      verdict,
      totalPassed,
      totalTests: testCases.length,
      results,
    };
  }
}
