import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { TechnicalIdentityProvisioningService, TechnicalProvisioningError } from './technical-identity-provisioning.service';
import { materialFromScalar } from './operator/signer-material-generator';

const expected = 'postgresql://uade_test:local_test_only@127.0.0.1:55439/uade_test?schema=public';
if (process.env.DATABASE_URL !== expected) throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
const id = '14bcdb1c-f82a-4435-af45-4bc5c95e02a7';
const p = new PrismaClient();
const q = new PrismaClient();
let scalar = 10;
const input = { issuerId: id, credentialTypes: ['academic_subject'], anchor: { kind: 'new' as const }, guardUade: true };

async function reset() {
  await p.issuerAssertionKeyBinding.deleteMany();
  await p.issuerTechnicalIdentity.deleteMany();
  await p.signerProfile.deleteMany();
  await p.issuer.deleteMany();
  await p.issuer.create({ data: { id, name: 'Local synthetic test issuer', authorizationStatus: 'authorized', allowedCredentialTypes: ['academic_subject'] } });
}
function create(hook?: () => Promise<void>) {
  const refs: string[] = [];
  const svc = new TechnicalIdentityProvisioningService({
    prisma: p as never,
    generator: { generate: () => materialFromScalar('0x' + (scalar++).toString(16).padStart(64, '0')) },
    secretWriter: { async createSecureString(ref: string) { refs.push(ref); if (refs.length === 2 && hook) await hook(); } },
    rotationService: {} as never, didConfig: { host: 'test.example' }, secretRefPrefix: '/scope/test/signers/'
  });
  return { refs, run: () => svc.provisionInitial(input) };
}
function orphan(e: unknown) {
  assert.ok(e instanceof TechnicalProvisioningError);
  assert.equal(e.code, 'ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP');
  assert.equal(e.orphanSecretRefs.length, 2);
  return true;
}
test('local PostgreSQL guarded provisioning and identity already present', async () => {
  await reset();
  await create().run();
  assert.deepEqual((await p.issuer.findUniqueOrThrow({ where: { id } })).allowedCredentialTypes, ['academic_subject']);
  assert.equal(await p.issuerTechnicalIdentity.count(), 1);
  const repeat = create();
  await assert.rejects(repeat.run(), (e: unknown) => e instanceof TechnicalProvisioningError && e.code === 'TECHNICAL_IDENTITY_ALREADY_EXISTS');
  assert.equal(repeat.refs.length, 0);
  assert.equal(await p.issuerTechnicalIdentity.count(), 1);
});
test('local PostgreSQL rejects capability race and retains competing change', async () => {
  await reset();
  const run = create(async () => { await q.issuer.update({ where: { id }, data: { allowedCredentialTypes: ['academic_subject', 'course'] } }); });
  await assert.rejects(run.run(), orphan);
  assert.deepEqual((await p.issuer.findUniqueOrThrow({ where: { id } })).allowedCredentialTypes, ['academic_subject', 'course']);
  assert.equal(await p.issuerTechnicalIdentity.count(), 0);
  assert.equal(await p.signerProfile.count(), 0);
});
test('local PostgreSQL rejects authorization race', async () => {
  await reset();
  const run = create(async () => { await q.issuer.update({ where: { id }, data: { authorizationStatus: 'revoked' } }); });
  await assert.rejects(run.run(), orphan);
  assert.equal((await p.issuer.findUniqueOrThrow({ where: { id } })).authorizationStatus, 'revoked');
  assert.equal(await p.issuerTechnicalIdentity.count(), 0);
});
test('local PostgreSQL concurrent provision attempts commit at most one identity without retry', async () => {
  await reset();
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>(r => { release = r; });
  const hook = async () => { if (++arrived === 2) release(); await barrier; };
  const a = create(hook), b = create(hook);
  const outcomes = await Promise.allSettled([a.run(), b.run()]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  const failure = outcomes.find(o => o.status === 'rejected');
  assert.ok(failure && failure.status === 'rejected');
  orphan(failure.reason);
  assert.ok(['P2034', 'TECHNICAL_IDENTITY_ALREADY_EXISTS', 'UADE_PRECONDITION_FAILED', 'P2002'].includes(failure.reason.causeCode));
  console.log('CONCURRENT_PROVISION_REJECTED_CAUSE=' + failure.reason.causeCode);
  assert.equal(await p.issuerTechnicalIdentity.count(), 1);
  assert.equal(await p.signerProfile.count(), 2);
  assert.deepEqual((await p.issuer.findUniqueOrThrow({ where: { id } })).allowedCredentialTypes, ['academic_subject']);
  assert.equal(a.refs.length, 2);
  assert.equal(b.refs.length, 2);
});
test.after(async () => { await p.$disconnect(); await q.$disconnect(); });
