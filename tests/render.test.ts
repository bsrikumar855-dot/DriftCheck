import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promisify } from 'node:util';

// checkRender dynamically `import()`s playwright-core at call time (deliberately —
// see src/checks/render.ts) rather than statically, specifically so it can be
// absent at runtime for consumers who never installed it. That means these tests
// mock the module per-test with vi.doMock + vi.resetModules rather than a single
// hoisted vi.mock — no real browser or network is touched anywhere here.
//
// The global-npm-root fallback path is exercised with mocked
// node:child_process / node:fs/promises — no real global install or real
// filesystem paths are touched.

function mockExec(resolution: { stdout?: string; reject?: Error }) {
  const fn = ((..._args: unknown[]) => {
    throw new Error('mockExec should only be invoked via its promisify.custom implementation');
  }) as unknown as typeof import('node:child_process').exec & Record<PropertyKey, unknown>;
  fn[promisify.custom] = vi.fn(() =>
    resolution.reject ? Promise.reject(resolution.reject) : Promise.resolve({ stdout: resolution.stdout ?? '', stderr: '' })
  );
  vi.doMock('node:child_process', () => ({ exec: fn }));
  return fn;
}

function mockReadFile(resolution: { value?: string; reject?: Error }) {
  const readFileMock = vi.fn(() =>
    resolution.reject ? Promise.reject(resolution.reject) : Promise.resolve(resolution.value ?? '')
  );
  vi.doMock('node:fs/promises', () => ({ default: { readFile: readFileMock }, readFile: readFileMock }));
  return readFileMock;
}

describe('checkRender', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('playwright-core');
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs/promises');
  });

  it('skips gracefully when playwright-core cannot be imported anywhere (bare specifier and global root both fail)', async () => {
    vi.doMock('playwright-core', () => {
      throw new Error("Cannot find module 'playwright-core'");
    });
    mockExec({ reject: new Error("'npm' is not recognized as an internal or external command") });

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(false);
    expect(result.skipReason).toMatch(/playwright-core is not installed/i);
    expect(result.skipReason).toMatch(/checked both a local\/project install and the global npm root/i);
    expect(result.skipReason).toMatch(/npm install -g playwright-core/);
    expect(result.requests).toHaveLength(0);
    expect(result.consoleErrors).toHaveLength(0);
  });

  it('does not attempt the global-root fallback at all when the bare specifier succeeds', async () => {
    const page = { on: vi.fn(), goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue('') };
    const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) };
    const launch = vi.fn().mockResolvedValue(browser);
    vi.doMock('playwright-core', () => ({ chromium: { launch } }));
    const execMock = mockExec({ stdout: '/should/not/be/used\n' });

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(true);
    expect(result.playwrightCoreSource).toBe('bare-specifier');
    expect(execMock[promisify.custom]).not.toHaveBeenCalled();
  });

  it('falls back to the global npm root when the bare specifier fails, resolving via the exports "import" condition', async () => {
    vi.doMock('playwright-core', () => {
      throw new Error("Cannot find module 'playwright-core'");
    });

    // The dynamic `import()` of an absolute path can't be faked through
    // vi.doMock (the target has to actually resolve on disk), so this
    // points at a small, real, committed fixture module rather than a
    // fabricated path — everything else (exec, readFile) stays mocked.
    const globalRoot = path.join(process.cwd(), 'tests', 'fixtures', 'fake-global-root');
    mockExec({ stdout: `${globalRoot}\n` });

    const pkgJson = { exports: { '.': { import: 'fake-index.mjs', require: 'fake-index.js' } } };
    const readFileMock = mockReadFile({ value: JSON.stringify(pkgJson) });

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(true);
    expect(result.playwrightCoreSource).toBe('global-npm-root');
    expect(result.browserSource).toBe('bundled-chromium');
    expect(result.bodyText).toBe('fixture body text');
    expect(readFileMock).toHaveBeenCalledWith(
      path.join(globalRoot, 'playwright-core', 'package.json'),
      'utf-8'
    );
  });

  it('degrades to skip, without crashing, when `npm root -g` itself fails (npm not on PATH)', async () => {
    vi.doMock('playwright-core', () => {
      throw new Error("Cannot find module 'playwright-core'");
    });
    mockExec({ reject: new Error('spawn npm ENOENT') });

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(false);
    expect(result.skipReason).toMatch(/playwright-core is not installed/i);
  });

  it('degrades to skip, without crashing, when the global root is found but package.json is missing there', async () => {
    vi.doMock('playwright-core', () => {
      throw new Error("Cannot find module 'playwright-core'");
    });
    mockExec({ stdout: '/some/global/root\n' });
    mockReadFile({ reject: Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }) });

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(false);
    expect(result.skipReason).toMatch(/playwright-core is not installed/i);
  });

  it('degrades to skip, without crashing, when the global package.json is malformed JSON', async () => {
    vi.doMock('playwright-core', () => {
      throw new Error("Cannot find module 'playwright-core'");
    });
    mockExec({ stdout: '/some/global/root\n' });
    mockReadFile({ value: '{ this is not valid json' });

    const { checkRender } = await import('../src/checks/render.js');
    const result = await checkRender('https://example.com');

    expect(result.available).toBe(false);
    expect(result.skipReason).toMatch(/playwright-core is not installed/i);
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
