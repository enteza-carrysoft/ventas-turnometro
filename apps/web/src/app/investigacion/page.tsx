import { enrichBacklog, getWorkerHeartbeat, listResearchJobs, listTerritories, type Heartbeat, type JobSummary } from '@turnosala/db/web';
import { redirect } from 'next/navigation';
import { currentActor } from '../../lib/actor.js';
import { getServer } from '../../lib/server.js';
import { Nav } from '../nav.js';
import { AutoRefresh, JobControls } from './job-controls.js';
import { LaunchForm, type LaunchOptions } from './launch-form.js';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { queued: 'En cola', running: 'En marcha', paused: 'En pausa', done: 'Terminado', cancelled: 'Cancelado', failed: 'Fallido' };
const STOP: Record<string, string> = { batch_limit: 'se alcanzó el lote', budget: 'se agotó el presupuesto' };
const SOURCE_LABEL: Record<string, string> = { osm: 'OpenStreetMap', web_search: 'Búsqueda web', corporate_web: 'Web corporativa', regcess: 'REGCESS' };
const box = { background: '#fff', border: '1px solid #dde1e6', borderRadius: 8, padding: 16, display: 'grid', gap: 8 } as const;

function WorkerStatus({ hb, now }: { hb: Heartbeat | null; now: number }) {
  const age = hb ? Math.round((now - hb.at.getTime()) / 1000) : null;
  const alive = age !== null && age <= 90;
  return (
    <p data-testid="worker" style={{ margin: 0, padding: 12, borderRadius: 6, background: alive ? '#e3f6e8' : '#fde2e2' }}>
      {alive ? <>Worker en marcha (último aviso hace {age} s). </> : <>Sin señal del worker: las investigaciones no avanzan hasta que lo arranques (<code>npm run worker</code>). </>}
      {alive && !hb?.llmEnabled ? 'El enriquecimiento y el análisis con IA están desactivados en el worker (ENRICH_ENABLED).' : null}
    </p>
  );
}

function JobRow({ j, canEdit }: { j: JobSummary; canEdit: boolean }) {
  const total = j.tasks.pending + j.tasks.running + j.tasks.done + j.tasks.failed + j.tasks.skipped;
  return (
    <tr data-testid="trabajo">
      <td>{j.segmentName}</td>
      <td data-testid="estado-trabajo">{STATUS[j.status] ?? j.status}{j.stopReason ? ` (${STOP[j.stopReason] ?? j.stopReason})` : ''}</td>
      <td>{j.tasks.done + j.tasks.failed + j.tasks.skipped}/{total} tareas{j.tasks.failed > 0 ? `, ${j.tasks.failed} con error` : ''}</td>
      <td>{j.candidates}/{j.maxCandidates}</td>
      <td>{j.costEur.toFixed(2)}/{j.budgetEur.toFixed(2)} €</td>
      <td>{j.lastError ? <small>{j.lastError}</small> : '—'}</td>
      <td>{canEdit ? <JobControls id={j.id} status={j.status} /> : null}</td>
    </tr>
  );
}

export default async function ResearchPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const { pool } = getServer();
  const canEdit = actor.role === 'admin' || actor.role === 'marketing';
  const [jobs, backlog, hb, segs, srcs, terr] = await Promise.all([
    listResearchJobs(pool, 20), enrichBacklog(pool), getWorkerHeartbeat(pool),
    pool.query(`select id, name from segments where status = 'approved' order by name`),
    pool.query(`select id from allowed_sources where active order by id`),
    listTerritories(pool),
  ]);
  const options: LaunchOptions = {
    segments: segs.rows as LaunchOptions['segments'],
    sources: (srcs.rows as Array<{ id: string }>).map((s) => ({ id: s.id, label: SOURCE_LABEL[s.id] ?? s.id })),
    territories: terr.map((t) => ({ ineCode: t.ineCode, name: t.name, province: t.province })).slice(0, 1000),
  };
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running' || j.status === 'paused');
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <AutoRefresh active={active || hb === null || Date.now() - hb.at.getTime() > 90_000} />
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Investigación</h1>
        <Nav />
      </header>
      <WorkerStatus hb={hb} now={Date.now()} />
      <p data-testid="cola-enriquecimiento" style={{ margin: 0 }}>Candidatas por enriquecer: {backlog.waiting} · con intentos agotados: {backlog.failed} · sin web: {backlog.noWebsite}</p>
      <section style={box} aria-label="Nueva investigación">
        <h2 style={{ margin: 0, fontSize: 16 }}>Nueva investigación</h2>
        {!canEdit ? <p style={{ margin: 0 }}>Solo marketing y administración pueden lanzar investigaciones.</p>
          : options.segments.length === 0 ? <p style={{ margin: 0 }}>Aún no hay segmentos aprobados. Aprueba uno en <a href="/segmentos">Segmentos</a>.</p>
          : options.sources.length === 0 ? <p style={{ margin: 0 }}>No hay fuentes activas en <code>allowed_sources</code>.</p>
          : options.territories.length === 0 ? <p style={{ margin: 0 }}>No hay municipios cargados (<code>npm run territories:import</code>).</p>
          : <LaunchForm options={options} />}
      </section>
      <section style={box} aria-label="Trabajos">
        <h2 style={{ margin: 0, fontSize: 16 }}>Trabajos recientes</h2>
        {jobs.length === 0 ? <p style={{ margin: 0 }}>Aún no se ha lanzado ninguno.</p> : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left' }}><th>Segmento</th><th>Estado</th><th>Tareas</th><th>Candidatas</th><th>Coste</th><th>Último error</th><th /></tr></thead>
            <tbody>{jobs.map((j) => <JobRow key={j.id} j={j} canEdit={canEdit} />)}</tbody>
          </table>
        )}
      </section>
    </main>
  );
}
