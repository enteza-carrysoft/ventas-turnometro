import { describe, expect, it } from 'vitest';
import { publicConfigFrom } from './public-config.js';

const base = { BETTER_AUTH_SECRET: 'un-secreto-largo-de-pruebas-0123456789abcdef' };

describe('publicConfigFrom', () => {
  it('por defecto es sandbox, y sin clave de Turnstile usa el captcha de pruebas (sin widget ni red)', () => {
    expect(publicConfigFrom(base)).toMatchObject({ mode: 'sandbox', captcha: 'sandbox-test', siteKey: null });
  });

  it('con clave de sitio y secreto reales usa el widget de Turnstile', () => {
    expect(publicConfigFrom({ ...base, TURNSTILE_SITE_KEY: 'sitio', TURNSTILE_SECRET_KEY: 'secreto' })).toMatchObject({ captcha: 'turnstile', siteKey: 'sitio', secret: 'secreto' });
  });

  it('en PRODUCCIÓN el captcha de pruebas no existe: falta de claves ⇒ error', () => {
    expect(() => publicConfigFrom({ ...base, APP_MODE: 'production' })).toThrow(/TURNSTILE/);
    expect(() => publicConfigFrom({ ...base, APP_MODE: 'production', TURNSTILE_SITE_KEY: 'sitio' })).toThrow(/TURNSTILE/);
    expect(publicConfigFrom({ ...base, APP_MODE: 'production', TURNSTILE_SITE_KEY: 'sitio', TURNSTILE_SECRET_KEY: 'secreto' }).mode).toBe('production');
  });

  it('solo «production» exacto activa producción; cualquier otro valor es sandbox', () => {
    for (const v of ['Production', 'prod', '', 'sandbox', undefined]) expect(publicConfigFrom({ ...base, APP_MODE: v }).mode, String(v)).toBe('sandbox');
  });

  it('una clave a medias (solo sitio o solo secreto) en sandbox no activa el widget a medias', () => {
    expect(publicConfigFrom({ ...base, TURNSTILE_SITE_KEY: 'sitio' }).captcha).toBe('sandbox-test');
    expect(publicConfigFrom({ ...base, TURNSTILE_SECRET_KEY: 'secreto' }).captcha).toBe('sandbox-test');
  });

  it('exige el secreto del servidor con el que se firman las marcas y se hace el HMAC de las IP', () => {
    expect(() => publicConfigFrom({})).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => publicConfigFrom({ BETTER_AUTH_SECRET: 'corto' })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('el secreto del formulario se deriva del de sesión pero NO es igual a él', () => {
    const c = publicConfigFrom(base);
    expect(c.formSecret).not.toBe(base.BETTER_AUTH_SECRET);
    expect(c.formSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(publicConfigFrom(base).formSecret).toBe(c.formSecret);
  });
});
