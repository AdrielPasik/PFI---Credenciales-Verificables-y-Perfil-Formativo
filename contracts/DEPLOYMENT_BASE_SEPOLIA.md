# CredentialRegistry → Base Sepolia: deployment runbook (S8c10)

> **Status: tooling prepared, NOTHING deployed.** S8c10.1 produced local tooling
> only. This document describes the procedure for the later real deployment
> (S8c10.2). Following it is a separate, explicitly approved operation. Until that
> operation happens, `CredentialRegistry` is **not** deployed to Base Sepolia, Scope
> is **not** live there, AWS is **not** configured for it and no blockchain
> end-to-end flow has been proven.

Final target of the project: `evidenceMode = credential_registry`,
`network = base_sepolia`, `chainId = 84532`. Mock and Anvil remain development and
test modes; they do not satisfy final blockchain acceptance.

## 0. Frozen decisions

1. **ONE canonical Base Sepolia deployment.** Scope keeps deployment provenance on
   each `BlockchainRecord` but does not yet support operating several historical
   deployments after the configured target changes.
   - Before the **first real** `BlockchainRecord` exists, an invalid deployment may
     be abandoned through an explicit, reviewed operator decision.
   - After the first real `BlockchainRecord` is registered on the canonical
     deployment, **do not change** the configured `network`, `chainId`,
     `contractAddress` or `deploymentId`. Multi-deployment historical resolution is
     not implemented and contract rotation is **not supported**. Do not claim it.
2. **`deploymentId = "base-sepolia-84532-" + lowercase(contractAddress)`**, with the
   `0x` prefix and the full 40 hex characters. It is derived from the chain, never
   chosen. 61 characters, inside the backend limit of 64.
3. **Foundry compiles and tests; the TypeScript operator tool deploys.** There is
   exactly one approved broadcaster: `npm run blockchain:deploy-registry`. No other
   command is an approved production deployment path, and no production path accepts a
   private key as an argument.
4. **The deployer is a one-shot infrastructure identity.** The contract has no owner,
   admin, pause or upgrade path, so the deployer has no authority after deployment.
   It is not the anchor signer, not the assertion signer, and the API runtime never
   needs it. It never becomes a `SignerProfile`.
5. **`deploymentSourceCommit`** is the exact Git commit the artifact was built from.
   The manifest is normally committed *afterwards*, so it is **not** necessarily the
   commit that contains the manifest. That is intentional: there is no circular
   identity.
6. **Deployment runs from a clean, isolated checkout** at exactly
   `deploymentSourceCommit`. Never from the main working tree, which can contain
   unrelated dirty web / AI work.
7. **On-chain exact runtime bytecode equality is the identity authority.** Explorer
   source verification is optional and non-blocking.

## A. Preparation (no chain, no secret)

1. Create a **clean** dedicated worktree or checkout at the reviewed commit
   (`deploymentSourceCommit`). Do this by hand; the tool only checks it.
   `git status` for `contracts/`, `services/api/src/blockchain/` and
   `services/api/package.json` must be empty. The Solidity files check out with LF on
   every platform (`.gitattributes`), because the compiled metadata hash covers the
   exact source bytes.
2. Check the toolchain. The installed `forge --version` must equal
   `requiredForgeVersion` **and** `requiredForgeCommitSha` in
   `contracts/deployments/deployment-toolchain.json`. The tool refuses any
   difference and installs or updates nothing.
3. `forge build` and `forge test` inside `contracts/`. The generated `out/` and
   `cache/` directories are operational artifacts, are git-ignored and are **not**
   the manifest.
4. The tool then validates the artifact: contract name, frozen ABI, non-empty
   creation and runtime bytecode, empty `linkReferences`, no immutables, no
   constructor arguments, the runtime embedded unchanged in the creation code, the
   frozen compiler settings, and the reviewed `creationBytecodeHash` /
   `runtimeBytecodeHash` from the toolchain file. If the Solidity source, a build
   setting or the checkout bytes changed, the build no longer matches and nothing is
   deployed until the change is reviewed and the toolchain file updated.
5. Have an **existing encrypted JSON keystore** for the deployer **outside the
   repository**. The tool never generates, imports or stores a key. Know the
   deployer's *public* address.
6. Gas estimation and funding come later, in S8c10.2. No amount is chosen here.

## B. Pre-broadcast gate (no transaction)

```text
npm run blockchain:deploy-registry --workspace @credential-intelligence/api -- \
  --keystore <path-to-encrypted-keystore> --source-commit <40-hex deploymentSourceCommit>
```

Without `--execute` the tool performs the whole gate and **sends nothing**:

- `HEAD == deploymentSourceCommit` and a clean relevant tree;
- toolchain and artifact checks above;
- **one** provider is created, `getNetwork()` must be chain `84532`. A wrong chain
  means zero transactions, with no fallback to Anvil, mainnet or any other network
  and no second provider;
- only then is the keystore opened (hidden passphrase prompt);
- the deployer's pending nonce and the **expected CREATE address**
  (`deployer + nonce`) are computed; that address must be empty and have no
  manifest;
- `estimateGas` succeeds.

It prints only public facts: deployer address, nonce, expected CREATE address,
chain id, bytecode hashes, source commit. No secret, no RPC URL, no path.

**Secret input.** The RPC URL carries a provider token, so it is **never** an
argument: it is read from `CREDENTIAL_REGISTRY_RPC_URL` or typed into a hidden
prompt. The keystore passphrase is typed into a hidden prompt. There is no flag for a
key, a mnemonic, a seed, a passphrase or the RPC URL, and unknown flags are rejected
without echoing their value. Without an interactive terminal the tool fails closed
instead of falling back to an echoing prompt. The tool does not load the API `.env`
and does not read `CREDENTIAL_REGISTRY_PRIVATE_KEY`.

## C. Mutation (one send)

Re-run the same command with `--execute`. The tool performs **at most one**
deployment send: no retry, no loop, no "send again if the wait times out". The
transaction data is exactly the reviewed creation bytecode, with no constructor
arguments, proxy, factory or CREATE2.

## D. Post-broadcast verification

Once a trustworthy transaction hash exists, that hash is the identity of the
attempt. The tool waits for **5 confirmations** and then requires:

- a receipt with `status == 1`, `to == null`, `from == deployer`, the same hash, a
  valid block and a `contractAddress` equal to the expected CREATE address;
- `eth_getCode(contractAddress)` byte-equal to the artifact runtime bytecode (any hex
  case) and with the same `keccak256`. "Code exists" is not enough and nothing is
  stripped;
- the transaction read back from the chain: no `to`, from the deployer, data equal to
  the reviewed creation bytecode, chain `84532`;
- the block read back through the same provider: same number, canonical hash, and the
  UTC timestamp taken from `block.timestamp` (never `Date.now()`);
- the acceptance depth measured independently of the signer's own wait;
- a **second read** of receipt, block, transaction and code after the threshold. If it
  contradicts the first, nothing is finalized.

## E. Finalization

Only after every check passes does the tool build the manifest, from observed
evidence only, validate it and write
`contracts/deployments/<deploymentId>.json` with create-exclusive semantics.
Manifests are append-only: an existing file is never overwritten and there is no
`latest.json`.

Then, by hand: review the manifest, commit it (the commit that contains it does not
have to equal `deploymentSourceCommit`), and later prove the runtime target equals it:

```text
npm run blockchain:check-target --workspace @credential-intelligence/api -- \
  contracts/deployments/<deploymentId>.json
```

which prints `TARGET_MATCH=true` or `TARGET_MATCH=false REASONS=...` from the four
non-secret target variables. Updating AWS / SSM and switching the runtime to
`credential_registry` belong to S8c11, not here.

## F. Failure and recovery. Never blind-redeploy

| Outcome | Meaning | Action |
|---|---|---|
| Any pre-send code (`SOURCE_*`, `TOOLCHAIN_MISMATCH`, `ARTIFACT_INVALID`, `CHAIN_*`, `SIGNER_UNAVAILABLE`, `CREATE_ADDRESS_OCCUPIED`, `MANIFEST_ALREADY_EXISTS`, `PRE_SEND_ESTIMATE_FAILED`) | zero transactions | fix the cause and rerun the gate |
| `AMBIGUOUS_DEPLOYMENT_SEND` | send ended without a trustworthy hash | **Do not send again.** Reconcile the deployer nonce and the expected CREATE address on the chain before any decision |
| `DEPLOYMENT_PENDING_RECONCILIATION` | transaction was broadcast, no confirmed receipt | **Do not redeploy.** Inspect that transaction hash on the chain |
| `DEPLOYMENT_FAILED_RECEIPT` | receipt status failed | no valid deployment; decide explicitly before any new attempt |
| `DEPLOYMENT_CODE_EMPTY` | success receipt but no code | evidence invalid; stop |
| `DEPLOYMENT_IDENTITY_MISMATCH` | chain code is not the reviewed artifact | **security / deployment blocker**; stop |
| `DEPLOYMENT_TRANSACTION_MISMATCH` / `DEPLOYMENT_RECEIPT_INVALID` / `DEPLOYMENT_BLOCK_INVALID` / `DEPLOYMENT_EVIDENCE_CONTRADICTION` / `DEPLOYMENT_NOT_YET_CONFIRMED` | evidence not acceptable | no manifest; investigate the existing transaction |
| `DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED` | contract **exists** on chain, the file was not written | **Do not redeploy.** Rebuild the manifest from the same transaction using the printed hash, address, block, `deploymentId` and `deploymentSourceCommit`, and the known source commit |
| manifest committed, runtime config not applied | contract exists; Scope integration incomplete | continue in S8c11 |

A failed or abandoned deployment is replaced only through an explicit reviewed
operator decision, and only before the first real `BlockchainRecord`.

## G. Known limitations carried into S8c11

These are **not** solved here and must not be hidden:

1. **API and migrator share one image tag.** Terraform builds both task definitions
   from `api_image_tag`, so a normal apply can roll the API before migrations run.
   This is a HIGH deployment risk. Required before the S8c11 live API rollout that
   depends on the S8 migrations: independent migrator versioning (preferred:
   a dedicated `migrator_image_tag`) or another reviewed safe mechanism. A targeted
   apply is **not** an approved normal strategy.
2. **`SIGNER_SECRET_REF_PREFIX` is not set in the ECS environment.** The signer store
   treats it as an optional defence-in-depth check with no default. IAM is the
   authoritative boundary, and the operator provisioning tool requires the prefix.
   Decide and wire it deliberately.
3. **Reconciliation has no production invocation path.** S8c11 needs one, using the
   manifest `deploymentBlockNumber` as the lower bound of a bounded, chunked
   `getLogs`, no resend when the event is missing, and mandatory registrant
   correlation.
4. **Runtime preflight proves code presence only**, not contract identity. The
   manifest is the trust anchor.
5. **Multiple API tasks can overlap during a rolling deployment** (min 100% / max
   200%) and the nonce queue is process-local. S8c11 needs a single effective blockchain
   writer during the live window.
6. **Multi-deployment historical resolution is incomplete** (see section 0).

## Deployer funding (later, S8c10.2)

The deployer needs testnet ETH for the deployment gas only; the anchor signer needs it
for register / revoke; the assertion key needs none. No amount is fixed here:
estimate gas first and add a deliberate safety margin at that time.
