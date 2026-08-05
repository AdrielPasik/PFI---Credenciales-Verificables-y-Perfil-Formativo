from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FormativeProfileBuildRequest(BaseModel):
    """Request envelope for the versioned profile builder."""

    model_config = ConfigDict(extra="forbid")

    artifacts: list[dict[str, Any]] = Field(min_length=1)

