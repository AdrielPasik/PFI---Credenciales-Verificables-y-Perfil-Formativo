const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

function getGlobalNodeModules() {
  if (process.platform === 'win32') {
    return execFileSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'npm root --global --workspaces=false'],
      { encoding: 'utf8' }
    ).trim();
  }

  return execFileSync('npm', ['root', '--global', '--workspaces=false'], {
    encoding: 'utf8'
  }).trim();
}

try {
  const globalNodeModules = getGlobalNodeModules();
  const nodePathParts = [globalNodeModules, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  const launch = process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npx expo start --tunnel']]
    : ['npx', ['expo', 'start', '--tunnel']];
  const child = spawn(launch[0], launch[1], {
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: nodePathParts }
  });

  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  console.error('No pudimos preparar el tunnel de Expo. Verificá npm y @expo/ngrok.');
  process.exitCode = 1;
}
