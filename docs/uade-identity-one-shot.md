# UADE — one-shot identity provisioner (proposal; do not execute)

The existing `scope-prod-provisioner:1` is registered and uses dedicated task and execution roles. Its image predates this guard, and its entrypoint accepts arbitrary issuer UUIDs. Do not run it for this change. The corrected image must be built, reviewed, pushed and pinned by digest under a separate approval; no deployment to the API service.

## Task definition specification

- Fargate, Linux x86_64 only if matching the approved image; use the existing approved architecture and network settings after verifying them.
- Family `scope-prod-uade-identity-once`, one essential container, image `309490997821.dkr.ecr.us-east-1.amazonaws.com/scope/api@sha256:<REVIEWED_NEW_DIGEST>`.
- Entrypoint `["/bin/sh", "/app/services/api/docker/provision-uade-entrypoint.sh"]`; command `[]`. No arguments. No Nest, migrator or blockchain process. Disable ECS Exec, use no persistent service, stop on exit.
- Nonsecret environment: `AWS_REGION=us-east-1`, `PUBLIC_DID_BASE_URL=https://api.scopeedu.technology`. Only secret injected: `DATABASE_URL`, from the existing scope_app parameter. Do not log its value.
- Task role: a newly authorized time-limited `scope-prod-uade-identity-once-task`, not the API task role. Permit only `ssm:PutParameter` on `arn:aws:ssm:us-east-1:309490997821:parameter/scope/prod/signers/*`; explicitly deny `ssm:Overwrite=true`; no reads, deletion or ECS Exec. The gate and writer use `Overwrite=false` and the AWS managed SSM key; verify applicable effective KMS permissions and policies, no wildcard KMS grant. This prefix is shared and cannot itself isolate the issuer.
- Execution role: existing `scope-prod-provisioner-execution` if effective policy and trust are verified; ECS agent uses it for ECR pull, provisioner log stream and resolving only DATABASE_URL. It is not the application task role. Do not use the migrator execution role or RDS master.
- Restrict caller `ecs:RunTask` to the newly registered exact task definition/cluster and `iam:PassRole` to exactly the approved task and execution roles with `iam:PassedToService=ecs-tasks.amazonaws.com`. Prevent arbitrary command/environment/task-role overrides by the invocation authorization design: ECS IAM alone may not enforce all overrides. Only a trusted, reviewed launcher may invoke. No automatic retries.

## Guard and recovery

The dedicated CLI operation has no issuer or type arguments. It fixes UADE, academic_subject and new anchor. The serializable transaction conditionally updates and locks the issuer row only if authorized, identity absent and exact capability array equals the expected array. Existing identity uniqueness remains the last line of defense. SSM writes precede the transaction: an aborted or ambiguous attempt can leave orphan secrets. Preserve reference metadata, stop, reconcile database and SSM metadata without reading secret values; no retries or deletes without separate review.

The tests use mocks and do not establish real PostgreSQL concurrency. Before any execution, test race ordering and serialization/uniqueness failure against an isolated PostgreSQL instance. Check that conditional update and no-op row lock operate as expected. The existing API uses scope_app; validate actual DB privileges. Security also requires controlling who can launch other provisioners or change issuer state during the one-shot.

## Preflight and completion

Verify issuer ID, authorized status, absent identity and exact list; target DID; target role and image digest; trusted launcher and network/DB/SSM access; SSM/KMS permissions; absence of other provisioning operations. Execute once only after explicit approval. Verify identity, dedicated assertion and anchor metadata, public DID document, preserved types and readiness. Check Base Sepolia 84532 RPC/contract and public anchor balance before any later emission. Do not issue or anchor in this procedure. Remove the temporary task role and invocation authorization only after state has been reconciled; retain secret references and history. No automatic rollback of live signers.
