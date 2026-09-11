import type { Metadata } from 'next';

import { ObjectivesListRoute } from '@/features/holder/objectives/objectives-list-route';

export const metadata: Metadata = { title: 'Mis objetivos' };

export default function ObjectivesPage() { return <ObjectivesListRoute />; }
