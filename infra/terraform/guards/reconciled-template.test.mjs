// La plantilla de entradas reconciliadas se versiona en un repositorio PUBLICO: debe conservar la
// estructura que exige la guarda y NO contener valores desplegados de produccion.
// Ejecutar: node --test infra/terraform/guards/reconciled-template.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { REQUIRED_TFVARS } from './pre-plan-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, '..', 'reconciliation', 'prod.reconciled.tfvars.template');
const text = fs.readFileSync(TEMPLATE, 'utf8');
const assignments = Object.fromEntries(
  text.split(/\r?\n/).filter((l) => /^[a-z_0-9]+\s*=/.test(l)).map((l) => {
    const [name, ...rest] = l.split('=');
    return [name.trim(), rest.join('=').replace(/\s+#.*$/, '').trim()];
  })
);

test('la plantilla declara todas las variables que la guarda exige fijar explicitamente', () => {
  for (const name of REQUIRED_TFVARS) assert.ok(name in assignments, `falta ${name}`);
});

test('todo valor que describe el estado desplegado es un marcador <...> a completar', () => {
  for (const [name, marker] of Object.entries({
    api_image_tag: '<API_IMAGE_TAG>',
    ai_image_tag: '<AI_IMAGE_TAG>',
    migrator_image_tag: '<MIGRATOR_IMAGE_TAG>',
    provisioner_image_digest: '<PROVISIONER_IMAGE_DIGEST>',
    web_origin: '<WEB_ORIGIN>',
    github_owner: '<GITHUB_OWNER>',
    github_repository: '<GITHUB_REPOSITORY>'
  })) {
    assert.equal(assignments[name], `"${marker}"`, name);
  }
});

test('no contiene SHA de commit/imagen, digests, cuentas, ARN, identificadores de red ni URLs concretas', () => {
  assert.doesNotMatch(text, /\b[0-9a-f]{40}\b/, 'SHA de 40 hex');
  assert.doesNotMatch(text, /sha256:[0-9a-f]{16,}/, 'digest');
  assert.doesNotMatch(text, /(^|[^0-9])\d{12}([^0-9]|$)/, 'id de cuenta');
  assert.doesNotMatch(text, /arn:aws:[a-z0-9-]*:[a-z0-9-]*:\d*/, 'ARN');
  assert.doesNotMatch(text, /\b(subnet|sg|vpc|vpce|rtb|i)-[0-9a-f]{8,}\b/, 'ids de infraestructura');
  assert.doesNotMatch(text, /https?:\/\/[^\s"<]+/, 'URL concreta');
  assert.doesNotMatch(text, /AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|re_[A-Za-z0-9]{24,}/, 'credenciales');
});

test('el modo de blockchain y los valores de diseno (no despliegue) se conservan', () => {
  assert.equal(assignments.blockchain_evidence_mode, '"credential_registry"');
  assert.equal(assignments.enable_services, 'true');
  assert.equal(assignments.api_desired_count, '1');
  assert.equal(assignments.ai_desired_count, '1');
  assert.equal(assignments.request_acm_certificate, 'true');
});

test('la plantilla NO fija las variables de recuperacion (la linea base se compara sin ellas)', () => {
  for (const name of ['mail_transport', 'mail_from', 'web_public_base_url', 'enable_recovery_alarms']) {
    assert.ok(!(name in assignments), `${name} no debe estar asignada`);
  }
});

test('el archivo de valores concretos ya no existe en el repositorio', () => {
  assert.ok(!fs.existsSync(path.join(HERE, '..', 'reconciliation', 'prod.reconciled.tfvars.proposal')));
});
