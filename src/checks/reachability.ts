import type { ReachabilityResult, RedirectHop } from '../types.js';

const USER_AGENT = 'driftcheck/0.1 (+https://github.com/bsrikumar855-dot/DriftCheck)';
const MAX_HOPS = 10;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Fetches a URL and follows redirects manually (rather than letting fetch
 * follow them silently) so we can report the full chain. A long or looping
 * redirect chain is itself a finding worth surfacing, not just noise to
 * discard.
 */
export async function checkReachability(
  inputUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ReachabilityResult> {
  const chain: RedirectHop[] = [];
  let currentUrl = inputUrl;
  let finalStatus = 0;
  let finalHeaders: Record<string, string> = {};
  let error: string | undefined;
  const start = Date.now();

  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(currentUrl, {
          redirect: 'manual',
          headers: { 'user-agent': USER_AGENT },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      chain.push({ url: currentUrl, status: res.status });

      const isRedirect = res.status >= 300 && res.status < 400;
      if (isRedirect) {
        const location = res.headers.get('location');
        if (!location) {
          finalStatus = res.status;
          finalHeaders = Object.fromEntries(res.headers.entries());
          break;
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      finalStatus = res.status;
      finalHeaders = Object.fromEntries(res.headers.entries());
      break;
    }

    if (chain.length === MAX_HOPS) {
      error = `Redirect loop or excessive redirects (stopped after ${MAX_HOPS} hops)`;
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      error = `Request timed out after ${timeoutMs}ms`;
    } else {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const elapsedMs = Date.now() - start;

  return {
    requestedUrl: inputUrl,
    finalUrl: currentUrl,
    finalStatus,
    ok: !error && finalStatus >= 200 && finalStatus < 400,
    redirectChain: chain,
    elapsedMs,
    headers: finalHeaders,
    error,
  };
}
