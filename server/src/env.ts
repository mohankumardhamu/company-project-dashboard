import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true';
};

export const env = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  isProd: process.env.NODE_ENV === 'production',

  // Reporting periods are fortnights (Monday–Sunday x2) counted from this
  // Monday. Every period boundary in the app derives from it, so changing it
  // re-buckets all historical data — set it once to a sprint start and leave it.
  biweekAnchor: process.env.BIWEEK_ANCHOR ?? '2026-01-05',

  // Bi-weekly digest — off by default so nothing sends during development.
  digestEnabled: bool('DIGEST_ENABLED', false),
  digestCron: process.env.DIGEST_CRON ?? '0 8 * * 1',
  digestTimezone: process.env.DIGEST_TIMEZONE ?? 'UTC',
  digestAdapter: (process.env.DIGEST_ADAPTER ?? 'file') as 'file' | 'smtp',
  outboxDir: process.env.OUTBOX_DIR ?? 'outbox',

  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: bool('SMTP_SECURE', false),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'Project Dashboard <digest@localhost>',
};

if (
  !/^\d{4}-\d{2}-\d{2}$/.test(env.biweekAnchor) ||
  new Date(`${env.biweekAnchor}T00:00:00.000Z`).getUTCDay() !== 1
) {
  throw new Error(`BIWEEK_ANCHOR must be a Monday in YYYY-MM-DD form (got "${env.biweekAnchor}")`);
}

if (env.isProd && env.jwtSecret === 'dev-only-insecure-secret') {
  throw new Error('JWT_SECRET must be set to a real secret in production');
}
