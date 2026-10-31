'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SegmentActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canManage || (status !== 'draft' && status !== 'approved')) return null;
  const action = status === 'draft' ? 'approve' : 'retire';

  async function go() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/segmentos/${id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    setBusy(false);
    if (!res.ok) { setError('No se pudo completar la acción.'); return; }
    router.refresh();
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button type="button" onClick={go} disabled={busy}>{action === 'approve' ? 'Aprobar segmento' : 'Retirar segmento'}</button>
      {error ? <span role="alert" style={{ color: '#b00020' }}>{error}</span> : null}
    </div>
  );
}
