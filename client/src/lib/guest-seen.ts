// Client-only "seen questions" tracking for non-signed-in players. Signed-in
// users get server-side exclusion via the seen_questions table; guests get
// this localStorage-backed equivalent so they don't see repeat questions
// across separate games on the same browser.

const STORAGE_KEY = 'modern-trivia:guest-seen:v1';
const MAX_SEEN_IDS = 500;

function normalizeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function getGuestSeenIds(): string[] {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeIds(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Malformed JSON or any other parse failure — degrade to empty history.
    return [];
  }
}

export function addGuestSeenIds(ids: string[]): void {
  const incomingIds = normalizeIds(ids);
  if (incomingIds.length === 0) return;
  const storage = getStorage();
  if (!storage) return;

  try {
    const existing = getGuestSeenIds();
    const incoming = new Set(incomingIds);
    // Move re-seen ids to the newest position instead of duplicating them.
    const merged = [...existing.filter((id) => !incoming.has(id)), ...incomingIds];
    const capped =
      merged.length > MAX_SEEN_IDS ? merged.slice(merged.length - MAX_SEEN_IDS) : merged;
    storage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    // localStorage unavailable (private browsing) or quota exceeded — degrade silently.
  }
}
