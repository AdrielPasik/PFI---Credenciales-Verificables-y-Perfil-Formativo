output "state_bucket_name" {
  description = "Name of the dedicated Terraform state bucket. Feed this into infra/terraform/prod/backend.hcl."
  value       = aws_s3_bucket.tfstate.id
}

output "state_bucket_arn" {
  description = "ARN of the Terraform state bucket."
  value       = aws_s3_bucket.tfstate.arn
}

output "prod_backend_hcl" {
  description = "Exact content for infra/terraform/prod/backend.hcl (gitignored). No secrets."
  value       = <<-EOT
    bucket = "${aws_s3_bucket.tfstate.id}"
  EOT
}
