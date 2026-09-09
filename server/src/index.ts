import cors from 'cors';
import express from 'express';
import { sql } from 'drizzle-orm';
import { db, pool } from './db';
import { scheduleWeeklyDigest } from './digest';
import { env } from './env';
import { errorHandler } from './http';
import { accountsRouter } from './routes/accounts';
import { authRouter } from './routes/auth';
import { digestRouter } from './routes/digest';
import { outcomesRouter } from './routes/outcomes';
import { overviewRouter } from './routes/overview';
import { portfolioRouter } from './routes/portfolio';
import { projectsRouter } from './routes/projects';
import { registerRouter } from './routes/register';
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
app.use('/api/accounts', accountsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/worklogs', workLogsRouter);
app.use('/api/outcomes', outcomesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/overview', overviewRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/digest', digestRouter);
app.use('/api/register', registerRouter);

app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use(errorHandler);

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.port}`);
});

scheduleWeeklyDigest();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}

export { app };
