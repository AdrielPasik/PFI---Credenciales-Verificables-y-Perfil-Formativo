#!/usr/bin/env node
/**
 * Verificador LOCAL de la politica IAM propuesta para el rol de `terraform plan` (Etapa 5.4).
 *
 * Solo lee archivos. NO llama a AWS, NO crea identidades, NO simula contra AWS. Lo que prueba es
 * la ESTRUCTURA y la INTENCION de la propuesta (privilegio minimo, alcance S3, ausencia de
 * permisos de despliegue/secretos, cobertura del inventario de lecturas). NO prueba que la
 * politica "funcione" en AWS: eso solo puede verse tras crear y asumir el rol (accion externa).
 *
 *   node infra/terraform/guards/iam-plan-policy-check.mjs
 *   node infra/terraform/guards/iam-plan-policy-check.mjs --observed eventos.txt
 *
 * `--observed`: archivo con una accion por linea (`ecs:DescribeServices` o
 * `ecs.amazonaws.com:DescribeServices`), p. ej. extraido de CloudTrail. Comprueba que la politica
 * cubra todas las lecturas observadas y senala cualquier escritura observada.
 *
 * Codigos de salida: 0 todo bien · 1 hay incumplimientos · 2 no se pudo evaluar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_IAM_DIR = path.resolve(HERE, '..', 'reconciliation', 'iam');
export const DEFAULT_PROD_DIR = path.resolve(HERE, '..', 'prod');

export const DUMMY = { __ACCOUNT_ID__: '111111111111', __STATE_BUCKET__: 'tfstate-fixture-bucket' };
export const STATE_KEY = 'envs/prod/terraform.tfstate';
export const REGION = 'us-east-1';

/** Acciones que AWS no permite acotar por recurso (Describe*): unicas que pueden llevar Resource "*". */
export const WILDCARD_RESOURCE_OK = new Set([
  'ec2:DescribeVpcs', 'ec2:DescribeVpcAttribute', 'ec2:DescribeSubnets', 'ec2:DescribeInternetGateways', 'ec2:DescribeRouteTables',
  'ec2:DescribeNetworkAcls', 'ec2:DescribeSecurityGroups', 'ec2:DescribeSecurityGroupRules', 'ec2:DescribeVpcEndpoints',
  'ec2:DescribePrefixLists', 'ec2:DescribeTags',
  'elasticloadbalancing:DescribeLoadBalancers', 'elasticloadbalancing:DescribeLoadBalancerAttributes', 'elasticloadbalancing:DescribeTargetGroups',
  'elasticloadbalancing:DescribeTargetGroupAttributes', 'elasticloadbalancing:DescribeListeners', 'elasticloadbalancing:DescribeListenerAttributes',
  'elasticloadbalancing:DescribeTags', 'ecs:DescribeTaskDefinition', 'ssm:DescribeParameters',
  'logs:DescribeLogGroups', 'servicediscovery:ListTagsForResource'
]);

/**
 * Acciones que la Service Reference oficial de AWS lista SIN tipos de recurso (autorizacion solo con "*").
 * Una sentencia Allow que las limite a un ARN nunca autoriza la llamada y el plan fallaria con AccessDenied.
 * (ec2:DescribeVpcAttribute admite el tipo `vpc`; se deja con "*" porque el id de la VPC no se conoce de antemano.)
 */
export const WILDCARD_ONLY_ACTIONS = new Set([...WILDCARD_RESOURCE_OK].filter((a) => a !== 'ec2:DescribeVpcAttribute'));

/** Acciones permitidas que no son de un tipo de recurso concreto del inventario, con su motivo. */
export const EXTRA_JUSTIFIED = {
  'ecs:ListTagsForResource': 'etiquetas de cluster/servicios/task definitions',
  'logs:ListTagsLogGroup': 'compatibilidad con la API anterior de etiquetas de log groups'
};

const READ_ACTION = /^[a-z0-9-]+:(Describe|Get|List)[A-Za-z]*$/;
const WRITE_VERB = /:(Create|Update|Delete|Put|Modify|Run|Start|Stop|Register|Deregister|Attach|Detach|Pass|Tag|Untag|Associate|Disassociate|Authorize|Revoke|Invoke|Execute|Enable|Disable|Set|Reset|Restore|Reboot|Cancel|Send|Publish|Apply|Import|Rotate|Schedule|Terminate|Replace|Change|Upload|Copy|Add|Remove|Batch|Assume)/;
const SECRET_READS = new Set(['secretsmanager:GetSecretValue', 'kms:Decrypt', 'kms:GenerateDataKey', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'ssm:GetParameterHistory']);

// ---------------------------------------------------------------------------------------------
// Evaluador local (simplificado; NO es el motor de IAM): Deny explicito > Allow > denegado implicito.
// ---------------------------------------------------------------------------------------------
const toRegex = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function conditionHolds(condition, ctx) {
  if (!condition) return true;
  for (const [op, pairs] of Object.entries(condition)) {
    for (const [key, expected] of Object.entries(pairs)) {
      const actual = ctx[key];
      if (actual === undefined) return false;
      const values = asArray(expected).map(String);
      if (op === 'StringEquals' || op === 'Bool') {
        if (!values.includes(String(actual))) return false;
      } else if (op === 'StringLike') {
        if (!values.some((v) => toRegex(v).test(String(actual)))) return false;
      } else {
        return false; // operador no soportado por este evaluador: no se asume que aplique
      }
    }
  }
  return true;
}

function matches(statement, action, resource, ctx) {
  const actionHit = statement.Action ? asArray(statement.Action).some((a) => toRegex(a).test(action)) : !asArray(statement.NotAction).some((a) => toRegex(a).test(action));
  if (!actionHit) return false;
  const resourceHit = statement.Resource ? asArray(statement.Resource).some((r) => toRegex(r).test(resource)) : !asArray(statement.NotResource).some((r) => toRegex(r).test(resource));
  return resourceHit && conditionHolds(statement.Condition, ctx);
}

export function evaluate(policy, action, resource, ctx = { 'aws:RequestedRegion': REGION }) {
  const hits = policy.Statement.filter((s) => matches(s, action, resource, ctx));
  if (hits.some((s) => s.Effect === 'Deny')) return 'deny-explicit';
  return hits.some((s) => s.Effect === 'Allow') ? 'allow' : 'deny-implicit';
}

// ---------------------------------------------------------------------------------------------
// Entradas derivadas del codigo Terraform
// ---------------------------------------------------------------------------------------------
export function codeResourceTypes(prodDir) {
  const types = new Set();
  for (const f of fs.readdirSync(prodDir).filter((n) => n.endsWith('.tf'))) {
    for (const m of fs.readFileSync(path.join(prodDir, f), 'utf8').matchAll(/^resource "(aws_[a-z0-9_]+)"/gm)) types.add(m[1]);
  }
  return types;
}

export function codeManagedSsmNames(prodDir) {
  const text = fs.readFileSync(path.join(prodDir, 'locals.tf'), 'utf8').replace(/\r\n/g, '\n');
  return [...text.matchAll(/^\s+"\$\{local\.ssm_prefix\}(\/[^"]+)"\s+=/gm)].map((m) => `/scope/prod${m[1]}`).sort();
}

export function render(text, values = DUMMY) {
  let out = text;
  for (const [k, v] of Object.entries(values)) out = out.split(k).join(v);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------------------------
export function runChecks({ permissionsText, trustText, inventory, codeTypes, managedSsm }) {
  const results = [];
  const ok = (name) => results.push({ ok: true, name });
  const bad = (name, why) => results.push({ ok: false, name, why });
  const check = (cond, name, why) => (cond ? ok(name) : bad(name, why));

  // -- plantillas y placeholders
  const leftovers = [...new Set([...permissionsText.matchAll(/__[A-Z_]+__/g)].map((m) => m[0]))].filter((p) => !(p in DUMMY));
  check(leftovers.length === 0, 'solo los placeholders conocidos (__ACCOUNT_ID__, __STATE_BUCKET__)', `placeholders desconocidos: ${leftovers.join(', ')}`);
  check(permissionsText.includes('__ACCOUNT_ID__') && permissionsText.includes('__STATE_BUCKET__') && trustText.includes('__ACCOUNT_ID__'),
    'la plantilla NO es operativa tal cual (conserva placeholders; ningun id real inventado)', 'la plantilla ya no contiene placeholders: parece operativa con ids que nadie verifico');
  check(!/\b\d{12}\b/.test(permissionsText + trustText), 'ningun id de cuenta literal', 'hay un numero de 12 digitos en las plantillas');

  let permissions;
  let trust;
  try {
    permissions = JSON.parse(render(permissionsText));
    trust = JSON.parse(render(trustText));
    ok('JSON valido (permisos y confianza)');
  } catch (e) {
    bad('JSON valido', String(e.message));
    return results;
  }

  // -- estructura
  const statements = permissions.Statement ?? [];
  check(permissions.Version === '2012-10-17', 'Version 2012-10-17', `Version=${permissions.Version}`);
  check(statements.length > 0 && new Set(statements.map((s) => s.Sid)).size === statements.length, 'Sid unicos y no vacios', 'Sid repetidos o ausentes');
  check(statements.every((s) => ['Allow', 'Deny'].includes(s.Effect)), 'Effect valido en cada sentencia', 'hay un Effect invalido');
  check(!statements.some((s) => 'Principal' in s || 'NotPrincipal' in s), 'la politica de permisos no tiene Principal', 'Principal en una politica de permisos');
  check(!statements.some((s) => s.Effect === 'Allow' && 'NotAction' in s), 'ningun Allow con NotAction', 'Allow + NotAction concede todo menos X');
  check(!statements.some((s) => s.Effect === 'Allow' && 'NotResource' in s), 'ningun Allow con NotResource', 'Allow + NotResource');

  const allows = statements.filter((s) => s.Effect === 'Allow');
  const allowedActions = new Set(allows.flatMap((s) => asArray(s.Action)));

  check(![...allowedActions].some((a) => a === '*' || /:\*$/.test(a) || /\*/.test(a)), 'sin comodines en las acciones permitidas', `acciones con comodin: ${[...allowedActions].filter((a) => /\*/.test(a)).join(', ')}`);

  // -- solo lectura (+ la excepcion del lock)
  const nonRead = [...allowedActions].filter((a) => !READ_ACTION.test(a) && !['s3:PutObject', 's3:DeleteObject'].includes(a));
  check(nonRead.length === 0, 'toda accion permitida es Describe/Get/List (salvo el lock de S3)', `acciones que no son de lectura: ${nonRead.join(', ')}`);
  const writeVerbs = [...allowedActions].filter((a) => WRITE_VERB.test(a) && !['s3:PutObject', 's3:DeleteObject'].includes(a));
  check(writeVerbs.length === 0, 'ninguna accion de despliegue/modificacion permitida', `verbos de escritura: ${writeVerbs.join(', ')}`);
  const secretReads = [...allowedActions].filter((a) => SECRET_READS.has(a));
  check(secretReads.length === 0, 'ningun Allow para leer valores secretos/descifrar', `Allow de secretos: ${secretReads.join(', ')}`);

  // -- comodines de recurso
  const wildcardBad = allows.filter((s) => asArray(s.Resource).includes('*')).filter((s) => !asArray(s.Action).every((a) => WILDCARD_RESOURCE_OK.has(a)));
  check(wildcardBad.length === 0, 'Resource "*" solo para Describe que AWS no permite acotar', `Resource "*" no justificado en: ${wildcardBad.map((s) => s.Sid).join(', ')}`);
  const wildcardNoRegion = allows.filter((s) => asArray(s.Resource).includes('*')).filter((s) => s.Condition?.StringEquals?.['aws:RequestedRegion'] !== REGION);
  check(wildcardNoRegion.length === 0, 'los Resource "*" estan limitados a us-east-1 (aws:RequestedRegion)', `sin limite de region: ${wildcardNoRegion.map((s) => s.Sid).join(', ')}`);
  const arnLimitedWildcardOnly = allows.flatMap((s) => (asArray(s.Resource).includes('*') ? [] : asArray(s.Action).filter((a) => WILDCARD_ONLY_ACTIONS.has(a)).map((a) => `${s.Sid}:${a}`)));
  check(arnLimitedWildcardOnly.length === 0, 'las acciones sin autorizacion a nivel de recurso (p. ej. logs:DescribeLogGroups) usan Resource "*", no un ARN', `limitadas a un ARN (nunca se autorizan): ${arnLimitedWildcardOnly.join(', ')}`);
  const loneStar = allows.filter((s) => asArray(s.Resource).some((r) => /^arn:aws:[a-z0-9-]*:\*?:/.test(r) && r.includes(':*:')));
  check(loneStar.length === 0, 'sin ARN con region comodin', `region comodin en: ${loneStar.map((s) => s.Sid).join(', ')}`);

  // -- S3: bucket de estado, clave de estado y .tflock
  const bucketArn = `arn:aws:s3:::${DUMMY.__STATE_BUCKET__}`;
  const stateArn = `${bucketArn}/${STATE_KEY}`;
  const lockArn = `${stateArn}.tflock`;
  const s3Allows = allows.filter((s) => asArray(s.Action).some((a) => a.startsWith('s3:')));
  const s3Ok = s3Allows.every((s) =>
    asArray(s.Action).every((a) => {
      const res = asArray(s.Resource);
      if (a === 's3:ListBucket') return res.length === 1 && res[0] === bucketArn;
      if (a === 's3:GetObject') return res.every((r) => r === stateArn || r === lockArn);
      if (a === 's3:PutObject' || a === 's3:DeleteObject') return res.length === 1 && res[0] === lockArn;
      return false;
    })
  );
  check(s3Ok, 'S3: ListBucket solo en el bucket; Get solo estado/.tflock; Put/Delete SOLO en .tflock', 'alcance S3 excede el contrato del backend');
  check(!s3Allows.some((s) => asArray(s.Resource).some((r) => /\*/.test(r))), 'S3: sin comodines de recurso', 'comodin en un ARN de S3');
  check(evaluate(permissions, 's3:PutObject', stateArn) !== 'allow' && evaluate(permissions, 's3:DeleteObject', stateArn) !== 'allow', 'S3: el objeto de estado NO se puede escribir ni borrar', 'la politica permite escribir el estado');
  const s3Deny = statements.find((s) => s.Effect === 'Deny' && asArray(s.Action).includes('s3:PutObject'));
  check(!!s3Deny && JSON.stringify(asArray(s3Deny.NotResource)) === JSON.stringify([lockArn]), 'Deny explicito de escritura S3 en todo salvo .tflock', 'falta el Deny de escritura S3 (NotResource = .tflock)');

  // -- SSM: solo los 10 String que Terraform administra; ninguna otra lectura de valores
  const ssmAllow = allows.find((s) => asArray(s.Action).includes('ssm:GetParameter'));
  const ssmArns = asArray(ssmAllow?.Resource).sort();
  const expectedSsm = managedSsm.map((n) => `arn:aws:ssm:${REGION}:${DUMMY.__ACCOUNT_ID__}:parameter${n}`).sort();
  check(JSON.stringify(ssmArns) === JSON.stringify(expectedSsm) && expectedSsm.length > 0, `SSM: GetParameter solo sobre los ${expectedSsm.length} parametros String gestionados por Terraform (derivados de locals.tf)`, `SSM difiere del codigo. Politica: ${ssmArns.length}, codigo: ${expectedSsm.length}`);
  const ssmDeny = statements.find((s) => s.Effect === 'Deny' && asArray(s.Action).includes('ssm:GetParameter'));
  check(!!ssmDeny && JSON.stringify(asArray(ssmDeny.NotResource).sort()) === JSON.stringify(expectedSsm), 'Deny explicito de lectura de cualquier otro parametro SSM', 'falta o no coincide el Deny de parametros SSM');
  const kmsDeny = statements.find((s) => s.Effect === 'Deny' && asArray(s.Action).includes('secretsmanager:GetSecretValue') && asArray(s.Action).includes('kms:Decrypt'));
  check(!!kmsDeny && asArray(kmsDeny.Resource).includes('*'), 'Deny explicito de Secrets Manager y KMS', 'falta el Deny de secretos/KMS');

  // -- cobertura contra el inventario y el codigo
  const gated = Object.keys(inventory.gated_not_in_state_by_default ?? {}).filter((k) => !k.startsWith('_'));
  const known = new Set([...Object.keys(inventory.types), ...gated]);
  const missingTypes = [...codeTypes].filter((t) => !known.has(t));
  check(missingTypes.length === 0, `el inventario cubre los ${codeTypes.size} tipos de recurso del codigo`, `tipos del codigo SIN entrada en el inventario (revisar permisos): ${missingTypes.join(', ')}`);
  const required = new Set(Object.entries(inventory.types).filter(([t]) => codeTypes.has(t)).flatMap(([, a]) => a));
  const uncovered = [...required].filter((a) => !allowedActions.has(a));
  check(uncovered.length === 0, 'la politica concede todas las lecturas del inventario', `lecturas faltantes: ${uncovered.join(', ')}`);
  const inventoryActions = new Set(Object.values(inventory.types).flat());
  const extras = [...allowedActions].filter((a) => !a.startsWith('s3:') && !inventoryActions.has(a) && !(a in EXTRA_JUSTIFIED));
  check(extras.length === 0, 'ninguna accion permitida fuera del inventario (salvo extras justificados)', `acciones sin justificar: ${extras.join(', ')}`);

  // -- tamano
  const minified = JSON.stringify(JSON.parse(render(permissionsText)));
  check(minified.length <= 10240, `cabe como politica INLINE de rol (${minified.length}/10240 caracteres)`, `${minified.length} caracteres > 10240`);
  if (minified.length > 6144) results.push({ ok: true, name: `NOTA: ${minified.length} > 6144 => NO cabe como politica gestionada; debe ser inline` });

  // -- confianza
  const ts = trust.Statement ?? [];
  const t0 = ts[0] ?? {};
  check(ts.length === 1 && t0.Effect === 'Allow' && t0.Action === 'sts:AssumeRole', 'confianza: una sola sentencia Allow sts:AssumeRole', 'la confianza tiene otras acciones/sentencias');
  check(typeof t0.Principal?.AWS === 'string' && /^arn:aws:iam::\d{12}:user\/scope-operator$/.test(t0.Principal.AWS), 'confianza: principal = el usuario nombrado (no :root, no *, no cuenta entera)', `principal inadecuado: ${JSON.stringify(t0.Principal)}`);
  check(!!t0.Condition?.StringLike?.['sts:RoleSessionName'], 'confianza: nombre de sesion acotado', 'sin condicion de nombre de sesion');
  check(t0.Condition?.Bool?.['aws:MultiFactorAuthPresent'] === 'true', 'confianza: exige MFA (verificar que `aws login` lo transmita)', 'sin condicion de MFA');
  check(!JSON.stringify(trust).includes('AssumeRoleWithWebIdentity'), 'confianza: sin federacion web', 'AssumeRoleWithWebIdentity en la confianza');

  // -- escenarios permitir/denegar con el evaluador local
  const A = DUMMY.__ACCOUNT_ID__;
  const scenarios = [
    ['allow', 's3:ListBucket', bucketArn], ['allow', 's3:GetObject', stateArn],
    ['allow', 's3:GetObject', lockArn], ['allow', 's3:PutObject', lockArn], ['allow', 's3:DeleteObject', lockArn],
    ['deny', 's3:PutObject', stateArn], ['deny', 's3:DeleteObject', stateArn], ['deny', 's3:DeleteObjectVersion', stateArn],
    ['deny', 's3:GetObject', `${bucketArn}/envs/dev/terraform.tfstate`], ['deny', 's3:GetObject', `${bucketArn}/env:/otro/${STATE_KEY}`],
    ['deny', 's3:PutObject', `${bucketArn}/otra-clave`], ['deny', 's3:ListBucket', 'arn:aws:s3:::traza-demo-document-evidence-30012004'],
    ['deny', 's3:GetObject', 'arn:aws:s3:::traza-demo-document-evidence-30012004/document-evidence/x'],
    ['allow', 'ssm:GetParameter', `arn:aws:ssm:${REGION}:${A}:parameter/scope/prod/api/BLOCKCHAIN_EVIDENCE_MODE`],
    ['deny', 'ssm:GetParameter', `arn:aws:ssm:${REGION}:${A}:parameter/scope/prod/api/JWT_SECRET`],
    ['deny', 'ssm:GetParameter', `arn:aws:ssm:${REGION}:${A}:parameter/scope/prod/api/DATABASE_URL`],
    ['deny', 'ssm:GetParametersByPath', `arn:aws:ssm:${REGION}:${A}:parameter/scope/prod/api`],
    ['deny', 'secretsmanager:GetSecretValue', `arn:aws:secretsmanager:${REGION}:${A}:secret:rds!db-x`], ['deny', 'kms:Decrypt', `arn:aws:kms:${REGION}:${A}:key/x`],
    ['allow', 'ecs:DescribeServices', `arn:aws:ecs:${REGION}:${A}:service/scope-prod-cluster/scope-prod-api`],
    ['deny', 'ecs:DescribeServices', `arn:aws:ecs:${REGION}:${A}:service/otro-cluster/otro`],
    ['allow', 'ecs:DescribeTaskDefinition', '*'], ['deny', 'ecs:UpdateService', `arn:aws:ecs:${REGION}:${A}:service/scope-prod-cluster/scope-prod-api`],
    ['deny', 'ecs:RunTask', '*'], ['deny', 'ecs:RegisterTaskDefinition', '*'], ['deny', 'ecs:ExecuteCommand', '*'],
    ['allow', 'iam:GetRole', `arn:aws:iam::${A}:role/scope-prod-api-execution`], ['deny', 'iam:GetRole', `arn:aws:iam::${A}:role/OtroRol`],
    ['deny', 'iam:CreateRole', '*'], ['deny', 'iam:PassRole', `arn:aws:iam::${A}:role/scope-prod-api-execution`], ['deny', 'iam:PutRolePolicy', `arn:aws:iam::${A}:role/scope-prod-api-execution`],
    ['deny', 'sts:AssumeRole', `arn:aws:iam::${A}:role/scope-prod-terraform-provisioner-apply`],
    ['allow', 'rds:DescribeDBInstances', `arn:aws:rds:${REGION}:${A}:db:scope-prod-db`], ['deny', 'rds:StopDBInstance', `arn:aws:rds:${REGION}:${A}:db:scope-prod-db`],
    ['deny', 'rds:DescribeDBSnapshots', `arn:aws:rds:${REGION}:${A}:snapshot:x`],
    // Plan A (AccessDenied real): el provider refresca la instancia por id de recurso => AWS autoriza contra db:*
    ['allow', 'rds:DescribeDBInstances', `arn:aws:rds:${REGION}:${A}:db:*`], ['deny', 'rds:DescribeDBInstances', `arn:aws:rds:eu-west-1:${A}:db:*`],
    ['allow', 'rds:ListTagsForResource', `arn:aws:rds:${REGION}:${A}:db:scope-prod-db`], ['deny', 'rds:ListTagsForResource', `arn:aws:rds:${REGION}:${A}:db:otra-db`],
    ['allow', 'rds:DescribeDBSubnetGroups', `arn:aws:rds:${REGION}:${A}:subgrp:scope-prod-db`], ['deny', 'rds:DescribeDBSubnetGroups', `arn:aws:rds:${REGION}:${A}:subgrp:otro`],
    ['allow', 'states:ListStateMachineVersions', `arn:aws:states:${REGION}:${A}:stateMachine:scope-prod-ecs-sync-probe`],
    ['allow', 'states:ListStateMachineVersions', `arn:aws:states:${REGION}:${A}:stateMachine:scope-prod-issuer-provisioner`],
    ['deny', 'states:ListStateMachineVersions', `arn:aws:states:${REGION}:${A}:stateMachine:otra-maquina`], ['deny', 'states:ListStateMachineVersions', '*'],
    ['deny', 'states:ListExecutions', `arn:aws:states:${REGION}:${A}:stateMachine:scope-prod-ecs-sync-probe`], ['deny', 'states:GetExecutionHistory', '*'],
    ['allow', 'ec2:DescribeVpcs', '*'], ['deny', 'ec2:AuthorizeSecurityGroupIngress', '*'], ['deny', 'ec2:RunInstances', '*'],
    ['allow', 'elasticloadbalancing:DescribeLoadBalancers', '*'], ['deny', 'elasticloadbalancing:ModifyListener', '*'],
    ['allow', 'acm:DescribeCertificate', `arn:aws:acm:${REGION}:${A}:certificate/abc`], ['deny', 'acm:DeleteCertificate', `arn:aws:acm:${REGION}:${A}:certificate/abc`],
    ['allow', 'states:DescribeStateMachine', `arn:aws:states:${REGION}:${A}:stateMachine:scope-prod-ecs-sync-probe`], ['deny', 'states:StartExecution', `arn:aws:states:${REGION}:${A}:stateMachine:scope-prod-ecs-sync-probe`],
    ['allow', 'ecr:DescribeRepositories', `arn:aws:ecr:${REGION}:${A}:repository/scope/api`], ['deny', 'ecr:GetAuthorizationToken', '*'], ['deny', 'ecr:BatchGetImage', `arn:aws:ecr:${REGION}:${A}:repository/scope/api`],
    ['allow', 'logs:ListTagsForResource', `arn:aws:logs:${REGION}:${A}:log-group:/scope/prod/api`], ['deny', 'logs:GetLogEvents', `arn:aws:logs:${REGION}:${A}:log-group:/scope/prod/api:*`], ['deny', 'logs:DeleteLogGroup', `arn:aws:logs:${REGION}:${A}:log-group:/scope/prod/api`],
    ['deny', 'route53:ChangeResourceRecordSets', '*'], ['deny', 'servicediscovery:DeleteNamespace', '*'],
    // acciones sin autorizacion a nivel de recurso: se evaluan contra "*" (como lo hace AWS); un ARN concreto no debe ser el que las habilite
    ['allow', 'logs:DescribeLogGroups', '*'], ['deny', 'logs:DescribeLogGroups', '*', { 'aws:RequestedRegion': 'eu-west-1' }],
    ['deny', 'logs:GetLogEvents', '*'], ['deny', 'logs:FilterLogEvents', '*'], ['deny', 'logs:StartQuery', '*'], ['deny', 'logs:GetQueryResults', '*'], ['deny', 'logs:CreateLogGroup', '*'], ['deny', 'logs:PutRetentionPolicy', '*'],
    ['allow', 'servicediscovery:ListTagsForResource', '*'],
    // Las llamadas EXACTAS de infra/terraform/guards/pre-plan-guard.mjs deben poder hacerse con este rol
    ['allow', 'ecs:DescribeClusters', `arn:aws:ecs:${REGION}:${A}:cluster/scope-prod-cluster`],
    ['allow', 'ecs:DescribeServices', `arn:aws:ecs:${REGION}:${A}:service/scope-prod-cluster/scope-prod-ai`],
    ['allow', 'ecs:DescribeTaskDefinition', `arn:aws:ecs:${REGION}:${A}:task-definition/scope-prod-migrator:8`],
    ['allow', 'ssm:GetParameter', `arn:aws:ssm:${REGION}:${A}:parameter/scope/prod/api/BLOCKCHAIN_EVIDENCE_MODE`]
  ];
  const wrong = scenarios.filter(([want, a, r, ctx]) => (want === 'allow') !== (evaluate(permissions, a, r, ctx) === 'allow'));
  check(wrong.length === 0, `${scenarios.length} escenarios permitir/denegar del evaluador local`, wrong.map(([w, a, r]) => `${a} sobre ${r}: se esperaba ${w}`).join('; '));
  // fuera de la region esperada, ni siquiera los Describe con "*"
  check(evaluate(permissions, 'ec2:DescribeVpcs', '*', { 'aws:RequestedRegion': 'eu-west-1' }) !== 'allow', 'los Describe con "*" no se permiten en otra region', 'se permite en otra region');

  return results;
}

export function observedCoverage({ permissionsText, observedText }) {
  const permissions = JSON.parse(render(permissionsText));
  const allowed = new Set(permissions.Statement.filter((s) => s.Effect === 'Allow').flatMap((s) => asArray(s.Action)));
  const lines = observedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const missing = [];
  const writes = [];
  for (const line of lines) {
    const [src, name] = line.includes(':') ? line.split(':') : ['', line];
    const action = `${src.replace(/\.amazonaws\.com$/, '').replace('elasticloadbalancing', 'elasticloadbalancing')}:${name}`;
    if (WRITE_VERB.test(action) || /^(PutObject|DeleteObject)$/.test(name)) writes.push(action);
    else if (!allowed.has(action)) missing.push(action);
  }
  return { missing: [...new Set(missing)], writes: [...new Set(writes)], total: lines.length };
}

export function main({ argv, out = console.log, err = console.error }) {
  let iamDir = DEFAULT_IAM_DIR;
  let prodDir = DEFAULT_PROD_DIR;
  let observed;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') iamDir = argv[++i];
    else if (argv[i] === '--prod') prodDir = argv[++i];
    else if (argv[i] === '--observed') observed = argv[++i];
    else {
      err(`argumento desconocido: ${argv[i]}`);
      return 2;
    }
  }
  try {
    const permissionsText = fs.readFileSync(path.join(iamDir, 'terraform-plan-role.permissions.template.json'), 'utf8');
    const trustText = fs.readFileSync(path.join(iamDir, 'terraform-plan-role.trust.template.json'), 'utf8');
    const inventory = JSON.parse(fs.readFileSync(path.join(iamDir, 'provider-reads.inventory.json'), 'utf8'));
    const results = runChecks({ permissionsText, trustText, inventory, codeTypes: codeResourceTypes(prodDir), managedSsm: codeManagedSsmNames(prodDir) });
    for (const r of results) out(`${r.ok ? 'ok   ' : 'FAIL '} ${r.name}${r.ok ? '' : ` — ${r.why}`}`);
    let failed = results.filter((r) => !r.ok).length;
    if (observed) {
      const cov = observedCoverage({ permissionsText, observedText: fs.readFileSync(observed, 'utf8') });
      out(`observado: ${cov.total} eventos; sin cobertura: ${cov.missing.length}; escrituras observadas: ${cov.writes.length}`);
      for (const m of cov.missing) out(`FAIL accion observada SIN cobertura: ${m}`);
      for (const w of cov.writes) out(`AVISO escritura observada (no proviene de un plan): ${w}`);
      failed += cov.missing.length;
    }
    out(failed === 0 ? '\nIAM POLICY CHECK: sin incumplimientos. Esto NO prueba que la politica funcione en AWS (no se creo ni se asumio el rol).' : `\nIAM POLICY CHECK: ${failed} incumplimiento(s).`);
    return failed === 0 ? 0 : 1;
  } catch (e) {
    err(`NO EVALUADO: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) process.exit(main({ argv: process.argv.slice(2) }));
