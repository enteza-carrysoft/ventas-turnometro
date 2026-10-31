import { getCard, listQueue } from '@turnosala/db/web';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentActor } from '../../../lib/actor.js';
import { getServer } from '../../../lib/server.js';
import { Nav } from '../../nav.js';
import { CompanyData, ContactsAndHistory, EvidenceTable, ScoreBox } from './card-view.js';
import { ReviewActions } from './review-actions.js';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { pool } = getServer();
  const card = await getCard(pool, id);
  if (!card) notFound();
  const ids = (await listQueue(pool, { limit: 500 })).map((q) => q.id);
  const at = ids.indexOf(id);
  // Si la ficha ya no está en la cola (p. ej. recién aprobada), «siguiente» es la primera pendiente.
  const nextId = (at >= 0 ? ids[at + 1] ?? ids[at - 1] : ids[0]) ?? null;
  const prevId = at > 0 ? ids[at - 1] ?? null : null;
  const canReview = actor.role === 'admin' || actor.role === 'marketing';
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 data-testid="titulo-ficha" style={{ margin: 0, fontSize: 22 }}>{card.prospect.name}</h1>
        <Nav />
      </header>
      <ReviewActions id={id} status={card.prospect.status} canReview={canReview} nextId={nextId} prevId={prevId} />
      <CompanyData p={card.prospect} />
      <ScoreBox p={card.prospect} />
      <EvidenceTable items={card.evidences} />
      <ContactsAndHistory card={card} />
      <p style={{ color: '#555' }}><Link href="/fichas">Volver a la cola</Link>. El mapa y los canales permitidos por la puerta de cumplimiento llegan con las campañas (F2).</p>
    </main>
  );
}
