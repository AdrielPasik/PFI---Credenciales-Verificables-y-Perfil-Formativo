import type { Metadata } from 'next';

import { AdminRoute } from '@/features/admin/admin-route';

export const metadata: Metadata = {
  title: 'Administración de plataforma'
};

export default function AdminPage() {
  return <AdminRoute />;
}
