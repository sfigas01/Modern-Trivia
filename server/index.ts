import express, { type Request, Response, NextFunction } from 'express';
import { registerRoutes } from './routes';
import { serveStatic } from './static';
import { createServer } from 'http';
import { generalLimiter } from './middleware/rateLimiter';
import { runMigrations } from './lib/migrate';
import { seedQuestions } from './seed';
import { registerHealthRoute } from './health';
import { pool } from './db';
import { bootstrapThemeE1ApplicationRuntime } from './lib/theme-e1-application-runtime';

const app = express();
const httpServer = createServer(app);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false }));

app.set('trust proxy', 1);
app.use('/api', generalLimiter);

export function log(message: string, source = 'express') {
  const formattedTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  if (process.env.NODE_ENV !== 'production') {
    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (path.startsWith('/api')) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await runMigrations();
  await seedQuestions();
  const themeRuntime = await bootstrapThemeE1ApplicationRuntime({
    pool,
    reportCode: (code) => log(`theme preview runtime: ${code}`),
  });
  await registerRoutes(httpServer, app, {
    themePreparationScheduler: themeRuntime.started ? themeRuntime : undefined,
  });
  // Registered after migrations and routes so Railway only sees healthy once
  // the app can actually serve requests.
  registerHealthRoute(app, pool);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(status).json({ message });
    console.error(err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === 'production') {
    serveStatic(app);
  } else {
    const { setupVite } = await import('./vite');
    await setupVite(httpServer, app);
  }

  // Serve the API and the client on PORT (Railway routes the public domain to
  // it). Defaults to 5000.
  httpServer.requestTimeout = 10 * 60 * 1000;
  httpServer.headersTimeout = 10 * 60 * 1000 + 5000;
  httpServer.keepAliveTimeout = 10 * 60 * 1000;

  const port = parseInt(process.env.PORT || '5000', 10);
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}; stopping`);
    if (themeRuntime.started) await themeRuntime.stop();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve()))
    );
    await pool.end();
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void shutdown(signal).catch((error) => {
        console.error('Graceful shutdown failed:', error);
        process.exitCode = 1;
      });
    });
  httpServer.listen(
    {
      port,
      host: '0.0.0.0',
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    }
  );
})();
