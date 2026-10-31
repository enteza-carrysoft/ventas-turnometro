import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import type pg from 'pg';

export interface AuthOptions {
  secret: string;
  baseURL: string;
}

/**
 * Better Auth sobre la misma Postgres (rol `app`). Sin registro público: los usuarios los crea un admin
 * (constitución P5.2). Las tablas de Better Auth están en la migración 0004 del paquete db.
 */
export function createAuth(pool: pg.Pool, opts: AuthOptions) {
  return betterAuth({
    database: pool,
    secret: opts.secret,
    baseURL: opts.baseURL,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 60 },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
