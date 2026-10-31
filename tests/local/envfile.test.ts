import { describe, expect, it } from 'vitest';
import { ensureKeys, getKey, parseEnv, randomSecret, setKey, type KeySpec } from '../../scripts/lib/envfile.js';

const SPEC: KeySpec[] = [
  { key: 'POSTGRES_PASSWORD', generate: () => 'gen-pg' },
  { key: 'APP_PASSWORD', generate: () => 'gen-app' },
  { key: 'OPENROUTER_API_KEY', value: '', comment: 'La creas tú; nunca la pegues en el chat' },
  { key: 'ENRICH_ENABLED', value: '0' },
];

describe('parseEnv', () => {
  it('lee clave=valor, ignora comentarios y líneas vacías, soporta CRLF, comillas y espacios alrededor', () => {
    const m = parseEnv('# nota\r\nA=1\r\n\r\nB = "dos palabras" \r\nC=\'x\'\r\nD=\r\nE=con=igual\r\n');
    expect(Object.fromEntries(m)).toEqual({ A: '1', B: 'dos palabras', C: 'x', D: '', E: 'con=igual' });
  });
  it('un BOM al principio no rompe la primera clave', () => {
    expect(parseEnv('﻿A=1\n').get('A')).toBe('1');
  });
});

describe('ensureKeys: crea o completa el archivo sin pisar nada', () => {
  it('archivo nuevo: genera las claves secretas, deja vacía la clave de API y pone los valores fijos', () => {
    const { text, created } = ensureKeys('', SPEC);
    expect(created).toEqual(['POSTGRES_PASSWORD', 'APP_PASSWORD', 'OPENROUTER_API_KEY', 'ENRICH_ENABLED']);
    expect(getKey(text, 'POSTGRES_PASSWORD')).toBe('gen-pg');
    expect(getKey(text, 'OPENROUTER_API_KEY')).toBe('');
    expect(getKey(text, 'ENRICH_ENABLED')).toBe('0');
    expect(text).toContain('# La creas tú; nunca la pegues en el chat');
  });

  it('NO sobrescribe valores existentes (ni la clave de API que puso la persona ni los secretos ya generados)', () => {
    const before = 'POSTGRES_PASSWORD=mia\nOPENROUTER_API_KEY=sk-or-xxx\nENRICH_ENABLED=1\n';
    const { text, created } = ensureKeys(before, SPEC);
    expect(created).toEqual(['APP_PASSWORD']);
    expect(getKey(text, 'POSTGRES_PASSWORD')).toBe('mia');
    expect(getKey(text, 'OPENROUTER_API_KEY')).toBe('sk-or-xxx');
    expect(getKey(text, 'ENRICH_ENABLED')).toBe('1');
  });

  it('un secreto generado que quedó vacío se vuelve a generar, pero una clave "value" vacía sigue vacía', () => {
    const { text, created } = ensureKeys('APP_PASSWORD=\nOPENROUTER_API_KEY=\n', SPEC);
    expect(getKey(text, 'APP_PASSWORD')).toBe('gen-app');
    expect(created).not.toContain('OPENROUTER_API_KEY');
    expect(getKey(text, 'OPENROUTER_API_KEY')).toBe('');
  });

  it('es idempotente: ejecutarlo dos veces no cambia el texto', () => {
    const once = ensureKeys('', SPEC).text;
    const twice = ensureKeys(once, SPEC);
    expect(twice.text).toBe(once);
    expect(twice.created).toEqual([]);
  });

  it('conserva comentarios y claves desconocidas del usuario', () => {
    const { text } = ensureKeys('# mis notas\nOTRA=1\n', SPEC);
    expect(text.startsWith('# mis notas\nOTRA=1\n')).toBe(true);
  });
});

describe('setKey / getKey', () => {
  it('reemplaza el valor de una clave existente sin tocar las demás líneas, o la añade al final', () => {
    expect(setKey('A=1\n# c\nB=2\n', 'A', '9')).toBe('A=9\n# c\nB=2\n');
    expect(setKey('A=1\n', 'Z', '3')).toBe('A=1\nZ=3\n');
    expect(setKey('A=1', 'Z', '3')).toBe('A=1\nZ=3\n');
  });
  it('rechaza valores que romperían el archivo (saltos de línea) y claves inválidas', () => {
    expect(() => setKey('', 'A', 'x\nB=1')).toThrow();
    expect(() => setKey('', 'a b', 'x')).toThrow();
  });
  it('getKey devuelve undefined si no existe', () => {
    expect(getKey('A=1\n', 'B')).toBeUndefined();
  });
});

describe('randomSecret', () => {
  it('es hexadecimal, de al menos 48 caracteres y distinto cada vez', () => {
    const a = randomSecret();
    expect(a).toMatch(/^[0-9a-f]{48,}$/);
    expect(randomSecret()).not.toBe(a);
  });
});
