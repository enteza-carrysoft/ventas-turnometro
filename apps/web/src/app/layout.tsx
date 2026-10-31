import type { ReactNode } from 'react';

export const metadata = { title: 'TurnoSala Prospector', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#f6f7f9', color: '#1b1f24' }}>{children}</body>
    </html>
  );
}
