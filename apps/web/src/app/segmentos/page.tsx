import { redirect } from 'next/navigation';
import { currentActor } from '../../lib/actor.js';
import { getServer } from '../../lib/server.js';
import { Nav } from '../nav.js';
import { SegmentActions } from './segment-actions.js';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  name: string;
  status: string;
  definition: { vertical?: string; description?: string; message?: string; bestDemo?: string; decisionMakerRole?: string; fit?: { score: number; reasoning: string }; sourceUrls?: string[]; signals?: string[] };
}

const STATUS: Record<string, string> = { draft: 'Borrador', approved: 'Aprobado', retired: 'Retirado' };
const box = { background: '#fff', border: '1px solid #dde1e6', borderRadius: 8, padding: 16, display: 'grid', gap: 6 } as const;

function SegmentCard({ s, canManage }: { s: Row; canManage: boolean }) {
  const d = s.definition;
  return (
    <article style={box} data-testid="segmento">
      <h2 style={{ margin: 0, fontSize: 17 }}>{s.name} <small data-testid="estado-segmento">· {STATUS[s.status] ?? s.status}</small></h2>
      <p style={{ margin: 0 }}>{d.vertical} — {d.description}</p>
      <p style={{ margin: 0 }}>Decisor: {d.decisionMakerRole ?? '—'} · Mensaje: {d.message ?? '—'} · Demo: {d.bestDemo ?? '—'}</p>
      <p style={{ margin: 0 }}><mark>Inferido por el modelo</mark> Encaje {d.fit?.score ?? '—'}/100: {d.fit?.reasoning ?? '—'}</p>
      <p style={{ margin: 0 }}>Señales: {d.signals?.join(', ') || '—'}</p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{(d.sourceUrls ?? []).filter((u) => /^https?:\/\//i.test(u)).map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u}</a></li>)}</ul>
      <SegmentActions id={s.id} status={s.status} canManage={canManage} />
    </article>
  );
}

export default async function SegmentsPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const rows = (await getServer().pool.query(`select id, name, status, definition from segments order by status, name`)).rows as Row[];
  const canManage = actor.role === 'admin' || actor.role === 'marketing';
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Segmentos</h1>
        <Nav />
      </header>
      <p style={{ margin: 0 }}>Los segmentos los propone el modelo y nacen en borrador: solo se usan cuando marketing los aprueba.</p>
      {rows.length === 0 ? <p>Aún no hay segmentos.</p> : rows.map((s) => <SegmentCard key={s.id} s={s} canManage={canManage} />)}
    </main>
  );
}
