"""Tests for worker_models module."""

from worker_models import MINER_MODELS, WORKER_NAME_PREFIXES


def test_miner_models_structure():
    """Test that MINER_MODELS contains expected structure."""
    assert isinstance(MINER_MODELS, list)
    assert len(MINER_MODELS) > 0
    
    # Check structure of first model
    first_model = MINER_MODELS[0]
    assert "type" in first_model
    assert "model" in first_model
    assert "max_hashrate" in first_model
    assert "power" in first_model
    
    # Check that all models have required fields
    for model in MINER_MODELS:
        assert isinstance(model["type"], str)
        assert isinstance(model["model"], str)
        assert isinstance(model["max_hashrate"], (int, float))
        assert isinstance(model["power"], (int, float))
        assert model["max_hashrate"] > 0
        assert model["power"] > 0


def test_miner_models_types():
    """Test that we have various types of miners."""
    types = set(model["type"] for model in MINER_MODELS)
    # Check for expected types
    expected_types = {"ASIC", "Bitaxe", "DIY", "USB", "Mini"}
    assert expected_types.issubset(types)


def test_worker_name_prefixes():
    """Test WORKER_NAME_PREFIXES structure."""
    assert isinstance(WORKER_NAME_PREFIXES, list)
    assert len(WORKER_NAME_PREFIXES) > 0
    
    # All prefixes should be strings
    for prefix in WORKER_NAME_PREFIXES:
        assert isinstance(prefix, str)
        assert len(prefix) > 0


def test_miner_models_have_reasonable_values():
    """Test that miner models have reasonable hashrate and power values."""
    for model in MINER_MODELS:
        # Hashrate should be positive and reasonable
        assert 0 < model["max_hashrate"] < 1000  # Up to 1000 TH/s seems reasonable
        # Power should be positive and reasonable
        assert 0 < model["power"] < 10000  # Up to 10kW seems reasonable for large ASICs
        
        # ASIC miners should generally have higher hashrates
        if model["type"] == "ASIC":
            assert model["max_hashrate"] >= 80  # Modern ASICs should be at least 80 TH/s
        
        # USB miners should have low power consumption
        if model["type"] == "USB":
            assert model["power"] < 50  # USB miners should use less than 50W