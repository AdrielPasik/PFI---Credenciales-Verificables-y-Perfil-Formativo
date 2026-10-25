/**
 * Guardian estructural de la recuperacion de contrasena.
 *
 * Mira el codigo fuente (sin comentarios) y rompe si alguien reintroduce una de las
 * cosas que esta funcionalidad se comprometio a no hacer. Cubre lo que un test
 * funcional no ve: que se escribe en los logs, quien puede escribir credenciales,
 * que `verify` no escribe, y que nadie lee `X-Forwarded-For` a mano.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

const SRC = join(__dirname, '..', '..');
const RESET_DIR = join('auth', 'password-reset');

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function read(relativePath: string): string {
  return stripComments(readFileSync(join(SRC, relativePath), 'utf8'));
}

function productionFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .filter((entry) => !entry.split(sep).includes('__fixtures__'))
    .map((entry) => relative(SRC, join(SRC, entry)));
}

const resetFiles = () => productionFiles().filter((file) => file.startsWith(RESET_DIR + sep));

function filesMatching(pattern: RegExp, among = productionFiles()): string[] {
  return among.filter((file) => pattern.test(read(file)));
}

// ---------------------------------------------------------------------------
// Superficie HTTP
// ---------------------------------------------------------------------------

test('the controller exposes exactly request, verify and confirm -- all POST, all public', () => {
  const code = read(join(RESET_DIR, 'password-reset.controller.ts'));

  assert.match(code, /@Controller\('auth\/password-reset'\)/);
  const routes = [...code.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)].map(
    (match) => `${match[1]} ${match[2]}`
  );
  assert.deepEqual(routes, ['Post request', 'Post verify', 'Post confirm']);
  // Publicas: la persona que olvido su contrasena no tiene sesion.
  assert.doesNotMatch(code, /AuthGuard|PlatformAdminGuard|CurrentUser/);
  // Cada ruta lleva su guard de throttling.
  assert.equal([...code.matchAll(/@UseGuards\(/g)].length, 3);
  assert.equal([...code.matchAll(/ThrottlerGuard\)/g)].length, 3);
  assert.match(code, /HttpStatus\.ACCEPTED/);
});

test('no endpoint verifies a token with GET -- a link visit can never consume or probe a token', () => {
  const code = read(join(RESET_DIR, 'password-reset.controller.ts'));

  assert.doesNotMatch(code, /@Get\(/);
});

test('the throttler is scoped to recovery: no global guard, and only AuthModule imports it', () => {
  assert.deepEqual(
    filesMatching(/ThrottlerModule/).sort(),
    [join('auth', 'auth.module.ts')]
  );
  assert.deepEqual(filesMatching(/APP_GUARD/), []);
  assert.deepEqual(
    filesMatching(/extends ThrottlerGuard/),
    [join(RESET_DIR, 'password-reset-throttler.guard.ts')]
  );
});

test('verify and confirm share one throttle scope; request has its own', () => {
  const code = read(join(RESET_DIR, 'password-reset-throttler.guard.ts'));

  assert.match(code, /scope = 'request'/);
  assert.match(code, /scope = 'token'/);
  assert.match(code, /generateKey/);
  assert.doesNotMatch(code, /getHandler|getClass/, 'la clave no depende del handler: es lo que permite compartir');
});

// ---------------------------------------------------------------------------
// Quien puede escribir credenciales
// ---------------------------------------------------------------------------

test('only registration and the password reset write AuthCredential', () => {
  const writers = filesMatching(
    /authCredential\s*\.\s*(create|update|updateMany|upsert|delete|deleteMany)\s*\(/
  );

  assert.deepEqual(writers.sort(), [
    join('auth', 'auth.service.ts'),
    join(RESET_DIR, 'password-reset.service.ts')
  ]);
});

test('the password reset hashes with the existing scrypt helper and has no second hashing scheme', () => {
  const service = read(join(RESET_DIR, 'password-reset.service.ts'));

  assert.match(service, /import \{ hashPassword \} from '\.\.\/password-hashing'/);
  assert.match(service, /hashPassword\(password\)/);
  for (const file of resetFiles()) {
    assert.doesNotMatch(read(file), /scrypt|bcrypt|argon|pbkdf2|createHmac/i, file);
  }
});

test('the reset never signs or verifies a JWT and returns no session: no auto-login', () => {
  const service = read(join(RESET_DIR, 'password-reset.service.ts'));

  assert.doesNotMatch(service, /JwtService|signAsync|verifyAsync|accessToken|getJwt/);
  for (const file of resetFiles()) {
    assert.doesNotMatch(read(file), /\.signAsync|JwtService/, file);
  }
});

test('confirm consumes with a CONDITIONAL updateMany and demands exactly one row', () => {
  const service = read(join(RESET_DIR, 'password-reset.service.ts'));
  const confirm = service.slice(service.indexOf('async confirmReset('));

  assert.match(confirm, /consumedAt: null,\s*invalidatedAt: null,\s*expiresAt: \{ gt: now \}/);
  assert.match(confirm, /consumed\.count !== 1/);
  assert.match(confirm, /credential\.count !== 1/);
  assert.match(confirm, /sessionVersion: \{ increment: 1 \}/);
  // El hash costoso se calcula ANTES de abrir la transaccion.
  assert.ok(confirm.indexOf('hashPassword(password)') < confirm.indexOf('$transaction('));
});

test('verify is read-only: no write, no transaction', () => {
  const service = read(join(RESET_DIR, 'password-reset.service.ts'));
  const start = service.indexOf('async verifyToken(');
  const end = service.indexOf('async confirmReset(');
  const verify = service.slice(start, end);

  assert.ok(start > -1 && end > start);
  assert.doesNotMatch(verify, /\.(create|update|updateMany|delete|deleteMany|upsert)\(|\$transaction|\$executeRaw/);
  // Y lo que delega tampoco escribe.
  const helper = service.slice(service.indexOf('private async requireUsableToken('));
  assert.doesNotMatch(helper, /\.(create|update|updateMany|delete|deleteMany|upsert)\(|\$transaction/);
});

test('the issuance takes the advisory lock as its first statement and the send is outside it', () => {
  const service = read(join(RESET_DIR, 'password-reset.service.ts'));
  const reserve = service.slice(
    service.indexOf('private async reserve('),
    service.indexOf('private async deliver(')
  );

  assert.match(reserve, /pg_advisory_xact_lock/);
  assert.ok(
    reserve.indexOf('pg_advisory_xact_lock') < reserve.indexOf('passwordResetToken.findFirst'),
    'el lock va antes de cualquier lectura'
  );
  assert.doesNotMatch(reserve, /\bmail\b|\.send\(/, 'no se envia dentro de la transaccion');
  assert.doesNotMatch(reserve, /pg_advisory_lock\(/, 'solo la variante transaccional: se libera sola');
  // `hashPassword(` es scrypt; `hashPasswordResetToken(` (SHA-256 del token) si va aca.
  assert.doesNotMatch(reserve, /hashPassword\(/, 'scrypt no corre con el lock tomado');
});

test('the advisory lock key is used by the recovery code and nowhere else in the API', () => {
  assert.deepEqual(
    filesMatching(/pg_advisory/).sort(),
    [join(RESET_DIR, 'password-reset.service.ts')]
  );
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

test('no log call in the recovery code interpolates a secret, an address or an error message', () => {
  const FORBIDDEN =
    /email|\blink\b|password|hash|\btoken\b|origin|\bbody\b|\.message|\.stack|\bto\b/i;

  const mailFiles = productionFiles().filter((file) => file.startsWith('mail' + sep));
  assert.ok(mailFiles.length >= 6, 'el guardian ve el modulo de correo completo');

  for (const file of [...resetFiles(), ...mailFiles]) {
    const code = read(file);
    const calls = code.match(/logger\s*\.\s*(log|warn|error|debug|verbose)\s*\([^;]*;/g) ?? [];

    for (const call of calls) {
      for (const expression of call.matchAll(/\$\{([^}]*)\}/g)) {
        assert.doesNotMatch(expression[1], FORBIDDEN, `${file}: ${call.trim().slice(0, 90)}`);
      }
    }
  }
});

test('no console.* and no direct stdout writes in the recovery or mail code', () => {
  for (const file of [...resetFiles(), ...productionFiles().filter((f) => f.startsWith('mail' + sep))]) {
    assert.doesNotMatch(read(file), /console\.|process\.stdout|process\.stderr/, file);
  }
});

test('only the dev log transport can write a message body, and only mail.config can build it', () => {
  assert.deepEqual(
    filesMatching(/new LogMailTransport\(/).sort(),
    [join('mail', 'mail.config.ts')]
  );
  const config = read(join('mail', 'mail.config.ts'));
  assert.match(config, /isProductionEnvironment\(env\)/);
  assert.match(config, /production_forbids_log/);
});

// ---------------------------------------------------------------------------
// Proxy y enlace
// ---------------------------------------------------------------------------

test('nobody parses X-Forwarded-For by hand: the proxy policy is Express "trust proxy" only', () => {
  assert.deepEqual(filesMatching(/x-forwarded|forwarded-for|forwarded-host/i), []);
  assert.deepEqual(filesMatching(/['"]trust proxy['"]/), [join('auth', 'trust-proxy.config.ts')]);

  const main = read('main.ts');
  assert.match(main, /applyTrustProxy\(app, resolveTrustProxyHops\(process\.env\)\)/);
  assert.doesNotMatch(main, /trust proxy/);
});

test('the link host comes ONLY from WEB_PUBLIC_BASE_URL, never from the request', () => {
  assert.deepEqual(filesMatching(/WEB_PUBLIC_BASE_URL/), [join(RESET_DIR, 'password-reset.config.ts')]);
  for (const file of resetFiles()) {
    // `url.hostname` en la config parsea la URL CONFIGURADA y es legitimo; lo que se
    // prohibe es leer el host de la request.
    assert.doesNotMatch(read(file), /headers\.host|headers\[|getHost|req\.get\(|\bOrigin\b/, file);
  }
  const controller = read(join(RESET_DIR, 'password-reset.controller.ts'));
  assert.doesNotMatch(controller, /@Req\(|@Headers\(|@Ip\(/, 'el controller no mira la request');
});

test('WEB_ORIGIN (CORS) and the API base URL are not used to build recovery links', () => {
  for (const file of resetFiles()) {
    assert.doesNotMatch(read(file), /WEB_ORIGIN|API_BASE_URL|PUBLIC_DID_BASE_URL/, file);
  }
});

test('the schema was not touched by the recovery logic: no new migration beyond the stage-1 one', () => {
  const migrations = readdirSync(join(SRC, '..', 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // Comparar el TIMESTAMP (14 digitos): como string, '2026..._add_x' > '2026...'.
    .filter((name) => name.slice(0, 14) > '20261012110000')
    .sort();

  assert.deepEqual(migrations, ['20261023120000_add_password_reset_token_and_session_version']);
});

// ---------------------------------------------------------------------------
// Resend: secretos, host y dependencias (Etapa 3)
// ---------------------------------------------------------------------------

test('RESEND_API_KEY is read in exactly one production file: the mail configuration', () => {
  // LEER la variable: `env.RESEND_API_KEY` o `env['RESEND_API_KEY']`. Nombrarla dentro de
  // un texto de error fijo (mail.module.ts) no es leerla.
  assert.deepEqual(filesMatching(/env\s*\.\s*RESEND_API_KEY|env\s*\[\s*['"]RESEND_API_KEY['"]/), [join('mail', 'mail.config.ts')]);
  assert.deepEqual(filesMatching(/env\s*\.\s*MAIL_FROM|env\s*\[\s*['"]MAIL_FROM['"]/), [join('mail', 'mail.config.ts')]);
  // Y nunca se interpola en un texto: ni siquiera el nombre del valor.
  assert.deepEqual(filesMatching(/\$\{[^}]*RESEND_API_KEY/), []);
});

test('the Resend host is hardcoded in exactly one file and never configurable', () => {
  assert.deepEqual(filesMatching(/api\.resend\.com/), [join('mail', 'resend-mail-transport.ts')]);

  const transport = read(join('mail', 'resend-mail-transport.ts'));
  assert.match(transport, /export const RESEND_ENDPOINT = 'https:\/\/api\.resend\.com\/emails'/);
  assert.match(transport, /redirect: 'error'/, 'una redireccion nunca se sigue');
  assert.doesNotMatch(transport, /process\.env/, 'el adaptador no lee el entorno: recibe su configuracion');
  assert.doesNotMatch(transport, /\bconsole\./);
});

test('within the mail and recovery code, the Authorization header and fetch belong to the Resend adapter alone', () => {
  // Acotado a correo + recuperacion: la palabra "Authorization" es legitima en otros
  // modulos (el guard JWT, CORS, la auth interna de la IA).
  const scope = [...resetFiles(), ...productionFiles().filter((f) => f.startsWith('mail' + sep))];

  assert.deepEqual(filesMatching(/Authorization/, scope), [join('mail', 'resend-mail-transport.ts')]);
  assert.deepEqual(filesMatching(/(^|[^.\w])fetch\s*\(/, scope), [join('mail', 'resend-mail-transport.ts')]);
});

test('the API key is held in a JS private field, so it cannot be serialised by accident', () => {
  const transport = read(join('mail', 'resend-mail-transport.ts'));

  assert.match(transport, /readonly #apiKey: string/);
  assert.doesNotMatch(transport, /this\.apiKey\b|private readonly apiKey/);
});

test('no secret can reach the browser: no NEXT_PUBLIC_ variable anywhere in the API', () => {
  assert.deepEqual(filesMatching(/NEXT_PUBLIC_/), []);
});

test('the example environment documents the mail variables with EMPTY values -- no secret is committed', () => {
  const example = readFileSync(join(SRC, '..', '.env.example'), 'utf8');

  for (const name of ['MAIL_TRANSPORT', 'MAIL_FROM', 'RESEND_API_KEY', 'WEB_PUBLIC_BASE_URL', 'TRUST_PROXY_HOPS']) {
    assert.match(example, new RegExp(`^${name}=\\s*$`, 'm'), `${name} debe estar vacia en el ejemplo`);
  }
  assert.doesNotMatch(example, /\bre_[A-Za-z0-9_]{8,}/, 'ninguna clave real de Resend');
});

test('no Resend SDK and no HTTP client were added: the contract is native fetch', () => {
  const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const names = Object.keys(pkg.dependencies);

  for (const forbidden of ['resend', 'axios', 'node-fetch', 'got', 'undici', 'nodemailer', '@react-email/components']) {
    assert.ok(!names.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// Cierre ordenado
// ---------------------------------------------------------------------------

test('shutdown hooks are enabled once, in main.ts only, and the API installs no signal handler of its own', () => {
  assert.deepEqual(filesMatching(/enableShutdownHooks/), ['main.ts']);
  assert.equal([...read('main.ts').matchAll(/enableShutdownHooks\(\)/g)].length, 1);
  assert.deepEqual(filesMatching(/process\s*\.\s*(on|once|addListener)\s*\(\s*['"]SIG/), []);
  // Habilitar los hooks no puede ir despues de `listen`: tiene que estar activo al servir.
  const main = read('main.ts');
  assert.ok(main.indexOf('enableShutdownHooks()') < main.indexOf('app.listen('));
});

test('the runner closes the door BEFORE it waits, and refuses work while closing', () => {
  const runner = read(join(RESET_DIR, 'background-task-runner.ts'));
  const destroy = runner.slice(runner.indexOf('async onModuleDestroy('));

  assert.ok(destroy.indexOf('this.closing = true') < destroy.indexOf('await this.idle('));
  assert.match(runner, /if \(this\.closing\)/);
});
