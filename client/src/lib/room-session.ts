export interface RoomSession {
  code: string;
  playerId: string;
  token: string;
}

const STORAGE_PREFIX = 'trivia:room-session:';

function storageKey(code: string): string {
  return `${STORAGE_PREFIX}${code.toUpperCase()}`;
}

export function saveRoomSession(session: RoomSession): void {
  localStorage.setItem(storageKey(session.code), JSON.stringify(session));
}

export function getRoomSession(code: string): RoomSession | null {
  const raw = localStorage.getItem(storageKey(code));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.code === 'string' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.token === 'string'
    ) {
      return parsed as RoomSession;
    }
  } catch {
    // malformed JSON left over from an older schema; treat as no session
  }

  return null;
}

export function clearRoomSession(code: string): void {
  localStorage.removeItem(storageKey(code));
}

export function listRoomSessions(): RoomSession[] {
  const sessions: RoomSession[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const session = getRoomSession(key.slice(STORAGE_PREFIX.length));
    if (session) sessions.push(session);
  }
  return sessions;
}
