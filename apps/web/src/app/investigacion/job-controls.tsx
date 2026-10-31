'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Repite la lectura del servidor cada pocos segundos mientras haya trabajo en marcha (CA4: refresco ≤ 10 s). */
export function AutoRefresh({ active, everyMs = 5000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}

const LABEL = { pause: 'Pausar', resume: 'Reanudar', cancel: 'Cancelar' } as const;

export function JobControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions: Array<keyof typeof LABEL> = status === 'paused' ? ['resume', 'cancel'] : status === 'queued' || status === 'running' ? ['pause', 'cancel'] : [];
  if (actions.length === 0) return null;

  async function go(action: keyof typeof LABEL) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/investigacion/${id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    setBusy(false);
    if (!res.ok) { setError('No se pudo completar la acción.'); return; }
    router.refresh();
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {actions.map((a) => <button key={a} type="button" onClick={() => go(a)} disabled={busy}>{LABEL[a]}</button>)}
      {error ? <span role="alert" style={{ color: '#b00020' }}>{error}</span> : null}
    </span>
  );
}
