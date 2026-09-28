# ---------------------------------------------------------------------------
# IAM
#
# Six roles, in two families that are never merged:
#
#   EXECUTION ROLES  used by the ECS agent BEFORE the container runs: pull the
#                    image, create the log stream, resolve the parameters and
#                    secrets the task definition declares. ONE PER WORKLOAD
#                    (api / ai / migrator), each scoped to exactly its own image,
#                    its own log group and its own credentials. The permission
#                    matrix itself lives in local.execution_roles.
#
#   TASK ROLES       credentials visible to the application code. The API task
#                    role is the only one with S3 access, scoped to the evidence
#                    prefix. The AI task role gets no S3 at all, so a compromise
#                    of the AI container cannot read or delete evidence. The
#                    migrator task role holds no AWS permission.
#
# The CI/CD deploy role is a third, separate family and lives in github_oidc.tf.
#
# AmazonECSTaskExecutionRolePolicy is deliberately NOT attached. That AWS managed
# policy grants ECR pull and log writes on Resource = "*", i.e. every repository
# and every log group in the account. The inline statements below grant the same
# actions against the one repository and the one log group each workload actually
# uses.
#
# kms:Decrypt is deliberately NOT granted. SecureString parameters and the
# RDS-managed master secret are encrypted with the AWS managed keys
# alias/aws/ssm and alias/aws/secretsmanager, whose key policies already allow
# the account's principals when the call arrives through the owning service; an
# explicit grant is only required for a customer managed key, and none is used.
# If a future change introduces a CMK, the grant must be added back, scoped to
# that key ARN and constrained by kms:ViaService. See ../README.md.
#
# No AdministratorAccess. Resource = "*" appears exactly twice here, both times
# because the AWS action has no resource-level permissions, and both documented
# inline: ecr:GetAuthorizationToken and the ssmmessages channels for ECS Exec.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    # Only tasks from this account may assume these roles.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

# --- execution roles: one per workload -------------------------------------

resource "aws_iam_role" "execution" {
  for_each = local.execution_roles

  name               = "${local.name_prefix}-${each.key}-execution"
  description        = "ECS agent role for the ${each.key} workload: pull its own image, write its own log streams, read only its own credentials."
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json

  tags = {
    Name     = "${local.name_prefix}-${each.key}-execution"
    Workload = each.key
  }
}

data "aws_iam_policy_document" "execution" {
  for_each = local.execution_roles

  statement {
    sid     = "EcrAuthorizationToken"
    effect  = "Allow"
    actions = ["ecr:GetAuthorizationToken"]

    # ecr:GetAuthorizationToken has no resource-level permissions: it returns an
    # account-wide registry token and AWS rejects any resource other than "*".
    # It grants no read access to any image by itself.
    resources = ["*"]
  }

  statement {
    sid    = "PullOwnImageOnly"
    effect = "Allow"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]

    # One repository. The AI execution role cannot pull the API image and vice
    # versa; the migrator pulls the API image because it reuses it on purpose.
    resources = [each.value.repository_arn]
  }

  statement {
    sid    = "WriteOwnLogStreamsOnly"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    # No logs:CreateLogGroup: the three groups are created by Terraform with a
    # retention policy, and a role that can create groups can create them without
    # retention.
    resources = ["${each.value.log_group_arn}:*"]
  }

  dynamic "statement" {
    for_each = length(each.value.parameter_arns) > 0 ? [1] : []

    content {
      sid    = "ReadOwnParametersOnly"
      effect = "Allow"

      # ssm:GetParameters (plural) is the single call the ECS agent makes to
      # resolve a task definition `secrets` block. ssm:GetParameter,
      # GetParametersByPath and DescribeParameters are not granted.
      actions = ["ssm:GetParameters"]

      # Exact parameter ARNs, never /scope/prod/*.
      resources = each.value.parameter_arns
    }
  }

  dynamic "statement" {
    for_each = length(each.value.secret_arns) > 0 ? [1] : []

    content {
      sid       = "ReadOwnSecretsOnly"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = each.value.secret_arns
    }
  }
}

resource "aws_iam_role_policy" "execution" {
  for_each = local.execution_roles

  name   = "${local.name_prefix}-${each.key}-execution"
  role   = aws_iam_role.execution[each.key].id
  policy = data.aws_iam_policy_document.execution[each.key].json
}

# --- shared ECS Exec statement ---------------------------------------------

data "aws_iam_policy_document" "ecs_exec" {
  statement {
    sid    = "EcsExecSessionChannels"
    effect = "Allow"

    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]

    # ssmmessages actions do not support resource-level permissions; this is the
    # documented requirement for `aws ecs execute-command`.
    resources = ["*"]
  }
}

# --- API application task role ---------------------------------------------

resource "aws_iam_role" "api_task" {
  name               = "${local.name_prefix}-api-task"
  description        = "NestJS runtime role: DocumentEvidence objects in the existing bucket, nothing else"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

data "aws_iam_policy_document" "api_task" {
  # Exactly the three operations implemented by DocumentStoragePort
  # (saveDocument / readDocument / deleteDocument). ListBucket is intentionally
  # absent: the S3 adapter never lists, it always addresses a known storageKey.
  statement {
    sid    = "DocumentEvidenceObjects"
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]

    resources = [local.document_evidence_objects_arn]
  }
}

resource "aws_iam_role_policy" "api_task" {
  name   = "${local.name_prefix}-api-task-s3"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task.json
}

resource "aws_iam_role_policy" "api_task_exec" {
  count = var.enable_ecs_exec ? 1 : 0

  name   = "${local.name_prefix}-api-task-ecs-exec"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}

# --- AI application task role ----------------------------------------------

resource "aws_iam_role" "ai_task" {
  name               = "${local.name_prefix}-ai-task"
  description        = "FastAPI runtime role: no AWS data plane permissions at all"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "ai_task_exec" {
  count = var.enable_ecs_exec ? 1 : 0

  name   = "${local.name_prefix}-ai-task-ecs-exec"
  role   = aws_iam_role.ai_task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}

# --- migrator task role -----------------------------------------------------

resource "aws_iam_role" "migrator_task" {
  name               = "${local.name_prefix}-migrator-task"
  description        = "One-off Prisma migrate / ops role: reaches PostgreSQL over the network, holds no AWS permissions"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy" "migrator_task_exec" {
  count = var.enable_ecs_exec ? 1 : 0

  name   = "${local.name_prefix}-migrator-task-ecs-exec"
  role   = aws_iam_role.migrator_task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}
