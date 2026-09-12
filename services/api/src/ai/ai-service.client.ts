import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename } from 'node:path';

import { Injectable } from '@nestjs/common';

import {
  readInvalidOutputSubcode,
  type F3DiagnosticStage
} from './ai-service-invalid-output-diagnostics';

import {
  AiServiceClientError,
  ObjectiveAnalysisTransportError,
  ObjectiveProposalTransportError,
  readAiServiceErrorCode,
  readObjectiveProposalErrorCode,
  type AiServiceHealthResponse,
  type AnalyzeContextualReasoningWithAiInput,
  type AnalyzeEvidenceUnitsWithAiInput,
  type AnalyzeObjectiveWithAiInput,
  type AnalyzePdfWithAiInput,
  type AnalyzeTextWithAiInput,
  type AnalyzeTextWithAiMetadata,
  type AnalyzeTextWithAiSourceRefs,
  type BuildFormativeProfileWithAiInput,
  type ExtractPdfSourceInput,
  type ExtractTextSourceInput,
  type ProposeObjectiveRequirementsWithAiInput
} from './ai-service.types';
import { AiServiceInternalAuth } from './ai-service-internal-auth';

const DEFAULT_TIMEOUT_MS = 60_000;

@Injectable()
export class AiServiceClient {
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;

  constructor(
    private readonly internalAuth: AiServiceInternalAuth =
      new AiServiceInternalAuth()
  ) {
    this.baseUrl = this.getBaseUrl(this.internalAuth.isJwtEnabled());
    this.timeoutMs = this.getTimeoutMs();
  }

  async getHealth(): Promise<AiServiceHealthResponse> {
    const response = await this.requestJson('/health', {
      method: 'GET'
    });
    const health = this.expectRecord(response, 'AI Service health response');

    if (typeof health.status !== 'string' || typeof health.service !== 'string') {
      throw new AiServiceClientError(
        'AI Service health response has an invalid shape.',
        'invalid_response'
      );
    }

    return {
      status: health.status,
      service: health.service
    };
  }

  async analyzePdf(input: AnalyzePdfWithAiInput): Promise<unknown> {
    const { fileBytes, defaultFileName } = await this.readPdfInput(input);
    const effectiveFileName =
      this.optionalNonEmptyString(input.fileName) ?? defaultFileName;
    const formData = new FormData();

    formData.append(
      'file',
      new Blob([new Uint8Array(fileBytes)], {
        type: 'application/pdf'
      }),
      effectiveFileName
    );
    this.appendOptionalField(formData, 'documentId', input.documentId);
    this.appendOptionalField(formData, 'fileName', input.fileName);
    this.appendOptionalField(
      formData,
      'pipelineVersion',
      input.pipelineVersion
    );
    this.appendOptionalField(
      formData,
      'taxonomyVersion',
      input.taxonomyVersion
    );

    const correlationId = this.optionalCorrelationId(input.correlationId);

    return this.requestJson(
      '/v1/semantic-analysis/pdf',
      {
        method: 'POST',
        body: formData,
        headers: correlationId
          ? { 'x-analysis-run-id': correlationId }
          : undefined
      },
      true
    );
  }

  private async readPdfInput(input: AnalyzePdfWithAiInput): Promise<{
    fileBytes: Uint8Array;
    defaultFileName: string;
  }> {
    const hasFilePath =
      typeof input.filePath === 'string' && input.filePath.trim().length > 0;
    const hasFileBytes = input.fileBytes !== undefined;

    if (hasFilePath === hasFileBytes) {
      throw new AiServiceClientError(
        'Exactly one PDF source is required: filePath or fileBytes.',
        'configuration'
      );
    }

    if (hasFileBytes) {
      if (
        !(input.fileBytes instanceof Uint8Array) ||
        input.fileBytes.byteLength === 0
      ) {
        throw new AiServiceClientError(
          'fileBytes must contain a non-empty PDF.',
          'file'
        );
      }

      return {
        fileBytes: input.fileBytes,
        defaultFileName: 'upload.pdf'
      };
    }

    const filePath = this.expectNonEmptyString(input.filePath, 'filePath');
    await this.assertReadableFile(filePath);

    return {
      fileBytes: await readFile(filePath),
      defaultFileName: basename(filePath)
    };
  }

  async analyzeText(input: AnalyzeTextWithAiInput): Promise<unknown> {
    const content = this.expectNonEmptyString(input.content, 'content');
    const metadata = this.buildTextMetadata(input.metadata);
    const sourceRefs = this.buildTextSourceRefs(input.sourceRefs);
    const pipelineVersion = this.optionalNonEmptyString(input.pipelineVersion);
    const taxonomyVersion = this.optionalNonEmptyString(input.taxonomyVersion);
    const correlationId = this.optionalCorrelationId(input.correlationId);

    const body: Record<string, unknown> = { content };
    if (metadata) body.metadata = metadata;
    if (sourceRefs) body.sourceRefs = sourceRefs;
    if (pipelineVersion) body.requestedPipelineVersion = pipelineVersion;
    if (taxonomyVersion) body.requestedTaxonomyVersion = taxonomyVersion;

    return this.requestJson(
      '/v1/semantic-analysis/text',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(correlationId ? { 'x-analysis-run-id': correlationId } : {})
        },
        body: JSON.stringify(body)
      },
      true
    );
  }

  private buildTextMetadata(
    metadata: AnalyzeTextWithAiMetadata | undefined
  ): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    const result: Record<string, unknown> = {};
    const platformName = this.optionalNonEmptyString(metadata.platformName);
    if (platformName) result.platformName = platformName;
    if (typeof metadata.hours === 'number' && Number.isFinite(metadata.hours)) {
      result.hours = metadata.hours;
    }
    const modality = this.optionalNonEmptyString(metadata.modality);
    if (modality) result.modality = modality;
    const credentialType = this.optionalNonEmptyString(metadata.credentialType);
    if (credentialType) result.credentialType = credentialType;
    const languageHint = this.optionalNonEmptyString(metadata.languageHint);
    if (languageHint) result.languageHint = languageHint;
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private buildTextSourceRefs(
    sourceRefs: AnalyzeTextWithAiSourceRefs | undefined
  ): Record<string, unknown> | undefined {
    if (!sourceRefs) return undefined;
    const result: Record<string, unknown> = {};
    const textEvidenceId = this.optionalNonEmptyString(sourceRefs.textEvidenceId);
    if (textEvidenceId) result.textEvidenceId = textEvidenceId;
    const credentialId = this.optionalNonEmptyString(sourceRefs.credentialId);
    if (credentialId) result.credentialId = credentialId;
    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Transporte hacia el productor de extraccion de PDF (F0.2).
   *
   * Devuelve `unknown` A PROPOSITO. F1.3 es transporte y no tiene autoridad para
   * afirmar que la respuesta es un artifact valido: eso lo establece F0.4 y el
   * binding autoritativo lo establece F0.5. Un tipo de retorno mas fuerte
   * permitiria al compilador saltarse esa verificacion.
   *
   * Los bytes viajan completos por multipart, igual que la ruta semantica. No hay
   * truncamiento en ningun punto: si se excede el tope, FastAPI RECHAZA.
   */
  async extractPdfSource(input: ExtractPdfSourceInput): Promise<unknown> {
    if (!(input.fileBytes instanceof Uint8Array) || input.fileBytes.byteLength === 0) {
      throw new AiServiceClientError(
        'fileBytes must contain the authoritative PDF bytes.',
        'file'
      );
    }

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(input.fileBytes)], { type: 'application/pdf' }),
      'source.pdf'
    );
    formData.append(
      'documentEvidenceId',
      this.expectNonEmptyString(input.documentEvidenceId, 'documentEvidenceId')
    );
    formData.append(
      'sourceSha256',
      this.expectNonEmptyString(input.sourceSha256, 'sourceSha256')
    );
    formData.append('storageKey', this.expectNonEmptyString(input.storageKey, 'storageKey'));

    const correlationId = this.optionalCorrelationId(input.correlationId);

    return this.requestJson(
      '/v1/source-extraction/pdf',
      {
        method: 'POST',
        body: formData,
        headers: correlationId ? { 'x-analysis-run-id': correlationId } : undefined
      },
      true
    );
  }

  /**
   * Transporte hacia el productor de extraccion de TEXT (F0.3).
   *
   * El contenido viaja EXACTAMENTE como se recibe. No se normaliza, no se recorta
   * y no se compone: F0.3 exige que ya sea punto fijo de
   * `PRODUCT_NFC_LINEENDINGS_TRIM` y verifica esa precondicion. Arreglarlo aca
   * esconderia un bug aguas arriba.
   *
   * Nota: se usa `content` sin `expectNonEmptyString`, porque el contenido vacio
   * es un caso contractual valido de F0 —`FULL` con cero evidencia— y rechazarlo
   * en el transporte lo volveria irrepresentable.
   */
  async extractTextSource(input: ExtractTextSourceInput): Promise<unknown> {
    if (typeof input.content !== 'string') {
      throw new AiServiceClientError('content must be a string.', 'configuration');
    }

    const correlationId = this.optionalCorrelationId(input.correlationId);
    const body = {
      content: input.content,
      textEvidenceId: this.expectNonEmptyString(input.textEvidenceId, 'textEvidenceId'),
      sourceSha256: this.expectNonEmptyString(input.sourceSha256, 'sourceSha256')
    };

    return this.requestJson(
      '/v1/source-extraction/text',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(correlationId ? { 'x-analysis-run-id': correlationId } : {})
        },
        body: JSON.stringify(body)
      },
      true
    );
  }

  /**
   * Transporte hacia el Objective Analysis productivo (F3.3B).
   *
   * UNA sola llamada por Objective, con todos los Requirements: la granularidad
   * congelada es `ONE_CALL_PER_OBJECTIVE`, y no existe una ruta por Requirement.
   *
   * Lo que viaja es EXACTAMENTE lo que el llamante ya cargo del snapshot
   * congelado del run. Este metodo no lee la base, no consulta el Objective
   * vigente y no completa nada: si algo falta, falta aguas arriba.
   *
   * Traduce el fallo a una taxonomia CERRADA derivada del status. La distincion
   * importa de verdad porque de ella depende el desenlace del run: hay fallos que
   * lo matan y fallos que lo dejan reintentable.
   */
  async analyzeObjective(input: AnalyzeObjectiveWithAiInput): Promise<unknown> {
    const correlationId = this.optionalCorrelationId(input.correlationId);
    const body = {
      schemaVersion: this.expectNonEmptyString(input.schemaVersion, 'schemaVersion'),
      executionPlan: input.executionPlan,
      objectiveType: this.expectNonEmptyString(input.objectiveType, 'objectiveType'),
      // Sin `expectNonEmptyString`: un Objective sin contexto es un caso valido
      // —la ausencia de contexto es informacion— y rechazarlo aca lo volveria
      // irrepresentable.
      objectiveContext: input.objectiveContext,
      requirements: input.requirements
    };

    try {
      return await this.requestJson(
        '/v1/objective-analysis',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(correlationId ? { 'x-analysis-run-id': correlationId } : {})
          },
          body: JSON.stringify(body)
        },
        true
      );
    } catch (error: unknown) {
      throw this.toObjectiveAnalysisTransportError('objective_analysis', error);
    }
  }

  /**
   * Clasificacion por CODIGO DE APLICACION VALIDADO — F3.3B.1.
   *
   * Antes se derivaba del status a secas, y eso hacia representable un hecho
   * falso: un `502` de un proxy se leia como "el proveedor respondio entero y su
   * salida no cumple el contrato", y el run moria. Un 502 opaco no demuestra que
   * nadie haya ejecutado Objective Analysis.
   *
   *     un desenlace TERMINAL exige una afirmacion de NUESTRA aplicacion
   *
   * O sea: envelope `ai_service_error_v1` bien formado, con un codigo del
   * vocabulario cerrado, y coherente con el status. Cualquier otra cosa —cuerpo
   * vacio, HTML, JSON arbitrario, envelope malformado, codigo desconocido, par
   * status/code inconsistente— es `INTERNAL_AI_SERVICE_FAILURE`: el run queda
   * pendiente, el artifact ausente y el reintento tecnico disponible.
   *
   * En ningun caso se parsea texto: ni `detail`, ni `message`, ni HTML, ni
   * substrings.
   */
  private toObjectiveAnalysisTransportError(
    /**
     * La etapa la pone el LLAMANTE desde su propia identidad — P2.4 OBS. Nunca
     * se deduce del mensaje, ni de la URL, ni del stack: eso convertiria una
     * cadena del otro lado en la fuente de un campo de diagnostico.
     */
    stage: F3DiagnosticStage,
    error: unknown
  ): ObjectiveAnalysisTransportError {
    if (!(error instanceof AiServiceClientError)) {
      return new ObjectiveAnalysisTransportError('INTERNAL_AI_SERVICE_FAILURE');
    }

    if (error.code === 'timeout' || error.code === 'unavailable') {
      // Nunca hubo respuesta. Es el unico caso en que se puede afirmar el fallo
      // de transporte SIN envelope, porque la afirmacion no es sobre el
      // proveedor: es sobre este cliente, que sabe que no obtuvo nada.
      return new ObjectiveAnalysisTransportError(
        'PROVIDER_TRANSPORT_FAILURE',
        error.status
      );
    }

    // `invalid_response` —cuerpo vacio o no-JSON— llega aca con `body` en null y
    // cae, correctamente, en el fallo interno.
    const applicationCode = readAiServiceErrorCode(error.body, error.status);

    switch (applicationCode) {
      case 'PROVIDER_INVALID_OUTPUT':
        // El unico codigo que arrastra subcodigo. La clasificacion NO cambia:
        // se sigue devolviendo el mismo `code` y el mismo `status`.
        return new ObjectiveAnalysisTransportError(
          applicationCode,
          error.status,
          readInvalidOutputSubcode(stage, error.body)
        );
      case 'EXECUTION_PLAN_MISMATCH':
      case 'PROVIDER_TRANSPORT_FAILURE':
      case 'PROVIDER_CONFIGURATION_FAILURE':
        return new ObjectiveAnalysisTransportError(applicationCode, error.status);
      default:
        // Incluye el 422 de validacion de request de FastAPI: es un problema del
        // borde, no un desenlace del run, y matar el run por eso destruiria
        // trabajo por algo que se arregla redeployando.
        return new ObjectiveAnalysisTransportError(
          'INTERNAL_AI_SERVICE_FAILURE',
          error.status
        );
    }
  }

  /**
   * Transporte hacia el catalogo de EvidenceUnits productivo (F3.4).
   *
   * UNA sola llamada por run, con TODAS las fuentes: la granularidad congelada
   * del stage es una llamada por ReasoningRun, y no existe una ruta por fuente.
   *
   * Objective-independent por construccion: el input no tiene forma de llevar el
   * Objective, Requirements, analisis previo ni interpretaciones semanticas
   * heredadas.
   *
   * Misma taxonomia cerrada de fallos que la etapa 1: la reutiliza en vez de
   * definir una propia, porque el desenlace del run se decide igual.
   */
  async analyzeEvidenceUnits(
    input: AnalyzeEvidenceUnitsWithAiInput
  ): Promise<unknown> {
    const correlationId = this.optionalCorrelationId(input.correlationId);
    const body = {
      schemaVersion: this.expectNonEmptyString(input.schemaVersion, 'schemaVersion'),
      executionPlan: input.executionPlan,
      sources: input.sources
    };

    try {
      return await this.requestJson(
        '/v1/evidence-units',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(correlationId ? { 'x-analysis-run-id': correlationId } : {})
          },
          body: JSON.stringify(body)
        },
        true
      );
    } catch (error: unknown) {
      throw this.toObjectiveAnalysisTransportError('evidence_units', error);
    }
  }

  /**
   * Transporte hacia el razonamiento contextual productivo (F3.5).
   *
   * UNA llamada por Requirement: la granularidad congelada del stage. El
   * recorrido de los N Requirements y el corte en el primero que falla viven en
   * el servicio de orquestacion, que es quien puede decidir no gastar las
   * llamadas restantes.
   *
   * Misma taxonomia cerrada de fallos que las etapas anteriores.
   */
  async analyzeContextualReasoning(
    input: AnalyzeContextualReasoningWithAiInput
  ): Promise<unknown> {
    const correlationId = this.optionalCorrelationId(input.correlationId);
    const body = {
      schemaVersion: this.expectNonEmptyString(input.schemaVersion, 'schemaVersion'),
      executionPlan: input.executionPlan,
      objectiveContext: input.objectiveContext,
      requirement: input.requirement,
      evidenceUnits: input.evidenceUnits,
      sources: input.sources,
      preparation: input.preparation
    };

    try {
      return await this.requestJson(
        '/v1/contextual-reasoning',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(correlationId ? { 'x-analysis-run-id': correlationId } : {})
          },
          body: JSON.stringify(body)
        },
        true
      );
    } catch (error: unknown) {
      throw this.toObjectiveAnalysisTransportError('contextual_reasoning', error);
    }
  }

  async buildFormativeProfile(
    input: BuildFormativeProfileWithAiInput
  ): Promise<unknown> {
    if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
      throw new AiServiceClientError(
        'At least one semantic_analysis_v1 artifact is required.',
        'configuration'
      );
    }

    return this.requestJson(
      '/v1/formative-profile/build',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          artifacts: input.artifacts
        })
      },
      true
    );
  }

  /**
   * Transporte hacia Objective Understanding productivo (P2.2).
   *
   * UNA sola llamada por Objective: la granularidad evaluada en P2.1 es
   * `ONE_CALL_PER_OBJECTIVE`, así que no hay ruta por sección, por Requirement,
   * de reparación de anclaje ni de deduplicación.
   *
   * Evidence-blind por construcción: el input no tiene forma de llevar
   * credenciales, perfil, skills, EvidenceUnits ni ReasoningRuns.
   *
   * Taxonomía de fallos PROPIA, no la de las etapas del ReasoningRun: acá ningún
   * desenlace mata una fila porque no hay fila. Lo único que decide la
   * clasificación es si repetir el pedido puede tener otro resultado.
   */
  async proposeObjectiveRequirements(
    input: ProposeObjectiveRequirementsWithAiInput
  ): Promise<unknown> {
    const correlationId = this.optionalCorrelationId(input.correlationId);
    const body = {
      schemaVersion: this.expectNonEmptyString(input.schemaVersion, 'schemaVersion'),
      objectiveType: this.expectNonEmptyString(input.objectiveType, 'objectiveType'),
      // Sin `expectNonEmptyString`: un Objective sin título es un caso válido y el
      // título no crea Requirements de todos modos.
      title: input.title,
      // NO se usa `expectNonEmptyString`: ese helper devuelve el valor RECORTADO,
      // y recortar acá desplazaría en silencio cada offset del artefacto. Los
      // `charStart`/`charEnd` se calculan sobre el texto que recibe el AI service
      // y se verifican contra el que NestJS creyó enviar: si difieren en un solo
      // espacio inicial, todas las referencias quedan corridas. Se comprueba que
      // no esté en blanco, y se envía tal cual.
      rawObjectiveText: this.expectNonBlankStringVerbatim(
        input.rawObjectiveText,
        'rawObjectiveText'
      )
    };

    try {
      return await this.requestJson(
        '/v1/objective-requirement-proposal',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(correlationId ? { 'x-analysis-run-id': correlationId } : {})
          },
          body: JSON.stringify(body)
        },
        true
      );
    } catch (error: unknown) {
      throw this.toObjectiveProposalTransportError(error);
    }
  }

  /** Clasificación por CÓDIGO DE APLICACIÓN VALIDADO, nunca por status a secas. */
  private toObjectiveProposalTransportError(
    error: unknown
  ): ObjectiveProposalTransportError {
    if (!(error instanceof AiServiceClientError)) {
      return new ObjectiveProposalTransportError('INTERNAL_AI_SERVICE_FAILURE');
    }

    if (error.code === 'timeout' || error.code === 'unavailable') {
      // Nunca hubo respuesta. Es el único caso en que se puede afirmar el fallo
      // de transporte SIN envelope, porque la afirmación es sobre este cliente.
      return new ObjectiveProposalTransportError('PROVIDER_TRANSPORT_FAILURE');
    }

    const applicationCode = readObjectiveProposalErrorCode(error.body, error.status);
    switch (applicationCode) {
      case 'OBJECTIVE_TOO_LARGE':
      case 'PROVIDER_INVALID_OUTPUT':
      case 'PROVIDER_TRANSPORT_FAILURE':
      case 'PROVIDER_CONFIGURATION_FAILURE':
        return new ObjectiveProposalTransportError(applicationCode);
      default:
        // Incluye el 422 de validación de request de FastAPI: es un problema del
        // borde entre servicios, no una afirmación sobre la propuesta.
        return new ObjectiveProposalTransportError('INTERNAL_AI_SERVICE_FAILURE');
    }
  }

  private async requestJson(
    path: string,
    init: RequestInit,
    requiresInternalAuth = false
  ): Promise<unknown> {
    if (!this.baseUrl) {
      throw new AiServiceClientError(
        'AI_SERVICE_BASE_URL is required.',
        'configuration'
      );
    }
    const authorization = requiresInternalAuth
      ? this.internalAuth.createAuthorizationHeader()
      : null;
    const requestInit = authorization
      ? {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers).entries()),
            authorization
          }
        }
      : init;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...requestInit,
        signal: controller.signal
      });
    } catch (error: unknown) {
      if (this.isAbortError(error)) {
        throw new AiServiceClientError(
          `AI Service request timed out after ${this.timeoutMs} ms.`,
          'timeout'
        );
      }

      throw new AiServiceClientError(
        'AI Service is unavailable.',
        'unavailable',
        null,
        null,
        this.readCauseCode(error)
      );
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await response.text();
    const parsedBody = this.parseResponseJson(responseBody, response.status);

    if (!response.ok) {
      const detail =
        response.status === 401 || response.status === 403
          ? 'AI Service rejected the internal service credential.'
          : this.readErrorDetail(parsedBody);
      throw new AiServiceClientError(
        `AI Service request failed with status ${response.status}: ${detail}`,
        'http',
        response.status,
        detail,
        null,
        // El cuerpo ESTRUCTURADO viaja aparte de `detail`: clasificar leyendo la
        // string formateada seria parsear prosa.
        parsedBody
      );
    }

    return parsedBody;
  }

  private parseResponseJson(body: string, status: number): unknown {
    if (body.trim().length === 0) {
      throw new AiServiceClientError(
        `AI Service returned an empty response for status ${status}.`,
        'invalid_response',
        status
      );
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new AiServiceClientError(
        `AI Service returned a non-JSON response for status ${status}.`,
        'invalid_response',
        status
      );
    }
  }

  private readErrorDetail(body: unknown): string {
    if (
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      'detail' in body
    ) {
      return this.formatDetail((body as Record<string, unknown>).detail);
    }

    return this.formatDetail(body);
  }

  private formatDetail(value: unknown): string {
    if (typeof value === 'string') {
      return value.slice(0, 500);
    }

    return 'AI Service returned a structured error response.';
  }

  private getBaseUrl(required: boolean): string | null {
    const configured = process.env.AI_SERVICE_BASE_URL?.trim();
    if (!configured) {
      if (!required) {
        return null;
      }
      throw new AiServiceClientError(
        'AI_SERVICE_BASE_URL is required.',
        'configuration'
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(configured);
    } catch {
      throw new AiServiceClientError(
        'AI_SERVICE_BASE_URL must be a valid URL.',
        'configuration'
      );
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new AiServiceClientError(
        'AI_SERVICE_BASE_URL must use http or https.',
        'configuration'
      );
    }

    if (parsed.username || parsed.password) {
      throw new AiServiceClientError(
        'AI_SERVICE_BASE_URL must not contain credentials.',
        'configuration'
      );
    }
    if (parsed.search || parsed.hash) {
      throw new AiServiceClientError(
        'AI_SERVICE_BASE_URL must not contain a query or fragment.',
        'configuration'
      );
    }

    return parsed.toString().replace(/\/+$/, '');
  }

  private getTimeoutMs(): number {
    const configured = process.env.AI_SERVICE_TIMEOUT_MS?.trim();
    if (!configured) {
      return DEFAULT_TIMEOUT_MS;
    }

    const timeoutMs = Number(configured);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new AiServiceClientError(
        'AI_SERVICE_TIMEOUT_MS must be a positive integer.',
        'configuration'
      );
    }

    return timeoutMs;
  }

  private async assertReadableFile(filePath: string) {
    try {
      await access(filePath, fsConstants.F_OK | fsConstants.R_OK);
    } catch {
      throw new AiServiceClientError(
        `PDF file does not exist or is not readable: ${filePath}`,
        'file'
      );
    }
  }

  private appendOptionalField(
    formData: FormData,
    field: string,
    value: unknown
  ) {
    const normalized = this.optionalNonEmptyString(value);
    if (normalized) {
      formData.append(field, normalized);
    }
  }

  private optionalNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private optionalCorrelationId(value: unknown): string | null {
    const normalized = this.optionalNonEmptyString(value);
    if (!normalized) return null;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) {
      throw new AiServiceClientError(
        'correlationId must contain only safe identifier characters.',
        'configuration'
      );
    }
    return normalized;
  }

  private readCauseCode(error: unknown): string | null {
    if (!error || typeof error !== 'object' || !('cause' in error)) {
      return null;
    }

    const cause = (error as { cause?: unknown }).cause;
    if (!cause || typeof cause !== 'object' || !('code' in cause)) {
      return null;
    }

    const code = (cause as { code?: unknown }).code;
    return typeof code === 'string' && /^[A-Z0-9_-]{2,64}$/.test(code)
      ? code
      : null;
  }

  private expectNonEmptyString(value: unknown, field: string): string {
    const normalized = this.optionalNonEmptyString(value);
    if (!normalized) {
      throw new AiServiceClientError(`${field} is required.`, 'configuration');
    }
    return normalized;
  }

  /**
   * Exige una string con contenido y la devuelve SIN TOCAR.
   *
   * Es la contraparte de `expectNonEmptyString` para los payloads cuyo texto es
   * autoridad de offsets: valida lo mismo, pero no normaliza. Un helper aparte y
   * no un flag porque el comportamiento por defecto —recortar— es el correcto
   * para el resto de los campos, y quien lea la llamada tiene que ver cuál usó.
   */
  private expectNonBlankStringVerbatim(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AiServiceClientError(`${field} is required.`, 'configuration');
    }
    return value;
  }

  private expectRecord(
    value: unknown,
    context: string
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AiServiceClientError(
        `${context} must be a JSON object.`,
        'invalid_response'
      );
    }
    return value as Record<string, unknown>;
  }

  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    );
  }
}
