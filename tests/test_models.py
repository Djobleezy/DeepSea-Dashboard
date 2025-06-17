import pytest
from models import OceanData, WorkerData


def test_ocean_data_get_normalized_hashrate():
    data = OceanData(
        hashrate_24hr=2,
        hashrate_24hr_unit="EH/s",
        hashrate_3hr=1.5,
        hashrate_3hr_unit="PH/s",
        hashrate_10min=500,
        hashrate_10min_unit="GH/s",
        hashrate_5min=2_000_000,
        hashrate_5min_unit="MH/s",
        hashrate_60sec=3_000_000_000,
        hashrate_60sec_unit="KH/s",
    )
    assert data.get_normalized_hashrate("24hr") == pytest.approx(2_000_000)
    assert data.get_normalized_hashrate("3hr") == pytest.approx(1500)
    assert data.get_normalized_hashrate("10min") == pytest.approx(0.5)
    assert data.get_normalized_hashrate("5min") == pytest.approx(2)
    assert data.get_normalized_hashrate("60sec") == pytest.approx(3)


def test_workerdata_validation_and_normalized_hashrate():
    worker = WorkerData(
        name="w1",
        status="invalid",
        type="strange",
        hashrate_3hr=-500,
        hashrate_3hr_unit="GH/s",
        hashrate_60sec=2,
        hashrate_60sec_unit="PH/s",
    )
    assert worker.status == "offline"
    assert worker.type == "ASIC"
    assert worker.hashrate_3hr == 0
    assert worker.get_normalized_hashrate("3hr") == 0
    assert worker.get_normalized_hashrate("60sec") == pytest.approx(2000)

    worker2 = WorkerData(
        name="w2",
        status="online",
        type="ASIC",
        hashrate_3hr=1_000_000,
        hashrate_3hr_unit="MH/s",
        hashrate_60sec=-2500,
        hashrate_60sec_unit="GH/s",
    )
    assert worker2.hashrate_60sec == 0
    assert worker2.get_normalized_hashrate("3hr") == pytest.approx(1)
    assert worker2.get_normalized_hashrate("60sec") == 0


def test_model_to_from_dict():
    """Ensure dataclasses with slots still convert to and from dicts."""

    ocean = OceanData(hashrate_24hr=2, hashrate_24hr_unit="EH/s")
    d = ocean.to_dict()
    new_ocean = OceanData.from_dict(d)
    assert new_ocean.hashrate_24hr == ocean.hashrate_24hr
    assert new_ocean.hashrate_24hr_unit == ocean.hashrate_24hr_unit

    worker = WorkerData(name="w1", status="online")
    d = worker.to_dict()
    new_worker = WorkerData.from_dict(d)
    assert new_worker.name == worker.name
    assert new_worker.status == worker.status
