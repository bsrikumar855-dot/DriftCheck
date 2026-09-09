import pc from 'picocolors';
import type { DriftCheckResult, Finding, ReachabilityResult, VercelIdentity } from './types.js';

export function buildFindings(input: {
  reachability: ReachabilityResult;
  vercel: VercelIdentity;
}): Finding[] {
  const findings: Finding[] = [];
  const { reachability, vercel } = input;

  if (reachability.error) {
    findings.push({ severity: 'error', message: reachability.error });
  } else if (!reachability.ok) {
    findings.push({
      severity: 'error',
      message: `Final response was HTTP ${reachability.finalStatus} — not a successful status.`,
    });
  }

  if (reachability.redirectChain.length > 3) {
    findings.push({
      severity: 'warning',
      message: `${reachability.redirectChain.length} redirect hops before reaching a final response — this can slow down real users too.`,
    });
  }

  if (vercel.isVercel && vercel.possibleDeploymentProtection) {
    findings.push({
      severity: 'error',
      message:
        'Got HTTP 401 from a Vercel deployment. This usually means Deployment Protection (password/SSO) is enabled — check Project Settings → Deployment Protection.',
    });
  }

  if (vercel.isVercel && vercel.likelyEnvironment === 'preview') {
    findings.push({
      severity: 'warning',
      message: `This looks like a PREVIEW deployment, not production. ${vercel.environmentReason} If you expected production, double check the URL and your git branch.`,
    });
  }

  if (findings.length === 0 && reachability.ok) {
    findings.push({
      severity: 'info',
      message: 'Reachable, responded with a successful status. No obvious drift detected at this check level.',
    });
  }

  return findings;
}

export function printReport(result: DriftCheckResult): void {
  const { reachability, vercel, findings } = result;

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

  console.log('');
  console.log(pc.bold('Findings:'));
  for (const f of findings) {
    console.log(`  ${findingIcon(f.severity)} ${f.message}`);
  }
  console.log('');
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
