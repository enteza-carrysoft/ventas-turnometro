import type pg from 'pg';
import type { Auth } from './auth.js';

export const ROLES = ['admin', 'marketing', 'sales', 'auditor', 'voice'] as const;
export type Role = (typeof ROLES)[number];

export interface NewUser {
  email: string;
  name: string;
  password: string;
  /** null = usuario sin ningún permiso (útil solo en pruebas) */
  role: Role | null;
}

/**
 * Crea un usuario con contraseña y rol. No hay registro público: lo usa el administrador (script `user:create`)
 * y las pruebas. La contraseña se guarda con el hash de Better Auth.
 */
export async function createUser(auth: Auth, pool: pg.Pool, input: NewUser): Promise<string> {
  if (input.password.length < 12) throw new Error('la contraseña debe tener al menos 12 caracteres');
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(input.password);
  const user = await ctx.internalAdapter.createUser(
    { email: input.email.trim().toLowerCase(), name: input.name, emailVerified: true },
    { method: 'email-password' },
  );
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: hash });
  if (input.role) await pool.query('insert into app_user_roles (user_id, role) values ($1, $2)', [user.id, input.role]);
  return user.id;
}

export async function roleOf(pool: pg.Pool, userId: string): Promise<Role | null> {
  const r = await pool.query('select role from app_user_roles where user_id = $1', [userId]);
  const role = (r.rows[0] as { role?: string } | undefined)?.role;
  return (ROLES as readonly string[]).includes(role ?? '') ? (role as Role) : null;
}
