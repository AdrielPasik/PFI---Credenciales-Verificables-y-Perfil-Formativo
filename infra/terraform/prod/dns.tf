# ---------------------------------------------------------------------------
# DNS
#
# No hosted zone is created here. Whether scopeedu.technology is still served by
# the registrar's nameservers or already delegated to Route 53 is EXTERNAL STATE
# that the repository cannot prove, and creating a zone blindly would produce a
# second, authoritative-looking zone that answers nothing.
#
# This slice therefore only prepares the inputs and outputs needed later:
#
#   * with external DNS (registrar): create a CNAME api -> <alb_dns_name>.
#     A CNAME is enough for the ALB; no alias record is required.
#   * with Route 53: set route53_zone_id and create_api_dns_record to let the
#     alias record below be managed here.
#
# Nothing points at the new ALB until that decision is made, so Vercel keeps
# talking to the current backend and no traffic moves in this slice.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "api" {
  count = var.create_api_dns_record ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.api_hostname
  type    = "A"

  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = false
  }

  lifecycle {
    precondition {
      condition     = var.route53_zone_id != ""
      error_message = "create_api_dns_record requires route53_zone_id. With registrar-hosted DNS, create a CNAME to the alb_dns_name output instead."
    }
  }
}
