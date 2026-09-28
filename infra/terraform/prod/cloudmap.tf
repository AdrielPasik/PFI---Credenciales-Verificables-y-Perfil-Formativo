# ---------------------------------------------------------------------------
# Service discovery
#
# Plain Cloud Map DNS, not ECS Service Connect. Both are technically capable of
# carrying this traffic: Service Connect's per-request timeout and retry policy
# are configurable, so its defaults are a tuning matter, not an incompatibility.
# The choice is deliberate and final for the PFI:
#
#   - fewer moving parts in the request path (no Envoy sidecar to reason about,
#     size, log or debug);
#   - less configuration surface, therefore less that can silently diverge from
#     what the defence demonstrates;
#   - sufficient for a single API replica calling a single AI replica.
#
# The API resolves ai.scope.internal to the task's private IP and talks plain HTTP
# inside the VPC, still authenticated with the internal HS256 JWT.
#
# Cost note: a private DNS namespace creates a Route 53 private hosted zone
# (USD 0.50/month) plus USD 0.10 per registered instance per month.
# ---------------------------------------------------------------------------

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "scope.internal"
  description = "Private service discovery for Scope internal services"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "ai" {
  name = "ai"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"

    dns_records {
      type = "A"
      # Short TTL so a task replacement is picked up quickly by the API's
      # connection pool without needing a redeploy of the API.
      ttl = 10
    }
  }

  # Required for ECS-managed registration/deregistration of awsvpc tasks.
}
