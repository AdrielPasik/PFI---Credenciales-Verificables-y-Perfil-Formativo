# ---------------------------------------------------------------------------
# GitHub Actions -> AWS federation (OIDC)
#
# FOUNDATIONS ONLY. This file creates the trust relationship and the deploy role.
# It creates NO workflow file, runs NO deployment, and issues NO long-lived AWS
# access key. A workflow job assumes this role with a short-lived web identity
# token (aws-actions/configure-aws-credentials), and the credentials it receives
# expire with the job.
#
# Trust is narrowed on three axes at once:
#   1. the federated principal must be this account's GitHub OIDC provider;
#   2. the token audience must be sts.amazonaws.com;
#   3. the token subject must EXACTLY equal
#      repo:<owner>/<repo>:environment:<environment>.
#
# Axis 3 is the important one. It is a StringEquals against a fixed list, not a
# StringLike: a push to any branch, a tag, a pull request from a fork, a
# different repository under the same owner, or a job that does not declare the
# GitHub Environment, all fail to assume the role. The GitHub Environment is also
# where a human approval gate can be attached, so AWS mutation can require a
# reviewer.
#
# WHAT THIS ROLE IS AND IS NOT
#
# It holds no credential-reading API: no ssm:GetParameter(s), no
# secretsmanager:GetSecretValue, no kms:Decrypt. It also cannot administer
# infrastructure: no IAM write, no access to the Terraform state bucket, no RDS
# API, no S3. Those changes stay with the human operator running Terraform.
#
# It does, however, hold DEPLOYMENT AUTHORITY over these workloads, and that
# authority is not the same thing as being unable to reach secrets. The role can
# register a task definition and pass the ECS execution roles, so a task
# definition it authors can name any parameter those execution roles are allowed
# to resolve, and it can then read the running container output through the log
# groups. In other words it cannot read a secret through an AWS API call, but it
# can deploy code that runs with the workload identity. Treat it as "can change
# what runs in production", not as "harmless".
#
# That authority is bounded by three things, not by the IAM policy alone:
#   - the exact-subject trust condition above, so only this repository can use it;
#   - the GitHub Environment `production`, where a required reviewer makes every
#     deployment a human-approved action;
#   - the per-workload execution roles (iam.tf), which keep the blast radius of
#     any one task definition to that one workload's own credentials.
#
# Cost: zero. An IAM OIDC provider and an IAM role are free.
# ---------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  count = var.enable_github_oidc && var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # Left empty on purpose. AWS validates token.actions.githubusercontent.com
  # against its own trust store and maintains the thumbprint itself; pinning a
  # value here only creates a future outage when GitHub rotates its CA.

  tags = {
    Name = "${local.name_prefix}-github-actions-oidc"
  }
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  count = var.enable_github_oidc ? 1 : 0

  statement {
    sid     = "GitHubActionsWebIdentity"
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

    # Exact subjects only. See the header.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_trusted_subjects
    }
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  count = var.enable_github_oidc ? 1 : 0

  name               = "${local.name_prefix}-github-actions-deploy"
  description        = "Assumed by GitHub Actions through OIDC to push images and roll ECS services. No IAM administration, no Terraform state access, no secret-reading APIs."
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role[0].json

  # One hour is enough for a build-push-deploy job and keeps the blast radius of a
  # leaked session short.
  max_session_duration = 3600

  lifecycle {
    precondition {
      condition     = var.github_owner != "" && var.github_repository != ""
      error_message = "github_owner and github_repository must be set; an empty value would produce a trust policy that matches nothing, or worse an unintended subject."
    }

    precondition {
      condition     = local.github_oidc_provider_arn_effective != null && local.github_oidc_provider_arn_effective != ""
      error_message = "No OIDC provider ARN: either set create_github_oidc_provider = true, or pass the ARN of the existing provider in github_oidc_provider_arn."
    }
  }

  tags = {
    Name = "${local.name_prefix}-github-actions-deploy"
  }
}

data "aws_iam_policy_document" "github_actions_deploy" {
  count = var.enable_github_oidc ? 1 : 0

  # --- ECR ------------------------------------------------------------------

  statement {
    sid    = "EcrLogin"
    effect = "Allow"

    actions = ["ecr:GetAuthorizationToken"]

    # ecr:GetAuthorizationToken has no resource-level permissions: it returns an
    # account-wide registry token and AWS rejects any resource other than "*".
    resources = ["*"]
  }

  statement {
    sid    = "EcrPushPullScopeImages"
    effect = "Allow"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:ListImages",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]

    # Exactly the two Scope repositories. No ecr:DeleteRepository and no
    # ecr:BatchDeleteImage: expiring images is the lifecycle policy's job.
    resources = [
      aws_ecr_repository.api.arn,
      aws_ecr_repository.ai.arn,
    ]
  }

  # --- ECS task definitions -------------------------------------------------

  statement {
    sid    = "EcsTaskDefinitionLifecycle"
    effect = "Allow"

    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]

    # ecs:RegisterTaskDefinition and ecs:DescribeTaskDefinition do not support
    # resource-level permissions: the ARN of the revision being registered does
    # not exist yet. Deregistration and deletion are NOT granted.
    resources = ["*"]
  }

  # --- ECS services ---------------------------------------------------------

  statement {
    sid    = "EcsRollScopeServices"
    effect = "Allow"

    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]

    # Only the two Scope services in the Scope cluster. No CreateService and no
    # DeleteService: service topology belongs to Terraform.
    resources = [
      "arn:aws:ecs:${var.aws_region}:${local.account_id}:service/${aws_ecs_cluster.main.name}/${local.name_prefix}-api",
      "arn:aws:ecs:${var.aws_region}:${local.account_id}:service/${aws_ecs_cluster.main.name}/${local.name_prefix}-ai",
    ]
  }

  # --- ECS one-off tasks (migrations / seed) --------------------------------

  statement {
    sid    = "EcsRunMigrator"
    effect = "Allow"

    actions = ["ecs:RunTask"]

    # Any revision of the migrator family, and nothing else. The API and AI
    # families cannot be launched as free-standing tasks by CI.
    resources = ["arn:aws:ecs:${var.aws_region}:${local.account_id}:task-definition/${local.name_prefix}-migrator:*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid    = "EcsObserveTasks"
    effect = "Allow"

    actions = [
      "ecs:DescribeTasks",
      "ecs:StopTask",
    ]

    resources = ["arn:aws:ecs:${var.aws_region}:${local.account_id}:task/${aws_ecs_cluster.main.name}/*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid    = "EcsListTasksInScopeCluster"
    effect = "Allow"

    actions = ["ecs:ListTasks"]

    # ecs:ListTasks takes no resource ARN; the ecs:cluster condition is the
    # documented way to scope it to one cluster.
    resources = ["*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  # --- PassRole -------------------------------------------------------------

  statement {
    sid    = "PassEcsTaskRolesOnly"
    effect = "Allow"

    actions = ["iam:PassRole"]

    # Registering a task definition or running a task requires passing these six
    # roles (three execution, three task) and no others. Without the condition,
    # PassRole is an escalation path.
    resources = concat(
      [for role in aws_iam_role.execution : role.arn],
      [
        aws_iam_role.api_task.arn,
        aws_iam_role.ai_task.arn,
        aws_iam_role.migrator_task.arn,
      ],
    )

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # --- deployment observability ---------------------------------------------

  statement {
    sid    = "ReadScopeDeploymentLogs"
    effect = "Allow"

    actions = [
      "logs:DescribeLogStreams",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
    ]

    # Read-only, and only the three Scope log groups: a CI job must be able to
    # print why a migration failed without being able to delete the evidence.
    resources = [
      "${aws_cloudwatch_log_group.api.arn}:*",
      "${aws_cloudwatch_log_group.ai.arn}:*",
      "${aws_cloudwatch_log_group.migrator.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  count = var.enable_github_oidc ? 1 : 0

  name   = "${local.name_prefix}-github-actions-deploy"
  role   = aws_iam_role.github_actions_deploy[0].id
  policy = data.aws_iam_policy_document.github_actions_deploy[0].json
}