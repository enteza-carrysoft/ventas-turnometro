import { resolvePublicToken } from '@turnosala/db/web';
import { notFound } from 'next/navigation';
import { getServer } from '../../../lib/server.js';
import { LandingView } from '../../demo/landing-view.js';

export const dynamic = 'force-dynamic';

// Enlace personal del QR de la carta: no muestra datos de la ficha (el enlace podría reenviarse) y un token inválido, caducado o de baja da 404 sin más detalle.
export default async function PersonalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await resolvePublicToken(getServer().pool, 'landing', token))) notFound();
  return <LandingView heading="Solicita tu demo de TurnoSala" landing={{ token }} />;
}
