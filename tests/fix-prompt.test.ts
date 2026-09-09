import { describe, it, expect } from 'vitest';
import { buildFixPrompt, resolveFixPrompt } from '../src/fixPrompt.js';
import type { Finding } from '../src/types.js';

const undefinedInPath: Finding = {
  severity: 'error',
  message: 'Request to https://app.vercel.app/undefined/api/ping has a literal "undefined" in its path — ...',
  code: 'UNDEFINED_IN_PATH',
  data: { url: 'https://app.vercel.app/undefined/api/ping', token: 'undefined', status: 404 },
};

const localhostInProd: Finding = {
  severity: 'error',
  message: 'Request to http://localhost:3000/api/data targets localhost — ...',
  code: 'LOCALHOST_IN_PROD',
  data: { url: 'http://localhost:3000/api/data', status: 200, deploymentOrigin: 'https://app.vercel.app' },
};

const sameOriginError: Finding = {
  severity: 'error',
  message: 'Same-origin request to https://app.vercel.app/api/broken returned HTTP 500.',
  code: 'SAME_ORIGIN_ERROR',
  data: { url: 'https://app.vercel.app/api/broken', status: 500 },
};

const consoleError: Finding = {
  severity: 'warning',
  message: 'Console error: Uncaught TypeError: x is not a function',
  code: 'CONSOLE_ERROR',
  data: { text: 'Uncaught TypeError: x is not a function', url: 'https://app.vercel.app' },
};

const deploymentProtection: Finding = {
  severity: 'error',
  message: 'Got HTTP 401 from a Vercel deployment...',
  code: 'DEPLOYMENT_PROTECTION',
  data: { url: 'https://app.vercel.app', status: 401 },
};

const previewEnvironment: Finding = {
  severity: 'warning',
  message: 'This looks like a PREVIEW deployment, not production...',
  code: 'PREVIEW_ENVIRONMENT',
  data: { url: 'https://app-git-x.vercel.app', reason: 'contains -git-' },
};

const badStatus: Finding = {
  severity: 'error',
  message: 'Final response was HTTP 500 — not a successful status.',
  code: 'BAD_STATUS',
  data: { url: 'https://app.vercel.app', status: 500 },
};

const redirectChain: Finding = {
  severity: 'warning',
  message: '5 redirect hops before reaching a final response...',
  code: 'REDIRECT_CHAIN',
  data: { url: 'https://app.vercel.app', hops: 5 },
};

const allClear: Finding = {
  severity: 'info',
  message: 'Reachable, responded with a successful status. No obvious drift detected at this check level.',
  code: 'ALL_CLEAR',
  data: { url: 'https://app.vercel.app', status: 200 },
};

const blankRender: Finding = {
  severity: 'warning',
  message: 'Page body has no rendered text content after load — possible blank render.',
  code: 'BLANK_RENDER',
  data: { url: 'https://app.vercel.app' },
};

describe('buildFixPrompt — qualifying findings', () => {
  it('builds a prompt for UNDEFINED_IN_PATH using the real evidence', () => {
    const prompt = buildFixPrompt([undefinedInPath]);

    expect(prompt).not.toBeNull();
    expect(prompt).toContain('https://app.vercel.app/undefined/api/ping');
    expect(prompt).toContain('"undefined"');
    expect(prompt).toContain('404');
    expect(prompt).toContain('process.env.');
    // hedging must survive
    expect(prompt).toContain("Investigate, don't fix blindly");
    expect(prompt).toContain('It could be a name mismatch, not a missing value.');
  });

  it('builds a prompt for LOCALHOST_IN_PROD', () => {
    const prompt = buildFixPrompt([localhostInProd]);

    expect(prompt).toContain('http://localhost:3000/api/data');
    expect(prompt).toContain('hardcoded development URL');
    expect(prompt).toContain('confirm the');
  });

  it('builds a prompt for SAME_ORIGIN_ERROR', () => {
    const prompt = buildFixPrompt([sameOriginError]);

    expect(prompt).toContain('https://app.vercel.app/api/broken');
    expect(prompt).toContain('500');
    expect(prompt).toContain('Same-origin means this is very likely a bug in this codebase');
    expect(prompt).toContain('does it fail locally too?');
  });

  it('builds a prompt for CONSOLE_ERROR that hedges harder than the others', () => {
    const prompt = buildFixPrompt([consoleError]);

    expect(prompt).toContain('Uncaught TypeError: x is not a function');
    expect(prompt).toContain('weaker evidence than the other finding types');
    expect(prompt).toContain('third-party');
    expect(prompt).toContain('Investigate before changing anything');
  });
});

describe('buildFixPrompt — non-qualifying findings', () => {
  it.each([
    ['DEPLOYMENT_PROTECTION', deploymentProtection],
    ['PREVIEW_ENVIRONMENT', previewEnvironment],
    ['BAD_STATUS', badStatus],
    ['REDIRECT_CHAIN', redirectChain],
    ['ALL_CLEAR', allClear],
    ['BLANK_RENDER', blankRender],
  ])('returns null for %s alone — not a code-fixable problem', (_code, finding) => {
    expect(buildFixPrompt([finding])).toBeNull();
  });

  it('returns null for a mix of only non-qualifying findings', () => {
    expect(buildFixPrompt([deploymentProtection, previewEnvironment, badStatus, allClear])).toBeNull();
  });

  it('returns null for an empty finding list', () => {
    expect(buildFixPrompt([])).toBeNull();
  });

  it('returns null for findings carrying no code at all', () => {
    expect(buildFixPrompt([{ severity: 'error', message: 'untagged legacy finding' }])).toBeNull();
  });

  it('ignores non-qualifying findings when mixed with qualifying ones', () => {
    const prompt = buildFixPrompt([deploymentProtection, undefinedInPath, previewEnvironment]);

    expect(prompt).toContain('https://app.vercel.app/undefined/api/ping');
    expect(prompt).not.toContain('Deployment Protection');
    expect(prompt).not.toContain('PREVIEW');
    // only one qualified, so it stays in single-finding form
    expect(prompt).not.toContain('### 1.');
  });
});

describe('buildFixPrompt — multiple qualifying findings', () => {
  it('combines them into one prompt with numbered sections and a shared closing', () => {
    const prompt = buildFixPrompt([undefinedInPath, sameOriginError, consoleError]);

    expect(prompt).toContain('driftcheck found 3 issues');
    expect(prompt).toContain('### 1. Literal "undefined" in a request path');
    expect(prompt).toContain('### 2. Same-origin request failing with HTTP 500');
    expect(prompt).toContain('### 3. Console error on page load');
    expect(prompt).toContain('do not assume they share');

    // every finding's own evidence still present
    expect(prompt).toContain('https://app.vercel.app/undefined/api/ping');
    expect(prompt).toContain('https://app.vercel.app/api/broken');
    expect(prompt).toContain('Uncaught TypeError: x is not a function');
  });

  it('does not add numbering or a closing line for a single finding', () => {
    const prompt = buildFixPrompt([undefinedInPath]);

    expect(prompt).not.toContain('### 1.');
    expect(prompt).not.toContain('do not assume they share');
    expect(prompt).not.toContain('driftcheck found 1 issues');
  });
});

describe('buildFixPrompt — deduping findings that share the same evidence', () => {
  // The real fixture produces exactly this: one request to
  // /undefined/api/ping that 404s trips both the path check and the
  // same-origin check. One problem, two observations.
  const sharedUrl = 'https://drift-fixture.vercel.app/undefined/api/ping';
  const undefinedSameRequest: Finding = {
    severity: 'error',
    message: `Request to ${sharedUrl} has a literal "undefined" in its path — ...`,
    code: 'UNDEFINED_IN_PATH',
    data: { url: sharedUrl, token: 'undefined', status: 404 },
  };
  const sameOriginSameRequest: Finding = {
    severity: 'error',
    message: `Same-origin request to ${sharedUrl} returned HTTP 404.`,
    code: 'SAME_ORIGIN_ERROR',
    data: { url: sharedUrl, status: 404 },
  };

  it('collapses two findings sharing url+status into ONE section, not two', () => {
    const prompt = buildFixPrompt([undefinedSameRequest, sameOriginSameRequest]) as string;

    // single group ⇒ single-finding form, no numbering at all
    expect(prompt).not.toContain('### 1.');
    expect(prompt).not.toContain('### 2.');
    expect(prompt).not.toContain('driftcheck found 2 issues');
  });

  it('leads with UNDEFINED_IN_PATH, the more specific signal', () => {
    const prompt = buildFixPrompt([sameOriginSameRequest, undefinedSameRequest]) as string;

    // the more actionable section wins regardless of input order
    expect(prompt).toContain('contains the literal token');
    expect(prompt).toContain("Investigate, don't fix blindly");
    expect(prompt).not.toContain('Same-origin means this is very likely a bug in this codebase');
  });

  it('folds the deduped evidence in as a corroborating note rather than dropping it', () => {
    const prompt = buildFixPrompt([undefinedSameRequest, sameOriginSameRequest]) as string;

    expect(prompt).toContain('same-origin check also flagged this exact request (HTTP 404)');
    expect(prompt).toContain('independent second problem');
    expect(prompt).toContain('investigate it once');
  });

  it('does NOT dedupe CONSOLE_ERROR against a network finding on the same page', () => {
    const prompt = buildFixPrompt([undefinedSameRequest, sameOriginSameRequest, consoleError]) as string;

    // two distinct issues: the merged request one, and the console one
    expect(prompt).toContain('driftcheck found 2 issues');
    expect(prompt).toContain('### 1. Literal "undefined" in a request path');
    expect(prompt).toContain('### 2. Console error on page load');
    expect(prompt).toContain('Uncaught TypeError: x is not a function');
  });

  it('does not merge findings on the same url with different statuses', () => {
    const other: Finding = {
      severity: 'error',
      message: 'Same-origin request returned HTTP 500.',
      code: 'SAME_ORIGIN_ERROR',
      data: { url: sharedUrl, status: 500 },
    };
    const prompt = buildFixPrompt([undefinedSameRequest, other]) as string;

    expect(prompt).toContain('driftcheck found 2 issues');
  });

  it('does not merge findings on different urls with the same status', () => {
    const other: Finding = {
      severity: 'error',
      message: 'Same-origin request to /api/other returned HTTP 404.',
      code: 'SAME_ORIGIN_ERROR',
      data: { url: 'https://drift-fixture.vercel.app/api/other', status: 404 },
    };
    const prompt = buildFixPrompt([undefinedSameRequest, other]) as string;

    expect(prompt).toContain('driftcheck found 2 issues');
  });

  it('leaves findings lacking a status ungrouped rather than guessing', () => {
    const noStatus: Finding = {
      severity: 'error',
      message: 'Request targets localhost...',
      code: 'LOCALHOST_IN_PROD',
      data: { url: sharedUrl },
    };
    const prompt = buildFixPrompt([undefinedSameRequest, noStatus]) as string;

    expect(prompt).toContain('driftcheck found 2 issues');
  });
});

describe('resolveFixPrompt — the opt-in gate', () => {
  it('returns null when the flag is absent, even with a qualifying finding', () => {
    expect(resolveFixPrompt([undefinedInPath], false)).toBeNull();
  });

  it('returns a prompt when the flag is present and something qualifies', () => {
    const prompt = resolveFixPrompt([undefinedInPath], true);
    expect(prompt).toContain('https://app.vercel.app/undefined/api/ping');
  });

  it('returns null when the flag is present but nothing qualifies', () => {
    expect(resolveFixPrompt([deploymentProtection], true)).toBeNull();
  });
});
