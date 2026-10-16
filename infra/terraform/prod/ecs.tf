# ---------------------------------------------------------------------------
# ECS on Fargate
#
# Task definitions are created unconditionally: they cost nothing, run nothing,
# and they are the reviewable contract between the infrastructure and the two
# services (ports, secrets, log groups, roles, stop timeout).
#
# Service-resource existence is controlled separately from task capacity.
# `enable_services` only controls desired_count, so stopping workloads does not
# delete ECS services or their Cloud Map registration.
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

      # Cloud Map receives ECS container health. `/health` remains a cheap
      # diagnostic liveness endpoint; `/ready` gates discovery traffic until an
      # enabled embedding runtime has completed its local prewarm.
      healthCheck = {
        command  = ["CMD-SHELL", "python -c 'import urllib.request,sys; sys.exit(0 if urllib.request.urlopen(\"http://127.0.0.1:${var.ai_container_port}/ready\", timeout=3).status == 200 else 1)'"]
        interval = 30
        timeout  = 5
        retries  = 3
        # Provisional: the frozen E5 local cold initialization reached ~38 s.
        # Final value requires measurement in the deployed Fargate task.
        startPeriod = 120
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
# image repository, which must therefore ship the Prisma CLI and
# prisma/migrations. Its TAG is selected independently through
# var.migrator_image_tag; it never falls back to var.api_image_tag.
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
      image     = "${aws_ecr_repository.api.repository_url}:${var.migrator_image_tag}"
      essential = true

      # The API image ships a dedicated migrator entrypoint that assembles the
      # administrative connection in memory and then execs the requested command.
      entryPoint  = ["/app/services/api/docker/migrator-entrypoint.sh"]
      command     = var.migrator_command
      stopTimeout = 120

      environment = [
        {
          name  = "RDS_ADDRESS"
          value = local.rds_address
        },
        {
          name  = "RDS_MASTER_USERNAME"
          value = var.rds_master_username
        },
        {
          name  = "RDS_DATABASE_NAME"
          value = var.rds_database_name
        },
      ]

      # The RDS master password, read straight from the secret that RDS owns.
      # ":password::" selects that single JSON key; no other field is exposed, and
      # the value is never copied into SSM Parameter Store.
      secrets = concat(
        local.rds_master_secret_arn != "" ? [
          {
            name      = "RDS_MASTER_PASSWORD"
            valueFrom = "${local.rds_master_secret_arn}:password::"
          },
        ] : [],
        [
          {
            name      = "SCOPE_APP_DATABASE_URL"
            valueFrom = "${local.ssm_parameter_arn_prefix}${local.api_secret_parameters.DATABASE_URL}"
          },
        ]
      )

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

# --- issuer provisioner task definition (S8c11.4b) ---------------------------
#
# One-off task, run on demand with `aws ecs run-task`. There is deliberately NO
# aws_ecs_service, scheduler or trigger for it, and no always-on capacity.
#
# It reuses the API image repository but is referenced by CONTENT:
# repository@var.provisioner_image_digest (sha256:<64 hex>), selected independently
# of the API and the migrator and never falling back to a tag. The digest is an
# explicit, reviewed input; Terraform does not look it up (no ECR data source).
# The image must contain services/api/docker/provisioner-entrypoint.sh.
# PROVISIONER_IMAGE_REFERENCE_MODE = DIGEST_ONLY. This does not prove artifact
# integrity (PROVISIONER_ARTIFACT_INTEGRITY = NOT_YET_PROVEN): no release digest has
# been selected, verified or applied.
#
# The fixed entryPoint is the S8c11.4a execution gate, which accepts exactly one
# operation (`provision --issuer <uuid> --types <list>`) and delegates to the
# compiled provisioning CLI. The default command below is deliberately invalid, so
# starting this task without an explicit command fails closed.
#
# RunTask can override `command` and container `environment`. Security must NOT
# depend on `command`: the allowed surface lives in the fixed entryPoint. The
# entrypoint cannot prove where DATABASE_URL, AWS_REGION, PUBLIC_DID_BASE_URL, PATH
# or any other variable came from, so who may start this task and with which
# overrides is NOT resolved here: ENVIRONMENT_OVERRIDE_AUTHORIZATION_NOT_YET_RESOLVED.
# The current GitHub deploy role is not granted RunTask or PassRole authority over
# the provisioner (see github_oidc.tf). Provisioner invocation authorization is not
# implemented here.
#
# Database identity: the same scope_app runtime credential the API uses, injected
# as an ECS secret. Never the RDS master secret the migrator holds.
#
# For a future RunTask: cluster aws_ecs_cluster.main, subnets aws_subnet.public[*],
# security group aws_security_group.provisioner, assignPublicIp ENABLED (public
# subnets, no NAT: the public IP is egress only).
resource "aws_ecs_task_definition" "provisioner" {
  family                   = "${local.name_prefix}-provisioner"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.provisioner_execution.arn
  task_role_arn            = aws_iam_role.provisioner_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.task_cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = "provisioner"
      image     = "${aws_ecr_repository.api.repository_url}@${var.provisioner_image_digest}"
      essential = true

      entryPoint  = ["/bin/sh", "/app/services/api/docker/provisioner-entrypoint.sh"]
      command     = ["disabled"]
      stopTimeout = 120

      # Public configuration only. The signer secret namespace is forced inside the
      # entrypoint and is intentionally not configurable here.
      environment = [
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "PUBLIC_DID_BASE_URL"
          value = var.public_did_base_url
        },
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${local.ssm_parameter_arn_prefix}${local.api_secret_parameters.DATABASE_URL}"
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.provisioner.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    },
  ])

  tags = {
    Component = "provisioner"
  }
}

# --- services (managed independently from capacity) ------------------------

resource "aws_ecs_service" "api" {
  # Preserve the [0] identity independently of task capacity and listener
  # toggles. The precondition below still requires HTTPS when this
  # load-balanced service is managed.
  count = var.manage_ecs_services ? 1 : 0

  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.enable_services ? var.api_desired_count : 0

  launch_type      = "FARGATE"
  platform_version = "LATEST"

  enable_execute_command = var.enable_ecs_exec
  propagate_tags         = "SERVICE"

  # Long enough for Nest bootstrap plus the first ALB health checks.
  health_check_grace_period_seconds = 120

  # Prevent rolling overlap of API tasks. Blockchain nonce coordination is
  # process-local, so with desired_count=1 the service deliberately stops the old
  # task before starting the replacement. This trades rolling availability for no
  # ECS-managed old/new overlap; it does not coordinate any other writer.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

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
      error_message = "manage_ecs_services requires enable_https_listener: the target group must be attached to a real listener first."
    }
  }

  # S8: ORDEN DE ARRANQUE DE SECRETOS. La task definition referencia parametros SSM
  # por ARN (cadenas, no recursos), asi que Terraform no infiere dependencia alguna.
  # Sin esto, un mismo apply puede lanzar tareas nuevas ANTES de que existan los
  # parametros que referencian (p. ej. los CREDENTIAL_REGISTRY_* nuevos) o antes de
  # que el rol de ejecucion tenga permiso de leerlos. El servicio espera a ambos.
  # NO resuelve el RPC SecureString: lo crea el operador fuera de banda y Terraform
  # no puede leerlo sin copiar el secreto al estado (ver el runbook de activacion).
  depends_on = [
    aws_lb_listener.https,
    aws_ssm_parameter.managed_strings,
    aws_iam_role_policy.execution,
  ]
}

resource "aws_ecs_service" "ai" {
  # Keep the Cloud Map-backed AI service managed independently of both task
  # capacity and listener lifecycle.
  count = var.manage_ecs_services ? 1 : 0

  name            = "${local.name_prefix}-ai"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ai.arn
  desired_count   = var.enable_services ? var.ai_desired_count : 0

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
