import { Module } from '@nestjs/common';

import { BlockchainEvidenceService } from './blockchain-evidence.service';

@Module({
  providers: [BlockchainEvidenceService],
  exports: [BlockchainEvidenceService]
})
export class BlockchainModule {}
