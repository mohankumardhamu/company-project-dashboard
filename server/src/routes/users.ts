import { and, asc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, hashPassword, requireRole } from '../auth';
import { db } from '../db';
import { roleEnum, teamMembers, users, type Role } from '../db/schema';
import { ah, badRequest, forbidden, notFound } from '../http';
import { visibleTeamIds } from '../scope';

export const usersRouter = Router();
usersRouter.use(authenticate);

const publicColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  active: users.active,
  createdAt: users.createdAt,
};

/**
 * Who may create which roles. Admin onboards anyone, including other Admins;
 * VP onboards any business role; Director onboards delivery staff.
 */
const CREATABLE_ROLES: Record<Role, Role[]> = {
  ADMIN: ['ADMIN', 'VP', 'DIRECTOR', 'PM', 'ENGINEER'],
  VP: ['VP', 'DIRECTOR', 'PM', 'ENGINEER'],
  DIRECTOR: ['PM', 'ENGINEER'],
  PM: [],
  ENGINEER: [],
};

const roleSchema = z.enum(roleEnum.enumValues);

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: roleSchema,
});

usersRouter.post(
  '/',
  requireRole('ADMIN', 'VP', 'DIRECTOR'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = createUserSchema.parse(req.body);
    if (!CREATABLE_ROLES[me.role].includes(body.role)) {
      throw forbidden(
        `A ${me.role} may only create users with role: ${CREATABLE_ROLES[me.role].join(', ')}`
      );
    }
    const [user] = await db
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        name: body.name,
        role: body.role,
        passwordHash: await hashPassword(body.password),
        createdById: me.id,
      })
      .returning(publicColumns);
    res.status(201).json(user);
  })
);

/**
 * Directory listing. VP/Director see everyone. A PM sees the staffable pool
 * (engineers and PMs) so they can build a team. An engineer sees only the
 * people they share a team with.
 */
usersRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const roleFilter = req.query.role ? roleSchema.parse(String(req.query.role)) : undefined;

    let where: SQL | undefined;
    if (me.role === 'ADMIN' || me.role === 'VP' || me.role === 'DIRECTOR') {
      where = roleFilter ? eq(users.role, roleFilter) : undefined;
    } else if (me.role === 'PM') {
      where = and(
        eq(users.active, true),
        roleFilter ? eq(users.role, roleFilter) : inArray(users.role, ['ENGINEER', 'PM'])
      );
    } else {
      const teamIds = await visibleTeamIds(me);
      const teammateIds = teamIds.length
        ? db
            .select({ id: teamMembers.userId })
            .from(teamMembers)
            .where(inArray(teamMembers.teamId, teamIds))
        : undefined;
      where = and(
        roleFilter ? eq(users.role, roleFilter) : undefined,
        teammateIds ? or(eq(users.id, me.id), inArray(users.id, teammateIds)) : eq(users.id, me.id)
      );
    }

    const rows = await db
      .select(publicColumns)
      .from(users)
      .where(where)
      .orderBy(asc(users.role), asc(users.name));
    res.json(rows);
  })
);

const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  active: z.boolean().optional(),
  role: roleSchema.optional(),
  password: z.string().min(8).optional(),
});

usersRouter.patch(
  '/:id',
  requireRole('ADMIN', 'VP'),
  ah(async (req, res) => {
    const me = currentUser(req);
    const body = updateUserSchema.parse(req.body);
    if (Object.keys(body).length === 0) throw badRequest('Nothing to update');
    if (req.params.id === me.id && body.active === false) {
      throw badRequest('You cannot deactivate your own account');
    }
    if (body.role === 'ADMIN' && me.role !== 'ADMIN') {
      throw forbidden('Only an Admin can grant Admin access');
    }

    const [user] = await db
      .update(users)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.params.id))
      .returning(publicColumns);

    if (!user) throw notFound('User not found');
    res.json(user);
  })
);
