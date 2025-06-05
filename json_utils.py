"""Utilities for JSON serialization."""

from collections import deque
from typing import Any


def convert_deques(obj: Any) -> Any:
    """Recursively convert :class:`collections.deque` instances to lists."""
    if isinstance(obj, deque):
        return list(obj)
    if isinstance(obj, dict):
        return {k: convert_deques(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_deques(v) for v in obj]
    return obj

__all__ = ["convert_deques"]
