import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

type JsonObject = Record<string, unknown>;

type HashingInput = {
  schemaVersion: string;
  type: string;
  issuerDid: string;
  subjectDid: string;
  title: string;
  description?: string | null;
  issuedAt: Date;
  hours?: { toFixed?: (fractionDigits?: number) => string; toString: () => string } | null;
  credentialSubject: JsonObject;
  /**
   * Solo lo consume `canon_v2`. Opcional en el tipo para que todos los callers
   * `canon_v1` existentes sigan compilando sin cambios; `canon_v2` lo exige en
   * runtime y falla cerrado si falta.
   */
  credentialId?: string | null;
};

/**
 * Versiones de canonicalizacion soportadas.
 *
 * `canon_v1` es historico y queda CONGELADO byte a byte: cualquier credential
 * ya emitida tiene su `canonicalHash` calculado con el, y recalcularlo distinto
 * invalidaria evidencia ya anclada.
 *
 * `canon_v2` es EXACTAMENTE `canon_v1` + `credential_id`, sin ningun otro
 * cambio de normalizacion. Motivo (S8b/S8b.1): la proyeccion v1 omite el id, y
 * como `issued_at` se trunca al segundo, dos credentials por lo demas
 * identicas emitidas en el mismo segundo producen el MISMO hash -- lo que en la
 * red hace revertir el segundo registro con `CredentialAlreadyRegistered` y
 * deja el proof atado a contenido en lugar de a un registro concreto.
 */
export type CanonicalizationVersion = 'canon_v1' | 'canon_v2';

@Injectable()
export class CredentialHashingService {
  /**
   * Version POR DEFECTO, deliberadamente `canon_v1` en S8c1: esta slice no
   * hace cutover de comportamiento. El issuance pasa a `canon_v2` en la slice
   * que completa la emision firmada (S8c4/S8c6).
   */
  static readonly CANONICALIZATION_VERSION = 'canon_v1';
  static readonly CANONICALIZATION_VERSION_V1: CanonicalizationVersion = 'canon_v1';
  static readonly CANONICALIZATION_VERSION_V2: CanonicalizationVersion = 'canon_v2';
  static readonly HASH_ALGORITHM = 'sha-256';

  createCanonicalProjection(input: HashingInput) {
    return {
      credential_subject: {
        academic_period: this.normalizeOptionalString(
          this.pickValue(input.credentialSubject, ['academic_period', 'academicPeriod'])
        ),
        achievement_name: this.normalizeOptionalString(
          this.pickValue(input.credentialSubject, ['achievement_name', 'achievementName'])
        ),
        competencies: this.normalizeStringArray(
          this.pickValue(input.credentialSubject, ['competencies'])
        ),
        completion_date: this.normalizeOptionalString(
          this.pickValue(input.credentialSubject, ['completion_date', 'completionDate'])
        ),
        grade: this.normalizeOptionalString(
          this.pickValue(input.credentialSubject, ['grade'])
        ),
        institution_name: this.normalizeOptionalString(
          this.pickValue(input.credentialSubject, ['institution_name', 'institutionName'])
        ),
        skills: this.normalizeStringArray(
          this.pickValue(input.credentialSubject, ['skills'])
        )
      },
      description: this.normalizeOptionalString(input.description),
      hours: this.normalizeHours(input.hours),
      issued_at: this.normalizeDateTime(input.issuedAt),
      issuer_did: this.normalizeRequiredString(input.issuerDid, 'issuer.did'),
      schema_version: this.normalizeRequiredString(
        input.schemaVersion,
        'credential.schemaVersion'
      ),
      subject_did: this.normalizeRequiredString(input.subjectDid, 'subject.did'),
      title: this.normalizeRequiredString(input.title, 'credential.title'),
      type: this.normalizeRequiredString(input.type, 'credential.type')
    };
  }

  /**
   * Proyeccion canonica para una version explicita.
   *
   * `canon_v1` delega sin tocar nada a `createCanonicalProjection`, que es la
   * implementacion congelada. `canon_v2` le agrega UNA sola clave,
   * `credential_id`, requerida: la ordenacion de claves la hace despues
   * `sortRecursively`, asi que el orden en el que se construye el objeto es
   * irrelevante para los bytes finales.
   */
  createCanonicalProjectionForVersion(
    input: HashingInput,
    version: CanonicalizationVersion
  ) {
    const base = this.createCanonicalProjection(input);

    if (version === CredentialHashingService.CANONICALIZATION_VERSION_V1) {
      return base;
    }

    return {
      ...base,
      credential_id: this.normalizeRequiredString(
        input.credentialId,
        'credential.id'
      )
    };
  }

  createCanonicalHash(input: HashingInput) {
    return this.createCanonicalHashForVersion(
      input,
      CredentialHashingService.CANONICALIZATION_VERSION
    );
  }

  createCanonicalHashForVersion(
    input: HashingInput,
    version: CanonicalizationVersion
  ) {
    const projection = this.createCanonicalProjectionForVersion(input, version);
    const serialized = this.stableStringify(projection);
    const digest = createHash('sha256').update(serialized, 'utf8').digest('hex');

    return {
      canonicalizationVersion: version,
      hashAlgorithm: CredentialHashingService.HASH_ALGORITHM,
      canonicalHash: `0x${digest}`,
      canonicalProjection: projection,
      canonicalJson: serialized
    };
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortRecursively(value));
  }

  private sortRecursively(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.sortRecursively(entry));
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as JsonObject).sort(([left], [right]) =>
        this.compareLexicographically(left, right)
      );

      return Object.fromEntries(
        entries.map(([key, entryValue]) => [key, this.sortRecursively(entryValue)])
      );
    }

    return value;
  }

  private pickValue(source: JsonObject, keys: string[]) {
    for (const key of keys) {
      if (key in source) {
        return source[key];
      }
    }

    return undefined;
  }

  private normalizeRequiredString(value: unknown, fieldName: string) {
    const normalized = this.normalizeOptionalString(value);

    if (!normalized) {
      throw new BadRequestException(
        `No se pudo canonicalizar la credencial: falta ${fieldName}.`
      );
    }

    return normalized;
  }

  private normalizeOptionalString(value: unknown) {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ');
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeStringArray(value: unknown) {
    if (value === null || value === undefined) {
      return [];
    }

    const arrayValue = Array.isArray(value) ? value : [value];

    return arrayValue
      .map((entry) => this.normalizeOptionalString(entry))
      .filter((entry): entry is string => entry !== null)
      .sort((left, right) => this.compareLexicographically(left, right));
  }

  private normalizeDateTime(value: Date) {
    const normalized = new Date(value.getTime());
    normalized.setUTCMilliseconds(0);
    return normalized.toISOString().replace('.000Z', 'Z');
  }

  private normalizeHours(
    value?: { toFixed?: (fractionDigits?: number) => string; toString: () => string } | null
  ) {
    if (!value) {
      return null;
    }

    if (typeof value.toFixed === 'function') {
      return value.toFixed(2);
    }

    return value.toString();
  }

  private compareLexicographically(left: string, right: string) {
    if (left < right) {
      return -1;
    }

    if (left > right) {
      return 1;
    }

    return 0;
  }
}
