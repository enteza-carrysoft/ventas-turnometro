import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync('deploy/docker-compose.yml', 'utf8');
const envExample = readFileSync('deploy/.env.example', 'utf8');

describe('F0.2 despliegue', () => {
  it('define los servicios de design.md §10', () => {
    for (const s of ['postgres', 'web', 'worker', 'voice', 'caddy']) {
      expect(compose, `falta el servicio ${s}`).toMatch(new RegExp(`^  ${s}:`, 'm'));
    }
  });

  it('usa la imagen de BD con pgvector y el puerto local 5433', () => {
    expect(compose).toContain('pgvector/pgvector:pg16');
    expect(compose).toContain('127.0.0.1:5433:5432');
  });

  it('caddy no arranca por defecto (en el CPD entra el proxy existente, D-01)', () => {
    expect(compose).toMatch(/caddy:[\s\S]*?profiles: \["vps"\]/);
  });

  it('.env.example solo trae nombres, sin valores secretos (P5.1)', () => {
    const lines = envExample.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) expect(l, l).toMatch(/^[A-Z][A-Z0-9_]*=(sandbox|production)?$/);
  });

  it('APP_MODE por defecto es sandbox en el compose', () => {
    expect(compose).toContain('APP_MODE: ${APP_MODE:-sandbox}');
  });
});
