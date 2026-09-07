import { detectAppConfigUntil } from '../config/app-config';
import { CommandError } from './types';
import type { CommandContext } from './types';

// Run a data source's mapper directly over caller-supplied objects — the
// mapper authoring loop. Each object is `{ key, url, size?, contentType?,
// etag?, lastModified?, metadata? }` with a URL the mapper can read (a
// presigned URL, a public URL, a local http server). Nothing is ingested; the
// executor's record (one outcome per object) comes straight back.
const MAX_TEST_OBJECTS = 200;

export async function handleTestMapper(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner)
    throw new CommandError('No active session', 'NO_SESSION');

  const slug = cmd.dataSource as string;
  if (!slug)
    throw new CommandError(
      'test-mapper requires "dataSource" (the source slug)',
      'INVALID_INPUT',
    );

  const objects = cmd.objects;
  if (!Array.isArray(objects) || objects.length === 0) {
    throw new CommandError(
      'test-mapper requires "objects": a non-empty array of { key, url, ... }',
      'INVALID_INPUT',
    );
  }
  if (objects.length > MAX_TEST_OBJECTS) {
    throw new CommandError(
      `test-mapper takes at most ${MAX_TEST_OBJECTS} objects per call`,
      'INVALID_INPUT',
    );
  }
  for (const [i, o] of objects.entries()) {
    const obj = o as { key?: unknown; url?: unknown } | null;
    if (!obj || typeof obj.key !== 'string' || typeof obj.url !== 'string') {
      throw new CommandError(
        `objects[${i}] needs a string "key" and a readable "url"`,
        'INVALID_INPUT',
      );
    }
  }
  const timeoutMs =
    typeof cmd.timeoutMs === 'number' && cmd.timeoutMs > 0
      ? cmd.timeoutMs
      : undefined;

  // Retry-aware manifest read — same freshness window as run-method.
  const freshConfig =
    (await detectAppConfigUntil(ctx.cwd, (c) =>
      c.dataSources.some((d) => d.slug === slug),
    )) ?? ctx.state.appConfig;
  const dataSource = freshConfig?.dataSources.find((d) => d.slug === slug);
  if (!dataSource) {
    throw new CommandError(
      `Data source "${slug}" has no mapper in the manifest — add a "dataSources": [{ "slug": "${slug}", "mapper": { "path": ... } }] entry to test one`,
      'INVALID_INPUT',
    );
  }

  ctx.started({ dataSource: slug, mapper: dataSource.mapper.path });

  const result = await ctx.state.runner.testMapper({
    dataSource,
    objects,
    timeoutMs,
  });

  if (!result.success) {
    return {
      success: false,
      dataSource: slug,
      error: 'error' in result ? result.error : 'Mapper test failed',
      errorCode: 'EXECUTION_ERROR',
    };
  }

  return {
    success: true,
    dataSource: slug,
    record: result.record,
    stdout: result.stdout ?? [],
    duration: result.duration,
  };
}
