'use client';
import { useState, type ReactElement } from 'react';

export function UnsubscribeForm({ token, destination }: { token: string; destination: string | null }): ReactElement {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [scope, setScope] = useState<'contact' | 'company' | null>(null);

  async function go(s: 'contact' | 'company'): Promise<void> {
    setState('sending');
    setScope(s);
    const res = await fetch('/api/public/baja', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, scope: s }) }).catch(() => null);
    setState(res?.ok ? 'done' : 'error');
  }

  if (state === 'done') {
    return <p className="ok" role="status">{scope === 'company' ? 'Listo. No volveremos a contactar con tu empresa.' : `Listo. No volveremos a escribir a ${destination ?? 'este contacto'}.`}</p>;
  }
  return (
    <div className="form-actions" style={{ display: 'grid', gap: '1rem' }}>
      {destination ? <button type="button" disabled={state === 'sending'} onClick={() => void go('contact')}>No quiero recibir más comunicaciones en {destination}</button> : null}
      <button type="button" disabled={state === 'sending'} onClick={() => void go('company')}>Que no se contacte más con mi empresa</button>
      {state === 'error' ? <p className="err" role="alert">No hemos podido registrar la baja. Inténtalo de nuevo en un momento.</p> : null}
    </div>
  );
}
