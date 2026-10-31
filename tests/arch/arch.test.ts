import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findViolations, type SourceFile } from './scan.js';

const ROOT = process.cwd();

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', 'coverage', '.git', '.claude'].includes(e.name)) continue;
    const full = join(dir, e.name);
    const rel = relative(ROOT, full).split(sep).join('/');
    if (e.isDirectory()) {
      if (rel === 'tests/fixtures' || rel === 'tests/arch') continue; // contienen violaciones de ejemplo a propósito
      walk(full, out);
    } else if (/\.(m?[jt]sx?)$/.test(e.name) || e.name === 'package.json') {
      out.push({ path: rel, content: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

const fixture = (name: string): string => readFileSync(join(ROOT, 'tests/fixtures/arch', name), 'utf8');

describe('T-ARQ — SDK de contacto solo en packages/connectors; salida solo desde packages/contact (REQ-CMP-01 CA3)', () => {
  it('el repositorio real no tiene violaciones', () => {
    const files = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages')), ...walk(join(ROOT, 'deploy'))];
    expect(files.length).toBeGreaterThan(10); // evita pasar en vacío si el recorrido falla
    expect(findViolations(files)).toEqual([]);
  });

  describe('el escáner DETECTA las violaciones de los fixtures (si no, T-ARQ pasaría en vacío)', () => {
    const cases: Array<[string, string, string]> = [
      ['twilio-import.ts.txt', 'apps/web/src/llamar.ts', 'twilio'],
      ['resend-import.ts.txt', 'packages/crm/src/aviso.ts', 'resend'],
      ['nodemailer-require.js.txt', 'apps/worker/src/mail.js', 'nodemailer'],
      ['smtp-net-dynamic.ts.txt', 'packages/content/src/smtp.ts', 'node:net'],
      ['tls-import.ts.txt', 'apps/voice/src/tls.ts', 'tls'],
      ['letters-sdk-import.ts.txt', 'packages/ai/src/carta.ts', 'lob'],
      ['outbound-from-crm.ts.txt', 'packages/crm/src/enviar.ts', '@turnosala/connectors/outbound'],
      ['package-json-sdk.json.txt', 'apps/web/package.json', 'twilio'],
      // T-ARQ-LLM (REQ-LLM-01): ningún SDK ni URL de un proveedor de LLM fuera de packages/ai
      ['llm-anthropic-sdk-import.ts.txt', 'packages/crm/src/ia.ts', '@anthropic-ai/sdk'],
      ['llm-openai-import.ts.txt', 'apps/worker/src/ia.ts', 'openai'],
      ['llm-openrouter-url.ts.txt', 'packages/content/src/ia.ts', 'openrouter.ai'],
      ['llm-openrouter-eu-url.ts.txt', 'apps/web/src/lib/ia.ts', 'openrouter.ai'],
      ['llm-anthropic-url.ts.txt', 'packages/contact/src/ia.ts', 'api.anthropic.com'],
      ['llm-package-json.json.txt', 'packages/crm/package.json', '@anthropic-ai/sdk'],
    ];
    it.each(cases)('%s colocado en %s → violación de %s', (file, asPath, module) => {
      const v = findViolations([{ path: asPath, content: fixture(file) }]);
      expect(v.length).toBeGreaterThan(0);
      expect(v.map((x) => x.module)).toContain(module);
    });
  });

  describe('lo permitido no se marca', () => {
    it('los SDK dentro de packages/connectors', () => {
      for (const f of ['twilio-import.ts.txt', 'resend-import.ts.txt', 'nodemailer-require.js.txt', 'smtp-net-dynamic.ts.txt', 'letters-sdk-import.ts.txt']) {
        expect(findViolations([{ path: 'packages/connectors/src/x.ts', content: fixture(f) }]), f).toEqual([]);
      }
      expect(findViolations([{ path: 'packages/connectors/package.json', content: fixture('package-json-sdk.json.txt') }])).toEqual([]);
    });
    it('T-ARQ-LLM: los SDK y las URL de LLM dentro de packages/ai', () => {
      for (const f of ['llm-anthropic-sdk-import.ts.txt', 'llm-openai-import.ts.txt', 'llm-openrouter-url.ts.txt', 'llm-openrouter-eu-url.ts.txt', 'llm-anthropic-url.ts.txt']) {
        expect(findViolations([{ path: 'packages/ai/src/providers/x.ts', content: fixture(f) }]), f).toEqual([]);
      }
      expect(findViolations([{ path: 'packages/ai/package.json', content: fixture('llm-package-json.json.txt') }])).toEqual([]);
    });
    it('T-ARQ-LLM: mencionar un proveedor en un comentario no es una violación', () => {
      const content = '// la pasarela habla con https://openrouter.ai y con api.anthropic.com\nexport const x = 1;\n';
      expect(findViolations([{ path: 'apps/web/src/ok.ts', content }])).toEqual([]);
    });
    it('importar la salida desde packages/contact', () => {
      expect(findViolations([{ path: 'packages/contact/src/execute.ts', content: fixture('outbound-from-crm.ts.txt') }])).toEqual([]);
    });
    it('usar «net» o «twilio» como texto o comentario no es un import', () => {
      const content = "// import twilio from 'twilio'\nconst s = \"from 'resend'\";\nexport const x = s;\n";
      expect(findViolations([{ path: 'apps/web/src/ok.ts', content }])).toEqual([]);
    });
    it('importar otros módulos corrientes', () => {
      const content = "import { z } from 'zod';\nimport pg from 'pg';\nimport { x } from '@turnosala/connectors';\n";
      expect(findViolations([{ path: 'apps/voice/src/ok.ts', content }])).toEqual([]);
    });
  });
});
