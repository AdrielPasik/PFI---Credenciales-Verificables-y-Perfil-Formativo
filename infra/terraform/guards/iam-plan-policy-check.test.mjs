// Pruebas del verificador de la politica IAM propuesta. Mutan la politica EN MEMORIA y exigen que
// el verificador lo detecte. No tocan AWS ni ningun archivo. node --test infra/terraform/guards/iam-plan-policy-check.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_IAM_DIR, DEFAULT_PROD_DIR, WILDCARD_ONLY_ACTIONS, codeManagedSsmNames, codeResourceTypes, main, observedCoverage, runChecks } from './iam-plan-policy-check.mjs';

const read = (f) => fs.readFileSync(path.join(DEFAULT_IAM_DIR, f), 'utf8');
const permissionsText = read('terraform-plan-role.permissions.template.json');
const trustText = read('terraform-plan-role.trust.template.json');
const inventory = JSON.parse(read('provider-reads.inventory.json'));
const codeTypes = codeResourceTypes(DEFAULT_PROD_DIR);
const managedSsm = codeManagedSsmNames(DEFAULT_PROD_DIR);

const evaluateWith = (overrides = {}) =>
  runChecks({ permissionsText, trustText, inventory, codeTypes, managedSsm, ...overrides });
const failures = (results) => results.filter((r) => !r.ok);
const mutatePermissions = (fn) => {
  const policy = JSON.parse(permissionsText);
  fn(policy);
  return JSON.stringify(policy);
};
const mutateTrust = (fn) => {
  const trust = JSON.parse(trustText);
  fn(trust);
  return JSON.stringify(trust);
};
const byName = (policy, sid) => policy.Statement.find((s) => s.Sid === sid);

test('la propuesta real cumple todas las comprobaciones', () => {
  assert.deepEqual(failures(evaluateWith()), []);
});

test('las plantillas conservan placeholders y no contienen ids ni secretos', () => {
  assert.match(permissionsText, /__ACCOUNT_ID__/);
  assert.match(permissionsText, /__STATE_BUCKET__/);
  assert.doesNotMatch(permissionsText + trustText, /\b\d{12}\b/);
  assert.doesNotMatch(permissionsText + trustText, /AKIA[0-9A-Z]{16}|aws_secret_access_key|re_[A-Za-z0-9_]{20,}/);
});

test('detecta un id de cuenta o bucket "operativo" (placeholders reemplazados)', () => {
  const real = permissionsText.replaceAll('__ACCOUNT_ID__', '123456789012');
  assert.ok(failures(evaluateWith({ permissionsText: real })).length > 0);
});

// ---- mutaciones: cada una DEBE ser detectada ------------------------------------------------
const mutations = [
  ['permitir escribir el estado', (p) => byName(p, 'TfBackendReadStateObject').Action.push('s3:PutObject')],
  ['lock en todo el bucket', (p) => { byName(p, 'TfBackendStateLockObject').Resource = 'arn:aws:s3:::__STATE_BUCKET__/*'; }],
  ['GetObject en todo el bucket', (p) => { byName(p, 'TfBackendReadStateObject').Resource = 'arn:aws:s3:::__STATE_BUCKET__/*'; }],
  ['ListBucket sobre cualquier bucket', (p) => { byName(p, 'TfBackendListStateBucket').Resource = 'arn:aws:s3:::*'; }],
  ['quitar el Deny de escritura S3', (p) => { p.Statement = p.Statement.filter((s) => s.Sid !== 'DenyAnyS3WriteExceptLockObject'); }],
  ['Deny de escritura S3 que tambien protege el lock', (p) => { byName(p, 'DenyAnyS3WriteExceptLockObject').NotResource = ['arn:aws:s3:::otra']; }],
  ['agregar ecs:UpdateService', (p) => byName(p, 'ProviderReadEcsServices').Action.push('ecs:UpdateService')],
  ['agregar ecs:RunTask', (p) => byName(p, 'ProviderReadEcsServices').Action.push('ecs:RunTask')],
  ['agregar iam:PassRole', (p) => byName(p, 'ProviderReadIamRoles').Action.push('iam:PassRole')],
  ['agregar iam:CreateRole', (p) => byName(p, 'ProviderReadIamRoles').Action.push('iam:CreateRole')],
  ['agregar rds:ModifyDBInstance', (p) => byName(p, 'ProviderReadRds').Action.push('rds:ModifyDBInstance')],
  ['agregar ec2:AuthorizeSecurityGroupIngress', (p) => byName(p, 'ProviderReadEc2Vpc').Action.push('ec2:AuthorizeSecurityGroupIngress')],
  ['agregar elasticloadbalancing:ModifyListener', (p) => byName(p, 'ProviderReadElbv2').Action.push('elasticloadbalancing:ModifyListener')],
  ['agregar ssm:PutParameter', (p) => byName(p, 'ProviderReadSsmDescribe').Action.push('ssm:PutParameter')],
  ['agregar un comodin de servicio', (p) => byName(p, 'ProviderReadEcr').Action.push('ecr:*')],
  ['Allow "*:*"', (p) => p.Statement.push({ Sid: 'Todo', Effect: 'Allow', Action: '*', Resource: '*' })],
  ['Allow con NotAction', (p) => p.Statement.push({ Sid: 'MenosX', Effect: 'Allow', NotAction: 'iam:*', Resource: '*' })],
  ['ssm:GetParameter con comodin', (p) => { byName(p, 'ProviderReadSsmManagedStringParameters').Resource = 'arn:aws:ssm:us-east-1:__ACCOUNT_ID__:parameter/scope/prod/*'; }],
  ['ssm:GetParameter sobre un secreto', (p) => byName(p, 'ProviderReadSsmManagedStringParameters').Resource.push('arn:aws:ssm:us-east-1:__ACCOUNT_ID__:parameter/scope/prod/api/JWT_SECRET')],
  ['quitar el Deny de parametros SSM', (p) => { p.Statement = p.Statement.filter((s) => s.Sid !== 'DenyReadingAnySsmParameterValueExceptManagedStrings'); }],
  ['quitar el Deny de secretos/KMS', (p) => { p.Statement = p.Statement.filter((s) => s.Sid !== 'DenySecretValuesAndKeyUse'); }],
  ['Allow de kms:Decrypt', (p) => p.Statement.push({ Sid: 'Kms', Effect: 'Allow', Action: ['kms:Decrypt'], Resource: '*' })],
  ['Allow de secretsmanager:GetSecretValue', (p) => p.Statement.push({ Sid: 'Sm', Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: '*' })],
  ['Resource "*" para una accion que si se puede acotar', (p) => { byName(p, 'ProviderReadIamRoles').Resource = '*'; }],
  ['quitar el limite de region de los Describe "*"', (p) => { delete byName(p, 'ProviderReadEc2Vpc').Condition; }],
  ['region comodin en un ARN', (p) => { byName(p, 'ProviderReadRds').Resource = ['arn:aws:rds:*:__ACCOUNT_ID__:db:scope-prod-db']; }],
  ['quitar una lectura necesaria (ecs:DescribeServices)', (p) => { p.Statement = p.Statement.filter((s) => s.Sid !== 'ProviderReadEcsServices'); }],
  ['quitar acm:DescribeCertificate', (p) => { byName(p, 'ProviderReadAcm').Action = ['acm:ListTagsForCertificate']; }],
  ['quitar un parametro SSM administrado', (p) => byName(p, 'ProviderReadSsmManagedStringParameters').Resource.pop()],
  ['accion de lectura fuera del inventario (iam:GetAccessKeyLastUsed)', (p) => byName(p, 'ProviderReadIamRoles').Action.push('iam:GetAccessKeyLastUsed')],
  ['Principal en la politica de permisos', (p) => { byName(p, 'ProviderReadAcm').Principal = { AWS: '*' }; }],
  ['Sid duplicado', (p) => { byName(p, 'ProviderReadAcm').Sid = 'ProviderReadRds'; }],
  ['politica inline demasiado grande', (p) => { for (let i = 0; i < 40; i += 1) p.Statement.push({ Sid: `Relleno${i}`, Effect: 'Deny', Action: ['sqs:SendMessage'], Resource: [`arn:aws:sqs:us-east-1:__ACCOUNT_ID__:cola-${'x'.repeat(60)}-${i}`] }); }]
];

for (const [name, fn] of mutations) {
  test(`mutacion detectada: ${name}`, () => {
    assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions(fn) })).length > 0, `la mutacion "${name}" NO fue detectada`);
  });
}

// ---- regresion: acciones sin autorizacion a nivel de recurso --------------------------------
// AWS (Service Reference) solo autoriza logs:DescribeLogGroups y servicediscovery:ListTagsForResource con
// Resource "*". Un ARN en su Resource no las habilita: el plan fallaria con AccessDenied.
const WILDCARD_ONLY_CHECK = /sin autorizacion a nivel de recurso/;
const wildcardOnlyFailures = (fn) => failures(evaluateWith({ permissionsText: mutatePermissions(fn) })).filter((r) => WILDCARD_ONLY_CHECK.test(r.name));

test('logs:DescribeLogGroups usa Resource "*" con aws:RequestedRegion = us-east-1 (y nada mas de CloudWatch Logs de lectura de eventos)', () => {
  const policy = JSON.parse(permissionsText);
  const s = byName(policy, 'ProviderReadLogGroups');
  assert.deepEqual(s.Action, ['logs:DescribeLogGroups']);
  assert.equal(s.Resource, '*');
  assert.deepEqual(s.Condition, { StringEquals: { 'aws:RequestedRegion': 'us-east-1' } });
  const logsActions = policy.Statement.filter((x) => x.Effect === 'Allow').flatMap((x) => [x.Action].flat()).filter((a) => a.startsWith('logs:')).sort();
  assert.deepEqual(logsActions, ['logs:DescribeLogGroups', 'logs:ListTagsForResource', 'logs:ListTagsLogGroup']);
});

test('REGRESION: logs:DescribeLogGroups limitado a un ARN de log group es detectado', () => {
  assert.equal(wildcardOnlyFailures((p) => { byName(p, 'ProviderReadLogGroups').Resource = ['arn:aws:logs:us-east-1:__ACCOUNT_ID__:log-group:*']; }).length, 1);
  assert.equal(wildcardOnlyFailures((p) => { byName(p, 'ProviderReadLogGroups').Resource = ['arn:aws:logs:us-east-1:__ACCOUNT_ID__:log-group:/scope/prod/*']; }).length, 1);
});

test('REGRESION: DescribeLogGroups mezclado con las etiquetas (que si admiten ARN) en una sentencia con ARN es detectado', () => {
  assert.equal(wildcardOnlyFailures((p) => { byName(p, 'ProviderReadLogGroupTags').Action.push('logs:DescribeLogGroups'); }).length, 1);
});

test('REGRESION: servicediscovery:ListTagsForResource limitado a un ARN es detectado', () => {
  assert.equal(wildcardOnlyFailures((p) => { byName(p, 'ProviderReadCloudMap').Action.push('servicediscovery:ListTagsForResource'); }).length, 1);
  assert.equal(wildcardOnlyFailures((p) => { byName(p, 'ProviderReadCloudMapTags').Resource = ['arn:aws:servicediscovery:us-east-1:__ACCOUNT_ID__:namespace/*']; }).length, 1);
});

test('DescribeLogGroups con "*" pero sin limite de region es detectado', () => {
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => { delete byName(p, 'ProviderReadLogGroups').Condition; }) })).some((r) => /limitados a us-east-1/.test(r.name)));
});

test('CloudWatch Logs: no se acepta logs:*, lectura de eventos, consultas ni escritura', () => {
  for (const extra of ['logs:*', 'logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:StartQuery', 'logs:GetQueryResults', 'logs:CreateLogGroup', 'logs:PutRetentionPolicy', 'logs:DeleteLogGroup']) {
    const r = failures(evaluateWith({ permissionsText: mutatePermissions((p) => byName(p, 'ProviderReadLogGroupTags').Action.push(extra)) }));
    assert.ok(r.length > 0, `${extra} NO fue detectado`);
  }
});

test('ninguna accion sin autorizacion a nivel de recurso queda en una sentencia con ARN (politica real)', () => {
  const policy = JSON.parse(permissionsText);
  for (const s of policy.Statement.filter((x) => x.Effect === 'Allow')) {
    const wildcardOnly = [s.Action].flat().filter((a) => WILDCARD_ONLY_ACTIONS.has(a));
    if (wildcardOnly.length === 0) continue;
    assert.equal(s.Resource, '*', `${s.Sid} (${wildcardOnly.join(', ')}) debe usar Resource "*"`);
    assert.equal(s.Condition?.StringEquals?.['aws:RequestedRegion'], 'us-east-1', `${s.Sid} debe limitarse a us-east-1`);
  }
  assert.ok(WILDCARD_ONLY_ACTIONS.has('logs:DescribeLogGroups'));
});

// ---- regresion: AccessDenied reales del Plan A ----------------------------------------------
test('REGRESION Plan A: rds:DescribeDBInstances solo sobre db:* (cuenta y region), sin ampliar el resto de RDS', () => {
  const policy = JSON.parse(permissionsText);
  assert.deepEqual(byName(policy, 'ProviderReadRdsInstances').Action, ['rds:DescribeDBInstances']);
  assert.deepEqual(byName(policy, 'ProviderReadRdsInstances').Resource, ['arn:aws:rds:us-east-1:__ACCOUNT_ID__:db:*']);
  assert.deepEqual(byName(policy, 'ProviderReadRds').Action, ['rds:DescribeDBSubnetGroups', 'rds:ListTagsForResource']);
  assert.deepEqual(byName(policy, 'ProviderReadRds').Resource, ['arn:aws:rds:us-east-1:__ACCOUNT_ID__:db:scope-prod-db', 'arn:aws:rds:us-east-1:__ACCOUNT_ID__:subgrp:scope-prod-db']);
});

test('REGRESION Plan A: rds:DescribeDBInstances con Resource "*" o con otra accion de RDS sobre db:* es detectado', () => {
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => { byName(p, 'ProviderReadRdsInstances').Resource = '*'; }) })).length > 0);
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => { byName(p, 'ProviderReadRdsInstances').Action.push('rds:ListTagsForResource'); }) })).length > 0);
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => { byName(p, 'ProviderReadRdsInstances').Resource = ['arn:aws:rds:*:__ACCOUNT_ID__:db:*']; }) })).length > 0);
});

test('REGRESION Plan A: states:ListStateMachineVersions solo en las dos state machines (ARN exactos)', () => {
  const s = byName(JSON.parse(permissionsText), 'ProviderReadStepFunctions');
  assert.deepEqual(s.Action, ['states:DescribeStateMachine', 'states:ListStateMachineVersions', 'states:ListTagsForResource']);
  assert.deepEqual(s.Resource, ['arn:aws:states:us-east-1:__ACCOUNT_ID__:stateMachine:scope-prod-ecs-sync-probe', 'arn:aws:states:us-east-1:__ACCOUNT_ID__:stateMachine:scope-prod-issuer-provisioner']);
  // ampliar a cualquier state machine o a "*" es detectado
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => { byName(p, 'ProviderReadStepFunctions').Resource = ['arn:aws:states:us-east-1:__ACCOUNT_ID__:stateMachine:*']; }) })).length > 0);
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => { byName(p, 'ProviderReadStepFunctions').Resource = '*'; }) })).length > 0);
  // y solo esa lectura nueva: StartExecution, ListExecutions, GetExecutionHistory siguen fuera
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => byName(p, 'ProviderReadStepFunctions').Action.push('states:StartExecution')) })).length > 0);
  assert.ok(failures(evaluateWith({ permissionsText: mutatePermissions((p) => byName(p, 'ProviderReadStepFunctions').Action.push('states:ListExecutions')) })).length > 0);
});

test('los Deny de S3, SSM, Secrets Manager y KMS siguen presentes y sin cambios respecto de la politica anterior', () => {
  const denies = (text) => JSON.parse(text).Statement.filter((s) => s.Effect === 'Deny');
  const names = denies(permissionsText).map((s) => s.Sid).sort();
  assert.deepEqual(names, ['DenyAnyS3WriteExceptLockObject', 'DenyReadingAnySsmParameterValueExceptManagedStrings', 'DenySecretValuesAndKeyUse']);
});

// ---- mutaciones de la confianza -------------------------------------------------------------
const trustMutations = [
  ['principal = raiz de la cuenta', (t) => { t.Statement[0].Principal.AWS = 'arn:aws:iam::__ACCOUNT_ID__:root'; }],
  ['principal = *', (t) => { t.Statement[0].Principal.AWS = '*'; }],
  ['principal = otro usuario', (t) => { t.Statement[0].Principal.AWS = 'arn:aws:iam::__ACCOUNT_ID__:user/otro'; }],
  ['sin MFA', (t) => { delete t.Statement[0].Condition.Bool; }],
  ['sin nombre de sesion', (t) => { delete t.Statement[0].Condition.StringLike; }],
  ['federacion web', (t) => { t.Statement[0].Action = 'sts:AssumeRoleWithWebIdentity'; }],
  ['segunda sentencia', (t) => { t.Statement.push({ ...t.Statement[0], Sid: 'Otra' }); }]
];
for (const [name, fn] of trustMutations) {
  test(`mutacion de confianza detectada: ${name}`, () => {
    assert.ok(failures(evaluateWith({ trustText: mutateTrust(fn) })).length > 0, `la mutacion de confianza "${name}" NO fue detectada`);
  });
}

// ---- cobertura contra el codigo -------------------------------------------------------------
test('un tipo de recurso nuevo en el codigo, sin entrada en el inventario, obliga a revisar', () => {
  const r = failures(evaluateWith({ codeTypes: new Set([...codeTypes, 'aws_dynamodb_table']) }));
  assert.ok(r.some((x) => /aws_dynamodb_table/.test(x.why)));
});

test('si el codigo agrega un parametro SSM administrado, la politica debe actualizarse', () => {
  assert.ok(failures(evaluateWith({ managedSsm: [...managedSsm, '/scope/prod/api/NUEVO'] })).length > 0);
});

test('el inventario y el codigo concuerdan: 10 parametros String administrados', () => {
  assert.equal(managedSsm.length, 10);
  assert.ok(managedSsm.every((n) => /^\/scope\/prod\/(api|ai)\/[A-Z_]+$/.test(n)));
  assert.ok(!managedSsm.some((n) => /JWT_SECRET|DATABASE_URL|KEY|SIGNER|SIGNERS/.test(n)), 'ningun parametro administrado parece un secreto');
});

// ---- eventos observados (CloudTrail) --------------------------------------------------------
test('observado: lecturas cubiertas y escrituras senaladas', () => {
  const cov = observedCoverage({ permissionsText, observedText: 'ecs.amazonaws.com:DescribeServices\nrds.amazonaws.com:DescribeDBInstances\nec2.amazonaws.com:DescribeVpcs\nec2.amazonaws.com:DescribeInstances\nIAM:UpdateRole\n' });
  assert.deepEqual(cov.missing, ['ec2:DescribeInstances']);
  assert.ok(cov.writes.some((w) => /UpdateRole/.test(w)));
});

// ---- CLI ------------------------------------------------------------------------------------
test('CLI: exit 0 con la propuesta real, 2 si faltan archivos', () => {
  const out = [];
  assert.equal(main({ argv: [], out: (l) => out.push(l), err() {} }), 0);
  assert.match(out.join('\n'), /NO prueba que la politica funcione en AWS/);
  assert.equal(main({ argv: ['--dir', '/no/existe'], out() {}, err() {} }), 2);
  assert.equal(main({ argv: ['--raro'], out() {}, err() {} }), 2);
});
