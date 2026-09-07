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
