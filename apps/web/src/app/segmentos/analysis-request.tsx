'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AnalysisRequest({ canRequest, busyNow }: { canRequest: boolean; busyNow: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canRequest) return null;

  async function go() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/analisis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    setBusy(false);
    if (!res.ok) { setError(res.status === 409 ? 'Ya hay un análisis en curso o no hay producto dado de alta.' : 'No se pudo pedir el análisis.'); return; }
    router.refresh();
  }
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" onClick={go} disabled={busy || busyNow}>Pedir análisis de mercado</button>
      {error ? <span role="alert" style={{ color: '#b00020' }}>{error}</span> : null}
    </div>
  );
}
