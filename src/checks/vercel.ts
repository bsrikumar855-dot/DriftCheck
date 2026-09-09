import type { VercelIdentity } from '../types.js';

/**
 * Classifies a response as Vercel-hosted, and — carefully — guesses whether
 * it's a production or preview deployment.
 *
 * Confirmed, documented signals used here:
 *  - `x-vercel-id`: present on every response that passes through Vercel's
 *    edge network. Format is "<region>::<region>::<requestId>".
 *    https://vercel.com/docs/headers/request-headers
 *  - Deployment Protection: when enabled, unauthenticated requests are
 *    blocked. A 401 on a confirmed-Vercel response is a strong signal of
 *    this — and it's a very common "green build, can't actually load it"
 *    cause that people don't think to check.
 *    https://vercel.com/docs/deployments/deployment-protection
 *  - Git-branch preview URLs follow the pattern
 *    "<project>-git-<branch>-<team>.vercel.app" — the "-git-" marker is
 *    part of Vercel's own URL convention, not a guess.
 *
 * Everything else here (hash-based preview URLs, custom-domain previews)
 * is NOT reliably distinguishable from the outside without a Vercel API
 * token. Rather than guess and risk being confidently wrong, ambiguous
 * cases are reported as "unknown" with a reason, not silently defaulted
 * to "production".
 */
export function identifyVercel(
  finalUrl: string,
  headers: Record<string, string>,
  status: number
): VercelIdentity {
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  const vercelId = lowerHeaders['x-vercel-id'];
  const isVercel = Boolean(vercelId) || /vercel/i.test(lowerHeaders['server'] ?? '');
  const region = vercelId ? vercelId.split('::')[0] : undefined;

  let host = '';
  try {
    host = new URL(finalUrl).hostname;
  } catch {
    // leave host empty — finalUrl was unparsable, downstream logic handles it
  }

  let likelyEnvironment: VercelIdentity['likelyEnvironment'] = 'unknown';
  let environmentReason = 'Could not determine from URL shape or headers.';

  if (isVercel) {
    const isVercelAppDomain = host.endsWith('.vercel.app');

    if (!isVercelAppDomain) {
      likelyEnvironment = 'production';
      environmentReason = `"${host}" is a custom domain, not a *.vercel.app URL — custom domains are almost always pointed at production.`;
    } else {
      const label = host.slice(0, -'.vercel.app'.length);
      const hasGitMarker = /-git-/.test(label);

      if (hasGitMarker) {
        likelyEnvironment = 'preview';
        environmentReason = `"${host}" matches Vercel's git-branch preview URL pattern (contains "-git-").`;
      } else if (!label.includes('-')) {
        likelyEnvironment = 'production';
        environmentReason = `"${host}" is a bare *.vercel.app alias with no branch/hash segments — Vercel's default production alias shape.`;
      } else {
        likelyEnvironment = 'unknown';
        environmentReason = `"${host}" doesn't match a known preview pattern, but has a multi-part name — could be a production alias with a hyphenated project name, or a hash-based preview URL. Check your Vercel dashboard to be sure.`;
      }
    }
  }

  const possibleDeploymentProtection = isVercel && status === 401;

  return {
    isVercel,
    vercelId,
    region,
    likelyEnvironment,
    environmentReason,
    possibleDeploymentProtection,
  };
}
