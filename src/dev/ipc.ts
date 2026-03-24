/**
 * Central IPC module for headless mode.
 *
 * All stdout writes go through here. Two distinct message types:
 * - System events: unsolicited, no requestId (session lifecycle, connection, etc.)
 * - Command responses: always have requestId + status (started/completed)
 *
 * The caller distinguishes them by the presence of `requestId`.
 */

/**
 * Emit a system event (no requestId).
 * Used for unsolicited events: session lifecycle, connection health, auth, etc.
 */
export function emitEvent(event: string, data?: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ event, ...data }) + '\n');
}

/**
 * Emit a command response (always has requestId).
 * Used for responses to stdin commands.
 */
export function emitResponse(
  action: string,
  requestId: string,
  status: 'started' | 'completed',
  data?: Record<string, unknown>,
): void {
  process.stdout.write(
    JSON.stringify({ event: action, requestId, status, ...data }) + '\n',
  );
}
