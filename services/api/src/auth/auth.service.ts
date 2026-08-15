import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IssuerMembershipStatus, Prisma, UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuthLoginResponseDto } from './dto/auth-login-response.dto';
import { AuthMeResponseDto } from './dto/auth-me-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { getJwtExpiresIn, getJwtSecretOrThrow } from './jwt-config';
import { type AuthenticatedUser, type JwtPayload } from './auth.types';
import { hashPassword, verifyPasswordHash } from './password-hashing';

// A1: mismo patron de regex ya usado en issuer-holder-resolution.service.ts
// y analysis-run-backfill.service.ts (repo no centraliza esta constante).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A1: politica minima (seccion 10 del diseno) -- sin reglas de complejidad
// inventadas (mayuscula/simbolo/numero). 8 es un piso razonable, 128 evita
// inputs abusivos sin limitar casos de uso reales.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const EMAIL_ALREADY_REGISTERED_MESSAGE =
  'Ya existe una cuenta con ese correo.';
// Codigo Prisma de violacion de unique constraint -- en el create() de
// User de este metodo, la unica constraint que puede dispararlo en la
// carrera de dos registros concurrentes es User.email.
const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

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

  // A1: crea unicamente User + AuthCredential (nunca Issuer,
  // IssuerMembership, Credential, FormativeProfile ni ningun otro dato) --
  // registro publico nunca es onboarding institucional. Devuelve
  // EXACTAMENTE el mismo shape que login (AuthLoginResponseDto) y firma el
  // JWT con la misma funcion/parametros -- nunca un segundo mecanismo de
  // sesion. did queda null: seccion "Pregunta critica: User.did" del
  // diseno -- el unico requisito real de DID en el repo es al EMITIR una
  // Credential (CredentialsService.issue), nunca al crear el draft ni al
  // registrarse; no existe ningun mecanismo canonico de provisioning (los
  // DID actuales son literales hardcodeados en seeds), asi que A1
  // deliberadamente NO inventa uno. Ver auth-and-permissions-v0.md.
  async register(dto: RegisterDto): Promise<AuthLoginResponseDto> {
    const email = this.normalizeAndValidateRegistrationEmail(dto.email);
    const password = this.assertValidRegistrationPassword(dto.password);
    const secret = getJwtSecretOrThrow();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existing) {
      throw new ConflictException(EMAIL_ALREADY_REGISTERED_MESSAGE);
    }

    const passwordHash = await hashPassword(password);

    let user: { id: string; email: string | null; did: string | null; status: UserStatus };

    try {
      user = await this.prisma.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: {
            email,
            status: UserStatus.active
          },
          select: {
            id: true,
            email: true,
            did: true,
            status: true
          }
        });

        await transaction.authCredential.create({
          data: {
            userId: createdUser.id,
            passwordHash
          }
        });

        return createdUser;
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(EMAIL_ALREADY_REGISTERED_MESSAGE);
      }

      throw error;
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
            status: IssuerMembershipStatus.active
          },
          select: {
            issuerId: true,
            role: true,
            status: true,
            issuer: {
              select: {
                name: true,
                did: true,
                authorizationStatus: true
              }
            }
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

    const issuerMemberships = user.issuerMemberships
      .map((membership) => ({
        issuerId: membership.issuerId,
        issuerName: membership.issuer.name,
        issuerDid: membership.issuer.did,
        issuerAuthorizationStatus: membership.issuer.authorizationStatus,
        role: membership.role,
        status: membership.status
      }))
      .sort((left, right) => {
        if (left.issuerName < right.issuerName) {
          return -1;
        }

        if (left.issuerName > right.issuerName) {
          return 1;
        }

        if (left.issuerId < right.issuerId) {
          return -1;
        }

        return left.issuerId > right.issuerId ? 1 : 0;
      });

    return {
      id: user.id,
      email: user.email,
      did: user.did,
      status: user.status,
      issuerMemberships
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

  // A1: misma normalizacion que login (trim + lowercase, ver
  // normalizeEmail arriba) MAS validacion de formato -- login nunca valida
  // formato (un email invalido simplemente no matchea ningun usuario);
  // register si necesita rechazar un email con forma invalida antes de
  // crear la cuenta. Nunca dos reglas de normalizacion distintas: el
  // trim+lowercase es identico al de login.
  private normalizeAndValidateRegistrationEmail(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('email es requerido.');
    }

    const normalized = value.trim().toLowerCase();

    if (!normalized || !EMAIL_PATTERN.test(normalized)) {
      throw new BadRequestException('email debe tener un formato valido.');
    }

    return normalized;
  }

  private assertValidRegistrationPassword(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('password es requerido.');
    }

    if (
      value.length < MIN_PASSWORD_LENGTH ||
      value.length > MAX_PASSWORD_LENGTH
    ) {
      throw new BadRequestException(
        `password debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`
      );
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

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_ERROR_CODE
  );
}
