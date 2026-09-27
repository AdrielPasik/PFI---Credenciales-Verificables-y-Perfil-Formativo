import { useLocalSearchParams } from 'expo-router';

import { ObjectiveDetailScreen } from '@/features/objectives/objective-detail-screen';

/** Objetivo persistido y su análisis de trayectoria. */
export default function ObjectiveDetailRoute() {
  const params = useLocalSearchParams<{ objectiveId?: string }>();
  const objectiveReference =
    typeof params.objectiveId === 'string' ? params.objectiveId : '';

  return <ObjectiveDetailScreen objectiveReference={objectiveReference} />;
}
