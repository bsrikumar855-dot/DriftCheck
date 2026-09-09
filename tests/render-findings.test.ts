import { describe, it, expect } from 'vitest';
import { renderFindings } from '../src/report.js';
import type { RenderCheckResult } from '../src/types.js';

function render(overrides: Partial<RenderCheckResult> = {}): RenderCheckResult {
  return {
    available: true,
    requests: [],
    consoleErrors: [],
    bodyText: 'some rendered content',
    ...overrides,
  };
}

describe('renderFindings', () => {
  it('returns nothing when the check was never attempted (no skip reason)', () => {
    const findings = renderFindings('https://example.com', render({ available: false }));
    expect(findings).toHaveLength(0);
  });

  it('returns nothing when the check was skipped with a reason — that is surfaced separately, not as a finding', () => {
    const findings = renderFindings(
      'https://example.com',
      render({ available: false, skipReason: 'playwright-core is not installed.' })
    );
    expect(findings).toHaveLength(0);
  });

  it('flags a request whose path contains a literal "undefined" segment', () => {
    const findings = renderFindings(
      'https://drift-fixture.vercel.app',
      render({
        requests: [{ url: 'https://drift-fixture.vercel.app/undefined/api/ping', status: 404 }],
      })
    );

    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(2); // literal-undefined-in-path AND same-origin 4xx
    expect(errors.some((f) => f.message.includes('https://drift-fixture.vercel.app/undefined/api/ping'))).toBe(
      true
    );
    expect(errors.some((f) => f.message.includes('literal "undefined"'))).toBe(true);
  });

  it('flags a request whose path contains a literal "null" segment', () => {
    const findings = renderFindings(
      'https://example.com',
      render({ requests: [{ url: 'https://example.com/null/api/config', status: 200 }] })
    );
    expect(findings.some((f) => f.severity === 'error' && f.message.includes('literal "null"'))).toBe(true);
  });

  it('flags a request whose path contains an encoded "[object Object]" segment', () => {
    const findings = renderFindings(
      'https://example.com',
      render({ requests: [{ url: 'https://example.com/[object%20Object]/save', status: 200 }] })
    );
    expect(
      findings.some((f) => f.severity === 'error' && f.message.includes('literal "[object%20Object]"'))
    ).toBe(true);
  });

  it('does not flag a normal, healthy request', () => {
    const findings = renderFindings(
      'https://example.com',
      render({ requests: [{ url: 'https://example.com/api/data', status: 200 }] })
    );
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it('flags a request to localhost from a deployed (non-localhost) origin', () => {
    const findings = renderFindings(
      'https://myapp.vercel.app',
      render({ requests: [{ url: 'http://localhost:3000/api/data', status: 200 }] })
    );
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('http://localhost:3000/api/data');
    expect(errors[0].message).toContain('hardcoded dev URL');
  });

  it('does not flag localhost requests when the target itself is localhost', () => {
    const findings = renderFindings(
      'http://localhost:3000',
      render({ requests: [{ url: 'http://localhost:3000/api/data', status: 200 }] })
    );
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it('flags a same-origin 4xx/5xx request but not a cross-origin one', () => {
    const findings = renderFindings(
      'https://myapp.com',
      render({
        requests: [
          { url: 'https://myapp.com/api/broken', status: 500 },
          { url: 'https://cdn.thirdparty.com/tracker.js', status: 404 },
        ],
      })
    );
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('https://myapp.com/api/broken');
    expect(errors[0].message).toContain('500');
  });

  it('reports each console error as a warning with the exact text', () => {
    const findings = renderFindings(
      'https://example.com',
      render({ consoleErrors: ['Uncaught TypeError: Cannot read properties of undefined'] })
    );
    // objectContaining, not exact equality: findings also carry additive
    // code/data metadata now. The message text asserted here is unchanged.
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: 'Console error: Uncaught TypeError: Cannot read properties of undefined',
      })
    );
  });

  it('warns on a blank render (empty body text)', () => {
    const findings = renderFindings('https://example.com', render({ bodyText: '' }));
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: 'Page body has no rendered text content after load — possible blank render.',
      })
    );
  });

  it('does not warn about blank render when the page has visible content', () => {
    const findings = renderFindings('https://example.com', render({ bodyText: 'Hello world' }));
    expect(findings.some((f) => f.message.includes('blank render'))).toBe(false);
  });

  it('produces no findings at all for a clean, healthy page', () => {
    const findings = renderFindings(
      'https://example.com',
      render({ requests: [{ url: 'https://example.com/api/ok', status: 200 }] })
    );
    expect(findings).toHaveLength(0);
  });
});
