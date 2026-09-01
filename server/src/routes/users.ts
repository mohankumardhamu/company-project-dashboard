import { and, asc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
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

const listQuerySchema = z.object({
  // Comma-separated, e.g. "ENGINEER,PM" — lets a caller narrow to a pool of roles at once.
  role: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * Directory listing. VP/Director see everyone. A PM sees the staffable pool
 * (engineers and PMs) so they can build a team. An engineer sees only the
 * people they share a team with.
 *
 * `role`, `name` and `email` narrow the result — the "Add member" picker uses
 * all three so a large org stays searchable instead of shipping every user
 * to the browser. `limit` caps how many rows come back.
 */
usersRouter.get(
  '/',
  ah(async (req, res) => {
    const me = currentUser(req);
    const query = listQuerySchema.parse(req.query);
    const roleFilter = query.role
      ? query.role
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean)
          .map((r) => roleSchema.parse(r))
      : undefined;
    const nameFilter = query.name ? ilike(users.name, `%${query.name}%`) : undefined;
    const emailFilter = query.email ? ilike(users.email, `%${query.email}%`) : undefined;

    let where: SQL | undefined;
    if (me.role === 'ADMIN' || me.role === 'VP' || me.role === 'DIRECTOR') {
      where = and(roleFilter ? inArray(users.role, roleFilter) : undefined, nameFilter, emailFilter);
    } else if (me.role === 'PM') {
      where = and(
        eq(users.active, true),
        inArray(users.role, roleFilter ?? ['ENGINEER', 'PM']),
        nameFilter,
        emailFilter
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
        roleFilter ? inArray(users.role, roleFilter) : undefined,
        teammateIds ? or(eq(users.id, me.id), inArray(users.id, teammateIds)) : eq(users.id, me.id),
        nameFilter,
        emailFilter
      );
    }

    const baseQuery = db
      .select(publicColumns)
      .from(users)
      .where(where)
      .orderBy(asc(users.role), asc(users.name));
    const rows = query.limit ? await baseQuery.limit(query.limit) : await baseQuery;
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
