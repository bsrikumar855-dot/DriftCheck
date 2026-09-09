import { describe, it, expect } from 'vitest';
import { buildFindings } from '../src/report.js';
import type { ReachabilityResult, RenderCheckResult, VercelIdentity } from '../src/types.js';

function reachability(overrides: Partial<ReachabilityResult> = {}): ReachabilityResult {
  return {
    requestedUrl: 'https://example.com',
    finalUrl: 'https://example.com',
    finalStatus: 200,
    ok: true,
    redirectChain: [{ url: 'https://example.com', status: 200 }],
    elapsedMs: 100,
    headers: {},
    ...overrides,
  };
}

function vercel(overrides: Partial<VercelIdentity> = {}): VercelIdentity {
  return {
    isVercel: false,
    likelyEnvironment: 'unknown',
    environmentReason: 'not Vercel',
    possibleDeploymentProtection: false,
    ...overrides,
  };
}

function render(overrides: Partial<RenderCheckResult> = {}): RenderCheckResult {
  return {
    available: true,
    requests: [],
    consoleErrors: [],
    bodyText: 'some content',
    ...overrides,
  };
}

describe('buildFindings — all-clear message', () => {
  it('shows "no drift detected" when v0.1 and render are both clean', () => {
    const findings = buildFindings({ reachability: reachability(), vercel: vercel(), render: render() });

    expect(findings.some((f) => f.message.includes('No obvious drift detected'))).toBe(true);
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it('does NOT show "no drift detected" when v0.1 is clean but render finds an error', () => {
    // This is the exact contradiction case that was reported: v0.1 alone
    // sees nothing wrong, but the render check names a real broken request.
    const findings = buildFindings({
      reachability: reachability(),
      vercel: vercel(),
      render: render({
        requests: [{ url: 'https://drift-fixture.vercel.app/undefined/api/ping', status: 404 }],
      }),
    });

    expect(findings.some((f) => f.message.includes('No obvious drift detected'))).toBe(false);
    expect(findings.some((f) => f.severity === 'error' && f.message.includes('/undefined/api/ping'))).toBe(
      true
    );
  });

  it('does NOT show "no drift detected" when v0.1 is clean but render only finds a warning', () => {
    const findings = buildFindings({
      reachability: reachability(),
      vercel: vercel(),
      render: render({ consoleErrors: ['some error'] }),
    });

    expect(findings.some((f) => f.message.includes('No obvious drift detected'))).toBe(false);
  });

  it('still shows "no drift detected" when render was skipped — and does not fold the skip reason into findings', () => {
    // A skipped render check doesn't contradict "no drift found" among the
    // checks that did run. The skip itself is surfaced separately (a loud
    // block in printReport, and render.available/skipReason in JSON) — not
    // as an item in the findings list, which is reserved for actual drift.
    const findings = buildFindings({
      reachability: reachability(),
      vercel: vercel(),
      render: render({ available: false, skipReason: 'playwright-core is not installed.' }),
    });

    expect(findings.some((f) => f.message.includes('No obvious drift detected'))).toBe(true);
    expect(findings.some((f) => f.message === 'playwright-core is not installed.')).toBe(false);
    expect(findings).toHaveLength(1);
  });

  it('does not show "no drift detected" when v0.1 itself already found something', () => {
    const findings = buildFindings({
      reachability: reachability({ finalStatus: 500, ok: false }),
      vercel: vercel(),
      render: render({ available: false }),
    });

    expect(findings.some((f) => f.message.includes('No obvious drift detected'))).toBe(false);
  });
});
