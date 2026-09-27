import { useQuery } from '@tanstack/react-query';

import {
  getMyObjectiveRequest,
  listMyObjectivesRequest
} from '@/lib/api/scope-api';
import { useAuthenticatedRequest } from '@/lib/auth/session-provider';
import { queryKeys } from '@/lib/query/query-client';
import type { ObjectiveDetailVM, ObjectiveSummaryVM } from '@/types/objectives';

/**
 * Consultas de Objetivos.
 *
 * SÓLO LECTURA. Crear una propuesta, crear un objetivo o ejecutar un análisis
 * son acciones explícitas de la persona y viven en sus propias pantallas: montar
 * una de estas consultas NUNCA gasta una llamada al proveedor.
 */

export function useObjectives() {
  const request = useAuthenticatedRequest();

  return useQuery<ObjectiveSummaryVM[]>({
    queryKey: queryKeys.objectives,
    queryFn: () => listMyObjectivesRequest(request)
  });
}

export function useObjectiveDetail(objectiveReference: string) {
  const request = useAuthenticatedRequest();

  return useQuery<ObjectiveDetailVM>({
    queryKey: queryKeys.objective(objectiveReference),
    queryFn: () => getMyObjectiveRequest(request, objectiveReference),
    enabled: objectiveReference.trim().length > 0
  });
}
