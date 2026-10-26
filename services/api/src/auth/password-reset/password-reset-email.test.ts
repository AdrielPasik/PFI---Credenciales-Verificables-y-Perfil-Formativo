/**
 * Correo de recuperacion: asunto, texto, HTML, boton, enlace alternativo, escape,
 * conservacion del fragmento y ausencia de seguimiento (16.5).
 *
 * LIMITE HONESTO. Estos tests prueban lo que ESTE archivo controla. Que el proveedor
 * no reescriba los enlaces depende de un ajuste del DOMINIO en el panel de Resend (el
 * seguimiento no se puede desactivar por mensaje desde la API de envio); eso se
 * verifica a mano con un correo real (ver el reporte).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MailDeliveryError } from '../../mail/mail-transport';
import {
  PASSWORD_RESET_CTA_LABEL,
  PASSWORD_RESET_SUBJECT,
  buildPasswordResetEmail
} from './password-reset-email';
import { buildPasswordResetLink } from './password-reset.config';
import { PASSWORD_RESET_TTL_MS } from './password-reset.limits';
import { generatePasswordResetToken } from './password-reset-token';

const ORIGIN = 'https://app.scope.test';
const EMAIL = 'ada.lovelace@example.com';

function build(token = generatePasswordResetToken()) {
  const link = buildPasswordResetLink(ORIGIN, token);
  return { token, link, mail: buildPasswordResetEmail({ to: EMAIL, link, idempotencyKey: 'password-reset/x' }) };
}

const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

test('48. the subject is exactly the product subject', () => {
  const { mail } = build();

  assert.equal(mail.subject, 'Restablecé tu contraseña de Scope');
  assert.equal(PASSWORD_RESET_SUBJECT, mail.subject);
  assert.doesNotMatch(mail.subject, /[\r\n]/);
});

test('50. the plain text is coherent: it says what happened, what to do and what it is not', () => {
  const { mail, link } = build();

  for (const phrase of [
    'Recibimos una solicitud para recuperar el acceso a tu cuenta de Scope',
    'podés elegir una contraseña nueva',
    'vence en 30 minutos',
    'se puede usar una sola vez',
    'solo funciona el último',
    'Si no pediste este cambio, podés ignorar este correo',
    'no modifica tu contraseña actual'
  ]) {
    assert.ok(mail.text.includes(phrase), phrase);
  }
  assert.ok(mail.text.includes(link));
  assert.ok(mail.text.includes(PASSWORD_RESET_CTA_LABEL));
  assert.doesNotMatch(mail.text, /<[a-z][^>]*>/i, 'el texto plano no lleva etiquetas HTML');
});

test('54. the 30 minute validity is stated and matches the real token lifetime', () => {
  const { mail } = build();

  assert.equal(PASSWORD_RESET_TTL_MS / 60_000, 30);
  assert.ok(mail.text.includes('30 minutos'));
  assert.ok(mail.html.includes('30 minutos'));
  assert.ok(mail.text.includes('una sola vez') && mail.html.includes('una sola vez'));
});

test('51. the call to action is a real button-link with the exact label, pointing at the backend link', () => {
  const { mail, link } = build();

  const button = new RegExp(
    `<a href="${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" style="[^"]*display:inline-block[^"]*">${PASSWORD_RESET_CTA_LABEL}</a>`
  );
  assert.match(mail.html, button);
  assert.equal(PASSWORD_RESET_CTA_LABEL, 'Restablecer contraseña');
});

test('52. the alternative plain link is the same authorization as the button', () => {
  const { mail, link } = build();

  const hrefs = hrefsOf(mail.html);
  assert.equal(hrefs.length, 2, 'el boton y el enlace alternativo');
  assert.deepEqual(hrefs, [link, link]);
  // El texto visible del enlace alternativo es el enlace completo, copiable.
  assert.match(mail.html, new RegExp(`<a href="[^"]*" style="color:#0f766e;">${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a>`));
  assert.ok(mail.html.includes('copiá y pegá este enlace'));
});

test('53. the #token fragment survives untouched in the button, the alternative link and the plain text', () => {
  const { mail, token, link } = build();

  for (const href of hrefsOf(mail.html)) {
    const url = new URL(href);
    assert.equal(url.pathname, '/reset-password');
    assert.equal(url.search, '', 'nada en la query');
    assert.equal(url.hash, `#token=${token}`, 'el fragmento llega intacto');
    assert.equal(href, link, 'ni recodificado ni normalizado');
  }
  assert.ok(mail.text.includes(`#token=${token}`));
  // Aparece exactamente donde debe: 2 href + 1 texto visible en el HTML, 1 en el texto.
  assert.equal(countOf(mail.html, link), 3);
  assert.equal(countOf(mail.text, link), 1);
  assert.ok(!mail.html.includes('%23'), 'el # no se codifico');
  assert.ok(!mail.html.includes('&#35;'));
});

test('53b. every possible base64url token character survives intact in the link', () => {
  // El alfabeto completo, incluidos `_` y `-`, que son los que podrian "normalizarse".
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const token = (alphabet + alphabet).slice(0, 43);

  const { mail, link } = build(token);

  assert.equal(hrefsOf(mail.html)[0], link);
  assert.ok(mail.text.includes(token));
  assert.ok(mail.html.includes(token));
});

test('49. dynamic values are escaped in HTML; ampersands in a URL become &amp; and decode back to the same URL', () => {
  const link = 'https://app.scope.test/reset-password?a=1&b=2#token=abc';

  const mail = buildPasswordResetEmail({ to: EMAIL, link });

  assert.ok(mail.html.includes('a=1&amp;b=2'));
  assert.ok(!mail.html.includes('a=1&b=2'), 'ningun & crudo dentro de un atributo');
  // El texto plano no se escapa: es texto, no HTML.
  assert.ok(mail.text.includes('a=1&b=2'));
  // Decodificar la entidad devuelve exactamente el enlace original.
  assert.equal(hrefsOf(mail.html)[0].replace(/&amp;/g, '&'), link);
});

test('49b. a hostile or malformed link NEVER becomes a message: it is refused as not_sent', () => {
  const hostile = [
    'https://x.test/"><script>alert(1)</script>',
    "https://x.test/'onmouseover='alert(1)",
    'https://x.test/<img src=x>',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://x.test/file',
    '//evil.test/x',
    '/reset-password#token=abc',
    'https://x.test/a b',
    'https://x.test/a\nBcc: evil@x.test',
    'https://x.test/a\\b',
    '',
    ' https://x.test/'
  ];

  for (const link of hostile) {
    assert.throws(
      () => buildPasswordResetEmail({ to: EMAIL, link }),
      (error: unknown) => error instanceof MailDeliveryError && error.kind === 'not_sent',
      JSON.stringify(link)
    );
  }
});

test('55. no remote images, scripts, stylesheets, frames or forms', () => {
  const { mail } = build();

  for (const forbidden of [/<img\b/i, /<script\b/i, /<link\b/i, /<iframe\b/i, /<form\b/i, /<style\b/i, /<object\b/i, /<embed\b/i, /\bsrc\s*=/i, /url\(/i, /@import/i, /\bon\w+\s*=/i, /javascript:/i]) {
    assert.doesNotMatch(mail.html, forbidden, String(forbidden));
  }
});

test('55b. the ONLY URL anywhere in the message is the recovery link', () => {
  const { mail, link } = build();

  const urls = (text: string) => [...text.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((match) => match[0]);
  assert.deepEqual([...new Set(urls(mail.html))], [link]);
  assert.deepEqual([...new Set(urls(mail.text))], [link]);
});

test('56. no tracking signal: no pixel, no campaign parameters, no tracked redirect', () => {
  const { mail, link } = build();
  const everything = `${mail.html}\n${mail.text}`;

  assert.doesNotMatch(everything, /utm_|track|pixel|beacon|1x1|width="1"|height="1"|open\?|click\?|mailchimp|sendgrid|list-unsubscribe/i);
  assert.equal(new URL(link).search, '', 'el enlace no lleva query ni parametros de campana');
  assert.equal(new URL(link).origin, ORIGIN, 'va directo a Scope, sin un host intermedio');
});

test('the HTML is a simple, mobile-friendly, inline-styled document in Spanish', () => {
  const { mail } = build();

  assert.match(mail.html, /^<!doctype html>/i);
  assert.match(mail.html, /<html lang="es">/);
  assert.match(mail.html, /<meta charset="utf-8">/);
  assert.match(mail.html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(mail.html, /max-width:560px/);
  assert.match(mail.html, /width="100%"/);
  assert.match(mail.html, /role="presentation"/);
  assert.match(mail.html, /<title>Restablecé tu contraseña de Scope<\/title>/);
  assert.ok(!mail.html.includes('<style'), 'estilos solo en linea');
});

test('the body carries no personal data: the recipient address is routing, not content', () => {
  const { mail } = build();

  for (const part of [mail.html, mail.text]) {
    assert.ok(!part.includes(EMAIL));
    assert.ok(!part.includes('ada.lovelace'));
  }
  assert.equal(mail.to, EMAIL);
});

test('the idempotency key is passed through when given, and absent when not', () => {
  const link = buildPasswordResetLink(ORIGIN, generatePasswordResetToken());

  assert.equal(buildPasswordResetEmail({ to: EMAIL, link, idempotencyKey: 'password-reset/abc' }).idempotencyKey, 'password-reset/abc');
  assert.ok(!('idempotencyKey' in buildPasswordResetEmail({ to: EMAIL, link })));
});

test('the same inputs build a byte-identical message (required for a safe idempotent retry)', () => {
  const link = buildPasswordResetLink(ORIGIN, generatePasswordResetToken());

  const first = buildPasswordResetEmail({ to: EMAIL, link, idempotencyKey: 'password-reset/abc' });
  const second = buildPasswordResetEmail({ to: EMAIL, link, idempotencyKey: 'password-reset/abc' });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('a link to a local development web origin is accepted (http://127.0.0.1)', () => {
  const link = buildPasswordResetLink('http://127.0.0.1:3000', generatePasswordResetToken());

  assert.doesNotThrow(() => buildPasswordResetEmail({ to: EMAIL, link }));
});
