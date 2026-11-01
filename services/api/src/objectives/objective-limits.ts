/**
 * Tope de Requirements de un Objective del titular.
 *
 * ES UN TOPE, NO UNA META. La propuesta puede traer menos, o ninguno, y la
 * persona puede agregar los suyos a mano hasta este numero.
 *
 * POR QUE 15 Y POR QUE ACA. El razonamiento contextual hace UNA llamada al
 * modelo por Requirement, en serie, mas dos llamadas fijas (Objective Analysis y
 * EvidenceUnits). Sin tope, un aviso largo producia ~50 Requirements y un run de
 * 52 llamadas secuenciales: mas de 10 minutos y, en el peor caso, por encima del
 * idle timeout del ALB (1200 s, dimensionado para el techo publico de 12). Con 15
 * el peor caso es 17 llamadas.
 *
 * Una sola constante para los dos lugares que la aplican:
 *
 *   - la PROPUESTA: viaja como presupuesto de seleccion al ai-service, que la
 *     hace cumplir en el prompt, en el json_schema y en su validacion, y NestJS
 *     vuelve a contar al verificar el artefacto;
 *   - la CONFIRMACION: `POST /me/objectives` rechaza mas Requirements, para que
 *     el limite no dependa de que el modelo respete un prompt.
 *
 * No se aplica al verificar definiciones YA persistidas: un Objective historico
 * con mas Requirements sigue siendo legible tal cual se confirmo.
 */
export const MAX_OBJECTIVE_REQUIREMENTS = 15;
