import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/app/providers';
import { APPEARANCE_INIT_SCRIPT } from '@/lib/appearance/appearance';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Scope',
    template: '%s | Scope'
  },
  description: 'Una nueva forma de entender tu trayectoria.',
  icons: {
    icon: '/brand/Logo%20Scope%202.png'
  }
};

// Barra del navegador movil: sigue la apariencia del sistema (el tema elegido
// a mano no esta disponible al generar el HTML).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1424' }
  ]
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // `data-theme` lo fija el script inicial antes de hidratar: el servidor no
    // conoce la preferencia, que vive en el dispositivo.
    <html lang="es-AR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
      </head>
      <body className="min-h-svh bg-canvas font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
