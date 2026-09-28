# ---------------------------------------------------------------------------
# RDS PostgreSQL 16 (private, Single-AZ)
#
# CREDENTIAL MODEL (final, see ../README.md and ../sql/):
#
#   MASTER  manage_master_user_password = true. RDS generates the master password
#           itself and stores it in a Secrets Manager secret it owns. That secret
#           is the SINGLE SOURCE OF TRUTH and is never copied into SSM. Terraform
#           learns only the ARN, which is the only option that satisfies "no
#           secret in Terraform state" - `password = var.x` would persist it in
#           state, and so would random_password.
#           Used exclusively for administrative bootstrap and for
#           `prisma migrate deploy` from the one-off migrator task, which reads
#           the secret at container start through the ECS `secrets` block.
#
#   RUNTIME NestJS connects as a dedicated, non-master role (scope_app) with no
#           DDL authority. Its password is generated out of band and stored as an
#           SSM SecureString (/scope/prod/api/DATABASE_URL); it is independent of
#           the master credential and never passes through Terraform.
#
# No schema, no role and no data are created here. The role bootstrap SQL lives in
# ../sql/ as a reviewed artifact and is executed manually in a later slice, as are
# `prisma migrate deploy` and `db:seed`.
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db"
  description = "Private subnets with no internet route"
  subnet_ids  = aws_subnet.database[*].id

  tags = {
    Name = "${local.name_prefix}-db-subnet-group"
  }
}

resource "aws_db_instance" "main" {
  count = var.create_rds ? 1 : 0

  identifier = "${local.name_prefix}-db"

  engine = "postgres"
  # Major version only. AWS picks the current minor inside 16 and keeps it patched
  # through auto_minor_version_upgrade, so no minor is hardcoded or guessed.
  engine_version              = var.rds_engine_version
  allow_major_version_upgrade = false
  auto_minor_version_upgrade  = true
  apply_immediately           = false

  instance_class = var.rds_instance_class

  storage_type      = "gp3"
  allocated_storage = var.rds_allocated_storage
  # Storage autoscaling disabled: it can only grow the bill silently, and the
  # dataset is a few thousand rows plus JSON artifacts.
  max_allocated_storage = 0
  storage_encrypted     = true

  db_name  = var.rds_database_name
  username = var.rds_master_username

  # See the header: the password is generated and held by AWS, not by Terraform.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false
  availability_zone      = var.availability_zones[0]

  port = 5432

  backup_retention_period = var.rds_backup_retention_days
  backup_window           = var.rds_backup_window_utc
  maintenance_window      = var.rds_maintenance_window_utc
  copy_tags_to_snapshot   = true

  # Deliberately not enabled: Performance Insights and Enhanced Monitoring are
  # paid features that add nothing for a single-instance PFI workload.
  performance_insights_enabled = false
  monitoring_interval          = 0

  # A destroy must leave a recoverable artifact behind.
  #
  # The identifier is NOT a fixed string: a snapshot id is unique and permanent
  # per account/region, so a second destroy against a previously used id fails at
  # the very moment the database is being deleted. rds_final_snapshot_suffix is
  # bumped (or rds_final_snapshot_identifier is set explicitly) before any
  # re-destroy; the runbook in ../README.md states this as a pre-destroy check.
  skip_final_snapshot       = false
  final_snapshot_identifier = local.rds_final_snapshot_identifier
  deletion_protection       = var.rds_deletion_protection

  tags = {
    Name      = "${local.name_prefix}-db"
    Component = "database"
  }

  lifecycle {
    # The provider stores the resolved minor (for example 16.15) after apply; that
    # is expected drift against the major-only input and must not trigger a
    # replacement or an unplanned upgrade.
    ignore_changes = [engine_version]
  }
}
