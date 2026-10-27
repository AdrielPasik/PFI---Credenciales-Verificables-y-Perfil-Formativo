/**
 * Interruptor de la recuperacion de contrasena en la web.
 *
 * `NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED=true` (valor exacto) muestra el enlace
 * "¿Olvidaste tu contraseña?" del login y habilita /forgot-password y
 * /reset-password. Con cualquier otro valor, o sin definir, la recuperacion queda
 * OCULTA: no hay enlace y las dos rutas muestran un aviso neutro sin formulario.
 *
 * POR QUE EXISTE. Mientras la API tenga `MAIL_TRANSPORT=disabled`, el backend
 * responde 503 a cada solicitud y nadie recibe un correo. Publicar un enlace que
 * promete un correo que no va a llegar es peor que no publicarlo. Se activa recien
 * cuando el correo esta operativo (ver el orden de activacion en el runbook).
 *
 * Es una variable de BUILD (`NEXT_PUBLIC_*` se incrusta al compilar): cambiarla en
 * Vercel exige un nuevo despliegue. La referencia a `process.env.NEXT_PUBLIC_...`
 * debe ser literal para que Next.js la incruste.
 */
export function isPasswordRecoveryEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_PASSWORD_RECOVERY_ENABLED
): boolean {
  return value?.trim() === 'true';
}
