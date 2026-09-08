/**
 * Configuración de tests.
 *
 * `jest-expo` provee el preset oficial (transformación, mocks nativos y
 * entorno de React Native). Los tests NUNCA tocan la red real: el cliente
 * HTTP se construye con un `fetch` falso inyectado, y los módulos nativos que
 * no tienen mock en el preset se simulan en `src/test/setup.ts`.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  // El runtime de React Native que monta `jest-expo` deja handles abiertos al
  // terminar (temporizadores internos del scheduler), y Jest se queda colgado
  // tras reportar los resultados. Es un artefacto de TEARDOWN: no afecta a los
  // resultados ni oculta fallos. Documentado en `11-brechas-y-trabajo-futuro.md`.
  forceExit: true,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/test/**',
    '!src/**/*.test.{ts,tsx}'
  ]
};
