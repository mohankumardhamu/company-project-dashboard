import cors from 'cors';
import express from 'express';
import { sql } from 'drizzle-orm';
import { db, pool } from './db';
import { env } from './env';
import { errorHandler } from './http';
import { authRouter } from './routes/auth';
import { overviewRouter } from './routes/overview';
import { projectsRouter } from './routes/projects';
import { reportsRouter } from './routes/reports';
import { tasksRouter } from './routes/tasks';
import { teamsRouter } from './routes/teams';
import { usersRouter } from './routes/users';
import { workLogsRouter } from './routes/worklogs';

const app = express();

app.use(
  cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: false,
    exposedHeaders: ['Content-Disposition'],
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Database unreachable' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/worklogs', workLogsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/overview', overviewRouter);

app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use(errorHandler);

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

export { app };
