export interface RedirectHop {
  url: string;
  status: number;
}

export interface ReachabilityResult {
  requestedUrl: string;
  finalUrl: string;
  finalStatus: number;
  ok: boolean;
  redirectChain: RedirectHop[];
  elapsedMs: number;
  headers: Record<string, string>;
  error?: string;
}

export interface VercelIdentity {
  isVercel: boolean;
  vercelId?: string;
  region?: string;
  likelyEnvironment: 'production' | 'preview' | 'unknown';
  environmentReason: string;
  possibleDeploymentProtection: boolean;
}

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: FindingSeverity;
  message: string;
}

export interface DriftCheckResult {
  url: string;
  reachability: ReachabilityResult;
  vercel: VercelIdentity;
  findings: Finding[];
  passed: boolean;
}
