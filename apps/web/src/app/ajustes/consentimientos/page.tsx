import { listConsentTexts, type ConsentBox, type ConsentTextListing } from '@turnosala/db/web';
import { redirect } from 'next/navigation';
import { currentActor } from '../../../lib/actor.js';
import { getServer } from '../../../lib/server.js';
import { Nav } from '../../nav.js';
import { ApproveButton, NewVersionForm } from './text-forms.js';

export const dynamic = 'force-dynamic';

const BOXES: Array<{ box: ConsentBox; label: string }> = [
  { box: 'privacy', label: 'Información de privacidad (siempre visible)' },
  { box: 'email', label: 'Casilla: correo electrónico' },
  { box: 'human_call', label: 'Casilla: llamada de una persona' },
  { box: 'ai_call', label: 'Casilla: llamada con asistente de voz' },
  { box: 'sms_whatsapp', label: 'Casilla: confirmar la demo por SMS/WhatsApp' },
];
const card = { background: '#fff', border: '1px solid #dde1e6', borderRadius: 8, padding: 16, display: 'grid', gap: 8 } as const;
const when = (d: Date): string => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function Version({ v, isAdmin, current }: { v: ConsentTextListing; isAdmin: boolean; current: boolean }) {
  return (
    <li data-testid="version-texto" style={{ display: 'grid', gap: 4 }}>
      <strong>{v.version} · {v.status === 'approved' ? (current ? 'Aprobada y vigente' : 'Aprobada (anterior)') : 'Borrador sin aprobar'}</strong>
      <span style={{ whiteSpace: 'pre-wrap' }}>{v.text}</span>
      <small>Creada {when(v.createdAt)}{v.approvedAt ? ` · aprobada ${when(v.approvedAt)}` : ''}</small>
      {v.status === 'draft' && isAdmin ? <ApproveButton id={v.id} /> : null}
    </li>
  );
}

export default async function ConsentTextsPage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  if (actor.role !== 'admin' && actor.role !== 'marketing') redirect('/');
  const all = await listConsentTexts(getServer().pool);
  const isAdmin = actor.role === 'admin';
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Textos de consentimiento</h1>
        <Nav />
      </header>
      <p style={{ margin: 0 }}>
        Son los textos que ve la persona en el formulario público. Cada envío guarda una copia literal de la versión mostrada. En producción el formulario no se muestra
        hasta que las cinco casillas tengan una versión <strong>aprobada</strong> (la aprobación la registra un administrador tras el informe del asesor legal). Una versión aprobada no se edita: se crea otra.
      </p>
      {BOXES.map(({ box, label }) => {
        const versions = all.filter((v) => v.box === box);
        const currentId = versions.find((v) => v.status === 'approved')?.id;
        return (
          <section key={box} style={card} aria-label={label}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{label}</h2>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 12 }}>
              {versions.map((v) => <Version key={v.id} v={v} isAdmin={isAdmin} current={v.id === currentId} />)}
            </ul>
            {isAdmin ? <NewVersionForm box={box} label={label} /> : null}
          </section>
        );
      })}
    </main>
  );
}
