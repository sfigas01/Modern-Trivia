export const VALID_CATEGORIES = [
  'History & Geography',
  'Science & Nature',
  'Sports',
  'Entertainment & Pop Culture',
  'Food & Culture',
  'Technology',
] as const;

export type Category = (typeof VALID_CATEGORIES)[number];

export const CATEGORY_SET = new Set<string>(VALID_CATEGORIES);

export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  geography: 'History & Geography',
  history: 'History & Geography',
  government: 'History & Geography',
  science: 'Science & Nature',
  nature: 'Science & Nature',
  space: 'Science & Nature',
  sports: 'Sports',
  entertainment: 'Entertainment & Pop Culture',
  movies: 'Entertainment & Pop Culture',
  'pop culture': 'Entertainment & Pop Culture',
  music: 'Entertainment & Pop Culture',
  food: 'Food & Culture',
  culture: 'Food & Culture',
  art: 'Food & Culture',
  literature: 'Food & Culture',
  technology: 'Technology',
  'general knowledge': 'Science & Nature',
};
