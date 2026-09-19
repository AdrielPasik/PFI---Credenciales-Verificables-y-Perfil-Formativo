/**
 * Estado efectivo de un enlace compartido.
 *
 * Una sola definicion para el listado del holder y para el lector publico: si
 * divergieran, el holder veria un permiso que no rige, o al reves.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isShareActive, shareEffectiveStatus } from './share-lifecycle';

const NOW = new Date('2026-09-15T12:00:00Z');

test('un enlace sin vencimiento ni revocacion esta activo', () => {
  // `expiresAt = null` es NO VENCE. Hoy la creacion siempre lo deja asi, y esta
  // version no inventa un TTL.
  assert.equal(shareEffectiveStatus({ expiresAt: null, revokedAt: null }, NOW), 'ACTIVE');
  assert.equal(isShareActive({ expiresAt: null, revokedAt: null }, NOW), true);
});

test('un vencimiento futuro sigue activo', () => {
  const future = new Date('2026-12-31T00:00:00Z');
  assert.equal(shareEffectiveStatus({ expiresAt: future, revokedAt: null }, NOW), 'ACTIVE');
});

test('un vencimiento pasado da EXPIRED', () => {
  const past = new Date('2026-01-01T00:00:00Z');
  assert.equal(shareEffectiveStatus({ expiresAt: past, revokedAt: null }, NOW), 'EXPIRED');
  assert.equal(isShareActive({ expiresAt: past, revokedAt: null }, NOW), false);
});

test('vencer exactamente ahora ya no es activo', () => {
  // Frontera cerrada: `<=`. Un enlace que vence en este instante no autoriza.
  assert.equal(shareEffectiveStatus({ expiresAt: NOW, revokedAt: null }, NOW), 'EXPIRED');
});

test('revocado da REVOKED', () => {
  const when = new Date('2026-05-01T00:00:00Z');
  assert.equal(shareEffectiveStatus({ expiresAt: null, revokedAt: when }, NOW), 'REVOKED');
  assert.equal(isShareActive({ expiresAt: null, revokedAt: when }, NOW), false);
});

test('revocado gana sobre vencido', () => {
  // Los dos niegan acceso igual; la precedencia solo elige el texto que ve el
  // holder, y describir su decision es mas util que describir el calendario.
  const past = new Date('2026-01-01T00:00:00Z');
  assert.equal(
    shareEffectiveStatus({ expiresAt: past, revokedAt: new Date('2026-02-01T00:00:00Z') }, NOW),
    'REVOKED'
  );
});

test('una revocacion con fecha futura igual invalida', () => {
  // `revokedAt` no es una programacion: si la columna tiene marca, el enlace
  // esta revocado. No existe revocacion diferida y no se inventa una.
  assert.equal(
    shareEffectiveStatus({ expiresAt: null, revokedAt: new Date('2027-01-01T00:00:00Z') }, NOW),
    'REVOKED'
  );
});
