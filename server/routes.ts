import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { db } from "./db";
import { disputes, adminRoles, insertDisputeSchema, appConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { analyzeDispute } from "./lib/ai";

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

  app.post("/api/disputes", isAuthenticated, async (req, res) => {
    try {
      const parsed = insertDisputeSchema.parse(req.body);
      const [newDispute] = await db.insert(disputes).values(parsed).returning();
      res.status(201).json(newDispute);
    } catch (error) {
      console.error("Error creating dispute:", error);
      const statusCode = error instanceof Error && error.message.includes("validation") ? 422 : 400;
      res.status(statusCode).json({ message: "Invalid dispute data" });
    }
  });

  // Analyze dispute with AI
  app.post("/api/disputes/:id/analyze", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const [dispute] = await db
        .select()
        .from(disputes)
        .where(eq(disputes.id, id))
        .limit(1);

      if (!dispute) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      const analysis = await analyzeDispute(
        dispute.questionText,
        dispute.correctAnswer,
        dispute.submittedAnswer || "",
        dispute.teamExplanation
      );

      // Save analysis to DB
      await db
        .update(disputes)
        .set({ aiAnalysis: analysis })
        .where(eq(disputes.id, id));

      res.json(analysis);
    } catch (error) {
      console.error("Error analyzing dispute:", error);
      res.status(500).json({ message: error instanceof Error ? error.message : "Analysis failed" });
    }
  });

  // Update dispute status
  app.patch("/api/disputes/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, resolutionNote, aiAnalysis } = req.body;

      // Validate status enum
      if (status && !["pending", "resolved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const [updated] = await db
        .update(disputes)
        .set({
          status,
          resolutionNote,
          aiAnalysis,
        })
        .where(eq(disputes.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Dispute not found" });
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating dispute:", error);
      res.status(500).json({ message: "Failed to update dispute" });
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
  app.post("/api/admin/grant", isAuthenticated, isAdmin, async (req: any, res) => {
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


  // App Configuration Routes (Admin Only)
  app.get("/api/admin/config", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const config = await db.select().from(appConfig);
      // Don't return actual values for sensitive keys like API keys
      const safeConfig = config.map((c) => ({
        key: c.key,
        // Mask the value if it looks like a key
        value: c.key.includes("key") || c.key.includes("secret") ? "********" : c.value,
        updatedAt: c.updatedAt,
      }));
      res.json(safeConfig);
    } catch (error) {
      console.error("Error fetching config:", error);
      res.status(500).json({ message: "Failed to fetch configuration" });
    }
  });

  app.post("/api/admin/config", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key || !value) {
        return res.status(400).json({ message: "Key and value are required" });
      }

      // Upsert configuration
      const [updated] = await db
        .insert(appConfig)
        .values({ key, value })
        .onConflictDoUpdate({
          target: appConfig.key,
          set: { value, updatedAt: new Date() },
        })
        .returning();

      res.json({ message: "Configuration saved", key: updated.key });
    } catch (error) {
      console.error("Error saving config:", error);
      res.status(500).json({ message: "Failed to save configuration" });
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

  app.get("/api/admin/check", isAuthenticated, async (req: any, res) => {
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
