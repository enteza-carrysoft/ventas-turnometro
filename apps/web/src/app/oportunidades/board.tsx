'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DealCard } from '../../lib/deal-view.js';
import { DealControls, postDeal, type ReasonOption, type StageOption } from './deal-controls.js';

export interface BoardColumn { id: string; name: string; count: number; value: string; weighted: string }
interface Props {
  columns: BoardColumn[];
  cards: DealCard[];
  openStages: StageOption[];
  reasons: ReasonOption[];
  viewerId: string;
  isAdmin: boolean;
  isSales: boolean;
}

/** Tablero por etapas. Arrastrar una tarjeta a otra columna abierta la mueve; la alternativa de teclado y móvil es el selector «Mover» de cada tarjeta. */
export function Board(p: Props) {
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openIds = new Set(p.openStages.map((s) => s.id));

  async function drop(stage: string): Promise<void> {
    const id = dragging;
    setDragging(null);
    const card = p.cards.find((c) => c.id === id);
    if (!id || !card || card.stage === stage || !openIds.has(stage)) return; // ganar y perder tienen su propio botón
    const err = await postDeal(id, 'mover', { stage });
    setError(err);
    if (!err) router.refresh();
  }
  const canEdit = (c: DealCard): boolean => p.isAdmin || (p.isSales && (c.ownerUserId === null || c.ownerUserId === p.viewerId));
  return (
    <div>
      {error ? <p role="alert" style={{ color: '#b00020' }}>{error}</p> : null}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'flex-start' }} data-testid="tablero">
        {p.columns.map((col) => (
          <section
            key={col.id} aria-label={`Etapa ${col.name}`} data-stage={col.id}
            onDragOver={(e) => { if (openIds.has(col.id)) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); void drop(col.id); }}
            style={{ minWidth: 250, flex: '0 0 250px', background: '#eef0f3', borderRadius: 8, padding: 8, display: 'grid', gap: 8 }}
          >
            <h2 style={{ margin: 0, fontSize: 15 }}>{col.name} <small>({col.count})</small></h2>
            <small>{col.value} · ponderado {col.weighted}</small>
            {p.cards.filter((c) => c.stage === col.id).map((c) => (
              <article
                key={c.id} data-testid="tarjeta" draggable={canEdit(c) && !c.closed} onDragStart={() => setDragging(c.id)} onDragEnd={() => setDragging(null)}
                style={{ background: '#fff', border: '1px solid #dde1e6', borderRadius: 6, padding: 8, display: 'grid', gap: 4, cursor: canEdit(c) && !c.closed ? 'grab' : 'default' }}
              >
                <strong>{c.name}</strong>
                <small>{c.where} · {c.segment}</small>
                <small>{c.value} · {c.owner}</small>
                {c.taskTitle ? <small style={{ color: c.taskOverdue ? '#b00020' : undefined }}>{c.taskTitle}: {c.taskDue}{c.taskOverdue ? ' (vencida)' : ''}</small> : null}
                <DealControls card={c} openStages={p.openStages} reasons={p.reasons} canEdit={canEdit(c)} isAdmin={p.isAdmin} />
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
