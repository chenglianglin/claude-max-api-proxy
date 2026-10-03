/**
 * Resume should be retried as a new session only when Claude no longer has
 * that transcript. Other failures keep the mapping so the next call can resume.
 */
export function shouldRestartSession(message: string, sentContent: boolean): boolean {
  if (sentContent) return false;
  if (/timed out/i.test(message)) return false;
  if (/not logged in|authentication|unauthorized/i.test(message)) return false;
  return /no conversation found|session (id )?.*(not found|does not exist|doesn't exist)|invalid session|cannot resume|couldn't find .*session/i.test(
    message
  );
}
