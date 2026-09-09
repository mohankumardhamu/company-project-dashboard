import cron from 'node-cron';
import { env } from '../env';
import { runWeeklyDigest } from './job';

/**
 * node-cron running inside this single API process is the right size here:
 * one process, one schedule, nothing to coordinate. If the API ever runs
 * more than one instance (horizontal scaling, multiple replicas), every
 * instance would fire this independently and the digest would send multiple
 * times. At that point the fix is a single external trigger — a platform
 * cron hitting an internal endpoint once, or a dedicated worker with leader
 * election — not a queue or message broker: the job is still one
 * fire-and-forget weekly batch, not a stream of work that needs a queue's
 * durability or backpressure.
 */
export function scheduleWeeklyDigest(): void {
  if (!env.digestEnabled) {
    console.log('[digest] scheduling disabled (set DIGEST_ENABLED=true to turn it on)');
    return;
  }
  if (!cron.validate(env.digestCron)) {
    console.error(`[digest] DIGEST_CRON "${env.digestCron}" is not a valid cron expression — not scheduling`);
    return;
  }
  cron.schedule(
    env.digestCron,
    () => {
      runWeeklyDigest().catch((err) => console.error('[digest] run failed:', err));
    },
    { timezone: env.digestTimezone }
  );
  console.log(`[digest] scheduled "${env.digestCron}" (${env.digestTimezone})`);
}
