'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface LaunchOptions {
  segments: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; label: string }>;
  territories: Array<{ ineCode: string; name: string; province: string }>;
}

const ERRORS: Record<number, string> = { 403: 'No tienes permiso para lanzar investigaciones.', 422: 'Los datos no son válidos.' };

export function LaunchForm({ options }: { options: LaunchOptions }) {
  const router = useRouter();
  const [segmentId, setSegmentId] = useState(options.segments[0]?.id ?? '');
  const [sources, setSources] = useState<string[]>(options.sources.map((s) => s.id).slice(0, 1));
  const [codes, setCodes] = useState<string[]>([]);
  const [max, setMax] = useState('200');
  const [budget, setBudget] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/investigacion', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segmentId, ineCodes: codes, sourceIds: sources, maxCandidates: Number(max), budgetEur: Number(budget) }),
    });
    setBusy(false);
    if (!res.ok) {
      const detail = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      setError(res.status === 422 && detail && detail !== 'datos no válidos' ? detail : ERRORS[res.status] ?? 'No se pudo lanzar la investigación.');
      return;
    }
    setCodes([]);
    router.refresh();
  }
  const toggleSource = (id: string) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const ready = segmentId !== '' && sources.length > 0 && codes.length > 0;

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10 }} aria-label="Lanzar investigación">
      <label>Segmento aprobado <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>{options.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <fieldset style={{ border: '1px solid #dde1e6', borderRadius: 6 }}>
        <legend>Fuentes activas</legend>
        {options.sources.map((s) => <label key={s.id} style={{ marginRight: 12 }}><input type="checkbox" checked={sources.includes(s.id)} onChange={() => toggleSource(s.id)} /> {s.label}</label>)}
      </fieldset>
      <label>Municipios (Ctrl o Mayús para elegir varios)
        <select multiple size={8} aria-label="Municipios" value={codes} onChange={(e) => setCodes([...e.target.selectedOptions].map((o) => o.value))} style={{ display: 'block', minWidth: 280 }}>
          {options.territories.map((t) => <option key={t.ineCode} value={t.ineCode}>{t.name} ({t.province})</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label>Lote máximo (≤ 200) <input type="number" min={1} max={200} value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 80 }} /></label>
        <label>Presupuesto (€) <input type="number" min={0.5} max={100} step={0.5} value={budget} onChange={(e) => setBudget(e.target.value)} style={{ width: 80 }} /></label>
      </div>
      <div><button type="submit" disabled={busy || !ready}>Lanzar investigación</button></div>
      {error ? <p role="alert" style={{ color: '#b00020', margin: 0 }}>{error}</p> : null}
    </form>
  );
}
