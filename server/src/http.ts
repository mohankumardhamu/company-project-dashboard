import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'Not authenticated') => new HttpError(401, m);
export const forbidden = (m = 'You do not have access to this resource') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/** Wraps an async handler so rejected promises reach the error middleware. */
export function ah(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Postgres constraint violations surface as driver errors; translate the
  // two that are genuinely the caller's fault into 4xx responses.
  const pgErr = err as { code?: string; constraint?: string; detail?: string };
  if (pgErr?.code === '23505') {
    const friendly: Record<string, string> = {
      users_email_key: 'An account with that email already exists',
      projects_code_key: 'A project with that code already exists',
      teams_pm_name_key: 'You already lead a team with that name',
      team_members_team_user_key: 'That person is already on this team',
      work_logs_task_user_date_key: 'You already logged work on that task for that date',
    };
    return res
      .status(409)
      .json({ error: friendly[pgErr.constraint ?? ''] ?? 'That record already exists' });
  }
  if (pgErr?.code === '23503') {
    return res.status(400).json({ error: 'That references a record which does not exist' });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
