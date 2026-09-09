#!/usr/bin/env node
import { driftcheck } from './index.js';
import { printReport } from './report.js';

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const json = args.includes('--json');
  const timeoutArg = args.find((a) => a.startsWith('--timeout='));
  const timeoutMs = timeoutArg ? Number(timeoutArg.split('=')[1]) : undefined;
  return { url, json, timeoutMs };
}

async function main() {
  const { url, json, timeoutMs } = parseArgs(process.argv);

  if (!url) {
    console.error('Usage: driftcheck <url> [--json] [--timeout=<ms>]');
    process.exitCode = 2;
    return;
  }

  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  const result = await driftcheck(target, { timeoutMs });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }

  process.exitCode = result.passed ? 0 : 1;
}

main().catch((err) => {
  console.error('driftcheck crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
