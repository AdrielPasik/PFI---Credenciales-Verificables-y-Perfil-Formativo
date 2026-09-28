variable "aws_region" {
  description = "AWS region that holds the Terraform state bucket. Must match the region used by infra/terraform/prod."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name_override" {
  description = <<-EOT
    Optional explicit name for the Terraform state bucket. Leave empty to use the
    derived name scope-tfstate-<account-id>-<region>, which is globally unique
    without leaking anything sensitive. This bucket must never be the document
    evidence bucket.
  EOT
  type        = string
  default     = ""
}

variable "noncurrent_state_version_retention_days" {
  description = "How long superseded Terraform state versions are kept before expiring. Versioning is the state recovery mechanism, so this is the recovery window."
  type        = number
  default     = 90
}
