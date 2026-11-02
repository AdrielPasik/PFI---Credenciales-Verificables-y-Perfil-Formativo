import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    // Los tests de pantalla con jsdom usan mucha CPU. Con un worker por nucleo
    // logico (el valor por defecto) compiten entre si y con el resto de la
    // maquina: medido sobre la suite completa, la mitad de workers baja el
    // test mas lento ~35% y el p99 ~35% a cambio de ~15% mas de tiempo total,
    // y deja de rozar el timeout de 5 s cuando la maquina esta cargada.
    maxWorkers: '50%'
  }
});
