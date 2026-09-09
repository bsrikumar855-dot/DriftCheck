// Synthetic stand-in for playwright-core's real ESM entry point, used only
// to verify checkRender's global-npm-root fallback can actually dynamic
// `import()` an absolute path — that part of module loading can't be faked
// through vi.doMock since the target has to really exist on disk. Nothing
// else in this fixture's directory is real; node:child_process and
// node:fs/promises stay fully mocked in the test itself. This has to be
// self-contained (not driven by the test's own vi.fn() mocks) since it's
// loaded as a genuinely separate module outside vitest's mock graph.
const fakePage = {
  on: () => {},
  goto: async () => {},
  evaluate: async () => 'fixture body text',
};

export const chromium = {
  launch: async () => ({
    newPage: async () => fakePage,
    close: async () => {},
  }),
};
