locals {
  name_prefix = "scope-${var.environment}"

  account_id = data.aws_caller_identity.current.account_id

  # SSM naming convention for every runtime value. Terraform creates ONLY the
  # non-secret String parameters below; every SecureString is created out of band
  # so no secret value ever reaches Terraform state.
  ssm_prefix = "/scope/${var.environment}"

  ssm_parameter_arn_prefix = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter"

  # Is this infrastructure provisioning for the REAL CredentialRegistry path?
  # Derived from the single Terraform-side mode input - there is no second
  # source of that decision anywhere in this configuration.
  blockchain_registry_mode_enabled = var.blockchain_evidence_mode == "credential_registry"

  # ---------------------------------------------------------------------------
  # Secrets consumed by the containers (SecureString, created out of band).
  # Map key = container environment variable name, value = SSM parameter name.
  # ---------------------------------------------------------------------------
  # Always injected, in every mode. Nothing here is conditional.
  api_base_secret_parameters = {
    # scope_app (dedicated non-master role) credentials. Generated out of band and
    # independent of the RDS master secret.
    DATABASE_URL            = "${local.ssm_prefix}/api/DATABASE_URL"
    JWT_SECRET              = "${local.ssm_prefix}/api/JWT_SECRET"
    PROFILE_SHARE_TOKEN_KEY = "${local.ssm_prefix}/api/PROFILE_SHARE_TOKEN_KEY"
    AI_SERVICE_JWT_SECRET   = "${local.ssm_prefix}/shared/AI_INTERNAL_JWT_SECRET"
  }

  # S8c5.1: CONDITIONAL, and only this one.
  #
  # Sensitive even though it is a URL: provider RPC endpoints usually carry the
  # credential in the path or the query (/v2/<API_KEY>, ?apiKey=...), so it is a
  # SecureString created OUT OF BAND and Terraform only ever knows its NAME.
  #
  # It is referenced by the task definition ONLY in credential_registry mode.
  # In mock the API needs no RPC at all - it builds no provider and runs no
  # preflight - so listing the parameter would make the ECS agent try to resolve
  # a SecureString that legitimately does not exist, and the container would fail
  # to start. Mock deployability must not depend on real-mode infrastructure.
  api_rpc_secret_parameters = (
    local.blockchain_registry_mode_enabled
    ? { CREDENTIAL_REGISTRY_RPC_URL = "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_RPC_URL" }
    : {}
  )

  api_secret_parameters = merge(
    local.api_base_secret_parameters,
    local.api_rpc_secret_parameters
  )

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
  # The migrator container reads the master credential through the ECS `secrets`
  # block; the image's dedicated migrator entrypoint builds the admin connection in memory.

  # Non-secret String parameters that Terraform DOES create, because they must be
  # flippable at runtime without a terraform apply: the blockchain evidence mode,
  # and the model identities that the API and the AI service must agree on (a
  # mismatch fails closed before any provider call). "unset" is not a secret and
  # is not a valid model, so nothing can call a provider by accident.
  #
  # S8c5: el target de blockchain se declara en CUATRO parametros no secretos
  # ademas del modo, porque el modo dejo de llevar la red adentro. Arrancan en
  # "unset", que NO es una red valida, NO es un chainId decimal, NO es una
  # direccion y NO es un deploymentId admisible: si alguien pasara el modo a
  # credential_registry sin poblarlos, la emision falla cerrada en vez de
  # escribir contra una cadena equivocada.
  #
  # Ninguno es un valor de produccion inventado: la direccion y el deploymentId
  # reales no existen todavia y los produce S8c10 al desplegar el contrato.
  managed_string_parameters = {
    "${local.ssm_prefix}/api/BLOCKCHAIN_EVIDENCE_MODE"             = var.blockchain_evidence_mode
    "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_NETWORK"          = "unset"
    "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_CHAIN_ID"         = "unset"
    "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_CONTRACT_ADDRESS" = "unset"
    "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_DEPLOYMENT_ID"    = "unset"
    "${local.ssm_prefix}/api/REASONING_EXECUTION_MODEL"            = "unset"
    "${local.ssm_prefix}/ai/OBJECTIVE_ANALYSIS_OPENAI_MODEL"       = "unset"
    "${local.ssm_prefix}/ai/EVIDENCE_UNITS_OPENAI_MODEL"           = "unset"
    "${local.ssm_prefix}/ai/CONTEXTUAL_REASONING_OPENAI_MODEL"     = "unset"
    "${local.ssm_prefix}/ai/OBJECTIVE_UNDERSTANDING_OPENAI_MODEL"  = "unset"
  }

  api_string_parameters = {
    BLOCKCHAIN_EVIDENCE_MODE = "${local.ssm_prefix}/api/BLOCKCHAIN_EVIDENCE_MODE"

    # Identidad de la CADENA (red + chainId) y del DEPLOYMENT concreto
    # (direccion + deploymentId). Son dos cosas distintas: varias versiones de
    # CredentialRegistry pueden convivir en la misma red.
    CREDENTIAL_REGISTRY_NETWORK          = "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_NETWORK"
    CREDENTIAL_REGISTRY_CHAIN_ID         = "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_CHAIN_ID"
    CREDENTIAL_REGISTRY_CONTRACT_ADDRESS = "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_CONTRACT_ADDRESS"
    CREDENTIAL_REGISTRY_DEPLOYMENT_ID    = "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_DEPLOYMENT_ID"

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

    # The migrator reuses the API image. It reads the RDS master secret directly
    # from Secrets Manager for the administrative connection, plus exactly the
    # runtime DATABASE_URL SecureString so the scope_app password can be reused
    # during the one-time role bootstrap without creating a second secret.
    migrator = {
      repository_arn = aws_ecr_repository.api.arn
      log_group_arn  = aws_cloudwatch_log_group.migrator.arn
      parameter_arns = [
        "${local.ssm_parameter_arn_prefix}${local.api_secret_parameters.DATABASE_URL}"
      ]
      secret_arns = local.rds_master_secret_arn != "" ? [local.rds_master_secret_arn] : []
    }
  }
}
