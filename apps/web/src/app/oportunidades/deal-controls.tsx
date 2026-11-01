'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DealCard } from '../../lib/deal-view.js';

export interface StageOption { id: string; name: string }
export interface ReasonOption { id: string; name: string }

const ERRORS: Record<string, string> = {
  forbidden: 'No tienes permiso sobre esta oportunidad.',
  closed: 'Esta oportunidad ya está cerrada.',
  not_found: 'La oportunidad ya no existe.',
  invalid_reason: 'Elige un motivo de la lista.',
  invalid_stage: 'Etapa no válida.',
};

export async function postDeal(id: string, action: 'mover' | 'perder' | 'ganar' | 'asignar', body: unknown): Promise<string | null> {
  const res = await fetch(`/api/oportunidades/${id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return 'No hemos podido conectar. Inténtalo de nuevo.';
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return ERRORS[j.error ?? ''] ?? 'No se pudo completar la acción.';
}

/** Mover (con teclado, sin arrastrar), perder con motivo y, solo el admin, ganar. El servidor decide de verdad quién puede: esto solo oculta lo que no procede. */
export function DealControls(p: { card: DealCard; openStages: StageOption[]; reasons: ReasonOption[]; canEdit: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'lose' | 'win'>('none');
  if (p.card.closed || (!p.canEdit && !p.isAdmin)) return null;
  const { card } = p;

  async function run(action: 'mover' | 'perder' | 'ganar', body: unknown): Promise<void> {
    setBusy(true);
    const err = await postDeal(card.id, action, body);
    setBusy(false);
    setError(err);
    if (!err) { setPanel('none'); router.refresh(); }
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <form onSubmit={(e) => { e.preventDefault(); void run('mover', { stage: String(new FormData(e.currentTarget).get('stage') ?? '') }); }} style={{ display: 'flex', gap: 4 }}>
        <select name="stage" defaultValue={card.stage} aria-label={`Mover ${card.name} a otra etapa`}>
          {p.openStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="submit" disabled={busy}>Mover</button>
      </form>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setPanel(panel === 'lose' ? 'none' : 'lose')} aria-expanded={panel === 'lose'}>Perder…</button>
        {p.isAdmin ? <button type="button" onClick={() => setPanel(panel === 'win' ? 'none' : 'win')} aria-expanded={panel === 'win'}>Ganar…</button> : null}
      </div>
      {panel === 'lose' ? (
        <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run('perder', { reasonId: String(f.get('reasonId') ?? ''), note: String(f.get('note') ?? '') }); }} style={{ display: 'grid', gap: 4 }}>
          <select name="reasonId" required defaultValue="" aria-label="Motivo de la pérdida">
            <option value="" disabled>Motivo…</option>
            {p.reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input name="note" maxLength={1000} placeholder="Nota (opcional, sin datos de salud)" aria-label="Nota de la pérdida" />
          <button type="submit" disabled={busy}>Confirmar pérdida</button>
        </form>
      ) : null}
      {panel === 'win' ? <button type="button" disabled={busy} onClick={() => void run('ganar', {})}>Confirmar: marcar como ganada</button> : null}
      {error ? <span role="alert" style={{ color: '#b00020' }}>{error}</span> : null}
    </div>
  );
}
