import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const LANGUAGE_VERSIONS: Record<string, string> = {
  python: '3.10.0',
  'c++': '10.2.0',
};

const CPP_TREE_STRUCT = `struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode* l, TreeNode* r) : val(x), left(l), right(r) {}
};`;

const PYTHON_TREE_CLASS = `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right`;

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

  // ---------- Type inference ----------

  private isTreeNode(value: any): boolean {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'val' in value &&
      'left' in value &&
      'right' in value
    );
  }
  private isGraphShape(value: any): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (keys.length === 0) return false;
    return (
      keys.every((k) => !isNaN(Number(k))) &&
      Object.values(value).every(
        (v) => Array.isArray(v) && (v as any[]).every((n) => typeof n === 'number'),
      )
    );
  }

  inferParamTypes(testCases: { input: Record<string, any> }[]): Record<string, string> {
    const types: Record<string, string> = {};
    for (const tc of testCases) {
      for (const [key, value] of Object.entries(tc.input)) {
        if (types[key] && types[key] !== 'unknown') continue;
        if (value === null) {
          if (!types[key]) types[key] = 'unknown';
          continue;
        }
        if (this.isTreeNode(value)) {
          types[key] = 'tree';
        } else if (this.isGraphShape(value)) {
          types[key] = 'graph';
        } else if (Array.isArray(value)) {
          types[key] = Array.isArray(value[0]) ? 'array2d' : 'array';
        } else if (typeof value === 'boolean') {
          types[key] = 'bool';
        } else if (typeof value === 'string') {
          types[key] = 'string';
        } else if (typeof value === 'number' && !Number.isInteger(value)) {
          types[key] = 'float';
        } else {
          types[key] = 'int';
        }
      }
    }
    for (const key of Object.keys(types)) {
      if (types[key] === 'unknown') {
        types[key] = /root|tree|node/i.test(key) ? 'tree' : 'int';
      }
    }
    return types;
  }

  private cppTypeString(type: string): string {
    switch (type) {
      case 'tree': return 'TreeNode*';
      case 'graph': return 'unordered_map<int, vector<int>>';
      case 'array': return 'vector<int>';
      case 'array2d': return 'vector<vector<int>>';
      case 'bool': return 'bool';
      case 'string': return 'string';
      case 'float': return 'double';
      default: return 'int';
    }
  }

  private pythonTypeString(type: string): string {
    switch (type) {
      case 'tree': return 'Optional[TreeNode]';
      case 'array': return 'List[int]';
      case 'array2d': return 'List[List[int]]';
      case 'graph': return 'Dict[int, List[int]]';
      case 'bool': return 'bool';
      case 'string': return 'str';
      case 'float': return 'float';
      default: return 'int';
    }
  }

  private inferReturnType(expectedOutput: any, language: string): string {
    const isArray = Array.isArray(expectedOutput);
    const isBool = typeof expectedOutput === 'boolean';
    const isFloat = typeof expectedOutput === 'number' && !Number.isInteger(expectedOutput);
    const isString = typeof expectedOutput === 'string';

    if (language === 'python') {
      if (isArray) return 'List[int]';
      if (isBool) return 'bool';
      if (isString) return 'str';
      if (isFloat) return 'float';
      return 'int';
    }
    if (isArray) return 'vector<int>';
    if (isBool) return 'bool';
    if (isString) return 'string';
    if (isFloat) return 'double';
    return 'int';
  }

  // ---------- Literal builders (for wrapper generation) ----------

  private cppLiteral(value: any): string {
    if (Array.isArray(value)) {
      return `{${value.map((v) => this.cppLiteral(v)).join(', ')}}`;
    }
    return String(value);
  }

  private cppGraphLiteral(value: Record<string, number[]>): string {
    const entries = Object.entries(value)
      .map(([k, v]) => `{${k}, {${v.join(', ')}}}`)
      .join(', ');
    return `{${entries}}`;
  }

  private pythonGraphLiteral(value: Record<string, number[]>): string {
    const entries = Object.entries(value)
      .map(([k, v]) => `${k}: [${v.join(', ')}]`)
      .join(', ');
    return `{${entries}}`;
  }

  private cppTreeLiteral(value: any): string {
    if (value === null || value === undefined) return 'nullptr';
    return `new TreeNode(${value.val}, ${this.cppTreeLiteral(value.left)}, ${this.cppTreeLiteral(value.right)})`;
  }

  private pythonTreeLiteral(value: any): string {
    if (value === null || value === undefined) return 'None';
    return `TreeNode(${value.val}, ${this.pythonTreeLiteral(value.left)}, ${this.pythonTreeLiteral(value.right)})`;
  }

  // ---------- Python wrapper ----------

  buildPythonWrapper(
    studentCode: string,
    input: Record<string, any>,
    paramTypes: Record<string, string> = {},
  ): string {
    const hasTree = Object.values(paramTypes).some((t) => t === 'tree');
    const args = Object.entries(input)
      .map(([key, value]) => {
        if (paramTypes[key] === 'tree') {
          return `${key}=${this.pythonTreeLiteral(value)}`;
        }
        if (paramTypes[key] === 'graph') {
          return `${key}=${this.pythonGraphLiteral(value)}`;
        }
        return `${key}=${JSON.stringify(value)}`;
      })
      .join(', ');
    const preamble = hasTree ? `from typing import Optional, List, Dict\n${PYTHON_TREE_CLASS}\n` : `from typing import Optional, List, Dict\n`;
    return `
${preamble}${studentCode}
import json
result = solve(${args})
print(json.dumps(result))
`;
  }

  generatePythonSignature(testCases: { input: Record<string, any>; expected_output: any }[]): string {
    const paramTypes = this.inferParamTypes(testCases);
    const sample = testCases[0];
    const params = Object.keys(sample.input)
      .map((key) => `${key}: ${this.pythonTypeString(paramTypes[key])}`)
      .join(', ');
    const returnType = this.inferReturnType(sample.expected_output, 'python');
    return `def solve(${params}) -> ${returnType}:\n    pass\n`;
  }

  // ---------- C++ wrapper ----------

  buildCppWrapper(
    studentCode: string,
    input: Record<string, any>,
    paramTypes: Record<string, string> = {},
  ): string {
    const hasTree = Object.values(paramTypes).some((t) => t === 'tree');
    const paramDecls = Object.entries(input)
      .map(([key, value]) => {
        if (paramTypes[key] === 'tree') {
          return `    TreeNode* ${key} = ${this.cppTreeLiteral(value)};`;
        }
        if (paramTypes[key] === 'graph') {
          return `    ${this.cppTypeString('graph')} ${key} = ${this.cppGraphLiteral(value)};`;
        }
        return `    ${this.cppTypeString(paramTypes[key] || 'int')} ${key} = ${this.cppLiteral(value)};`;
      })
      .join('\n');
    const argNames = Object.keys(input).join(', ');
    const treeStruct = hasTree ? `${CPP_TREE_STRUCT}\n\n` : '';

    return `
#include <bits/stdc++.h>
using namespace std;

${treeStruct}void printResult(int x) {
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

  generateCppSignature(testCases: { input: Record<string, any>; expected_output: any }[]): string {
    const paramTypes = this.inferParamTypes(testCases);
    const sample = testCases[0];
    const hasTree = Object.values(paramTypes).some((t) => t === 'tree');
    const params = Object.keys(sample.input)
      .map((key) => `${this.cppTypeString(paramTypes[key])} ${key}`)
      .join(', ');
    const returnType = this.inferReturnType(sample.expected_output, 'c++');
    return `#include <bits/stdc++.h>\nusing namespace std;\n\n${returnType} solve(${params}) {\n    \n}\n`;
  }

  // ---------- Boilerplate ----------

  generateBoilerplate(testCases: { input: Record<string, any>; expected_output: any }[]) {
    if (!testCases || testCases.length === 0) {
      return { python: 'def solve():\n    pass\n', 'c++': 'int solve() {\n    \n}\n' };
    }
    return {
      python: this.generatePythonSignature(testCases),
      'c++': this.generateCppSignature(testCases),
    };
  }

  // ---------- Wrapper dispatch ----------

  buildWrapper(
    language: string,
    studentCode: string,
    input: Record<string, any>,
    paramTypes: Record<string, string> = {},
  ): string {
    if (language === 'python') {
      return this.buildPythonWrapper(studentCode, input, paramTypes);
    }
    if (language === 'c++') {
      return this.buildCppWrapper(studentCode, input, paramTypes);
    }
    throw new Error(`Unsupported language: ${language}`);
  }

  // ---------- Execution ----------

  async runSingleTestCase(
    studentCode: string,
    input: Record<string, any>,
    expectedOutput: any,
    language: string = 'python',
    paramTypes: Record<string, string> = {},
  ) {
    const wrapper = this.buildWrapper(language, studentCode, input, paramTypes);
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
    const paramTypes = this.inferParamTypes(testCases);
    const results: any[] = [];
    for (const tc of testCases) {
      const result = await this.runSingleTestCase(
        studentCode,
        tc.input,
        tc.expected_output,
        language,
        paramTypes,
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
