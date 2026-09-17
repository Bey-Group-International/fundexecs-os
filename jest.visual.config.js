/** @type {import('ts-jest').JestConfigWithTsJest} */

// Layout checks in a real browser engine (test-utils/visual.ts).
//
// A separate config rather than a third project in jest.config.js, so the
// default `npm test` cannot pick them up: they need Chromium installed and pay
// a few seconds to compile the app's stylesheet. Run them with
// `npm run test:visual`; CI runs them as their own job.
module.exports = {
  preset: 'ts-jest',
  displayName: 'visual',
  testEnvironment: 'node',
  testMatch: ['**/*.visual.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // The stylesheet is compiled once per process; one worker pays it once.
  maxWorkers: 1,
  testTimeout: 120000,
};
