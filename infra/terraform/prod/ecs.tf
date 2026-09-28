# ---------------------------------------------------------------------------
# ECS on Fargate
#
# Task definitions are created unconditionally: they cost nothing, run nothing,
# and they are the reviewable contract between the infrastructure and the two
# services (ports, secrets, log groups, roles, stop timeout).
#
# The SERVICES are gated behind enable_services (false in this slice), so the
# first apply starts no task, pulls no image and allocates no task public IPv4.
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    # Container Insights is billed per metric. Free ECS/ALB service metrics plus
    # CloudWatch Logs are enough for this deployment.
    name  = "containerInsights"
    value = "disabled"
  }

  tags = {
    Name = "${local.name_prefix}-cluster"
  }
}

# --- API task definition ---------------------------------------------------

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.api_task_cpu)
  memory                   = tostring(var.api_task_memory)
  execution_role_arn       = aws_iam_role.execution["api"].arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.task_cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name        = "api"
      image       = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential   = true
      stopTimeout = 120

      portMappings = [
        {
          containerPort = var.api_container_port
          hostPort      = var.api_container_port
          protocol      = "tcp"
        },
      ]

      environment = [
        for name, value in local.api_environment : {
          name  = name
          value = value
        }
      ]

      secrets = [
        for name, parameter in local.api_container_secrets : {
          name      = name
          valueFrom = "${local.ssm_parameter_arn_prefix}${parameter}"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    },
  ])

  tags = {
    Component = "api"
  }
}

# --- AI task definition ----------------------------------------------------

resource "aws_ecs_task_definition" "ai" {
  family                   = "${local.name_prefix}-ai"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ai_task_cpu)
  memory                   = tostring(var.ai_task_memory)
  execution_role_arn       = aws_iam_role.execution["ai"].arn
  task_role_arn            = aws_iam_role.ai_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.task_cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name        = "ai"
      image       = "${aws_ecr_repository.ai.repository_url}:${var.ai_image_tag}"
      essential   = true
      stopTimeout = 120

      portMappings = [
        {
          containerPort = var.ai_container_port
          hostPort      = var.ai_container_port
          protocol      = "tcp"
        },
      ]

      environment = [
        for name, value in local.ai_environment : {
          name  = name
          value = value
        }
      ]

      secrets = [
        for name, parameter in local.ai_container_secrets : {
          name      = name
          valueFrom = "${local.ssm_parameter_arn_prefix}${parameter}"
        }
      ]

      # There is no load balancer in front of this service, so the container health
      # check is the only liveness signal. The image has no curl, so the check uses
      # the interpreter that is already there.
      healthCheck = {
        command     = ["CMD-SHELL", "python -c 'import urllib.request,sys; sys.exit(0 if urllib.request.urlopen(\"http://127.0.0.1:${var.ai_container_port}/health\", timeout=3).status == 200 else 1)'"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ai.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    },
  ])

  tags = {
    Component = "ai"
  }
}

# --- migrator task definition ----------------------------------------------
#
# Run on demand with `aws ecs run-task`, never as a service. It reuses the API
# image, which must therefore ship the Prisma CLI and prisma/migrations.
#
# This is the ONLY workload that uses the RDS master identity, because it is the
# only one that needs DDL authority. The NestJS service connects as scope_app,
# a dedicated role with no schema privileges (bootstrap SQL in ../sql/).
#
# The connection is direct and unpooled: Prisma Migrate must not run through a
# transaction pooler.
resource "aws_ecs_task_definition" "migrator" {
  family                   = "${local.name_prefix}-migrator"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution["migrator"].arn
  task_role_arn            = aws_iam_role.migrator_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.task_cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = "migrator"
      image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential = true

      # `sh -c <script>` overrides whatever ENTRYPOINT the API image declares, so
      # the connection string is assembled in the container and nowhere else.
      entryPoint  = ["sh", "-c"]
      command     = [local.migrator_bootstrap_script]
      stopTimeout = 120

      # The RDS master password, read straight from the secret that RDS owns.
      # ":password::" selects that single JSON key; no other field is exposed, and
      # the value is never copied into SSM Parameter Store.
      secrets = local.rds_master_secret_arn != "" ? [
        {
          name      = "RDS_MASTER_PASSWORD"
          valueFrom = "${local.rds_master_secret_arn}:password::"
        },
      ] : []

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrator.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    },
  ])

  tags = {
    Component = "migrator"
  }
}

# --- services (gated) ------------------------------------------------------

resource "aws_ecs_service" "api" {
  count = var.enable_services ? 1 : 0

  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count

  launch_type      = "FARGATE"
  platform_version = "LATEST"

  enable_execute_command = var.enable_ecs_exec
  propagate_tags         = "SERVICE"

  # Long enough for Nest bootstrap plus the first ALB health checks.
  health_check_grace_period_seconds = 120

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_container_port
  }

  lifecycle {
    precondition {
      # ECS refuses a load-balanced service whose target group is not attached to a
      # listener, and the placeholder listener returns a fixed response instead of
      # forwarding. So HTTPS must be live before the service is enabled.
      condition     = var.enable_https_listener
      error_message = "enable_services requires enable_https_listener: the target group must be attached to a real listener first."
    }
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "ai" {
  count = var.enable_services ? 1 : 0

  name            = "${local.name_prefix}-ai"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ai.arn
  desired_count   = var.ai_desired_count

  launch_type      = "FARGATE"
  platform_version = "LATEST"

  enable_execute_command = var.enable_ecs_exec
  propagate_tags         = "SERVICE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets = aws_subnet.public[*].id
    # Public IP is for EGRESS to the AI provider only; the security group admits
    # inbound traffic solely from the API and ops security groups.
    security_groups  = [aws_security_group.ai.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.ai.arn
  }
}
