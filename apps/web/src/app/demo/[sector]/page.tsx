import { landingSegment } from '@turnosala/db/web';
import { notFound } from 'next/navigation';
import { getServer } from '../../../lib/server.js';
import { LandingView } from '../landing-view.js';

export const dynamic = 'force-dynamic';

export default async function SectorPage({ params }: { params: Promise<{ sector: string }> }) {
  const { sector } = await params;
  const segment = await landingSegment(getServer().pool, sector);
  if (!segment) notFound();
  return <LandingView heading={`Solicita una demo de TurnoSala para ${segment.name.toLowerCase()}`} landing={{ sector: segment.slug }} />;
}
