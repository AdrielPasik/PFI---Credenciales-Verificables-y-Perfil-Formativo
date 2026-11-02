import type { Metadata } from 'next';

import { DeadEndPage } from '@/components/feedback/dead-end-page';

export const metadata: Metadata = {
  title: 'Página no encontrada'
};

export default function NotFound() {
  return (
    <DeadEndPage
      title="No encontramos esta página"
      description="Puede que el enlace esté incompleto o que la página ya no exista."
    />
  );
}
