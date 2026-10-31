// Escáner de T-ARQ (spec/compliance.md): los SDK de contacto solo pueden importarse en packages/connectors, y la
// salida de los conectores (`@turnosala/connectors/outbound`) solo puede usarse desde packages/contact.

export interface SourceFile {
  path: string; // relativo a la raíz, con «/»
  content: string;
}
export interface Violation {
  path: string;
  module: string;
  kind: 'import' | 'dependency' | 'outbound';
}

/** Twilio, Resend, SMTP (nodemailer, net, tls) y SDK de proveedores de cartas (D-07 aún abierta). */
export const FORBIDDEN_MODULES: readonly string[] = [
  'twilio', 'resend', 'nodemailer', 'net', 'tls', '@sendgrid/mail', 'lob', '@lob/lob-typescript-sdk', 'postgrid-node-client',
];
const BUILTINS = new Set(['net', 'tls']); // módulos de Node: no se declaran como dependencia

const SDK_DIR = 'packages/connectors/';
const OUTBOUND_OK_DIRS = ['packages/contact/', 'packages/connectors/'];
const OUTBOUND = /^@turnosala\/connectors\/outbound(\/|$)/;

const normalize = (spec: string): string => spec.replace(/^node:/, '');
const matches = (spec: string, name: string): boolean => normalize(spec) === name || normalize(spec).startsWith(`${name}/`);
const isForbidden = (spec: string): boolean => FORBIDDEN_MODULES.some((m) => matches(spec, m));

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
    if (f.path.endsWith('package.json')) {
      if (inConnectors) continue;
      for (const dep of packageJsonDeps(f.content)) {
        if (!BUILTINS.has(dep) && isForbidden(dep)) out.push({ path: f.path, module: dep, kind: 'dependency' });
      }
      continue;
    }
    if (!/\.(m?[jt]sx?)$/.test(f.path)) continue;
    for (const spec of importedModules(f.content)) {
      if (!inConnectors && isForbidden(spec)) out.push({ path: f.path, module: spec, kind: 'import' });
      if (OUTBOUND.test(spec) && !OUTBOUND_OK_DIRS.some((d) => f.path.startsWith(d))) {
        out.push({ path: f.path, module: spec.replace(/\/$/, ''), kind: 'outbound' });
      }
    }
  }
  return out;
}
