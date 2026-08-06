import { Injectable, NotFoundException } from '@nestjs/common';

import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { IssuerAnalysisRunStatusResponseDto } from './dto/issuer-analysis-run-status-response.dto';
import {
  issuerAnalysisRunReadSelect,
  mapIssuerAnalysisRunReadModel
} from './issuer-analysis-run-read.mapper';

const CREDENTIAL_NOT_FOUND_MESSAGE = 'No se encontro la credencial solicitada.';
const RUN_NOT_FOUND_MESSAGE = 'No se encontro el analisis solicitado.';

@Injectable()
export class IssuerAnalysisRunReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService
  ) {}

  async getLatestForCredential(
    issuerId: string,
    credentialId: string,
    userId: string
  ): Promise<IssuerAnalysisRunStatusResponseDto | null> {
    const credential = await this.assertReadScope(
      issuerId,
      credentialId,
      userId
    );
    const run = await this.prisma.analysisRun.findFirst({
      where: { credentialId: credential.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: issuerAnalysisRunReadSelect
    });
    return run ? mapIssuerAnalysisRunReadModel(run) : null;
  }

  async getById(
    issuerId: string,
    credentialId: string,
    analysisRunId: string,
    userId: string
  ): Promise<IssuerAnalysisRunStatusResponseDto> {
    const credential = await this.assertReadScope(
      issuerId,
      credentialId,
      userId
    );
    const run = await this.prisma.analysisRun.findFirst({
      where: { id: analysisRunId, credentialId: credential.id },
      select: issuerAnalysisRunReadSelect
    });
    if (!run) throw new NotFoundException(RUN_NOT_FOUND_MESSAGE);
    return mapIssuerAnalysisRunReadModel(run);
  }

  private async assertReadScope(
    issuerId: string,
    credentialId: string,
    userId: string
  ): Promise<{ id: string }> {
    await this.issuersService.assertUserCanReadCredentialsForIssuer(
      userId,
      issuerId
    );
    const credential = await this.prisma.credential.findFirst({
      where: { id: credentialId, issuerId },
      select: { id: true }
    });
    if (!credential) {
      throw new NotFoundException(CREDENTIAL_NOT_FOUND_MESSAGE);
    }
    return credential;
  }
}
