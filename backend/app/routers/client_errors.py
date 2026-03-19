"""Client-side error reporting endpoint.

Stores up to MAX_ERRORS entries in SQLite; auto-prunes oldest when full.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends

from app.db import get_db
from app.models import ClientErrorCreate

MAX_ERRORS = 1000
_log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/client-errors", status_code=201)
async def post_client_error(
    payload: ClientErrorCreate,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Accept a JS error report from the browser and store it."""
    now = time.time()

    await db.execute(
        """
        INSERT INTO client_errors (message, source, lineno, colno, stack, url, ts)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.message,
            payload.source,
            payload.lineno,
            payload.colno,
            payload.stack,
            payload.url,
            now,
        ),
    )
    await db.commit()

    # Prune oldest rows beyond MAX_ERRORS cap
    await db.execute(
        """
        DELETE FROM client_errors
        WHERE id NOT IN (
            SELECT id FROM client_errors ORDER BY ts DESC LIMIT ?
        )
        """,
        (MAX_ERRORS,),
    )
    await db.commit()

    _log.debug("Client error stored: %s", payload.message)
    return {"ok": True}
