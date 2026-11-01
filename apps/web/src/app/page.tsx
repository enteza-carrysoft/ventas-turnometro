import { dealTotals } from '@turnosala/db/web';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '../lib/actor.js';
import { eur } from '../lib/deal-view.js';
import { getServer } from '../lib/server.js';
import { KillSwitchControl } from './kill-switch-control.js';
import { Nav } from './nav.js';

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador', marketing: 'Marketing', sales: 'Comercial', auditor: 'Auditor', voice: 'Voz (técnico)',
};

export default async function PanelPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const { pool } = getServer();
  const rows = (await pool.query(`select key, value from settings where key = 'app_mode' or key like 'kill_switch%'`)).rows as Array<{
    key: string;
    value: unknown;
  }>;
  const get = (k: string): unknown => rows.find((r) => r.key === k)?.value;
  const [all, mine] = await Promise.all([dealTotals(pool, { userId: actor.userId }, {}), dealTotals(pool, { userId: actor.userId }, { owner: 'me' })]);
  const sum = (t: typeof all): { n: number; v: number; w: number } => ({ n: (t ?? []).reduce((a, x) => a + x.count, 0), v: (t ?? []).reduce((a, x) => a + x.valueEur, 0), w: (t ?? []).reduce((a, x) => a + x.weightedEur, 0) });
  const mode = get('app_mode') === 'production' ? 'production' : 'sandbox';
  const kill = get('kill_switch') === true;
  const channelsOff = rows.filter((r) => r.key !== 'kill_switch' && r.value === true).map((r) => r.key.replace('kill_switch_', ''));

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>TurnoSala Prospector</h1>
        <span data-testid="usuario">{actor.name} · {actor.role ? ROLE_LABEL[actor.role] : 'sin rol'}</span>
      </header>

      <Nav />

      <section aria-label="Estado del sistema" style={{ display: 'grid', gap: 8 }}>
        <p data-testid="modo" style={{ margin: 0, padding: 12, borderRadius: 6, background: mode === 'production' ? '#fde2e2' : '#fff4cc' }}>
          Modo: <strong>{mode === 'production' ? 'PRODUCCIÓN' : 'SANDBOX (solo contactos de prueba)'}</strong>
        </p>
        <p data-testid="kill-switch" style={{ margin: 0, padding: 12, borderRadius: 6, background: kill ? '#fde2e2' : '#e3f6e8' }}>
          Kill switch: <strong>{kill ? 'ACTIVADO — no se contacta a nadie' : 'desactivado'}</strong>
          {channelsOff.length ? <span> · canales parados: {channelsOff.join(', ')}</span> : null}
        </p>
        <KillSwitchControl enabled={kill} canEdit={actor.role === 'admin'} />
      </section>

      {all ? (
        <section aria-label="Oportunidades" data-testid="contadores-oportunidades" style={{ display: 'grid', gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}><Link href="/oportunidades">Oportunidades abiertas</Link></h2>
          <p style={{ margin: 0 }}>Todas: <strong data-testid="abiertas-todas">{sum(all).n}</strong> · {eur(sum(all).v)} · ponderado {eur(sum(all).w)}</p>
          <p style={{ margin: 0 }}><Link href="/oportunidades?owner=me">Mías</Link>: <strong data-testid="abiertas-mias">{sum(mine).n}</strong> · {eur(sum(mine).v)}</p>
        </section>
      ) : null}

      <p style={{ color: '#555' }}>Fichas, revisión y oportunidades disponibles; campañas y agenda llegan en las fases siguientes.</p>
    </main>
  );
}
