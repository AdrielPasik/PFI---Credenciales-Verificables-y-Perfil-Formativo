# ---------------------------------------------------------------------------
# Identity / region
# ---------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region. Fixed to us-east-1: the existing S3 evidence bucket lives there and the API must sit next to its database."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name used in resource names and tags."
  type        = string
  default     = "prod"
}

variable "availability_zones" {
  description = "Exactly two AZs. Hardcoded instead of discovered so `terraform validate`/`plan` stay deterministic and do not depend on a live data source."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "Exactly two availability zones are required (ALB needs two subnets, RDS needs a two-AZ subnet group)."
  }
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR for the dedicated Scope VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnets (ALB + Fargate tasks with public IP for egress). No NAT Gateway is used."
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "database_subnet_cidrs" {
  description = "Private subnets with no route to the internet, used only by the RDS DB subnet group."
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

# ---------------------------------------------------------------------------
# Application ports (verified against the repository, not assumed)
# ---------------------------------------------------------------------------

variable "api_container_port" {
  description = "NestJS listening port. services/api/src/main.ts uses process.env.PORT with 3000 as fallback."
  type        = number
  default     = 3000
}

variable "ai_container_port" {
  description = "FastAPI listening port. services/ai-service/src/api/run.py uses PORT with 8000 as fallback and the Dockerfile EXPOSEs 8000."
  type        = number
  default     = 8000
}

# ---------------------------------------------------------------------------
# Existing S3 evidence bucket (NOT managed by this configuration)
# ---------------------------------------------------------------------------

variable "document_evidence_bucket_name" {
  description = "Pre-existing bucket holding DocumentEvidence bytes. Referenced by name to build IAM policy only: never created, imported, modified or destroyed by Terraform."
  type        = string
  default     = "traza-demo-document-evidence-30012004"
}

variable "document_evidence_prefix" {
  description = "Object key prefix actually used by services/api/src/document-evidence/document-storage.factory.ts (AWS_S3_PREFIX default). Stored storageKeys start with it, so it must not change."
  type        = string
  default     = "document-evidence"
}

# ---------------------------------------------------------------------------
# ECS sizing / rollout gates
# ---------------------------------------------------------------------------

variable "api_task_cpu" {
  description = "Fargate CPU units for the API task (512 = 0.5 vCPU)."
  type        = number
  default     = 512
}

variable "api_task_memory" {
  description = "Fargate memory (MiB) for the API task."
  type        = number
  default     = 1024
}

variable "ai_task_cpu" {
  description = "Fargate CPU units for the AI task (1024 = 1 vCPU; required by validated local E5 runtime capacity evidence)."
  type        = number
  default     = 1024
}

variable "ai_task_memory" {
  description = "Fargate memory (MiB) for the AI task (2048 MiB; required by validated local E5 runtime capacity evidence)."
  type        = number
  default     = 2048
}

variable "task_cpu_architecture" {
  description = "X86_64 unless the repository requires otherwise. GitHub-hosted x86 runners build these images natively and the Python wheels + Prisma engines used here have x86_64 builds."
  type        = string
  default     = "X86_64"
}

variable "api_desired_count" {
  description = "Desired API tasks once services are enabled. Only 0 (scaled to zero) or 1 (a single API task, the default; no autoscaling) are supported while blockchain nonce coordination is process-local."
  type        = number
  default     = 1

  validation {
    condition     = contains([0, 1], var.api_desired_count)
    error_message = "api_desired_count must be 0 or 1 while blockchain nonce coordination is process-local."
  }
}

variable "ai_desired_count" {
  description = "Desired AI tasks once services are enabled."
  type        = number
  default     = 1
}

variable "ai_area_embeddings_enabled" {
  description = "Enables the validated area-embedding reranker in the AI task definition. Keep false for the initial runtime deployment and lexical smoke."
  type        = bool
  default     = false
}

variable "profile_embeddings_enabled" {
  description = "Enables Profile Embedding V1 end-to-end. The same explicit false-by-default gate is passed to API persistence/composition and the private AI encoder."
  type        = bool
  default     = false
}

variable "profile_embeddings_model_dir" {
  description = "Absolute, read-only in-image path of the frozen E5 snapshot used by Profile Embedding V1. This is not a host path and must match the AI image Dockerfile."
  type        = string
  default     = "/opt/pfi/models/multilingual-e5-small"

  validation {
    condition     = startswith(var.profile_embeddings_model_dir, "/")
    error_message = "profile_embeddings_model_dir must be an absolute in-container path."
  }
}

variable "manage_ecs_services" {
  description = <<-EOT
    Lifecycle gate for the persistent ECS service resources. Defaults to TRUE
    so a production state cannot propose deleting API and Cloud Map-backed AI
    services solely because an ignored local tfvars file is absent. Set FALSE
    only in a separate bootstrap state before these services have ever existed.
  EOT
  type        = bool
  default     = true
}

variable "enable_services" {
  description = <<-EOT
    Capacity gate for the ECS services. FALSE preserves their managed resource
    identities while setting desired_count to zero, so no Fargate task or task
    public IPv4 is allocated. TRUE applies api_desired_count and
    ai_desired_count after images and every required SSM parameter exist.
  EOT
  type        = bool
  default     = false
}

variable "api_image_tag" {
  description = "Image tag for the API task definition. Block 1B replaces this with the immutable git SHA."
  type        = string
  default     = "bootstrap"
}

variable "migrator_image_tag" {
  description = <<-EOT
    Image tag for the production migrator task definition. It selects a tag in the
    SAME ECR repository as the API (the migrator reuses the API image), but it is
    chosen INDEPENDENTLY of api_image_tag: changing one never changes the other,
    and there is no fallback between them.

    REQUIRED, deliberately WITHOUT a default. If the operator has not set it,
    plan and apply fail closed instead of silently reusing the API tag.

    First apply of this variable: set it to the EXACT tag the live
    scope-prod-migrator task definition already runs, read from that task
    definition. Never reconstruct a full tag from a shortened SHA. The first plan
    must show the migrator image unchanged; any unexpected image change in either
    task definition is a deployment blocker. Moving the migrator to a newer image
    is a separate, reviewed migration rollout.
  EOT
  type        = string

  validation {
    condition     = length(trimspace(var.migrator_image_tag)) > 0
    error_message = "migrator_image_tag must be set to the exact image tag the migrator should run. It has no default and never falls back to api_image_tag."
  }
}

variable "provisioner_image_digest" {
  description = <<-EOT
    Exact ECR image manifest digest for the dedicated issuer-provisioner task
    definition, in the complete canonical form sha256:<64 lowercase hex>. The task
    runs the SAME ECR repository as the API, but is referenced by CONTENT
    (repository@digest), never by tag, and independently of api_image_tag and
    migrator_image_tag.

    REQUIRED, deliberately WITHOUT a default and with NO fallback to any tag. If it
    is missing or malformed, plan and apply fail closed.

    The value is NOT chosen by Terraform: there is no lookup of a tag, no ECR data
    source and no discovery. It must be copied from a reviewed release image (one
    built from a commit that contains services/api/docker/provisioner-entrypoint.sh,
    S8c11.4a or later) and reviewed before plan/apply. It is public metadata, not a
    secret.

    Before using a value, the release process must confirm that the digest exists
    in this ECR repository, that the manifest matches the task CPU architecture,
    that it corresponds to the reviewed release artifact, and that no ECR
    lifecycle rule will expire it before the task is meant to run. A missing image
    makes the task fail to start; it never falls back to a tag.
  EOT
  type        = string

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.provisioner_image_digest))
    error_message = "provisioner_image_digest must be a complete digest of the form sha256:<64 lowercase hex characters>. It has no default and never falls back to a tag."
  }
}

variable "ai_image_tag" {
  description = "Image tag for the AI task definition. Block 1B replaces this with the immutable git SHA."
  type        = string
  default     = "bootstrap"
}

variable "enable_ecs_exec" {
  description = "Allow `aws ecs execute-command` into running tasks. Free, adds ssmmessages:* to the task roles, and is the only in-VPC debugging path once RDS is private."
  type        = bool
  default     = true
}

variable "migrator_command" {
  description = "Command for the one-off migrator task definition. Runs Prisma migrations from inside the VPC; never executed by Terraform."
  type        = list(string)
  default     = ["npx", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]
}

# ---------------------------------------------------------------------------
# Application configuration (non-secret only)
# ---------------------------------------------------------------------------

variable "web_origin" {
  description = <<-EOT
    Exact browser origin allowed by the API CORS layer (services/api/src/config/web-cors.ts
    accepts a single origin, no wildcards). Empty disables CORS entirely, which is
    the safe default while the Vercel deployment still points at Render. Set it to
    the exact Vercel production origin at cutover time.
  EOT
  type        = string
  default     = ""
}

variable "public_did_base_url" {
  description = "HTTPS origin embedded into newly provisioned did:web identifiers (write-once per holder). Must be the stable API hostname."
  type        = string
  default     = "https://api.scopeedu.technology"
}

variable "ai_service_timeout_ms" {
  description = "Per-call timeout the API applies to the AI service (AbortController). Also drives the public execution lease floor."
  type        = number
  default     = 60000
}

variable "ai_internal_jwt_issuer" {
  description = "iss claim of the internal service JWT. Must match on both services."
  type        = string
  default     = "traza-api"
}

variable "ai_internal_jwt_audience" {
  description = "aud claim of the internal service JWT. Must match on both services."
  type        = string
  default     = "traza-ai-service"
}

variable "ai_internal_jwt_expires_in_seconds" {
  description = "TTL of the internal service JWT minted per call by the API (max accepted by the API is 300)."
  type        = number
  default     = 60
}

variable "ai_internal_jwt_clock_skew_seconds" {
  description = "Clock skew tolerated by FastAPI when validating the internal JWT."
  type        = number
  default     = 30
}

variable "ai_service_max_pdf_bytes" {
  description = "Upper bound FastAPI accepts for a PDF upload. Matches services/ai-service/.env.example."
  type        = number
  default     = 26214400
}

variable "jwt_expires_in" {
  description = "Human session token lifetime used by the API."
  type        = string
  default     = "1h"
}

# ---------------------------------------------------------------------------
# RDS
# ---------------------------------------------------------------------------

variable "create_rds" {
  description = "Gate for the database. Kept separate from the rest of the foundations so the instance can be created on the day the migrations run instead of billing idle hours earlier."
  type        = bool
  default     = true
}

variable "rds_engine_version" {
  description = "PostgreSQL major only. AWS selects the current minor inside major 16, matching the Neon source major (16.15) and the local docker-compose (16.8). No minor is guessed."
  type        = string
  default     = "16"
}

variable "rds_instance_class" {
  description = "Smallest current-generation Graviton class. Sufficient for PFI traffic and the Prisma pool (3-5 connections per task)."
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage" {
  description = "GiB of gp3 storage. 20 is the RDS minimum for gp3 and far above the measured dataset (617+22+22+977 reference rows plus demo transactional data)."
  type        = number
  default     = 20
}

variable "rds_backup_retention_days" {
  description = "Automated backup retention. Backup storage up to the allocated size carries no extra charge."
  type        = number
  default     = 7
}

variable "rds_deletion_protection" {
  description = <<-EOT
    TRUE by default: once the final demo dataset is rebuilt in RDS it is the system
    of record for the defense, and `terraform destroy` must not be able to remove
    it. Teardown therefore requires an explicit two-step decision: set this to
    false, apply, then destroy.
  EOT
  type        = bool
  default     = true
}

variable "rds_master_username" {
  description = "Master user created by RDS. Its password is generated and stored by AWS (see manage_master_user_password), never by Terraform."
  type        = string
  default     = "scope_admin"
}

variable "rds_database_name" {
  description = "Initial database created inside the instance. Prisma connects to this database."
  type        = string
  default     = "scope_app"
}

variable "rds_backup_window_utc" {
  description = "Daily automated backup window in UTC (03:10-03:40 Argentina time)."
  type        = string
  default     = "06:10-06:40"
}

variable "rds_maintenance_window_utc" {
  description = "Weekly maintenance window in UTC, outside the backup window."
  type        = string
  default     = "sun:07:00-sun:07:30"
}

# ---------------------------------------------------------------------------
# ALB / DNS
# ---------------------------------------------------------------------------

variable "api_hostname" {
  description = "Stable public hostname for the API. No DNS record and no certificate validation happen in this slice."
  type        = string
  default     = "api.scopeedu.technology"
}

variable "alb_idle_timeout_seconds" {
  description = <<-EOT
    1200s. The public contextual verification and holder reasoning endpoints are
    synchronous: one attempt is (2 + N requirements) sequential AI calls, each
    bounded by ai_service_timeout_ms, so a worst case attempt approaches 14 minutes
    with the 12-requirement ceiling. The ALB default of 60s would cut those
    responses. This does not change any application timeout.
  EOT
  type        = number
  default     = 1200
}

variable "alb_deregistration_delay_seconds" {
  description = "Connection draining window. ECS waits for this before sending SIGTERM, so an in-flight synchronous run can finish during a deployment."
  type        = number
  default     = 900
}

variable "alb_deletion_protection" {
  description = "Left false in Block 1A so the foundations can still be torn down cleanly. Flip to true once the hostname is live."
  type        = bool
  default     = false
}

variable "enable_https_listener" {
  description = "Gate for the :443 listener. Requires an ISSUED ACM certificate, which requires DNS validation, which requires the domain delegation decision. FALSE in Block 1A."
  type        = bool
  default     = false
}

variable "acm_certificate_arn" {
  description = "ARN of an already ISSUED certificate for api_hostname. Leave empty to let this configuration request one (see request_acm_certificate)."
  type        = string
  default     = ""
}

variable "request_acm_certificate" {
  description = <<-EOT
    FALSE in Block 1A. An ACM DNS-validated request expires if it is not validated
    within 72 hours, so it is only requested in the same window in which the DNS
    validation record is actually created.
  EOT
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Hosted zone id for scopeedu.technology IF the domain is delegated to Route 53. Empty means external DNS (Namecheap): no zone is created here to avoid a second, conflicting hosted zone."
  type        = string
  default     = ""
}

variable "create_api_dns_record" {
  description = "FALSE in Block 1A. No production DNS record is created and no traffic is moved away from Render/Vercel in this slice."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Observability / retention
# ---------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the three application log groups. 30 days covers the defense window and stays inside the free ingestion tier at PFI volume."
  type        = number
  default     = 30
}

variable "ecr_kept_image_count" {
  description = "Number of tagged images kept per ECR repository before expiry."
  type        = number
  default     = 10
}

# ---------------------------------------------------------------------------
# RDS final snapshot naming (destroy safety)
#
# An RDS snapshot identifier is unique and permanent per account/region. A static
# identifier therefore works exactly once: a second destroy fails with
# "DBSnapshotAlreadyExists" in the middle of deleting the instance. These two
# variables make the identifier explicit and reviewable instead of implicit.
# ---------------------------------------------------------------------------

variable "rds_final_snapshot_identifier" {
  description = "Full override for the final snapshot identifier. Empty (default) derives it from rds_final_snapshot_suffix."
  type        = string
  default     = ""
}

variable "rds_final_snapshot_suffix" {
  description = "Suffix appended to <name_prefix>-db-final. Bump it (v1 -> v2 -> ...) before re-destroying an environment whose previous final snapshot still exists."
  type        = string
  default     = "v1"

  validation {
    # AWS identifier rules: letters, digits and hyphens; must start with a letter
    # and must not end with a hyphen or contain two consecutive hyphens.
    condition     = can(regex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$", var.rds_final_snapshot_suffix))
    error_message = "rds_final_snapshot_suffix must be lowercase alphanumeric with single internal hyphens, starting with a letter."
  }
}

# ---------------------------------------------------------------------------
# GitHub Actions -> AWS federation (OIDC)
#
# Foundations only: the provider and the deploy role exist so that Block 1B can
# push images and update services with SHORT-LIVED credentials. No workflow file
# is created here, and no long-lived AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY is
# ever issued for CI.
#
# owner/repository are NOT inferred at apply time: Terraform cannot read the git
# remote, and a renamed or transferred repository must not silently keep trust.
# The defaults below were read from `git remote -v` (origin =
# github.com/AdrielPasik/PFI---Credenciales-Verificables-y-Perfil-Formativo) and
# must be re-verified before apply.
# ---------------------------------------------------------------------------

variable "enable_github_oidc" {
  description = "Create the GitHub Actions federation foundations (OIDC trust + deploy role). No cost; no workflow is created."
  type        = bool
  default     = true
}

variable "create_github_oidc_provider" {
  description = <<-EOT
    TRUE creates the account-level IAM OIDC provider for token.actions.githubusercontent.com.
    An AWS account may hold only ONE provider per URL, so set this to false and pass
    github_oidc_provider_arn if the account already has one.
  EOT
  type        = bool
  default     = true
}

variable "github_oidc_provider_arn" {
  description = "ARN of an OIDC provider that already exists in the account. Required when create_github_oidc_provider is false."
  type        = string
  default     = ""
}

variable "github_oidc_thumbprints" {
  description = "Optional CA thumbprints. Empty (default) lets AWS resolve and maintain them: since 2023 AWS validates token.actions.githubusercontent.com against its own trust store, so pinning a thumbprint only creates a future breakage."
  type        = list(string)
  default     = []
}

variable "github_owner" {
  description = "GitHub owner/organisation that the deploy role trusts. Verified against `git remote -v` before apply."
  type        = string
  default     = "AdrielPasik"
}

variable "github_repository" {
  description = "GitHub repository name that the deploy role trusts. Verified against `git remote -v` before apply."
  type        = string
  default     = "PFI---Credenciales-Verificables-y-Perfil-Formativo"
}

variable "github_deploy_environments" {
  description = <<-EOT
    GitHub Environments allowed to assume the deploy role. The trust condition is an
    exact StringEquals match on sub = repo:<owner>/<repo>:environment:<name>, so a
    branch, a tag, a pull request or any other repository CANNOT assume the role.
    The environment must exist in GitHub and the workflow job must declare it.
  EOT
  type        = list(string)
  default     = ["production"]

  validation {
    condition     = length(var.github_deploy_environments) > 0
    error_message = "At least one GitHub environment must be trusted, otherwise the role is unusable."
  }
}

# ---------------------------------------------------------------------------
# Blockchain evidence
# ---------------------------------------------------------------------------

variable "blockchain_evidence_mode" {
  description = <<-EOT
    Blockchain evidence mechanism this infrastructure PROVISIONS FOR. It is the
    single Terraform-side source of that decision: the SSM parameter the API
    reads at runtime is seeded from this value, and the CredentialRegistry RPC
    SecureString is wired into the API task definition only when it is
    credential_registry.

    Why it is a Terraform input and not only a runtime SSM value: a task
    definition's `secrets` references and the execution role's parameter ARNs are
    decided at apply time, so they cannot follow a value that changes at runtime.
    In "mock" the API task therefore does not reference the RPC SecureString at
    all and can start without it existing. Flipping to credential_registry needs
    an apply, which is correct - real mode also needs the SecureString to exist
    and the execution role to be allowed to read it.

    Terraform never learns the RPC URL value in either mode.
  EOT
  type        = string
  default     = "mock"

  validation {
    condition     = contains(["mock", "credential_registry"], var.blockchain_evidence_mode)
    error_message = "blockchain_evidence_mode must be exactly \"mock\" or \"credential_registry\". The network is a separate input: the mode never implies a chain."
  }
}

# ---------------------------------------------------------------------------
# Password recovery (Stages 2-5)
#
# Everything here is NON-SECRET configuration. The only secret the feature needs,
# RESEND_API_KEY, is never a variable: it is an SSM SecureString created out of
# band and referenced by name only when mail_transport = "resend" (see
# local.api_mail_secret_parameters).
#
# Safe starting point = RECOVERY DISABLED: mail_transport = "disabled". In that mode
# the API starts without Resend, login and registration are untouched, and
# POST /auth/password-reset/request (asking for a NEW link) answers 503. Links that
# were already emailed keep working on /verify and /confirm until they expire (30
# minutes): only /request is gated by availability. Activating the feature is a
# separate, explicit change of mail_transport to "resend".
# ---------------------------------------------------------------------------

variable "mail_transport" {
  description = <<-EOT
    Mail transport selected for the API (MAIL_TRANSPORT).

    "disabled" (default): no mail is ever sent, RESEND_API_KEY is NOT referenced by the
    task definition and need not exist. Requests for a new recovery link answer 503.
    "resend": the real transport. Requires, BEFORE applying: the SSM SecureString
    /scope/prod/api/RESEND_API_KEY, a verified sender domain at Resend, a real
    web_public_base_url and a web_origin (see the preconditions on the API task
    definition and infra/terraform/runbooks/password-recovery.md).

    "log" is deliberately NOT accepted in this root. The backend downgrades it to
    "disabled" when NODE_ENV=production (the image sets it), but a value that
    Terraform accepts and the app silently ignores is a trap: the operator would
    believe recovery works. The log transport prints reset links and exists only for
    local development.
  EOT
  type        = string
  default     = "disabled"

  validation {
    condition     = contains(["disabled", "resend"], var.mail_transport)
    error_message = "mail_transport must be exactly \"disabled\" or \"resend\". The development transport \"log\" prints password-reset links and is not allowed in the production root."
  }
}

variable "mail_from" {
  description = <<-EOT
    Sender of the recovery email (MAIL_FROM), "Name <address@domain>" or a bare address.
    NOT a secret and changeable without touching NestJS code.

    Setting it does NOT mean the domain is verified. Resend rejects (and the API logs
    resend.rejected) any message whose sender domain is not verified in the Resend
    account. The default is the PROPOSED sender; verification is an external step.
  EOT
  type        = string
  default     = "Scope <no-responder@mail.scopeedu.technology>"

  validation {
    condition     = length(var.mail_from) <= 200
    error_message = "mail_from must be at most 200 characters."
  }

  validation {
    # Mirrors services/api/src/mail/mail.config.ts (parseMailFrom): a single address,
    # an optional display name made of letters, digits, space and . _ ' - , and no
    # line breaks (header injection). Two alternatives: "Name <addr>" or a bare addr.
    condition = (
      can(regex("^[\\p{L}\\p{N} ._'-]{1,64} <[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+>$", var.mail_from)) ||
      can(regex("^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$", var.mail_from))
    )
    error_message = "mail_from must be \"Name <user@domain>\" or \"user@domain\": one address, display name limited to letters, digits, space and . _ ' -, no line breaks."
  }
}

variable "web_public_base_url" {
  description = <<-EOT
    PUBLIC ORIGIN OF SCOPE WEB from which the password-reset link opens
    (WEB_PUBLIC_BASE_URL): https, host only, no path, no query, no fragment, no
    trailing slash. The API builds <origin>/reset-password#token=<token> from it and
    NEVER from the request (a forged Host header must not be able to point reset links
    at another domain).

    It is NOT web_origin (the CORS allow-list: which browser origin may call the API)
    and it is NOT the API URL. They often hold the same value for a single-domain
    deployment, but they mean different things and change for different reasons.

    Empty = not configured: recovery stays unavailable (503) even if mail_transport is
    "resend", and the API task definition refuses to be planned in that combination.
    No default domain is invented: the real Vercel production origin is not confirmed.
  EOT
  type        = string
  default     = ""

  validation {
    condition = var.web_public_base_url == "" || can(regex(
      "^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$",
      var.web_public_base_url
    ))
    error_message = "web_public_base_url must be a lowercase https origin with a dotted host and no path, query, fragment, credentials or trailing slash (for example https://app.example.com), or empty."
  }

  validation {
    condition = var.web_public_base_url == "" || !can(regex(
      "^https://([0-9.]+|[^/:]*\\.(localhost|local|internal|test|example|invalid))(:[0-9]+)?$",
      var.web_public_base_url
    ))
    error_message = "web_public_base_url must not be an IP address or a local/reserved host name: it is the public address recipients click."
  }
}

# --- Recovery alarms (OFF by default; every resource is gated by this flag) --

variable "enable_recovery_alarms" {
  description = <<-EOT
    FALSE by default: creates NOTHING. TRUE creates CloudWatch metric filters on the
    API log group plus one alarm per recovery signal (global cap reached, per-account
    quota reached, transport failures, jobs dropped on shutdown, and - only when
    mail_transport = "resend" - recovery not configured).

    Alarms DETECT and let a person react; they do not prevent abuse. Turn this on only
    after deciding who receives the notifications (recovery_alarm_action_arns). Cost:
    metrics and alarms are small fixed monthly charges outside the free allowance;
    check the AWS Free Plan terms before enabling.
  EOT
  type        = bool
  default     = false
}

variable "recovery_alarm_action_arns" {
  description = "SNS topic ARNs notified when a recovery alarm fires. Empty = alarms change state in the console but notify nobody. No topic is created here: the recipient is an open operational decision."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for arn in var.recovery_alarm_action_arns : can(regex("^arn:aws:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]{1,256}$", arn))])
    error_message = "recovery_alarm_action_arns must contain only SNS topic ARNs."
  }
}
