// Ambient declaration for @mindstudio-ai/agent, which the tunnel does NOT depend
// on: the dev worker (worker.ts) resolves it at runtime from the USER's project
// (see the copy-into-project dance in executor.ts). tsup marks it external and
// never bundles it, but tsc/the DTS pass still need a type for the bare import.
// The worker treats the SDK as opaque — it only needs runWithContext with a
// pass-through context — so this stub is deliberately loose rather than tracking
// the SDK's internal RequestContext shape (which can vary by the user's version).
declare module '@mindstudio-ai/agent' {
  export function runWithContext<T>(
    ctx: Record<string, unknown>,
    fn: () => T | Promise<T>,
  ): T | Promise<T>;
}
