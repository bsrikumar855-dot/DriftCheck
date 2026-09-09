import pc from 'picocolors';
import type {
  DriftCheckResult,
  Finding,
  ReachabilityResult,
  RenderCheckResult,
  VercelIdentity,
} from './types.js';

export function buildFindings(input: {
  reachability: ReachabilityResult;
  vercel: VercelIdentity;
  render: RenderCheckResult;
}): Finding[] {
  const { reachability, vercel, render } = input;
  const v01Findings: Finding[] = [];

  if (reachability.error) {
    v01Findings.push({ severity: 'error', message: reachability.error });
  } else if (!reachability.ok) {
    v01Findings.push({
      severity: 'error',
      message: `Final response was HTTP ${reachability.finalStatus} — not a successful status.`,
    });
  }

  if (reachability.redirectChain.length > 3) {
    v01Findings.push({
      severity: 'warning',
      message: `${reachability.redirectChain.length} redirect hops before reaching a final response — this can slow down real users too.`,
    });
  }

  if (vercel.isVercel && vercel.possibleDeploymentProtection) {
    v01Findings.push({
      severity: 'error',
      message:
        'Got HTTP 401 from a Vercel deployment. This usually means Deployment Protection (password/SSO) is enabled — check Project Settings → Deployment Protection.',
    });
  }

  if (vercel.isVercel && vercel.likelyEnvironment === 'preview') {
    v01Findings.push({
      severity: 'warning',
      message: `This looks like a PREVIEW deployment, not production. ${vercel.environmentReason} If you expected production, double check the URL and your git branch.`,
    });
  }

  const renderResultFindings = renderFindings(reachability.finalUrl, render);

  // The all-clear message is only honest if NOTHING actionable turned up
  // anywhere — including render findings, which are computed above but not
  // appended until after this check. An info-level finding (e.g. "render
  // check skipped") doesn't contradict "no drift detected"; an error or
  // warning from either check does.
  const hasActionableFinding = [...v01Findings, ...renderResultFindings].some(
    (f) => f.severity === 'error' || f.severity === 'warning'
  );

  const findings = [...v01Findings];

  if (!hasActionableFinding && reachability.ok) {
    findings.push({
      severity: 'info',
      message: 'Reachable, responded with a successful status. No obvious drift detected at this check level.',
    });
  }

  findings.push(...renderResultFindings);

  return findings;
}

const SUSPICIOUS_PATH_TOKEN = /\/(undefined|null|\[object%20Object\])\//i;

export function renderFindings(targetUrl: string, render: RenderCheckResult): Finding[] {
  // A skipped render check is surfaced as a loud, distinct block in
  // printReport (and structurally via render.available/skipReason in JSON
  // output) — not folded into the findings list, which is reserved for
  // actual drift, not meta-information about check coverage.
  if (!render.available) {
    return [];
  }

  const findings: Finding[] = [];
  const targetOrigin = safeOrigin(targetUrl);
  const targetIsLocalhost = isLocalhost(targetOrigin);

  for (const req of render.requests) {
    const tokenMatch = req.url.match(SUSPICIOUS_PATH_TOKEN);
    if (tokenMatch) {
      findings.push({
        severity: 'error',
        message: `Request to ${req.url} has a literal "${tokenMatch[1]}" in its path — almost certainly an unset environment variable reaching a URL at runtime.`,
      });
    }

    const reqOrigin = safeOrigin(req.url);
    if (!targetIsLocalhost && isLocalhost(reqOrigin)) {
      findings.push({
        severity: 'error',
        message: `Request to ${req.url} targets localhost from a non-localhost deployment — likely a hardcoded dev URL shipped to production.`,
      });
    }

    if (reqOrigin && targetOrigin && reqOrigin === targetOrigin && req.status >= 400) {
      findings.push({
        severity: 'error',
        message: `Same-origin request to ${req.url} returned HTTP ${req.status}.`,
      });
    }
  }

  for (const msg of render.consoleErrors) {
    findings.push({ severity: 'warning', message: `Console error: ${msg}` });
  }

  if (render.bodyText.length === 0) {
    findings.push({
      severity: 'warning',
      message: 'Page body has no rendered text content after load — possible blank render.',
    });
  }

  return findings;
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function isLocalhost(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function printReport(result: DriftCheckResult): void {
  const { reachability, vercel, render, findings } = result;

  console.log('');
  console.log(pc.bold(`driftcheck  →  ${result.url}`));
  console.log(pc.dim('─'.repeat(60)));

  console.log(`${pc.bold('Final URL:')}    ${reachability.finalUrl}`);
  console.log(`${pc.bold('Status:')}       ${statusColor(reachability.finalStatus)}`);
  console.log(`${pc.bold('Time:')}         ${reachability.elapsedMs}ms`);

  if (reachability.redirectChain.length > 1) {
    console.log(`${pc.bold('Redirects:')}    ${reachability.redirectChain.length - 1} hop(s)`);
    for (const hop of reachability.redirectChain) {
      console.log(pc.dim(`  ${hop.status}  ${hop.url}`));
    }
  }

  if (vercel.isVercel) {
    console.log(`${pc.bold('Platform:')}     Vercel${vercel.region ? ` (region: ${vercel.region})` : ''}`);
    console.log(`${pc.bold('Environment:')}  ${envColor(vercel.likelyEnvironment)}  ${pc.dim(vercel.environmentReason)}`);
  } else {
    console.log(`${pc.bold('Platform:')}     ${pc.dim('not detected as Vercel')}`);
  }

  if (render.available) {
    console.log(`${pc.bold('Render check:')} via ${browserSourceLabel(render.browserSource)}`);
  }

  if (!render.available && render.skipReason) {
    console.log('');
    console.log(pc.dim('─'.repeat(60)));
    console.log(pc.yellow(pc.bold('⚠ Render checks skipped — no browser available.')));
    console.log(
      pc.yellow(
        `  This run only checked reachability${vercel.isVercel ? ' and platform identity' : ''} — it did NOT check whether the page actually renders correctly.`
      )
    );
    console.log(pc.yellow('  To enable full checks:'));
    console.log(pc.yellow('    npm i -g playwright-core && npx playwright install chromium'));
    console.log(pc.dim('─'.repeat(60)));
  }

  console.log('');
  console.log(pc.bold('Findings:'));
  for (const f of findings) {
    console.log(`  ${findingIcon(f.severity)} ${f.message}`);
  }
  console.log('');
}

function browserSourceLabel(source: DriftCheckResult['render']['browserSource']): string {
  if (source === 'bundled-chromium') return 'bundled Chromium';
  if (source === 'system-chrome') return 'system Chrome';
  if (source === 'system-edge') return 'system Edge';
  return 'unknown browser';
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return pc.green(String(status));
  if (status >= 300 && status < 400) return pc.yellow(String(status));
  if (status === 0) return pc.red('no response');
  return pc.red(String(status));
}

function envColor(env: string): string {
  if (env === 'production') return pc.green(env);
  if (env === 'preview') return pc.yellow(env);
  return pc.dim(env);
}

function findingIcon(severity: string): string {
  if (severity === 'error') return pc.red('✗');
  if (severity === 'warning') return pc.yellow('!');
  return pc.blue('i');
}
