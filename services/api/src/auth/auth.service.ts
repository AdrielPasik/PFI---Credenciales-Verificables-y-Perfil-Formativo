import {
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthLoginResponseDto } from './dto/auth-login-response.dto';
import { AuthMeResponseDto } from './dto/auth-me-response.dto';
import { LoginDto } from './dto/login.dto';
import { getJwtExpiresIn, getJwtSecretOrThrow } from './jwt-config';
import { type AuthenticatedUser, type JwtPayload } from './auth.types';
import { verifyPasswordHash } from './password-hashing';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService
  ) {}

  async login(dto: LoginDto): Promise<AuthLoginResponseDto> {
    const email = this.normalizeEmail(dto.email);
    const password = this.assertPassword(dto.password);
    const secret = getJwtSecretOrThrow();

    const user = await this.prisma.user.findUnique({
      where: {
        email
      },
      include: {
        authCredential: true
      }
    });

    if (!user || !user.authCredential) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    if (user.status !== UserStatus.active) {
      throw new UnauthorizedException('El usuario no esta activo.');
    }

    const passwordMatches = await verifyPasswordHash(
      password,
      user.authCredential.passwordHash
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id
      } satisfies JwtPayload,
      {
        secret,
        expiresIn: getJwtExpiresIn() as never
      }
    );

    return {
      accessToken,
      user: this.toAuthUserResponse(user)
    };
  }

  async getCurrentUserProfile(userId: string): Promise<AuthMeResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        email: true,
        did: true,
        status: true,
        issuerMemberships: {
          where: {
            status: 'active'
          },
          select: {
            issuerId: true,
            role: true,
            status: true
          }
        }
      }
    });

    if (!user || !user.email) {
      throw new UnauthorizedException('Usuario autenticado no valido.');
    }

    if (user.status !== UserStatus.active) {
      throw new UnauthorizedException('El usuario no esta activo.');
    }

    return {
      id: user.id,
      email: user.email,
      did: user.did,
      status: user.status,
      issuerMemberships: user.issuerMemberships
    };
  }

  async resolveAuthenticatedUser(token: string): Promise<AuthenticatedUser> {
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new UnauthorizedException('Bearer token requerido.');
    }

    const secret = getJwtSecretOrThrow();

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret
      });
    } catch {
      throw new UnauthorizedException('Token invalido o expirado.');
    }

    if (!payload?.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Token invalido o expirado.');
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: payload.sub
      },
      select: {
        id: true,
        email: true,
        did: true,
        status: true
      }
    });

    if (!user || !user.email) {
      throw new UnauthorizedException('Usuario autenticado no valido.');
    }

    if (user.status !== UserStatus.active) {
      throw new UnauthorizedException('El usuario no esta activo.');
    }

    return {
      id: user.id,
      email: user.email,
      did: user.did,
      status: user.status
    };
  }

  private normalizeEmail(value: unknown) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new UnauthorizedException('email y password son requeridos.');
    }

    return value.trim().toLowerCase();
  }

  private assertPassword(value: unknown) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new UnauthorizedException('email y password son requeridos.');
    }

    return value;
  }

  private toAuthUserResponse(user: {
    id: string;
    email: string | null;
    did: string | null;
    status: UserStatus;
  }) {
    if (!user.email) {
      throw new UnauthorizedException('Usuario autenticado no valido.');
    }

    return {
      id: user.id,
      email: user.email,
      did: user.did,
      status: user.status
    };
  }
}
