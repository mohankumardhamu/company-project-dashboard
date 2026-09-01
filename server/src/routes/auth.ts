import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, hashPassword, signToken, verifyPassword } from '../auth';
import { db } from '../db';
import { users } from '../db/schema';
import { ah, badRequest, unauthorized } from '../http';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

    // Same message for unknown email and wrong password: don't leak which accounts exist.
    const ok = user && user.active && (await verifyPassword(password, user.passwordHash));
    if (!ok) throw unauthorized('Invalid email or password');

    const payload = { id: user.id, email: user.email, name: user.name, role: user.role };
    res.json({ token: signToken(payload), user: payload });
  })
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    res.json({ user: currentUser(req) });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

/** Self-service: any signed-in user (including one just onboarded with a temp password) can change their own. */
authRouter.post(
  '/change-password',
  authenticate,
  ah(async (req, res) => {
    const me = currentUser(req);
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw unauthorized('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw badRequest('New password must be different from your current password');
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, me.id));
    res.status(204).send();
  })
);
