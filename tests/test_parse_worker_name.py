import miner_specs


def test_parse_worker_name_basic():
    specs = miner_specs.parse_worker_name("my-S19-Pro")
    assert specs is not None
    assert specs["model"] == "Bitmain Antminer S19 Pro"
    assert specs["type"] == "ASIC"
    assert specs["efficiency"] == 29.5
    # power approx 110 TH/s * 29.5 J/TH
    assert round(specs["power"]) == 3245


def test_parse_worker_name_t21():
    specs = miner_specs.parse_worker_name("Rig_T21")
    assert specs is not None
    assert specs["model"] == "Bitmain Antminer T21"
    assert specs["type"] == "ASIC"
    assert specs["efficiency"] == 20.2
    assert round(specs["power"]) == round(162 * 20.2)
