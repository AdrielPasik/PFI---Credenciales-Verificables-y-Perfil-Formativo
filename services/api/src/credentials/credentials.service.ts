import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  CourseStatus,
  CredentialSourceType,
  CredentialType,
  CredentialStatus,
  CurriculumVersionStatus,
  ProgramStatus,
  Prisma,
  UserStatus
} from '@prisma/client';

import { BlockchainEvidenceService } from '../blockchain/blockchain-evidence.service';
import { isCredentialRegistryTarget } from '../blockchain/blockchain-target';
import {
  type AnchorIntentSnapshot,
  BlockchainRegistrationService,
  type PreparedAnchorSigner
} from '../blockchain/blockchain-registration.service';
import { ensureDidForUser } from '../identity/ensure-did-for-user';
import { IssuersService } from '../issuers/issuers.service';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthenticatedUser } from '../auth/auth.types';
import { SignerResolutionError } from '../signing/signer-resolution.error';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialProofError } from './credential-proof.error';
import {
  CredentialProofService,
  type PreparedAssertionSigner
} from './credential-proof.service';
import { type ScopeProofV1 } from './scope-proof-v1';
import {
  type AcademicCurriculumSelection,
  validateCreateCredentialDraftCurricularSelection
} from './create-credential-draft.validator';
import { normalizeCredentialSubjectControlledArrays } from './issuer-credential-draft-update.validator';
import { CreateCredentialDraftDto } from './dto/create-credential-draft.dto';
import { CredentialStatusResponseDto } from './dto/credential-status-response.dto';
import { CredentialSummaryResponseDto } from './dto/credential-summary-response.dto';
import { IssueCredentialDto } from './dto/issue-credential.dto';

const UADE_ISSUER_DID = 'did:example:issuer-demo';
/**
 * Forma del artifact que produce una emision AUTENTICADA. S8c4 hace el cutover
 * en la TRANSICION a emitida, no en el default de la base: un borrador y una
 * fila legacy siguen siendo `credential_v1`, porque no tienen proof y declarar
 * `credential_v2` sin proof es justamente lo que el contrato prohibe.
 */
const CREDENTIAL_SCHEMA_VERSION_V2 = 'credential_v2';
const SIGNING_IDENTITY_NOT_READY_MESSAGE =
  'La identidad de firma del emisor no esta lista para emitir.';
const SIGNING_TEMPORARILY_UNAVAILABLE_MESSAGE =
  'El servicio de firma del emisor no esta disponible temporalmente. Intentelo nuevamente.';
const PROOF_CONSTRUCTION_FAILED_MESSAGE =
  'No se pudo generar la prueba de autoria de la credencial.';
const ACADEMIC_CREDENTIAL_TYPES = new Set<CredentialType>([
  CredentialType.academic_subject,
  CredentialType.degree
]);

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issuersService: IssuersService,
    private readonly blockchainEvidenceService: BlockchainEvidenceService,
    private readonly credentialHashingService: CredentialHashingService,
    private readonly credentialProofService: CredentialProofService,
    private readonly blockchainRegistrationService: BlockchainRegistrationService
  ) {}

  async createDraft(
    dto: CreateCredentialDraftDto,
    currentUser: AuthenticatedUser
  ): Promise<CredentialSummaryResponseDto> {
    this.assertAuthenticatedUser(currentUser);
    this.assertNonEmptyString(dto.issuerId, 'issuerId');

    await this.issuersService.assertUserCanCreateDraftForIssuer(
      currentUser.id,
      dto.issuerId
    );

    const curricularSelection =
      validateCreateCredentialDraftCurricularSelection(dto);
    this.assertNonEmptyString(dto.subjectUserId, 'subjectUserId');
    this.assertNonEmptyString(dto.type, 'type');
    this.assertNonEmptyString(dto.sourceType, 'sourceType');
    this.assertEnumValue(CredentialType, dto.type, 'type');
    this.assertEnumValue(CredentialSourceType, dto.sourceType, 'sourceType');
    this.assertOptionalJsonObject(dto.metadata, 'metadata');
    this.assertOptionalJsonObject(dto.rawData, 'rawData');

    const issuer = await this.prisma.issuer.findUnique({
      where: { id: dto.issuerId },
      select: { did: true }
    });

    if (!issuer) {
      throw new NotFoundException('No se encontro el emisor solicitado.');
    }

    if (
      issuer.did !== UADE_ISSUER_DID &&
      ACADEMIC_CREDENTIAL_TYPES.has(dto.type)
    ) {
      throw new BadRequestException(
        'Este emisor no puede crear credenciales académicas.'
      );
    }

    const manualTitle = curricularSelection
      ? null
      : this.requireNonEmptyString(dto.title, 'title');
    const inputCredentialSubject = curricularSelection
      ? null
      : normalizeCredentialSubjectControlledArrays(
          this.stripPlatformNameForCourse(
            dto.type,
            this.assertJsonObject(dto.credentialSubject, 'credentialSubject')
          )
        );

    const credential = await this.prisma.$transaction(
      async (transaction) => {
        await this.getSubjectUserOrThrow(transaction, dto.subjectUserId);

        const selectedCourse = curricularSelection
          ? await this.getCurricularAcademicCourseOrThrow(
              transaction,
              dto.issuerId,
              curricularSelection
            )
          : null;
        const credentialSubject = selectedCourse
          ? {
              achievement_name: selectedCourse.name,
              institution_name: selectedCourse.issuerName,
              program_name: selectedCourse.programName
            }
          : inputCredentialSubject!;

        return transaction.credential.create({
          data: {
            issuerId: dto.issuerId,
            subjectUserId: dto.subjectUserId,
            type: dto.type,
            title: selectedCourse?.name ?? manualTitle!,
            description: selectedCourse
              ? selectedCourse.description
              : this.normalizeNullableString(dto.description),
            sourceType: dto.sourceType,
            hours: selectedCourse
              ? selectedCourse.hours
              : this.toPrismaDecimal(dto.hours, 'hours'),
            academicCourseId: selectedCourse?.academicCourseId,
            programCourseId: selectedCourse?.programCourseId,
            externalCourseId: selectedCourse
              ? undefined
              : dto.externalCourseId,
            credentialSubject: credentialSubject as Prisma.InputJsonValue,
            metadata: selectedCourse
              ? undefined
              : this.toOptionalJson(dto.metadata),
            rawData: selectedCourse
              ? undefined
              : this.toOptionalJson(dto.rawData),
            status: CredentialStatus.draft
          },
          include: {
            blockchainRecords: {
              orderBy: {
                registeredAt: 'desc'
              },
              take: 1
            }
          }
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      }
    );

    return this.toCredentialSummaryResponse(credential);
  }

  private async getCurricularAcademicCourseOrThrow(
    transaction: Prisma.TransactionClient,
    issuerId: string,
    selection: AcademicCurriculumSelection
  ) {
    const programCourse = await transaction.programCourse.findFirst({
      where: {
        academicCourseId: selection.academicCourseReference,
        curriculumVersionId: selection.curriculumReference,
        academicCourse: {
          issuerId,
          status: CourseStatus.active
        },
        curriculumVersion: {
          status: CurriculumVersionStatus.active,
          program: {
            issuerId,
            status: ProgramStatus.active
          }
        }
      },
      select: {
        id: true,
        academicCourse: {
          select: {
            id: true,
            name: true,
            description: true,
            hours: true,
            issuer: {
              select: {
                name: true
              }
            }
          }
        },
        curriculumVersion: {
          select: {
            program: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });

    if (!programCourse) {
      throw new NotFoundException(
        'No se encontro una asignatura activa dentro de la curricula solicitada.'
      );
    }

    return {
      academicCourseId: programCourse.academicCourse.id,
      programCourseId: programCourse.id,
      name: programCourse.academicCourse.name,
      description: programCourse.academicCourse.description,
      hours: programCourse.academicCourse.hours,
      issuerName: programCourse.academicCourse.issuer.name,
      programName: programCourse.curriculumVersion.program.name
    };
  }

  async issueCredential(
    credentialId: string,
    dto: IssueCredentialDto,
    currentUser: AuthenticatedUser
  ): Promise<CredentialSummaryResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');
    this.assertNonEmptyString(dto.issuerId, 'issuerId');
    this.assertAuthenticatedUser(currentUser);

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        issuer: true
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    if (credential.status !== CredentialStatus.draft) {
      throw new ConflictException(
        `La credencial ${credentialId} no esta en estado draft.`
      );
    }

    if (credential.issuerId !== dto.issuerId) {
      throw new BadRequestException(
        `El issuerId del request no coincide con el issuer real de la credencial ${credentialId}.`
      );
    }

    await this.issuersService.assertUserCanIssueForIssuer(
      currentUser.id,
      credential.issuerId
    );
    this.issuersService.assertIssuerCanIssue(credential.issuer);

    // A2.1: provisioning perezoso -- recien se intenta DESPUES de superar
    // autenticacion/autorizacion/estado del issuer, nunca antes (una
    // emision que de todos modos iba a ser rechazada nunca debe tener el
    // side effect de tocar User.did). Si el holder ya tiene DID,
    // ensureDidForUser lo devuelve sin escribir nada (write-once). Se usa
    // EXACTAMENTE el valor devuelto para canonicalization -- nunca
    // credential.subjectUser.did, que pudo haber sido leido ANTES de que
    // el provisioning escribiera en la base (stale read).
    const subjectDid = await ensureDidForUser(
      this.prisma,
      credential.subjectUserId
    );

    if (!subjectDid) {
      throw new BadRequestException(
        `El titular ${credential.subjectUserId} no tiene DID configurado.`
      );
    }

    const issuedAt = this.normalizeIssuedAtToSecond(
      dto.issuedAt ? this.parseIssuedAt(dto.issuedAt) : new Date()
    );
    const credentialSubject = this.assertJsonObject(
      credential.credentialSubject,
      'credential.credentialSubject'
    );

    this.assertRequiredCredentialSubjectFields(credentialSubject);

    // IDENTIDAD TECNICA: el `issuer_did` de un artifact credential_v2 sale de
    // `IssuerTechnicalIdentity.did`, NUNCA del `Issuer.did` legacy, de
    // `walletAddress`, de la cuenta de anclaje ni del DID del titular.
    //
    // El DID ALMACENADO es la unica autoridad: no se recalcula contra la
    // configuracion actual (`PUBLIC_DID_BASE_URL` pudo cambiar desde el
    // aprovisionamiento) y no se resuelve por HTTP contra el endpoint publico.
    const technicalIdentity =
      await this.prisma.issuerTechnicalIdentity.findUnique({
        where: { issuerId: credential.issuerId },
        select: { did: true }
      });

    // RESOLUCION DEL SIGNER -- FUERA de toda transaccion interactiva.
    //
    // `IssuerSignerResolver` puede hacer una lectura de SSM en un miss de
    // cache. Esa latencia de red no puede entrar en la transaccion de
    // persistencia, que en el camino legacy real todavia abarca la escritura
    // on-chain. Tambien se valida primero el contrato de DID de S8c3, asi que
    // un DID inconsistente falla cerrado sin tocar el almacen de secretos.
    //
    // Llega DESPUES de autenticacion, autorizacion de membership, elegibilidad
    // del issuer y estado draft: un pedido que de todos modos iba a ser
    // rechazado nunca llega a resolver un signer ni a leer un secreto.
    let preparedSigner: PreparedAssertionSigner;
    try {
      preparedSigner = await this.credentialProofService.prepareAssertionSigner({
        issuerId: credential.issuerId,
        issuerDid: technicalIdentity?.did,
        credentialId: credential.id
      });
    } catch (error) {
      this.throwMappedSigningFailure(error);
    }

    // TARGET DE BLOCKCHAIN: se resuelve UNA sola vez, localmente, y decide la
    // FORMA del ciclo de vida. Un modo real mal configurado falla cerrado aca,
    // antes de TX #1 y antes de tocar cualquier almacen de secretos.
    const blockchainTarget = this.blockchainEvidenceService.resolveTarget();
    const registryTarget = isCredentialRegistryTarget(blockchainTarget)
      ? blockchainTarget
      : null;

    // SIGNER DE ANCLAJE -- solo en modo real, y FUERA de toda transaccion.
    //
    // Puede leer SSM en un miss de cache. En modo mock no se resuelve nada: no
    // hay cadena, no hay nonce y no hay cola, asi que exigirle al emisor una
    // identidad de anclaje para una evidencia simulada seria inventar un
    // requisito.
    //
    // Si el emisor no tiene una identidad de anclaje utilizable, la emision
    // falla ANTES de TX #1: no se fabrica un intent pendiente sin procedencia
    // de anclaje veraz.
    let preparedAnchor: PreparedAnchorSigner | null = null;
    if (registryTarget) {
      try {
        preparedAnchor = await this.blockchainRegistrationService.prepareAnchorSigner(
          credential.issuerId
        );
      } catch (error) {
        this.throwMappedSigningFailure(error);
      }
    }

    // =======================================================================
    // TX #1 -- CORTA Y SIN RED
    //
    // Deja durables, juntas: la credencial emitida y autenticada, y -- en modo
    // real -- el intent PENDING de registracion. Adentro no hay SSM, ni RPC,
    // ni provider, ni getNetwork, ni getCode, ni contrato, ni wait, ni
    // receipt, ni getBlock. Lo unico criptografico es computo LOCAL: el hash
    // canonico y `signMessage` sobre una Wallet desconectada.
    //
    // Isolation SERIALIZABLE en modo real: la revalidacion del binding de
    // anclaje y el conteo de cardinalidad que deriva `anchorRegistrantScope`
    // tienen que ver el MISMO snapshot, o la procedencia historica que se
    // persiste no seria veraz.
    // =======================================================================
    const result = await this.prisma.$transaction(
      async (transaction) => {
        // SNAPSHOT FINAL. Se relee la fila DENTRO de la transaccion para que lo
        // canonicalizado, lo firmado y lo persistido sean el MISMO estado:
        // entre la lectura inicial y este punto se resolvieron signers que
        // pudieron ir a la red.
        //
        // `Credential.id` ya es estable -- la emision parte de un borrador que
        // existe -- asi que `credential_id` entra en canon_v2 sin inventar nada
        // y sin que Prisma pueda generar despues otro id.
        const finalRow = await transaction.credential.findUnique({
          where: { id: credential.id },
          select: {
            id: true,
            status: true,
            updatedAt: true,
            type: true,
            title: true,
            description: true,
            hours: true,
            credentialSubject: true
          }
        });

        if (!finalRow) {
          throw new NotFoundException(`Credential ${credentialId} no existe.`);
        }

        if (finalRow.status !== CredentialStatus.draft) {
          throw new ConflictException(
            `La credencial ${credentialId} no esta en estado draft.`
          );
        }

        // REVALIDACION DEL BINDING DE ASERCION -- S8c8, y SIEMPRE, en los dos
        // modos de evidencia: la autoria de la credential no depende de la
        // blockchain.
        //
        // Desde que existe la rotacion, haber resuelto el signer antes de abrir
        // la transaccion no alcanza: si una rotacion commiteo mientras esta
        // emision estaba en vuelo, firmar con la clave vieja produciria una
        // credential emitida por una autoridad que el emisor ya habia dejado de
        // elegir. Se vuelve a leer el puntero vigente, con metadata publica
        // unicamente, y si cambio se aborta ANTES de que la credential quede
        // `issued`.
        await this.credentialProofService.revalidateAssertionBinding(
          transaction,
          {
            issuerId: credential.issuerId,
            signer: preparedSigner
          }
        );

        // REVALIDACION DEL BINDING DE ANCLAJE, con metadata PUBLICA unicamente.
        // Entre la resolucion del signer y este punto pudo haber una rotacion;
        // persistir un intent para un perfil que ya no es el ancla configurada
        // del emisor seria persistir procedencia falsa.
        let anchorIntent: AnchorIntentSnapshot | null = null;
        if (registryTarget && preparedAnchor) {
          await this.blockchainRegistrationService.revalidateAnchorBinding(
            transaction,
            {
              issuerId: credential.issuerId,
              signer: preparedAnchor.snapshot
            }
          );

          anchorIntent = {
            anchorSignerProfileId: preparedAnchor.snapshot.profileId,
            anchorRegistrantScope:
              await this.blockchainRegistrationService.deriveAnchorRegistrantScope(
                transaction,
                preparedAnchor.snapshot.profileId
              )
          };
        }

        const finalCredentialSubject = this.assertJsonObject(
          finalRow.credentialSubject,
          'credential.credentialSubject'
        );
        this.assertRequiredCredentialSubjectFields(finalCredentialSubject);

        // UN SOLO canonicalHash para esta emision. Este valor es el que se
        // persiste, el que se embebe en el envelope firmado y el que recibe la
        // evidencia de blockchain. No se vuelve a calcular en ningun otro lado.
        const hashResult =
          this.credentialHashingService.createCanonicalHashForVersion(
            {
              credentialId: finalRow.id,
              schemaVersion: CREDENTIAL_SCHEMA_VERSION_V2,
              type: finalRow.type,
              issuerDid: preparedSigner.issuerDid,
              subjectDid,
              title: finalRow.title,
              description: finalRow.description,
              issuedAt,
              hours: finalRow.hours,
              credentialSubject: finalCredentialSubject
            },
            CredentialHashingService.CANONICALIZATION_VERSION_V2
          );

        // FIRMA: computo LOCAL. `signMessage` sobre una Wallet desconectada no
        // hace I/O, asi que no agrega latencia de red a la transaccion.
        let proof: ScopeProofV1;
        try {
          proof = await this.credentialProofService.createProof(
            preparedSigner,
            hashResult.canonicalHash,
            finalRow.id
          );
        } catch (error) {
          this.throwMappedSigningFailure(error);
        }

        // PERSISTENCIA ATOMICA de los campos de autenticidad: estado, forma del
        // artifact, version de canonicalizacion, hash y proof viajan en UNA sola
        // mutacion. No existe un estado intermedio `credential_v2` sin proof, ni
        // `proof` con canon_v1, ni hash v2 etiquetado como v1.
        //
        // El `where` extendido actua como token de version optimista: si otra
        // operacion toco la fila despues del snapshot, no hay fila que coincida
        // y la transaccion entera se revierte -- nunca se persiste una firma
        // sobre un payload distinto del guardado.
        const updatedCredential = await transaction.credential.update({
          where: {
            id: finalRow.id,
            status: CredentialStatus.draft,
            updatedAt: finalRow.updatedAt
          },
          data: {
            status: CredentialStatus.issued,
            issuedAt,
            schemaVersion: CREDENTIAL_SCHEMA_VERSION_V2,
            canonicalHash: hashResult.canonicalHash,
            canonicalizationVersion: hashResult.canonicalizationVersion,
            proof: proof as unknown as Prisma.InputJsonValue
          }
        });

        // EVIDENCIA DE BLOCKCHAIN -- despues del proof, nunca antes: no se
        // ancla una credencial que no logro obtener su autoria criptografica.
        //
        // Las dos ramas reciben el hash YA calculado, asi que no puede
        // divergir ni etiquetarse con otra version de canonicalizacion.
        const blockchainRecord =
          registryTarget && anchorIntent
            ? // REAL: intent PENDING durable. Los tres hechos de la cadena
              // -- txHash, registrante observado y fecha del bloque -- quedan
              // en NULL hasta que se observen.
              await this.blockchainRegistrationService.createPendingIntent(
                transaction,
                {
                  credentialId: updatedCredential.id,
                  credentialHash: hashResult.canonicalHash,
                  canonicalizationVersion: hashResult.canonicalizationVersion,
                  target: registryTarget,
                  anchor: anchorIntent
                }
              )
            : // MOCK: evidencia local, sin red, en esta misma transaccion.
              await this.blockchainEvidenceService.createRecord(
                transaction,
                {
                  credentialId: updatedCredential.id,
                  credentialHash: hashResult.canonicalHash,
                  canonicalizationVersion: hashResult.canonicalizationVersion,
                  issuerAddress: credential.issuer.walletAddress!
                },
                blockchainTarget
              );

        return {
          updatedCredential,
          blockchainRecord,
          proof,
          canonicalHash: hashResult.canonicalHash
        };
      },
      registryTarget
        ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        : {}
    );

    // =======================================================================
    // DESPUES DE TX #1 -- SIN NINGUNA TRANSACCION ABIERTA
    //
    // A partir de aca la credencial ESTA EMITIDA y su proof es durable. La
    // ejecucion en la cadena es best-effort RESPECTO DE LA EMISION: cualquier
    // fallo deja la credencial emitida y la evidencia en PENDING, recuperable
    // por reconciliacion.
    //
    // No se revierte la credencial a draft, no se borra el proof, no se cambia
    // el hash canonico y no se elimina el intent. Tampoco se reenvia.
    // =======================================================================
    if (registryTarget && preparedAnchor) {
      try {
        await this.blockchainRegistrationService.executeRegistration({
          recordId: result.blockchainRecord.id,
          credentialHash: result.canonicalHash,
          target: registryTarget,
          signer: preparedAnchor.snapshot
        });
      } catch {
        // Silencio DELIBERADO hacia el llamador: la emision tuvo exito y
        // responder un error haria creer que no. El estado durable
        // -- credencial emitida + evidencia PENDING -- ES la respuesta, y es
        // lo que un reconciliador o un operador puede retomar. Tampoco se
        // loguea el error crudo: podria arrastrar el endpoint del RPC.
        void 0;
      }
    }

    // La fila de evidencia se relee para que la respuesta refleje el estado
    // REAL tras el ciclo de vida: `registered` si la cadena confirmo,
    // `pending` si quedo por reconciliar.
    const evidenceRecord =
      (await this.prisma.blockchainRecord.findUnique({
        where: { id: result.blockchainRecord.id }
      })) ?? result.blockchainRecord;

    return this.toCredentialSummaryResponse(
      {
        ...result.updatedCredential,
        blockchainRecords: [evidenceRecord]
      },
      {
        issuerDid: preparedSigner.issuerDid,
        subjectDid,
        proof: result.proof
      }
    );
  }

  /**
   * Mapeo SEGURO de los errores de la pila de firma a la convencion HTTP de la
   * API.
   *
   * Nada del detalle interno cruza el limite: ni `secretRef`, ni el mensaje de
   * AWS, ni la direccion esperada, ni la clave publica registrada, ni el code.
   * Los tres mensajes son literales fijos.
   *
   * Se distinguen operativamente dos situaciones, que es lo que un operador
   * necesita para actuar:
   *
   *   CONFIGURACION  -- la identidad de firma no esta lista (409). Reintentar
   *                     no ayuda; hay que aprovisionar o corregir.
   *   DISPONIBILIDAD -- el almacen de secretos no respondio (503). Reintentar
   *                     puede ayudar.
   *
   * Un desajuste criptografico NO se expone como tal: se reporta como
   * configuracion no lista, igual que un DID ausente.
   */
  private throwMappedSigningFailure(error: unknown): never {
    if (error instanceof SignerResolutionError) {
      if (error.code === 'SIGNER_SECRET_UNAVAILABLE') {
        throw new ServiceUnavailableException(
          SIGNING_TEMPORARILY_UNAVAILABLE_MESSAGE
        );
      }

      throw new ConflictException(SIGNING_IDENTITY_NOT_READY_MESSAGE);
    }

    if (error instanceof CredentialProofError) {
      switch (error.code) {
        case 'ISSUER_DID_NOT_CONFIGURED':
        case 'ISSUER_DID_NOT_RESOLVABLE':
        case 'SIGNER_PURPOSE_NOT_ASSERTION':
        case 'INVALID_KEY_VERSION':
        case 'MALFORMED_VERIFICATION_METHOD':
          throw new ConflictException(SIGNING_IDENTITY_NOT_READY_MESSAGE);
        default:
          throw new InternalServerErrorException(
            PROOF_CONSTRUCTION_FAILED_MESSAGE
          );
      }
    }

    throw error;
  }

  private assertRequiredCredentialSubjectFields(
    credentialSubject: Record<string, unknown>
  ) {
    this.assertCredentialSubjectField(
      credentialSubject,
      ['achievement_name', 'achievementName'],
      'credentialSubject.achievement_name'
    );
    this.assertCredentialSubjectField(
      credentialSubject,
      ['institution_name', 'institutionName'],
      'credentialSubject.institution_name'
    );
  }

  async getCredential(credentialId: string): Promise<CredentialSummaryResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    return this.toCredentialSummaryResponse(credential);
  }

  async getCredentialStatus(
    credentialId: string
  ): Promise<CredentialStatusResponseDto> {
    this.assertNonEmptyString(credentialId, 'credentialId');

    const credential = await this.prisma.credential.findUnique({
      where: {
        id: credentialId
      },
      include: {
        blockchainRecords: {
          orderBy: {
            registeredAt: 'desc'
          },
          take: 1
        }
      }
    });

    if (!credential) {
      throw new NotFoundException(`Credential ${credentialId} no existe.`);
    }

    const latestBlockchainRecord = credential.blockchainRecords[0];

    return {
      id: credential.id,
      status: credential.status,
      issuedAt: credential.issuedAt
        ? this.serializeCanonicalDateTime(credential.issuedAt)
        : undefined,
      revokedAt: credential.revokedAt?.toISOString(),
      canonicalHash: credential.canonicalHash ?? undefined,
      canonicalizationVersion: credential.canonicalizationVersion ?? undefined,
      hasBlockchainRecord: Boolean(latestBlockchainRecord),
      blockchainRecordId: latestBlockchainRecord?.id,
      blockchainStatus: latestBlockchainRecord?.status,
      network: latestBlockchainRecord?.network,
      registeredAt: latestBlockchainRecord?.registeredAt?.toISOString()
    };
  }

  private async getSubjectUserOrThrow(
    transaction: Prisma.TransactionClient,
    subjectUserId: string
  ) {
    const user = await transaction.user.findFirst({
      where: {
        id: subjectUserId,
        status: UserStatus.active
      },
      select: {
        id: true
      }
    });

    if (!user) {
      throw new NotFoundException('No se encontro un titular activo elegible.');
    }

    return user;
  }

  /**
   * `authenticity` llega SOLO desde la emision, que es el unico punto donde el
   * `issuer_did` tecnico y el proof acaban de construirse y por lo tanto se
   * conoce su forma exacta. Un borrador y una lectura comun no lo aportan: no
   * se castea `Credential.proof` de la base a la forma congelada, porque eso
   * seria afirmar una validez que esta slice no verifica (S8c7 es la que
   * verifica proofs).
   */
  private toCredentialSummaryResponse(
    credential: {
      id: string;
      schemaVersion: string;
      issuerId: string;
      subjectUserId: string;
      type: string;
      title: string;
      description: string | null;
      sourceType: string;
      status: string;
      hours:
        | { toFixed?: (fractionDigits?: number) => string; toString: () => string }
        | null;
      academicCourseId: string | null;
      externalCourseId: string | null;
      credentialSubject: Prisma.JsonValue;
      metadata: Prisma.JsonValue | null;
      createdAt: Date;
      updatedAt: Date;
      issuedAt: Date | null;
      canonicalHash: string | null;
      canonicalizationVersion: string | null;
      blockchainRecords?: Array<{
        id: string;
        network: string;
        chainId: number;
        status: string;
        credentialHash: string;
        hashAlgorithm: string;
        canonicalizationVersion: string;
        contractAddress: string;
        // S8c6: nullables mientras la evidencia esta `pending`.
        txHash: string | null;
        issuerAddress: string | null;
        registeredAt: Date | null;
      }>;
    },
    authenticity?: {
      issuerDid: string;
      subjectDid: string;
      proof: ScopeProofV1;
    }
  ): CredentialSummaryResponseDto {
    const latestBlockchainRecord = credential.blockchainRecords?.[0];

    return {
      id: credential.id,
      schemaVersion: credential.schemaVersion,
      issuerId: credential.issuerId,
      subjectUserId: credential.subjectUserId,
      type: credential.type,
      title: credential.title,
      description: credential.description ?? undefined,
      sourceType: credential.sourceType,
      status: credential.status,
      hours: credential.hours ? this.formatHours(credential.hours) : undefined,
      academicCourseId: credential.academicCourseId ?? undefined,
      externalCourseId: credential.externalCourseId ?? undefined,
      credentialSubject: credential.credentialSubject as Record<string, unknown>,
      metadata: (credential.metadata as Record<string, unknown> | null) ?? null,
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString(),
      issuedAt: credential.issuedAt
        ? this.serializeCanonicalDateTime(credential.issuedAt)
        : undefined,
      canonicalHash: credential.canonicalHash ?? undefined,
      canonicalizationVersion: credential.canonicalizationVersion ?? undefined,
      issuerDid: authenticity?.issuerDid,
      subjectDid: authenticity?.subjectDid,
      proof: authenticity?.proof,
      latestBlockchainRecord: latestBlockchainRecord
        ? {
            id: latestBlockchainRecord.id,
            network: latestBlockchainRecord.network,
            chainId: latestBlockchainRecord.chainId,
            status: latestBlockchainRecord.status,
            credentialHash: latestBlockchainRecord.credentialHash,
            hashAlgorithm: latestBlockchainRecord.hashAlgorithm,
            canonicalizationVersion:
              latestBlockchainRecord.canonicalizationVersion,
            contractAddress: latestBlockchainRecord.contractAddress,
            txHash: latestBlockchainRecord.txHash,
            issuerAddress: latestBlockchainRecord.issuerAddress,
            registeredAt:
              latestBlockchainRecord.registeredAt?.toISOString() ?? null
          }
        : undefined
    };
  }

  private assertNonEmptyString(value: unknown, fieldName: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} es requerido.`);
    }
  }

  private requireNonEmptyString(value: unknown, fieldName: string) {
    this.assertNonEmptyString(value, fieldName);
    return value.trim();
  }

  private assertAuthenticatedUser(
    currentUser: AuthenticatedUser | undefined
  ): asserts currentUser is AuthenticatedUser {
    if (!currentUser?.id) {
      throw new ForbiddenException('Usuario autenticado invalido.');
    }
  }

  // C4x fix: `credentialSubject` en createDraft es un JSON crudo sin
  // allowlist por campo (a diferencia del PATCH de borrador, que valida
  // campo por campo). `platformName`/`platform_name` deja de ser un dato
  // libre para `course` -- el emisor activo es la fuente institucional --
  // pero rechazar toda la creacion por esta unica clave seria
  // desproporcionado dado que ningun otro campo se valida en este punto.
  // Se ignora (se descarta) esa clave puntual si llega, en vez de
  // rechazar la creacion completa.
  private stripPlatformNameForCourse(
    type: CredentialType,
    credentialSubject: Record<string, unknown>
  ): Record<string, unknown> {
    if (type !== CredentialType.course || !('platform_name' in credentialSubject)) {
      return credentialSubject;
    }

    const { platform_name: _platformName, ...rest } = credentialSubject;
    return rest;
  }

  private assertJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} debe ser un objeto JSON.`);
    }

    return value as Record<string, unknown>;
  }

  private assertOptionalJsonObject(value: unknown, fieldName: string) {
    if (value === undefined) {
      return;
    }

    this.assertJsonObject(value, fieldName);
  }

  private assertEnumValue<T extends Record<string, string>>(
    enumObject: T,
    value: string,
    fieldName: string
  ) {
    if (!Object.values(enumObject).includes(value)) {
      throw new BadRequestException(`${fieldName} no es un valor valido.`);
    }
  }

  private assertCredentialSubjectField(
    credentialSubject: Record<string, unknown>,
    keys: string[],
    fieldName: string
  ) {
    for (const key of keys) {
      const value = credentialSubject[key];

      if (typeof value === 'string' && value.trim().length > 0) {
        return;
      }
    }

    throw new BadRequestException(`${fieldName} es requerido para emitir.`);
  }

  private toPrismaDecimal(value: unknown, fieldName: string) {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new BadRequestException(`${fieldName} debe ser un numero valido.`);
      }

      if (value <= 0) {
        throw new BadRequestException(`${fieldName} debe ser mayor a 0.`);
      }

      return new Prisma.Decimal(value);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return undefined;
      }

      try {
        const decimal = new Prisma.Decimal(trimmed);

        if (decimal.lte(0)) {
          throw new BadRequestException(`${fieldName} debe ser mayor a 0.`);
        }

        return decimal;
      } catch {
        if (trimmed) {
          throw new BadRequestException(`${fieldName} debe ser un decimal valido mayor a 0.`);
        }
      }
    }

    throw new BadRequestException(`${fieldName} debe ser numerico.`);
  }

  private toOptionalJson(value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    return value as Prisma.InputJsonValue;
  }

  private normalizeNullableString(value: unknown) {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('description debe ser string.');
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseIssuedAt(value: string) {
    this.assertNonEmptyString(value, 'issuedAt');
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('issuedAt debe ser una fecha ISO valida.');
    }

    return parsed;
  }

  private normalizeIssuedAtToSecond(value: Date) {
    const normalized = new Date(value.getTime());
    normalized.setUTCMilliseconds(0);
    return normalized;
  }

  private serializeCanonicalDateTime(value: Date) {
    return this.normalizeIssuedAtToSecond(value).toISOString().replace('.000Z', 'Z');
  }

  private formatHours(hours: {
    toFixed?: (fractionDigits?: number) => string;
    toString: () => string;
  }) {
    if (typeof hours.toFixed === 'function') {
      return hours.toFixed(2);
    }

    return hours.toString();
  }
}
