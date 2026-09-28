# ---------------------------------------------------------------------------
# Application Load Balancer
#
# The ALB is the only public entry point. Its idle timeout is raised to 1200s
# because the synchronous verification and reasoning endpoints legitimately hold a
# request open for minutes; the ALB default of 60s would sever them. This is an
# infrastructure setting only - no application timeout is touched.
#
# In this slice there is no certificate and therefore no :443 listener. Port 80
# answers a fixed 503 so the foundations are observable without exposing anything.
# ---------------------------------------------------------------------------
locals {
  acm_certificate_arn_from_resource = one(aws_acm_certificate.api[*].arn)
  https_certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : local.acm_certificate_arn_from_resource
}
resource "aws_lb" "api" {
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
  idle_timeout               = var.alb_idle_timeout_seconds
  enable_deletion_protection = var.alb_deletion_protection
  drop_invalid_header_fields = true
  # Access logs stay disabled on purpose: the public share token is part of the
  # request path and must not be persisted to a log bucket.
  tags = {
    Name = "${local.name_prefix}-alb"
  }
}
resource "aws_lb_target_group" "api" {
  name        = "${local.name_prefix}-api-tg"
  port        = var.api_container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  # Long draining window so an in-flight synchronous run can complete before ECS
  # sends SIGTERM during a deployment.
  deregistration_delay = var.alb_deregistration_delay_seconds
  health_check {
    enabled             = true
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = {
    Name = "${local.name_prefix}-api-tg"
  }
}
# Placeholder listener while HTTPS is not configured yet. It never forwards to the
# target group, so no application traffic can arrive over plain HTTP.
resource "aws_lb_listener" "http_placeholder" {
  count = var.enable_https_listener ? 0 : 1
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      status_code  = "503"
      message_body = "scope: foundations only, no listener configured"
    }
  }
}
resource "aws_lb_listener" "http_redirect" {
  count = var.enable_https_listener ? 1 : 0
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}
resource "aws_lb_listener" "https" {
  count = var.enable_https_listener ? 1 : 0
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.https_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  lifecycle {
    precondition {
      condition     = local.https_certificate_arn != null && local.https_certificate_arn != ""
      error_message = "enable_https_listener requires an ISSUED certificate: set acm_certificate_arn, or set request_acm_certificate and validate it first."
    }
  }
}
# ---------------------------------------------------------------------------
# ACM certificate
#
# Not requested in this slice. A DNS-validated request expires after 72 hours if
# the validation record is not published, so it is only created in the same window
# in which the DNS delegation is actually handled.
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "api" {
  count = var.request_acm_certificate ? 1 : 0

  domain_name       = var.api_hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = var.api_hostname
  }
}