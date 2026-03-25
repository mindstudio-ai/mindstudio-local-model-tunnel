/**
 * Format an error object from the executor into a readable string.
 * Includes extra fields like code, statusCode, cause, etc. when present.
 */
export function formatErrorForDisplay(
  error: Record<string, unknown>,
): string {
  const parts: string[] = [];

  // Main message
  if (error.message) {
    parts.push(String(error.message));
  }

  // Status/code info
  const code = error.code ?? error.statusCode ?? error.status;
  if (code !== undefined) {
    parts.push(`(code: ${code})`);
  }

  // Response body from HTTP errors
  if (error.body) {
    parts.push(`Response: ${String(error.body).slice(0, 200)}`);
  } else if (error.response) {
    parts.push(`Response: ${String(error.response).slice(0, 200)}`);
  }

  // Cause chain
  if (error.cause && typeof error.cause === 'object') {
    const cause = error.cause as Record<string, unknown>;
    if (cause.message) {
      parts.push(`Caused by: ${cause.message}`);
    }
  }

  return parts.join('\n');
}
