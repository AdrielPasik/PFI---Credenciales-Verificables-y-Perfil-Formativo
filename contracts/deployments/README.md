# CredentialRegistry deployments

This directory is the **single home of deployment evidence** for
`CredentialRegistry` (S8c10). It holds three kinds of file.

| File | What it is |
|---|---|
| `deployment-toolchain.json` | The reviewed build identity: required `forge` version, `solc` version, frozen compiler settings and the hashes of the reviewed artifact. The deployment tool refuses to run if the installed toolchain or the built artifact differs. |
| `credential-registry-deployment.schema.json` | Documents the manifest contract. The authoritative validator is `services/api/src/blockchain/deployment/deployment-manifest.ts`. |
| `<deploymentId>.json` | One **immutable manifest per deployment**. Created only by the deployment tool, only after the chain evidence was observed and verified. |

There is **no deployment manifest here yet**. A manifest is never created by hand,
never contains placeholder values, and is never produced before a real
deployment. Until the real deployment (S8c10.2) happens, this directory contains
no `base-sepolia-84532-*.json` file.

## Manifest rules

- `deploymentId = "base-sepolia-84532-" + lowercase(contractAddress)` (with `0x`).
  It is derived from the observed address, not chosen. Maximum length 61, inside
  the backend limit of 64.
- `contractAddress` is EIP-55; the id uses the lowercase form.
- Every post-deployment field (`contractAddress`, transaction hash, block number,
  block hash, timestamp, deployer) comes from chain evidence. The timestamp is the
  block timestamp, never a local clock.
- `deploymentSourceCommit` is the exact commit the artifact was built from. The
  manifest is normally committed **after** the deployment, so this is deliberately
  **not** the commit that contains the manifest (no circular identity).
- The manifest holds on-chain facts only. It never holds an RPC URL, a keystore
  path, a key, a passphrase, a funding state, a readiness state or AWS state.
- Files are append-only. The tool refuses to overwrite one, and there is no
  `latest.json`.
- Explorer source verification, if it is ever done, is separate evidence and does
  not rewrite a manifest.

## Why one canonical deployment

Scope stores the deployment (`network`, `chainId`, `contractAddress`,
`deploymentId`) on every `BlockchainRecord`, but record-bound resolution today
only works for the **currently configured** target. Historical records written to a
previous deployment cannot be revoked or read once the configured target changes.

So the project uses **one canonical Base Sepolia deployment**:

- Before the first real `BlockchainRecord`, an invalid deployment can be replaced
  through an explicit, reviewed operator decision.
- After the first real `BlockchainRecord` exists on the canonical deployment, do
  **not** change the configured `contractAddress` or `deploymentId`. Multi-deployment
  historical resolution is not implemented, and contract rotation is not supported.

See `../DEPLOYMENT_BASE_SEPOLIA.md` for the operator procedure.
