import { getApiBaseUrl } from '../../config';
import { fetchCallbackToken } from '../api';
import type { CommandContext } from './types';

export async function handleDbQuery(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner) throw new Error('No active session');

  const session = ctx.state.runner.getSession();
  if (!session) throw new Error('No active session');

  const sql = cmd.sql as string;
  if (!sql) throw new Error('db-query requires "sql"');

  // Resolve database — use explicit databaseId, or default to the first one
  let databaseId = cmd.databaseId as string | undefined;
  if (!databaseId) {
    if (session.databases.length === 0) throw new Error('No databases available');
    databaseId = session.databases[0].id;
  }

  ctx.started({ databaseId, sql });

  const token = await fetchCallbackToken(ctx.state.appConfig!.appId!, session.sessionId);
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
    throw new Error(`Database query failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { results: { rows: unknown[]; changes: number }[] };

  return {
    success: true,
    databaseId,
    results: data.results,
  };
}
