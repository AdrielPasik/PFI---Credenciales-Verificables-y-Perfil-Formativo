import type { Metadata } from 'next';

import { parseAdminEntry } from '@/features/admin/admin-entry';
import { AdminRoute } from '@/features/admin/admin-route';

export const metadata: Metadata = {
  title: 'Administración de plataforma'
};

export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Origen de la visita (enum cerrado): decide a donde vuelve el boton de
  // regreso. Cualquier otro valor se ignora.
  const { from } = await searchParams;
  return <AdminRoute entry={parseAdminEntry(from)} />;
}
