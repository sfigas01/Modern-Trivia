const STORAGE_KEY = 'trivia:guest-subject:v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns a persistent opaque browser subject for guest history only. */
export function getStableGuestSubjectId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing && UUID_PATTERN.test(existing)) return existing;

  const subjectId = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, subjectId);
  return subjectId;
}
