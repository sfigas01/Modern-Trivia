import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { db } from "./db";
import { disputes, adminRoles, insertDisputeSchema } from "@shared/schema";
import { eq } from "drizzle-orm";

// Middleware to check if user is admin
async function isAdmin(req: any, res: any, next: any) {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [user] = await db
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.userId, userId))
      .limit(1);

    if (!user) {
      return res.status(403).json({ message: "Forbidden: Admin access required" });
    }

    next();
  } catch (error) {
    console.error("Error checking admin status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication (MUST be before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);

  // Disputes API - protected by admin middleware
  app.get("/api/disputes", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const allDisputes = await db.select().from(disputes);
      res.json(allDisputes);
    } catch (error) {
      console.error("Error fetching disputes:", error);
      res.status(500).json({ message: "Failed to fetch disputes" });
    }
  });

  app.post("/api/disputes", async (req, res) => {
    try {
      const parsed = insertDisputeSchema.parse(req.body);
      const [newDispute] = await db.insert(disputes).values(parsed).returning();
      res.status(201).json(newDispute);
    } catch (error) {
      console.error("Error creating dispute:", error);
      res.status(400).json({ message: "Invalid dispute data" });
    }
  });

  app.delete("/api/disputes", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await db.delete(disputes);
      res.json({ message: "All disputes cleared" });
    } catch (error) {
      console.error("Error clearing disputes:", error);
      res.status(500).json({ message: "Failed to clear disputes" });
    }
  });

  // Admin management routes
  app.post("/api/admin/grant", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { userId } = req.body;
      const grantedBy = req.user?.claims?.sub;

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      await db.insert(adminRoles).values({
        userId,
        grantedBy,
      });

      res.json({ message: "Admin access granted" });
    } catch (error) {
      console.error("Error granting admin:", error);
      res.status(500).json({ message: "Failed to grant admin access" });
    }
  });

  app.delete("/api/admin/revoke/:userId", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      await db.delete(adminRoles).where(eq(adminRoles.userId, userId));
      res.json({ message: "Admin access revoked" });
    } catch (error) {
      console.error("Error revoking admin:", error);
      res.status(500).json({ message: "Failed to revoke admin access" });
    }
  });

  app.get("/api/admin/check", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const [admin] = await db
        .select()
        .from(adminRoles)
        .where(eq(adminRoles.userId, userId))
        .limit(1);

      res.json({ isAdmin: !!admin });
    } catch (error) {
      console.error("Error checking admin status:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
