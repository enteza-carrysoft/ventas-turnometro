'use client';

import { createAuthClient } from 'better-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const authClient = createAuthClient();

export function KillSwitchControl({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/kill-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.status === 403 ? 'No tienes permiso para cambiar el kill switch.' : 'No se pudo cambiar el kill switch.');
      return;
    }
    router.refresh();
  }

  async function logout() {
    await authClient.signOut();
    window.location.href = '/login';
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {canEdit ? (
        <button type="button" onClick={toggle} disabled={busy}>
          {enabled ? 'Desactivar kill switch' : 'Activar kill switch'}
        </button>
      ) : (
        <span>Solo un administrador puede cambiar el kill switch.</span>
      )}
      <button type="button" onClick={logout}>Salir</button>
      {error ? <p role="alert" style={{ color: '#b00020', margin: 0 }}>{error}</p> : null}
    </div>
  );
}
