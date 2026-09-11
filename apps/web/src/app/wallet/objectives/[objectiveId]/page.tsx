import type { Metadata } from 'next';

import { ObjectiveDetailRoute } from '@/features/holder/objectives/objective-detail-route';

export const metadata: Metadata = { title: 'Objetivo' };

export default function ObjectiveDetailPage() { return <ObjectiveDetailRoute />; }
