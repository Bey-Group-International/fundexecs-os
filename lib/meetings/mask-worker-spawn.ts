// lib/meetings/mask-worker-spawn.ts
// One line that two toolchains have to agree about.
//
// `new Worker(new URL("./mask-worker.ts", import.meta.url))` is not an ordinary
// expression: webpack matches it SYNTACTICALLY, and rewrites it into a
// reference to a worker bundle it emits as a side effect. Change its shape and
// nothing fails -- the build succeeds, the URL resolves to a file that was never
// emitted, and the worker 404s at runtime on a member's machine.
//
// Jest cannot parse it at all. `import.meta` is illegal in the CommonJS modules
// its transform produces, so any test that so much as imports the driver dies
// on this line.
//
// Hence a module of its own. The expression stays verbatim for webpack, and a
// test mocks this one function rather than being unable to load the driver.
// That is the only reason this file exists, and it is why it contains nothing
// else: anything here is unreachable from a test.

/**
 * Construct the masking worker.
 *
 * No `{ type: "module" }`. Webpack compiles that option away and emits a
 * CLASSIC worker that loads its further chunks with `importScripts`, so
 * claiming a module worker here would describe something that does not exist at
 * runtime. Static imports inside the worker are fine either way.
 */
export function spawnMaskWorker(): Worker {
  return new Worker(new URL("./mask-worker.ts", import.meta.url));
}
