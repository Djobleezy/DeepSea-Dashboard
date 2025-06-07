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
    assert specs["efficiency"] == 19.0
    assert round(specs["power"]) == round(162 * 19.0)


def test_parse_worker_name_s19j_pro_plus():
    specs = miner_specs.parse_worker_name("home-s19jpro+")
    assert specs is not None
    assert specs["model"] == "Bitmain Antminer S19j Pro+"
    assert specs["type"] == "ASIC"
    assert specs["efficiency"] == 27.5
    assert round(specs["power"]) == round(122 * 27.5)


def test_parse_worker_name_no_false_positive():
    """Ensure patterns don't match inside other words."""
    assert miner_specs.parse_worker_name("foo1166bar") is None
    assert miner_specs.parse_worker_name("mys9buddy") is None


def test_parse_worker_name_generic_axe():
    """Any worker name containing 'axe' should map to the Bitaxe family."""
    specs = miner_specs.parse_worker_name("mycoolaxe123")
    assert specs is not None
    assert specs["model"] == "Generic Bitaxe"
    assert specs["type"] == "Bitaxe"
    assert specs["efficiency"] == 15
    assert round(specs["power"]) == round(1.1 * 15)


def test_parse_worker_name_allows_trailing_digits():
    """Keywords should match even if the worker name ends with numbers."""
    assert miner_specs.parse_worker_name("urlacher1")["model"] == "The Urlacher"
    assert miner_specs.parse_worker_name("bitchimney1")["model"] == "BitChimney Heater"


def test_parse_worker_name_separator_variations():
    """Patterns should match with hyphens or underscores between keywords."""
    assert (
        miner_specs.parse_worker_name("rig-s19pro+-hydro")["model"]
        == "Bitmain Antminer S19 Pro+ Hydro"
    )
    assert (
        miner_specs.parse_worker_name("farm_s21xp-hydro")["model"]
        == "Bitmain Antminer S21 XP Hydro"
    )
    assert (
        miner_specs.parse_worker_name("apollo-btc_ii")["model"]
        == "FutureBit Apollo BTC II"
    )


def test_parse_worker_name_canaan_home_models():
    specs = miner_specs.parse_worker_name("my-avalon_q")
    assert specs["model"] == "Canaan Avalon Q"
    assert specs["type"] == "ASIC"
    assert round(specs["power"]) == round(90 * 18.6)

    specs = miner_specs.parse_worker_name("avalon-mini3")
    assert specs["model"] == "Canaan Avalon Mini 3"

    specs = miner_specs.parse_worker_name("avalon-nano3s_home")
    assert specs["model"] == "Canaan Avalon Nano 3S"

    specs = miner_specs.parse_worker_name("Avalon_Nano3")
    assert specs["model"] == "Canaan Avalon Nano 3"


