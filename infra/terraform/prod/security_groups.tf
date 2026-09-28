# ---------------------------------------------------------------------------
# Security groups
#
# Inbound is always "previous hop only":
#   internet -> ALB           443 (and 80 only while the redirect exists)
#   ALB      -> API           api_container_port
#   API      -> AI            ai_container_port   <- the ONLY inbound to the AI
#   API      -> RDS           5432
#   migrator -> RDS           5432
#
# The migrator has no path to the AI service. A Prisma migration, a seed and
# db:verify-demo never call the reasoning pipeline, so granting that reachability
# would only widen the blast radius of an ops task.
#
# Nothing except the ALB accepts 0.0.0.0/0. Tasks still have public IPs, but that
# only gives them egress: an unsolicited inbound packet has no matching rule.
#
# Egress is explicit: 443 for ECR pulls, CloudWatch Logs, SSM, Secrets Manager,
# S3 (through the gateway endpoint) and the external AI provider (and later the
# Base Sepolia RPC), plus DNS inside the VPC for Cloud Map resolution.
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Public entry point for api.scopeedu.technology"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-alb-sg"
  }
}

resource "aws_security_group" "api" {
  name        = "${local.name_prefix}-api-sg"
  description = "NestJS API tasks: inbound only from the ALB"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-api-sg"
  }
}

resource "aws_security_group" "ai" {
  name        = "${local.name_prefix}-ai-sg"
  description = "FastAPI tasks: inbound only from the API security group, never from the internet or from ops tasks"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-ai-sg"
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "PostgreSQL: inbound 5432 only from the API and migrator security groups"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-rds-sg"
  }
}

resource "aws_security_group" "migrator" {
  name        = "${local.name_prefix}-migrator-sg"
  description = "One-off Prisma migrate / ops tasks: no inbound at all, egress to RDS and AWS APIs only"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-migrator-sg"
  }
}

# --- ALB ingress -----------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "alb_https_ipv4" {
  count             = var.enable_https_listener ? 1 : 0
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from the internet"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# Port 80 exists only to answer the redirect to 443 (or a 503 placeholder before
# the certificate is issued). No application traffic is served over 80.
resource "aws_vpc_security_group_ingress_rule" "alb_http_ipv4" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from the internet, redirected to HTTPS"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to API tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.api_container_port
  to_port                      = var.api_container_port
  referenced_security_group_id = aws_security_group.api.id
}

# --- API -------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "Application traffic from the ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.api_container_port
  to_port                      = var.api_container_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  description       = "ECR, CloudWatch Logs, SSM, S3 gateway endpoint and later the Base Sepolia RPC"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "api_dns_udp" {
  security_group_id = aws_security_group.api.id
  description       = "VPC resolver for Cloud Map lookups"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "api_dns_tcp" {
  security_group_id = aws_security_group.api.id
  description       = "VPC resolver for Cloud Map lookups (TCP fallback)"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "api_to_ai" {
  security_group_id            = aws_security_group.api.id
  description                  = "Internal AI service over the Cloud Map name"
  ip_protocol                  = "tcp"
  from_port                    = var.ai_container_port
  to_port                      = var.ai_container_port
  referenced_security_group_id = aws_security_group.ai.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_rds" {
  security_group_id            = aws_security_group.api.id
  description                  = "PostgreSQL"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.rds.id
}

# --- AI --------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "ai_from_api" {
  security_group_id            = aws_security_group.ai.id
  description                  = "Only the API may call /v1/*; the internal JWT stays as defence in depth"
  ip_protocol                  = "tcp"
  from_port                    = var.ai_container_port
  to_port                      = var.ai_container_port
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_egress_rule" "ai_https" {
  security_group_id = aws_security_group.ai.id
  description       = "ECR, CloudWatch Logs, SSM and the external AI provider"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "ai_dns_udp" {
  security_group_id = aws_security_group.ai.id
  description       = "VPC resolver"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "ai_dns_tcp" {
  security_group_id = aws_security_group.ai.id
  description       = "VPC resolver (TCP fallback)"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

# --- RDS -------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "rds_from_api" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from the API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_migrator" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from the one-off migrator task"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.migrator.id
}

# --- migrator / ops --------------------------------------------------------

resource "aws_vpc_security_group_egress_rule" "migrator_https" {
  security_group_id = aws_security_group.migrator.id
  description       = "ECR, CloudWatch Logs, SSM and Secrets Manager"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "migrator_dns_udp" {
  security_group_id = aws_security_group.migrator.id
  description       = "VPC resolver"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "migrator_dns_tcp" {
  security_group_id = aws_security_group.migrator.id
  description       = "VPC resolver (TCP fallback)"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}
resource "aws_vpc_security_group_egress_rule" "migrator_to_rds" {
  security_group_id            = aws_security_group.migrator.id
  description                  = "PostgreSQL for prisma migrate deploy"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.rds.id
}