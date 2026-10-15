variable "enable_ecs_sync_probe" {
  description = "Creates the isolated ECS sync integration probe infrastructure. The GitHub OIDC caller remains separately disabled by default."
  type        = bool
  default     = false
}

variable "enable_ecs_sync_probe_github_oidc_caller" {
  description = "Creates the dedicated GitHub OIDC caller for the isolated probe only after its separate authorization and review."
  type        = bool
  default     = false
}
variable "ecs_sync_probe_image_digest" {
  description = "Immutable sha256 digest for the isolated nonpersistent probe image. Required only when enable_ecs_sync_probe is true."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.ecs_sync_probe_image_digest == null || can(regex("^sha256:[0-9a-f]{64}$", var.ecs_sync_probe_image_digest))
    error_message = "ecs_sync_probe_image_digest must be a lowercase sha256 digest."
  }
}

variable "github_oidc_repository_id" {
  description = "Immutable GitHub repository numeric ID required for the dedicated probe caller trust policy."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.github_oidc_repository_id == null || can(regex("^[0-9]+$", var.github_oidc_repository_id))
    error_message = "github_oidc_repository_id must be a decimal GitHub repository ID."
  }
}

variable "github_oidc_repository_owner_id" {
  description = "Immutable GitHub owner numeric ID required for the dedicated probe caller trust policy."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.github_oidc_repository_owner_id == null || can(regex("^[0-9]+$", var.github_oidc_repository_owner_id))
    error_message = "github_oidc_repository_owner_id must be a decimal GitHub owner ID."
  }
}
