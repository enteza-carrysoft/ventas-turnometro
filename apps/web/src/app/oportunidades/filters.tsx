import type { DealFilters } from '@turnosala/db/web';

export interface FilterOptions {
  sales: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string }>;
  segments: Array<{ id: string; name: string }>;
  provinces: string[];
  campaigns: Array<{ id: string; name: string }>;
}

const field = { display: 'grid', gap: 2, minWidth: 150 } as const;

/** Filtros por GET: la URL es la fuente de verdad (se pueden compartir y volver atrás). */
export function Filters({ f, opts, view }: { f: DealFilters; opts: FilterOptions; view: 'lista' | 'tablero' }) {
  return (
    <form method="get" aria-label="Filtros" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <input type="hidden" name="vista" value={view} />
      <label style={field}>Buscar<input name="q" defaultValue={f.search ?? ''} maxLength={100} /></label>
      <label style={field}>Comercial
        <select name="owner" defaultValue={f.owner ?? ''}>
          <option value="">Todos</option><option value="me">Mis oportunidades</option><option value="unassigned">Sin asignar</option>
          {opts.sales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label style={field}>Etapa
        <select name="stage" defaultValue={f.stage ?? ''}><option value="">Todas</option>{opts.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>
      <label style={field}>Segmento
        <select name="segmento" defaultValue={f.segmentId ?? ''}><option value="">Todos</option>{opts.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>
      <label style={field}>Provincia
        <select name="provincia" defaultValue={f.province ?? ''}><option value="">Todas</option>{opts.provinces.map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </label>
      <label style={field}>Campaña
        <select name="campana" defaultValue={f.campaignId ?? ''}><option value="">Todas</option>{opts.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      <label style={field}>Tarea hasta<input type="date" name="tareaHasta" /></label>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" name="sinTarea" value="1" defaultChecked={f.noTask === true} /> Sin tarea</label>
      <label style={field}>Estado
        <select name="estado" defaultValue={f.status ?? 'open'}><option value="open">Abiertas</option><option value="closed">Cerradas</option><option value="all">Todas</option></select>
      </label>
      <button type="submit">Filtrar</button>
      <a href={`?vista=${view}`}>Quitar filtros</a>
    </form>
  );
}
