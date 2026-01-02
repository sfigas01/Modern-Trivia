// This file is kept for backward compatibility but is no longer used
// All storage operations are now handled through:
// - server/replit_integrations/auth/storage.ts for user operations
// - server/db.ts + Drizzle ORM for all other database operations

export interface IStorage {
  // Legacy interface - not actively used
}

export const storage = {} as IStorage;
