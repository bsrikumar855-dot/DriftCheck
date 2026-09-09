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

export interface RenderRequestRecord {
  url: string;
  status: number;
  failure?: string;
}

export type BrowserSource = 'bundled-chromium' | 'system-chrome' | 'system-edge';

export interface RenderCheckResult {
  /** false if the check never ran (no browser available, or reachability already failed) */
  available: boolean;
  /** why the check didn't run, when available is false and it was actually attempted */
  skipReason?: string;
  /** which browser actually launched, when available is true */
  browserSource?: BrowserSource;
  requests: RenderRequestRecord[];
  consoleErrors: string[];
  bodyText: string;
}

export interface DriftCheckResult {
  url: string;
  reachability: ReachabilityResult;
  vercel: VercelIdentity;
  render: RenderCheckResult;
  findings: Finding[];
  passed: boolean;
}
