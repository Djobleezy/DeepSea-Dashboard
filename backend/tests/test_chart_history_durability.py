"""Durable, bounded chart history with truthful gaps and source timestamps."""

import asyncio
import time

import aiosqlite
import pytest
import pytest_asyncio

from app import config, db as database


@pytest_asyncio.fixture
async def history_db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "history.db")
    monkeypatch.setattr(database, "_rate_migration_lock", asyncio.Lock())
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    config.save_config({"wallet": "wallet-a"})
    await database.init_db()
    async with aiosqlite.connect(database.DB_PATH) as connection:
        connection.row_factory = aiosqlite.Row
        yield connection


async def insert_samples(db, samples, wallet="wallet-a"):
    await db.executemany(
        "INSERT INTO metric_history (wallet, timestamp, hashrate_60sec, hashrate_3hr) VALUES (?, ?, ?, ?)",
        [(wallet, timestamp, short, long) for timestamp, short, long in samples],
    )
    await db.commit()


@pytest.mark.asyncio
async def test_dense_history_keeps_full_window_latest_sample_and_both_series_extrema(history_db):
    start = time.time() - 3590
    samples = [(start + index * 10, 100.0, 110.0) for index in range(350)]
    samples[37] = (samples[37][0], 9000.0, 110.0)
    samples[119] = (samples[119][0], 0.0, 110.0)
    samples[207] = (samples[207][0], 100.0, 7000.0)
    samples[298] = (samples[298][0], 100.0, 0.0)
    await insert_samples(history_db, samples)

    result = await database.get_metric_history(history_db, hours=1, limit=60)

    assert len(result) <= 60
    assert result[0]["timestamp"] == samples[0][0]
    assert result[-1]["timestamp"] == samples[-1][0]
    assert [point["timestamp"] for point in result] == sorted({point["timestamp"] for point in result})
    assert max(point["hashrate_60sec"] for point in result) == 9000
    assert min(point["hashrate_60sec"] for point in result) == 0
    assert max(point["hashrate_3hr"] for point in result) == 7000
    assert min(point["hashrate_3hr"] for point in result) == 0


@pytest.mark.asyncio
async def test_downsampling_spacing_does_not_invent_outages(history_db):
    start = time.time() - 3500
    samples = [(start + index * 10, float(index % 7), float(index % 11)) for index in range(350)]
    await insert_samples(history_db, samples)

    result = await database.get_metric_history(history_db, limit=10)

    assert any(b["timestamp"] - a["timestamp"] > 150 for a, b in zip(result, result[1:]))
    assert all(point["gap_before"] is False for point in result)


@pytest.mark.asyncio
async def test_real_outage_survives_downsampling_without_synthetic_zeros(history_db):
    start = time.time() - 7000
    samples = [(start + index * 10, 100.0, 200.0) for index in range(100)]
    samples += [(start + 4000 + index * 10, 150.0, 250.0) for index in range(100)]
    await insert_samples(history_db, samples)

    result = await database.get_metric_history(history_db, hours=6, limit=10)

    gaps = [point for point in result if point["gap_before"]]
    assert len(gaps) == 1
    assert gaps[0]["timestamp"] >= samples[100][0]
    assert all(point["hashrate_60sec"] > 0 and point["hashrate_3hr"] > 0 for point in result)


@pytest.mark.asyncio
async def test_corrupt_legacy_and_future_rows_do_not_break_history(history_db):
    now = time.time()
    await insert_samples(history_db, [
        (now - 100, 0, 0),
        (now - 99, -1, 100),
        (now - 98, None, 100),
        (now - 97, float("inf"), 100),
        (now - 96, "broken", 100),
        (now + 60, 999, 999),
    ])

    result = await database.get_metric_history(history_db)

    assert len(result) == 1
    assert result[0]["hashrate_60sec"] == result[0]["hashrate_3hr"] == 0


@pytest.mark.asyncio
async def test_source_timestamp_is_idempotent_and_survives_reopening(history_db):
    now = time.time() - 20
    original = {"wallet": "wallet-a", "data_updated_at": now, "hashrate_60sec": 100, "hashrate_3hr": 150}
    await database.save_metric_snapshot(history_db, original)
    await database.save_metric_snapshot(history_db, {**original, "hashrate_60sec": 0})
    await database.save_metric_snapshot(history_db, {**original, "wallet": "wallet-b", "hashrate_60sec": 900})

    async with aiosqlite.connect(database.DB_PATH) as reopened:
        reopened.row_factory = aiosqlite.Row
        actual = await database.get_metric_history(reopened, wallet="wallet-a")
        assert len(actual) == 1
        assert actual[0]["timestamp"] == now
        assert actual[0]["hashrate_60sec"] == 0
        assert (await database.get_metric_history(reopened, wallet="wallet-b"))[0]["hashrate_60sec"] == 900


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", [
    {"data_status": "stale"},
    {"data_status": "unavailable"},
    {"data_status": "unconfigured"},
    {"hashrate_60sec": -1},
    {"hashrate_3hr": float("nan")},
    {"hashrate_3hr": None},
    {"data_updated_at": None},
    {"data_updated_at": float("inf")},
    {"data_updated_at": 0},
    {"data_updated_at": time.time() + 3600},
    {"wallet": ""},
    {"wallet": None},
])
async def test_invalid_or_stale_snapshot_is_never_recorded_as_a_new_reading(history_db, invalid):
    sample = {"wallet": "wallet-a", "data_updated_at": time.time(), "hashrate_60sec": 100, "hashrate_3hr": 150}
    await database.save_metric_snapshot(history_db, {**sample, **invalid})
    assert await database.get_metric_history(history_db) == []


@pytest.mark.asyncio
async def test_storage_cap_and_age_retention_do_not_evict_other_wallets_recent_history(history_db, monkeypatch):
    now = time.time()
    monkeypatch.setattr(database, "MAX_STORED_METRIC_HISTORY_ROWS", 3)
    await insert_samples(history_db, [(now - 40 * 86400, 1, 1), (now - 60, 2, 2)], wallet="wallet-b")
    await insert_samples(history_db, [(now - 10 + index, 3, 3) for index in range(8)])

    await database.save_metric_snapshot(history_db, {
        "wallet": "wallet-a", "data_updated_at": now, "hashrate_60sec": 0, "hashrate_3hr": 0,
    })

    a = await database.get_metric_history(history_db, wallet="wallet-a")
    b = await database.get_metric_history(history_db, wallet="wallet-b")
    assert len(a) == 3
    assert a[-1]["timestamp"] == now
    assert a[-1]["hashrate_60sec"] == 0
    assert len(b) == 1
    assert b[0]["timestamp"] == now - 60
    async with history_db.execute("SELECT MIN(timestamp) AS oldest FROM metric_history") as cursor:
        assert (await cursor.fetchone())["oldest"] > now - 30 * 86400


@pytest.mark.asyncio
async def test_existing_duplicate_samples_migrate_without_losing_latest_value(tmp_path, monkeypatch):
    path = tmp_path / "legacy.db"
    now = time.time() - 10
    async with aiosqlite.connect(path) as connection:
        await connection.execute("CREATE TABLE metric_history(id INTEGER PRIMARY KEY, wallet TEXT, timestamp REAL, hashrate_60sec REAL, hashrate_3hr REAL)")
        await connection.executemany("INSERT INTO metric_history VALUES (?, ?, ?, ?, ?)", [
            (1, "wallet-a", now, 100, 100), (2, "wallet-a", now, 0, 150), (3, "wallet-b", now, 900, 900),
        ])
        await connection.commit()
    monkeypatch.setattr(database, "DB_PATH", path)
    monkeypatch.setattr(database, "_rate_migration_lock", asyncio.Lock())
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")
    await database.init_db()
    async with aiosqlite.connect(path) as connection:
        connection.row_factory = aiosqlite.Row
        a = await database.get_metric_history(connection, wallet="wallet-a")
        b = await database.get_metric_history(connection, wallet="wallet-b")
        assert len(a) == len(b) == 1
        assert a[0]["hashrate_60sec"] == 0
        assert b[0]["hashrate_60sec"] == 900
        with pytest.raises(aiosqlite.IntegrityError):
            await connection.execute("INSERT INTO metric_history(wallet, timestamp) VALUES (?, ?)", ("wallet-a", now))


@pytest.mark.asyncio
async def test_seven_day_dense_legacy_history_has_bounded_complete_output(history_db):
    # Ten-second samples exceed both the normal seven-day payload and the
    # current storage cap: legacy databases still hydrate a complete window.
    now = time.time()
    start = now - 7 * 86400 + 10
    count = 7 * 24 * 60 * 6 - 1
    rows = [(start + index * 10, 100.0, 200.0) for index in range(count)]
    rows[17] = (rows[17][0], 9999.0, 200.0)
    rows[-30] = (rows[-30][0], 0.0, 8888.0)
    await insert_samples(history_db, rows)

    result = await database.get_metric_history(history_db, hours=168, limit=10_080)

    assert len(result) <= 10_080
    assert result[0]["timestamp"] == rows[0][0]
    assert result[-1]["timestamp"] == rows[-1][0]
    assert max(point["hashrate_60sec"] for point in result) == 9999
    assert min(point["hashrate_60sec"] for point in result) == 0
    assert max(point["hashrate_3hr"] for point in result) == 8888
    assert not any(point["gap_before"] for point in result)
