"""B2.4.1 Holdout — frozen execution protocol for the generalization campaign.

Like `campaign/`, this subpackage contains ONLY execution machinery. It contains
no semantic behaviour: every semantic function reaches it unchanged from the
frozen B2.4.1 / B2.4 modules, so the B2.4.1 BEHAVIOR FINGERPRINT is unaffected
by anything in here.

Two deliberate reuse decisions:

1. The Development `campaign/` package is NEVER modified. Its files are hashed
   inside the closed Development freeze manifest; editing one would permanently
   destroy the ability to re-verify that finished campaign. Everything shared is
   imported from it, never copied and never patched.

2. The transport classifier, the durable-response-first logical-call executor and
   the whole per-stage semantic body are *imported* from `campaign`, not
   re-implemented. Only campaign identity, case selection and budgets are
   parameterized here. That is what "EXECUTION_ONLY change" means in practice.

This package carries its own HOLDOUT EXECUTION PROTOCOL FINGERPRINT.
"""
