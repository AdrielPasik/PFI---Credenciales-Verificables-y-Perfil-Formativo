# Verificacion independiente de una credencial (S8)

> Estado: herramienta de SOLO LECTURA incluida en el repositorio. No sustituye la
> verificacion publica de Scope: la complementa para un tercero que no quiere confiar
> en el servidor.

## Tres cosas distintas

| Pregunta | Quien la responde |
|---|---|
| 1. El contenido no fue alterado | Se reconstruye `canon_v2` desde el **contenido** y se compara con el hash firmado. |
| 2. Lo firmo una clave autorizada por el DID del emisor | Se recupera la direccion del `proof` (EIP-191) y se compara con la JWK del DID Document, que debe listarla en `assertionMethod`. |
| 3. La cadena tiene un compromiso independiente | Se consulta `getCredentialStatus(canonicalHash)` en el contrato y se compara el registrante. |

Un cuarto punto queda **fuera** de lo criptografico: que la institucion sea
legitima o este acreditada. Eso es autoridad administrativa y no la prueba nada de lo
anterior.

## Que se puede verificar con material solo publico

`GET /verify/credentials/:id` (sin sesion) expone: `canonicalHash` completo, `proof`,
las coordenadas del registro (red, chainId, contrato, `txHash`, bloque, registrante),
y el DID del emisor. Con eso, sin el contenido, un tercero puede:

- comprobar que la **firma** `proofValue` es valida sobre el compromiso
  (`canonicalHash`) para el `verificationMethod` indicado, y que el DID Document del
  emisor (`GET /did/issuers/:issuerId/did.json`) publica esa clave;
- comprobar en la cadena que ese `canonicalHash` esta **registrado** por la cuenta
  indicada y no esta revocado.

## Que requiere la presentacion del titular

El `/verify` publico **no** devuelve `description`, `hours`, `credentialSubject` ni
`issuedAt` exacto: es contenido de la credencial y se preserva la privacidad. Para
comprobar que *el contenido que alguien muestra* es el que se firmo, el **titular
(o una fuente autorizada) debe presentarlo**. El verificador reconstruye entonces
`canon_v2` y falla si cualquier campo canonico difiere.

## Uso

```bash
# 1. Armar el archivo de material (ver formato abajo).
# 2. DID Document: de un archivo o de la URL publica del did:web.
# 3. El RPC se entrega SOLO en tiempo de ejecucion y nunca se imprime.
CREDENTIAL_REGISTRY_RPC_URL=<endpoint de Base Sepolia> \
  npm run verification:verify-independently --workspace @credential-intelligence/api -- \
  --material ./material.json --fetch-did
```

Sin `CREDENTIAL_REGISTRY_RPC_URL` solo se verifica la **autoria** y el veredicto es
`VERIFIED_AUTHORSHIP_ONLY` (nunca `VERIFIED`).

Formato de `material.json`:

```json
{
  "schema": "scope-independent-verification-material-v1",
  "credential": {
    "credentialId": "...", "type": "course", "title": "...",
    "description": null, "hours": 40, "issuedAt": "2026-10-16T10:00:00Z",
    "credentialSubject": { "achievement_name": "...", "institution_name": "..." },
    "issuerDid": "did:web:api.scopeedu.technology:did:issuers:<uuid>",
    "subjectDid": "did:web:api.scopeedu.technology:did:users:<uuid>"
  },
  "canonicalHash": "0x...",
  "proof": { "...": "las ocho claves del proof, tal como las devuelve /verify" },
  "chain": {
    "network": "base_sepolia", "chainId": 84532,
    "contractAddress": "0x...", "registrantAddress": "0x..."
  }
}
```

Veredictos: `VERIFIED`, `VERIFIED_AUTHORSHIP_ONLY`, `INVALID`, `INDETERMINATE`,
`REVOKED_ON_CHAIN`, `CHAIN_MISMATCH`. Sale con codigo `0` solo para `VERIFIED`.

## Limites

- No prueba que la cuenta de **anclaje** pertenezca a la institucion: el DID Document
  publica la clave de **asercion**; la cuenta registrante se compara contra lo que
  declara el material.
- No hace claims de finalidad (1 confirmacion).
- Reutiliza `CredentialAuthenticityVerifier`, `CredentialHashingService` y el cliente
  de lectura del contrato del servidor: no duplica criptografia.
- No usa PostgreSQL, AWS ni claves privadas; no envia transacciones.
