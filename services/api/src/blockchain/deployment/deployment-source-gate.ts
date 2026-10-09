import { execFileSync } from 'node:child_process';

import { DeploymentOperatorError } from './deployment-errors';

/**
 * Compuerta de fuente limpia -- S8c10.1.
 *
 * El deployment REAL se corre desde un checkout/worktree limpio y aislado en
 * exactamente `deploymentSourceCommit`. Este modulo implementa la comprobacion;
 * NO crea ese worktree.
 *
 * Que cuenta como "relevante": las rutas que determinan los bytes desplegados o
 * la herramienta que los despliega. Un archivo EXTERNO e ignorado (el keystore,
 * `contracts/out`, `contracts/cache`) NO cuenta como suciedad: `git status` no
 * lista lo ignorado, y el keystore ni siquiera vive en el repositorio.
 */

export const DEPLOYMENT_RELEVANT_PATHS: readonly string[] = [
  'contracts',
  'services/api/src/blockchain',
  'services/api/package.json'
];

const COMMIT_SHA = /^[0-9a-f]{40}$/;

export interface GitStateReader {
  /** SHA completo de HEAD. */
  headSha(): string;
  /**
   * Rutas con cambios (modificadas, staged o no rastreadas y NO ignoradas)
   * dentro de `paths`.
   */
  dirtyPaths(paths: readonly string[]): readonly string[];
}

export function assertValidSourceCommit(value: unknown): string {
  if (typeof value !== 'string' || !COMMIT_SHA.test(value)) {
    throw new DeploymentOperatorError('SOURCE_COMMIT_INVALID');
  }
  return value;
}

export function assertCleanSourceAtCommit(
  git: GitStateReader,
  deploymentSourceCommit: string
): void {
  assertValidSourceCommit(deploymentSourceCommit);

  if (git.headSha() !== deploymentSourceCommit) {
    throw new DeploymentOperatorError('SOURCE_COMMIT_MISMATCH', {
      context: { deploymentSourceCommit }
    });
  }

  if (git.dirtyPaths(DEPLOYMENT_RELEVANT_PATHS).length > 0) {
    // Las rutas sucias NO viajan en el error: solo el hecho.
    throw new DeploymentOperatorError('SOURCE_TREE_DIRTY', {
      context: { deploymentSourceCommit }
    });
  }
}

/** Implementacion real. `execFile` sin shell: ningun argumento se interpreta. */
export class ProcessGitStateReader implements GitStateReader {
  constructor(private readonly cwd: string) {}

  headSha(): string {
    return this.git(['rev-parse', 'HEAD']).trim();
  }

  dirtyPaths(paths: readonly string[]): readonly string[] {
    const output = this.git([
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      ...paths
    ]);
    return output
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter((line) => line.length > 0);
  }

  private git(args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  }
}
