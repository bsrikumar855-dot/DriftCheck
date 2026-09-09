import type { BrowserSource, RenderCheckResult, RenderRequestRecord } from '../types.js';

const DEFAULT_TIMEOUT_MS = 10_000;

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

type LaunchAttempt = {
  source: BrowserSource;
  label: string;
  options?: Parameters<typeof import('playwright-core').chromium.launch>[0];
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
  playwrightCore: typeof import('playwright-core')
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
  let playwrightCore: typeof import('playwright-core');
  try {
    playwrightCore = await import('playwright-core');
  } catch {
    return empty(
      'playwright-core is not installed. Run `npm install -g playwright-core && npx playwright install chromium` to enable console/network error detection.'
    );
  }

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

    return { available: true, browserSource: source, requests, consoleErrors, bodyText };
  } finally {
    await browser.close();
  }
}
