'use client';

import { useEffect, useRef, useState } from 'react';

import {
  getIssuerAnalysisRunByIdRequest,
  getLatestIssuerAnalysisRunRequest,
  triggerIssuerDocumentAnalysisRequest
} from '@/lib/api/analysis-runs-api';
import type { AuthenticatedApiRequest } from '@/lib/api/api-client';
import { mapAnalysisRunError } from '@/lib/errors/analysis-run-error-mapper';
import type { IssuerAnalysisRunVM } from '@/models/analysis-runs';

export interface DocumentAnalysisState {
  latestStatus: 'idle' | 'loading' | 'ready' | 'error';
  currentRun: IssuerAnalysisRunVM | null;
  latestError: string | null;
  triggering: boolean;
  refreshing: boolean;
  actionError: string | null;
  successMessage: string | null;
}

const initialState: DocumentAnalysisState = {
  latestStatus: 'idle',
  currentRun: null,
  latestError: null,
  triggering: false,
  refreshing: false,
  actionError: null,
  successMessage: null
};

export function useIssuerDocumentAnalysis({
  credentialReference,
  issuerReference,
  requestAuthenticated
}: {
  credentialReference: string;
  issuerReference: string;
  requestAuthenticated: AuthenticatedApiRequest;
}) {
  const [state, setState] = useState<DocumentAnalysisState>(initialState);
  const requestSequence = useRef(0);
  const triggerInFlight = useRef(false);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    triggerInFlight.current = false;
    setState({ ...initialState, latestStatus: 'loading' });

    void getLatestIssuerAnalysisRunRequest(requestAuthenticated, {
      issuerReference,
      credentialReference
    })
      .then((currentRun) => {
        if (requestSequence.current !== sequence) return;
        setState({
          ...initialState,
          latestStatus: 'ready',
          currentRun
        });
      })
      .catch((error: unknown) => {
        if (requestSequence.current !== sequence) return;
        setState({
          ...initialState,
          latestStatus: 'error',
          latestError: mapAnalysisRunError(error, 'analysis-run-latest')
        });
      });

    return () => {
      if (requestSequence.current === sequence) {
        requestSequence.current += 1;
      }
    };
  }, [credentialReference, issuerReference, requestAuthenticated]);

  async function refresh() {
    const sequence = ++requestSequence.current;
    setState((current) => ({
      ...current,
      refreshing: true,
      latestError: null,
      actionError: null,
      successMessage: null
    }));

    try {
      const currentRun = await getLatestIssuerAnalysisRunRequest(
        requestAuthenticated,
        { issuerReference, credentialReference }
      );
      if (requestSequence.current !== sequence) return;
      setState((current) => ({
        ...current,
        latestStatus: 'ready',
        currentRun,
        refreshing: false,
        successMessage: 'El estado del análisis se actualizó.'
      }));
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      setState((current) => ({
        ...current,
        latestStatus: 'error',
        latestError: mapAnalysisRunError(error, 'analysis-run-latest'),
        refreshing: false
      }));
    }
  }

  async function trigger() {
    if (triggerInFlight.current) return;

    triggerInFlight.current = true;
    const sequence = ++requestSequence.current;
    setState((current) => ({
      ...current,
      triggering: true,
      actionError: null,
      latestError: null,
      successMessage: null
    }));

    try {
      const triggered = await triggerIssuerDocumentAnalysisRequest(
        requestAuthenticated,
        { issuerReference, credentialReference }
      );
      const currentRun = await getIssuerAnalysisRunByIdRequest(
        requestAuthenticated,
        {
          issuerReference,
          credentialReference,
          analysisRunReference: triggered.analysisRunReference
        }
      );
      if (requestSequence.current !== sequence) return;
      setState((current) => ({
        ...current,
        latestStatus: 'ready',
        currentRun,
        triggering: false,
        successMessage: 'El análisis finalizó y su estado quedó actualizado.'
      }));
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      setState((current) => ({
        ...current,
        triggering: false,
        actionError: mapAnalysisRunError(
          error,
          'document-analysis-trigger'
        )
      }));
    } finally {
      if (requestSequence.current === sequence) {
        triggerInFlight.current = false;
      }
    }
  }

  return { state, refresh, trigger };
}

