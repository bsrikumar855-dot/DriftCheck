import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDriftcheck = vi.fn();
const mockPrintReport = vi.fn();
const mockPrintFixPrompt = vi.fn();

vi.mock('../src/index.js', () => ({
  driftcheck: mockDriftcheck,
}));

// cli.ts imports printFixPrompt as well as printReport since v0.3.0; the
// mock has to provide both or the import is undefined at call time.
vi.mock('../src/report.js', () => ({
  printReport: mockPrintReport,
  printFixPrompt: mockPrintFixPrompt,
}));

describe('cli', () => {
  let originalArgv: string[];
  let originalExitCode: number | undefined;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.resetModules();
  });

  async function runCli(args: string[]) {
    process.argv = ['node', 'src/cli.ts', ...args];
    await import('../src/cli.js'); // force re-evaluation
    // Wait for the main promise to resolve
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  it('exits with code 2 and prints usage if no url is provided', async () => {
    await runCli([]);

    expect(process.exitCode).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Usage: driftcheck'));
  });

  it('calls driftcheck with default https scheme and prints report when passed', async () => {
    mockDriftcheck.mockResolvedValue({ passed: true });

    await runCli(['example.com']);

    expect(mockDriftcheck).toHaveBeenCalledWith('https://example.com', { timeoutMs: undefined });
    expect(mockPrintReport).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it('preserves http scheme if provided explicitly', async () => {
    mockDriftcheck.mockResolvedValue({ passed: true });

    await runCli(['http://example.com']);

    expect(mockDriftcheck).toHaveBeenCalledWith('http://example.com', { timeoutMs: undefined });
  });

  it('exits with code 1 if driftcheck result.passed is false', async () => {
    mockDriftcheck.mockResolvedValue({ passed: false });

    await runCli(['https://example.com']);

    expect(process.exitCode).toBe(1);
  });

  it('prints json output if --json flag is provided', async () => {
    const mockResult = { passed: true, dummy: 'data' };
    mockDriftcheck.mockResolvedValue(mockResult);

    await runCli(['https://example.com', '--json']);

    // v0.3.0 adds an opt-in `fixPrompt` field to JSON output. Without
    // --fix-prompt it is always null, so the exact payload is asserted
    // with that field present rather than loosening the assertion.
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ ...mockResult, fixPrompt: null }, null, 2));
    expect(mockPrintReport).not.toHaveBeenCalled();
  });

  it('parses --timeout flag', async () => {
    mockDriftcheck.mockResolvedValue({ passed: true });

    await runCli(['https://example.com', '--timeout=5000']);

    expect(mockDriftcheck).toHaveBeenCalledWith('https://example.com', { timeoutMs: 5000 });
  });

  it('handles crashes gracefully', async () => {
    mockDriftcheck.mockRejectedValue(new Error('crash'));

    await runCli(['https://example.com']);

    // Allow the unhandled rejection in cli.ts to be processed
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(console.error).toHaveBeenCalledWith('driftcheck crashed:', 'crash');
    expect(process.exitCode).toBe(2);
  });
});
