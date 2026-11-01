import Link from 'next/link';

const linkStyle = { color: '#0b57d0', textDecoration: 'none' } as const;

/** Navegación mínima del panel. */
export function Nav() {
  return (
    <nav aria-label="Principal" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <Link href="/" style={linkStyle}>Panel</Link>
      <Link href="/investigacion" style={linkStyle}>Investigación</Link>
      <Link href="/fichas" style={linkStyle}>Cola de revisión</Link>
      <Link href="/oportunidades" style={linkStyle}>Oportunidades</Link>
      <Link href="/segmentos" style={linkStyle}>Segmentos</Link>
      <Link href="/ajustes/consentimientos" style={linkStyle}>Textos legales</Link>
      <a href="/api/fichas/export" style={linkStyle}>Exportar fichas aprobadas (CSV)</a>
    </nav>
  );
}
