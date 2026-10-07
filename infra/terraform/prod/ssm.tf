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
#   BLOCKCHAIN_EVIDENCE_MODE  mock | credential_registry. Flipped to the real
#                             mode in a later slice, with the infrastructure
#                             frozen. S8c5 split the network OUT of the mode:
#                             the mode no longer implies a chain.
#   CREDENTIAL_REGISTRY_NETWORK / _CHAIN_ID / _CONTRACT_ADDRESS / _DEPLOYMENT_ID
#                             the blockchain target. Non-secret, and they start
#                             as "unset", which is not a valid network, chain id,
#                             address or deployment id - so flipping the mode
#                             without populating them fails closed instead of
#                             writing to the wrong chain. The real address and
#                             deployment id come from S8c10's deployment; they
#                             are deliberately NOT invented here.
#
# CREDENTIAL_REGISTRY_RPC_URL is NOT in this file. A provider RPC endpoint
# usually carries its credential in the path or the query, so it is a
# SecureString created out of band like every other secret - Terraform knows its
# name, never its value.
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
