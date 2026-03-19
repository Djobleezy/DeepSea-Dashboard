"""SQLite database management for persistent data."""

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

DB_PATH = Path("/data/deepsea.db")


async def get_db() -> aiosqlite.Connection:
    """Open a database connection (used as a FastAPI dependency)."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()


async def init_db() -> None:
    """Create all tables if they don't exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(DB_PATH)) as db:
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
