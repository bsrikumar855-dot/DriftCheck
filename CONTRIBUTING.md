# Contributing

```bash
npm install
npm run build
npm test
```

## Testing the published package locally

When testing the published package locally, run `npx` from a directory outside this repo — running it from here will resolve the local `bin` instead of fetching from the registry. This repo's own `package.json` defines a `bin` command also named `driftcheck` (pointing at `./dist/cli.js`), and `npm exec`/`npx` resolves against local project bins before reaching out to the registry. This only affects contributors testing from the repo root; real users running it against their own projects will never hit this, since their projects don't define a `driftcheck` bin.
