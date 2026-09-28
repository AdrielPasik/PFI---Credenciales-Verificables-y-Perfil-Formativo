# MANDATORY SECOND STEP — inactive only until the bucket exists. Terraform ignores
# this file because of the .disabled extension.
#
# The bootstrap root is applied once with a LOCAL state file, because the bucket
# cannot be its own backend before it exists. As soon as the bucket is created,
# that local file becomes the only authoritative record of a resource protected by
# prevent_destroy. Losing it (disk failure, a clean clone, a reformatted laptop)
# means Terraform no longer knows the bucket exists and the next apply fails on a
# name that is already taken.
#
# So the migration is NOT optional. Immediately after the first apply:
#
#   mv backend.tf.disabled backend.tf
#   terraform init -migrate-state -backend-config=../prod/backend.hcl
#   # answer "yes" when asked to copy the existing state
#   terraform plan            # must report "No changes"
#
# After that the bootstrap state lives in the bucket it created, under its own
# key, versioned, and the recovery path for a lost local copy is object
# versioning. Delete the leftover terraform.tfstate.backup only once the plan
# above is clean.
terraform {
  backend "s3" {
    key          = "envs/bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
