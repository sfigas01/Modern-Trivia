import { useState } from 'react';
import { QuestionScreen } from '@/components/QuestionScreen';
import type { Question, Team } from '@/lib/store';

const MOCK_QUESTION: Question = {
  id: 'preview-1',
  category: 'Technology',
  difficulty: 'Hard',
  question:
    'Which programming language, designed by Bjarne Stroustrup, is widely used for system programming and game development?',
  answer: 'C++',
  explanation: 'C++ was developed by Bjarne Stroustrup starting in 1979.',
  pillar: 'tech',
  tags: ['programming'],
};

const MOCK_TEAMS: Team[] = [
  { id: 'joe', name: 'Joe', score: 376, questionCount: 0, lastRoundDelta: 50 },
  { id: 'jane', name: 'Jane', score: 192, questionCount: 0, lastRoundDelta: 20 },
];

export default function QuestionPreview() {
  const [typed, setTyped] = useState('');
  return (
    <QuestionScreen
      question={MOCK_QUESTION}
      activeTeam={MOCK_TEAMS[0]}
      allTeams={MOCK_TEAMS}
      questionNumber={1}
      typedAnswer={typed}
      onType={setTyped}
      onSubmit={() => alert('Submit: ' + typed)}
      onPass={() => alert('Pass')}
    />
  );
}
