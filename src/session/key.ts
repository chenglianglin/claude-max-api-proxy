const MAX_SESSION_KEY_LENGTH = 256;

export interface SessionKeyResult {
  key?: string;
  error?: string;
}

/**
 * Header wins when it is non-empty. Otherwise the OpenAI `user` field is the key.
 * No key means the request stays stateless.
 */
export function resolveClientSessionKey(
  header: string | undefined,
  user: string | undefined
): SessionKeyResult {
  const fromHeader = header?.trim();
  const raw = fromHeader ? fromHeader : user?.trim();
  if (!raw) return {};
  if (raw.length > MAX_SESSION_KEY_LENGTH || /[\u0000\r\n]/.test(raw)) {
    return {
      error: "session key must be a single line of at most 256 characters",
    };
  }
  return { key: raw };
}
