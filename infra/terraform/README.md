# Scope AWS infrastructure (Terraform)

Two roots, applied in order:

| Root | Purpose | State |
|---|---|---|
| `bootstrap/` | Creates ONLY the dedicated Terraform state bucket | local for the first apply, then **migrated into that bucket (mandatory)** |
| `prod/` | Networking, security groups, ECR, SSM naming, CloudWatch, IAM, GitHub OIDC, RDS, ECS, Cloud Map, ALB | S3 backend with native locking (`use_lockfile`) |

Region `us-east-1`. Nothing here deploys application images, runs migrations,
touches Neon, or moves DNS.

`sql/` holds reviewed, **unexecuted** SQL: the runtime database role bootstrap.

## 0. Account posture and operator authentication

### FREE PLAN GUARDRAIL

```
DO NOT CREATE OR JOIN AWS ORGANIZATIONS
WHILE THE ACCOUNT REMAINS ON THE FREE PLAN FOR THIS PFI.
```

Confirmed account state (external to this repository, supplied by the account
owner): the account is on the **AWS Free Plan** with **USD 100** of credits.

Consequences, and they are decisions rather than deferrals:

- **AWS Organizations: do not enable.** Enabling it converts the account into the
  management account of a new organization. That is an account-level change with
  billing and support implications, it is awkward to undo, and Scope does not need
  it.
- **IAM Identity Center: not used at all** — not as the primary mechanism and not
  as a fallback. An Identity Center *organization instance* (the only kind that
  can assign permission sets to AWS accounts) requires Organizations, which is
  excluded above. An *account instance* cannot grant AWS account access, so it
  would not help either.
- **Multi-account separation, SCPs, centralised billing: out of scope**, because
  they all presuppose Organizations.

None of this costs anything in capability. The only property the excluded
mechanisms would have provided is temporary human credentials without a
long-lived access key, and `aws login` provides exactly that.

### Operator identity (planned, NOT created by this slice)

| Property | Value |
|---|---|
| Type | IAM user, conceptually `scope-operator` |
| Console access | yes, with a password |
| MFA | **mandatory** |
| Access keys | **zero**. None is created, now or later |
| Sign-in policy | AWS managed policy `SignInLocalDevelopmentAccess`, which is what lets `aws login` mint a local session for this identity |
| Terraform permissions | a **separate, reviewable** policy — see "Terraform operator permissions" below |
| `AdministratorAccess` | not attached as a silent default. If it is ever attached it must be an explicit, recorded decision |

Nothing in this slice creates that user, that policy or any other IAM object in
AWS. Every IAM resource Terraform manages is for ECS and GitHub, never for the
human operator.

Root is used only for exceptional account administration — enabling MFA on itself,
the billing alert, a plan change, a support case. **Root is never used for
Terraform.** Root has no permission boundary and cannot be scoped.

### `aws login` runbook

Requires **AWS CLI >= 2.32.0**.

```bash
aws --version                      # must be >= 2.32.0

aws login --profile scope-signin

aws sts get-caller-identity --profile scope-signin
```

The last command must return the expected IAM identity for `scope-operator`, and
its `Arn` must not end in `:root`.

`aws login` obtains and caches temporary credentials itself. **Do not expect
`AWS_SESSION_TOKEN`, or any other AWS credential, to appear as an environment
variable, and do not treat its absence as a finding.** There is nothing to export
and nothing to paste.

Temporary credentials are never copied into `.env`, `terraform.tfvars`, a script,
a GitHub secret, a shared file, or anywhere else in this repository.

### Terraform credential compatibility profile

Terraform and the AWS provider read credentials through the shared-config chain,
and may not consume every newer AWS CLI sign-in mechanism directly. The bridge is
a second profile that resolves credentials through `credential_process`, which is
part of that chain and is understood by the provider.

Conceptual `~/.aws/config` — a **runbook fragment, not a repository file**. No
account id, session ARN or credential appears in it or anywhere in this repo:

```ini
[profile scope-signin]
# session configuration generated / managed by `aws login`
region = us-east-1

[profile scope-terraform]
credential_process = aws configure export-credentials --profile scope-signin --format process
region = us-east-1
```

`aws configure export-credentials --format process` emits exactly the JSON shape
`credential_process` expects, including the expiration, so the provider refreshes
through the same cached session instead of holding a copy.

Expected use:

```bash
aws login --profile scope-signin

AWS_PROFILE=scope-terraform aws sts get-caller-identity   # same identity, via the bridge

AWS_PROFILE=scope-terraform terraform plan
```

If the session has expired, `terraform` fails with a credential error; the fix is
`aws login` again, never a static key.

### Terraform operator permissions

**Status: `TERRAFORM_OPERATOR_POLICY: REVIEW_REQUIRED`.** No policy JSON is
proposed here and none is created in AWS. Writing an exact allow-list from
resource types alone risks omitting actions that only surface during a real
`plan`/`apply` — reading a resource back after creation, tagging, a service-linked
role, a describe call the provider makes for drift. The honest sequence is: review
the inventory below, attach a first-cut policy, run `plan`, and add whatever the
error messages name. Guessing wide is the failure mode this avoids;
`AdministratorAccess` is not the fallback.

The inventory is derived from the resource types actually declared in each root.

**`TERRAFORM_BOOTSTRAP_REQUIRED_PERMISSIONS`** — one bucket and its
configuration, nothing else:

| Capability | Why |
|---|---|
| `sts:GetCallerIdentity` | `data.aws_caller_identity` names the bucket |
| S3 bucket create / read / tag (`CreateBucket`, `ListBucket`, `GetBucketLocation`, `GetBucketTagging`, `PutBucketTagging`, `HeadBucket`) | `aws_s3_bucket` |
| S3 bucket versioning read/write | `aws_s3_bucket_versioning` |
| S3 bucket encryption read/write | `aws_s3_bucket_server_side_encryption_configuration` |
| S3 public-access-block read/write | `aws_s3_bucket_public_access_block` |
| S3 bucket policy read/write | `aws_s3_bucket_policy` |
| S3 lifecycle configuration read/write | `aws_s3_bucket_lifecycle_configuration` |
| S3 object read/write on that bucket only | the backend stores state and lock objects there from Phase B onwards |

Not needed: `s3:DeleteBucket` (the bucket carries `prevent_destroy`), and nothing
outside S3, STS and the tagging calls.

**`TERRAFORM_PROD_REQUIRED_PERMISSIONS`** — by service, from the 28 resource types
in `prod/`:

| Service | Resource types | Capability shape |
|---|---|---|
| STS | `data.aws_caller_identity` | `sts:GetCallerIdentity` |
| S3 | the state backend | object read/write + `ListBucket` on the state bucket only. **No permission on the evidence bucket**: Terraform never reads or writes it |
| EC2 / VPC | `aws_vpc`, `aws_subnet` ×2, `aws_internet_gateway`, `aws_route_table` ×2, `aws_route_table_association` ×2, `aws_vpc_endpoint`, `aws_security_group` ×5, 19 SG rules | create/describe/delete/tag on VPCs, subnets, gateways, route tables, endpoints, security groups and their rules |
| ECR | `aws_ecr_repository` ×2, `aws_ecr_lifecycle_policy` ×2 | repository create/describe/delete/tag, lifecycle policy put/get/delete |
| CloudWatch Logs | `aws_cloudwatch_log_group` ×3 | log group create/describe/delete, `PutRetentionPolicy`, tagging |
| IAM | `aws_iam_role` ×5, `aws_iam_role_policy` ×6, `aws_iam_openid_connect_provider` | role and inline-policy create/get/update/delete/tag, `PassRole` for the roles it creates, OIDC provider create/get/delete/tag. **This is the widest block and the one the review must look at hardest** |
| SSM | `aws_ssm_parameter` ×6 instances (String only) | parameter put/get/describe/delete + tagging on `/scope/prod/*`. No `kms:Decrypt`, because Terraform creates no SecureString |
| Cloud Map | `aws_service_discovery_private_dns_namespace`, `aws_service_discovery_service` | namespace and service create/get/delete/tag |
| Route 53 | implied by the Cloud Map private namespace, plus the gated `aws_route53_record` | private hosted zone create/get/list, record change **only if** `create_api_dns_record` is enabled |
| ELBv2 | `aws_lb`, `aws_lb_target_group`, `aws_lb_listener` ×3 | load balancer, target group and listener create/describe/modify/delete + tagging |
| ACM | `aws_acm_certificate` (gated) | request/describe/delete certificate, only if `request_acm_certificate` is enabled |
| ECS | `aws_ecs_cluster`, `aws_ecs_task_definition` ×3, `aws_ecs_service` ×2 (gated) | cluster, task definition and service create/describe/update/delete + tagging |
| RDS | `aws_db_subnet_group`, `aws_db_instance` | subnet group and instance create/describe/modify/delete + tagging; `rds:AddTagsToResource` |
| Secrets Manager | implied by `manage_master_user_password` | describe the RDS-managed secret. RDS creates and owns it; Terraform only reads its ARN back |

Two things the operator policy must **not** include: any S3 permission on
`traza-demo-document-evidence-30012004`, and `iam:*` unbounded.
## Tooling

```bash
aws --version        # requires >= 2.32.0 (`aws login`)
terraform -version   # requires >= 1.11.0 (S3 native state locking)
```

Provider: `hashicorp/aws ~> 6.66`. `.terraform.lock.hcl` is committed once
`terraform init` has run, so the provider set is reproducible.

## 1. Native validation and apply sequence

This ordering is **mandatory**, and it is the real chicken-and-egg of the backend:
`prod/` cannot `init` against the state bucket until the bucket exists, and the
bucket is created by `bootstrap/`, whose own first run therefore has nowhere
remote to put its state. Every stop below is a human review point.

### PHASE A — ZERO AWS MUTATION

Install:

- AWS CLI >= 2.32.0
- Terraform >= 1.11

Authenticate (section 0):

```bash
aws login --profile scope-signin
```

Verify, through the Terraform compatibility profile:

```bash
AWS_PROFILE=scope-terraform aws sts get-caller-identity
```

Expected: the `scope-operator` IAM identity, `Arn` not ending in `:root`.

Formatting and the bootstrap plan:

```bash
cd infra/terraform
terraform fmt -recursive

cd bootstrap
terraform init
terraform validate
terraform plan -out=bootstrap.tfplan
```

**STOP.** Review the bootstrap plan before any apply. Nothing up to this point has
mutated AWS: `init` downloads a provider, `validate` is offline, and `plan` only
reads.

Expected in that plan: 6 resources, all of them the state bucket and its
configuration. Anything else is a finding.

### PHASE B — FIRST AWS MUTATION

Only after human approval of the plan above:

```bash
terraform apply bootstrap.tfplan
```

This first apply must create **only** the Terraform-state bootstrap resources:
`scope-tfstate-<account-id>-us-east-1`, versioned, SSE-S3, Block Public Access on,
a TLS-only bucket policy, `prevent_destroy`, and superseded state versions expiring
after 90 days.

It is **not** `traza-demo-document-evidence-30012004`. The evidence bucket is never
used for state and is never managed by Terraform.

Export the backend configuration for `prod/`:

```bash
terraform output -raw prod_backend_hcl > ../prod/backend.hcl
```

Then migrate the bootstrap state immediately — this is mandatory, not an optional
tidy-up. Until it is done, the only authoritative record of a `prevent_destroy`
resource is a file on one laptop; losing it means Terraform no longer knows the
bucket exists and the next apply fails on a name that is already taken.

```bash
mv backend.tf.disabled backend.tf

terraform init -migrate-state \
  -backend-config=../prod/backend.hcl

terraform plan
```

Expected: **No changes.**

Only after the remote-state migration succeeds may the local authoritative state
be removed, following the existing runbook (delete `terraform.tfstate` and
`terraform.tfstate.backup`; recovery from then on is the bucket's object
versioning).

### PHASE C — PROD NATIVE PLAN

```bash
cd ../prod
cp terraform.tfvars.example terraform.tfvars    # no secrets in this file

terraform init -backend-config=backend.hcl
terraform validate
terraform plan -out=prod.tfplan
```

**STOP AGAIN.** Do **not** run:

```bash
terraform apply prod.tfplan
```

until the prod plan has been reviewed. What to look for in it:

- zero NAT Gateway;
- zero resources touching `traza-demo-document-evidence-30012004`;
- three separate ECS execution roles, with no parameter ARN containing a wildcard;
- no statement granting `kms:Decrypt`;
- the OIDC trust subject exactly
  `repo:<github_owner>/<github_repository>:environment:production`;
- no `aws_ssm_parameter` of type `SecureString`.

`terraform validate` works offline. `terraform plan` needs credentials, because
`data.aws_caller_identity` is read.
## 2. Secrets: loaded out of band, never by Terraform

An `aws_ssm_parameter` resource stores its value in Terraform state — including a
placeholder such as `CHANGE_ME` and anything produced by `random_password`. So
Terraform owns only the **names**, and each SecureString is created with the AWS
CLI before the services are enabled:

```bash
set +o history                 # keep the value out of shell history
read -rs SCOPE_SECRET          # paste the value, press enter
aws ssm put-parameter \
  --region us-east-1 \
  --name "/scope/prod/api/JWT_SECRET" \
  --type SecureString \
  --value "$SCOPE_SECRET" \
  --no-overwrite
unset SCOPE_SECRET
set -o history
```

Required before `enable_services = true` (exact list also exported by
`terraform output ssm_parameters_required_out_of_band`):

| Parameter | Consumer | Notes |
|---|---|---|
| `/scope/prod/api/DATABASE_URL` | API | Connection string for **`scope_app`**, the dedicated non-master role. Never the master credential |
| `/scope/prod/api/JWT_SECRET` | API | Human session signing key |
| `/scope/prod/api/PROFILE_SHARE_TOKEN_KEY` | API | 32 bytes, base64 or hex. AES-256-GCM key for share-link recovery. The old Render key is NOT reused: current shares are discarded, and this key must exist before the final shares are generated |
| `/scope/prod/shared/AI_INTERNAL_JWT_SECRET` | API + AI | Same value both sides, and it must differ from `JWT_SECRET` or the AI service refuses to start |
| `/scope/prod/ai/OBJECTIVE_ANALYSIS_OPENAI_API_KEY` | AI | Provider key |
| `/scope/prod/ai/EVIDENCE_UNITS_OPENAI_API_KEY` | AI | Provider key |
| `/scope/prod/ai/CONTEXTUAL_REASONING_OPENAI_API_KEY` | AI | Provider key |
| `/scope/prod/ai/OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY` | AI | Provider key |

There is deliberately **no** `/scope/prod/migrator/DATABASE_URL`: see section 3.

### Who can read what

There is no shared ECS execution role. Each workload has its own, and every
parameter is named by exact ARN, never by a `/scope/prod/*` wildcard. The matrix
lives in `local.execution_roles`:

| Execution role | May pull | May write log streams to | May read |
|---|---|---|---|
| `scope-prod-api-execution` | `scope/api` | `/scope/prod/api` | the 4 API SecureStrings + the 2 API `String` parameters |
| `scope-prod-ai-execution` | `scope/ai` | `/scope/prod/ai` | the shared internal JWT secret + the 4 provider keys + the 4 model `String` parameters |
| `scope-prod-migrator-execution` | `scope/api` (it reuses that image) | `/scope/prod/migrator` | the RDS master secret, and nothing in SSM at all |

So the AI path cannot fetch the API session key or the share-token key, the API
path cannot fetch a provider key, and only the migrator can reach the master
credential.

`AmazonECSTaskExecutionRolePolicy` is **not** attached: it grants ECR pull and log
writes on `Resource = "*"`, meaning every repository and every log group in the
account. The same actions are granted inline against one repository and one log
group each.

**No `kms:Decrypt` is granted anywhere.** SecureString parameters use the AWS
managed key `alias/aws/ssm` and the RDS master secret uses
`alias/aws/secretsmanager`. The key policy of an AWS managed key already permits
the account's principals when the call arrives through the owning service, so an
IAM grant is only required for a customer managed key — and Scope uses none. If a
future change introduces a CMK, the grant goes back scoped to that key ARN with a
`kms:ViaService` condition. Operationally: if a task fails at startup with an SSM
or Secrets Manager decryption error, that is the signal this assumption is wrong
for this account, and the scoped grant is added back.

Created by Terraform as non-secret `String` parameters, with value drift ignored
so they can be overwritten later without an apply:

- `/scope/prod/api/BLOCKCHAIN_EVIDENCE_MODE` = `mock`
- `/scope/prod/api/REASONING_EXECUTION_MODEL` = `unset`
- `/scope/prod/ai/OBJECTIVE_ANALYSIS_OPENAI_MODEL` = `unset`
- `/scope/prod/ai/EVIDENCE_UNITS_OPENAI_MODEL` = `unset`
- `/scope/prod/ai/CONTEXTUAL_REASONING_OPENAI_MODEL` = `unset`
- `/scope/prod/ai/OBJECTIVE_UNDERSTANDING_OPENAI_MODEL` = `unset`

The API and the AI service must agree on the model identity or a reasoning run
fails closed before any provider call, which is why the model names are
parameters and not build-time constants.

## 3. Database identities

Two identities, one source of truth each.

| Identity | Who uses it | Where the password lives |
|---|---|---|
| `scope_admin` (RDS master) | this bootstrap, `prisma migrate deploy`, `db:seed`, `db:verify-demo` | **Secrets Manager secret owned by RDS**, generated by `manage_master_user_password`. Single source of truth, never copied |
| `scope_app` | the NestJS runtime | SSM SecureString `/scope/prod/api/DATABASE_URL`, generated out of band |

**The master password is never copied into SSM.** Duplicating it would create a
second copy that silently diverges the moment the secret is rotated. Instead the
one-off migrator task receives it straight from Secrets Manager: ECS injects the
secret's `password` field as `RDS_MASTER_PASSWORD`, and the container's
entrypoint script builds `DATABASE_URL` in memory, percent-encoding the password
with Node before running the requested command. Only the **execution role** can
read that secret, and only that one ARN; no application task role can.

For a manual psql session, fetch it the same way and let the shell discard it:

```bash
SECRET_ARN=$(terraform output -raw rds_master_user_secret_arn)
aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" \
  --query SecretString --output text | python -c 'import json,sys; print(json.load(sys.stdin)["password"])'
```

### Runtime role bootstrap

`sql/01-bootstrap-scope-app-role.sql` creates `scope_app` with `CONNECT` on the
database, `USAGE` (not `CREATE`) on `public`, and default privileges for objects
future migrations create. `sql/02-grant-scope-app-on-existing-objects.sql` grants
`SELECT/INSERT/UPDATE/DELETE` on the tables that already exist — default
privileges are not retroactive — and revokes everything on `_prisma_migrations`.

`scope_app` cannot create, alter, drop or truncate anything. Migrations are run
by `scope_admin` and by nothing else.

Order: apply → `01` → `prisma migrate deploy` → `02` → seed → verify → enable
services. `02` is re-run after every later migration batch.

## 4. GitHub Actions → AWS (OIDC)

`prod/github_oidc.tf` creates the IAM OIDC provider for
`token.actions.githubusercontent.com` and a `scope-prod-github-actions-deploy`
role. No workflow file is created in this slice, and **no AWS access key is ever
issued for CI**.

Trust is an exact `StringEquals` on the token subject:

```
repo:<github_owner>/<github_repository>:environment:production
```

A push to a branch, a tag, a pull request from a fork, another repository under
the same owner, or a job that does not declare the `production` GitHub
Environment, all fail to assume the role. Attach the approval rule to that
Environment in GitHub and every AWS mutation from CI needs a reviewer.

The role can: push to the two ECR repositories, register a task definition,
update the two ECS services, run and observe the migrator task in the Scope
cluster, pass exactly the six ECS roles (three execution, three task), and read
the three log groups. It holds no credential-reading API: no
`ssm:GetParameter(s)`, no `secretsmanager:GetSecretValue`, no `kms:Decrypt`. It
also cannot administer infrastructure: no IAM write, no Terraform state bucket,
no RDS API, no S3.

That is not the same as being unable to reach secrets, and the difference is worth
stating plainly. The role holds **deployment authority** over these workloads: it
can author a task definition and pass the execution roles, so it can deploy code
that runs with the workload identity and can name any parameter that workload's
execution role is allowed to resolve, then read the container output from the log
group. It cannot read a secret through an AWS API call; it can change what runs in
production.

That authority is bounded by three things rather than by the IAM policy alone: the
exact-subject trust condition, the `production` GitHub Environment with a required
reviewer, and the per-workload execution roles, which keep any single task
definition inside one workload's own credentials.

Before applying, confirm the identity variables against the real remote:

```bash
git remote -v      # expected: github.com/<github_owner>/<github_repository>
```

If the account already has a GitHub OIDC provider (only one is allowed per URL),
set `create_github_oidc_provider = false` and pass `github_oidc_provider_arn`.

Workflow side, for the next slice — no secrets, only the role ARN:

```yaml
permissions:
  id-token: write
  contents: read
environment: production
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: <terraform output github_actions_deploy_role_arn>
      aws-region: us-east-1
```

## 5. Full rollout order

Phases A, B and C in section 1 are the mandatory prefix. What follows is the rest
of the road, and none of it is executed by this code.

1. Operator authentication gate (section 0).
2. Phase A — `terraform fmt`, bootstrap `init`/`validate`/`plan`, then STOP.
3. Phase B — apply the bootstrap plan, export `backend.hcl`, migrate the bootstrap
   state to the bucket, confirm "No changes".
4. Phase C — `prod/` `init`/`validate`/`plan`, then STOP for review.
5. `terraform apply prod.tfplan` after review → VPC, subnets, route tables, S3
   gateway endpoint, security groups, ECR, log groups, IAM + GitHub OIDC, Cloud
   Map, ALB + target group + placeholder listener, SSM String parameters, RDS.
   **No task runs.**
6. Put the SecureString parameters in place (section 2) and bootstrap `scope_app`
   (section 3).
7. Build and push the two images; set `api_image_tag` / `ai_image_tag`.
8. Handle DNS + certificate, then `enable_https_listener = true`.
9. `enable_services = true` (the API service has a precondition on step 8).
10. Run the migrator task, then the seed, then `db:verify-demo`.

Steps 6-10 are the next slice.

## 6. Destroy runbook (read before, not during)

An RDS final snapshot identifier is unique and permanent per account and region.
A destroy that reuses a previous identifier fails **while the instance is being
deleted**, which is the worst possible moment.

```bash
terraform output rds_final_snapshot_identifier
aws rds describe-db-snapshots --db-snapshot-identifier "$(terraform output -raw rds_final_snapshot_identifier)"
# if that snapshot already exists, bump rds_final_snapshot_suffix (v1 -> v2)
# in terraform.tfvars and apply BEFORE destroying.
```

`rds_deletion_protection = true` also means a destroy is a two-step operation on
purpose: set it to `false`, apply, then destroy.

## What this configuration deliberately does NOT create

- NAT Gateway (tasks egress through the Internet Gateway with a public IP; their
  application ports are closed by security group).
- Interface VPC endpoints, WAF, RDS Proxy, Multi-AZ, autoscaling, Container
  Insights, Performance Insights, Enhanced Monitoring.
- Any Route 53 hosted zone (delegation of `scopeedu.technology` is external
  state).
- Any GitHub Actions workflow file.
- Any database role, schema, table or row (`sql/` is a design artifact).
- Any resource touching `traza-demo-document-evidence-30012004`, which is
  referenced by ARN for IAM only.
