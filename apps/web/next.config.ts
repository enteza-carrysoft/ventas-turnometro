import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Los paquetes del monorepo se publican como TypeScript: Next los compila.
  transpilePackages: ['@turnosala/core', '@turnosala/db'],
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  poweredByHeader: false,
  // Todo el monorepo importa con extensión «.js» (convención NodeNext). Turbopack aún no la resuelve hacia «.ts»,
  // así que se compila con webpack (`next build --webpack`) y este alias.
  webpack: (cfg: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    cfg.resolve.extensionAlias = { ...cfg.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'] };
    return cfg;
  },
};

export default config;
