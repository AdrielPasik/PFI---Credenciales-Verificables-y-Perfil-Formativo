# ---------------------------------------------------------------------------
# Container registries
#
# Two repositories only. The migrator runs the SAME API image with a command
# override (see ecs.tf), so the Prisma CLI and prisma/migrations must ship inside
# the API image. That avoids a third repository and guarantees the migrator and
# the runtime always agree on the Prisma version pinned in
# services/api/package.json (6.19.3).
#
# Tags are immutable so a deployed digest can never be silently replaced, and
# basic scan-on-push is free.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "api" {
  name                 = "scope/api"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name      = "${local.name_prefix}-api"
    Component = "api"
  }
}

resource "aws_ecr_repository" "ai" {
  name                 = "scope/ai"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name      = "${local.name_prefix}-ai"
    Component = "ai"
  }
}

locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images quickly; they are only build leftovers."
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Keep a bounded window of tagged images for rollback."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_kept_image_count
        }
        action = {
          type = "expire"
        }
      },
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "ai" {
  repository = aws_ecr_repository.ai.name
  policy     = local.ecr_lifecycle_policy
}
