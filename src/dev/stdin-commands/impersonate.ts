import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleImpersonate(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new CommandError('No active session', 'NO_SESSION');

  const roles = cmd.roles as string[];
  if (!Array.isArray(roles)) throw new CommandError('impersonate requires roles array', 'INVALID_INPUT');

  await ctx.state.runner.setImpersonation(roles);
  return { success: true, roles };
}

export async function handleClearImpersonation(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new CommandError('No active session', 'NO_SESSION');

  await ctx.state.runner.clearImpersonation();
  return { success: true, roles: null };
}
