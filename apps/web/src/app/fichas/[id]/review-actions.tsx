'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Mode = null | 'discard' | 'block' | 'correct';
interface Props {
  id: string;
  status: string;
  canReview: boolean;
  nextId: string | null;
  prevId: string | null;
}

const ERRORS: Record<string, string> = {
  forbidden: 'No tienes permiso para revisar fichas.', not_reviewable: 'Esta ficha ya no se puede revisar así.', reason_required: 'Escribe el motivo.',
  invalid_value: 'El valor no es válido.', domain_taken: 'Ya existe otra ficha con esa web.', not_found: 'La ficha no existe.',
};

async function send(url: string, body: unknown): Promise<{ ok: boolean; error: string | null }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return { ok: true, error: null };
  const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? '';
  return { ok: false, error: ERRORS[code] ?? 'No se pudo completar la acción.' };
}

function useShortcuts(handlers: Record<string, () => void>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) { if (e.key === 'Escape') handlers.escape?.(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const h = handlers[e.key.toLowerCase()];
      if (h) { e.preventDefault(); h(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers, enabled]);
}

function ModeForm({ mode, onSubmit, onCancel, busy }: { mode: Exclude<Mode, null>; onSubmit: (v: string, field: string) => void; onCancel: () => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [field, setField] = useState('name');
  useEffect(() => { ref.current?.focus(); }, []);
  const label = mode === 'correct' ? 'Nuevo valor' : 'Motivo';
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(value, field); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {mode === 'correct' ? (
        <select aria-label="Campo" value={field} onChange={(e) => setField(e.target.value)}>
          <option value="name">Nombre</option><option value="website">Web</option><option value="sites_count">Sedes</option>
        </select>
      ) : null}
      <label>{label} <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} style={{ minWidth: 260 }} /></label>
      <button type="submit" disabled={busy}>{mode === 'correct' ? 'Corregir' : mode === 'discard' ? 'Descartar' : 'Bloquear'}</button>
      <button type="button" onClick={onCancel}>Cancelar (Esc)</button>
    </form>
  );
}

export function ReviewActions({ id, status, canReview, nextId, prevId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = status === 'enriched' || status === 'pending_review';
  const done = useCallback(() => router.push(nextId ? `/fichas/${nextId}` : '/fichas'), [router, nextId]);

  const run = useCallback(async (url: string, body: unknown, andNext: boolean) => {
    setBusy(true);
    setError(null);
    const r = await send(url, body);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setMode(null);
    if (andNext) done(); else router.refresh();
  }, [done, router]);

  const approve = useCallback(() => { if (pending) void run(`/api/fichas/${id}/review`, { action: 'approve' }, true); }, [pending, run, id]);
  const handlers = {
    a: approve, d: () => setMode('discard'), b: () => setMode('block'), c: () => setMode('correct'), escape: () => setMode(null),
    n: () => { if (nextId) router.push(`/fichas/${nextId}`); }, p: () => { if (prevId) router.push(`/fichas/${prevId}`); },
  };
  useShortcuts(handlers, canReview);

  if (!canReview) return <p>Solo marketing y administración pueden revisar fichas.</p>;
  const submit = (value: string, field: string) => {
    if (mode === 'correct') void run(`/api/fichas/${id}/correct`, { field, value }, false);
    else if (mode) void run(`/api/fichas/${id}/review`, { action: mode, reason: value }, true);
  };
  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="acciones">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={approve} disabled={busy || !pending}>Aprobar (A)</button>
        <button type="button" onClick={handlers.d} disabled={busy}>Descartar (D)</button>
        <button type="button" onClick={handlers.b} disabled={busy}>Bloquear (B)</button>
        <button type="button" onClick={handlers.c} disabled={busy}>Corregir campo (C)</button>
        {prevId ? <Link href={`/fichas/${prevId}`}>Anterior (P)</Link> : null}
        {nextId ? <Link href={`/fichas/${nextId}`}>Siguiente (N)</Link> : null}
      </div>
      {mode ? <ModeForm mode={mode} onSubmit={submit} onCancel={() => setMode(null)} busy={busy} /> : null}
      {error ? <p role="alert" style={{ color: '#b00020', margin: 0 }}>{error}</p> : null}
    </div>
  );
}
