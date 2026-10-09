import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IssuerTechnicalIdentityStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { type PrismaService } from '../prisma/prisma.service';
import {
  CsprngSignerMaterialGenerator,
  materialFromScalar
} from './operator/signer-material-generator';
import { SsmSignerSecretWriter } from './operator/ssm-signer-secret-writer';
import { type SignerRotationService } from './signer-rotation.service';
import {
  type GeneratedSignerMaterial,
  TechnicalIdentityProvisioningService,
  TechnicalProvisioningError
} from './technical-identity-provisioning.service';

/**
 * Provisioning S8c9. SOLO escalares publicos de test 1 y 2. Sin AWS: el
 * escritor de secretos es un doble que registra; el SSM real nunca se toca.
 */

const ISSUER_ID = '11111111-1111-4111-8111-111111111111';
const SCALAR_1 = `0x${'0'.repeat(63)}1`;
const SCALAR_2 = `0x${'0'.repeat(63)}2`;
const KEY_1 = materialFromScalar(SCALAR_1);
const KEY_2 = materialFromScalar(SCALAR_2);
const PREFIX = '/scope/test/signers/';

type Row = Record<string, unknown>;

function fakePrisma(options: { identity?: boolean; profiles?: Row[]; failOn?: string } = {}) {
  const state = {
    issuers: [{ id: ISSUER_ID, allowedCredentialTypes: [] as string[] }],
    profiles: [...(options.profiles ?? [])] as Row[],
    identities: options.identity
      ? ([{ issuerId: ISSUER_ID, anchorSignerProfileId: 'existing' }] as Row[])
      : ([] as Row[]),
    bindings: [] as Row[],
    transactions: 0
  };
  const maybeFail = (op: string) => {
    if (options.failOn === op) throw Object.assign(new Error('db boom secret-ish'), { code: 'P2034' });
  };

  const client = {
    issuer: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const issuer = state.issuers.find((i) => i.id === where.id);
        if (!issuer) return null;
        const identity = state.identities.find((i) => i.issuerId === where.id);
        return { id: issuer.id, technicalIdentity: identity ? { id: 'ti' } : null };
      },
      update: async ({ data }: { data: { allowedCredentialTypes: string[] } }) => {
        maybeFail('issuer.update');
        state.issuers[0].allowedCredentialTypes = data.allowedCredentialTypes;
        return state.issuers[0];
      }
    },
    signerProfile: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.profiles.find((p) => p.id === where.id) ?? null,
      create: async ({ data }: { data: Row }) => {
        maybeFail('signerProfile.create');
        state.profiles.push(data);
        return data;
      }
    },
    issuerTechnicalIdentity: {
      create: async ({ data }: { data: Row }) => {
        maybeFail('identity.create');
        state.identities.push(data);
        return { status: data.status };
      },
      count: async ({ where }: { where: { anchorSignerProfileId: string } }) =>
        state.identities.filter((i) => i.anchorSignerProfileId === where.anchorSignerProfileId)
          .length
    },
    issuerAssertionKeyBinding: {
      create: async ({ data }: { data: Row }) => {
        state.bindings.push(data);
        return data;
      },
      findMany: async () =>
        state.bindings.map((b) => ({
          signerProfile: state.profiles.find((p) => p.id === b.signerProfileId)
        }))
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, opts: unknown) => {
      state.transactions += 1;
      assert.deepEqual(opts, { isolationLevel: 'Serializable' });
      return fn(client);
    }
  };
  return { prisma: client as unknown as PrismaService, state };
}

function generatorOf(...materials: GeneratedSignerMaterial[]) {
  let index = 0;
  return { generate: () => materials[index++] };
}

function recordingWriter(failAt?: number) {
  const writes: { ref: string; value: string }[] = [];
  return {
    writes,
    createSecureString: async (ref: string, value: string) => {
      if (failAt !== undefined && writes.length === failAt) throw new Error('AccessDenied arn:aws:...');
      writes.push({ ref, value });
    }
  };
}

function service(over: Partial<ConstructorParameters<typeof TechnicalIdentityProvisioningService>[0]> = {}) {
  const db = fakePrisma();
  let n = 0;
  const writer = recordingWriter();
  const deps = {
    prisma: db.prisma,
    generator: generatorOf(KEY_1, KEY_2),
    secretWriter: writer,
    rotationService: {} as SignerRotationService,
    didConfig: { host: 'scope.example' },
    secretRefPrefix: PREFIX,
    newId: () => `profile-${++n}`,
    now: () => new Date('2026-10-09T00:00:00.000Z'),
    ...over
  };
  return { svc: new TechnicalIdentityProvisioningService(deps), db, writer, deps };
}

const leaks = (value: unknown) => {
  const text = JSON.stringify(value) + String((value as Error)?.message ?? '');
  return [SCALAR_1.slice(2), SCALAR_2.slice(2)].some((k) => text.includes(k));
};

test('P1 provisioning inicial (anchor nuevo): SSM primero, TX serializable, keyVersion 1', async () => {
  const { svc, db, writer } = service();
  const r = await svc.provisionInitial({
    issuerId: ISSUER_ID,
    credentialTypes: ['course', 'course'],
    anchor: { kind: 'new' }
  });

  assert.equal(r.did, `did:web:scope.example:did:issuers:${ISSUER_ID}`);
  assert.equal(r.technicalIdentityStatus, IssuerTechnicalIdentityStatus.active);
  assert.deepEqual(r.allowedCredentialTypes, ['course']);
  assert.equal(r.assertion.address, KEY_1.address);
  assert.equal(r.assertion.keyVersion, 1);
  assert.equal(r.anchor.keyVersion, 1);
  assert.equal(r.anchor.shared, false);
  assert.deepEqual(writer.writes.map((w) => w.ref), [`${PREFIX}profile-1`, `${PREFIX}profile-2`]);
  assert.equal(db.state.transactions, 1);
  assert.equal(db.state.bindings.length, 1);
  assert.equal(db.state.identities.length, 1);

  const assertion = db.state.profiles.find((p) => p.purpose === SignerProfilePurpose.assertion)!;
  const anchor = db.state.profiles.find((p) => p.purpose === SignerProfilePurpose.anchor)!;
  assert.equal(assertion.publicKeyCompressed, KEY_1.publicKeyCompressed);
  assert.equal(anchor.publicKeyX, null);
  assert.equal(assertion.status, SignerProfileStatus.active);
  assert.ok(assertion.addressVerifiedAt instanceof Date);
});

test('P2 ninguna clave privada en resultado, base ni error', async () => {
  const { svc, db } = service();
  const r = await svc.provisionInitial({ issuerId: ISSUER_ID, credentialTypes: [], anchor: { kind: 'new' } });
  assert.equal(leaks(r), false);
  assert.equal(leaks(db.state), false);
  for (const p of db.state.profiles) assert.equal('privateKey' in p, false);
});

test('P3 identidad existente: TECHNICAL_IDENTITY_ALREADY_EXISTS sin escribir SSM', async () => {
  const db = fakePrisma({ identity: true });
  const { svc, writer } = service({ prisma: db.prisma });
  await assert.rejects(
    svc.provisionInitial({ issuerId: ISSUER_ID, credentialTypes: [], anchor: { kind: 'new' } }),
    (e: unknown) => e instanceof TechnicalProvisioningError && e.code === 'TECHNICAL_IDENTITY_ALREADY_EXISTS'
  );
  assert.equal(writer.writes.length, 0);
});

test('P4 validaciones previas fallan ANTES de SSM', async () => {
  const cases: [Parameters<typeof service>[0], unknown[], string][] = [
    [{ secretRefPrefix: undefined }, [], 'SECRET_REF_PREFIX_INVALID'],
    [{ secretRefPrefix: '/scope/../x/' }, [], 'SECRET_REF_PREFIX_INVALID'],
    [{ secretRefPrefix: 'scope/x' }, [], 'SECRET_REF_PREFIX_INVALID'],
    [{ didConfig: null }, [], 'DID_CONFIGURATION_MISSING'],
    [{}, ['COURSE'], 'INVALID_CREDENTIAL_TYPE']
  ];
  for (const [over, types, code] of cases) {
    const { svc, writer } = service(over);
    await assert.rejects(
      svc.provisionInitial({ issuerId: ISSUER_ID, credentialTypes: types, anchor: { kind: 'new' } }),
      (e: unknown) => e instanceof TechnicalProvisioningError && e.code === code,
      code
    );
    assert.equal(writer.writes.length, 0, code);
  }
});

test('P5 material incoherente: SIGNER_MATERIAL_INVALID sin SSM', async () => {
  const bad = { ...KEY_1, publicKeyCompressed: KEY_2.publicKeyCompressed };
  const { svc, writer } = service({ generator: generatorOf(bad) });
  await assert.rejects(
    svc.provisionInitial({ issuerId: ISSUER_ID, credentialTypes: [], anchor: { kind: 'new' } }),
    (e: unknown) => e instanceof TechnicalProvisioningError && e.code === 'SIGNER_MATERIAL_INVALID'
  );
  assert.equal(writer.writes.length, 0);
});

test('P6 fallo de base tras SSM: ORPHAN con secretRefs, sin borrar, sin filtrar mensaje', async () => {
  const db = fakePrisma({ failOn: 'identity.create' });
  const { svc, writer } = service({ prisma: db.prisma });
  await assert.rejects(
    svc.provisionInitial({ issuerId: ISSUER_ID, credentialTypes: [], anchor: { kind: 'new' } }),
    (e: unknown) => {
      assert.ok(e instanceof TechnicalProvisioningError);
      assert.equal(e.code, 'ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP');
      assert.deepEqual(e.orphanSecretRefs, writer.writes.map((w) => w.ref));
      assert.equal(e.causeCode, 'P2034');
      assert.equal(e.message.includes('boom'), false);
      assert.equal(leaks(e), false);
      return true;
    }
  );
  assert.equal(writer.writes.length, 2);
});

test('P7 fallo del segundo PutParameter: primer secreto informado como huerfano', async () => {
  const writer = recordingWriter(1);
  const { svc } = service({ secretWriter: writer });
  await assert.rejects(
    svc.provisionInitial({ issuerId: ISSUER_ID, credentialTypes: [], anchor: { kind: 'new' } }),
    (e: unknown) =>
      e instanceof TechnicalProvisioningError &&
      e.code === 'ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP' &&
      e.orphanSecretRefs.length === 1 &&
      !e.message.includes('arn:aws')
  );
});

test('P8 primer PutParameter falla: SECRET_WRITE_FAILED sin huerfanos', async () => {
  const { svc } = service({ secretWriter: recordingWriter(0) });
  await assert.rejects(
    svc.provisionInitial({ issuerId: ISSUER_ID, credentialTypes: [], anchor: { kind: 'new' } }),
    (e: unknown) =>
      e instanceof TechnicalProvisioningError && e.code === 'SECRET_WRITE_FAILED' && e.orphanSecretRefs.length === 0
  );
});

const sharedAnchor = (status: SignerProfileStatus = SignerProfileStatus.active, purpose: SignerProfilePurpose = SignerProfilePurpose.anchor) => ({
  id: 'shared-anchor',
  purpose,
  status,
  address: KEY_2.address.toLowerCase(),
  keyVersion: 3,
  addressVerifiedAt: new Date()
});

test('P9 anchor compartido: reusa sin secreto nuevo, conserva su keyVersion', async () => {
  const db = fakePrisma({ profiles: [sharedAnchor()] });
  db.state.identities.push({ issuerId: 'other', anchorSignerProfileId: 'shared-anchor' });
  const { svc, writer } = service({ prisma: db.prisma, generator: generatorOf(KEY_1) });
  const r = await svc.provisionInitial({
    issuerId: ISSUER_ID,
    credentialTypes: [],
    anchor: { kind: 'shared', signerProfileId: 'shared-anchor' }
  });
  assert.equal(writer.writes.length, 1);
  assert.equal(r.anchor.secretRef, null);
  assert.equal(r.anchor.keyVersion, 3);
  assert.equal(r.anchor.shared, true);
});

test('P10 anchor compartido invalido (retirado/comprometido/asercion/inexistente): sin SSM', async () => {
  for (const profiles of [
    [sharedAnchor(SignerProfileStatus.retired)],
    [sharedAnchor(SignerProfileStatus.compromised)],
    [sharedAnchor(SignerProfileStatus.active, SignerProfilePurpose.assertion)],
    []
  ]) {
    const db = fakePrisma({ profiles });
    const { svc, writer } = service({ prisma: db.prisma });
    await assert.rejects(
      svc.provisionInitial({
        issuerId: ISSUER_ID,
        credentialTypes: [],
        anchor: { kind: 'shared', signerProfileId: 'shared-anchor' }
      }),
      (e: unknown) => e instanceof TechnicalProvisioningError && e.code === 'SHARED_ANCHOR_INVALID'
    );
    assert.equal(writer.writes.length, 0);
  }
});

test('P11 anchor compartido comprometido DURANTE la escritura: la TX lo re-valida', async () => {
  const db = fakePrisma({ profiles: [sharedAnchor()] });
  const writer = {
    createSecureString: async () => {
      (db.state.profiles[0] as Row).status = SignerProfileStatus.compromised;
    }
  };
  const { svc } = service({ prisma: db.prisma, secretWriter: writer, generator: generatorOf(KEY_1) });
  await assert.rejects(
    svc.provisionInitial({
      issuerId: ISSUER_ID,
      credentialTypes: [],
      anchor: { kind: 'shared', signerProfileId: 'shared-anchor' }
    }),
    (e: unknown) =>
      e instanceof TechnicalProvisioningError &&
      e.code === 'ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP' &&
      e.causeCode === 'SHARED_ANCHOR_INVALID'
  );
  assert.equal(db.state.identities.length, 0);
});

test('P12 rotacion de asercion: keyVersion siguiente y delega en SignerRotationService', async () => {
  const db = fakePrisma({ profiles: [{ id: 'a1', keyVersion: 1 }, { id: 'a2', keyVersion: 2 }] });
  db.state.bindings.push({ signerProfileId: 'a1' }, { signerProfileId: 'a2' });
  const calls: unknown[] = [];
  const rotationService = {
    rotateAssertionSigner: async (input: unknown) => {
      calls.push(input);
      return { ok: true };
    }
  } as unknown as SignerRotationService;
  const { svc } = service({ prisma: db.prisma, rotationService, generator: generatorOf(KEY_1) });
  const r = await svc.rotateAssertion({ issuerId: ISSUER_ID });
  const created = db.state.profiles.find((p) => p.id === 'profile-1')!;
  assert.equal(created.keyVersion, 3);
  assert.deepEqual(calls, [{ issuerId: ISSUER_ID, newSignerProfileId: 'profile-1' }]);
  assert.equal(leaks(r), false);
});

test('P13 rotacion falla: ROTATION_FAILED_PROFILE_UNATTACHED, nada compensado', async () => {
  const db = fakePrisma({ profiles: [{ id: 'a1', keyVersion: 1 }] });
  db.state.bindings.push({ signerProfileId: 'a1' });
  const rotationService = {
    rotateAssertionSigner: async () => {
      throw Object.assign(new Error('x'), { code: 'ROTATION_NOT_ALLOWED' });
    }
  } as unknown as SignerRotationService;
  const { svc } = service({ prisma: db.prisma, rotationService, generator: generatorOf(KEY_1) });
  await assert.rejects(
    svc.rotateAssertion({ issuerId: ISSUER_ID }),
    (e: unknown) =>
      e instanceof TechnicalProvisioningError &&
      e.code === 'ROTATION_FAILED_PROFILE_UNATTACHED' &&
      e.unattachedProfileIds[0] === 'profile-1' &&
      e.causeCode === 'ROTATION_NOT_ALLOWED'
  );
});

test('P14 rotacion de anchor compartido: sin secreto nuevo', async () => {
  const writer = recordingWriter();
  let input: unknown;
  const rotationService = {
    rotateAnchorSigner: async (i: unknown) => {
      input = i;
      return {};
    }
  } as unknown as SignerRotationService;
  const { svc } = service({ secretWriter: writer, rotationService });
  const r = await svc.rotateAnchor({
    issuerId: ISSUER_ID,
    anchor: { kind: 'shared', signerProfileId: 'shared-anchor' }
  });
  assert.equal(writer.writes.length, 0);
  assert.equal(r.secretRef, null);
  assert.deepEqual(input, { issuerId: ISSUER_ID, newSignerProfileId: 'shared-anchor' });
});

test('G1 generador CSPRNG: rechaza 0 y >= n, acepta valido', () => {
  const zero = Buffer.alloc(32);
  const tooBig = Buffer.alloc(32, 0xff);
  const one = Buffer.from(SCALAR_1.slice(2), 'hex');
  const seq = [zero, tooBig, one];
  const material = new CsprngSignerMaterialGenerator(() => seq.shift()!).generate();
  assert.equal(material.address, KEY_1.address);
  assert.throws(() => new CsprngSignerMaterialGenerator(() => Buffer.alloc(32)).generate());
});

test('G2 generador real: direccion y clave publica coherentes', () => {
  const m = new CsprngSignerMaterialGenerator().generate();
  assert.match(m.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(m.publicKeyCompressed.slice(4), m.publicKeyX.slice(2));
});

test('G3 escritor SSM: PutParameter SecureString con Overwrite=false (cliente doble)', async () => {
  const sent: { input: Record<string, unknown>; name: string }[] = [];
  const client = {
    send: async (command: { input: Record<string, unknown>; constructor: { name: string } }) => {
      sent.push({ input: command.input, name: command.constructor.name });
      return {};
    }
  };
  await new SsmSignerSecretWriter(client as never).createSecureString('/scope/test/signers/x', 'v');
  assert.equal(sent[0].name, 'PutParameterCommand');
  assert.equal(sent[0].input.Type, 'SecureString');
  assert.equal(sent[0].input.Overwrite, false);
});
