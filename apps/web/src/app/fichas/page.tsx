import { listQueue } from '@turnosala/db/web';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentActor } from '../../lib/actor.js';
import { getServer } from '../../lib/server.js';
import { Nav } from '../nav.js';
import { QueueClient } from './queue-client.js';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  const actor = await currentActor();
  if (!actor) redirect('/login');
  const queue = await listQueue(getServer().pool, { limit: 200 });
  const canReview = actor.role === 'admin' || actor.role === 'marketing';
  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Cola de revisión</h1>
        <Nav />
      </header>
      <p data-testid="pendientes" style={{ margin: 0 }}>{queue.length} ficha{queue.length === 1 ? '' : 's'} pendiente{queue.length === 1 ? '' : 's'} de revisar.
        {' '}Aprobar no envía nada: solo habilita la ficha para planificar acciones.</p>
      {queue.length === 0 ? <p>No hay fichas pendientes.</p> : <QueueClient canReview={canReview} items={queue.map((q) => ({ ...q, href: `/fichas/${q.id}` }))} />}
      {queue.length > 0 ? <p><Link href={`/fichas/${queue[0]?.id}`} data-testid="empezar">Empezar a revisar una a una (atajos de teclado)</Link></p> : null}
    </main>
  );
}
