import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Export auth models (REQUIRED for Replit Auth)
export * from "./models/auth";

// Disputes table for QA logging
export const disputes = pgTable("disputes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  questionId: varchar("question_id").notNull(),
  questionText: text("question_text").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  teamName: text("team_name").notNull(),
  submittedAnswer: text("submitted_answer"),
  teamExplanation: text("team_explanation").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertDisputeSchema = createInsertSchema(disputes).omit({
  id: true,
  timestamp: true,
});

export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputes.$inferSelect;

// Admin roles table
export const adminRoles = pgTable("admin_roles", {
  userId: varchar("user_id").primaryKey().notNull(),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  grantedBy: varchar("granted_by"),
});

export type AdminRole = typeof adminRoles.$inferSelect;
