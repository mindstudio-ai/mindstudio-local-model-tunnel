import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleListDatabases(
  ctx: CommandContext,
  _cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new CommandError('No active session', 'NO_SESSION');
  const session = ctx.state.runner.getSession();
  if (!session) throw new CommandError('No active session', 'NO_SESSION');

  return {
    success: true,
    databases: session.databases.map((db) => ({
      id: db.id,
      name: db.name,
      tables: db.tables.map((t) => ({ name: t.name })),
    })),
  };
}
