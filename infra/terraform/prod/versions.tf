terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.66"
    }
  }

  # Remote state with S3-native locking (use_lockfile). DynamoDB-based locking is
  # deprecated and is deliberately not used.
  #
  # PARTIAL CONFIGURATION: the bucket name embeds the AWS account id, so it is not
  # committed. Supply it at init time:
  #
  #   terraform init -backend-config=backend.hcl
  #
  # backend.hcl is gitignored; backend.hcl.example shows its shape.
  backend "s3" {
    key          = "envs/prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
