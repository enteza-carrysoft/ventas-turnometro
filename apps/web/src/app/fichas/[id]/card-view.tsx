import type { Card } from '@turnosala/db/web';
import type { ReactNode } from 'react';

const box = { background: '#fff', border: '1px solid #dde1e6', borderRadius: 8, padding: 16, display: 'grid', gap: 8 } as const;
const STATUS: Record<string, string> = {
  candidate: 'Candidata', enriched: 'Pendiente de revisar', pending_review: 'Pendiente de revisar', approved: 'Aprobada', discarded: 'Descartada', blocked: 'Bloqueada', archived: 'Archivada',
};
const CRITERION: Record<string, string> = {
  simultaneous_attention: 'Atención simultánea', flow: 'Flujo de público', public_pain: 'Dolor declarado', easy_adoption: 'Facilidad de adopción',
  coverage: 'Cobertura', identifiable_decision_maker: 'Decisor identificable', inbound_interest: 'Interés entrante',
};

const isWeb = (u: string): boolean => /^https?:\/\//i.test(u);
const Section = ({ title, children }: { title: string; children: ReactNode }) => <section style={box}><h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>{children}</section>;

function Source({ url }: { url: string }) {
  return isWeb(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{url}</a> : <span>{url}</span>;
}

export function CompanyData({ p }: { p: Card['prospect'] }) {
  return (
    <Section title="Empresa">
      <p style={{ margin: 0 }}>Estado: <strong data-testid="estado">{STATUS[p.status] ?? p.status}</strong>{p.blockReason ? ` — ${p.blockReason}` : ''}</p>
      <p style={{ margin: 0 }}>Forma jurídica: {p.legalForm} · Municipio: {p.municipality ?? '—'} · Sedes: {p.sitesCount ?? '—'}</p>
      <p style={{ margin: 0 }}>Web: {p.website ? <Source url={p.website} /> : '—'}</p>
    </Section>
  );
}

type Breakdown = Record<string, { weight: number; value: number; points: number; signals: string[] }>;

export function ScoreBox({ p }: { p: Card['prospect'] }) {
  const b = (p.scoreBreakdown ?? {}) as Breakdown;
  return (
    <Section title="Puntuación">
      <p style={{ margin: 0 }} data-testid="puntuacion"><strong>{p.score ?? '—'}</strong> / 100 · {p.tier ?? 'sin nivel'} · modelo v{p.scoringVersion ?? '—'}</p>
      {p.scoreReasoning ? <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{p.scoreReasoning}</p> : null}
      <table style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Criterio</th><th>Peso</th><th>Puntos</th><th>Señales</th></tr></thead>
        <tbody>{Object.entries(b).map(([k, v]) => <tr key={k}><td>{CRITERION[k] ?? k}</td><td>{v.weight}</td><td>{v.points}</td><td>{v.signals.join(', ') || '—'}</td></tr>)}</tbody>
      </table>
    </Section>
  );
}

export function EvidenceTable({ items }: { items: Card['evidences'] }) {
  return (
    <Section title="Evidencias">
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Campo</th><th>Valor</th><th>Origen</th><th>Cita y fuente</th></tr></thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} data-testid={e.provenance === 'inferred' ? 'evidencia-inferida' : 'evidencia'} style={e.provenance === 'inferred' ? { background: '#fff4cc' } : undefined}>
              <td>{e.field}</td>
              <td>{e.value ?? '—'}</td>
              <td>{e.provenance === 'inferred' ? <mark>Inferido</mark> : 'Observado'}{e.explanation ? <small> — {e.explanation}</small> : null}</td>
              <td>{e.quote ? <q>{e.quote}</q> : null} <Source url={e.sourceUrl} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export function ContactsAndHistory({ card }: { card: Card }) {
  return (
    <>
      <Section title="Datos de contacto de la empresa (no se usan sin pasar la puerta de cumplimiento)">
        {card.contactPoints.length === 0 ? <p style={{ margin: 0 }}>Sin datos de contacto.</p> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>{card.contactPoints.map((c) => <li key={`${c.type}${c.value}`}>{c.type}: {c.value} {c.valid === false ? `(no válido: ${c.invalidReason ?? '—'})` : ''}</li>)}</ul>
        )}
      </Section>
      <Section title="Historial">
        {card.history.length === 0 ? <p style={{ margin: 0 }}>Sin historial.</p> : (
          <ul data-testid="historial" style={{ margin: 0, paddingLeft: 18 }}>{card.history.map((h, i) => <li key={i}>{h.at.toISOString().slice(0, 16).replace('T', ' ')} UTC · {h.action}</li>)}</ul>
        )}
      </Section>
    </>
  );
}
