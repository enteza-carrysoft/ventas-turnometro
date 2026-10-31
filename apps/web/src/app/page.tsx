import { redirect } from 'next/navigation';
import { currentActor } from '../lib/actor.js';
import { getServer } from '../lib/server.js';
import { KillSwitchControl } from './kill-switch-control.js';

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
  const mode = get('app_mode') === 'production' ? 'production' : 'sandbox';
  const kill = get('kill_switch') === true;
  const channelsOff = rows.filter((r) => r.key !== 'kill_switch' && r.value === true).map((r) => r.key.replace('kill_switch_', ''));

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>TurnoSala Prospector</h1>
        <span data-testid="usuario">{actor.name} · {actor.role ? ROLE_LABEL[actor.role] : 'sin rol'}</span>
      </header>

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

      <p style={{ color: '#555' }}>Panel mínimo de la fase F0. Fichas, revisión, campañas y CRM llegan en las fases siguientes.</p>
    </main>
  );
}
