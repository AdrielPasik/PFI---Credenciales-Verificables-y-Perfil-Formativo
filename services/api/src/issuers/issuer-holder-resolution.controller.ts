import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { HolderSummaryResponseDto } from './dto/holder-summary-response.dto';
import { ResolveHolderDto } from './dto/resolve-holder.dto';
import { IssuerHolderResolutionService } from './issuer-holder-resolution.service';

@Controller('issuers/:issuerId/holders')
export class IssuerHolderResolutionController {
  constructor(
    private readonly holderResolutionService: IssuerHolderResolutionService
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  resolveHolder(
    @Param('issuerId') issuerId: string,
    @Body() dto: ResolveHolderDto,
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<HolderSummaryResponseDto> {
    return this.holderResolutionService.resolveHolder(
      issuerId,
      dto?.email,
      currentUser
    );
  }
}
