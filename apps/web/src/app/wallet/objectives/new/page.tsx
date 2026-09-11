import type { Metadata } from 'next';

import { ObjectiveIntakeRoute } from '@/features/holder/objectives/objective-intake-route';

export const metadata: Metadata = { title: 'Analizar un objetivo' };

export default function NewObjectivePage() { return <ObjectiveIntakeRoute />; }
