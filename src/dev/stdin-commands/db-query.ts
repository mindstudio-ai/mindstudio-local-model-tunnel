import { getApiBaseUrl } from '../../config';
import { fetchCallbackToken } from '../api';
import { CommandError } from './types';
import type { CommandContext } from './types';

export async function handleDbQuery(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new CommandError('No active session', 'NO_SESSION');

  const session = ctx.state.runner.getSession();
  if (!session) throw new CommandError('No active session', 'NO_SESSION');

  const sql = cmd.sql as string;
  if (!sql) throw new CommandError('db-query requires "sql"', 'INVALID_INPUT');

  // Resolve database — use explicit databaseId, or default to the first one
  let databaseId = cmd.databaseId as string | undefined;
  if (!databaseId) {
    if (session.databases.length === 0) throw new CommandError('No databases available', 'NO_SESSION');
    databaseId = session.databases[0].id;
  }

  const appId = ctx.state.appConfig?.appId;
  if (!appId) throw new CommandError('No app config available', 'NO_SESSION');

  ctx.started({ databaseId, sql });

  const token = await fetchCallbackToken(appId, session.sessionId);
  const url = `${getApiBaseUrl()}/_internal/v2/db/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({
      databaseId,
      queries: [{ sql }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new CommandError(`Database query failed: ${res.status} ${text}`, 'EXECUTION_ERROR');
  }

  const data = await res.json() as { results: { rows: unknown[]; changes: number }[] };

  return {
    success: true,
    databaseId,
    results: data.results,
  };
}
