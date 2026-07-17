import { useMemo } from 'react';
import type { Question } from '@/lib/store';

export function useCategoryCounts(questions: Question[]): Record<string, number> {
  return useMemo(() => {
    const counts: Record<string, number> = {};
    questions.forEach((q) => {
      counts[q.category] = (counts[q.category] || 0) + 1;
    });
    counts['All'] = questions.length;
    return counts;
  }, [questions]);
}
