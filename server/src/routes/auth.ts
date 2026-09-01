import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, signToken, verifyPassword } from '../auth';
import { db } from '../db';
import { users } from '../db/schema';
import { ah, unauthorized } from '../http';

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
