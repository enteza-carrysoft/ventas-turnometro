// Escáner de T-ARQ (spec/compliance.md): los SDK de contacto solo pueden importarse en packages/connectors, y la
// salida de los conectores (`@turnosala/connectors/outbound`) solo puede usarse desde packages/contact.

export interface SourceFile {
  path: string; // relativo a la raíz, con «/»
  content: string;
}
export interface Violation {
  path: string;
  module: string;
  kind: 'import' | 'dependency' | 'outbound' | 'llm_import' | 'llm_dependency' | 'llm_url';
}

/** Twilio, Resend, SMTP (nodemailer, net, tls) y SDK de proveedores de cartas (D-07 aún abierta). */
export const FORBIDDEN_MODULES: readonly string[] = [
  'twilio', 'resend', 'nodemailer', 'net', 'tls', '@sendgrid/mail', 'lob', '@lob/lob-typescript-sdk', 'postgrid-node-client',
];
/** T-ARQ-LLM (REQ-LLM-01, ADR-005): SDK de proveedores de LLM, solo dentro de packages/ai. */
export const FORBIDDEN_LLM_MODULES: readonly string[] = [
  '@anthropic-ai/sdk', '@anthropic-ai/bedrock-sdk', '@anthropic-ai/vertex-sdk', '@anthropic-ai/foundry-sdk',
  'openai', '@openrouter/sdk', '@openrouter/ai-sdk-provider', '@ai-sdk/anthropic', '@ai-sdk/openai',
];
/** Dominios de proveedores de LLM: ningún archivo fuera de packages/ai puede contener sus URL (`eu.openrouter.ai` incluido). */
export const LLM_HOSTS: readonly string[] = ['api.anthropic.com', 'openrouter.ai'];
const LLM_DIR = 'packages/ai/';

const BUILTINS = new Set(['net', 'tls']); // módulos de Node: no se declaran como dependencia

const SDK_DIR = 'packages/connectors/';
const OUTBOUND_OK_DIRS = ['packages/contact/', 'packages/connectors/'];
const OUTBOUND = /^@turnosala\/connectors\/outbound(\/|$)/;

const normalize = (spec: string): string => spec.replace(/^node:/, '');
const matches = (spec: string, name: string): boolean => normalize(spec) === name || normalize(spec).startsWith(`${name}/`);
const isForbidden = (spec: string): boolean => FORBIDDEN_MODULES.some((m) => matches(spec, m));
const isLlmModule = (spec: string): boolean => FORBIDDEN_LLM_MODULES.some((m) => matches(spec, m));

/** Dominios de LLM que aparecen en el código (comentarios excluidos; subdominios como `eu.openrouter.ai` incluidos). */
function llmHostsIn(code: string): string[] {
  const clean = stripComments(code).toLowerCase();
  return LLM_HOSTS.filter((h) => {
    for (let i = clean.indexOf(h); i !== -1; i = clean.indexOf(h, i + 1)) {
      const before = clean[i - 1];
      if (before === undefined || !/[a-z0-9-]/.test(before) || before === '.') return true; // no es parte de otro nombre, p. ej. «notopenrouter.ai»
    }
    return false;
  });
}

/** Quita comentarios respetando las cadenas, para que `// import x from 'twilio'` no cuente. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i] as string;
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

const PATTERNS: readonly RegExp[] = [
  /(?:^|[;{}\n])\s*import\s+(?:type\s+)?(?:[\w*${},\s]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|[;{}\n])\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function importedModules(code: string): string[] {
  const clean = stripComments(code);
  const found = new Set<string>();
  for (const re of PATTERNS) for (const m of clean.matchAll(re)) if (m[1]) found.add(m[1]);
  return [...found];
}

function packageJsonDeps(content: string): string[] {
  try {
    const j = JSON.parse(content) as Record<string, unknown>;
    const names: string[] = [];
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const block = j[key];
      if (block && typeof block === 'object') names.push(...Object.keys(block));
    }
    return names;
  } catch {
    return [];
  }
}

export function findViolations(files: readonly SourceFile[]): Violation[] {
  const out: Violation[] = [];
  for (const f of files) {
    const inConnectors = f.path.startsWith(SDK_DIR);
    const inLlm = f.path.startsWith(LLM_DIR);
    if (f.path.endsWith('package.json')) {
      if (!inLlm) {
        for (const dep of packageJsonDeps(f.content)) if (isLlmModule(dep)) out.push({ path: f.path, module: dep, kind: 'llm_dependency' });
      }
      if (inConnectors) continue;
      for (const dep of packageJsonDeps(f.content)) {
        if (!BUILTINS.has(dep) && isForbidden(dep)) out.push({ path: f.path, module: dep, kind: 'dependency' });
      }
      continue;
    }
    if (!/\.(m?[jt]sx?)$/.test(f.path)) continue;
    if (!inLlm) for (const host of llmHostsIn(f.content)) out.push({ path: f.path, module: host, kind: 'llm_url' });
    for (const spec of importedModules(f.content)) {
      if (!inLlm && isLlmModule(spec)) out.push({ path: f.path, module: spec, kind: 'llm_import' });
      if (!inConnectors && isForbidden(spec)) out.push({ path: f.path, module: spec, kind: 'import' });
      if (OUTBOUND.test(spec) && !OUTBOUND_OK_DIRS.some((d) => f.path.startsWith(d))) {
        out.push({ path: f.path, module: spec.replace(/\/$/, ''), kind: 'outbound' });
      }
    }
  }
  return out;
}
