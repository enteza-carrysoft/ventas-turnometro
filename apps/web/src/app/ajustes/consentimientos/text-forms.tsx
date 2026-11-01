'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const REASONS: Record<string, string> = {
  forbidden: 'Solo un administrador puede hacerlo.',
  version_exists: 'Ya existe una versión con ese nombre para esa casilla.',
  invalid: 'Revisa la versión (letras, números, punto, guion; hasta 30) y que el texto no esté vacío.',
  already_approved: 'Esa versión ya estaba aprobada.',
};

async function call(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return REASONS[j.error ?? ''] ?? 'No se pudo completar la acción.';
}

export function NewVersionForm({ box, label }: { box: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    const err = await call('/api/ajustes/consentimientos/crear', { box, version: String(fd.get('version') ?? ''), text: String(fd.get('text') ?? '') });
    setBusy(false);
    setError(err);
    if (!err) { form.reset(); router.refresh(); }
  }
  return (
    <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: 6 }} aria-label={`Nueva versión de ${label}`}>
      <label style={{ display: 'grid', gap: 2 }}>Versión nueva<input name="version" required maxLength={30} placeholder="p. ej. v2-asesor" /></label>
      <label style={{ display: 'grid', gap: 2 }}>Texto exacto<textarea name="text" required rows={3} /></label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" disabled={busy}>Crear borrador</button>
        {error ? <span role="alert" style={{ color: '#b00020' }}>{error}</span> : null}
      </div>
    </form>
  );
}

export function ApproveButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const err = await call('/api/ajustes/consentimientos/aprobar', { id });
    setBusy(false);
    setError(err);
    if (!err) router.refresh();
  }
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button type="button" onClick={() => void go()} disabled={busy}>Aprobar versión</button>
      {error ? <span role="alert" style={{ color: '#b00020' }}>{error}</span> : null}
    </span>
  );
}
