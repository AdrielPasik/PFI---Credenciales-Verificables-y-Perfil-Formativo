# Isolated, opt-in probe for the Step Functions ecs:runTask.sync integration.
# This does not reference a mutating workflow, database, SSM, signing material,
# or an existing issuer. It remains absent until its own plan is reviewed.
locals {
  ecs_sync_probe_name              = "${local.name_prefix}-ecs-sync-probe"
  ecs_sync_probe_state_machine_arn = "arn:aws:states:${var.aws_region}:${local.account_id}:stateMachine:${local.ecs_sync_probe_name}"
  ecs_sync_probe_enabled           = var.enable_ecs_sync_probe
  ecs_sync_probe_operator_enabled  = local.ecs_sync_probe_enabled && var.enable_ecs_sync_probe_github_oidc_caller
}

resource "aws_ecr_repository" "ecs_sync_probe" {
  count                = local.ecs_sync_probe_enabled ? 1 : 0
  name                 = "scope/ecs-sync-probe"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_cloudwatch_log_group" "ecs_sync_probe" {
  count             = local.ecs_sync_probe_enabled ? 1 : 0
  name              = "/scope/${var.environment}/ecs-sync-probe"
  retention_in_days = var.log_retention_days
}

resource "aws_security_group" "ecs_sync_probe" {
  count       = local.ecs_sync_probe_enabled ? 1 : 0
  name        = "${local.name_prefix}-ecs-sync-probe"
  description = "No-ingress security group for the isolated ECS sync probe"
  vpc_id      = aws_vpc.main.id

  tags = {
    Component = "ecs-sync-probe"
  }
}

resource "aws_vpc_security_group_egress_rule" "ecs_sync_probe_dns_udp" {
  count             = local.ecs_sync_probe_enabled ? 1 : 0
  security_group_id = aws_security_group.ecs_sync_probe[0].id
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
  description       = "DNS only; the probe has no application destination"
}

resource "aws_vpc_security_group_egress_rule" "ecs_sync_probe_dns_tcp" {
  count             = local.ecs_sync_probe_enabled ? 1 : 0
  security_group_id = aws_security_group.ecs_sync_probe[0].id
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
  description       = "DNS fallback only; the probe has no application destination"
}

resource "aws_vpc_security_group_egress_rule" "ecs_sync_probe_https" {
  count             = local.ecs_sync_probe_enabled ? 1 : 0
  security_group_id = aws_security_group.ecs_sync_probe[0].id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Fargate ECR and CloudWatch control-plane connectivity only"
}

data "aws_iam_policy_document" "ecs_sync_probe_task_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Deliberately policy-free: no database, SSM, Secrets Manager, signer or write capability.
resource "aws_iam_role" "ecs_sync_probe_task" {
  count              = local.ecs_sync_probe_enabled ? 1 : 0
  name               = "${local.name_prefix}-ecs-sync-probe-task"
  description        = "Policy-free application role for the isolated ECS sync probe"
  assume_role_policy = data.aws_iam_policy_document.ecs_sync_probe_task_assume_role.json
}

resource "aws_iam_role" "ecs_sync_probe_execution" {
  count              = local.ecs_sync_probe_enabled ? 1 : 0
  name               = "${local.name_prefix}-ecs-sync-probe-execution"
  description        = "Image-pull and log-write role for the isolated ECS sync probe only"
  assume_role_policy = data.aws_iam_policy_document.ecs_sync_probe_task_assume_role.json
}

data "aws_iam_policy_document" "ecs_sync_probe_execution" {
  count = local.ecs_sync_probe_enabled ? 1 : 0
  statement {
    sid       = "GetEcrAuthorizationToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "PullOnlyTheProbeImage"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.ecs_sync_probe[0].arn]
  }

  statement {
    sid       = "WriteOnlyProbeLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.ecs_sync_probe[0].arn}:*"]
  }
}

resource "aws_iam_role_policy" "ecs_sync_probe_execution" {
  count  = local.ecs_sync_probe_enabled ? 1 : 0
  name   = "${local.name_prefix}-ecs-sync-probe-execution"
  role   = aws_iam_role.ecs_sync_probe_execution[0].id
  policy = data.aws_iam_policy_document.ecs_sync_probe_execution[0].json
}

resource "aws_ecs_task_definition" "ecs_sync_probe" {
  count                    = local.ecs_sync_probe_enabled ? 1 : 0
  family                   = local.ecs_sync_probe_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_sync_probe_execution[0].arn
  task_role_arn            = aws_iam_role.ecs_sync_probe_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.task_cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name                   = "ecs-sync-probe"
      image                  = "${aws_ecr_repository.ecs_sync_probe[0].repository_url}@${var.ecs_sync_probe_image_digest}"
      essential              = true
      readonlyRootFilesystem = true
      privileged             = false
      user                   = "65532:65532"
      command                = ["exit-zero"]
      environment            = []
      secrets                = []
      mountPoints            = []
      volumesFrom            = []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ecs_sync_probe[0].name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "probe"
        }
      }
    }
  ])

  lifecycle {
    precondition {
      condition     = var.ecs_sync_probe_image_digest != null
      error_message = "An immutable probe image digest is required when the ECS sync probe is enabled."
    }

    precondition {
      condition     = var.task_cpu_architecture == "X86_64"
      error_message = "The reviewed probe image is linux/amd64 only; task_cpu_architecture must be X86_64."
    }
  }

  tags = {
    Component = "ecs-sync-probe"
  }
}


data "aws_iam_policy_document" "ecs_sync_probe_sfn_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [local.ecs_sync_probe_state_machine_arn]
    }
  }
}

resource "aws_iam_role" "ecs_sync_probe_sfn_execution" {
  count              = local.ecs_sync_probe_enabled ? 1 : 0
  name               = "${local.name_prefix}-ecs-sync-probe-sfn-execution"
  description        = "Broker role for the isolated ECS sync probe only"
  assume_role_policy = data.aws_iam_policy_document.ecs_sync_probe_sfn_assume_role.json
}

data "aws_iam_policy_document" "ecs_sync_probe_sfn_execution" {
  count = local.ecs_sync_probe_enabled ? 1 : 0
  statement {
    sid       = "RunOnlyProbeTaskOnScopeCluster"
    effect    = "Allow"
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.ecs_sync_probe[0].arn]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid     = "PassOnlyProbeRolesToEcsTasks"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.ecs_sync_probe_execution[0].arn,
      aws_iam_role.ecs_sync_probe_task[0].arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "DescribeOnlyProbeTasksForSyncIntegration"
    effect    = "Allow"
    actions   = ["ecs:DescribeTasks", "ecs:StopTask"]
    resources = ["*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid       = "EmitSyncCallbackEventsOnly"
    effect    = "Allow"
    actions   = ["events:PutRule", "events:PutTargets", "events:DescribeRule", "events:DeleteRule", "events:RemoveTargets"]
    resources = ["arn:aws:events:${var.aws_region}:${local.account_id}:rule/StepFunctionsGetEventsForECSTaskRule"]
  }
}

resource "aws_iam_role_policy" "ecs_sync_probe_sfn_execution" {
  count  = local.ecs_sync_probe_enabled ? 1 : 0
  name   = "${local.name_prefix}-ecs-sync-probe-sfn-execution"
  role   = aws_iam_role.ecs_sync_probe_sfn_execution[0].id
  policy = data.aws_iam_policy_document.ecs_sync_probe_sfn_execution[0].json
}

resource "aws_sfn_state_machine" "ecs_sync_probe" {
  count    = local.ecs_sync_probe_enabled ? 1 : 0
  name     = local.ecs_sync_probe_name
  role_arn = aws_iam_role.ecs_sync_probe_sfn_execution[0].arn
  type     = "STANDARD"

  # The workflow intentionally has no logs configuration: execution history is the
  # raw observation surface, inputs are an allowlisted mode, and adding delivery
  # permissions would widen the broker role. An observer role, not the caller,
  # must retrieve the history after each manual execution.
  definition = <<-EOT
    {
      "Comment": "Isolated nonpersistent ECS sync probe. It never references a mutating workflow, database, SSM, signer material or credentials. No Retry: inspect every result manually.",
      "StartAt": "ValidateMode",
      "States": {
        "ValidateMode": {
          "Type": "Choice",
          "Choices": [
            {
              "Variable": "$.mode",
              "StringEquals": "exit-zero",
              "Next": "RunProbe"
            },
            {
              "Variable": "$.mode",
              "StringEquals": "exit-nonzero",
              "Next": "RunProbe"
            }
          ],
          "Default": "InvalidProbeInput"
        },
        "InvalidProbeInput": {
          "Type": "Fail",
          "Error": "InvalidProbeInput",
          "Cause": "mode must be exactly exit-zero or exit-nonzero; no ECS task was started."
        },
        "RunProbe": {
          "Type": "Task",
          "Resource": "arn:aws:states:::ecs:runTask.sync",
          "Parameters": {
            "Cluster": "${aws_ecs_cluster.main.arn}",
            "TaskDefinition": "${aws_ecs_task_definition.ecs_sync_probe[0].arn}",
            "LaunchType": "FARGATE",
            "NetworkConfiguration": {
              "AwsvpcConfiguration": {
                "Subnets": ${jsonencode(aws_subnet.public[*].id)},
                "SecurityGroups": ["${aws_security_group.ecs_sync_probe[0].id}"],
                "AssignPublicIp": "ENABLED"
              }
            },
            "EnableExecuteCommand": false,
            "Overrides": {
              "ContainerOverrides": [
                {
                  "Name": "ecs-sync-probe",
                  "Command.$": "States.Array($.mode)"
                }
              ]
            }
          },
          "Catch": [
            {
              "ErrorEquals": ["States.ALL"],
              "Next": "ProbeRequiresInspection"
            }
          ],
          "End": true
        },
        "ProbeRequiresInspection": {
          "Type": "Fail",
          "Error": "PROBE_REQUIRES_INSPECTION",
          "Cause": "The raw ecs:runTask.sync semantics must be read from execution history and ECS metadata before any conclusion or retry."
        }
      }
    }
  EOT

  lifecycle {
    precondition {
      condition     = var.ecs_sync_probe_image_digest != null
      error_message = "The probe state machine cannot be enabled without an immutable probe image digest."
    }
  }

  tags = {
    Component = "ecs-sync-probe"
  }
}

data "aws_iam_policy_document" "ecs_sync_probe_operator_assume_role" {
  count = local.ecs_sync_probe_operator_enabled ? 1 : 0
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn_effective]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_owner}/${var.github_repository}:environment:production"]
    }

    # An environment subject does not encode the branch. Bind the additional
    # standard OIDC claims so only main's manual probe workflow can assume this role.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:ref"
      values   = ["refs/heads/main"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:environment"
      values   = ["production"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:event_name"
      values   = ["workflow_dispatch"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:workflow"
      values   = ["Run isolated ECS sync probe"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_id"
      values   = [var.github_oidc_repository_id]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_owner_id"
      values   = [var.github_oidc_repository_owner_id]
    }
  }
}

resource "aws_iam_role" "ecs_sync_probe_operator" {
  count              = local.ecs_sync_probe_operator_enabled ? 1 : 0
  name               = "${local.name_prefix}-provisioner-operator"
  description        = "GitHub OIDC caller limited to exactly one isolated ECS sync probe state machine"
  assume_role_policy = data.aws_iam_policy_document.ecs_sync_probe_operator_assume_role[0].json

  lifecycle {
    precondition {
      condition     = var.enable_github_oidc && local.github_oidc_provider_arn_effective != ""
      error_message = "The probe caller requires the pre-existing GitHub OIDC provider."
    }

    precondition {
      condition     = var.github_oidc_repository_id != null && var.github_oidc_repository_owner_id != null
      error_message = "Immutable GitHub repository and owner IDs are required for the probe caller trust policy."
    }
  }
}

data "aws_iam_policy_document" "ecs_sync_probe_operator" {
  count = local.ecs_sync_probe_operator_enabled ? 1 : 0
  statement {
    sid       = "StartOnlyTheIsolatedProbe"
    effect    = "Allow"
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.ecs_sync_probe[0].arn]
  }
}

resource "aws_iam_role_policy" "ecs_sync_probe_operator" {
  count  = local.ecs_sync_probe_operator_enabled ? 1 : 0
  name   = "${local.name_prefix}-start-isolated-ecs-sync-probe"
  role   = aws_iam_role.ecs_sync_probe_operator[0].id
  policy = data.aws_iam_policy_document.ecs_sync_probe_operator[0].json
}
