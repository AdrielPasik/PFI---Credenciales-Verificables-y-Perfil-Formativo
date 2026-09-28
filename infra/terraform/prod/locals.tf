locals {
  name_prefix = "scope-${var.environment}"

  account_id = data.aws_caller_identity.current.account_id

  # SSM naming convention for every runtime value. Terraform creates ONLY the
  # non-secret String parameters below; every SecureString is created out of band
  # so no secret value ever reaches Terraform state.
  ssm_prefix = "/scope/${var.environment}"

  ssm_parameter_arn_prefix = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter"

  # ---------------------------------------------------------------------------
  # Secrets consumed by the containers (SecureString, created out of band).
  # Map key = container environment variable name, value = SSM parameter name.
  # ---------------------------------------------------------------------------
  api_secret_parameters = {
    # scope_app (dedicated non-master role) credentials. Generated out of band and
    # independent of the RDS master secret.
    DATABASE_URL            = "${local.ssm_prefix}/api/DATABASE_URL"
    JWT_SECRET              = "${local.ssm_prefix}/api/JWT_SECRET"
    PROFILE_SHARE_TOKEN_KEY = "${local.ssm_prefix}/api/PROFILE_SHARE_TOKEN_KEY"
    AI_SERVICE_JWT_SECRET   = "${local.ssm_prefix}/shared/AI_INTERNAL_JWT_SECRET"
  }

  ai_secret_parameters = {
    AI_INTERNAL_JWT_SECRET                 = "${local.ssm_prefix}/shared/AI_INTERNAL_JWT_SECRET"
    OBJECTIVE_ANALYSIS_OPENAI_API_KEY      = "${local.ssm_prefix}/ai/OBJECTIVE_ANALYSIS_OPENAI_API_KEY"
    EVIDENCE_UNITS_OPENAI_API_KEY          = "${local.ssm_prefix}/ai/EVIDENCE_UNITS_OPENAI_API_KEY"
    CONTEXTUAL_REASONING_OPENAI_API_KEY    = "${local.ssm_prefix}/ai/CONTEXTUAL_REASONING_OPENAI_API_KEY"
    OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY = "${local.ssm_prefix}/ai/OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY"
  }

  # NOTE: there is deliberately NO /scope/prod/migrator/DATABASE_URL parameter.
  # The migrator runs as the RDS master user, and the master credential lives in
  # exactly one place: the Secrets Manager secret that RDS itself owns. Copying it
  # into SSM would create a second, silently diverging copy of the same password.
  # The migrator container reads it through the ECS `secrets` block instead (see
  # migrator_bootstrap_script below) and builds the connection string in memory.

  # Non-secret String parameters that Terraform DOES create, because they must be
  # flippable at runtime without a terraform apply: the blockchain evidence mode,
  # and the model identities that the API and the AI service must agree on (a
  # mismatch fails closed before any provider call). "unset" is not a secret and
  # is not a valid model, so nothing can call a provider by accident.
  managed_string_parameters = {
    "${local.ssm_prefix}/api/BLOCKCHAIN_EVIDENCE_MODE"            = "mock"
    "${local.ssm_prefix}/api/REASONING_EXECUTION_MODEL"           = "unset"
    "${local.ssm_prefix}/ai/OBJECTIVE_ANALYSIS_OPENAI_MODEL"      = "unset"
    "${local.ssm_prefix}/ai/EVIDENCE_UNITS_OPENAI_MODEL"          = "unset"
    "${local.ssm_prefix}/ai/CONTEXTUAL_REASONING_OPENAI_MODEL"    = "unset"
    "${local.ssm_prefix}/ai/OBJECTIVE_UNDERSTANDING_OPENAI_MODEL" = "unset"
  }

  api_string_parameters = {
    BLOCKCHAIN_EVIDENCE_MODE  = "${local.ssm_prefix}/api/BLOCKCHAIN_EVIDENCE_MODE"
    REASONING_EXECUTION_MODEL = "${local.ssm_prefix}/api/REASONING_EXECUTION_MODEL"
  }

  ai_string_parameters = {
    OBJECTIVE_ANALYSIS_OPENAI_MODEL      = "${local.ssm_prefix}/ai/OBJECTIVE_ANALYSIS_OPENAI_MODEL"
    EVIDENCE_UNITS_OPENAI_MODEL          = "${local.ssm_prefix}/ai/EVIDENCE_UNITS_OPENAI_MODEL"
    CONTEXTUAL_REASONING_OPENAI_MODEL    = "${local.ssm_prefix}/ai/CONTEXTUAL_REASONING_OPENAI_MODEL"
    OBJECTIVE_UNDERSTANDING_OPENAI_MODEL = "${local.ssm_prefix}/ai/OBJECTIVE_UNDERSTANDING_OPENAI_MODEL"
  }

  # ECS `secrets` entries: SecureString and String parameters are injected the
  # same way, by ARN.
  api_container_secrets = merge(local.api_secret_parameters, local.api_string_parameters)
  ai_container_secrets  = merge(local.ai_secret_parameters, local.ai_string_parameters)

  # ---------------------------------------------------------------------------
  # Non-secret container environment, kept in the task definition.
  # ---------------------------------------------------------------------------
  ai_internal_dns_name = "ai.${aws_service_discovery_private_dns_namespace.internal.name}"

  api_environment = {
    PORT                              = tostring(var.api_container_port)
    WEB_ORIGIN                        = var.web_origin
    JWT_EXPIRES_IN                    = var.jwt_expires_in
    PUBLIC_DID_BASE_URL               = var.public_did_base_url
    AI_SERVICE_BASE_URL               = "http://${local.ai_internal_dns_name}:${var.ai_container_port}"
    AI_SERVICE_TIMEOUT_MS             = tostring(var.ai_service_timeout_ms)
    AI_SERVICE_AUTH_MODE              = "jwt"
    AI_SERVICE_JWT_ISSUER             = var.ai_internal_jwt_issuer
    AI_SERVICE_JWT_AUDIENCE           = var.ai_internal_jwt_audience
    AI_SERVICE_JWT_EXPIRES_IN_SECONDS = tostring(var.ai_internal_jwt_expires_in_seconds)
    DOCUMENT_STORAGE_PROVIDER         = "s3"
    AWS_REGION                        = var.aws_region
    AWS_S3_BUCKET                     = var.document_evidence_bucket_name
    AWS_S3_PREFIX                     = var.document_evidence_prefix
  }

  ai_environment = {
    PORT                               = tostring(var.ai_container_port)
    AI_SERVICE_MAX_PDF_BYTES           = tostring(var.ai_service_max_pdf_bytes)
    AI_INTERNAL_AUTH_MODE              = "jwt"
    AI_INTERNAL_JWT_ISSUER             = var.ai_internal_jwt_issuer
    AI_INTERNAL_JWT_AUDIENCE           = var.ai_internal_jwt_audience
    AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS = tostring(var.ai_internal_jwt_clock_skew_seconds)
  }

  # Existing bucket, referenced by ARN only. Never created, imported or destroyed.
  document_evidence_bucket_arn  = "arn:aws:s3:::${var.document_evidence_bucket_name}"
  document_evidence_objects_arn = "arn:aws:s3:::${var.document_evidence_bucket_name}/${var.document_evidence_prefix}/*"

  # ---------------------------------------------------------------------------
  # RDS derived values. Splat form everywhere, so every expression stays valid
  # when create_rds = false and the resource has count = 0.
  # ---------------------------------------------------------------------------
  rds_addresses = aws_db_instance.main[*].address
  rds_address   = length(local.rds_addresses) > 0 ? local.rds_addresses[0] : ""

  rds_master_secret_arns = flatten([
    for instance in aws_db_instance.main : instance.master_user_secret[*].secret_arn
  ])
  rds_master_secret_arn = length(local.rds_master_secret_arns) > 0 ? local.rds_master_secret_arns[0] : ""

  rds_final_snapshot_identifier = (
    var.rds_final_snapshot_identifier != ""
    ? var.rds_final_snapshot_identifier
    : "${local.name_prefix}-db-final-${var.rds_final_snapshot_suffix}"
  )

  # ---------------------------------------------------------------------------
  # migrator bootstrap
  #
  # The master password arrives as RDS_MASTER_PASSWORD, injected by ECS directly
  # from the RDS-owned Secrets Manager secret (JSON key `password`). The script
  # percent-encodes it with Node - already present in the API image, which the
  # migrator reuses - because an RDS-generated password may contain characters that
  # are legal in a password and illegal in a URL userinfo field.
  #
  # DATABASE_URL exists only as a process environment variable inside that one-off
  # task: never in SSM, never in the task definition, never in Terraform state.
  # sslmode=require is explicit; RDS accepts TLS and Prisma would otherwise
  # negotiate on preference alone.
  # ---------------------------------------------------------------------------
  migrator_bootstrap_script = <<-EOT
    set -eu
    if [ -z "$${RDS_MASTER_PASSWORD:-}" ]; then
      echo "RDS_MASTER_PASSWORD is empty: the ECS secrets block did not resolve." >&2
      exit 1
    fi
    if [ -z "${local.rds_address}" ]; then
      echo "No RDS endpoint is known to this task definition: apply with create_rds = true first." >&2
      exit 1
    fi
    DB_PASSWORD_ENCODED=$(node -e 'process.stdout.write(encodeURIComponent(process.env.RDS_MASTER_PASSWORD))')
    export DATABASE_URL="postgresql://${var.rds_master_username}:$${DB_PASSWORD_ENCODED}@${local.rds_address}:5432/${var.rds_database_name}?schema=public&sslmode=require&connect_timeout=15"
    unset RDS_MASTER_PASSWORD DB_PASSWORD_ENCODED
    exec ${join(" ", var.migrator_command)}
  EOT

  # ---------------------------------------------------------------------------
  # GitHub Actions federation
  #
  # The trusted subject is an EXACT string: only a job that declares the named
  # GitHub Environment inside this exact repository can assume the deploy role.
  # No StringLike, no `repo:owner/*`, no branch or tag wildcard.
  # ---------------------------------------------------------------------------
  github_oidc_provider_arn_effective = (
    var.create_github_oidc_provider
    ? one(aws_iam_openid_connect_provider.github[*].arn)
    : var.github_oidc_provider_arn
  )

  github_trusted_subjects = [
    for deploy_environment in var.github_deploy_environments :
    "repo:${var.github_owner}/${var.github_repository}:environment:${deploy_environment}"
  ]

  # ---------------------------------------------------------------------------
  # ECS execution roles — one per workload, least privilege
  #
  # This map IS the permission matrix for the ECS agent. Each workload may pull
  # only the image it runs, write only its own log streams, and read only the
  # parameters or secrets its own task definition declares. There is no shared
  # execution role and no /scope/prod/* wildcard: a compromise of the AI agent
  # path cannot fetch the API session key, and nothing but the migrator can reach
  # the RDS master secret.
  # ---------------------------------------------------------------------------
  execution_roles = {
    api = {
      repository_arn = aws_ecr_repository.api.arn
      log_group_arn  = aws_cloudwatch_log_group.api.arn
      parameter_arns = [
        for parameter in distinct(values(local.api_container_secrets)) :
        "${local.ssm_parameter_arn_prefix}${parameter}"
      ]
      secret_arns = []
    }

    ai = {
      repository_arn = aws_ecr_repository.ai.arn
      log_group_arn  = aws_cloudwatch_log_group.ai.arn
      parameter_arns = [
        for parameter in distinct(values(local.ai_container_secrets)) :
        "${local.ssm_parameter_arn_prefix}${parameter}"
      ]
      secret_arns = []
    }

    # The migrator reuses the API image and reads NO SSM parameter at all: its
    # only credential is the RDS master secret, straight from Secrets Manager.
    migrator = {
      repository_arn = aws_ecr_repository.api.arn
      log_group_arn  = aws_cloudwatch_log_group.migrator.arn
      parameter_arns = []
      secret_arns    = local.rds_master_secret_arn != "" ? [local.rds_master_secret_arn] : []
    }
  }
}
