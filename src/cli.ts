#!/usr/bin/env node
import { parseArgs } from './args.js';
import { resolveFixPrompt } from './fixPrompt.js';
import { driftcheck } from './index.js';
import { printFixPrompt, printReport } from './report.js';

async function main() {
  const { url, json, fixPrompt: fixPromptFlag, timeoutMs } = parseArgs(process.argv);

  if (!url) {
    console.error('Usage: driftcheck <url> [--json] [--fix-prompt] [--timeout=<ms>]');
    process.exitCode = 2;
    return;
  }

  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const result = await driftcheck(target, { timeoutMs });
  const fixPrompt = resolveFixPrompt(result.findings, fixPromptFlag);

  if (json) {
    console.log(JSON.stringify({ ...result, fixPrompt }, null, 2));
  } else {
    printReport(result);
    if (fixPrompt) {
      printFixPrompt(fixPrompt);
    }
  }

  process.exitCode = result.passed ? 0 : 1;
}

main().catch((err) => {
  console.error('driftcheck crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
