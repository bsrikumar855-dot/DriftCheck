import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseArgs } from '../src/args.js';
import { resolveFixPrompt } from '../src/fixPrompt.js';
import { printFixPrompt } from '../src/report.js';
import type { Finding } from '../src/types.js';

// argv[0]/argv[1] are node + script path; parseArgs slices them off.
function argv(...args: string[]): string[] {
  return ['node', 'cli.js', ...args];
}

const qualifying: Finding = {
  severity: 'error',
  message: 'Request to https://app.vercel.app/undefined/api/ping has a literal "undefined" in its path — ...',
  code: 'UNDEFINED_IN_PATH',
  data: { url: 'https://app.vercel.app/undefined/api/ping', token: 'undefined', status: 404 },
};

const nonQualifying: Finding = {
  severity: 'error',
  message: 'Got HTTP 401 from a Vercel deployment...',
  code: 'DEPLOYMENT_PROTECTION',
  data: { url: 'https://app.vercel.app', status: 401 },
};

describe('parseArgs', () => {
  it('defaults --fix-prompt to false when absent', () => {
    expect(parseArgs(argv('https://example.com')).fixPrompt).toBe(false);
  });

  it('parses --fix-prompt when present', () => {
    expect(parseArgs(argv('https://example.com', '--fix-prompt')).fixPrompt).toBe(true);
  });

  it('parses --fix-prompt alongside the existing flags without disturbing them', () => {
    const parsed = parseArgs(argv('https://example.com', '--json', '--fix-prompt', '--timeout=5000'));

    expect(parsed.url).toBe('https://example.com');
    expect(parsed.json).toBe(true);
    expect(parsed.fixPrompt).toBe(true);
    expect(parsed.timeoutMs).toBe(5000);
  });

  it('still treats the url as the sole non-flag argument', () => {
    expect(parseArgs(argv('--fix-prompt', 'https://example.com')).url).toBe('https://example.com');
  });
});

describe('CLI output contract — plain mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints nothing extra when the flag is absent', () => {
    const prompt = resolveFixPrompt([qualifying], false);
    expect(prompt).toBeNull();
    // cli.ts only calls printFixPrompt when prompt is non-null, so a null
    // prompt means byte-identical output to a run without the feature.
  });

  it('prints a clearly delimited, copyable block when the flag is present', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const prompt = resolveFixPrompt([qualifying], true);

    expect(prompt).not.toBeNull();
    printFixPrompt(prompt as string);

    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Suggested prompt for your coding agent');
    expect(output).toContain('https://app.vercel.app/undefined/api/ping');
  });

  it('prints nothing extra when the flag is present but nothing qualifies', () => {
    const prompt = resolveFixPrompt([nonQualifying], true);
    expect(prompt).toBeNull();
  });
});

describe('CLI output contract — json mode', () => {
  // Mirrors cli.ts's `JSON.stringify({ ...result, fixPrompt })`.
  function jsonPayload(findings: Finding[], flagPresent: boolean) {
    const fixPrompt = resolveFixPrompt(findings, flagPresent);
    return JSON.parse(JSON.stringify({ findings, fixPrompt }));
  }

  it('has fixPrompt null when the flag is absent, even with a qualifying finding', () => {
    expect(jsonPayload([qualifying], false).fixPrompt).toBeNull();
  });

  it('populates fixPrompt when the flag is present and something qualifies', () => {
    const payload = jsonPayload([qualifying], true);

    expect(typeof payload.fixPrompt).toBe('string');
    expect(payload.fixPrompt).toContain('https://app.vercel.app/undefined/api/ping');
  });

  it('has fixPrompt null when the flag is present but nothing qualifies', () => {
    expect(jsonPayload([nonQualifying], true).fixPrompt).toBeNull();
  });

  it('carries the new code/data fields through serialization', () => {
    const payload = jsonPayload([qualifying], true);

    expect(payload.findings[0].code).toBe('UNDEFINED_IN_PATH');
    expect(payload.findings[0].data.token).toBe('undefined');
    expect(payload.findings[0].data.status).toBe(404);
  });
});
