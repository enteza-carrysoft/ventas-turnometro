import { resolvePublicToken } from '@turnosala/db/web';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { maskEmail, maskPhone } from '../../../lib/mask.js';
import { getServer } from '../../../lib/server.js';
import { PUBLIC_CSS } from '../../demo/public-styles.js';
import { UnsubscribeForm } from './unsubscribe-form.js';

export const dynamic = 'force-dynamic';

// Mostrar la página NO da de baja a nadie: la baja la hace el botón (POST). Un token inválido, caducado o revocado da 404 sin más detalle.
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await resolvePublicToken(getServer().pool, 'unsubscribe', token);
  if (!t) notFound();
  const nonce = (await headers()).get('x-nonce');
  const dest = t.contact.email ? maskEmail(t.contact.email) : t.contact.phone ? maskPhone(t.contact.phone) : null;
  return (
    <main className="pub">
      <style nonce={nonce ?? undefined}>{PUBLIC_CSS}</style>
      <h1>Darte de baja</h1>
      <p className="lead">Elige qué quieres que dejemos de hacer. Es inmediato y no hace falta explicar nada.</p>
      <UnsubscribeForm token={token} destination={dest} />
    </main>
  );
}
