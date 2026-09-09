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

/**
 * Stable, machine-readable identifier for what a finding actually is.
 * Message text is for humans and may be reworded; this is what code
 * (e.g. fix-prompt generation) branches on.
 */
export type FindingCode =
  | 'UNDEFINED_IN_PATH'
  | 'LOCALHOST_IN_PROD'
  | 'SAME_ORIGIN_ERROR'
  | 'CONSOLE_ERROR'
  | 'BLANK_RENDER'
  | 'DEPLOYMENT_PROTECTION'
  | 'PREVIEW_ENVIRONMENT'
  | 'BAD_STATUS'
  | 'REDIRECT_CHAIN'
  | 'ALL_CLEAR';

export interface Finding {
  severity: FindingSeverity;
  message: string;
  code?: FindingCode;
  data?: Record<string, string | number>;
}

export interface RenderRequestRecord {
  url: string;
  status: number;
  failure?: string;
}

export type BrowserSource = 'bundled-chromium' | 'system-chrome' | 'system-edge';

export type PlaywrightCoreSource = 'bare-specifier' | 'global-npm-root';

export interface RenderCheckResult {
  /** false if the check never ran (no browser available, or reachability already failed) */
  available: boolean;
  /** why the check didn't run, when available is false and it was actually attempted */
  skipReason?: string;
  /** which browser actually launched, when available is true */
  browserSource?: BrowserSource;
  /** how playwright-core itself was resolved, when available is true */
  playwrightCoreSource?: PlaywrightCoreSource;
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
