import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { BrowserSource, PlaywrightCoreSource, RenderCheckResult, RenderRequestRecord } from '../types.js';

const execAsync = promisify(exec);
const DEFAULT_TIMEOUT_MS = 10_000;

/** playwright-core refuses to load below this and exits the process. */
const MIN_PLAYWRIGHT_NODE_MAJOR = 20;

/**
 * playwright-core is NOT a declared dependency of this package (not even an
 * optional one) — that's deliberate. Declaring it at all, even as
 * "optional", makes npm attempt to fetch it on every `npx driftcheck`
 * install. This check only runs if the user has separately installed
 * playwright-core (and, optionally, a browser) themselves; otherwise it
 * degrades to a skip reason and the rest of driftcheck is unaffected.
 */
function empty(skipReason?: string): RenderCheckResult {
  return { available: false, skipReason, requests: [], consoleErrors: [], bodyText: '' };
}

type PlaywrightCoreModule = typeof import('playwright-core');

/**
 * `npx driftcheck <url>` runs from an isolated npx cache tree containing
 * only driftcheck's own declared dependencies — its ancestor directories
 * have nothing to do with either a project-local or a global npm install,
 * so a bare `import('playwright-core')` can only ever succeed when it
 * happens to sit in an ancestor node_modules (this repo's own
 * devDependency, or a project that installed driftcheck and
 * playwright-core as siblings). For the `npx`-from-nowhere case, ask npm
 * directly where its global root is and import from that absolute path.
 * NODE_PATH is not an option here — Node's ESM resolver ignores it
 * entirely (documented, CJS-only behavior).
 *
 * Uses `exec` (a shell command string), not `execFile`: on Windows, `npm`
 * resolves to `npm.cmd`, which `execFile` cannot run without shell
 * involvement (confirmed directly — it fails with ENOENT every time).
 * `exec` goes through a shell by construction, with none of `execFile`'s
 * "args array + shell:true" combination that triggers Node's argument-
 * escaping deprecation warning — safe here regardless, since the command
 * is a fixed literal with no interpolated input.
 */
async function resolvePlaywrightCore(): Promise<
  { module: PlaywrightCoreModule; source: PlaywrightCoreSource } | undefined
> {
  try {
    const module = (await import('playwright-core')) as PlaywrightCoreModule;
    return { module, source: 'bare-specifier' };
  } catch {
    // fall through to the global npm root below
  }

  try {
    const { stdout } = await execAsync('npm root -g', { timeout: 5000 });
    const globalRoot = stdout.trim();
    const pkgDir = path.join(globalRoot, 'playwright-core');
    const pkgJsonPath = path.join(pkgDir, 'package.json');

    const pkgJsonRaw = await fs.readFile(pkgJsonPath, 'utf-8');
    const pkgJson = JSON.parse(pkgJsonRaw);

    // playwright-core (1.63.x) ships no top-level "main" at all — only an
    // "exports" map, where "." -> import/require/default. A bare `import()`
    // resolves the "import" condition automatically; since we're bypassing
    // normal resolution to import from a raw absolute path, we replicate
    // just that one condition ourselves rather than a full exports
    // resolver: import -> default -> legacy "main" -> "index.js" as a last
    // resort for hypothetical older/simpler versions.
    const dotExport = pkgJson.exports?.['.'];
    const entryRelative: string =
      (typeof dotExport === 'string' ? dotExport : (dotExport?.import ?? dotExport?.default)) ??
      pkgJson.main ??
      'index.js';
    const entryAbsolute = path.join(pkgDir, entryRelative);

    const module = (await import(pathToFileURL(entryAbsolute).href)) as PlaywrightCoreModule;
    return { module, source: 'global-npm-root' };
  } catch {
    return undefined;
  }
}

type LaunchAttempt = {
  source: BrowserSource;
  label: string;
  options?: Parameters<PlaywrightCoreModule['chromium']['launch']>[0];
};

const LAUNCH_ATTEMPTS: LaunchAttempt[] = [
  { source: 'bundled-chromium', label: 'bundled Chromium' },
  { source: 'system-chrome', label: 'system Chrome', options: { channel: 'chrome' } },
  { source: 'system-edge', label: 'system Edge', options: { channel: 'msedge' } },
];

/**
 * Tries a pinned, downloaded Chromium first (deterministic, if the user ran
 * `playwright install`), then falls back to whatever browser the user
 * already has — most devs have Chrome or Edge installed, and that makes the
 * full check the default experience for them with zero extra download.
 */
async function launchBrowser(
  playwrightCore: PlaywrightCoreModule
): Promise<{ browser: import('playwright-core').Browser; source: BrowserSource } | undefined> {
  for (const attempt of LAUNCH_ATTEMPTS) {
    try {
      const browser = await playwrightCore.chromium.launch(attempt.options);
      return { browser, source: attempt.source };
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Loads the URL in a real (headless) browser, waits for the network to go
 * idle, and passively observes what happened — no clicking, no scripted
 * interaction. Findings are derived from this raw data in report.ts, same
 * as every other check.
 */
export async function checkRender(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RenderCheckResult> {
  // playwright-core calls process.exit() at import time on Node < 20 rather
  // than throwing, so the try/catch around the dynamic import below cannot
  // save us — the whole CLI dies before printing anything. Checked here so
  // Node 18 users get the normal skip path instead of a hard crash, which
  // is what makes this package's `engines: >=18` claim actually true.
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < MIN_PLAYWRIGHT_NODE_MAJOR) {
    return empty(
      `Render check requires Node ${MIN_PLAYWRIGHT_NODE_MAJOR}+ (running Node ${process.versions.node}) — playwright-core exits the process on older versions instead of failing gracefully. Reachability and platform identity are unaffected.`
    );
  }

  const resolved = await resolvePlaywrightCore();
  if (!resolved) {
    return empty(
      'playwright-core is not installed (checked both a local/project install and the global npm root). ' +
        'Run `npm install -g playwright-core && npx playwright install chromium` to enable console/network error detection — ' +
        "if it still doesn't work afterward, check that `npm` is on PATH and that you don't have a non-standard global prefix."
    );
  }
  const { module: playwrightCore, source: playwrightCoreSource } = resolved;

  const launched = await launchBrowser(playwrightCore);
  if (!launched) {
    return empty(
      `Could not launch a browser — tried ${LAUNCH_ATTEMPTS.map((a) => a.label).join(', ')}, none available. Run \`npx playwright install chromium\` to install one.`
    );
  }

  const { browser, source } = launched;
  const requests: RenderRequestRecord[] = [];
  const consoleErrors: string[] = [];

  try {
    const page = await browser.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('response', (res) => {
      requests.push({ url: res.url(), status: res.status() });
    });

    page.on('requestfailed', (req) => {
      requests.push({ url: req.url(), status: 0, failure: req.failure()?.errorText });
    });

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    } catch {
      // A page that never fully idles (polling, open sockets) isn't itself a
      // finding — inspect whatever was captured up to the timeout.
    }

    const bodyText = await page
      .evaluate(() => document.body?.innerText?.trim() ?? '')
      .catch(() => '');

    return { available: true, browserSource: source, playwrightCoreSource, requests, consoleErrors, bodyText };
  } finally {
    await browser.close();
  }
}
