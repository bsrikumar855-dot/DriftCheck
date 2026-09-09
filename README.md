# driftcheck

**Your deploy says green. Your app might still be broken. driftcheck tells you why — zero config, no tests to write.**

```bash
npx driftcheck https://myapp.vercel.app
```

## The problem

Your CI passes. Your platform shows a green checkmark. And your app is still down — because "the build didn't error" and "the app works" are two different claims, and nothing checked the second one.

The usual suspects:

- A production URL that's quietly serving a stale preview deployment
- An env var your code reads that was never set in the deployed environment
- Deployment Protection silently blocking every request with a 401
- A redirect chain nobody looked at

None of these show up as a build failure. All of them show up as "it's fine, why isn't it working."

## What it does

`driftcheck` hits your live URL and tells you what's actually true about it right now:

- **Reachability** — status code, full redirect chain, response time
- **Platform identity** — is this actually Vercel? What region served it?
- **Preview vs. production** — is this the deployment you think it is?
- **Deployment Protection** — is a 401 you're seeing actually an auth wall, not a bug?

No config file. No assertions to write. Point it at a URL and read the findings.

## Install

Nothing to install for one-off use:

```bash
npx driftcheck https://myapp.vercel.app
```

Or add it to a project:

```bash
npm install --save-dev driftcheck
```

## Usage

```bash
driftcheck <url> [--json] [--timeout=<ms>]
```

```
driftcheck  →  https://myapp.vercel.app
────────────────────────────────────────────────────────────
Final URL:    https://myapp.vercel.app
Status:       200
Time:         142ms
Platform:     Vercel (region: iad1)
Environment:  production   "myapp.vercel.app" is a bare *.vercel.app alias...

Findings:
  i Reachable, responded with a successful status. No obvious drift detected at this check level.
```

Exit code is `0` when nothing wrong was found, `1` when a finding is severity `error` — so it's usable as a CI gate right away:

```bash
npx driftcheck https://myapp.vercel.app || exit 1
```

Use `--json` for scripting:

```bash
driftcheck https://myapp.vercel.app --json | jq '.findings'
```

## Honesty over confidence

Some of what driftcheck reports is a fact (status code, headers, redirect chain). Some of it is a heuristic (is this preview or production?), because Vercel doesn't expose a "this is production" header to the outside world.

Where it's a heuristic, driftcheck says so, and it says `unknown` rather than guessing. A project named `my-cool-blog.vercel.app` doesn't get miscategorized as a preview deployment just because its name has hyphens in it — see [`src/checks/vercel.ts`](./src/checks/vercel.ts) for exactly which signals are used and why.

## Roadmap

This is v0.1 — reachability and platform identity. In progress:

| Version | Adds |
|---|---|
| v0.2 | Headless-browser check: console errors, failed network requests, blank renders |
| v0.3 | Repo-aware inference: scans your codebase for `process.env.X` and route files, checks each against the live deployment |
| v0.4 | Diagnosis: maps each failure to a specific file and fix, not just a symptom |
| v1.0 | GitHub Action — runs on every deploy, comments the findings on the PR |

## Contributing

Issues and PRs welcome. The test suite mocks `fetch` rather than hitting real network — a deployment-verification tool with a flaky test suite would be a bit on the nose.

```bash
npm install
npm run build
npm test
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).
