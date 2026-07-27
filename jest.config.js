/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // `server-only` is a Next.js build-time guard with no Node entrypoint; stub
    // it so server modules can be unit-tested directly under jest.
    '^server-only$': '<rootDir>/test/stubs/server-only.js',
  },
};
