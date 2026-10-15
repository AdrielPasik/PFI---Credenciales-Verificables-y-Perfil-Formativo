# Durable, non-secret desired state for the isolated ECS sync probe.
# This file is intentionally versioned and auto-loaded by Terraform from the
# production root. The GitHub OIDC caller remains a separate opt-in.
enable_ecs_sync_probe                    = true
enable_ecs_sync_probe_github_oidc_caller = false
ecs_sync_probe_image_digest              = "sha256:aabb9b3380d56ec8053082e8c41a6bd72a595c4559bb5032f7c7da3ee0c7c02b"
