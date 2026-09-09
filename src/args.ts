export interface ParsedArgs {
  url?: string;
  json: boolean;
  fixPrompt: boolean;
  timeoutMs?: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const url = args.find((a) => !a.startsWith('--'));
  const json = args.includes('--json');
  const fixPrompt = args.includes('--fix-prompt');
  const timeoutArg = args.find((a) => a.startsWith('--timeout='));
  const timeoutMs = timeoutArg ? Number(timeoutArg.split('=')[1]) : undefined;
  return { url, json, fixPrompt, timeoutMs };
}
