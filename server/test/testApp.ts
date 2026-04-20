import express, { type Express } from 'express';
import { createServer } from 'http';

export async function buildTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());

  const { registerRoutes } = await import('../routes');
  await registerRoutes(createServer(app), app);

  return app;
}
