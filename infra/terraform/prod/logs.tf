# ---------------------------------------------------------------------------
# CloudWatch Logs
#
# One group per workload. Retention is bounded: the application already forbids
# logging JWTs, Authorization headers, passwords, PII, evidence bytes, storage
# keys and provider payloads, and short retention keeps ingestion inside the free
# tier at PFI volume.
#
# ALB access logs are deliberately NOT enabled: the public share token travels in
# the request path (/share/profile/:token), so access logs would persist bearer
# credentials to S3.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api" {
  name              = "/scope/${var.environment}/api"
  retention_in_days = var.log_retention_days

  tags = {
    Component = "api"
  }
}

resource "aws_cloudwatch_log_group" "ai" {
  name              = "/scope/${var.environment}/ai"
  retention_in_days = var.log_retention_days

  tags = {
    Component = "ai"
  }
}

resource "aws_cloudwatch_log_group" "migrator" {
  name              = "/scope/${var.environment}/migrator"
  retention_in_days = var.log_retention_days

  tags = {
    Component = "migrator"
  }
}
