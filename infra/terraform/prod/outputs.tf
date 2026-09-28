# No output exposes a secret value. The RDS master secret is referenced by ARN
# only; its value stays inside Secrets Manager.

output "vpc_id" {
  description = "Scope VPC id."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnets used by the ALB and by both Fargate services."
  value       = aws_subnet.public[*].id
}

output "database_subnet_ids" {
  description = "Private subnets backing the RDS subnet group."
  value       = aws_subnet.database[*].id
}

output "security_group_ids" {
  description = "Security group ids by role."
  value = {
    alb      = aws_security_group.alb.id
    api      = aws_security_group.api.id
    ai       = aws_security_group.ai.id
    rds      = aws_security_group.rds.id
    migrator = aws_security_group.migrator.id
  }
}

output "ecr_repository_urls" {
  description = "Push targets for the container images."
  value = {
    api = aws_ecr_repository.api.repository_url
    ai  = aws_ecr_repository.ai.repository_url
  }
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "ecs_task_definition_families" {
  description = "Task definition families, for run-task and deploy automation."
  value = {
    api      = aws_ecs_task_definition.api.family
    ai       = aws_ecs_task_definition.ai.family
    migrator = aws_ecs_task_definition.migrator.family
  }
}

output "alb_dns_name" {
  description = "ALB hostname. Point api.scopeedu.technology here (CNAME on external DNS, or the alias record in dns.tf)."
  value       = aws_lb.api.dns_name
}

output "alb_zone_id" {
  description = "Canonical hosted zone id of the ALB, required for a Route 53 alias record."
  value       = aws_lb.api.zone_id
}

output "api_target_group_arn" {
  description = "Target group the API service registers into."
  value       = aws_lb_target_group.api.arn
}

output "acm_certificate_validation_records" {
  description = "DNS validation records to publish when the certificate is requested. Empty while request_acm_certificate is false."
  # Iterating the counted resource itself keeps this valid when the count is 0.
  value = flatten([
    for certificate in aws_acm_certificate.api : [
      for option in certificate.domain_validation_options : {
        name  = option.resource_record_name
        type  = option.resource_record_type
        value = option.resource_record_value
      }
    ]
  ])
}

output "ai_internal_endpoint" {
  description = "Cloud Map endpoint the API uses to reach FastAPI inside the VPC."
  value       = "http://${local.ai_internal_dns_name}:${var.ai_container_port}"
}

output "cloud_map_namespace_id" {
  description = "Private DNS namespace id."
  value       = aws_service_discovery_private_dns_namespace.internal.id
}

output "log_group_names" {
  description = "CloudWatch log groups."
  value = {
    api      = aws_cloudwatch_log_group.api.name
    ai       = aws_cloudwatch_log_group.ai.name
    migrator = aws_cloudwatch_log_group.migrator.name
  }
}

output "rds_endpoint" {
  description = "RDS endpoint host:port. Not a secret; unreachable from outside the VPC."
  value       = one(aws_db_instance.main[*].endpoint)
}

output "rds_database_name" {
  description = "Initial database name created by RDS."
  value       = one(aws_db_instance.main[*].db_name)
}

output "rds_master_user_secret_arn" {
  description = "ARN of the AWS-managed master credential secret. The value never passes through Terraform."
  value       = local.rds_master_secret_arn != "" ? local.rds_master_secret_arn : null
}

output "iam_role_arns" {
  description = "Roles referenced by the task definitions. One execution role per workload, plus the three application task roles."
  value = {
    api_execution      = aws_iam_role.execution["api"].arn
    ai_execution       = aws_iam_role.execution["ai"].arn
    migrator_execution = aws_iam_role.execution["migrator"].arn
    api_task           = aws_iam_role.api_task.arn
    ai_task            = aws_iam_role.ai_task.arn
    migrator_task      = aws_iam_role.migrator_task.arn
  }
}

output "ssm_parameters_managed_by_terraform" {
  description = "Non-secret String parameters created here (value drift is ignored on purpose)."
  value       = keys(local.managed_string_parameters)
}

output "ssm_parameters_required_out_of_band" {
  description = "SecureString parameters that MUST exist before enable_services is set to true. Terraform never creates or reads their values."
  # distinct(): the shared internal JWT secret is consumed by both services under
  # two different environment variable names, but it is a single parameter.
  #
  # The migrator is NOT listed: it reads the RDS master credential straight from
  # the Secrets Manager secret that RDS owns, so no migrator secret is duplicated
  # into Parameter Store.
  value = sort(distinct(concat(
    values(local.api_secret_parameters),
    values(local.ai_secret_parameters),
  )))
}

output "document_evidence_bucket" {
  description = "Pre-existing bucket referenced by IAM only. Not managed by Terraform."
  value = {
    name        = var.document_evidence_bucket_name
    prefix      = var.document_evidence_prefix
    bucket_arn  = local.document_evidence_bucket_arn
    objects_arn = local.document_evidence_objects_arn
  }
}

output "rds_final_snapshot_identifier" {
  description = "Identifier the final snapshot will use on destroy. Bump rds_final_snapshot_suffix if a snapshot with this id already exists."
  value       = local.rds_final_snapshot_identifier
}

output "github_actions_deploy_role_arn" {
  description = "Role that GitHub Actions assumes through OIDC. This is the role-to-assume input of aws-actions/configure-aws-credentials. Not a secret."
  value       = one(aws_iam_role.github_actions_deploy[*].arn)
}

output "github_oidc_provider_arn" {
  description = "IAM OIDC provider for token.actions.githubusercontent.com, whether created here or supplied."
  value       = local.github_oidc_provider_arn_effective
}

output "github_trusted_subjects" {
  description = "Exact OIDC subjects allowed to assume the deploy role. Any workflow job outside this list is rejected by STS."
  value       = local.github_trusted_subjects
}
