const MAX_SESSION_KEY_LENGTH = 256;

export interface SessionKeyResult {
  key?: string;
  error?: string;
}

/**
 * Header wins when it is non-empty. Otherwise the OpenAI `user` field is the key.
 * An `x-user-id` value namespaces the key so users never share a session; on its
 * own it makes one session per user. No key means the request stays stateless.
 */
export function resolveClientSessionKey(
  header: string | undefined,
  user: string | undefined,
  userId?: string
): SessionKeyResult {
  const fromHeader = header?.trim();
  const base = fromHeader ? fromHeader : user?.trim();
  const id = userId?.trim();
  const raw = id ? (base ? `${id}:${base}` : id) : base;
  if (!raw) return {};
  if (raw.length > MAX_SESSION_KEY_LENGTH || /[\u0000\r\n]/.test(raw)) {
    return {
      error: "session key must be a single line of at most 256 characters",
    };
  }
  return { key: raw };
}

/**
 * Open WebUI sends X-Claude-Session-Key as user_id:chat_id.
 * Other keys stay session keys only and do not yield a caller id.
 */
export function callerUserIdFromSessionKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const colon = key.indexOf(":");
  if (colon <= 0 || colon >= key.length - 1) return undefined;
  const userId = key.slice(0, colon).trim();
  const chatId = key.slice(colon + 1).trim();
  if (!userId || !chatId) return undefined;
  return userId;
}
