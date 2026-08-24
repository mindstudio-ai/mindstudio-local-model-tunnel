import { cleanupWorker } from '../execution/executor';

/**
 * Kill the persistent methods worker; the next method run lazily respawns it.
 *
 * Method source and its bundled deps are already fresh per invocation
 * (esbuild transpiles per call, and imports are content-hash cache-busted) —
 * the one thing a worker restart picks up is the esbuild-`external`
 * `@mindstudio-ai/agent` module, which the worker's ESM loader caches for its
 * lifetime. Exposed so the agent can restart after an SDK upgrade instead of
 * hunting for the worker PID.
 */
export async function handleRestartWorker(): Promise<Record<string, unknown>> {
  await cleanupWorker('methods worker restart');
  return { success: true };
}
