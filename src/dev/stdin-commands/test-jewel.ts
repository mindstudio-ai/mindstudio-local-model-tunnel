import { detectAppConfigUntil } from '../config/app-config';
import { CommandError } from './types';
import type { CommandContext } from './types';

// Run a method's jewel directly against a test input — the jewel authoring
// loop. Exactly one of `humanInput` (shadow-style run, graded against it as
// ground truth) or `subject` (eval run, ungraded). The method itself is NOT
// executed, and nothing reaches the platform pair ledger.
export async function handleTestJewel(
  ctx: CommandContext,
  cmd: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!ctx.state.runner)
    throw new CommandError('No active session', 'NO_SESSION');

  const methodName = cmd.method as string;
  if (!methodName)
    throw new CommandError(
      'test-jewel requires "method" (export name or ID)',
      'INVALID_INPUT',
    );

  const hasHumanInput = cmd.humanInput !== undefined;
  const hasSubject = cmd.subject !== undefined;
  if (hasHumanInput === hasSubject) {
    throw new CommandError(
      'test-jewel requires exactly one of "humanInput" (graded shadow-style run) or "subject" (ungraded eval run)',
      'INVALID_INPUT',
    );
  }

  // Retry-aware manifest read — same freshness window as run-method.
  const freshConfig =
    (await detectAppConfigUntil(ctx.cwd, (c) =>
      c.methods.some((m) => m.export === methodName || m.id === methodName),
    )) ?? ctx.state.appConfig;
  const method =
    freshConfig?.methods.find((m) => m.export === methodName) ??
    freshConfig?.methods.find((m) => m.id === methodName);
  if (!method)
    throw new CommandError(`Unknown method: ${methodName}`, 'INVALID_INPUT');
  if (!method.jewel) {
    throw new CommandError(
      `Method "${methodName}" has no jewel in the manifest — add a "jewel": { "path": ... } entry to test one`,
      'INVALID_INPUT',
    );
  }

  ctx.started({ method: method.export, jewel: method.jewel.path });

  const result = await ctx.state.runner.testJewel({
    method,
    humanInput: cmd.humanInput,
    subject: cmd.subject,
  });

  if (!result.success) {
    return {
      success: false,
      method: method.export,
      error: 'error' in result ? result.error : 'Jewel test failed',
      errorCode: 'EXECUTION_ERROR',
    };
  }

  return {
    success: true,
    method: method.export,
    pair: result.pair,
    stdout: result.stdout ?? [],
    duration: result.duration,
  };
}
