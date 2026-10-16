# Isolated ECS sync integration probe

This is an independent resource set that validates the observable
behavior of Step Functions ecs:runTask.sync before any persistent provisioning
workflow is given a caller. The variable default remains disabled with
enable_ecs_sync_probe = false. Production desired state is explicitly enabled
only by the reviewed, non-secret `ecs_sync_probe.auto.tfvars` file.

It is not part of the 15 deployed H2-B resources. Enabling it requires a new,
separate Terraform plan and human review.

## Nonpersistent contract

The probe has its own immutable ECR repository, CloudWatch log group, security
group, Fargate task definition, task execution role, policy-free task role,
and Step Functions state machine. The GitHub OIDC operator role is independently opt-in.

The task image is a pinned linux/amd64 BusyBox manifest plus a small shell
entrypoint. It accepts only:

- exit-zero, which writes one fixed log line and exits 0;
- exit-nonzero, which writes one fixed log line and exits 23.

It has no application code and receives no environment variables, secrets,
volumes, database access, SSM access, Secrets Manager access, signer access,
or credential/issuer input. Its application role has no permissions. The
execution role can pull only the probe image and write only probe logs.

The state machine accepts only a mode of exit-zero or exit-nonzero. Its ECS
cluster, task definition, subnets, security group, launch type and
execute-command setting are fixed in the ASL. It has no Retry. Errors enter
PROBE_REQUIRES_INSPECTION; neither the probe nor the workflow interprets a
result as permission to retry.

## Dedicated caller

scope-prod-provisioner-operator is a distinct GitHub OIDC role. It is not created by the infrastructure-only probe deployment: it additionally requires enable_ecs_sync_probe_github_oidc_caller = true. Once separately authorized, it can call
only states:StartExecution on the isolated probe state machine. It has no
ecs:RunTask, iam:PassRole, database, SSM, signer, or permission on the
persistent provisioning state machine.

Its trust policy requires all of the following:

- aud=sts.amazonaws.com;
- the exact production environment subject for the configured repository;
- ref=refs/heads/main;
- environment=production;
- event_name=workflow_dispatch;
- workflow=Run isolated ECS sync probe;
- explicitly supplied immutable GitHub repository and owner numeric IDs.

The GitHub workflow is manual only, declares the production environment, has
a bounded scenario choice and starts exactly one execution. A separately
authorized observer must inspect Step Functions execution history, ECS task
metadata and probe logs. The caller cannot query or alter the persistent
workflow.

## Deployment and caller review

Before the infrastructure can exist in AWS, the versioned production desired
state provides:

    enable_ecs_sync_probe       = true
    ecs_sync_probe_image_digest = "sha256:<reviewed 64 lowercase hex>"

The GitHub OIDC caller remains absent unless a later, separately reviewed plan also provides:

    enable_ecs_sync_probe_github_oidc_caller = true
    github_oidc_repository_id                 = "<immutable GitHub repository ID>"
    github_oidc_repository_owner_id           = "<immutable GitHub owner ID>"

Review the plan as a new resource set. Confirm that the digest was built from
infra/docker/ecs-sync-probe, is linux/amd64, and exists in the separate
repository. Verify the OIDC claim behavior with an actual GitHub-issued token
before relying on the immutable ID and workflow claim conditions.

## Completed isolated evidence — 2026-10-16

The two isolated experiments closed the ECS `.sync` contract used by the
probe. Each experiment submitted exactly one ECS task and no retries occurred.
`exit-zero` produced `TaskSucceeded` with
`$.Containers[0].ExitCode = 0` in the Step Functions output. `exit-nonzero`
produced `States.TaskFailed`; its parsed cause contained
`$.Containers[0].ExitCode = 23`. The terminal
`PROBE_REQUIRES_INSPECTION` event was the probe's explicit application-defined
`Fail` state, not the raw integration error.

These results verify the production provisioner's narrow parsing contract:
accept only an explicit zero exit code and route a nonzero or differently
shaped result to `INSPECT_FIRST`. They do not establish anything about
persistent issuer, signer, or database side effects.
The auto-loaded file must remain in the canonical production checkout after
deployment. Removing it, or changing `enable_ecs_sync_probe` to false, makes a
normal Terraform plan propose removal of the probe resources. It contains only
the reviewed feature flags and immutable image digest; it must never contain
credentials or other runtime values.
