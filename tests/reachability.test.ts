import { describe, it, expect, afterEach, vi } from 'vitest';
import { checkReachability } from '../src/checks/reachability.js';

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: new Headers(headers),
  } as Response;
}

describe('checkReachability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports ok for a simple 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse(200, { 'x-vercel-id': 'sfo1::abc123' }))
    );

    const result = await checkReachability('https://example.com');

    expect(result.ok).toBe(true);
    expect(result.finalStatus).toBe(200);
    expect(result.redirectChain).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  it('follows a single redirect to a final 200 and records the chain', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(308, { location: 'https://example.com/final' }))
      .mockResolvedValueOnce(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkReachability('https://example.com/old');

    expect(result.ok).toBe(true);
    expect(result.finalUrl).toBe('https://example.com/final');
    expect(result.redirectChain).toHaveLength(2);
    expect(result.redirectChain[0].status).toBe(308);
    expect(result.redirectChain[1].status).toBe(200);
  });

  it('resolves relative Location headers against the current URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(307, { location: '/new-path' }))
      .mockResolvedValueOnce(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkReachability('https://example.com/old');

    expect(result.finalUrl).toBe('https://example.com/new-path');
  });

  it('reports not-ok for a non-2xx/3xx final status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(500, {})));

    const result = await checkReachability('https://example.com');

    expect(result.ok).toBe(false);
    expect(result.finalStatus).toBe(500);
  });

  it('flags a redirect with no Location header as a stopping point', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(302, {})));

    const result = await checkReachability('https://example.com');

    expect(result.finalStatus).toBe(302);
    expect(result.redirectChain).toHaveLength(1);
  });

  it('detects a redirect loop and reports an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(302, { location: 'https://example.com/loop' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkReachability('https://example.com/loop');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/redirect loop/i);
  });

  it('captures network errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND example.invalid')));

    const result = await checkReachability('https://example.invalid');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });
});
