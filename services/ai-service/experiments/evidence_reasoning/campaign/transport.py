from __future__ import annotations

"""Frozen transport-failure taxonomy.

A retry is eligible ONLY when no usable semantic response exists AND the failure
belongs to the pre-declared transport taxonomy below. A fully received response
whose content is malformed, schema-invalid, refused or simply wrong is a semantic
observation: it is never retried.
"""

import http.client
import socket
import ssl
import urllib.error

# Pre-frozen eligible categories. Nothing may be added during a live campaign.
ELIGIBLE_TRANSPORT_CATEGORIES = (
    "CONNECT_TIMEOUT",
    "READ_TIMEOUT",
    "CONNECTION_RESET",
    "PREMATURE_EOF",
    "SOCKET_INTERRUPTION",
    "TLS_INTERRUPTION",
    "HTTP_502_NO_SEMANTIC_RESPONSE",
    "HTTP_503_NO_SEMANTIC_RESPONSE",
    "HTTP_504_NO_SEMANTIC_RESPONSE",
)

NON_RECOVERABLE_CATEGORIES = (
    "HTTP_4XX_NO_RETRY",
    "AUTHENTICATION_OR_QUOTA",
    "SEMANTIC_RESPONSE_RECEIVED",
    "MODEL_MALFORMED_OUTPUT",
    "SCHEMA_INVALID_OUTPUT",
    "UNCLASSIFIED",
)

_HTTP_ELIGIBLE = {502: "HTTP_502_NO_SEMANTIC_RESPONSE",
                  503: "HTTP_503_NO_SEMANTIC_RESPONSE",
                  504: "HTTP_504_NO_SEMANTIC_RESPONSE"}


class Classification:
    __slots__ = ("category", "eligible", "detail")

    def __init__(self, category: str, eligible: bool, detail: str):
        self.category = category
        self.eligible = eligible
        self.detail = detail

    def as_dict(self) -> dict[str, object]:
        return {"category": self.category, "eligible": self.eligible, "detail": self.detail}


def _http_status(text: str) -> int | None:
    # ProviderResponseError messages are formatted "provider_http_<code>:<body>".
    if "provider_http_" in text:
        digits = text.split("provider_http_", 1)[1][:3]
        if digits.isdigit():
            return int(digits)
    return None


def classify(error: BaseException, *, semantic_response_available: bool) -> Classification:
    """Classify a failed provider attempt.

    `semantic_response_available` must be True whenever usable semantic bytes were
    already durably captured. In that case no retry is ever eligible.
    """
    if semantic_response_available:
        return Classification("SEMANTIC_RESPONSE_RECEIVED", False, "usable semantic bytes already durable")

    text = str(error)
    name = type(error).__name__

    status = _http_status(text)
    if status is not None:
        if status in _HTTP_ELIGIBLE:
            return Classification(_HTTP_ELIGIBLE[status], True, f"http {status} without semantic response")
        if status in (401, 403):
            return Classification("AUTHENTICATION_OR_QUOTA", False, f"http {status}")
        if status == 429:
            return Classification("AUTHENTICATION_OR_QUOTA", False, "http 429 quota/rate not pre-authorized")
        if 400 <= status < 500:
            return Classification("HTTP_4XX_NO_RETRY", False, f"http {status}")

    if "output_not_json" in text or "missing_output_text" in text or "missing_text" in text:
        return Classification("MODEL_MALFORMED_OUTPUT", False, "provider completed; model content unusable")
    if text.startswith("invalid_") and "_schema" in text:
        return Classification("SCHEMA_INVALID_OUTPUT", False, "fully received schema-invalid output")

    if isinstance(error, socket.timeout) or name == "TimeoutError" or "timed out" in text.lower():
        category = "CONNECT_TIMEOUT" if "connect" in text.lower() else "READ_TIMEOUT"
        return Classification(category, True, name)
    if isinstance(error, ConnectionResetError) or "connection reset" in text.lower():
        return Classification("CONNECTION_RESET", True, name)
    if isinstance(error, (http.client.IncompleteRead, EOFError)) or "incomplete" in text.lower() or "premature" in text.lower():
        return Classification("PREMATURE_EOF", True, name)
    if isinstance(error, ssl.SSLError):
        return Classification("TLS_INTERRUPTION", True, name)
    if isinstance(error, (ConnectionError, urllib.error.URLError, OSError)):
        return Classification("SOCKET_INTERRUPTION", True, name)

    return Classification("UNCLASSIFIED", False, f"{name}: {text[:200]}")
