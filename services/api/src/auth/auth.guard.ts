import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';

import { type AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    request.user = await this.authService.resolveAuthenticatedUser(token);
    return true;
  }

  private extractBearerToken(authorizationHeader: string | undefined) {
    if (!authorizationHeader) {
      throw new UnauthorizedException('Bearer token requerido.');
    }

    const [scheme, token] = authorizationHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Bearer token requerido.');
    }

    return token;
  }
}
