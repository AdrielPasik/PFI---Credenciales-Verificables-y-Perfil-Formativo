import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthLoginResponseDto } from './dto/auth-login-response.dto';
import { AuthMeResponseDto } from './dto/auth-me-response.dto';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from './auth.guard';
import { type AuthenticatedUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthLoginResponseDto> {
    return this.authService.login(dto);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  getCurrentUser(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<AuthMeResponseDto> {
    return this.authService.getCurrentUserProfile(currentUser.id);
  }
}
