# Aplicación móvil de Scope

La aplicación móvil de Scope está orientada a las personas titulares de
credenciales. Permite iniciar sesión, consultar el perfil formativo y las
credenciales emitidas, analizar la trayectoria frente a los requisitos de un
objetivo y compartir información mediante las opciones autorizadas. Está
desarrollada con React Native y Expo.

La distribución demostrativa documentada para esta aplicación es Android. La
configuración de iOS se conserva en el proyecto, pero este repositorio no
documenta una distribución ni una validación equivalente para esa plataforma.

## Requisitos

La aplicación forma parte del monorepo de Scope y utiliza los paquetes
instalados desde la raíz del repositorio.

- Node.js compatible con la versión declarada en `apps/mobile/package.json`.
- npm.
- Un emulador Android o un dispositivo Android para abrir la aplicación.
- Una API de Scope accesible desde el emulador o dispositivo utilizado.

Instalá las dependencias desde la raíz:

```powershell
npm ci
```

## Configuración local

Copiá el archivo de ejemplo y completá las URLs del entorno que se utilizará:

```powershell
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

El archivo `.env` requiere estas variables:

```text
EXPO_PUBLIC_API_BASE_URL=https://...
EXPO_PUBLIC_WEB_BASE_URL=https://...
```

`EXPO_PUBLIC_API_BASE_URL` identifica la API NestJS de Scope.
`EXPO_PUBLIC_WEB_BASE_URL` se utiliza para construir enlaces públicos de
verificación y perfiles compartidos.

Estas variables son configuración pública de la aplicación y quedan incluidas
en el bundle. No deben contener tokens, contraseñas, claves privadas ni otros
secretos. La aplicación valida que las URLs utilicen HTTP o HTTPS y no inicia
con valores implícitos como `localhost`.

## Ejecución local

Para iniciar el servidor de desarrollo:

```powershell
npm run start --workspace @credential-intelligence/mobile
```

Para abrir la aplicación en Android:

```powershell
npm run android --workspace @credential-intelligence/mobile
```

Antes de probar un entorno puede verificarse la conectividad básica con la API:

```powershell
npm run check:api --workspace @credential-intelligence/mobile
```

Esta comprobación consulta `GET /auth/me`. Una respuesta `401` indica que la
API es alcanzable sin una sesión autenticada.

## Validaciones disponibles

La aplicación incluye comprobaciones estáticas y pruebas unitarias:

```powershell
npm run typecheck --workspace @credential-intelligence/mobile
npm run lint --workspace @credential-intelligence/mobile
npm run test --workspace @credential-intelligence/mobile
npm run doctor --workspace @credential-intelligence/mobile
```

Las pruebas no requieren credenciales reales. Las validaciones de conectividad
dependen de que la API configurada esté disponible.

## Preparación para Android

`eas.json` define tres perfiles de compilación:

| Perfil | Resultado previsto |
| --- | --- |
| `development` | Cliente de desarrollo distribuido internamente como APK. |
| `preview` | Distribución interna mediante APK. |
| `production` | Paquete AAB para un flujo de distribución posterior. |

La configuración versionada no incluye una asociación activa con un proyecto
EAS ni valores concretos para las variables públicas de cada perfil. Antes de
generar un artefacto mediante EAS debe registrarse o asociarse el proyecto,
completar las URLs del entorno correspondiente y conservar fuera del
repositorio cualquier credencial de firma o acceso.

El repositorio no contiene un APK ni un enlace de instalación vigente. Por ese
motivo, esta guía describe la preparación para una distribución demostrativa,
sin afirmar que exista un artefacto disponible para descarga.

## Limitación conocida en Android

La confirmación de un objetivo presenta una excepción nativa en determinadas
builds Android de desarrollo. El problema está registrado en la
[Issue #165](https://github.com/AdrielPasik/PFI---Credenciales-Verificables-y-Perfil-Formativo/issues/165)
y permanece abierto.

La incidencia ocurre después de crear el objetivo, durante la transición hacia
su detalle. No debe considerarse validado ese flujo Android hasta resolverla y
verificarlo nuevamente en el entorno correspondiente.

## Documentación relacionada

- [README principal](../../README.md)
- [Blueprint móvil del titular](../../docs/frontend/scope-holder-mobile-app-blueprint-v1.md)
- [Documentación frontend](../../docs/frontend/README.md)
