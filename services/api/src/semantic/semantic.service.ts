import {
  BadRequestException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Prisma, type SemanticAnalysis } from '@prisma/client';

import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialLatestSemanticAnalysisResponseDto } from './dto/latest-semantic-analysis-response.dto';
import { createSemanticAnalysisArtifactMapping } from './semantic-analysis-artifact.mapper';
import {
  type SemanticAnalysisArtifact,
  type SemanticAnalysisArtifactMappingResult
} from './semantic-analysis-artifact.types';
import { validateSemanticAnalysisArtifact } from './semantic-analysis-artifact.validator';

/**
 * Columnas que la lectura del ultimo analisis puede tocar — F1.5.
 *
 * Es un `select` explicito, no un `findFirst` que traiga la fila entera. La
 * allowlist del DTO ya excluye `analysisJson`, `textForEmbedding` y
 * `evidenceMap`; este select hace que ademas NO SE CARGUEN. Un campo que nunca
 * sale de la base no puede filtrarse por un mapper futuro que se olvide de
 * excluirlo, y `analysisJson` es una columna JSON grande que esta lectura no
 * necesita para nada.
 */
const latestSemanticAnalysisSelect = {
  id: true,
  schemaVersion: true,
  status: true,
  pipelineVersion: true,
  taxonomyVersion: true,
  confidence: true,
  areas: true,
  skills: true,
  concepts: true,
  qualityFlags: true,
  analyzedAt: true
} as const;

type LatestSemanticAnalysisRow = Pick<
  SemanticAnalysis,
  keyof typeof latestSemanticAnalysisSelect
>;

@Injectable()
export class SemanticService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  /**
   * Ultimo `SemanticAnalysis` de una credencial, para el emisor que la posee.
   *
   * AUTORIZACION — F1.5. Hasta este slice la ruta no tenia `AuthGuard` ni
   * comprobacion de autoridad: conocer un `credentialId` bastaba para leer el
   * analisis completo, `analysisJson` incluido. Conocer un id NO es autoridad
   * sobre el recurso.
   *
   * El issuer se toma de la credencial PERSISTIDA, nunca de un parametro: es el
   * mismo patron que ya usa la ruta hermana
   * `POST /credentials/:id/semantic-analysis/from-pdf`
   * (`AiIntegrationService.analyzeCredentialPdfForIssuerUser`), que carga
   * `credential.issuerId` y delega en `IssuersService`.
   *
   * La audiencia NO se amplia. Esta ruta pertenece a la superficie de emisor
   * —asi la documenta el handoff de frontend y asi la usa el script de demo—,
   * de modo que F1.5 la restringe a esa audiencia y no agrega acceso de holder
   * porque tecnicamente pudiera ser util. Si mas adelante el holder necesita ver
   * su analisis semantico, eso es una ruta bajo `me/` con su propio contrato.
   */
  async getLatestForCredential(
    credentialId: string,
    userId: string
  ): Promise<CredentialLatestSemanticAnalysisResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');
    this.assertNonEmptyString(userId, 'userId');

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      select: {
        id: true,
        issuerId: true
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    // Membresia activa y con rol suficiente sobre el issuer de ESTA credencial.
    // Se reutiliza el helper de lectura ya existente; F1.5 no crea un segundo
    // sistema de permisos.
    await this.issuersService.assertUserCanReadCredentialsForIssuer(
      userId,
      credential.issuerId
    );

    const latestSemanticAnalysis = await this.prisma.semanticAnalysis.findFirst({
      where: {
        credentialId
      },
      orderBy: {
        analyzedAt: 'desc'
      },
      select: latestSemanticAnalysisSelect
    });

    return {
      credentialId: credential.id,
      latestSemanticAnalysis: latestSemanticAnalysis
        ? this.toLatestSemanticAnalysisResponse(latestSemanticAnalysis)
        : null
    };
  }

  async persistForCredential(
    credentialId: string,
    artifact: unknown,
    options: {
      analysisRunId?: string;
      transaction?: Prisma.TransactionClient;
    } = {}
  ): Promise<SemanticAnalysis> {
    this.assertNonEmptyString(credentialId, 'credentialId');

    const validatedArtifact = validateSemanticAnalysisArtifact(artifact);
    const mappedArtifact =
      createSemanticAnalysisArtifactMapping(validatedArtifact);

    const client = options.transaction ?? this.prisma;
    const credential = await client.credential.findUnique({
      where: {
        id: credentialId
      },
      select: {
        id: true
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    return client.semanticAnalysis.create({
      data: this.buildCreateData(
        credential.id,
        validatedArtifact,
        mappedArtifact,
        options.analysisRunId
      )
    });
  }

  private buildCreateData(
    credentialId: string,
    validatedArtifact: SemanticAnalysisArtifact,
    mappedArtifact: SemanticAnalysisArtifactMappingResult,
    analysisRunId?: string
  ): Prisma.SemanticAnalysisUncheckedCreateInput {
    return {
      credentialId,
      ...(analysisRunId ? { analysisRunId } : {}),
      schemaVersion: mappedArtifact.schemaVersion,
      status: mappedArtifact.status,
      pipelineVersion: mappedArtifact.pipelineVersion,
      taxonomyVersion: mappedArtifact.taxonomyVersion,
      analyzedAt: new Date(),
      confidence:
        typeof mappedArtifact.confidence.global === 'number'
          ? new Prisma.Decimal(mappedArtifact.confidence.global)
          : null,
      areas: mappedArtifact.areas as Prisma.InputJsonValue,
      skills: mappedArtifact.skills as Prisma.InputJsonValue,
      concepts: mappedArtifact.concepts as Prisma.InputJsonValue,
      qualityFlags: mappedArtifact.qualityFlags as Prisma.InputJsonValue,
      evidenceMap: mappedArtifact.evidenceMap as Prisma.InputJsonValue,
      textForEmbedding: mappedArtifact.textForEmbedding,
      analysisJson: this.buildAnalysisJson(
        validatedArtifact,
        mappedArtifact
      ) as unknown as Prisma.InputJsonValue
    };
  }

  private buildAnalysisJson(
    validatedArtifact: SemanticAnalysisArtifact,
    mappedArtifact: SemanticAnalysisArtifactMappingResult
  ) {
    return this.cloneJsonLike({
      schemaVersion: mappedArtifact.metadata.schemaVersion,
      pipelineVersion: mappedArtifact.metadata.pipelineVersion,
      taxonomyVersion: mappedArtifact.metadata.taxonomyVersion,
      sourceType: mappedArtifact.metadata.sourceType,
      sourceRefs: mappedArtifact.metadata.sourceRefs,
      hoursDistribution: mappedArtifact.metadata.hoursDistribution,
      confidence: mappedArtifact.confidence,
      qualityFlags: mappedArtifact.qualityFlags,
      warnings: mappedArtifact.warnings,
      partialReasons: mappedArtifact.partialReasons,
      mapped: mappedArtifact,
      artifact: validatedArtifact
    });
  }

  /**
   * Mapper de allowlist. Construye el objeto campo por campo desde la fila; NO
   * hace spread ni omite claves de un objeto Prisma. Una columna nueva en
   * `SemanticAnalysis` no puede aparecer sola en la respuesta.
   */
  private toLatestSemanticAnalysisResponse(
    semanticAnalysis: LatestSemanticAnalysisRow
  ) {
    return {
      id: semanticAnalysis.id,
      schemaVersion: semanticAnalysis.schemaVersion,
      status: semanticAnalysis.status,
      pipelineVersion: semanticAnalysis.pipelineVersion,
      taxonomyVersion: semanticAnalysis.taxonomyVersion,
      confidence: this.toNullableNumber(semanticAnalysis.confidence),
      areas: this.toArray(semanticAnalysis.areas, 'areas'),
      skills: this.toArray(semanticAnalysis.skills, 'skills'),
      concepts: this.toArray(semanticAnalysis.concepts, 'concepts'),
      qualityFlags: this.toStringArray(
        semanticAnalysis.qualityFlags,
        'qualityFlags'
      ),
      // analysisJson / textForEmbedding / evidenceMap: ver la allowlist del DTO.
      // No se cargan (select) y no se mapean.
      analyzedAt: semanticAnalysis.analyzedAt.toISOString()
    };
  }

  private assertNonEmptyString(
    value: unknown,
    fieldName: string
  ): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} es requerido.`);
    }
  }

  private cloneJsonLike<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number') {
      return value;
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toString' in value &&
      typeof value.toString === 'function'
    ) {
      const parsed = Number.parseFloat(value.toString());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    throw new BadRequestException('confidence almacenado no tiene un formato valido.');
  }

  private toArray(value: unknown, fieldName: string): unknown[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
    }

    return this.cloneJsonLike(value);
  }

  private toStringArray(value: unknown, fieldName: string): string[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
    }

    return value.map((entry) => {
      if (typeof entry !== 'string') {
        throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
      }

      return entry;
    });
  }

  private toObject(value: unknown, fieldName: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} almacenado no tiene un formato valido.`);
    }

    return this.cloneJsonLike(value as Record<string, unknown>);
  }
}
