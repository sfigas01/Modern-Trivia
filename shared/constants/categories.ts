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
