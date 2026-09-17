/** @type {import('ts-jest').JestConfigWithTsJest} */

// Two environments, split by file extension.
//
// Almost everything here is logic and API routes, which want `node` — jsdom is
// slower and would give those tests a DOM they have no use for. Component tests
// need the DOM, so `.test.tsx` gets jsdom and everything else keeps the node
// environment it has always had. Splitting by extension rather than by directory
// means a component test lands in the right environment by being written, with
// no per-file docblock to forget.
const shared = {
  preset: 'ts-jest',
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['**/*.test.ts'],
      // Visual checks need a browser and several seconds of CSS compilation, so
      // they are their own project and out of the default run. `npm test` must
      // stay fast and must not need Chromium installed.
      testPathIgnorePatterns: [...shared.testPathIgnorePatterns, '\\.visual\\.test\\.ts$'],
    },
    {
      ...shared,
      displayName: 'dom',
      testEnvironment: 'jsdom',
      testMatch: ['**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.dom.ts'],
    },
  ],
};
