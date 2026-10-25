# ---------------------------------------------------------------------------
# Structural tests for the password-recovery infrastructure (Stage 5)
#
# HOW THEY RUN. `mock_provider "aws"` replaces the real AWS provider with an
# in-memory fake: nothing here talks to AWS, reads Terraform state or needs
# credentials. They evaluate this configuration's own logic - which secrets the task
# definition references, which values validate, what the capacity gates do - against
# invented resource ids. They are NOT evidence that anything works in AWS: ECS
# actually resolving a parameter, the ALB actually appending X-Forwarded-For or a
# policy actually being accepted by IAM can only be observed after an apply.
#
#   cd infra/terraform/prod
#   terraform init -backend=false      # providers only; no state, no AWS
#   terraform test
#
# IAM policy JSON is rendered by aws_iam_policy_document, which a mock provider does
# not evaluate. The IAM assertions therefore check the INPUT of those documents
# (local.execution_roles), and tests/static-checks.sh pins that iam.tf itself is
# byte-for-byte unchanged by this stage.
# ---------------------------------------------------------------------------

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }

  # A mock provider does not render policy documents; resources that consume them
  # still require syntactically valid JSON.
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_ecr_repository" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_sfn_state_machine" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_service_discovery_service" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_iam_openid_connect_provider" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }

  mock_resource "aws_service_discovery_private_dns_namespace" {
    defaults = {
      arn = "arn:aws:mock:us-east-1:123456789012:resource/mock"
    }
  }
}

# NOTE: https://scope-web.vercel.app below is a FIXTURE that exercises the validations.
# It is NOT a confirmed origin of Scope Web - the real one is still to be supplied.

# Inputs for everything these tests do not vary. NONE of these is a claim about the real
# environment (the real values live in the operator's tfvars): they only satisfy the
# production root's REQUIRED variables, which exist on purpose without a default.
#   * https listener on (the load-balanced ECS service requires it);
#   * capacity gates at zero here ONLY so a test can prove they win over *_desired_count;
#   * migrator_image_tag / provisioner_image_digest are required (no default, no fallback)
#     in the current production root: fixtures below, never real tags or digests.
variables {
  enable_https_listener    = true
  request_acm_certificate  = true
  enable_services          = false
  api_desired_count        = 0
  ai_desired_count         = 0
  api_image_tag            = "fixture-api-tag"
  migrator_image_tag       = "fixture-migrator-tag"
  provisioner_image_digest = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  # The isolated ECS sync probe is enabled by the versioned ecs_sync_probe.auto.tfvars in
  # production; terraform test does not read that file, so the same values are repeated.
  enable_ecs_sync_probe       = true
  ecs_sync_probe_image_digest = "sha256:aabb9b3380d56ec8053082e8c41a6bd72a595c4559bb5032f7c7da3ee0c7c02b"
}

# ---------------------------------------------------------------------------
# 1. DEFAULT = RECOVERY DISABLED
# ---------------------------------------------------------------------------

run "default_is_recovery_disabled" {
  command = apply

  assert {
    condition     = var.mail_transport == "disabled"
    error_message = "mail_transport must default to disabled."
  }

  assert {
    condition     = local.api_environment.MAIL_TRANSPORT == "disabled"
    error_message = "The API task must receive MAIL_TRANSPORT=disabled by default."
  }

  assert {
    condition     = !contains(keys(local.api_container_secrets), "RESEND_API_KEY")
    error_message = "In disabled mode the API task definition must not reference RESEND_API_KEY at all (the parameter does not exist yet)."
  }

  assert {
    condition = !contains(
      [for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name],
      "RESEND_API_KEY"
    )
    error_message = "The rendered API container definition must not contain a RESEND_API_KEY secret in disabled mode."
  }

  assert {
    condition     = !anytrue([for arn in local.execution_roles["api"].parameter_arns : endswith(arn, "/RESEND_API_KEY")])
    error_message = "The API execution role must not be granted the Resend parameter in disabled mode."
  }

  assert {
    condition     = !contains(output.ssm_parameters_required_out_of_band, "/scope/prod/api/RESEND_API_KEY")
    error_message = "Disabled mode must not list RESEND_API_KEY as a parameter required before enabling services."
  }

  assert {
    condition     = output.password_recovery_configuration.resend_secret_name == null
    error_message = "No Resend secret name may be advertised in disabled mode."
  }

  assert {
    condition     = local.api_environment.WEB_PUBLIC_BASE_URL == ""
    error_message = "No web origin may be invented: WEB_PUBLIC_BASE_URL is empty until the real origin is supplied."
  }
}

# ---------------------------------------------------------------------------
# 2. RESEND MODE INJECTS THE SECRET, BY NAME, WITH THE RIGHT PATH
# ---------------------------------------------------------------------------

run "resend_mode_references_the_secret" {
  command = apply

  variables {
    mail_transport      = "resend"
    web_public_base_url = "https://scope-web.vercel.app"
    web_origin          = "https://scope-web.vercel.app"
  }

  assert {
    condition = contains(
      [for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name],
      "RESEND_API_KEY"
    )
    error_message = "Resend mode must inject RESEND_API_KEY into the API container."
  }

  assert {
    condition = one([
      for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.valueFrom
      if s.name == "RESEND_API_KEY"
    ]) == "arn:aws:ssm:us-east-1:123456789012:parameter/scope/prod/api/RESEND_API_KEY"
    error_message = "RESEND_API_KEY must point at /scope/prod/api/RESEND_API_KEY (same /scope/prod/api/ convention as every other API secret)."
  }

  assert {
    condition     = contains(local.execution_roles["api"].parameter_arns, "arn:aws:ssm:us-east-1:123456789012:parameter/scope/prod/api/RESEND_API_KEY")
    error_message = "The API EXECUTION role must be granted GetParameters on the exact Resend parameter ARN."
  }

  assert {
    condition     = !anytrue([for arn in local.execution_roles["ai"].parameter_arns : endswith(arn, "/RESEND_API_KEY")])
    error_message = "The AI execution role must never see the Resend key."
  }

  assert {
    condition     = !anytrue([for arn in local.execution_roles["migrator"].parameter_arns : endswith(arn, "/RESEND_API_KEY")])
    error_message = "The migrator execution role must never see the Resend key."
  }

  assert {
    condition     = alltrue([for arn in local.execution_roles["api"].parameter_arns : !endswith(arn, "*")])
    error_message = "Parameter ARNs must stay exact: no wildcard may be introduced."
  }

  assert {
    condition     = contains(output.ssm_parameters_required_out_of_band, "/scope/prod/api/RESEND_API_KEY")
    error_message = "Resend mode must list the parameter as required out of band before services are enabled."
  }

  assert {
    condition     = output.password_recovery_configuration.resend_secret_name == "/scope/prod/api/RESEND_API_KEY"
    error_message = "The output must expose the NAME of the secret."
  }

  assert {
    condition     = local.api_environment.MAIL_TRANSPORT == "resend" && local.api_environment.WEB_PUBLIC_BASE_URL == "https://scope-web.vercel.app"
    error_message = "Resend mode must pass MAIL_TRANSPORT and WEB_PUBLIC_BASE_URL through unchanged."
  }

  # WEB_ORIGIN (CORS) and WEB_PUBLIC_BASE_URL (email link) stay two separate inputs.
  assert {
    condition     = local.api_environment.WEB_ORIGIN == var.web_origin && local.api_environment.WEB_PUBLIC_BASE_URL == var.web_public_base_url
    error_message = "WEB_ORIGIN and WEB_PUBLIC_BASE_URL must each come from their own variable."
  }
}

# The baseline secrets keep working in both modes.
run "previous_secrets_are_preserved_in_both_modes" {
  command = apply

  variables {
    mail_transport      = "resend"
    web_public_base_url = "https://scope-web.vercel.app"
    web_origin          = "https://scope-web.vercel.app"
  }

  assert {
    condition = toset([
      for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name
      ]) == toset([
      "DATABASE_URL", "JWT_SECRET", "PROFILE_SHARE_TOKEN_KEY", "AI_SERVICE_JWT_SECRET",
      "RESEND_API_KEY",
      "BLOCKCHAIN_EVIDENCE_MODE", "CREDENTIAL_REGISTRY_NETWORK", "CREDENTIAL_REGISTRY_CHAIN_ID",
      "CREDENTIAL_REGISTRY_CONTRACT_ADDRESS", "CREDENTIAL_REGISTRY_DEPLOYMENT_ID", "REASONING_EXECUTION_MODEL",
    ])
    error_message = "Resend mode must ADD RESEND_API_KEY to the previous secret set and change nothing else."
  }
}

run "disabled_mode_secret_set_is_exactly_the_previous_one" {
  command = apply

  assert {
    condition = toset([
      for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name
      ]) == toset([
      "DATABASE_URL", "JWT_SECRET", "PROFILE_SHARE_TOKEN_KEY", "AI_SERVICE_JWT_SECRET",
      "BLOCKCHAIN_EVIDENCE_MODE", "CREDENTIAL_REGISTRY_NETWORK", "CREDENTIAL_REGISTRY_CHAIN_ID",
      "CREDENTIAL_REGISTRY_CONTRACT_ADDRESS", "CREDENTIAL_REGISTRY_DEPLOYMENT_ID", "REASONING_EXECUTION_MODEL",
    ])
    error_message = "Disabled mode must leave the API secret set exactly as it was before password recovery."
  }
}

# ---------------------------------------------------------------------------
# 3. NO SECRET VALUE EVER IN TERRAFORM
# ---------------------------------------------------------------------------

run "terraform_creates_no_securestring_and_no_resend_parameter" {
  command = apply

  variables {
    mail_transport      = "resend"
    web_public_base_url = "https://scope-web.vercel.app"
    web_origin          = "https://scope-web.vercel.app"
  }

  assert {
    condition     = alltrue([for p in aws_ssm_parameter.managed_strings : p.type == "String"])
    error_message = "Terraform may only create plain String parameters; every SecureString is created out of band."
  }

  assert {
    condition     = !anytrue([for name in keys(aws_ssm_parameter.managed_strings) : endswith(name, "RESEND_API_KEY")])
    error_message = "Terraform must not create (or hold a value for) the Resend key."
  }

  assert {
    condition     = !can(regex("(^|[^A-Za-z0-9_])re_[A-Za-z0-9_]{16,}", jsonencode(output.password_recovery_configuration)))
    error_message = "No API-key-shaped value may appear in the recovery output."
  }

  assert {
    condition     = !can(regex("(?i)api[_-]?key\"?\\s*[:=]\\s*\"[A-Za-z0-9_]{12,}", jsonencode(aws_ecs_task_definition.api.container_definitions)))
    error_message = "The task definition environment must not embed a key value."
  }
}

# ---------------------------------------------------------------------------
# 4. VALIDATIONS
# ---------------------------------------------------------------------------

run "log_transport_is_rejected_in_production" {
  command = plan

  variables {
    mail_transport = "log"
  }

  expect_failures = [var.mail_transport]
}

run "unknown_transport_is_rejected" {
  command = plan

  variables {
    mail_transport = "smtp"
  }

  expect_failures = [var.mail_transport]
}

run "empty_transport_is_rejected" {
  command = plan

  variables {
    mail_transport = ""
  }

  expect_failures = [var.mail_transport]
}

run "transport_value_is_case_sensitive" {
  command = plan

  variables {
    mail_transport = "Resend"
  }

  expect_failures = [var.mail_transport]
}

run "resend_without_web_public_base_url_does_not_plan" {
  command = plan

  variables {
    mail_transport = "resend"
    web_origin     = "https://scope-web.vercel.app"
  }

  expect_failures = [aws_ecs_task_definition.api]
}

run "resend_without_cors_origin_does_not_plan" {
  command = plan

  variables {
    mail_transport      = "resend"
    web_public_base_url = "https://scope-web.vercel.app"
  }

  expect_failures = [aws_ecs_task_definition.api]
}

run "web_public_base_url_rejects_http" {
  command = plan

  variables {
    web_public_base_url = "http://scope-web.vercel.app"
  }

  expect_failures = [var.web_public_base_url]
}

run "web_public_base_url_rejects_a_path" {
  command = plan

  variables {
    web_public_base_url = "https://scope-web.vercel.app/app"
  }

  expect_failures = [var.web_public_base_url]
}

run "web_public_base_url_rejects_a_trailing_slash" {
  command = plan

  variables {
    web_public_base_url = "https://scope-web.vercel.app/"
  }

  expect_failures = [var.web_public_base_url]
}

run "web_public_base_url_rejects_query_and_fragment" {
  command = plan

  variables {
    web_public_base_url = "https://scope-web.vercel.app#token"
  }

  expect_failures = [var.web_public_base_url]
}

run "web_public_base_url_rejects_localhost" {
  command = plan

  variables {
    web_public_base_url = "https://localhost:3000"
  }

  expect_failures = [var.web_public_base_url]
}

run "web_public_base_url_rejects_an_ip_literal" {
  command = plan

  variables {
    web_public_base_url = "https://10.20.0.5"
  }

  expect_failures = [var.web_public_base_url]
}

run "web_public_base_url_rejects_credentials" {
  command = plan

  variables {
    web_public_base_url = "https://user:pass@scope-web.vercel.app"
  }

  expect_failures = [var.web_public_base_url]
}

run "web_public_base_url_rejects_uppercase_host" {
  command = plan

  variables {
    web_public_base_url = "https://Scope-Web.vercel.app"
  }

  expect_failures = [var.web_public_base_url]
}

run "mail_from_default_is_the_proposed_sender_and_is_configurable" {
  command = plan

  assert {
    condition     = var.mail_from == "Scope <no-responder@mail.scopeedu.technology>"
    error_message = "The proposed sender is the default."
  }
}

run "mail_from_accepts_a_bare_address_override" {
  command = plan

  variables {
    mail_from = "no-responder@mail.scopeedu.technology"
  }

  assert {
    condition     = local.api_environment.MAIL_FROM == "no-responder@mail.scopeedu.technology"
    error_message = "MAIL_FROM must follow the variable, with no code change."
  }
}

run "mail_from_rejects_header_injection" {
  command = plan

  variables {
    mail_from = "Scope <a@mail.scopeedu.technology>\nBcc: attacker@example.com"
  }

  expect_failures = [var.mail_from]
}

run "mail_from_rejects_a_missing_domain" {
  command = plan

  variables {
    mail_from = "Scope <no-responder>"
  }

  expect_failures = [var.mail_from]
}

run "mail_from_rejects_multiple_addresses" {
  command = plan

  variables {
    mail_from = "Scope <a@mail.scopeedu.technology>, b@mail.scopeedu.technology"
  }

  expect_failures = [var.mail_from]
}

# ---------------------------------------------------------------------------
# 5. TRUST PROXY / ALB
# ---------------------------------------------------------------------------

run "api_trusts_exactly_one_proxy_and_the_alb_appends" {
  command = apply

  assert {
    condition = one([
      for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.value
      if e.name == "TRUST_PROXY_HOPS"
    ]) == "1"
    error_message = "The API task must run with TRUST_PROXY_HOPS=1 (one hop: the ALB). 0 would make every client share the ALB address."
  }

  assert {
    condition     = aws_lb.api.xff_header_processing_mode == "append"
    error_message = "The ALB must append to X-Forwarded-For: 'preserve' would let a client choose the identity the throttler uses."
  }

  assert {
    condition     = length([for e in jsondecode(aws_ecs_task_definition.ai.container_definitions)[0].environment : e if e.name == "TRUST_PROXY_HOPS"]) == 0
    error_message = "The AI service is not behind the ALB and must not receive TRUST_PROXY_HOPS."
  }

  assert {
    condition     = length([for e in jsondecode(aws_ecs_task_definition.migrator.container_definitions)[0].environment : e if e.name == "TRUST_PROXY_HOPS"]) == 0
    error_message = "The migrator must not receive TRUST_PROXY_HOPS."
  }
}

# ---------------------------------------------------------------------------
# 6. ZERO CAPACITY PRESERVED
# ---------------------------------------------------------------------------

run "capacity_stays_at_zero_whatever_recovery_is_set_to" {
  command = apply

  variables {
    mail_transport      = "resend"
    web_public_base_url = "https://scope-web.vercel.app"
    web_origin          = "https://scope-web.vercel.app"
    # The real production default of these two is 1; the gate must still win.
    api_desired_count = 1
    ai_desired_count  = 1
  }

  assert {
    condition     = aws_ecs_service.api[0].desired_count == 0 && aws_ecs_service.ai[0].desired_count == 0
    error_message = "enable_services = false must keep both services at zero tasks even in resend mode."
  }

  assert {
    condition     = var.enable_services == false && var.create_api_dns_record == false
    error_message = "Recovery must not flip the capacity or DNS gates."
  }
}

# ---------------------------------------------------------------------------
# 7. MIGRATOR TAG: REQUIRED, INDEPENDENT, NO FALLBACK (design of origin/main)
#
# Whether the variable has a default is checked structurally in tests/static-checks.sh
# (a tftest cannot "unset" a variable that a file-level block provides).
# ---------------------------------------------------------------------------

run "migrator_image_is_selected_only_by_migrator_image_tag" {
  command = apply

  variables {
    api_image_tag      = "api-tag-aaaa"
    migrator_image_tag = "migrator-tag-bbbb"
  }

  assert {
    condition     = endswith(jsondecode(aws_ecs_task_definition.migrator.container_definitions)[0].image, ":migrator-tag-bbbb")
    error_message = "The migrator image must come from migrator_image_tag."
  }

  assert {
    condition     = endswith(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].image, ":api-tag-aaaa")
    error_message = "The API image must come from api_image_tag only."
  }
}

run "moving_the_api_tag_never_moves_the_migrator" {
  command = apply

  variables {
    api_image_tag      = "api-tag-NEW"
    migrator_image_tag = "migrator-tag-pinned"
  }

  assert {
    condition     = endswith(jsondecode(aws_ecs_task_definition.migrator.container_definitions)[0].image, ":migrator-tag-pinned")
    error_message = "Changing api_image_tag must not change the migrator image: there is no fallback between them."
  }
}

run "empty_migrator_image_tag_is_rejected_not_defaulted" {
  command = plan

  variables {
    migrator_image_tag = "   "
  }

  expect_failures = [var.migrator_image_tag]
}

# ---------------------------------------------------------------------------
# 7b. WHAT origin/main ALREADY DEPLOYED MUST SURVIVE THE RECOVERY CHANGES
# ---------------------------------------------------------------------------

run "api_deployment_stays_zero_hundred_single_writer" {
  command = apply

  assert {
    condition     = aws_ecs_service.api[0].deployment_minimum_healthy_percent == 0 && aws_ecs_service.api[0].deployment_maximum_percent == 100
    error_message = "The API rolls out 0/100 (single blockchain nonce writer): recovery must not change it."
  }

  assert {
    condition     = aws_ecs_service.ai[0].deployment_minimum_healthy_percent == 100 && aws_ecs_service.ai[0].deployment_maximum_percent == 200
    error_message = "The AI service keeps its 100/200 rollout."
  }

  assert {
    condition     = aws_ecs_service.api[0].deployment_circuit_breaker[0].enable && aws_ecs_service.api[0].deployment_circuit_breaker[0].rollback
    error_message = "The API deployment circuit breaker must stay on."
  }
}

run "provisioner_is_preserved_and_referenced_by_digest" {
  command = apply

  assert {
    condition     = endswith(jsondecode(aws_ecs_task_definition.provisioner.container_definitions)[0].image, "@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")
    error_message = "The provisioner task definition must keep referencing its image by digest."
  }

  assert {
    condition     = !contains([for s in jsondecode(aws_ecs_task_definition.provisioner.container_definitions)[0].secrets : s.name], "RESEND_API_KEY")
    error_message = "The provisioner must never receive recovery secrets."
  }
}

run "provisioner_digest_is_validated" {
  command = plan

  variables {
    provisioner_image_digest = "latest"
  }

  expect_failures = [var.provisioner_image_digest]
}

run "ecs_sync_probe_is_preserved" {
  command = apply

  assert {
    condition     = length(aws_sfn_state_machine.ecs_sync_probe) == 1 && length(aws_ecs_task_definition.ecs_sync_probe) == 1
    error_message = "The isolated ECS sync probe resources must still exist when the probe is enabled."
  }
}

run "api_signer_namespace_and_registry_secrets_survive_recovery_in_registry_mode" {
  command = apply

  variables {
    blockchain_evidence_mode = "credential_registry"
    mail_transport           = "resend"
    web_public_base_url      = "https://scope-web.vercel.app"
    web_origin               = "https://scope-web.vercel.app"
  }

  assert {
    condition = toset([
      for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name
      ]) == toset([
      "DATABASE_URL", "JWT_SECRET", "PROFILE_SHARE_TOKEN_KEY", "AI_SERVICE_JWT_SECRET",
      "CREDENTIAL_REGISTRY_RPC_URL", "RESEND_API_KEY",
      "BLOCKCHAIN_EVIDENCE_MODE", "CREDENTIAL_REGISTRY_NETWORK", "CREDENTIAL_REGISTRY_CHAIN_ID",
      "CREDENTIAL_REGISTRY_CONTRACT_ADDRESS", "CREDENTIAL_REGISTRY_DEPLOYMENT_ID", "REASONING_EXECUTION_MODEL",
    ])
    error_message = "In real blockchain mode the secret set must be the production one PLUS RESEND_API_KEY and nothing else."
  }

  assert {
    condition = one([
      for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.value
      if e.name == "SIGNER_SECRET_REF_PREFIX"
    ]) == "/scope/prod/signers/"
    error_message = "The signer namespace guard from origin/main must be preserved."
  }
}

run "recovery_adds_only_the_expected_environment_to_the_api" {
  command = apply

  assert {
    condition = toset([
      for e in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment : e.name
      if contains(["WEB_PUBLIC_BASE_URL", "MAIL_TRANSPORT", "MAIL_FROM", "TRUST_PROXY_HOPS"], e.name)
    ]) == toset(["WEB_PUBLIC_BASE_URL", "MAIL_TRANSPORT", "MAIL_FROM", "TRUST_PROXY_HOPS"])
    error_message = "The API task must receive exactly the four recovery variables."
  }

  assert {
    condition     = length([for e in jsondecode(aws_ecs_task_definition.ai.container_definitions)[0].environment : e if contains(["WEB_PUBLIC_BASE_URL", "MAIL_TRANSPORT", "MAIL_FROM", "TRUST_PROXY_HOPS"], e.name)]) == 0
    error_message = "Recovery configuration must not leak into the AI task definition."
  }
}

run "dns_and_rds_are_not_touched_by_recovery_inputs" {
  command = apply

  variables {
    mail_transport      = "resend"
    web_public_base_url = "https://scope-web.vercel.app"
    web_origin          = "https://scope-web.vercel.app"
  }

  assert {
    condition     = length(aws_route53_record.api) == 0
    error_message = "No DNS record may be created by default or by recovery settings."
  }

  assert {
    condition     = aws_db_instance.main[0].deletion_protection == true
    error_message = "RDS deletion protection must stay on."
  }
}

# ---------------------------------------------------------------------------
# 8. ALARMS: OFF BY DEFAULT, NO NEW RESOURCES
# ---------------------------------------------------------------------------

run "alarms_create_nothing_by_default" {
  command = apply

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.recovery) == 0 && length(aws_cloudwatch_metric_alarm.recovery) == 0
    error_message = "Alarms must create nothing unless enable_recovery_alarms is set."
  }
}

run "alarms_when_enabled_in_disabled_mode_skip_the_not_configured_signal" {
  command = apply

  variables {
    enable_recovery_alarms = true
  }

  assert {
    condition     = toset(keys(aws_cloudwatch_metric_alarm.recovery)) == toset(["global_cap", "account_quota", "transport_failure", "dropped_jobs", "internal_failure"])
    error_message = "In disabled mode 'recovery not configured' is the intended state and must not alarm."
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.recovery["global_cap"].pattern == "\"request.dropped (global_cap)\"" && aws_cloudwatch_log_metric_filter.recovery["account_quota"].pattern == "\"request.dropped (account_quota)\""
    error_message = "Metric filter patterns must match the exact strings the API logs."
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.recovery["internal_failure"].pattern == "?\"request.failed\" ?\"confirm.failed\" ?\"token.invalidate_failed\""
    error_message = "The internal-failure filter must match the API's request.failed / confirm.failed / token.invalidate_failed lines."
  }

  assert {
    condition     = alltrue([for f in aws_cloudwatch_log_metric_filter.recovery : f.log_group_name == "/scope/prod/api"])
    error_message = "Filters must read the API log group only."
  }

  assert {
    condition     = alltrue([for a in aws_cloudwatch_metric_alarm.recovery : length(a.alarm_actions) == 0 && a.treat_missing_data == "notBreaching"])
    error_message = "No notification target may be invented, and silence must not count as a breach."
  }
}

run "alarms_in_resend_mode_add_the_not_configured_signal" {
  command = apply

  variables {
    enable_recovery_alarms = true
    mail_transport         = "resend"
    web_public_base_url    = "https://scope-web.vercel.app"
    web_origin             = "https://scope-web.vercel.app"
  }

  assert {
    condition     = contains(keys(aws_cloudwatch_metric_alarm.recovery), "not_configured")
    error_message = "Resend mode must alarm when recovery is unavailable."
  }
}

run "alarm_actions_must_be_sns_topics" {
  command = plan

  variables {
    recovery_alarm_action_arns = ["arn:aws:iam::123456789012:role/not-a-topic"]
  }

  expect_failures = [var.recovery_alarm_action_arns]
}
