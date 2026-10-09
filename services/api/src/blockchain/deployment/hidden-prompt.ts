/**
 * Prompt de terminal SIN eco -- S8c10.1. SOLO herramienta de operacion.
 *
 * Se usa para la frase de paso del keystore (y, si no esta en el entorno, la URL
 * del RPC, que lleva su token). Ninguno de los dos puede viajar como argumento
 * de linea de comandos ni quedar en el historial del shell.
 *
 * ---------------------------------------------------------------------------
 * REGLAS
 * ---------------------------------------------------------------------------
 *
 *   - Exige una TTY con modo crudo. Sin TTY (stdin redirigido, pipe, CI) FALLA
 *     CERRADO: no hay fallback a `readline`, que SI haria eco de la frase.
 *   - Ningun caracter tipeado se escribe en la salida. Solo el rotulo y un salto
 *     de linea final.
 *   - El valor no se loguea, no se serializa y no se incluye en ningun error.
 *   - Ctrl+C cancela y restaura la terminal.
 *
 * Los flujos son inyectables solo para poder probar este archivo con una TTY
 * falsa.
 */

export interface HiddenPromptInput {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

export interface HiddenPromptOutput {
  write(text: string): unknown;
}

export class HiddenPromptError extends Error {
  readonly code: 'PROMPT_UNAVAILABLE' | 'PROMPT_CANCELLED' | 'PROMPT_EMPTY';

  constructor(code: HiddenPromptError['code']) {
    super(
      code === 'PROMPT_UNAVAILABLE'
        ? 'No hay una terminal interactiva con entrada sin eco disponible.'
        : code === 'PROMPT_CANCELLED'
          ? 'Entrada cancelada.'
          : 'La entrada esta vacia.'
    );
    this.name = 'HiddenPromptError';
    this.code = code;
  }
}

export function promptHidden(
  label: string,
  streams: { input: HiddenPromptInput; output: HiddenPromptOutput }
): Promise<string> {
  const { input, output } = streams;

  if (input.isTTY !== true || typeof input.setRawMode !== 'function') {
    return Promise.reject(new HiddenPromptError('PROMPT_UNAVAILABLE'));
  }

  return new Promise<string>((resolve, reject) => {
    const typed: string[] = [];

    const finish = (action: () => void) => {
      input.removeListener('data', onData);
      input.setRawMode?.(false);
      input.pause();
      output.write('\n');
      action();
    };

    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          const value = typed.join('');
          typed.length = 0;
          finish(() =>
            value.length === 0
              ? reject(new HiddenPromptError('PROMPT_EMPTY'))
              : resolve(value)
          );
          return;
        }
        if (character === '\u0003' || character === '\u0004') {
          typed.length = 0;
          finish(() => reject(new HiddenPromptError('PROMPT_CANCELLED')));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          typed.pop();
          continue;
        }
        // Se descartan los caracteres de control restantes (flechas, escapes).
        if (character < ' ') {
          continue;
        }
        typed.push(character);
      }
    };

    output.write(label);
    input.setRawMode?.(true);
    input.resume();
    input.on('data', onData);
  });
}
