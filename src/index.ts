import { checkReachability } from './checks/reachability.js';
import { identifyVercel } from './checks/vercel.js';
import { checkRender } from './checks/render.js';
import { buildFindings } from './report.js';
import type { DriftCheckResult, RenderCheckResult } from './types.js';

export * from './types.js';
export { checkReachability } from './checks/reachability.js';
export { identifyVercel } from './checks/vercel.js';
export { checkRender } from './checks/render.js';

export interface DriftCheckOptions {
  timeoutMs?: number;
}

const RENDER_NOT_ATTEMPTED: RenderCheckResult = {
  available: false,
  requests: [],
  consoleErrors: [],
  bodyText: '',
};

export async function driftcheck(
  url: string,
  opts: DriftCheckOptions = {}
): Promise<DriftCheckResult> {
  const reachability = await checkReachability(url, opts.timeoutMs);
  const vercel = identifyVercel(reachability.finalUrl, reachability.headers, reachability.finalStatus);

  // Loading a URL we already know is unreachable in a browser would just
  // reproduce the same failure with more overhead — skip it silently.
  const render = reachability.ok
    ? await checkRender(reachability.finalUrl, opts.timeoutMs)
    : RENDER_NOT_ATTEMPTED;

  const findings = buildFindings({ reachability, vercel, render });
  const passed = !findings.some((f) => f.severity === 'error');

  return { url, reachability, vercel, render, findings, passed };
}
