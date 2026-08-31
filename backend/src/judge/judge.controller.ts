import { Body, Controller, Post } from '@nestjs/common';
import { JudgeService } from './judge.service';

@Controller('judge')
export class JudgeController {
  constructor(private readonly judgeService: JudgeService) {}

  @Post('run')
  async run(
    @Body('code') code: string,
    @Body('language') language: string,
    @Body('version') version: string,
  ) {
    return this.judgeService.runCode(code, language, version);
  }

  @Post('test-one')
  async testOne(
    @Body('code') code: string,
    @Body('input') input: Record<string, any>,
    @Body('expectedOutput') expectedOutput: any,
    @Body('language') language: string,
  ) {
    return this.judgeService.runSingleTestCase(code, input, expectedOutput, language);
  }

  @Post('test-all')
  async testAll(
    @Body('code') code: string,
    @Body('testCases') testCases: { input: Record<string, any>; expected_output: any }[],
    @Body('language') language: string,
  ) {
    return this.judgeService.runAllTestCases(code, testCases, language);
  }
}
