from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Annotated, Literal, Mapping

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


INTERNAL_JWT_ALGORITHM = "HS256"
INTERNAL_JWT_SUBJECT = "traza-api"
DEFAULT_CLOCK_SKEW_SECONDS = 30
MAX_CLOCK_SKEW_SECONDS = 300


@dataclass(frozen=True)
class InternalAuthSettings:
    mode: Literal["disabled", "jwt"]
    secret: str | None = None
    issuer: str | None = None
    audience: str | None = None
    clock_skew_seconds: int = DEFAULT_CLOCK_SKEW_SECONDS


def load_internal_auth_settings(
    environment: Mapping[str, str] | None = None,
) -> InternalAuthSettings:
    env = environment if environment is not None else os.environ
    mode = env.get("AI_INTERNAL_AUTH_MODE", "disabled").strip().lower()
    clock_skew_seconds = _read_clock_skew(env)

    if mode == "disabled":
        return InternalAuthSettings(
            mode="disabled",
            clock_skew_seconds=clock_skew_seconds,
        )
    if mode != "jwt":
        raise RuntimeError("AI_INTERNAL_AUTH_MODE must be disabled or jwt")

    secret = _required(env, "AI_INTERNAL_JWT_SECRET")
    issuer = _required(env, "AI_INTERNAL_JWT_ISSUER")
    audience = _required(env, "AI_INTERNAL_JWT_AUDIENCE")
    user_jwt_secret = env.get("JWT_SECRET", "").strip()
    if user_jwt_secret and secret == user_jwt_secret:
        raise RuntimeError(
            "AI_INTERNAL_JWT_SECRET must be different from JWT_SECRET"
        )

    return InternalAuthSettings(
        mode="jwt",
        secret=secret,
        issuer=issuer,
        audience=audience,
        clock_skew_seconds=clock_skew_seconds,
    )


bearer_scheme = HTTPBearer(auto_error=False)


def require_internal_service(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> None:
    settings: InternalAuthSettings = request.app.state.internal_auth_settings
    if settings.mode == "disabled":
        return

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Internal service credential required.")

    try:
        header = jwt.get_unverified_header(credentials.credentials)
        if header.get("alg") != INTERNAL_JWT_ALGORITHM:
            raise jwt.InvalidAlgorithmError("unexpected algorithm")

        payload = jwt.decode(
            credentials.credentials,
            settings.secret,
            algorithms=[INTERNAL_JWT_ALGORITHM],
            audience=settings.audience,
            issuer=settings.issuer,
            leeway=settings.clock_skew_seconds,
            options={
                "require": ["iss", "aud", "sub", "iat", "exp", "jti"],
            },
        )
        if payload.get("sub") != INTERNAL_JWT_SUBJECT:
            raise jwt.InvalidTokenError("unexpected subject")
        if not isinstance(payload.get("jti"), str) or not payload["jti"].strip():
            raise jwt.InvalidTokenError("invalid jti")
    except jwt.PyJWTError as exc:
        raise _unauthorized("Invalid internal service credential.") from exc


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required in jwt mode")
    return value


def _read_clock_skew(environment: Mapping[str, str]) -> int:
    raw_value = environment.get(
        "AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS",
        str(DEFAULT_CLOCK_SKEW_SECONDS),
    ).strip()
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(
            "AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS must be an integer between 0 and 300"
        ) from exc

    if not 0 <= value <= MAX_CLOCK_SKEW_SECONDS:
        raise RuntimeError(
            "AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS must be an integer between 0 and 300"
        )
    return value


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )
