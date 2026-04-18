// Re-export types from shared schema
export type { Dispute, InsertDispute } from '@shared/schema';

// Save dispute to database via API
export async function saveDispute(dispute: {
  questionId: string;
  questionText: string;
  correctAnswer: string;
  teamName: string;
  submittedAnswer: string | null;
  teamExplanation: string;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await fetch('/api/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(dispute),
    });

    if (!response.ok) {
      console.error('Failed to save dispute:', response.statusText);
      return { success: false, message: 'Failed to save dispute' };
    }

    console.log('QA Dispute saved to database');
    return { success: true };
  } catch (error) {
    console.error('Error saving dispute:', error);
    return { success: false, message: 'Network error' };
  }
}
