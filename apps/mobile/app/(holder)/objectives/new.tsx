import { ObjectiveIntakeScreen } from '@/features/objectives/objective-intake-screen';

/**
 * Preparar un objetivo: carga del texto y revisión de los requisitos
 * propuestos, en una sola ruta porque la revisión vive en memoria y navegar la
 * perdería.
 */
export default function NewObjectiveRoute() {
  return <ObjectiveIntakeScreen />;
}
