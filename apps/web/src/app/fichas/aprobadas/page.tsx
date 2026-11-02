import { listApproved } from '@turnosala/db/web';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '../../../lib/actor.js';
import { getServer } from '../../../lib/server.js';
import { Nav } from '../../nav.js';

export const dynamic = 'force-dynamic';

const TIER: Record<string, string> = { hot: 'Caliente', warm: 'Templada', nurture: 'A nutrir' };
const CONTACT: Record<string, string> = {
  generic_email: 'Email', switchboard_phone: 'Teléfono', mobile_phone: 'Móvil', postal_address: 'Dirección', web_form: 'Formulario', booking_url: 'Reservas',
};
const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
const cell = { padding: '6px 8px', borderTop: '1px solid #e5e7eb', verticalAlign: 'top' } as const;

// Fichas aprobadas en la revisión (REQ-REV-03): solo consulta. Usar sus canales sigue pasando por la puerta de cumplimiento (P1).
export default async function ApprovedPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const items = await listApproved(getServer().pool, { limit: 500 });
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Fichas aprobadas</h1>
        <Nav />
      </header>
      <p data-testid="aprobadas" style={{ margin: 0 }}>
        {items.length} ficha{items.length === 1 ? '' : 's'} aprobada{items.length === 1 ? '' : 's'}. Están listas para planificar acciones; nada se envía desde aquí y
        cualquier contacto pasa por la puerta de cumplimiento. <a href="/api/fichas/export">Exportar CSV</a>
      </p>
      {items.length === 0 ? <p>Todavía no hay fichas aprobadas. Apruébalas en la <Link href="/fichas">cola de revisión</Link>.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', background: '#fff' }}>
            <thead><tr style={{ textAlign: 'left' }}>
              <th style={cell}>Empresa</th><th style={cell}>Segmento</th><th style={cell}>Municipio</th><th style={cell}>Puntos</th><th style={cell}>Contactos</th><th style={cell}>Aprobada</th>
            </tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} data-testid="fila-aprobada">
                  <td style={cell}><Link href={`/fichas/${p.id}`}>{p.name}</Link>{p.website ? <><br /><a href={p.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>{p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></> : null}</td>
                  <td style={cell}>{p.segment ?? '—'}</td>
                  <td style={cell}>{p.municipality ?? '—'}</td>
                  <td style={cell}>{p.score ?? '—'}{p.tier ? <><br /><span style={{ fontSize: 13, color: '#555' }}>{TIER[p.tier] ?? p.tier}</span></> : null}</td>
                  <td style={cell}>{p.contacts.length === 0 ? '—' : p.contacts.map((c) => <div key={`${c.type}${c.value}`} style={{ fontSize: 13 }}>{CONTACT[c.type] ?? c.type}: {c.value}</div>)}</td>
                  <td style={cell}><span style={{ fontSize: 13 }}>{p.reviewedAt ? fmt.format(p.reviewedAt) : '—'}{p.reviewedBy ? <><br />{p.reviewedBy}</> : null}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
