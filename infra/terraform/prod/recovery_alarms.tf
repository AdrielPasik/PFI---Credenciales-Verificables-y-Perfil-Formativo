# ---------------------------------------------------------------------------
# Password-recovery alarms - PREPARED, OFF BY DEFAULT
#
# enable_recovery_alarms = false (default) creates NOTHING here: for_each over an
# empty map. Nothing in this file runs, costs or notifies until a person decides who
# receives the notifications (recovery_alarm_action_arns) and turns it on.
#
# WHAT THEY DO AND DO NOT DO. An alarm DETECTS a signal that the API already writes to
# its log and lets someone react. It does not stop an attacker from exhausting the
# global cap or an account quota - the public response is the same 202 either way, so
# these log lines are the only place an operator can see it happening. Prevention is a
# separate question (see runbooks/password-recovery.md, section 10).
#
# THE SIGNALS are the fixed strings of services/api/src/auth/password-reset and
# services/api/src/mail (Nest text logger, no JSON, no personal data in them):
#
#   global_cap         request.dropped (global_cap)      80 reservations / 24h exhausted
#   account_quota      request.dropped (account_quota)   3 per account / hour exhausted
#   transport_failure  email.failed | email.ambiguous | resend.rejected
#   dropped_jobs       dropped (shutting down) | dropped (too many in flight)
#   internal_failure   request.failed | confirm.failed | token.invalidate_failed
#                      An internal error (typically the database: a missing grant on
#                      "PasswordResetToken", a connection problem) AFTER the 202 was
#                      already returned. The caller sees success and no email; this
#                      line is the only trace.
#   not_configured     recovery.unavailable | mail.config_invalid
#                      ONLY with mail_transport = "resend": while the feature is
#                      deliberately "disabled" every attempt logs recovery.unavailable,
#                      and alarming on the safe initial state would be noise.
#
# A metric filter only sees events written AFTER it exists, and matches the literal
# text; if the log wording in the API changes, the filter silently stops matching.
# The matching test in tests/password_recovery.tftest.hcl pins the patterns, and the
# runbook lists the strings so a code change can be checked against them.
# ---------------------------------------------------------------------------

locals {
  recovery_alarm_definitions = merge(
    {
      global_cap = {
        pattern     = "\"request.dropped (global_cap)\""
        period      = 300
        threshold   = 1
        description = "The global password-recovery cap (80 reservations per 24h) was reached: other account holders may be unable to recover until the window moves. Could be organic load or abuse."
      }
      account_quota = {
        pattern     = "\"request.dropped (account_quota)\""
        period      = 3600
        threshold   = 5
        description = "Five or more per-account recovery quotas were exhausted within an hour. One is normal (a person retrying); several suggest someone is consuming other people's recovery budget."
      }
      transport_failure = {
        pattern     = "?\"email.failed\" ?\"email.ambiguous\" ?\"resend.rejected\""
        period      = 900
        threshold   = 3
        description = "Recovery emails are failing or are ambiguous at the provider. Check the sender domain, the Resend API key and the Resend status page. Requests still answer 202."
      }
      internal_failure = {
        pattern     = "?\"request.failed\" ?\"confirm.failed\" ?\"token.invalidate_failed\""
        period      = 300
        threshold   = 1
        description = "An internal error occurred while processing a password-recovery request or confirmation (database permission or connectivity are the usual causes). Requests may have answered 202 or 5xx without any email being sent."
      }
      dropped_jobs = {
        pattern     = "?\"dropped (shutting down)\" ?\"dropped (too many in flight)\""
        period      = 900
        threshold   = 1
        description = "A recovery email job was discarded (task shutting down or in-flight limit). Delivery is best-effort: the person received 202 and no email."
      }
    },
    var.mail_transport == "resend" ? {
      not_configured = {
        pattern     = "?\"recovery.unavailable\" ?\"mail.config_invalid\""
        period      = 300
        threshold   = 1
        description = "The API is configured for Resend but recovery is unavailable or the mail configuration is invalid (MAIL_FROM, RESEND_API_KEY or WEB_PUBLIC_BASE_URL). Requests answer 503."
      }
    } : {}
  )

  active_recovery_alarms = var.enable_recovery_alarms ? local.recovery_alarm_definitions : {}
}

resource "aws_cloudwatch_log_metric_filter" "recovery" {
  for_each = local.active_recovery_alarms

  name           = "${local.name_prefix}-recovery-${each.key}"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = each.value.pattern

  metric_transformation {
    name      = "recovery_${each.key}"
    namespace = "Scope/${var.environment}/PasswordRecovery"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "recovery" {
  for_each = local.active_recovery_alarms

  alarm_name        = "${local.name_prefix}-recovery-${each.key}"
  alarm_description = each.value.description

  namespace           = "Scope/${var.environment}/PasswordRecovery"
  metric_name         = "recovery_${each.key}"
  statistic           = "Sum"
  period              = each.value.period
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"

  # No events at all is the healthy state, not a missing-data problem.
  treat_missing_data = "notBreaching"

  alarm_actions = var.recovery_alarm_action_arns
  ok_actions    = var.recovery_alarm_action_arns

  depends_on = [aws_cloudwatch_log_metric_filter.recovery]
}
