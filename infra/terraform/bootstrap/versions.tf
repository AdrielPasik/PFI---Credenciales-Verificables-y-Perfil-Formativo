# Bootstrap root: creates ONLY the prerequisites for remote Terraform state.
#
# This root intentionally has NO backend block. It is applied with a local state
# file first, because the S3 bucket that stores remote state cannot be used as a
# backend before it exists (chicken-and-egg). After the bucket exists, the local
# state can optionally be migrated into it (see ../README.md).
terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "scope"
      Component = "terraform-state"
      ManagedBy = "terraform"
      Root      = "infra/terraform/bootstrap"
    }
  }
}
