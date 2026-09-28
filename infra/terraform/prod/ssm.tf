# ---------------------------------------------------------------------------
# SSM Parameter Store
#
# HARD RULE: Terraform never holds a secret value. Every SecureString parameter
# listed in ../README.md is created OUT OF BAND with `aws ssm put-parameter`
# before the ECS services are enabled, precisely because an `aws_ssm_parameter`
# resource stores its `value` in Terraform state - including a dummy value such as
# CHANGE_ME, and including anything produced by `random_password`.
#
# What Terraform DOES create here are non-secret String parameters that must be
# changeable at runtime without a terraform apply:
#
#   BLOCKCHAIN_EVIDENCE_MODE  flipped from mock to the Base Sepolia mode in a
#                             later slice, with the infrastructure frozen.
#   *_OPENAI_MODEL / REASONING_EXECUTION_MODEL
#                             the API and the AI service must agree on the exact
#                             model identity; a mismatch fails closed before any
#                             provider call. They start as "unset", which is not a
#                             secret and is not a valid model, so no provider call
#                             can succeed by accident.
#
# `ignore_changes = [value]` means the operator (or a later slice) can overwrite
# these with the real values and Terraform will not revert them.
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "managed_strings" {
  for_each = local.managed_string_parameters

  name  = each.key
  type  = "String"
  tier  = "Standard"
  value = each.value

  description = "Non-secret runtime configuration. Overwrite out of band; Terraform ignores value drift."

  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Component = "config"
  }
}
