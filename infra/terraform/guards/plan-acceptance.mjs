#!/usr/bin/env node
/**
 * Verificador de ACEPTACION de un plan de Terraform — lee un archivo, NO ejecuta Terraform,
 * NO llama a AWS.
 *
 * Entrada: la salida de `terraform show -json <planfile>` (guardada en un archivo local).
 * Imprime SOLO direcciones de recursos, acciones y nombres de variables de entorno/secretos:
 * nunca valores (los valores de entorno y secretos del plan pueden ser sensibles).
 *
 *   node infra/terraform/guards/plan-acceptance.mjs --mode baseline   --plan plan.json
 *   node infra/terraform/guards/plan-acceptance.mjs --mode integrated --plan plan.json [--allow-api-image-change]
 *   node infra/terraform/guards/plan-acceptance.mjs --mode migrator-only --expected-image-tag <sha40> --plan plan.json
 *
 * Modos
 *   baseline    codigo `origin/main` SIN recuperacion. Aceptable unicamente: NINGUN cambio
 *               ("No changes"). Cualquier otra cosa se EXPLICA antes de seguir; nada se "corrige".
 *   integrated  codigo integrado con las mismas entradas y la recuperacion en `disabled`.
 *               Aceptable unicamente:
 *                 - aws_ecs_task_definition.api: reemplazo (nueva revision) donde SOLO se agregan las
 *                   variables WEB_PUBLIC_BASE_URL, MAIL_TRANSPORT, MAIL_FROM, TRUST_PROXY_HOPS
 *                   (MAIL_TRANSPORT = disabled; sin RESEND_API_KEY), sin quitar ninguna variable ni
 *                   secreto y sin cambiar ningun valor existente (la imagen incluida; con
 *                   --allow-api-image-change se admite el cambio de imagen del paso de despliegue);
 *                 - aws_ecs_service.api[0]: solo `task_definition`, con desired_count y 0/100 intactos.
 *               Todo lo demas es RECHAZO.
 *
 *   migrator-only  publicacion de la imagen del MIGRADOR (paso previo a migrar, sin cortar la API).
 *               Aceptable unicamente: el reemplazo (delete+create, por `container_definitions`) de
 *               aws_ecs_task_definition.migrator donde SOLO cambia la imagen del contenedor `migrator`
 *               a `<mismo repositorio>:<--expected-image-tag>` (SHA completo, obligatorio). Cualquier otro
 *               recurso, atributo, variable de entorno, secreto, comando u output que cambie es RECHAZO.
 *               `--allow-api-image-change` no es valido aqui; `--expected-image-tag` no es valido fuera.
 *
 * Codigos de salida: 0 aceptable · 1 rechazado (con los motivos) · 2 no se pudo evaluar.
 * Un 0 NO sustituye la lectura humana del plan completo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECOVERY_ENV = ['WEB_PUBLIC_BASE_URL', 'MAIL_TRANSPORT', 'MAIL_FROM', 'TRUST_PROXY_HOPS'];
export const API_TASK_DEF = 'aws_ecs_task_definition.api';
export const API_SERVICE = 'aws_ecs_service.api[0]';
export const AI_SERVICE = 'aws_ecs_service.ai[0]';

export class Unevaluable extends Error {}

const actionsOf = (rc) => rc.change?.actions ?? [];
const isNoop = (rc) => actionsOf(rc).every((a) => a === 'no-op' || a === 'read');

function containers(value, address, side) {
  const raw = value?.container_definitions;
  if (raw === undefined || raw === null) throw new Unevaluable(`${address}: sin container_definitions en ${side}`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Unevaluable(`${address}: container_definitions no es JSON (${side})`);
  }
}

const envMap = (c) => Object.fromEntries((c.environment ?? []).map((e) => [e.name, e.value]));
const secretNames = (c) => (c.secrets ?? []).map((s) => s.name);

// ---------------------------------------------------------------------------------------------
// migrator-only: SOLO la nueva revision de la task definition del migrador, con la imagen
// expresamente autorizada. Funciones independientes: no comparten reglas con baseline/integrated.
// ---------------------------------------------------------------------------------------------
export const MIGRATOR_TASK_DEF = 'aws_ecs_task_definition.migrator';
export const FULL_SHA = /^[0-9a-f]{40}$/;

/** Atributos que el provider (re)calcula en un reemplazo; su cambio no es una decision de configuracion. */
const MIGRATOR_COMPUTED = new Set(['id', 'arn', 'arn_without_revision', 'revision', 'enable_fault_injection']);
/** Pueden quedar "desconocidos" en el plan de un reemplazo aunque la configuracion no haya cambiado. */
const MIGRATOR_UNKNOWN_OK = new Set(['requires_compatibilities', 'runtime_platform']);

const isEmptyValue = (v) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/** Serializacion estable (claves ordenadas) que trata null/""/[]/{} como "vacio" a cualquier profundidad. */
function canonical(v) {
  if (Array.isArray(v)) return v.filter((x) => !isEmptyValue(x) || typeof x !== 'object').map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v).sort().filter((k) => !isEmptyValue(v[k])).map((k) => [k, canonical(v[k])])
    );
  }
  return v;
}
const same = (a, b) => (isEmptyValue(a) && isEmptyValue(b)) || JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function splitImage(image) {
  const m = typeof image === 'string' ? /^([^@\s]+):([^:@/\s]+)$/.exec(image) : null;
  return m ? { repo: m[1], tag: m[2] } : null;
}

function evaluateMigratorOnly({ plan, expectedImageTag }) {
  if (typeof expectedImageTag !== 'string' || !FULL_SHA.test(expectedImageTag)) {
    throw new Unevaluable('migrator-only exige --expected-image-tag con el SHA completo (40 caracteres hexadecimales en minuscula)');
  }

  const reasons = [];
  const notes = [];
  const changes = plan.resource_changes.filter((rc) => !isNoop(rc));

  for (const rc of changes) {
    if (rc.address !== MIGRATOR_TASK_DEF) {
      const destructive = actionsOf(rc).includes('delete') ? ' [DESTRUCTIVO]' : '';
      reasons.push(`cambio NO permitido en ${rc.address} (${actionsOf(rc).join('+')})${destructive}`);
    }
  }

  const td = changes.find((rc) => rc.address === MIGRATOR_TASK_DEF);
  if (!td) {
    reasons.push(`no aparece ${MIGRATOR_TASK_DEF}: se esperaba su reemplazo con la imagen autorizada`);
  } else {
    const change = td.change ?? {};
    if ([...actionsOf(td)].sort().join('+') !== 'create+delete') {
      reasons.push(`${MIGRATOR_TASK_DEF}: la accion debe ser un reemplazo (delete+create), es ${actionsOf(td).join('+')}`);
    }
    if (JSON.stringify(change.replace_paths) !== '[["container_definitions"]]') {
      reasons.push(`${MIGRATOR_TASK_DEF}: el reemplazo debe deberse solo a container_definitions (replace_paths = ${JSON.stringify(change.replace_paths ?? null)})`);
    }

    const before = change.before ?? {};
    const after = change.after ?? {};
    const unknown = change.after_unknown ?? {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key === 'container_definitions' || MIGRATOR_COMPUTED.has(key)) continue;
      const isUnknown = unknown[key] === true || (typeof unknown[key] === 'object' && unknown[key] !== null && !isEmptyValue(unknown[key]));
      if (isUnknown) {
        if (!MIGRATOR_UNKNOWN_OK.has(key)) reasons.push(`${MIGRATOR_TASK_DEF}: ${key} queda desconocido hasta el apply (no es un atributo calculado admitido)`);
        continue;
      }
      if (!same(before[key], after[key])) reasons.push(`${MIGRATOR_TASK_DEF}: cambia ${key} (solo se admite la imagen del contenedor)`);
    }

    let b;
    let a;
    try {
      b = containers(before, MIGRATOR_TASK_DEF, 'before');
      a = containers(after, MIGRATOR_TASK_DEF, 'after');
    } catch (e) {
      if (e instanceof Unevaluable) throw e;
      throw new Unevaluable(`${MIGRATOR_TASK_DEF}: container_definitions ilegible`);
    }
    if (!Array.isArray(b) || !Array.isArray(a) || b.length !== 1 || a.length !== 1) {
      reasons.push(`${MIGRATOR_TASK_DEF}: se espera exactamente un contenedor antes y despues (hay ${b?.length ?? '?'} y ${a?.length ?? '?'})`);
    } else if (b[0].name !== 'migrator' || a[0].name !== 'migrator') {
      reasons.push(`${MIGRATOR_TASK_DEF}: el contenedor debe llamarse "migrator"`);
    } else {
      const bi = splitImage(b[0].image);
      const ai = splitImage(a[0].image);
      if (!bi || !ai) {
        reasons.push(`${MIGRATOR_TASK_DEF}: la imagen debe tener la forma <repositorio>:<tag> (sin digest)`);
      } else {
        if (bi.repo !== ai.repo) reasons.push(`${MIGRATOR_TASK_DEF}: cambia el repositorio de la imagen`);
        if (ai.tag !== expectedImageTag) reasons.push(`${MIGRATOR_TASK_DEF}: el tag de la imagen nueva no es el autorizado (${ai.tag.slice(0, 12)}… != ${expectedImageTag.slice(0, 12)}…)`);
        if (bi.tag === ai.tag) reasons.push(`${MIGRATOR_TASK_DEF}: la imagen no cambia de tag (no es el reemplazo esperado)`);
        if (bi.repo === ai.repo && ai.tag === expectedImageTag && bi.tag !== ai.tag) notes.push(`imagen del migrador: ${bi.tag.slice(0, 12)}… -> ${ai.tag.slice(0, 12)}… (autorizada con --expected-image-tag)`);
      }
      const { image: _bi, ...restB } = b[0];
      const { image: _ai, ...restA } = a[0];
      for (const key of new Set([...Object.keys(restB), ...Object.keys(restA)])) {
        if (!same(restB[key], restA[key])) reasons.push(`${MIGRATOR_TASK_DEF}: el contenedor cambia ${key}`);
      }
    }
  }

  for (const [name, oc] of Object.entries(plan.output_changes ?? {})) {
    if (!(oc?.actions ?? []).every((x) => x === 'no-op')) reasons.push(`cambia el output ${name}`);
  }
  const variable = plan.variables?.migrator_image_tag;
  if (variable && variable.value !== undefined && variable.value !== expectedImageTag) {
    reasons.push('la variable migrator_image_tag del plan no coincide con el tag autorizado');
  }

  return { reasons: [...new Set(reasons)], notes, changes: changes.map((c) => `${c.address} [${actionsOf(c).join('+')}]`) };
}

export function evaluate({ plan, mode, allowApiImageChange = false, expectedImageTag }) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.resource_changes)) {
    throw new Unevaluable('no parece la salida de `terraform show -json` (falta resource_changes)');
  }
  if (!['baseline', 'integrated', 'migrator-only'].includes(mode)) throw new Unevaluable(`modo desconocido: ${mode}`);
  if (mode === 'migrator-only') {
    if (allowApiImageChange) throw new Unevaluable('--allow-api-image-change no es valido en el modo migrator-only');
    return evaluateMigratorOnly({ plan, expectedImageTag });
  }
  if (expectedImageTag !== undefined) throw new Unevaluable('--expected-image-tag solo es valido en el modo migrator-only');

  const reasons = [];
  const notes = [];
  const changes = plan.resource_changes.filter((rc) => !isNoop(rc));

  if (mode === 'baseline') {
    for (const rc of changes) {
      const destructive = actionsOf(rc).includes('delete') ? ' [DESTRUCTIVO]' : '';
      reasons.push(`cambio en ${rc.address} (${actionsOf(rc).join('+')})${destructive}: la linea base debe ser "No changes"`);
    }
    return { reasons, notes, changes: changes.map((c) => `${c.address} [${actionsOf(c).join('+')}]`) };
  }

  for (const rc of changes) {
    if (actionsOf(rc).includes('delete') && rc.address !== API_TASK_DEF) {
      reasons.push(`DESTRUCCION/REEMPLAZO de ${rc.address} (${actionsOf(rc).join('+')})`);
    }
  }

  // ---- integrated ---------------------------------------------------------
  const allowed = new Set([API_TASK_DEF, API_SERVICE]);
  for (const rc of changes) {
    if (!allowed.has(rc.address)) reasons.push(`cambio NO permitido en ${rc.address} (${actionsOf(rc).join('+')})`);
  }

  const taskDef = changes.find((c) => c.address === API_TASK_DEF);
  if (!taskDef) {
    reasons.push(`no aparece ${API_TASK_DEF}: se esperaba una nueva revision con las variables de recuperacion`);
  } else {
    const before = containers(taskDef.change.before, API_TASK_DEF, 'before')[0];
    const after = containers(taskDef.change.after, API_TASK_DEF, 'after')[0];
    const b = envMap(before);
    const a = envMap(after);

    for (const name of Object.keys(b)) {
      if (!(name in a)) reasons.push(`API: desaparece la variable de entorno ${name}`);
      else if (a[name] !== b[name]) reasons.push(`API: cambia el valor de la variable existente ${name}`);
    }
    const added = Object.keys(a).filter((n) => !(n in b));
    for (const name of added) if (!RECOVERY_ENV.includes(name)) reasons.push(`API: variable de entorno nueva NO esperada: ${name}`);
    for (const name of RECOVERY_ENV) if (!added.includes(name)) reasons.push(`API: falta agregar ${name}`);
    if (a.MAIL_TRANSPORT !== undefined && a.MAIL_TRANSPORT !== 'disabled') reasons.push('API: MAIL_TRANSPORT no es "disabled"');
    if (a.TRUST_PROXY_HOPS !== undefined && a.TRUST_PROXY_HOPS !== '1') reasons.push('API: TRUST_PROXY_HOPS no es "1"');

    const sb = secretNames(before);
    const sa = secretNames(after);
    for (const s of sb) if (!sa.includes(s)) reasons.push(`API: DESAPARECE el secreto ${s}`);
    for (const s of sa) if (!sb.includes(s)) reasons.push(`API: aparece un secreto nuevo ${s} (con la recuperacion deshabilitada no debe haber ninguno)`);

    if (before.image !== after.image && !allowApiImageChange) reasons.push('API: cambia la imagen (no autorizado en este plan)');
    if (before.image !== after.image && allowApiImageChange) notes.push('API: cambia la imagen (autorizado explicitamente: paso de despliegue)');
    for (const k of ['cpu', 'memory']) {
      if (taskDef.change.before?.[k] !== taskDef.change.after?.[k]) reasons.push(`API: cambia ${k}`);
    }
    for (const k of ['execution_role_arn', 'task_role_arn']) {
      if (taskDef.change.before?.[k] !== taskDef.change.after?.[k] && taskDef.change.after_unknown?.[k] !== true) reasons.push(`API: cambia ${k}`);
    }
  }

  const service = changes.find((c) => c.address === API_SERVICE);
  if (!service) {
    reasons.push(`no aparece ${API_SERVICE}: se esperaba la actualizacion de su task_definition`);
  } else {
    if (actionsOf(service).join('+') !== 'update') reasons.push(`${API_SERVICE}: la accion debe ser update (es ${actionsOf(service).join('+')})`);
    const b = service.change.before ?? {};
    const a = service.change.after ?? {};
    for (const key of Object.keys({ ...b, ...a })) {
      if (key === 'task_definition' || key === 'id') continue;
      if (JSON.stringify(b[key]) !== JSON.stringify(a[key]) && service.change.after_unknown?.[key] !== true) {
        reasons.push(`${API_SERVICE}: cambia ${key} (solo se admite task_definition)`);
      }
    }
    if (a.desired_count !== undefined && a.desired_count !== 1) reasons.push(`${API_SERVICE}: desired_count debe quedar en 1 (es ${a.desired_count})`);
    if (a.deployment_minimum_healthy_percent !== undefined && (a.deployment_minimum_healthy_percent !== 0 || a.deployment_maximum_percent !== 100)) {
      reasons.push(`${API_SERVICE}: el despliegue debe seguir 0/100`);
    }
  }

  // Una seguridad adicional, por si el plan no marca la IA como cambiada pero la toca:
  const ai = plan.resource_changes.find((rc) => rc.address === AI_SERVICE);
  if (ai && ai.change?.after?.desired_count !== undefined && ai.change.after.desired_count !== 1) reasons.push(`${AI_SERVICE}: desired_count debe quedar en 1`);

  for (const rc of plan.resource_changes) {
    if (/aws_cloudwatch_(log_metric_filter|metric_alarm)\.recovery/.test(rc.address) && !isNoop(rc)) reasons.push(`se crearia ${rc.address} (las alarmas deben seguir apagadas)`);
  }

  return { reasons: [...new Set(reasons)], notes, changes: changes.map((c) => `${c.address} [${actionsOf(c).join('+')}]`) };
}

export function main({ argv, readFile = (f) => fs.readFileSync(f, 'utf8'), out = console.log, err = console.error }) {
  let mode;
  let planFile;
  let allowApiImageChange = false;
  let expectedImageTag;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--mode') mode = argv[++i];
    else if (argv[i] === '--plan') planFile = argv[++i];
    else if (argv[i] === '--allow-api-image-change') allowApiImageChange = true;
    else if (argv[i] === '--expected-image-tag') expectedImageTag = argv[++i];
    else {
      err(`argumento desconocido: ${argv[i]}`);
      return 2;
    }
  }
  try {
    if (!planFile) throw new Unevaluable('falta --plan <archivo con la salida de terraform show -json>');
    const plan = JSON.parse(readFile(planFile));
    const result = evaluate({ plan, mode, allowApiImageChange, expectedImageTag });
    out(`modo: ${mode}`);
    out(`cambios en el plan (${result.changes.length}):`);
    for (const c of result.changes) out(`  - ${c}`);
    for (const n of result.notes) out(`NOTA: ${n}`);
    if (result.reasons.length > 0) {
      out('RECHAZADO:');
      for (const r of result.reasons) out(`  x ${r}`);
      out('No se aplica nada. Se entiende cada punto antes de continuar; no se corrige "a ciegas".');
      return 1;
    }
    out(
      mode === 'baseline'
        ? 'ACEPTABLE: el plan de linea base no propone cambios.'
        : mode === 'migrator-only'
          ? 'ACEPTABLE: solo la nueva revision del migrador con la imagen autorizada.'
          : 'ACEPTABLE: solo los cambios esperados de la recuperacion (deshabilitada).'
    );
    out('AVISO: esto no sustituye la lectura humana del plan completo ni autoriza un apply.');
    return 0;
  } catch (e) {
    err(`NO EVALUADO: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) process.exit(main({ argv: process.argv.slice(2) }));
