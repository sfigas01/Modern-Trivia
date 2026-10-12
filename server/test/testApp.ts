import express, { type Express } from 'express';
import { createServer } from 'http';
import type { ThemePreparationScheduler } from '../routes.rooms';

export async function buildTestApp(
  options: { themePreparationScheduler?: ThemePreparationScheduler } = {}
): Promise<Express> {
  const app = express();
  app.use(express.json());

  const { registerRoutes } = await import('../routes');
  await registerRoutes(createServer(app), app, options);

  return app;
}
