import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename } from 'node:path';

import { Injectable } from '@nestjs/common';

import {
  AiServiceClientError,
  type AiServiceHealthResponse,
  type AnalyzePdfWithAiInput,
  type BuildFormativeProfileWithAiInput
} from './ai-service.types';

const DEFAULT_TIMEOUT_MS = 60_000;

@Injectable()
export class AiServiceClient {
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

    return this.requestJson('/v1/semantic-analysis/pdf', {
      method: 'POST',
      body: formData
    });
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

  async buildFormativeProfile(
    input: BuildFormativeProfileWithAiInput
  ): Promise<unknown> {
    if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
      throw new AiServiceClientError(
        'At least one semantic_analysis_v1 artifact is required.',
        'configuration'
      );
    }

    return this.requestJson('/v1/formative-profile/build', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        artifacts: input.artifacts
      })
    });
  }

  private async requestJson(
    path: string,
    init: RequestInit
  ): Promise<unknown> {
    const baseUrl = this.getBaseUrl();
    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal
      });
    } catch (error: unknown) {
      if (this.isAbortError(error)) {
        throw new AiServiceClientError(
          `AI Service request timed out after ${timeoutMs} ms.`,
          'timeout'
        );
      }

      throw new AiServiceClientError(
        `AI Service is unavailable at ${baseUrl}: ${this.errorMessage(error)}`,
        'unavailable'
      );
    } finally {
      clearTimeout(timeout);
    }

    const responseBody = await response.text();
    const parsedBody = this.parseResponseJson(responseBody, response.status);

    if (!response.ok) {
      const detail = this.readErrorDetail(parsedBody);
      throw new AiServiceClientError(
        `AI Service request failed with status ${response.status}: ${detail}`,
        'http',
        response.status,
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
      return value;
    }

    try {
      return JSON.stringify(value).slice(0, 2_000);
    } catch {
      return String(value);
    }
  }

  private getBaseUrl(): string {
    const configured = process.env.AI_SERVICE_BASE_URL?.trim();
    if (!configured) {
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

    return configured.replace(/\/+$/, '');
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

  private expectNonEmptyString(value: unknown, field: string): string {
    const normalized = this.optionalNonEmptyString(value);
    if (!normalized) {
      throw new AiServiceClientError(`${field} is required.`, 'configuration');
    }
    return normalized;
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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
