import { dealTotals, listDeals } from '@turnosala/db/web';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '../../lib/actor.js';
import { eur, filtersFromParams, toCard } from '../../lib/deal-view.js';
import { getServer } from '../../lib/server.js';
import { Nav } from '../nav.js';
import { Board, type BoardColumn } from './board.js';
import { DealList } from './deal-list.js';
import { Filters, type FilterOptions } from './filters.js';

export const dynamic = 'force-dynamic';

type Q = Record<string, string | string[] | undefined>;
const OPEN_STAGES = ['new', 'interested', 'demo_booked', 'demo_held', 'trial'];

async function options(pool: ReturnType<typeof getServer>['pool']): Promise<FilterOptions & { reasons: Array<{ id: string; name: string }> }> {
  const rows = async <T,>(sql: string): Promise<T[]> => (await pool.query(sql)).rows as T[];
  const [sales, stages, segments, provinces, campaigns, reasons] = await Promise.all([
    rows<{ id: string; name: string }>(`select u.id, u.name from app_user_roles r join "user" u on u.id = r.user_id where r.role = 'sales' order by u.name`),
    rows<{ id: string; name: string }>('select id, name from deal_stages order by sort'),
    rows<{ id: string; name: string }>(`select id, name from segments where status = 'approved' order by name`),
    rows<{ province: string }>('select distinct province from territories order by province'),
    rows<{ id: string; name: string }>('select id, name from campaigns order by name'),
    rows<{ id: string; name: string }>('select id, name from lost_reasons order by (id = \'opposition\') desc, name'),
  ]);
  return { sales, stages, segments, provinces: provinces.map((p) => p.province), campaigns, reasons };
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<Q> }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const q = await searchParams;
  const view = q.vista === 'tablero' ? 'tablero' : 'lista';
  const filters = filtersFromParams(q);
  const { pool } = getServer();
  const viewer = { userId: actor.userId };
  const [rows, totals, opts] = await Promise.all([listDeals(pool, viewer, filters), dealTotals(pool, viewer, filters), options(pool)]);
  if (!rows || !totals) redirect('/'); // voz y usuarios sin rol no ven el pipeline
  const now = new Date();
  const cards = rows.map((r) => toCard(r, now));
  const showClosed = filters.status === 'closed' || filters.status === 'all';
  const columns: BoardColumn[] = totals.filter((t) => OPEN_STAGES.includes(t.stageId) || showClosed).map((t) => ({ id: t.stageId, name: t.stageName, count: t.count, value: eur(t.valueEur), weighted: eur(t.weightedEur) }));
  const common = { openStages: opts.stages.filter((s) => OPEN_STAGES.includes(s.id)), reasons: opts.reasons, viewerId: actor.userId, isAdmin: actor.role === 'admin', isSales: actor.role === 'sales' };
  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Oportunidades</h1>
        <Nav />
      </header>
      <nav aria-label="Vista" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/oportunidades?vista=lista" aria-current={view === 'lista' ? 'page' : undefined}>Lista</Link>
        <Link href="/oportunidades?vista=tablero" aria-current={view === 'tablero' ? 'page' : undefined}>Tablero</Link>
        <Link href={`/oportunidades?vista=${view}&owner=me`}>Mis oportunidades</Link>
      </nav>
      <Filters f={filters} opts={opts} view={view} />
      <ul aria-label="Totales por etapa" data-testid="totales" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0 }}>
        {totals.filter((t) => OPEN_STAGES.includes(t.stageId) || showClosed).map((t) => (
          <li key={t.stageId} style={{ background: '#fff', border: '1px solid #dde1e6', borderRadius: 6, padding: '4px 10px' }}>{t.stageName}: <strong>{t.count}</strong> · {eur(t.valueEur)} · ponderado {eur(t.weightedEur)}</li>
        ))}
      </ul>
      {view === 'tablero' ? <Board columns={columns} cards={cards} {...common} /> : <DealList cards={cards} {...common} />}
    </main>
  );
}
