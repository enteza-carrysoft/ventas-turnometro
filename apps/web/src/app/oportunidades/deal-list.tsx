'use client';

import type { DealCard } from '../../lib/deal-view.js';
import { DealControls, type ReasonOption, type StageOption } from './deal-controls.js';

interface Props {
  cards: DealCard[];
  openStages: StageOption[];
  reasons: ReasonOption[];
  viewerId: string;
  isAdmin: boolean;
  isSales: boolean;
}

/** Lista: en pantallas estrechas cada oportunidad es una tarjeta apilada (usable a 400 px). */
export function DealList(p: Props) {
  const canEdit = (c: DealCard): boolean => p.isAdmin || (p.isSales && (c.ownerUserId === null || c.ownerUserId === p.viewerId));
  if (p.cards.length === 0) return <p>No hay oportunidades con estos filtros.</p>;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }} data-testid="lista">
      {p.cards.map((c) => (
        <li key={c.id} data-testid="fila-oportunidad" style={{ background: '#fff', border: '1px solid #dde1e6', borderRadius: 8, padding: 12, display: 'grid', gap: 4 }}>
          <strong>{c.name} <small>· {c.stageName} ({c.probability} %)</small></strong>
          <span>{c.where} · {c.segment} · puntuación {c.score ?? '—'}</span>
          <span>{c.value} · {c.owner}</span>
          <span style={{ color: c.taskOverdue ? '#b00020' : undefined }}>Siguiente tarea: {c.taskTitle ? `${c.taskTitle} — ${c.taskDue}${c.taskOverdue ? ' (vencida)' : ''}` : 'ninguna'}</span>
          <DealControls card={c} openStages={p.openStages} reasons={p.reasons} canEdit={canEdit(c)} isAdmin={p.isAdmin} />
        </li>
      ))}
    </ul>
  );
}
