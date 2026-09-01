import { CommandError } from './types';
import type { CommandContext } from './types';

// Set the dev test user's roles — a real write to the user's row (the
// platform updates role assignments and syncs the app's users table). This is
// how "role switching" works in dev: the developer signs in as the test
// account through the app's own auth flow and sees the app from whatever
// roles the row holds.
export async function handleSetTestUserRoles(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner)
    throw new CommandError('No active session', 'NO_SESSION');

  const roles = cmd.roles as string[];
  if (!Array.isArray(roles))
    throw new CommandError(
      'set-test-user-roles requires a roles array',
      'INVALID_INPUT',
    );

  const user = await ctx.state.runner.setTestUserRoles(roles);

  // Reload the preview so the signed-in page picks up the new roles.
  if (ctx.state.proxy?.isBrowserConnected()) {
    ctx.state.proxy.broadcastToClients('reload');
  }

  return { success: true, user, roles: (user.roles as string[]) ?? roles };
}

// Find-or-create the dev test user and return it with its current roles.
export async function handleGetTestUser(
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner)
    throw new CommandError('No active session', 'NO_SESSION');

  const user = await ctx.state.runner.getTestUser();
  return { success: true, user, roles: (user.roles as string[]) ?? [] };
}
