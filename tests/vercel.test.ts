import { describe, it, expect } from 'vitest';
import { identifyVercel } from '../src/checks/vercel.js';

describe('identifyVercel', () => {
  it('detects Vercel via the x-vercel-id header and parses region', () => {
    const result = identifyVercel('https://myapp.com', { 'x-vercel-id': 'sfo1::iad1::abc123' }, 200);
    expect(result.isVercel).toBe(true);
    expect(result.region).toBe('sfo1');
  });

  it('does not detect Vercel when no relevant headers are present', () => {
    const result = identifyVercel('https://example.com', {}, 200);
    expect(result.isVercel).toBe(false);
    expect(result.likelyEnvironment).toBe('unknown');
  });

  it('classifies a bare *.vercel.app alias as likely production', () => {
    const result = identifyVercel('https://myapp.vercel.app', { 'x-vercel-id': 'iad1::xyz' }, 200);
    expect(result.likelyEnvironment).toBe('production');
  });

  it('classifies a git-branch preview URL as preview via the -git- marker', () => {
    const result = identifyVercel(
      'https://myapp-git-feature-branch-team.vercel.app',
      { 'x-vercel-id': 'iad1::xyz' },
      200
    );
    expect(result.likelyEnvironment).toBe('preview');
  });

  it('classifies a custom domain as likely production', () => {
    const result = identifyVercel('https://www.myapp.com', { 'x-vercel-id': 'iad1::xyz' }, 200);
    expect(result.likelyEnvironment).toBe('production');
  });

  it('refuses to guess on an ambiguous hyphenated *.vercel.app URL with no -git- marker', () => {
    // This is the important case: a project literally named "my-cool-blog"
    // produces a hyphenated .vercel.app host that is NOT a preview URL.
    // Without an API token we cannot tell the difference from the outside,
    // so driftcheck must say "unknown" rather than confidently guess wrong.
    const result = identifyVercel('https://my-cool-blog.vercel.app', { 'x-vercel-id': 'iad1::xyz' }, 200);
    expect(result.likelyEnvironment).toBe('unknown');
  });

  it('flags a 401 on a confirmed-Vercel response as possible deployment protection', () => {
    const result = identifyVercel('https://myapp.vercel.app', { 'x-vercel-id': 'iad1::xyz' }, 401);
    expect(result.possibleDeploymentProtection).toBe(true);
  });

  it('does not flag deployment protection on a non-Vercel 401', () => {
    const result = identifyVercel('https://example.com', {}, 401);
    expect(result.possibleDeploymentProtection).toBe(false);
  });
});
