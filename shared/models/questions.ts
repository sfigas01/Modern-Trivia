import {
  pgTable,
  text,
  varchar,
  jsonb,
  timestamp,
  index,
  primaryKey,
  integer,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { users } from './auth';

// Questions table — stores all trivia questions (migrated from client/src/lib/questions.json)
export const questions = pgTable('questions', {
  id: varchar('id').primaryKey(),
  category: varchar('category').notNull(),
  difficulty: varchar('difficulty', { length: 10 }).notNull(), // 'Easy' | 'Medium' | 'Hard'
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  acceptableAnswers: jsonb('acceptable_answers').$type<string[]>().default([]),
  explanation: text('explanation').notNull(),
  pillar: varchar('pillar', { length: 30 }).notNull(), // 'GlobalEh' | 'FreshPrints' | 'TimeCapsule' | 'GreatOutdoors'
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  sourceUrl: text('source_url'),
  sourceName: varchar('source_name'),
  status: varchar('status', { length: 20 }).notNull().default('approved'), // 'draft' | 'pending' | 'approved' | 'rejected'
  aiAnalysis: jsonb('ai_analysis'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertQuestionSchema = createInsertSchema(questions, {
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  pillar: z.enum(['GlobalEh', 'FreshPrints', 'TimeCapsule', 'GreatOutdoors']),
  status: z.enum(['draft', 'pending', 'approved', 'rejected']).default('approved'),
  tags: z.array(z.string()).default([]),
  acceptableAnswers: z.array(z.string()).default([]),
}).omit({ createdAt: true, updatedAt: true });

export const selectQuestionSchema = createSelectSchema(questions);

export type Question = typeof questions.$inferSelect;
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;

// Seen questions table — tracks which questions each player has seen to prevent repeats
export const seenQuestions = pgTable(
  'seen_questions',
  {
    userId: varchar('user_id')
      .notNull()
      .references(() => users.id),
    questionId: varchar('question_id')
      .notNull()
      .references(() => questions.id),
    seenAt: timestamp('seen_at').notNull().defaultNow(),
    seenCount: integer('seen_count').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.questionId] }),
    index('idx_seen_questions_user').on(table.userId),
  ]
);

export type SeenQuestion = typeof seenQuestions.$inferSelect;
