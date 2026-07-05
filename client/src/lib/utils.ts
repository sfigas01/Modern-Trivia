import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDifficultyBadgeClass(difficulty: string): string {
  switch (difficulty) {
    case 'Easy':
      return 'bg-[var(--color-difficulty-easy)] text-white';
    case 'Medium':
      return 'bg-[var(--color-difficulty-medium)] text-black';
    case 'Hard':
      return 'bg-[var(--color-difficulty-hard)] text-white';
    default:
      return 'bg-primary';
  }
}
