"""SQLite database management for persistent data."""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

DB_PATH = Path(os.environ.get("DB_PATH", "/data/deepsea.db"))
MAX_NOTIFICATIONS = int(os.environ.get("MAX_NOTIFICATIONS", "1000"))


async def _configure_connection(db: aiosqlite.Connection) -> None:
    """Apply SQLite pragmas for safer concurrent access."""
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA synchronous=NORMAL")
    await db.execute("PRAGMA busy_timeout=5000")


async def get_db() -> aiosqlite.Connection:
    """Open a database connection (used as a FastAPI dependency)."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await _configure_connection(db)
    try:
        yield db
    finally:
        await db.close()


async def init_db() -> None:
    """Create all tables if they don't exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await _configure_connection(db)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                message TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'system',
                level TEXT NOT NULL DEFAULT 'info',
                timestamp TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                is_block INTEGER NOT NULL DEFAULT 0,
                metadata TEXT NOT NULL DEFAULT '{}'
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS payout_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT,
                date_iso TEXT,
                txid TEXT UNIQUE,
                lightning_txid TEXT,
                amount_btc REAL,
                amount_sats INTEGER,
                fiat_value REAL,
                rate REAL,
                status TEXT DEFAULT 'confirmed'
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS block_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                height INTEGER UNIQUE,
                hash TEXT,
                timestamp TEXT,
                miner_earnings_sats INTEGER,
                pool_fees_percentage REAL,
                tx_count INTEGER,
                fees_btc REAL,
                reward_btc REAL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS metric_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                hashrate_60sec REAL,
                hashrate_10min REAL,
                hashrate_3hr REAL,
                hashrate_24hr REAL,
                workers_hashing INTEGER,
                btc_price REAL,
                daily_mined_sats INTEGER,
                unpaid_earnings REAL
            )
        """)
        # Persists notification engine state across restarts, preventing alert
        # storms and duplicate notifications after a process restart.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS alert_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS client_errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT,
                source TEXT,
                lineno INTEGER,
                colno INTEGER,
                stack TEXT,
                url TEXT,
                ts REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS worker_overrides (
                worker_name TEXT PRIMARY KEY,
                asic_id TEXT,
                efficiency REAL,
                power REAL,
                updated_at REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_metric_history_ts ON metric_history(timestamp)"
        )
        await db.commit()
    logging.info("Database initialized at %s", DB_PATH)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

async def create_notification(
    db: aiosqlite.Connection,
    message: str,
    category: str = "system",
    level: str = "info",
    is_block: bool = False,
    metadata: dict | None = None,
) -> dict:
    nid = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()
    meta_json = json.dumps(metadata or {})
    await db.execute(
        """INSERT INTO notifications (id, message, category, level, timestamp, read, is_block, metadata)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)""",
        (nid, message, category, level, ts, int(is_block), meta_json),
    )

    # Prevent unbounded growth: keep newest MAX_NOTIFICATIONS rows, preferentially
    # pruning oldest non-block notifications first.
    if MAX_NOTIFICATIONS > 0:
        async with db.execute("SELECT COUNT(*) AS cnt FROM notifications") as cur:
            row = await cur.fetchone()
        total = int(row["cnt"]) if row else 0
        overflow = total - MAX_NOTIFICATIONS
        if overflow > 0:
            async with db.execute(
                """SELECT id FROM notifications
                   WHERE is_block = 0
                   ORDER BY timestamp ASC
                   LIMIT ?""",
                (overflow,),
            ) as cur:
                prune_rows = await cur.fetchall()
            prune_ids = [r["id"] for r in prune_rows]
            if prune_ids:
                placeholders = ",".join("?" for _ in prune_ids)
                await db.execute(f"DELETE FROM notifications WHERE id IN ({placeholders})", prune_ids)

            # If overflow remains (e.g., mostly block notifications), hard-cap by
            # pruning the oldest remaining rows.
            async with db.execute("SELECT COUNT(*) AS cnt FROM notifications") as cur:
                row = await cur.fetchone()
            remaining_overflow = (int(row["cnt"]) if row else 0) - MAX_NOTIFICATIONS
            if remaining_overflow > 0:
                await db.execute(
                    """DELETE FROM notifications
                       WHERE id IN (
                         SELECT id FROM notifications
                         ORDER BY timestamp ASC
                         LIMIT ?
                       )""",
                    (remaining_overflow,),
                )

    await db.commit()
    return {
        "id": nid,
        "message": message,
        "category": category,
        "level": level,
        "timestamp": ts,
        "read": False,
        "is_block": is_block,
        "metadata": metadata or {},
    }


async def list_notifications(
    db: aiosqlite.Connection,
    category: Optional[str] = None,
    unread_only: bool = False,
    limit: int = 100,
) -> list[dict]:
    clauses = []
    params: list = []
    if category and category != "all":
        clauses.append("category = ?")
        params.append(category)
    if unread_only:
        clauses.append("read = 0")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    async with db.execute(
        f"SELECT * FROM notifications {where} ORDER BY timestamp DESC LIMIT ?", params
    ) as cur:
        rows = await cur.fetchall()
    return [_row_to_notification(r) for r in rows]


async def mark_notification_read(db: aiosqlite.Connection, nid: str) -> bool:
    async with db.execute("UPDATE notifications SET read = 1 WHERE id = ?", (nid,)) as cur:
        updated = cur.rowcount
    await db.commit()
    return updated > 0


async def mark_all_read(db: aiosqlite.Connection) -> int:
    async with db.execute("UPDATE notifications SET read = 1 WHERE read = 0") as cur:
        count = cur.rowcount
    await db.commit()
    return count


async def delete_notification(db: aiosqlite.Connection, nid: str) -> Optional[bool]:
    async with db.execute(
        "SELECT is_block FROM notifications WHERE id = ?", (nid,)
    ) as cur:
        row = await cur.fetchone()
    if row is None:
        return None
    if row["is_block"]:
        return False  # protected
    await db.execute("DELETE FROM notifications WHERE id = ?", (nid,))
    await db.commit()
    return True


async def clear_read_notifications(db: aiosqlite.Connection) -> int:
    async with db.execute("DELETE FROM notifications WHERE read = 1 AND is_block = 0") as cur:
        count = cur.rowcount
    await db.commit()
    return count


async def clear_all_notifications(db: aiosqlite.Connection) -> int:
    async with db.execute("DELETE FROM notifications WHERE is_block = 0") as cur:
        count = cur.rowcount
    await db.commit()
    return count


def _row_to_notification(row) -> dict:
    return {
        "id": row["id"],
        "message": row["message"],
        "category": row["category"],
        "level": row["level"],
        "timestamp": row["timestamp"],
        "read": bool(row["read"]),
        "is_block": bool(row["is_block"]),
        "metadata": json.loads(row["metadata"] or "{}"),
    }


# ---------------------------------------------------------------------------
# Metric history
# ---------------------------------------------------------------------------

MAX_METRIC_HISTORY_ROWS = 7 * 24 * 60  # 10,080 rows (7 days @ 60s cadence)


async def get_metric_history(
    db: aiosqlite.Connection,
    hours: int = 1,
    limit: int = 360,
) -> list[dict]:
    """Return recent metric snapshots for chart hydration.

    Args:
        hours: How far back to look (default 1 hour).
        limit: Maximum rows (default 360 = 6 hours at 60s intervals).
    """
    bounded_limit = max(1, min(int(limit), MAX_METRIC_HISTORY_ROWS))
    cutoff = time.time() - hours * 3600
    async with db.execute(
        """SELECT timestamp, hashrate_60sec, hashrate_3hr
           FROM metric_history
           WHERE timestamp > ?
             AND (COALESCE(hashrate_60sec, 0) > 0 OR COALESCE(hashrate_3hr, 0) > 0)
           ORDER BY timestamp ASC
           LIMIT ?""",
        (cutoff, bounded_limit),
    ) as cur:
        rows = await cur.fetchall()
    return [
        {
            "timestamp": row["timestamp"],
            "hashrate_60sec": row["hashrate_60sec"],
            "hashrate_3hr": row["hashrate_3hr"],
        }
        for row in rows
    ]


async def save_metric_snapshot(db: aiosqlite.Connection, metrics: dict) -> None:
    await db.execute(
        """INSERT INTO metric_history
           (timestamp, hashrate_60sec, hashrate_10min, hashrate_3hr, hashrate_24hr,
            workers_hashing, btc_price, daily_mined_sats, unpaid_earnings)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            time.time(),
            metrics.get("hashrate_60sec"),
            metrics.get("hashrate_10min"),
            metrics.get("hashrate_3hr"),
            metrics.get("hashrate_24hr"),
            metrics.get("workers_hashing"),
            metrics.get("btc_price"),
            metrics.get("daily_mined_sats"),
            metrics.get("unpaid_earnings"),
        ),
    )
    await db.commit()
    # Prune old entries (keep 30 days)
    cutoff = time.time() - 30 * 86400
    await db.execute("DELETE FROM metric_history WHERE timestamp < ?", (cutoff,))
    await db.commit()


# ---------------------------------------------------------------------------
# Alert state (notification engine persistence)
# ---------------------------------------------------------------------------


async def get_alert_state(db: aiosqlite.Connection) -> dict:
    """Load persisted alert engine state from the database.

    Returns a dict suitable for initialising
    :attr:`~app.services.notification_engine._prev_state` and the cooldown
    tracker on startup.  Missing keys are silently omitted so the caller
    can apply safe defaults.
    """
    async with db.execute("SELECT key, value FROM alert_state") as cur:
        rows = await cur.fetchall()
    result: dict = {}
    for row in rows:
        try:
            result[row["key"]] = json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            pass
    return result


# ---------------------------------------------------------------------------
# Worker overrides (ASIC model / efficiency / power per worker)
# ---------------------------------------------------------------------------


async def get_worker_overrides(db: aiosqlite.Connection) -> dict:
    """Return all worker overrides as {worker_name: {asicId, efficiency, power}}."""
    async with db.execute("SELECT worker_name, asic_id, efficiency, power FROM worker_overrides") as cur:
        rows = await cur.fetchall()
    return {
        row["worker_name"]: {
            "asicId": row["asic_id"],
            "efficiency": row["efficiency"],
            "power": row["power"],
        }
        for row in rows
    }


async def set_worker_overrides(db: aiosqlite.Connection, overrides: dict) -> None:
    """Replace all worker overrides atomically.

    Args:
        overrides: {worker_name: {asicId?, efficiency?, power?}, ...}
    """
    await db.execute("DELETE FROM worker_overrides")
    for name, vals in overrides.items():
        await db.execute(
            """INSERT INTO worker_overrides (worker_name, asic_id, efficiency, power, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                name,
                vals.get("asicId") or vals.get("asic_id"),
                vals.get("efficiency"),
                vals.get("power"),
                time.time(),
            ),
        )
    await db.commit()


# ---------------------------------------------------------------------------
# User settings (electricity rate, etc.)
# ---------------------------------------------------------------------------


async def get_user_settings(db: aiosqlite.Connection) -> dict:
    """Return all user settings as a flat dict."""
    async with db.execute("SELECT key, value FROM user_settings") as cur:
        rows = await cur.fetchall()
    result: dict = {}
    for row in rows:
        try:
            result[row["key"]] = json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            result[row["key"]] = row["value"]
    return result


async def set_user_setting(db: aiosqlite.Connection, key: str, value) -> None:
    """Upsert a single user setting."""
    await db.execute(
        """INSERT INTO user_settings (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
        (key, json.dumps(value), time.time()),
    )
    await db.commit()


async def set_alert_state(db: aiosqlite.Connection, key: str, value) -> None:
    """Upsert a single key into the alert_state table."""
    await db.execute(
        """INSERT INTO alert_state (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
        (key, json.dumps(value), time.time()),
    )
    await db.commit()
