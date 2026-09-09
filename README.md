# driftcheck

**Your deploy says green. Your app might still be broken. driftcheck tells you why — zero config, no tests to write.**

```bash
npx @shreekumar007/driftcheck https://myapp.vercel.app
```

## See it catch a real bug

We built a minimal Next.js app, [drift-fixture](https://drift-fixture.vercel.app), and deployed it to Vercel with one env var deliberately left unset — the kind of thing that never shows up as a build failure.

**Vercel's own output for that deploy:**

```
✓ Created       team-ragnarok/drift-fixture
  Production    https://drift-fixture-g66u5zzu2-team-ragnarok.vercel.app
▲ Aliased       https://drift-fixture.vercel.app

✓ Ready in 32s
```

Build succeeded. Green checkmark. Nothing here says anything is wrong — because nothing checked whether the app actually works.

**driftcheck's output, same deployment:**

The finding below — the one that actually catches the bug — comes from driftcheck's render check, which loads the page in a real browser. **It requires a one-time, opt-in install** (`npm i -g playwright-core && npx playwright install chromium` — or just having Chrome/Edge already installed, see [below](#the-render-check-tries-your-existing-browser-first)). Without it, `driftcheck` still runs — reachability and platform identity below are unconditional — but it says so plainly and the run is incomplete; see [the no-browser case](#the-render-check-tries-your-existing-browser-first) for exactly what that looks like.

```
$ driftcheck https://drift-fixture.vercel.app

driftcheck  →  https://drift-fixture.vercel.app
────────────────────────────────────────────────────────────
Final URL:    https://drift-fixture.vercel.app
Status:       200
Time:         664ms
Platform:     Vercel (region: bom1)
Environment:  unknown  "drift-fixture.vercel.app" doesn't match a known preview pattern, but has a multi-part name — could be a production alias with a hyphenated project name, or a hash-based preview URL. Check your Vercel dashboard to be sure.
Render check: via bundled Chromium

Findings:
  ✗ Request to https://drift-fixture.vercel.app/undefined/api/ping has a literal "undefined" in its path — almost certainly an unset environment variable reaching a URL at runtime.
  ✗ Same-origin request to https://drift-fixture.vercel.app/undefined/api/ping returned HTTP 404.
  ! Console error: Failed to load resource: the server responded with a status of 404 ()

$ echo $?
1
```

Exit code `1` on a deployment Vercel called ready — usable as a CI gate as-is.

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
npx @shreekumar007/driftcheck https://myapp.vercel.app
```

Or add it to a project:

```bash
npm install --save-dev @shreekumar007/driftcheck
```

The package name is scoped (`@shreekumar007/driftcheck`), but the installed command is still just `driftcheck` — that's what the package's `bin` field maps to, unaffected by the scope.

## Usage

```bash
driftcheck <url> [--json] [--fix-prompt] [--timeout=<ms>]
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
npx @shreekumar007/driftcheck https://myapp.vercel.app || exit 1
```

Use `--json` for scripting:

```bash
driftcheck https://myapp.vercel.app --json | jq '.findings'
```

### `--fix-prompt` — hand the findings to a coding agent

Findings tell you *what's* wrong. `--fix-prompt` turns the ones that are genuinely fixable in code into a ready-to-paste investigation task for a coding agent (Claude Code, Cursor, whatever you use), built entirely from evidence driftcheck already gathered:

```bash
driftcheck https://drift-fixture.vercel.app --fix-prompt
```

No LLM call, no extra dependency, no network request beyond the checks that already ran — it's string templating over finding data. It's strictly opt-in: without the flag, output is byte-identical to a run without the feature, and `--json`'s `fixPrompt` field stays `null`.

**Not every finding gets one.** Deployment Protection, preview-vs-production ambiguity, redirect chains and plain reachability failures are deliberately excluded — those are platform or config issues, and sending an agent to grep your repo for a Vercel dashboard toggle wastes your time and invites irrelevant code changes. Only these qualify:

| Finding | Why it qualifies |
|---|---|
| `/undefined/`, `/null/`, `/[object%20Object]/` in a request path | Almost always an unset env var reaching a URL at runtime |
| localhost request from a deployed app | Hardcoded dev URL that was never made configurable |
| Same-origin 4xx/5xx | Same-origin means it's very likely this codebase's bug |
| Console error | Weakest evidence — the prompt hedges accordingly |

The prompts are written to make an agent *investigate*, not pattern-match a fix — they say what driftcheck actually observed, what it probably means, and explicitly instruct the agent to confirm the cause before changing anything.

**Findings that share evidence are merged.** One broken request often trips more than one check — a request to `/undefined/api/ping` that 404s produces both a path finding and a same-origin finding. Those are one problem seen twice, so the prompt emits a single section led by the more specific signal and folds the rest in as a corroborating note, rather than sending an agent to investigate the same request twice. Console errors are never merged this way — different signal type, and usually no request URL to match on.

<details>
<summary>The full prompt driftcheck generated for the fixture (real output, verbatim)</summary>

```
driftcheck found 2 issues on this deployment that look
code-fixable. Each is described below with the evidence driftcheck
actually observed.

### 1. Literal "undefined" in a request path

driftcheck found a request whose URL path contains the literal token
"undefined":

  https://drift-fixture.vercel.app/undefined/api/ping → 404

This almost always means a JS value that should hold a URL/path segment
was actually `undefined` at runtime — most commonly an environment
variable (e.g. `process.env.NEXT_PUBLIC_*`) unset in the deployed
environment, then string-coerced into a template literal.

Investigate, don't fix blindly:
1. Search this codebase for a fetch/axios/image call whose URL shape
   would produce a request matching this path — grep for the path
   suffix and for `process.env.` usages near it.
2. Once found, identify which variable is being interpolated and trace
   its source.
3. Check whether it's defined in a local .env file. If the app works
   locally, the deployed platform's environment settings are very
   likely missing it, or have it under a different name than expected.
4. Confirm the actual cause before proposing a fix — report back rather
   than assuming. It could be a name mismatch, not a missing value.

Note: its same-origin check also flagged this exact request (HTTP 404).
That's the same evidence seen by more than one check, not an
independent second problem — investigate it once.

### 2. Console error on page load

driftcheck captured this console error on page load:

  Failed to load resource: the server responded with a status of 404 ()

This is weaker evidence than the other finding types — it may be from
your own code, a third-party script, or noise unrelated to any real
problem.

Investigate before changing anything:
1. Determine whether this originates from code in this repo or from a
   third-party script.
2. If it's this repo's code, trace it and assess whether it's a real
   bug or safe to ignore.
3. If it's third-party, report that back rather than making speculative
   changes — it's likely not fixable here.

Investigate each of the above independently — do not assume they share
a root cause unless your investigation actually shows that.
```

</details>

## Honesty over confidence

Some of what driftcheck reports is a fact (status code, headers, redirect chain). Some of it is a heuristic (is this preview or production?), because Vercel doesn't expose a "this is production" header to the outside world.

Where it's a heuristic, driftcheck says so, and it says `unknown` rather than guessing. A project named `my-cool-blog.vercel.app` doesn't get miscategorized as a preview deployment just because its name has hyphens in it — see [`src/checks/vercel.ts`](./src/checks/vercel.ts) for exactly which signals are used and why.

## Roadmap

v0.1 (reachability and platform identity), v0.2 (passive render check) and v0.3 (agent handoff prompts) are done. In progress:

| Version | Adds |
|---|---|
| v0.2 ✅ | Headless-browser check: console errors, failed network requests, blank renders |
| v0.3 ✅ | [`--fix-prompt`](#--fix-prompt--hand-the-findings-to-a-coding-agent): turns code-fixable findings into a ready-to-paste investigation task for a coding agent |
| v0.4 | Repo-aware inference: scans your codebase for `process.env.X` and route files, checks each against the live deployment |
| v0.5 | Diagnosis: maps each failure to a specific file and fix, not just a symptom |
| v1.0 | GitHub Action — runs on every deploy, comments the findings on the PR |

### The render check tries your existing browser first

The render check (`src/checks/render.ts`) loads the page in a real headless browser, waits for the network to go idle (capped at 10s), and passively observes what happened — no clicking, no scripted flows, no per-site config. It flags:

- Any request whose URL contains a literal `/undefined/`, `/null/`, or `/[object%20Object]/` segment — almost always an unset environment variable reaching a URL at runtime
- Any request to `localhost`/`127.0.0.1` from a non-localhost deployment — a hardcoded dev URL shipped to production
- Any same-origin 4xx/5xx response
- Any console error (warning)
- A blank render — no rendered text content after load (warning)

`playwright-core` is **not** a dependency of this package — not even an optional one — so `npx @shreekumar007/driftcheck <url>` stays exactly as light as v0.1 for anyone who doesn't need this check.

There are actually two fallback chains here, for two different questions — "is `playwright-core` available at all" and, once it is, "which browser does it launch":

**Finding `playwright-core` itself.** A plain `import('playwright-core')` is tried first — this covers this repo's own devDependency, or any project that installed driftcheck and `playwright-core` as siblings in the same `node_modules`. But `npx @shreekumar007/driftcheck <url>` runs from an isolated npx cache directory whose ancestors have nothing to do with a global install, so that bare import can never see a `npm install -g playwright-core`. When it fails, driftcheck asks npm directly where its global root is (`npm root -g`) and imports from that absolute path instead — so the global install path actually works for the exact one-off `npx` usage this tool is built around, not just for local project installs.

**Launching a browser.** Once `playwright-core` itself is found, it tries, in order: a pinned bundled Chromium (if you've run `playwright install`) → your system Chrome → your system Edge → gives up. Whichever one launches is named in the output, along with how `playwright-core` itself was resolved when that took the global-root path: `Render check: via bundled Chromium` / `via system Chrome (playwright-core resolved from global npm root)` / etc.

If neither `playwright-core` nor a browser can be found by any of those paths, driftcheck says so loudly rather than quietly skipping it:

```
$ driftcheck https://drift-fixture.vercel.app

driftcheck  →  https://drift-fixture.vercel.app
────────────────────────────────────────────────────────────
Final URL:    https://drift-fixture.vercel.app
Status:       200
Time:         524ms
Platform:     Vercel (region: bom1)
Environment:  unknown  "drift-fixture.vercel.app" doesn't match a known preview pattern...

────────────────────────────────────────────────────────────
⚠ Render checks skipped — no browser available.
  This run only checked reachability and platform identity — it did NOT check whether the page actually renders correctly.
  playwright-core is not installed (checked both a local/project install and the global npm root). Run `npm install -g playwright-core && npx playwright install chromium` to enable console/network error detection — if it still doesn't work afterward, check that `npm` is on PATH and that you don't have a non-standard global prefix.
────────────────────────────────────────────────────────────

Findings:
  i Reachable, responded with a successful status. No obvious drift detected at this check level.
```

Note what that output does **not** say: it does not say "no drift detected" and mean it — it says reachability was fine and is explicit that the deeper check never ran. Exit code stays `0` here — the absence of a check isn't itself a failure — but the report is honest about being incomplete rather than looking identical to a clean full pass. (This is the exact deployment used in the demo above; run it yourself without `playwright-core` installed anywhere to see this.)

To install a pinned browser yourself:

```bash
npm install -g playwright-core
npx playwright install chromium
```

## Validated against

[`drift-fixture`](https://drift-fixture.vercel.app) is a deliberately-broken fixture we built and deployed specifically to test driftcheck against a known, ground-truth bug rather than guessing at what "broken" looks like. It's a minimal Next.js app whose only page fetches `${process.env.NEXT_PUBLIC_API_URL}/api/ping` on load.

- **Locally**, with `NEXT_PUBLIC_API_URL` set: the page renders `API status: connected`, zero console errors — a valid control.
- **Deployed to Vercel**, with `NEXT_PUBLIC_API_URL` intentionally left unset: the build still succeeds, because nothing at build time checks whether a `NEXT_PUBLIC_*` variable actually has a value. At runtime, the fetch resolves to `undefined/api/ping` and 404s, silently — no error banner, no failed build, just a page that quietly doesn't work.

driftcheck v0.1 (reachability + platform identity alone) correctly does **not** catch this — the deploy really is reachable and really does return 200, so there's nothing at that layer to flag. v0.2's render check catches it by loading the deployed page in a real browser, capturing the resulting network requests, and flagging the literal `/undefined/` in the request path — see [the demo above](#see-it-catch-a-real-bug) for the exact output.

## Contributing

Issues and PRs welcome. The test suite mocks `fetch` rather than hitting real network — a deployment-verification tool with a flaky test suite would be a bit on the nose.

```bash
npm install
npm run build
npm test
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).
