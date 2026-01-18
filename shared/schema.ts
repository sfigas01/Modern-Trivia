import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
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
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, resolved, rejected
  resolutionNote: text("resolution_note"),
  aiAnalysis: jsonb("ai_analysis"),
});

export const insertDisputeSchema = createInsertSchema(disputes).omit({
  id: true,
  timestamp: true,
  status: true,
  resolutionNote: true,
  aiAnalysis: true,
});

export type InsertDispute = z.infer<typeof insertDisputeSchema>;
export type Dispute = typeof disputes.$inferSelect;

// App configuration for LLM settings (stored securely)
export const appConfig = pgTable("app_config", {
  key: varchar("key").primaryKey().notNull(), // e.g., 'openai_api_key', 'llm_provider'
  value: text("value").notNull(), // Encrypted or raw value
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppConfig = typeof appConfig.$inferSelect;

// Admin roles table
export const adminRoles = pgTable("admin_roles", {
  userId: varchar("user_id").primaryKey().notNull(),
  grantedAt: timestamp("granted_at").notNull().defaultNow(),
  grantedBy: varchar("granted_by"),
});

export type AdminRole = typeof adminRoles.$inferSelect;
