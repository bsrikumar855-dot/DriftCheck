import { checkReachability } from './checks/reachability.js';
import { identifyVercel } from './checks/vercel.js';
import { buildFindings } from './report.js';
import type { DriftCheckResult } from './types.js';

export * from './types.js';
export { checkReachability } from './checks/reachability.js';
export { identifyVercel } from './checks/vercel.js';

export interface DriftCheckOptions {
  timeoutMs?: number;
}

export async function driftcheck(
  url: string,
  opts: DriftCheckOptions = {}
): Promise<DriftCheckResult> {
  const reachability = await checkReachability(url, opts.timeoutMs);
  const vercel = identifyVercel(reachability.finalUrl, reachability.headers, reachability.finalStatus);

  const findings = buildFindings({ reachability, vercel });
  const passed = !findings.some((f) => f.severity === 'error');

  return { url, reachability, vercel, findings, passed };
}
