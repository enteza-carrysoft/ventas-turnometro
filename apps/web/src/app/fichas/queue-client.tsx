'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Item {
  id: string;
  name: string;
  score: number | null;
  tier: string | null;
  legalForm: string;
  municipality: string | null;
  inferredCount: number;
  href: string;
}
interface BulkOutcome {
  approved: string[];
  sample: string[];
}

const TIER: Record<string, string> = { hot: 'Caliente', warm: 'Templada', nurture: 'A nutrir' };

function Row({ item, checked, onToggle, disabled }: { item: Item; checked: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <tr data-testid="fila-ficha">
      <td><input type="checkbox" aria-label={`Seleccionar ${item.name}`} checked={checked} onChange={onToggle} disabled={disabled} /></td>
      <td><Link href={item.href}>{item.name}</Link></td>
      <td>{item.municipality ?? '—'}</td>
      <td>{item.score ?? '—'}</td>
      <td>{item.tier ? TIER[item.tier] ?? item.tier : '—'}</td>
      <td>{item.inferredCount > 0 ? <mark>{item.inferredCount} inferido{item.inferredCount === 1 ? '' : 's'}</mark> : '—'}</td>
    </tr>
  );
}

export function QueueClient({ items, canReview }: { items: Item[]; canReview: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function approveSelected() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/fichas/bulk-approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [...selected] }) });
    setBusy(false);
    if (!res.ok) { setError('No se pudo aprobar en bloque.'); return; }
    setOutcome((await res.json()) as BulkOutcome);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <section style={{ display: 'grid', gap: 12 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr style={{ textAlign: 'left' }}><th /><th>Empresa</th><th>Municipio</th><th>Puntos</th><th>Nivel</th><th>Revisar</th></tr></thead>
        <tbody>{items.map((i) => <Row key={i.id} item={i} checked={selected.has(i.id)} onToggle={() => toggle(i.id)} disabled={!canReview} />)}</tbody>
      </table>
      {canReview ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={approveSelected} disabled={busy || selected.size === 0}>Aprobar seleccionadas ({selected.size})</button>
          <span style={{ color: '#555' }}>El sistema reserva al azar al menos el 10 % para que las revises una a una.</span>
        </div>
      ) : <p>Solo marketing y administración pueden aprobar o descartar fichas.</p>}
      {error ? <p role="alert" style={{ color: '#b00020', margin: 0 }}>{error}</p> : null}
      {outcome ? (
        <p data-testid="resultado-bloque" role="status" style={{ margin: 0, padding: 12, borderRadius: 6, background: '#e3f6e8' }}>
          {outcome.approved.length} aprobada{outcome.approved.length === 1 ? '' : 's'}. {outcome.sample.length} reservada{outcome.sample.length === 1 ? '' : 's'} como muestra de calidad: revísala{outcome.sample.length === 1 ? '' : 's'} una a una.
        </p>
      ) : null}
    </section>
  );
}
