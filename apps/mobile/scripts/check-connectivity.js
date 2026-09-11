const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '..', '.env');

function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(envPath)) return undefined;

  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.startsWith(`${name}=`));

  return line?.slice(name.length + 1).trim();
}

function safeApiBaseUrl(value) {
  if (!value) throw new Error('EXPO_PUBLIC_API_BASE_URL no está configurada.');
  const url = new URL(value);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL no tiene una forma segura.');
  }

  return url.toString().replace(/\/$/, '');
}

async function main() {
  const baseUrl = safeApiBaseUrl(readEnvValue('EXPO_PUBLIC_API_BASE_URL'));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}/auth/me`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const api = new URL(baseUrl);

    process.stdout.write(
      `GET ${api.host}/auth/me -> ${response.status} in ${durationMs} ms\n`
    );

    if (response.status === 401) {
      process.stdout.write('API reachable: unauthenticated response expected.\n');
      return;
    }

    process.exitCode = 1;
  } catch (error) {
    const category = error?.name === 'AbortError' ? 'timeout' : 'network';
    console.error(`API probe failed: ${category}.`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

void main();
