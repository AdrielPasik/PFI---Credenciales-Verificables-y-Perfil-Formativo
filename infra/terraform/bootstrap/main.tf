data "aws_caller_identity" "current" {}

locals {
  # Derived so the name is globally unique per account+region. The document
  # evidence bucket (traza-demo-document-evidence-30012004) is NEVER used for
  # Terraform state: state and evidence have different lifecycles, different
  # blast radius and different retention rules.
  state_bucket_name = var.state_bucket_name_override != "" ? var.state_bucket_name_override : "scope-tfstate-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
}

resource "aws_s3_bucket" "tfstate" {
  bucket = local.state_bucket_name

  # The state bucket outlives every environment. `terraform destroy` of the prod
  # root must never be able to remove it, and this guard also protects against a
  # destroy of this bootstrap root.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning is the state recovery mechanism: a corrupted or truncated state can
# be restored by reading a previous object version.
resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (AES256) keeps state encrypted at rest with no KMS key to manage and no
# KMS request charges. A customer managed key would add cost without changing the
# threat model for this PFI: the state is already restricted to the account.
resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }

    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "tfstate_tls_only" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.tfstate.arn,
      "${aws_s3_bucket.tfstate.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  policy = data.aws_iam_policy_document.tfstate_tls_only.json

  depends_on = [aws_s3_bucket_public_access_block.tfstate]
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    id     = "expire-noncurrent-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_state_version_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
