# AI Service

Servicio desacoplado previsto en Python + FastAPI para analisis semantico de credenciales educativas verificables.

## Principios

- ejecutar como servicio separado;
- comunicarse con el backend Node por HTTP interno;
- no correr como scripts sueltos invocados directamente desde Node;
- trabajar sobre credenciales normalizadas y verificadas.

## Endpoints conceptuales futuros

- `POST /semantic/analyze-credential`
- `POST /semantic/build-profile`
- `GET /semantic/profile/{userId}`

## Estado actual

Se definio la separacion del modulo y la documentacion inicial. La implementacion real de FastAPI, modelos y pipeline semantico se deja para etapas posteriores.
