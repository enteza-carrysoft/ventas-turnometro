import { createHmac } from 'node:crypto';
import { createTurnstileVerifier } from '@turnosala/connectors/turnstile';
import { getServer } from './server.js';
import type { PublicDeps } from './public-handlers.js';

// Configuración de las páginas públicas, a partir del entorno. Los secretos solo se leen aquí, en el servidor.

export interface PublicConfig {
  mode: 'sandbox' | 'production';
  /** `sandbox-test`: sin widget ni red (solo sandbox); `turnstile`: widget y verificación reales */
  captcha: 'sandbox-test' | 'turnstile';
  siteKey: string | null;
  secret: string;
  /** secreto derivado: firma la marca de tiempo del formulario y hace el HMAC de las IP (no es el de sesión) */
  formSecret: string;
}

export function publicConfigFrom(env: Record<string, string | undefined>): PublicConfig {
  const session = env.BETTER_AUTH_SECRET;
  if (!session || session.length < 32) throw new Error('Falta BETTER_AUTH_SECRET (mínimo 32 caracteres)');
  const mode = env.APP_MODE === 'production' ? 'production' : 'sandbox';
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || null;
  const secret = env.TURNSTILE_SECRET_KEY?.trim() || '';
  const real = siteKey !== null && secret !== '';
  if (mode === 'production' && !real) throw new Error('En producción hacen falta TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY');
  return {
    mode, captcha: real ? 'turnstile' : 'sandbox-test', siteKey: real ? siteKey : null, secret,
    formSecret: createHmac('sha256', session).update('public-form-v1').digest('hex'),
  };
}

export const publicConfig = (): PublicConfig => publicConfigFrom(process.env);

export function publicDeps(): PublicDeps {
  const cfg = publicConfig();
  const { pool, siteOrigin } = getServer();
  return {
    pool, siteOrigin, mode: cfg.mode, secret: cfg.formSecret,
    turnstile: createTurnstileVerifier({ secret: cfg.secret || 'sandbox', sandboxTest: cfg.captcha === 'sandbox-test', expectedHostname: new URL(siteOrigin).hostname }),
  };
}
