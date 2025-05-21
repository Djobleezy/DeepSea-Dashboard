import miner_specs


def test_parse_worker_name_basic():
    specs = miner_specs.parse_worker_name("my-S19-Pro")
    assert specs is not None
    assert specs["model"] == "Bitmain Antminer S19 Pro"
    assert specs["type"] == "ASIC"
    assert specs["efficiency"] == 29.5
    # power approx 110 TH/s * 29.5 J/TH
    assert round(specs["power"]) == 3245
