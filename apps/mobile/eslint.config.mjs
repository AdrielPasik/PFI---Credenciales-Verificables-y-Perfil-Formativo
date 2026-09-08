import expoConfig from 'eslint-config-expo/flat.js';

export default [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      '.expo-export/**',
      'coverage/**'
    ]
  },
  {
    // Los scripts de build son Node/CommonJS, no runtime de React Native.
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        module: 'writable',
        require: 'readonly',
        process: 'readonly'
      }
    }
  },
  {
    rules: {
      // El proyecto no persiste ni loguea material sensible; cualquier
      // console.* en runtime de produccion es un error (ver seccion 94 de
      // la documentacion de mobile).
      'no-console': ['error', { allow: ['warn', 'error'] }]
    }
  }
];
