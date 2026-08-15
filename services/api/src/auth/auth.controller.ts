import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthLoginResponseDto } from './dto/auth-login-response.dto';
import { AuthMeResponseDto } from './dto/auth-me-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthGuard } from './auth.guard';
import { type AuthenticatedUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthLoginResponseDto> {
    return this.authService.login(dto);
  }

  // A1: publico a proposito -- NO lleva @UseGuards(AuthGuard). Crea
  // unicamente un User + AuthCredential (nunca Issuer/IssuerMembership) y
  // devuelve el mismo shape que login para auto-login inmediato.
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<AuthLoginResponseDto> {
    return this.authService.register(dto);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  getCurrentUser(
    @CurrentUser() currentUser: AuthenticatedUser
  ): Promise<AuthMeResponseDto> {
    return this.authService.getCurrentUserProfile(currentUser.id);
  }
}
