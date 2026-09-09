import { describe, it, expect, vi, beforeEach } from 'vitest';
import { driftcheck } from '../src/index.js';
import * as reachabilityModule from '../src/checks/reachability.js';
import * as vercelModule from '../src/checks/vercel.js';
import * as renderModule from '../src/checks/render.js';
import * as reportModule from '../src/report.js';
import type { Finding } from '../src/types.js';

vi.mock('../src/checks/reachability.js');
vi.mock('../src/checks/vercel.js');
vi.mock('../src/checks/render.js');
vi.mock('../src/report.js');

describe('driftcheck', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs all checks and passes when there are no error findings', async () => {
    vi.mocked(reachabilityModule.checkReachability).mockResolvedValue({
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com',
      finalStatus: 200,
      ok: true,
      redirectChain: [],
      elapsedMs: 100,
      headers: {},
    });
    vi.mocked(vercelModule.identifyVercel).mockReturnValue({
      isVercel: true,
      likelyEnvironment: 'production',
      environmentReason: 'reason',
      possibleDeploymentProtection: false,
    });
    vi.mocked(renderModule.checkRender).mockResolvedValue({
      available: true,
      requests: [],
      consoleErrors: [],
      bodyText: 'text',
    });
    vi.mocked(reportModule.buildFindings).mockReturnValue([
      { severity: 'info', message: 'All good' } as Finding,
    ]);

    const result = await driftcheck('https://example.com');

    expect(result.url).toBe('https://example.com');
    expect(result.passed).toBe(true);
    expect(reachabilityModule.checkReachability).toHaveBeenCalledWith('https://example.com', undefined);
    expect(renderModule.checkRender).toHaveBeenCalledWith('https://example.com', undefined);
    expect(reportModule.buildFindings).toHaveBeenCalled();
  });

  it('fails when there is an error finding', async () => {
    vi.mocked(reachabilityModule.checkReachability).mockResolvedValue({
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com',
      finalStatus: 200,
      ok: true,
      redirectChain: [],
      elapsedMs: 100,
      headers: {},
    });
    vi.mocked(vercelModule.identifyVercel).mockReturnValue({
      isVercel: false,
      likelyEnvironment: 'unknown',
      environmentReason: 'reason',
      possibleDeploymentProtection: false,
    });
    vi.mocked(renderModule.checkRender).mockResolvedValue({
      available: true,
      requests: [],
      consoleErrors: [],
      bodyText: 'text',
    });
    vi.mocked(reportModule.buildFindings).mockReturnValue([
      { severity: 'error', message: 'Broken' } as Finding,
    ]);

    const result = await driftcheck('https://example.com');

    expect(result.passed).toBe(false);
  });

  it('skips render check if reachability is not ok', async () => {
    vi.mocked(reachabilityModule.checkReachability).mockResolvedValue({
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com',
      finalStatus: 500,
      ok: false,
      redirectChain: [],
      elapsedMs: 100,
      headers: {},
    });
    vi.mocked(vercelModule.identifyVercel).mockReturnValue({
      isVercel: false,
      likelyEnvironment: 'unknown',
      environmentReason: 'reason',
      possibleDeploymentProtection: false,
    });
    vi.mocked(reportModule.buildFindings).mockReturnValue([]);

    const result = await driftcheck('https://example.com');

    expect(result.render.available).toBe(false);
    expect(renderModule.checkRender).not.toHaveBeenCalled();
    expect(result.passed).toBe(true);
  });
});
