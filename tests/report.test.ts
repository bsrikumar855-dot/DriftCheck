import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printReport, printFixPrompt } from '../src/report.js';
import type { DriftCheckResult } from '../src/types.js';

describe('report', () => {
  let originalConsoleLog: any;

  beforeEach(() => {
    originalConsoleLog = console.log;
    console.log = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    vi.clearAllMocks();
  });

  describe('printReport', () => {
    it('prints a valid report with all components available', () => {
      const mockResult: DriftCheckResult = {
        passed: false,
        url: 'https://example.com',
        reachability: {
          requestedUrl: 'https://example.com',
          finalUrl: 'https://example.com/redirected',
          finalStatus: 200,
          ok: true,
          redirectChain: [{ url: 'https://example.com', status: 301 }, { url: 'https://example.com/redirected', status: 200 }],
          elapsedMs: 150,
        },
        vercel: {
          isVercel: true,
          region: 'sfo1',
          likelyEnvironment: 'preview',
          environmentReason: 'x-vercel-env header is preview',
          possibleDeploymentProtection: false,
        },
        render: {
          available: true,
          browserSource: 'bundled-chromium',
          playwrightCoreSource: 'bare-specifier',
          requests: [],
          consoleErrors: [],
          bodyText: 'Hello World',
        },
        findings: [
          {
            severity: 'warning',
            message: 'This looks like a PREVIEW deployment, not production.',
            code: 'PREVIEW_ENVIRONMENT',
            data: { url: 'https://example.com/redirected' },
          },
        ],
      };

      printReport(mockResult);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('driftcheck  →  https://example.com'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Final URL:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('https://example.com/redirected'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Redirects:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1 hop(s)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Platform:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vercel (region: sfo1)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Environment:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('preview'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Render check:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('via bundled Chromium'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Findings:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('This looks like a PREVIEW deployment'));
    });

    it('handles non-vercel platform and no redirect', () => {
      const mockResult: DriftCheckResult = {
        passed: true,
        url: 'https://example.com',
        reachability: {
          requestedUrl: 'https://example.com',
          finalUrl: 'https://example.com',
          finalStatus: 200,
          ok: true,
          redirectChain: [{ url: 'https://example.com', status: 200 }],
          elapsedMs: 50,
        },
        vercel: {
          isVercel: false,
        },
        render: {
          available: true,
          browserSource: 'system-chrome',
          playwrightCoreSource: 'global-npm-root',
          requests: [],
          consoleErrors: [],
          bodyText: 'Hello World',
        },
        findings: [],
      };

      printReport(mockResult);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Platform:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('not detected as Vercel'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('via system Chrome (playwright-core resolved from global npm root)'));
    });

    it('handles skipped render check', () => {
      const mockResult: DriftCheckResult = {
        passed: true,
        url: 'https://example.com',
        reachability: {
          requestedUrl: 'https://example.com',
          finalUrl: 'https://example.com',
          finalStatus: 404,
          ok: false,
          redirectChain: [{ url: 'https://example.com', status: 404 }],
          elapsedMs: 50,
        },
        vercel: {
          isVercel: false,
        },
        render: {
          available: false,
          skipReason: 'Playwright not found',
          requests: [],
          consoleErrors: [],
          bodyText: '',
        },
        findings: [
          {
             severity: 'error',
             message: 'Final response was HTTP 404 — not a successful status.',
             code: 'BAD_STATUS',
             data: {}
          }
        ],
      };

      printReport(mockResult);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Render checks skipped — no browser available.'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Playwright not found'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Final response was HTTP 404'));
    });

    it('covers missing response status color', () => {
      const mockResult: DriftCheckResult = {
        passed: true,
        url: 'https://example.com',
        reachability: {
          requestedUrl: 'https://example.com',
          finalUrl: 'https://example.com',
          finalStatus: 0,
          ok: false,
          redirectChain: [],
          elapsedMs: 50,
        },
        vercel: {
          isVercel: false,
        },
        render: {
          available: false,
          skipReason: 'Playwright not found',
          requests: [],
          consoleErrors: [],
          bodyText: '',
        },
        findings: [
          {
             severity: 'info',
             message: 'Some info',
             code: 'INFO',
             data: {}
          }
        ],
      };

      printReport(mockResult);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('no response'));
    });
  });

  describe('printFixPrompt', () => {
    it('prints a fix prompt block', () => {
      printFixPrompt('Fix the preview environment.');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Suggested prompt for your coding agent'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Fix the preview environment.'));
    });
  });
});
