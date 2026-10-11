# ---------------------------------------------------------------------------
# Issuer provisioner broker (S8c11.4c1)
#
# A Step Functions STANDARD state machine that is the ONLY intended way to start
# the issuer provisioner task. ecs:RunTask cannot be sufficiently constrained by
# IAM for command, environment, environment files or network placement.
# Task/execution-role overrides are constrained only indirectly through
# iam:PassRole, which still does not remove the broader RunTask override surface.
# So an operator is never given RunTask: the operator-facing permission is meant
# to be states:StartExecution on this one state machine, and the definition
# (inline below) fixes every ECS request field except the container command.
#
# THIS FILE CREATES NO CALLER. There is no GitHub operations role, no workflow and
# no identity with states:StartExecution. The state machine exists in desired
# state but is not invocable by anyone defined here.
#
# Standard workflow, no logging: the execution history already records inputs and
# outputs, and enabling CloudWatch Logs delivery would widen this role's
# permissions (log delivery actions do not support resource scoping).
#
# Open items, deliberately NOT resolved here:
#   PROVISIONER_EXTERNAL_CALLER = NOT_IMPLEMENTED
#   PROVISIONER_IMAGE_DIGEST_PINNING = REPO_READY
#   PROVISIONER_ARTIFACT_INTEGRITY = NOT_YET_PROVEN
#     The task definition now REQUIRES a content-addressed image reference
#     (repository@sha256:<digest>, var.provisioner_image_digest). That is a
#     mechanism, not proof of integrity: no release digest has been selected or
#     verified, nothing has been planned or applied, live ECR has not been
#     inspected, and no commit -> digest provenance or attestation exists yet.
#   PINNED_DIGEST_RETENTION_GUARANTEED = NOT_PROVEN, LIVE_IMAGE_AVAILABILITY = UNKNOWN
#     ecr.tf expires all but the newest ecr_kept_image_count images (and untagged
#     images after one day), so a pinned digest can be removed later. Before use,
#     confirm the digest exists, matches the task CPU architecture and the reviewed
#     release, and will not expire first. A missing image fails the task; there is
#     no tag fallback.
#   PROVISIONER_NETWORK_EGRESS_CONFINEMENT = PARTIAL
#     See security_groups.tf: 443 to 0.0.0.0/0.
#   ECS_SYNC_EXIT_CODE_PATH = HYPOTHESIS_NOT_LIVE_VERIFIED
#   ECS_SYNC_NONZERO_EXIT_SEMANTICS = NOT_LIVE_VERIFIED
#   ECS_SYNC_OUTPUT_LIVE_VERIFICATION_REQUIRED_BEFORE_CALLER = true
#     $.Containers[0].ExitCode is NOT demonstrated by official documentation for
#     ecs:runTask.sync. It is a deliberately fail-closed hypothesis: an output of a
#     different shape can only produce a false INSPECT_FIRST, never a false success.
#   No TimeoutSeconds: there is no grounded runtime bound for provisioning today,
#   and a timeout could interrupt an operation in an ambiguous state. Operational
#   gap, not a decision that none is needed.
#   ENVIRONMENT_OVERRIDE_AUTHORIZATION = BROKER_CONTROLLED_IN_DESIRED_STATE
# ---------------------------------------------------------------------------

locals {
  provisioner_state_machine_name = "${local.name_prefix}-issuer-provisioner"

  # Built from region, account and name rather than read from the state machine
  # resource: the execution role's trust policy must name this exact state machine,
  # and the state machine needs the role ARN, so referencing the resource from the
  # trust policy would be a dependency cycle.
  provisioner_state_machine_arn = "arn:aws:states:${var.aws_region}:${local.account_id}:stateMachine:${local.provisioner_state_machine_name}"
}

resource "aws_sfn_state_machine" "provisioner" {
  name     = local.provisioner_state_machine_name
  role_arn = aws_iam_role.provisioner_sfn_execution.arn
  type     = "STANDARD"

  # The ONLY interpolations in this definition are the four static references
  # below (cluster, exact task definition revision, public subnets, provisioner
  # security group). The caller never supplies any of them. The only values taken
  # from the execution input are issuer_id and credential_types, and only to build
  # the container command.
  #
  # There is NO Retry anywhere: provisioning creates new key material on every
  # attempt and has partial-failure states, so any error ends in INSPECT_FIRST and
  # never loops back to RunProvisioner.
  #
  # ECS_SYNC_EXIT_CODE_PATH = HYPOTHESIS_NOT_LIVE_VERIFIED.
  # ECS_SYNC_NONZERO_EXIT_SEMANTICS = NOT_LIVE_VERIFIED.
  definition = <<-EOT
    {
      "Comment": "Issuer provisioner broker (S8c11.4c1). The ONLY dynamic request inputs are issuer_id and credential_types, used only to build the container command. There is NO Retry anywhere: any error ends in INSPECT_FIRST. ECS_SYNC_EXIT_CODE_PATH = HYPOTHESIS_NOT_LIVE_VERIFIED. ECS_SYNC_NONZERO_EXIT_SEMANTICS = NOT_LIVE_VERIFIED.",
      "StartAt": "CheckIssuerPresent",
      "States": {
        "CheckIssuerPresent": {
          "Type": "Choice",
          "Choices": [
            {
              "Variable": "$.issuer_id",
              "IsPresent": true,
              "Next": "CheckIssuerIsString"
            }
          ],
          "Default": "InvalidInput"
        },
        "CheckIssuerIsString": {
          "Type": "Choice",
          "Choices": [
            {
              "Variable": "$.issuer_id",
              "IsString": true,
              "Next": "CheckTypesPresent"
            }
          ],
          "Default": "InvalidInput"
        },
        "CheckTypesPresent": {
          "Type": "Choice",
          "Choices": [
            {
              "Variable": "$.credential_types",
              "IsPresent": true,
              "Next": "CheckTypesIsString"
            }
          ],
          "Default": "InvalidInput"
        },
        "CheckTypesIsString": {
          "Type": "Choice",
          "Choices": [
            {
              "Variable": "$.credential_types",
              "IsString": true,
              "Next": "RunProvisioner"
            }
          ],
          "Default": "InvalidInput"
        },
        "InvalidInput": {
          "Type": "Fail",
          "Error": "InvalidProvisioningInput",
          "Cause": "issuer_id and credential_types must both be present and be strings. Nothing was started."
        },
        "RunProvisioner": {
          "Type": "Task",
          "Comment": "No Retry, deliberately. Any integration error is caught and ends in INSPECT_FIRST. The task output is kept raw (no ResultSelector, no ResultPath, no OutputPath) so the exit-code checks below see the integration output unchanged.",
          "Resource": "arn:aws:states:::ecs:runTask.sync",
          "Parameters": {
            "Cluster": "${aws_ecs_cluster.main.arn}",
            "TaskDefinition": "${aws_ecs_task_definition.provisioner.arn}",
            "LaunchType": "FARGATE",
            "NetworkConfiguration": {
              "AwsvpcConfiguration": {
                "Subnets": ${jsonencode(aws_subnet.public[*].id)},
                "SecurityGroups": ["${aws_security_group.provisioner.id}"],
                "AssignPublicIp": "ENABLED"
              }
            },
            "EnableExecuteCommand": false,
            "Overrides": {
              "ContainerOverrides": [
                {
                  "Name": "provisioner",
                  "Command.$": "States.Array('provision', '--issuer', $.issuer_id, '--types', $.credential_types)"
                }
              ]
            }
          },
          "Catch": [
            {
              "ErrorEquals": ["States.ALL"],
              "Next": "ProvisioningRequiresInspection"
            }
          ],
          "Next": "CheckExitCodePresent"
        },
        "CheckExitCodePresent": {
          "Type": "Choice",
          "Comment": "$.Containers[0].ExitCode is NOT demonstrated by official documentation for ecs:runTask.sync. It is a deliberately fail-closed HYPOTHESIS: a different output shape can only produce a false INSPECT_FIRST, never a false success. ECS_SYNC_OUTPUT_LIVE_VERIFICATION_REQUIRED_BEFORE_CALLER = true.",
          "Choices": [
            {
              "Variable": "$.Containers[0].ExitCode",
              "IsPresent": true,
              "Next": "CheckExitCodeZero"
            }
          ],
          "Default": "ProvisioningRequiresInspection"
        },
        "CheckExitCodeZero": {
          "Type": "Choice",
          "Choices": [
            {
              "Variable": "$.Containers[0].ExitCode",
              "NumericEquals": 0,
              "Next": "ProvisioningSucceeded"
            }
          ],
          "Default": "ProvisioningRequiresInspection"
        },
        "ProvisioningSucceeded": {
          "Type": "Succeed",
          "Comment": "ORCHESTRATION_SUCCEEDED with an explicit container exit code of 0 only. It does not prove persistence or readiness: confirm those independently."
        },
        "ProvisioningRequiresInspection": {
          "Type": "Fail",
          "Error": "INSPECT_FIRST",
          "Cause": "The provisioning outcome is not confirmed. Inspect the ECS task, the provisioner logs, the database and SSM parameter metadata before any retry. A write may have occurred."
        }
      }
    }
  EOT

  tags = {
    Component = "provisioner"
  }
}

# --- execution role ----------------------------------------------------------
#
# Trust: only the Step Functions service, and only on behalf of THIS account and
# THIS state machine (cross-service confused deputy prevention). A bare
# `states.amazonaws.com` trust would let any state machine in any account that can
# name this role assume it.
data "aws_iam_policy_document" "provisioner_sfn_assume_role" {
  statement {
    sid     = "TrustStepFunctionsForThisStateMachineOnly"
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
      values   = [local.provisioner_state_machine_arn]
    }
  }
}

resource "aws_iam_role" "provisioner_sfn_execution" {
  name               = "${local.name_prefix}-provisioner-sfn-execution"
  description        = "Step Functions execution role for the issuer provisioner broker: run one exact task definition revision and pass its two roles. No secrets, no database, no signer access."
  assume_role_policy = data.aws_iam_policy_document.provisioner_sfn_assume_role.json
}

data "aws_iam_policy_document" "provisioner_sfn_execution" {
  # The EXACT task definition revision, so a revision registered out of band is
  # never run by this state machine. The cluster condition keeps it on this cluster.
  statement {
    sid       = "RunExactProvisionerRevision"
    effect    = "Allow"
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.provisioner.arn]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  # Defence in depth on top of EnableExecuteCommand=false in the definition and the
  # absence of ssmmessages in the task role. These are separate guarantees.
  statement {
    sid       = "NeverRunProvisionerWithExecuteCommand"
    effect    = "Deny"
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.provisioner.arn]

    condition {
      test     = "StringEquals"
      variable = "ecs:enable-execute-command"
      values   = ["true"]
    }
  }

  statement {
    sid     = "PassOnlyTheProvisionerRoles"
    effect  = "Allow"
    actions = ["iam:PassRole"]

    resources = [
      aws_iam_role.provisioner_task.arn,
      aws_iam_role.provisioner_execution.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # Required by the .sync integration. AWS documents Resource "*" for these two:
  # the task ARN does not exist before RunTask, so it cannot be named in advance.
  # The integration can only stop tasks that Step Functions itself started.
  statement {
    sid       = "ObserveAndStopOwnTasks"
    effect    = "Allow"
    actions   = ["ecs:DescribeTasks", "ecs:StopTask"]
    resources = ["*"]
  }

  # The .sync integration observes task state through an EventBridge managed rule
  # with this fixed name.
  statement {
    sid    = "ManagedRuleForEcsTaskEvents"
    effect = "Allow"

    actions = [
      "events:DescribeRule",
      "events:PutRule",
      "events:PutTargets",
    ]

    resources = ["arn:aws:events:${var.aws_region}:${local.account_id}:rule/StepFunctionsGetEventsForECSTaskRule"]
  }
}

resource "aws_iam_role_policy" "provisioner_sfn_execution" {
  name   = "${local.name_prefix}-provisioner-sfn-execution"
  role   = aws_iam_role.provisioner_sfn_execution.id
  policy = data.aws_iam_policy_document.provisioner_sfn_execution.json
}
