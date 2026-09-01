"""B2.4.1 Full Development re-execution — frozen execution protocol.

This subpackage contains ONLY execution machinery: checkpointing, resume,
transport-failure classification, the provider-attempt ledger, evaluation,
adjudication, reporting and integrity checking.

It contains no semantic behaviour. Every semantic function is imported
unchanged from the frozen B2.4.1 / B2.4 modules, so the B2.4.1 behaviour
fingerprint is unaffected by anything in here. This package is covered by a
separate EXECUTION PROTOCOL FINGERPRINT.
"""
