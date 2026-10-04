import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  IssuerMembershipStatus,
  Prisma,
  UserOnboardingIntent,
  UserStatus
} from '@prisma/client';

import { ensureDidForUser } from '../identity/ensure-did-for-user';
import { buildHolderDisplayLabel } from '../issuers/holder-display-label';
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
// A1.1: solo longitud maxima razonable -- nunca restriccion de charset
// (nombres como "José", "María José", "O'Connor", "Jean-Pierre" deben
// poder representarse tal cual).
const MAX_NAME_LENGTH = 100;
const EMAIL_ALREADY_REGISTERED_MESSAGE =
  'Ya existe una cuenta con ese correo.';
// Codigo Prisma de violacion de unique constraint -- en el create() de
// User de este metodo, la unica constraint que puede dispararlo en la
// carrera de dos registros concurrentes es User.email.
const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

// O1: valores aceptados para la intencion de onboarding. Allowlist explicita
// contra el enum real de Prisma -- nunca un cast ciego del string del cliente.
// SIN trim y SIN lowercase a proposito: un enum no es texto libre, asi que
// "PERSONAL" o " personal " son valores invalidos y se rechazan con 400 en vez
// de "corregirse" en silencio. El repo no normaliza ningun otro enum de
// request (ver el `parseObjectiveTypeFilter` de objectives.controller.ts, que
// rechaza en vez de adivinar).
const ONBOARDING_INTENTS: readonly UserOnboardingIntent[] = [
  UserOnboardingIntent.personal,
  UserOnboardingIntent.institutional
];

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
  //
  // A1.1: ademas persiste identidad humana (firstName/lastName) en los
  // campos que User YA tenia modelados antes de A1/A1.1 (nunca se agrego
  // columna nueva) -- ver docs/architecture/data-model-v0.md. displayName
  // NUNCA se escribe desde register (queda como venia: solo lo setean
  // seeds/futuras herramientas), asi que buildHolderDisplayLabel combina
  // naturalmente firstName+lastName para toda cuenta creada por A1.1.
  async register(dto: RegisterDto): Promise<AuthLoginResponseDto> {
    const email = this.normalizeAndValidateRegistrationEmail(dto.email);
    const password = this.assertValidRegistrationPassword(dto.password);
    const firstName = this.assertValidRegistrationName(
      dto.firstName,
      'Ingresá tu nombre.',
      `El nombre no puede superar los ${MAX_NAME_LENGTH} caracteres.`
    );
    const lastName = this.assertValidRegistrationName(
      dto.lastName,
      'Ingresá tu apellido.',
      `El apellido no puede superar los ${MAX_NAME_LENGTH} caracteres.`
    );
    const onboardingIntent = this.assertValidOnboardingIntent(
      dto.onboardingIntent
    );
    const secret = getJwtSecretOrThrow();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existing) {
      throw new ConflictException(EMAIL_ALREADY_REGISTERED_MESSAGE);
    }

    const passwordHash = await hashPassword(password);

    let user: {
      id: string;
      email: string | null;
      did: string | null;
      status: UserStatus;
      displayName: string | null;
      firstName: string | null;
      lastName: string | null;
    };

    try {
      user = await this.prisma.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: {
            email,
            status: UserStatus.active,
            firstName,
            lastName,
            // O1: `undefined` hace que Prisma OMITA la columna y la fila quede
            // en NULL por el schema -- nunca se escribe un valor inventado.
            onboardingIntent
          },
          select: {
            id: true,
            email: true,
            did: true,
            status: true,
            displayName: true,
            firstName: true,
            lastName: true
          }
        });

        await transaction.authCredential.create({
          data: {
            userId: createdUser.id,
            passwordHash
          }
        });

        // A2.1: provisioning automatico y atomico dentro de la misma
        // transaccion -- si PUBLIC_DID_BASE_URL esta configurada, el
        // holder queda con did:web listo para recibir una Credential sin
        // necesidad de conocer/operar su DID. Si no esta configurada,
        // ensureDidForUser devuelve null y el registro sigue funcionando
        // con did=null exactamente como en A1/A1.1 -- nunca un DID
        // inventado. Ver ensure-did-for-user.ts.
        const did = await ensureDidForUser(transaction, createdUser.id);

        return { ...createdUser, did };
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
        displayName: true,
        firstName: true,
        lastName: true,
        // O1: intencion de onboarding, tal cual esta en la fila (incluido
        // NULL para cuentas creadas antes de que Scope lo preguntara).
        onboardingIntent: true,
        // S3: presencia/ausencia de la capacidad de plataforma, nada mas. Se
        // pide solo el `id` para no traer `grantedAt` ni el objeto a una
        // superficie que lo unico que expone es un booleano. Es una LECTURA:
        // `src/` sigue sin ningun writer de PlatformAdmin (ver
        // platform-admin/__guards__/platform-admin-write-surface.test.ts).
        platformAdmin: {
          select: {
            id: true
          }
        },
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
      displayLabel: buildHolderDisplayLabel(
        user.displayName,
        user.firstName,
        user.lastName,
        user.email
      ),
      // O1: se proyecta TAL CUAL, sin default ni coercion. `null` significa
      // "esta cuenta se creo antes de que Scope preguntara esto" y el router
      // lo trata igual que `personal` (espacio personal), pero el dato
      // conserva la distincion.
      onboardingIntent: user.onboardingIntent,
      // `Boolean(...)` y no `!== null` a proposito: FAIL-CLOSED. Si la
      // relacion no viene en el payload (un double de test que no la declara,
      // una proyeccion futura que la omita), `undefined !== null` seria `true`
      // y la sesion se anunciaria como platform admin sin que exista la fila.
      // Con `Boolean(...)`, tanto `null` como `undefined` dan `false`.
      platformAdmin: Boolean(user.platformAdmin),
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

  // A1.1: unicamente string no vacio (tras trim + colapso de espacios) y
  // longitud maxima -- nunca charset restringido. "José", "María José",
  // "O'Connor", "Jean-Pierre" deben validar sin problema.
  private assertValidRegistrationName(
    value: unknown,
    emptyMessage: string,
    tooLongMessage: string
  ): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(emptyMessage);
    }

    const normalized = value.trim().replace(/\s+/g, ' ');

    if (!normalized) {
      throw new BadRequestException(emptyMessage);
    }

    if (normalized.length > MAX_NAME_LENGTH) {
      throw new BadRequestException(tooLongMessage);
    }

    return normalized;
  }

  // O1: ausente/undefined -> `undefined`, que Prisma omite y deja la columna
  // en NULL. Presente -> tiene que ser EXACTAMENTE uno de los dos valores del
  // enum. Nunca se normaliza (sin trim, sin lowercase): un enum no es texto
  // libre, y "corregir" "PERSONAL" en silencio escondería un bug del cliente.
  // Nunca se asume `personal` por defecto: eso afirmaria una eleccion que la
  // persona no hizo.
  //
  // `null` explicito se acepta como "no contesto", igual que la ausencia: un
  // cliente que serializa su estado puede mandar `null` de forma legitima.
  private assertValidOnboardingIntent(
    value: unknown
  ): UserOnboardingIntent | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !(ONBOARDING_INTENTS as readonly string[]).includes(value)
    ) {
      throw new BadRequestException(
        `onboardingIntent debe ser uno de: ${ONBOARDING_INTENTS.join(', ')}.`
      );
    }

    return value as UserOnboardingIntent;
  }

  private toAuthUserResponse(user: {
    id: string;
    email: string | null;
    did: string | null;
    status: UserStatus;
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
  }) {
    if (!user.email) {
      throw new UnauthorizedException('Usuario autenticado no valido.');
    }

    return {
      id: user.id,
      email: user.email,
      did: user.did,
      status: user.status,
      displayLabel: buildHolderDisplayLabel(
        user.displayName,
        user.firstName,
        user.lastName,
        user.email
      )
    };
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_ERROR_CODE
  );
}
