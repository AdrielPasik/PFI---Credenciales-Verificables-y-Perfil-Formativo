#!/usr/bin/env node
/**
 * Guarda previa al `terraform plan` de produccion — SOLO LECTURA, FAIL-CLOSED.
 *
 * Para que sirve. Terraform es la fuente de verdad de `desired_count` y de las imagenes
 * (`aws_ecs_service.desired_count = enable_services ? N : 0`, sin `ignore_changes`), pero la
 * capacidad tambien se cambia fuera de Terraform (scripts/scope-on.ps1, scope-off.ps1) y el
 * `terraform.tfvars` es un archivo local que puede estar viejo. Un `apply` con entradas viejas
 * apagaria la API o devolveria una imagen anterior. Esta guarda compara, ANTES del plan, lo
 * que el operador va a usar como entrada contra lo que AWS esta ejecutando, y se detiene si
 * hay una diferencia material o si no puede comprobarla.
 *
 * Que NO es.
 *   - No es un plan. "Sin diferencias" aqui NO significa "terraform plan dara cero cambios":
 *     compara unas pocas propiedades criticas; el plan completo sigue siendo obligatorio y se
 *     revisa linea por linea.
 *   - No corrige nada. No hay ningun modo "arreglar".
 *   - No lee secretos: solo nombres de secretos de las task definitions (nunca su valor) y UN
 *     parametro SSM de tipo String (modo de blockchain), sin descifrado.
 *
 * Solo ejecuta operaciones AWS de lectura de una lista cerrada (ver ALLOWED_AWS_OPERATIONS).
 *
 * Codigos de salida:  0 = nada material difiere ·  1 = hay diferencias ·
 *                     2 = no se pudo comprobar (datos, permisos, formato, region/cluster/identidad).
 *
 * Uso:
 *   node infra/terraform/guards/pre-plan-guard.mjs [--tfvars <archivo>]... [--profile <perfil>]
 * Sin --tfvars lee infra/terraform/prod/terraform.tfvars y luego prod/*.auto.tfvars (el orden en
 * que Terraform los carga; el ultimo gana). Pasa los archivos que de verdad vas a usar.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_REGION = 'us-east-1';
export const EXPECTED_CLUSTER = 'scope-prod-cluster';
export const API_SERVICE = 'scope-prod-api';
export const AI_SERVICE = 'scope-prod-ai';
export const MIGRATOR_FAMILY = 'scope-prod-migrator';
export const PROVISIONER_FAMILY = 'scope-prod-provisioner';
export const BLOCKCHAIN_MODE_PARAMETER = '/scope/prod/api/BLOCKCHAIN_EVIDENCE_MODE';

/** Variables que el operador debe fijar EXPLICITAMENTE: un default no es una afirmacion sobre AWS. */
export const REQUIRED_TFVARS = [
  'enable_services',
  'api_desired_count',
  'ai_desired_count',
  'api_image_tag',
  'ai_image_tag',
  'migrator_image_tag',
  'provisioner_image_digest',
  'web_origin',
  'blockchain_evidence_mode',
  'profile_embeddings_enabled',
  'ai_area_embeddings_enabled'
];

// ---------------------------------------------------------------------------
// Solo lectura: lista cerrada de operaciones AWS
// ---------------------------------------------------------------------------

/** servicio -> operaciones permitidas. Cualquier otra cosa lanza ANTES de llamar a AWS. */
export const ALLOWED_AWS_OPERATIONS = {
  sts: ['get-caller-identity'],
  ecs: ['describe-clusters', 'describe-services', 'describe-task-definition'],
  ssm: ['get-parameter']
};
const ALLOWED_SSM_PARAMETERS = new Set([BLOCKCHAIN_MODE_PARAMETER]);

export class ReadOnlyViolation extends Error {}

export function assertReadOnlyAwsCall(args) {
  const [service, operation] = args;
  const operations = ALLOWED_AWS_OPERATIONS[service];

  if (!operations || !operations.includes(operation)) {
    throw new ReadOnlyViolation(`operacion AWS no permitida por la guarda: ${service} ${operation}`);
  }

  if (args.some((a) => a === '--with-decryption')) {
    throw new ReadOnlyViolation('--with-decryption esta prohibido: la guarda no recupera secretos');
  }

  if (service === 'ssm') {
    const i = args.indexOf('--name');
    const name = i >= 0 ? args[i + 1] : undefined;
    if (!name || !ALLOWED_SSM_PARAMETERS.has(name)) {
      throw new ReadOnlyViolation(`parametro SSM no permitido: ${name ?? '(sin --name)'}`);
    }
    if (!args.includes('--no-with-decryption')) {
      throw new ReadOnlyViolation('ssm get-parameter debe llevar --no-with-decryption');
    }
  }
}

/** Ejecutor real. Un `runAws` falso lo reemplaza en los tests (recibe los mismos args). */
export function createAwsRunner({ profile, execFile = execFileSync } = {}) {
  return (args) => {
    assertReadOnlyAwsCall(args);
    const full = [...args, '--region', EXPECTED_REGION, '--output', 'json', ...(profile ? ['--profile', profile] : [])];
    const out = execFile('aws', full, {
      encoding: 'utf8',
      env: { ...process.env, AWS_PAGER: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024
    });
    return JSON.parse(out);
  };
}

// ---------------------------------------------------------------------------
// tfvars
// ---------------------------------------------------------------------------

export function parseTfvars(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, '');
    if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"')) {
      const end = v.indexOf('"', 1);
      if (end === -1) continue;
      values[m[1]] = v.slice(1, end);
      continue;
    }
    v = v.replace(/\s+(#|\/\/).*$/, '').trim();
    if (v === 'true') values[m[1]] = true;
    else if (v === 'false') values[m[1]] = false;
    else if (/^-?\d+$/.test(v)) values[m[1]] = Number(v);
    else values[m[1]] = v;
  }
  return values;
}

export function loadTfvars(files, readFile = (f) => fs.readFileSync(f, 'utf8')) {
  const merged = {};
  for (const f of files) Object.assign(merged, parseTfvars(readFile(f)));
  return merged;
}

// ---------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------

const mask = (s) => String(s).replace(/\d{12}/g, '<ACCT>');

class Report {
  constructor() {
    this.rows = [];
  }
  ok(check, detail) {
    this.rows.push({ status: 'OK', check, detail });
  }
  diff(check, expected, observed) {
    this.rows.push({ status: 'DIFF', check, detail: `esperado ${JSON.stringify(expected)} · observado ${JSON.stringify(observed)}` });
  }
  info(check, detail) {
    this.rows.push({ status: 'INFO', check, detail });
  }
  get hasDiff() {
    return this.rows.some((r) => r.status === 'DIFF');
  }
}

const envOf = (taskDef) => Object.fromEntries((taskDef.containerDefinitions?.[0]?.environment ?? []).map((e) => [e.name, e.value]));
const secretNamesOf = (taskDef) => (taskDef.containerDefinitions?.[0]?.secrets ?? []).map((s) => s.name);
const imageOf = (taskDef) => taskDef.containerDefinitions?.[0]?.image ?? '';

/** `.../scope/api:<tag>` -> tag. null si la imagen esta por digest o no tiene el repo esperado. */
export function imageTag(image, repository) {
  const m = new RegExp(`/${repository}:([A-Za-z0-9_][A-Za-z0-9._-]{0,127})$`).exec(image);
  return m ? m[1] : null;
}
export function imageDigest(image, repository) {
  const m = new RegExp(`/${repository}@(sha256:[0-9a-f]{64})$`).exec(image);
  return m ? m[1] : null;
}

class Abort extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

function compare(report, check, expected, observed) {
  if (expected === observed) report.ok(check, `${JSON.stringify(observed)}`);
  else report.diff(check, expected, observed);
}

export function runGuard({ tfvars, runAws }) {
  const report = new Report();

  // 1. Entradas del operador: todas explicitas.
  const absent = REQUIRED_TFVARS.filter((k) => !(k in tfvars));
  if (absent.length > 0) {
    throw new Abort(
      `faltan variables en el/los tfvars que vas a usar: ${absent.join(', ')}. ` +
        'Un default de Terraform no es una afirmacion sobre lo que corre en AWS; ' +
        'completalas con valores verificados (ver infra/terraform/reconciliation/).'
    );
  }

  const bad = [];
  if (typeof tfvars.enable_services !== 'boolean') bad.push('enable_services (bool)');
  if (!Number.isInteger(tfvars.api_desired_count)) bad.push('api_desired_count (entero)');
  if (!Number.isInteger(tfvars.ai_desired_count)) bad.push('ai_desired_count (entero)');
  if (typeof tfvars.profile_embeddings_enabled !== 'boolean') bad.push('profile_embeddings_enabled (bool)');
  if (typeof tfvars.ai_area_embeddings_enabled !== 'boolean') bad.push('ai_area_embeddings_enabled (bool)');
  if (bad.length > 0) throw new Abort(`tipos invalidos en tfvars: ${bad.join(', ')}`);

  // 2. Identidad (nunca root) y region.
  const identity = runAws(['sts', 'get-caller-identity']);
  const arn = String(identity?.Arn ?? '');
  if (arn === '') throw new Abort('no se pudo determinar la identidad AWS');
  if (/:root$/.test(arn)) throw new Abort('la identidad es root: abortando');
  report.ok('identidad AWS (no root)', mask(arn));

  // 3. Cluster correcto.
  const clusters = runAws(['ecs', 'describe-clusters', '--clusters', EXPECTED_CLUSTER]);
  const cluster = clusters?.clusters?.[0];
  if (!cluster || cluster.clusterName !== EXPECTED_CLUSTER) throw new Abort(`no se encontro el cluster ${EXPECTED_CLUSTER}`);
  if (!String(cluster.clusterArn ?? '').includes(`:${EXPECTED_REGION}:`)) {
    throw new Abort(`el cluster no esta en la region esperada (${EXPECTED_REGION})`);
  }
  if (cluster.status !== 'ACTIVE') throw new Abort(`el cluster no esta ACTIVE (${cluster.status})`);
  report.ok('cluster y region', `${EXPECTED_CLUSTER} en ${EXPECTED_REGION}, ACTIVE`);

  // 4. Servicios.
  const described = runAws(['ecs', 'describe-services', '--cluster', EXPECTED_CLUSTER, '--services', API_SERVICE, AI_SERVICE]);
  if ((described?.failures ?? []).length > 0) {
    throw new Abort(`ECS informa fallas al describir los servicios: ${JSON.stringify(described.failures.map((f) => f.reason))}`);
  }
  const byName = Object.fromEntries((described?.services ?? []).map((s) => [s.serviceName, s]));
  for (const name of [API_SERVICE, AI_SERVICE]) {
    if (!byName[name]) throw new Abort(`no se encontro el servicio ${name}`);
    if (byName[name].status !== 'ACTIVE') throw new Abort(`el servicio ${name} no esta ACTIVE (${byName[name].status})`);
  }
  const api = byName[API_SERVICE];
  const ai = byName[AI_SERVICE];

  const wantedApi = tfvars.enable_services ? tfvars.api_desired_count : 0;
  const wantedAi = tfvars.enable_services ? tfvars.ai_desired_count : 0;
  compare(report, 'API desired_count (lo que Terraform impondria)', wantedApi, api.desiredCount);
  compare(report, 'IA desired_count (lo que Terraform impondria)', wantedAi, ai.desiredCount);
  compare(report, 'API running == desired', api.desiredCount, api.runningCount);
  compare(report, 'IA running == desired', ai.desiredCount, ai.runningCount);
  compare(report, 'API pending', 0, api.pendingCount);
  compare(report, 'IA pending', 0, ai.pendingCount);

  // 5. Politica de despliegue (la API es 0/100 por el escritor unico de nonce de blockchain).
  compare(report, 'API deployment minimumHealthyPercent', 0, api.deploymentConfiguration?.minimumHealthyPercent);
  compare(report, 'API deployment maximumPercent', 100, api.deploymentConfiguration?.maximumPercent);
  compare(report, 'IA deployment minimumHealthyPercent', 100, ai.deploymentConfiguration?.minimumHealthyPercent);
  compare(report, 'IA deployment maximumPercent', 200, ai.deploymentConfiguration?.maximumPercent);
  for (const [label, svc] of [['API', api], ['IA', ai]]) {
    const dep = svc.deployments ?? [];
    const primary = dep.find((d) => d.status === 'PRIMARY');
    if (dep.length !== 1 || !primary) report.diff(`${label}: un unico despliegue PRIMARY`, '1 PRIMARY', `${dep.length} despliegue(s)`);
    else compare(report, `${label}: ultimo rollout`, 'COMPLETED', primary.rolloutState);
    compare(report, `${label}: circuit breaker (enable/rollback)`, 'true/true', `${svc.deploymentConfiguration?.deploymentCircuitBreaker?.enable}/${svc.deploymentConfiguration?.deploymentCircuitBreaker?.rollback}`);
  }

  // 6. Task definitions efectivas.
  const apiTd = runAws(['ecs', 'describe-task-definition', '--task-definition', api.taskDefinition])?.taskDefinition;
  const aiTd = runAws(['ecs', 'describe-task-definition', '--task-definition', ai.taskDefinition])?.taskDefinition;
  const migTd = runAws(['ecs', 'describe-task-definition', '--task-definition', MIGRATOR_FAMILY])?.taskDefinition;
  const provTd = runAws(['ecs', 'describe-task-definition', '--task-definition', PROVISIONER_FAMILY])?.taskDefinition;
  for (const [label, td] of [['API', apiTd], ['IA', aiTd], ['migrador', migTd], ['provisioner', provTd]]) {
    if (!td) throw new Abort(`no se pudo leer la task definition de ${label}`);
  }

  const apiImage = imageOf(apiTd);
  const aiImage = imageOf(aiTd);
  const migImage = imageOf(migTd);
  const provImage = imageOf(provTd);

  const apiTag = imageTag(apiImage, 'scope/api');
  const aiTag = imageTag(aiImage, 'scope/ai');
  const migTag = imageTag(migImage, 'scope/api');
  const provDigest = imageDigest(provImage, 'scope/api');
  if (apiTag === null) throw new Abort('la imagen viva de la API no esta referenciada por tag (no se puede comparar con api_image_tag)');
  if (aiTag === null) throw new Abort('la imagen viva de la IA no esta referenciada por tag (no se puede comparar con ai_image_tag)');
  if (migTag === null) throw new Abort('la ultima revision ACTIVA del migrador no esta referenciada por tag (no se puede comparar con migrator_image_tag)');
  if (provDigest === null) throw new Abort('la imagen viva del provisioner no esta referenciada por digest');

  compare(report, `API: imagen efectiva (${api.taskDefinition.split('/').pop()}) == api_image_tag`, tfvars.api_image_tag, apiTag);
  compare(report, `IA: imagen efectiva (${ai.taskDefinition.split('/').pop()}) == ai_image_tag`, tfvars.ai_image_tag, aiTag);
  compare(report, `migrador: ultima revision ACTIVA (:${migTd.revision}) == migrator_image_tag`, tfvars.migrator_image_tag, migTag);
  compare(report, 'provisioner: digest == provisioner_image_digest', tfvars.provisioner_image_digest, provDigest);

  // 7. Origen web y flags.
  const apiEnv = envOf(apiTd);
  const aiEnv = envOf(aiTd);
  compare(report, 'API WEB_ORIGIN == web_origin (CORS)', tfvars.web_origin, apiEnv.WEB_ORIGIN ?? '');
  compare(report, 'API PROFILE_EMBEDDINGS_ENABLED', String(tfvars.profile_embeddings_enabled), apiEnv.PROFILE_EMBEDDINGS_ENABLED);
  compare(report, 'IA PROFILE_EMBEDDINGS_ENABLED', String(tfvars.profile_embeddings_enabled), aiEnv.PROFILE_EMBEDDINGS_ENABLED);
  compare(report, 'IA AI_AREA_EMBEDDINGS_ENABLED', String(tfvars.ai_area_embeddings_enabled), aiEnv.AI_AREA_EMBEDDINGS_ENABLED);

  // 8. Blockchain (solo nombres de secretos y un parametro String).
  const param = runAws(['ssm', 'get-parameter', '--name', BLOCKCHAIN_MODE_PARAMETER, '--no-with-decryption'])?.Parameter;
  if (!param) throw new Abort('no se pudo leer el modo de blockchain de SSM');
  if (param.Type !== 'String') throw new Abort('el parametro de modo de blockchain no es de tipo String: no se usa su valor');
  compare(report, 'blockchain: BLOCKCHAIN_EVIDENCE_MODE (SSM) == blockchain_evidence_mode', tfvars.blockchain_evidence_mode, param.Value);
  const hasRpc = secretNamesOf(apiTd).includes('CREDENTIAL_REGISTRY_RPC_URL');
  compare(report, 'blockchain: la API referencia el secreto RPC <=> modo credential_registry', tfvars.blockchain_evidence_mode === 'credential_registry', hasRpc);

  // 9. Recuperacion de contrasena (informativo antes del primer despliegue; comparado despues).
  const live = {
    mail_transport: apiEnv.MAIL_TRANSPORT,
    trust_proxy_hops: apiEnv.TRUST_PROXY_HOPS,
    web_public_base_url: apiEnv.WEB_PUBLIC_BASE_URL
  };
  if (live.mail_transport === undefined && live.trust_proxy_hops === undefined) {
    report.info('recuperacion de contrasena', 'la task definition viva aun NO tiene MAIL_TRANSPORT / TRUST_PROXY_HOPS (esperado antes del primer despliegue de recuperacion)');
  } else {
    compare(report, 'recuperacion: MAIL_TRANSPORT', tfvars.mail_transport ?? 'disabled', live.mail_transport);
    compare(report, 'recuperacion: TRUST_PROXY_HOPS', '1', live.trust_proxy_hops);
    compare(report, 'recuperacion: WEB_PUBLIC_BASE_URL', tfvars.web_public_base_url ?? '', live.web_public_base_url ?? '');
    const hasResend = secretNamesOf(apiTd).includes('RESEND_API_KEY');
    compare(report, 'recuperacion: la API referencia RESEND_API_KEY <=> mail_transport = resend', (tfvars.mail_transport ?? 'disabled') === 'resend', hasResend);
  }

  return report;
}

export const DISCLAIMER =
  'AVISO: esta guarda compara unas pocas propiedades criticas. NO prueba que `terraform plan` vaya a mostrar cero cambios ' +
  'ni sustituye la revision del plan completo. No corrigio nada ni escribio nada en AWS.';

export function render(report) {
  const lines = report.rows.map((r) => `${r.status.padEnd(13)} ${r.check} — ${mask(r.detail)}`);
  return lines.join('\n');
}

/** Devuelve el codigo de salida y escribe el informe con `out`. */
export function main({ tfvarsFiles, profile, runAws, readFile, out = console.log, err = console.error }) {
  try {
    const tfvars = loadTfvars(tfvarsFiles, readFile);
    const report = runGuard({ tfvars, runAws: runAws ?? createAwsRunner({ profile }) });
    out(render(report));
    out('');
    if (report.hasDiff) {
      out('RESULTADO: DIFERENCIAS MATERIALES — NO ejecutes `terraform apply` con estas entradas. Reconcilia el tfvars con AWS (o decide el cambio) antes.');
      out(DISCLAIMER);
      return 1;
    }
    out('RESULTADO: las propiedades criticas comparadas coinciden con AWS.');
    out(DISCLAIMER);
    return 0;
  } catch (e) {
    const msg = mask(e instanceof Error ? e.message : String(e));
    err(`ABORTADO (no comprobado): ${msg}`);
    err(DISCLAIMER);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const argv = process.argv.slice(2);
  const files = [];
  let profile;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--tfvars') files.push(argv[++i]);
    else if (argv[i] === '--profile') profile = argv[++i];
    else {
      console.error(`argumento desconocido: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (files.length === 0) {
    const prod = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prod');
    const base = path.join(prod, 'terraform.tfvars');
    if (fs.existsSync(base)) files.push(base);
    for (const f of fs.readdirSync(prod).filter((n) => n.endsWith('.auto.tfvars')).sort()) files.push(path.join(prod, f));
  }
  if (files.length === 0) {
    console.error('ABORTADO (no comprobado): no hay ningun tfvars. Pasa --tfvars <archivo>.');
    process.exit(2);
  }
  process.exit(main({ tfvarsFiles: files, profile }));
}
