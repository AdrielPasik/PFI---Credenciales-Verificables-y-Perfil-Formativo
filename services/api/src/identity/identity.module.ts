import { Module } from '@nestjs/common';

import { DidController } from './did.controller';

@Module({
  controllers: [DidController]
})
export class IdentityModule {}
