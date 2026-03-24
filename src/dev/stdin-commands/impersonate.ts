import type { CommandContext } from './types';

export async function handleImpersonate(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new Error('No active session');

  const roles = cmd.roles as string[];
  if (!Array.isArray(roles)) throw new Error('impersonate requires roles array');

  await ctx.state.runner.setImpersonation(roles);
  return { roles };
}

export async function handleClearImpersonation(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new Error('No active session');

  await ctx.state.runner.clearImpersonation();
  return { roles: null };
}
