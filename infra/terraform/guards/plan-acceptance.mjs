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
 *   node infra/terraform/guards/plan-acceptance.mjs --mode recovery-activation --plan plan.json
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
 *   recovery-activation  ACTIVACION del correo de la recuperacion (Resend) sobre una API ya desplegada con la
 *               recuperacion deshabilitada. Aceptable unicamente:
 *                 - aws_ecs_task_definition.api: reemplazo con create antes que delete (create_before_destroy),
 *                   misma imagen; solo cambian MAIL_TRANSPORT (disabled -> resend) y WEB_PUBLIC_BASE_URL
 *                   (vacio -> el origen aprobado); MAIL_FROM es el aprobado; ninguna otra variable cambia;
 *                   los secretos anteriores quedan identicos y se agrega UNICAMENTE RESEND_API_KEY como
 *                   referencia al ARN SSM /scope/prod/api/RESEND_API_KEY (nunca como variable de entorno);
 *                 - aws_ecs_service.api[0]: solo task_definition, con desired_count y 0/100 intactos;
 *                 - aws_iam_role_policy.execution["api"]: la UNICA diferencia es que ssm:GetParameters gana
 *                   exactamente el ARN del parametro de Resend (sin comodines, sin otras acciones);
 *                 - outputs password_recovery_configuration y ssm_parameters_required_out_of_band.
 *               Todo lo demas es RECHAZO. No debilita `integrated` (que sigue exigiendo mail deshabilitado).
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

// ---------------------------------------------------------------------------------------------
// recovery-activation: el cambio de `mail_transport` de "disabled" a "resend" y nada mas.
// Funciones independientes: no comparten reglas con integrated (que exige mail deshabilitado).
// ---------------------------------------------------------------------------------------------
export const RECOVERY_ACTIVATION = Object.freeze({
  webPublicBaseUrl: 'https://scopeedu.technology',
  mailFrom: 'Scope <no-responder@mail.scopeedu.technology>',
  resendParameterName: '/scope/prod/api/RESEND_API_KEY'
});
export const API_EXECUTION_POLICY = 'aws_iam_role_policy.execution["api"]';
export const OUTPUT_RECOVERY_CONFIGURATION = 'password_recovery_configuration';
export const OUTPUT_PARAMETERS_OUT_OF_BAND = 'ssm_parameters_required_out_of_band';

const RESEND_SECRET_ARN = /^arn:aws:ssm:us-east-1:([0-9]{12}):parameter\/scope\/prod\/api\/RESEND_API_KEY$/;
const SSM_ARN_ACCOUNT = /^arn:aws:ssm:us-east-1:([0-9]{12}):parameter\/scope\/prod\//;
const SSM_READ_ACTIONS = ['ssm:GetParameter', 'ssm:GetParameters'];

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function parsePolicy(raw, side, reasons) {
  try {
    const doc = JSON.parse(raw);
    if (!doc || !Array.isArray(doc.Statement)) throw new Error('sin Statement');
    return doc;
  } catch {
    reasons.push(`${API_EXECUTION_POLICY}: la politica (${side}) no es un JSON de IAM legible`);
    return null;
  }
}

/** Forma canonica de una sentencia IAM: acciones y recursos ordenados, para compararlas sin depender del orden. */
function canonicalStatement(st) {
  const { Action, Resource, ...rest } = st;
  return JSON.stringify({ ...canonical(rest), Action: asArray(Action).slice().sort(), Resource: asArray(Resource).slice().sort() });
}

function checkExecutionPolicy({ change, reasons }) {
  if (change.actions?.join('+') !== 'update') {
    reasons.push(`${API_EXECUTION_POLICY}: la accion debe ser update (es ${(change.actions ?? []).join('+')})`);
  }
  const before = change.before ?? {};
  const after = change.after ?? {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'policy') continue;
    if (!same(before[key], after[key])) reasons.push(`${API_EXECUTION_POLICY}: cambia ${key} (solo se admite la politica)`);
  }
  if (!isEmptyValue(change.after_unknown)) reasons.push(`${API_EXECUTION_POLICY}: hay atributos desconocidos hasta el apply`);

  const b = parsePolicy(before.policy, 'before', reasons);
  const a = parsePolicy(after.policy, 'after', reasons);
  if (!b || !a) return;

  const left = b.Statement.map(canonicalStatement);
  const right = a.Statement.map(canonicalStatement);
  const onlyBefore = [...left];
  const onlyAfter = [];
  for (const st of right) {
    const i = onlyBefore.indexOf(st);
    if (i >= 0) onlyBefore.splice(i, 1);
    else onlyAfter.push(st);
  }
  if (onlyBefore.length !== 1 || onlyAfter.length !== 1) {
    reasons.push(`${API_EXECUTION_POLICY}: debe cambiar exactamente UNA sentencia (cambian ${onlyBefore.length} y aparecen ${onlyAfter.length})`);
    return;
  }

  const sb = JSON.parse(onlyBefore[0]);
  const sa = JSON.parse(onlyAfter[0]);
  const where = `${API_EXECUTION_POLICY} (sentencia ${sa.Sid ?? 'sin Sid'})`;
  if (sa.Effect !== 'Allow' || sb.Effect !== 'Allow') reasons.push(`${where}: el efecto debe seguir siendo Allow`);
  if (sa.Sid !== sb.Sid) reasons.push(`${where}: cambia el Sid`);
  if (sa.NotAction !== undefined || sa.NotResource !== undefined || sb.NotAction !== undefined || sb.NotResource !== undefined) {
    reasons.push(`${where}: no se admiten NotAction/NotResource`);
  }
  if (!same(sa.Condition, sb.Condition)) reasons.push(`${where}: cambia la condicion`);
  if (JSON.stringify(sa.Action) !== JSON.stringify(sb.Action)) reasons.push(`${where}: cambian las acciones`);
  if (sa.Action.length === 0 || !sa.Action.every((x) => SSM_READ_ACTIONS.includes(x))) {
    reasons.push(`${where}: la sentencia modificada debe ser de lectura de parametros SSM (${SSM_READ_ACTIONS.join(', ')}), no ${sa.Action.join(', ')}`);
  }

  const added = sa.Resource.filter((r) => !sb.Resource.includes(r));
  const removed = sb.Resource.filter((r) => !sa.Resource.includes(r));
  if (removed.length > 0) reasons.push(`${where}: se quitan ${removed.length} recurso(s)`);
  if (added.length !== 1) {
    reasons.push(`${where}: debe agregarse exactamente UN recurso (se agregan ${added.length})`);
  } else if (!RESEND_SECRET_ARN.test(added[0])) {
    reasons.push(`${where}: el recurso agregado no es el ARN exacto del parametro ${RECOVERY_ACTIVATION.resendParameterName}`);
  }
  if (sa.Resource.some((r) => typeof r !== 'string' || r.includes('*') || !SSM_ARN_ACCOUNT.test(r))) {
    reasons.push(`${where}: todos los recursos deben ser ARN SSM exactos bajo /scope/prod/ (sin comodines)`);
  }
}

function evaluateRecoveryActivation({ plan }) {
  const reasons = [];
  const notes = [];
  const changes = plan.resource_changes.filter((rc) => !isNoop(rc));
  const allowed = new Set([API_TASK_DEF, API_SERVICE, API_EXECUTION_POLICY]);

  for (const rc of changes) {
    if (!allowed.has(rc.address)) {
      const destructive = actionsOf(rc).includes('delete') ? ' [DESTRUCTIVO]' : '';
      reasons.push(`cambio NO permitido en ${rc.address} (${actionsOf(rc).join('+')})${destructive}`);
    }
  }

  // ---- task definition de la API ------------------------------------------------------------
  const td = changes.find((rc) => rc.address === API_TASK_DEF);
  if (!td) {
    reasons.push(`no aparece ${API_TASK_DEF}: se esperaba una nueva revision con el correo habilitado`);
  } else {
    const change = td.change ?? {};
    if (JSON.stringify(actionsOf(td)) !== '["create","delete"]') {
      reasons.push(`${API_TASK_DEF}: la accion debe ser create ANTES que delete (create_before_destroy), es ${actionsOf(td).join('+')}`);
    }
    if (JSON.stringify(change.replace_paths) !== '[["container_definitions"]]') {
      reasons.push(`${API_TASK_DEF}: el reemplazo debe deberse solo a container_definitions (replace_paths = ${JSON.stringify(change.replace_paths ?? null)})`);
    }
    const before = change.before ?? {};
    const after = change.after ?? {};
    const unknown = change.after_unknown ?? {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key === 'container_definitions' || MIGRATOR_COMPUTED.has(key)) continue;
      const isUnknown = unknown[key] === true || (typeof unknown[key] === 'object' && unknown[key] !== null && !isEmptyValue(unknown[key]));
      if (isUnknown) {
        if (!MIGRATOR_UNKNOWN_OK.has(key)) reasons.push(`${API_TASK_DEF}: ${key} queda desconocido hasta el apply (no es un atributo calculado admitido)`);
        continue;
      }
      if (!same(before[key], after[key])) reasons.push(`${API_TASK_DEF}: cambia ${key}`);
    }

    const b = containers(before, API_TASK_DEF, 'before');
    const a = containers(after, API_TASK_DEF, 'after');
    if (!Array.isArray(b) || !Array.isArray(a) || b.length !== 1 || a.length !== 1) {
      reasons.push(`${API_TASK_DEF}: se espera exactamente un contenedor antes y despues`);
    } else if (b[0].name !== 'api' || a[0].name !== 'api') {
      reasons.push(`${API_TASK_DEF}: el contenedor debe llamarse "api"`);
    } else {
      const bc = b[0];
      const ac = a[0];
      if (bc.image !== ac.image) reasons.push(`${API_TASK_DEF}: cambia la imagen (la activacion no cambia la imagen)`);

      const be = envMap(bc);
      const ae = envMap(ac);
      for (const name of new Set([...Object.keys(be), ...Object.keys(ae)])) {
        if (!(name in be)) reasons.push(`API: variable de entorno nueva NO esperada: ${name}`);
        else if (!(name in ae)) reasons.push(`API: desaparece la variable de entorno ${name}`);
        else if (be[name] !== ae[name] && !['MAIL_TRANSPORT', 'WEB_PUBLIC_BASE_URL'].includes(name)) {
          reasons.push(`API: cambia el valor de la variable ${name} (solo MAIL_TRANSPORT y WEB_PUBLIC_BASE_URL pueden cambiar)`);
        }
      }
      if (be.MAIL_TRANSPORT !== 'disabled') reasons.push('API: antes de la activacion MAIL_TRANSPORT debe ser "disabled"');
      if (ae.MAIL_TRANSPORT !== 'resend') reasons.push('API: MAIL_TRANSPORT debe quedar en "resend"');
      if (ae.WEB_PUBLIC_BASE_URL !== RECOVERY_ACTIVATION.webPublicBaseUrl) reasons.push(`API: WEB_PUBLIC_BASE_URL debe ser ${RECOVERY_ACTIVATION.webPublicBaseUrl}`);
      if (ae.MAIL_FROM !== RECOVERY_ACTIVATION.mailFrom) reasons.push(`API: MAIL_FROM debe ser el remitente aprobado (${RECOVERY_ACTIVATION.mailFrom})`);
      if (ae.TRUST_PROXY_HOPS !== '1') reasons.push('API: TRUST_PROXY_HOPS debe seguir en "1"');
      if ('RESEND_API_KEY' in ae) reasons.push('API: RESEND_API_KEY NO puede ser una variable de entorno en texto plano (solo un secret de ECS)');
      for (const [name, value] of Object.entries(ae)) {
        if (/^re_[A-Za-z0-9_]{8,}/.test(String(value))) reasons.push(`API: el valor de ${name} parece una API key de Resend en texto plano`);
      }

      const sbMap = new Map((bc.secrets ?? []).map((x) => [x.name, x.valueFrom]));
      const saMap = new Map((ac.secrets ?? []).map((x) => [x.name, x.valueFrom]));
      for (const [name, valueFrom] of sbMap) {
        if (!saMap.has(name)) reasons.push(`API: DESAPARECE el secreto ${name}`);
        else if (saMap.get(name) !== valueFrom) reasons.push(`API: cambia la referencia del secreto ${name}`);
      }
      const addedSecrets = [...saMap.keys()].filter((name) => !sbMap.has(name));
      if (addedSecrets.length !== 1 || addedSecrets[0] !== 'RESEND_API_KEY') {
        reasons.push(`API: debe agregarse exactamente el secreto RESEND_API_KEY (se agregan: ${addedSecrets.join(', ') || 'ninguno'})`);
      }
      const accounts = new Set([...sbMap.values()].map((v) => /^arn:aws:ssm:us-east-1:([0-9]{12}):/.exec(v)?.[1]).filter(Boolean));
      const resendRef = saMap.get('RESEND_API_KEY');
      if (resendRef !== undefined) {
        const m = RESEND_SECRET_ARN.exec(resendRef);
        if (!m) reasons.push(`API: RESEND_API_KEY debe referenciar el ARN exacto ${RECOVERY_ACTIVATION.resendParameterName} en us-east-1`);
        else if (accounts.size === 1 && !accounts.has(m[1])) reasons.push('API: el ARN de RESEND_API_KEY pertenece a otra cuenta que los demas secretos');
      }

      const { image: _bi, environment: _be, secrets: _bs, ...restB } = bc;
      const { image: _ai, environment: _ae, secrets: _as, ...restA } = ac;
      for (const key of new Set([...Object.keys(restB), ...Object.keys(restA)])) {
        if (!same(restB[key], restA[key])) reasons.push(`${API_TASK_DEF}: el contenedor cambia ${key}`);
      }
      if (bc.image === ac.image && ae.MAIL_TRANSPORT === 'resend') notes.push('API: MAIL_TRANSPORT disabled -> resend con la misma imagen; RESEND_API_KEY solo como secret de ECS (referencia SSM)');
    }
  }

  // ---- servicio de la API ---------------------------------------------------------------------
  const service = changes.find((rc) => rc.address === API_SERVICE);
  if (!service) {
    reasons.push(`no aparece ${API_SERVICE}: se esperaba la actualizacion de su task_definition`);
  } else {
    if (actionsOf(service).join('+') !== 'update') reasons.push(`${API_SERVICE}: la accion debe ser update (es ${actionsOf(service).join('+')})`);
    const sb = service.change.before ?? {};
    const sa = service.change.after ?? {};
    for (const key of new Set([...Object.keys(sb), ...Object.keys(sa)])) {
      if (key === 'task_definition' || key === 'id') continue;
      if (JSON.stringify(sb[key]) !== JSON.stringify(sa[key]) && service.change.after_unknown?.[key] !== true) {
        reasons.push(`${API_SERVICE}: cambia ${key} (solo se admite task_definition)`);
      }
    }
    if (sa.desired_count !== 1) reasons.push(`${API_SERVICE}: desired_count debe quedar en 1 (es ${sa.desired_count})`);
    if (sa.deployment_minimum_healthy_percent !== 0 || sa.deployment_maximum_percent !== 100) reasons.push(`${API_SERVICE}: el despliegue debe seguir 0/100`);
  }

  // ---- politica del rol de ejecucion ------------------------------------------------------------
  const policy = changes.find((rc) => rc.address === API_EXECUTION_POLICY);
  if (!policy) reasons.push(`no aparece ${API_EXECUTION_POLICY}: se esperaba que autorice el parametro de Resend`);
  else checkExecutionPolicy({ change: policy.change ?? {}, reasons });

  // ---- outputs ---------------------------------------------------------------------------------
  const outputs = plan.output_changes ?? {};
  for (const [name, oc] of Object.entries(outputs)) {
    const noChange = (oc?.actions ?? []).every((x) => x === 'no-op');
    if (!noChange && ![OUTPUT_RECOVERY_CONFIGURATION, OUTPUT_PARAMETERS_OUT_OF_BAND].includes(name)) reasons.push(`cambia el output ${name}`);
  }
  const rcOut = outputs[OUTPUT_RECOVERY_CONFIGURATION];
  if (!rcOut || (rcOut.actions ?? []).join('+') !== 'update') {
    reasons.push(`falta la actualizacion del output ${OUTPUT_RECOVERY_CONFIGURATION}`);
  } else if (rcOut.after === undefined || rcOut.after === null || typeof rcOut.after !== 'object' || rcOut.after_unknown === true) {
    reasons.push(`el output ${OUTPUT_RECOVERY_CONFIGURATION} no tiene un valor conocido en el plan`);
  } else {
    const ob = rcOut.before ?? {};
    const oa = rcOut.after;
    if (oa.mail_transport !== 'resend') reasons.push(`output ${OUTPUT_RECOVERY_CONFIGURATION}: mail_transport debe ser "resend"`);
    if (oa.web_public_base_url !== RECOVERY_ACTIVATION.webPublicBaseUrl) reasons.push(`output ${OUTPUT_RECOVERY_CONFIGURATION}: web_public_base_url no es el aprobado`);
    if (oa.mail_from !== RECOVERY_ACTIVATION.mailFrom) reasons.push(`output ${OUTPUT_RECOVERY_CONFIGURATION}: mail_from no es el aprobado`);
    if (oa.resend_secret_name !== RECOVERY_ACTIVATION.resendParameterName) reasons.push(`output ${OUTPUT_RECOVERY_CONFIGURATION}: resend_secret_name no es el aprobado`);
    if (oa.recovery_alarms_active !== false) reasons.push(`output ${OUTPUT_RECOVERY_CONFIGURATION}: las alarmas de recuperacion deben seguir apagadas`);
    for (const key of new Set([...Object.keys(ob), ...Object.keys(oa)])) {
      if (['mail_transport', 'web_public_base_url', 'resend_secret_name'].includes(key)) continue;
      if (JSON.stringify(ob[key]) !== JSON.stringify(oa[key])) reasons.push(`output ${OUTPUT_RECOVERY_CONFIGURATION}: cambia ${key}`);
    }
  }
  const paramsOut = outputs[OUTPUT_PARAMETERS_OUT_OF_BAND];
  if (!paramsOut || (paramsOut.actions ?? []).join('+') !== 'update') {
    reasons.push(`falta la actualizacion del output ${OUTPUT_PARAMETERS_OUT_OF_BAND}`);
  } else if (!Array.isArray(paramsOut.before) || !Array.isArray(paramsOut.after)) {
    reasons.push(`el output ${OUTPUT_PARAMETERS_OUT_OF_BAND} no tiene un valor conocido en el plan`);
  } else {
    const gained = paramsOut.after.filter((x) => !paramsOut.before.includes(x));
    const lost = paramsOut.before.filter((x) => !paramsOut.after.includes(x));
    if (lost.length > 0) reasons.push(`output ${OUTPUT_PARAMETERS_OUT_OF_BAND}: desaparecen parametros`);
    if (gained.length !== 1 || gained[0] !== RECOVERY_ACTIVATION.resendParameterName) {
      reasons.push(`output ${OUTPUT_PARAMETERS_OUT_OF_BAND}: solo puede sumar ${RECOVERY_ACTIVATION.resendParameterName}`);
    }
  }

  // ---- variables del plan ----------------------------------------------------------------------
  const vars = plan.variables ?? {};
  if (vars.mail_transport?.value !== 'resend') reasons.push('la variable mail_transport del plan debe ser "resend"');
  if (vars.web_public_base_url?.value !== RECOVERY_ACTIVATION.webPublicBaseUrl) reasons.push('la variable web_public_base_url del plan no es la aprobada');
  if (vars.mail_from?.value !== undefined && vars.mail_from.value !== RECOVERY_ACTIVATION.mailFrom) reasons.push('la variable mail_from del plan no es la aprobada');
  if (vars.enable_recovery_alarms?.value !== undefined && vars.enable_recovery_alarms.value !== false) reasons.push('enable_recovery_alarms debe seguir en false');
  for (const key of Object.keys(vars)) {
    if (/resend_api_key|api_key|secret|password|token/i.test(key)) reasons.push(`el plan trae una variable sospechosa de contener un secreto: ${key}`);
  }

  return { reasons: [...new Set(reasons)], notes, changes: changes.map((c) => `${c.address} [${actionsOf(c).join('+')}]`) };
}

export function evaluate({ plan, mode, allowApiImageChange = false, expectedImageTag }) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.resource_changes)) {
    throw new Unevaluable('no parece la salida de `terraform show -json` (falta resource_changes)');
  }
  if (!['baseline', 'integrated', 'migrator-only', 'recovery-activation'].includes(mode)) throw new Unevaluable(`modo desconocido: ${mode}`);
  if (mode === 'recovery-activation') {
    if (allowApiImageChange) throw new Unevaluable('--allow-api-image-change no es valido en el modo recovery-activation');
    if (expectedImageTag !== undefined) throw new Unevaluable('--expected-image-tag solo es valido en el modo migrator-only');
    return evaluateRecoveryActivation({ plan });
  }
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
          : mode === 'recovery-activation'
            ? 'ACEPTABLE: solo la activacion de Resend (nueva revision de la API, su servicio, la lectura del parametro SSM y los outputs).'
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
