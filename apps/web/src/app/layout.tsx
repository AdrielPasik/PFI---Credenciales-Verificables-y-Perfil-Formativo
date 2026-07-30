import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/app/providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Traza',
    template: '%s | Traza'
  },
  description: 'Credenciales verificables y perfil formativo.'
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR">
      <body className="min-h-svh bg-canvas font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
