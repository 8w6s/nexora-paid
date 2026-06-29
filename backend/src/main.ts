/**
 * Compile entry point.
 *
 * `bun build --compile` rejects top-level `await` in the entry file but
 * is fine with it inside an async function called from there. `index.ts`
 * uses TLA in several places, so the production binary imports it from
 * inside this thin wrapper instead of taking it as the entry directly.
 *
 * Dev (`bun --watch src/index.ts`) still targets `index.ts` directly so
 * this wrapper is invisible to the development loop.
 */
(async () => {
  await import("./index.ts");
})().catch((err) => {
  console.error("[bot] fatal", err);
  process.exit(1);
});