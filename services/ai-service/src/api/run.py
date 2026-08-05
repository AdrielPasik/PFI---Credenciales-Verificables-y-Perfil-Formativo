from __future__ import annotations

import os

import uvicorn


DEFAULT_PORT = 8000


def read_port() -> int:
    raw_port = os.getenv("PORT", str(DEFAULT_PORT)).strip()
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise RuntimeError("PORT must be an integer between 1 and 65535") from exc

    if not 1 <= port <= 65535:
        raise RuntimeError("PORT must be an integer between 1 and 65535")
    return port


def main() -> None:
    uvicorn.run("src.api.main:app", host="0.0.0.0", port=read_port())


if __name__ == "__main__":
    main()
