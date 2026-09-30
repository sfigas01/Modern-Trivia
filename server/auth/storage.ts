import { users, type User } from '@shared/models/auth';
import { db } from '../db';
import { asc, eq, sql } from 'drizzle-orm';

export interface SignInProfile {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  /**
   * Find the user whose email matches (case-insensitively) and refresh their
   * profile, or create a new user. An existing user keeps their `users.id`, so
   * seen_questions, admin_roles and every other user-linked row stay attached
   * when the sign-in provider changes.
   */
  upsertUserByEmail(profile: SignInProfile): Promise<User>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pick the account to sign in to from users whose email matches
 * case-insensitively. Prefers an exact match on the normalized email, then
 * the oldest account (candidates must be sorted by createdAt ascending).
 */
export function pickExistingUser<T extends Pick<User, 'email'>>(
  candidates: T[],
  normalizedEmail: string
): T | undefined {
  return candidates.find((user) => user.email === normalizedEmail) ?? candidates[0];
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUserByEmail(profile: SignInProfile): Promise<User> {
    const email = normalizeEmail(profile.email);
    const profileFields = {
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      profileImageUrl: profile.profileImageUrl ?? null,
    };

    const candidates = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .orderBy(asc(users.createdAt));

    if (candidates.length > 1) {
      console.warn(
        `Auth: ${candidates.length} users share an email case-insensitively; signing in to the oldest exact or case-insensitive match`
      );
    }

    const existing = pickExistingUser(candidates, email);
    if (existing) {
      const [updated] = await db
        .update(users)
        .set({ ...profileFields, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    // New player. The id comes from the column default (gen_random_uuid()),
    // not the provider's subject, so ids never depend on the sign-in provider.
    // The conflict target covers two first logins racing for the same email.
    const [created] = await db
      .insert(users)
      .values({ email, ...profileFields })
      .onConflictDoUpdate({
        target: users.email,
        set: { ...profileFields, updatedAt: new Date() },
      })
      .returning();
    return created;
  }
}

export const authStorage = new AuthStorage();
