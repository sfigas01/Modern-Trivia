export interface Dispute {
  id: string;
  questionId: string;
  questionText: string;
  correctAnswer: string;
  teamName: string;
  submittedAnswer: string | null;
  teamExplanation: string;
  timestamp: string;
}

const STORAGE_KEY = "trivia_disputes";

export function saveDispute(dispute: Omit<Dispute, "id" | "timestamp">): Dispute {
  const stored = localStorage.getItem(STORAGE_KEY);
  const disputes = stored ? JSON.parse(stored) : [];
  
  const newDispute: Dispute = {
    ...dispute,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString()
  };
  
  disputes.push(newDispute);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(disputes));
  
  return newDispute;
}

export function getAllDisputes(): Dispute[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function clearDisputes(): void {
  localStorage.removeItem(STORAGE_KEY);
}
