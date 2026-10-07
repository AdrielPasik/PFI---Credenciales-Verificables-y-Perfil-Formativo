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
  description = "Fargate CPU units for the AI task (512 = 0.5 vCPU)."
  type        = number
  default     = 512
}

variable "ai_task_memory" {
  description = "Fargate memory (MiB) for the AI task."
  type        = number
  default     = 1024
}

variable "task_cpu_architecture" {
  description = "X86_64 unless the repository requires otherwise. GitHub-hosted x86 runners build these images natively and the Python wheels + Prisma engines used here have x86_64 builds."
  type        = string
  default     = "X86_64"
}

variable "api_desired_count" {
  description = "Desired API tasks once services are enabled. 1 = always-on, no scale-to-zero, no autoscaling."
  type        = number
  default     = 1
}

variable "ai_desired_count" {
  description = "Desired AI tasks once services are enabled."
  type        = number
  default     = 1
}

variable "enable_services" {
  description = <<-EOT
    Gate for the two ECS services. FALSE in Block 1A: task definitions, roles,
    log groups, target group and Cloud Map entries are created, but nothing runs,
    so no Fargate or task public IPv4 cost is incurred and no image is required
    yet. Block 1B flips this to true after the images exist in ECR and after every
    SSM parameter listed in README.md has been created out of band.
  EOT
  type        = bool
  default     = false
}

variable "api_image_tag" {
  description = "Image tag for the API task definition. Block 1B replaces this with the immutable git SHA."
  type        = string
  default     = "bootstrap"
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
