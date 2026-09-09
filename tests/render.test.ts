import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// checkRender dynamically `import()`s playwright-core at call time (deliberately —
// see src/checks/render.ts) rather than statically, specifically so it can be
// absent at runtime for consumers who never installed it. That means these tests
// mock the module per-test with vi.doMock + vi.resetModules rather than a single
// hoisted vi.mock — no real browser or network is touched anywhere here.

describe('checkRender', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('playwright-core');
  });

  it('skips gracefully when playwright-core cannot be imported', async () => {
    vi.doMock('playwright-core', () => {
      throw new Error("Cannot find module 'playwright-core'");
    });

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(false);
    expect(result.skipReason).toMatch(/playwright-core is not installed/i);
    expect(result.skipReason).toMatch(/npm install -g playwright-core/);
    expect(result.requests).toHaveLength(0);
    expect(result.consoleErrors).toHaveLength(0);
  });

  it('skips gracefully when bundled Chromium, system Chrome, and system Edge all fail to launch', async () => {
    const launch = vi.fn().mockRejectedValue(new Error("Executable doesn't exist at .../chromium-1234"));
    vi.doMock('playwright-core', () => ({ chromium: { launch } }));

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(false);
    expect(result.skipReason).toMatch(/could not launch a browser/i);
    expect(result.skipReason).toMatch(/npx playwright install chromium/);
    // all three channels were attempted, in order, before giving up
    expect(launch).toHaveBeenCalledTimes(3);
    expect(launch).toHaveBeenNthCalledWith(1, undefined);
    expect(launch).toHaveBeenNthCalledWith(2, { channel: 'chrome' });
    expect(launch).toHaveBeenNthCalledWith(3, { channel: 'msedge' });
  });

  it('falls back to system Chrome when bundled Chromium is not available', async () => {
    const page = { on: vi.fn(), goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue('') };
    const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('bundled chromium not installed'))
      .mockResolvedValueOnce(browser);
    vi.doMock('playwright-core', () => ({ chromium: { launch } }));

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(true);
    expect(result.browserSource).toBe('system-chrome');
    expect(launch).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenNthCalledWith(2, { channel: 'chrome' });
  });

  it('falls back to system Edge when bundled Chromium and system Chrome both fail', async () => {
    const page = { on: vi.fn(), goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue('') };
    const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('bundled chromium not installed'))
      .mockRejectedValueOnce(new Error('chrome not found'))
      .mockResolvedValueOnce(browser);
    vi.doMock('playwright-core', () => ({ chromium: { launch } }));

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(true);
    expect(result.browserSource).toBe('system-edge');
    expect(launch).toHaveBeenCalledTimes(3);
    expect(launch).toHaveBeenNthCalledWith(3, { channel: 'msedge' });
  });

  it('captures console errors, network requests, and body text on a successful render', async () => {
    const handlers: Record<string, (arg: unknown) => void> = {};
    const closeMock = vi.fn().mockResolvedValue(undefined);

    const page = {
      on: vi.fn((event: string, cb: (arg: unknown) => void) => {
        handlers[event] = cb;
      }),
      goto: vi.fn(async () => {
        (handlers['console'] as (m: { type: () => string; text: () => string }) => void)?.({
          type: () => 'error',
          text: () => 'Uncaught TypeError: boom',
        });
        (handlers['console'] as (m: { type: () => string; text: () => string }) => void)?.({
          type: () => 'log',
          text: () => 'not an error, should be ignored',
        });
        (handlers['response'] as (r: { url: () => string; status: () => number }) => void)?.({
          url: () => 'https://example.com/undefined/api/ping',
          status: () => 404,
        });
        (
          handlers['requestfailed'] as (r: {
            url: () => string;
            failure: () => { errorText: string } | null;
          }) => void
        )?.({
          url: () => 'https://example.com/broken.js',
          failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }),
        });
      }),
      evaluate: vi.fn().mockResolvedValue('Hello world'),
    };

    const launch = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close: closeMock,
    });
    vi.doMock('playwright-core', () => ({ chromium: { launch } }));

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com', 5000);

    expect(result.available).toBe(true);
    expect(result.browserSource).toBe('bundled-chromium');
    expect(result.bodyText).toBe('Hello world');
    expect(result.consoleErrors).toEqual(['Uncaught TypeError: boom']);
    expect(result.requests).toContainEqual({ url: 'https://example.com/undefined/api/ping', status: 404 });
    expect(result.requests).toContainEqual({
      url: 'https://example.com/broken.js',
      status: 0,
      failure: 'net::ERR_CONNECTION_RESET',
    });
    expect(launch).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
  });

  it('still returns captured data and closes the browser if navigation times out', async () => {
    const closeMock = vi.fn().mockResolvedValue(undefined);
    const page = {
      on: vi.fn(),
      goto: vi.fn().mockRejectedValue(new Error('Timeout 10000ms exceeded.')),
      evaluate: vi.fn().mockResolvedValue(''),
    };
    const launch = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close: closeMock,
    });
    vi.doMock('playwright-core', () => ({ chromium: { launch } }));

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(true);
    expect(result.bodyText).toBe('');
    expect(closeMock).toHaveBeenCalled();
  });
});
