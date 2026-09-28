provider "aws" {
  region = var.aws_region

  # Every resource in this root is tagged, so orphan detection and cost
  # attribution work with Resource Groups / Cost Explorer without per-resource
  # tag blocks.
  default_tags {
    tags = {
      Project     = "scope"
      Environment = var.environment
      ManagedBy   = "terraform"
      Root        = "infra/terraform/prod"
    }
  }
}

# Account id is needed to build SSM parameter ARNs and IAM conditions. This is a
# read-only call; `terraform validate` does not evaluate it.
data "aws_caller_identity" "current" {}
