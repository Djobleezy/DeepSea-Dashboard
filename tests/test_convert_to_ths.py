import logging
import pytest

from models import convert_to_ths


@pytest.mark.parametrize(
    "value, unit, expected",
    [
        (1, "PH/s", 1000),
        (2, "EH/s", 2_000_000),
        (500, "GH/s", 0.5),
        (2_000_000, "MH/s", 2.0),
        (3_000_000_000, "KH/s", 3.0),
        (4_000_000_000_000, "H/s", 4.0),
        (5, "TH/s", 5),
    ],
)
def test_known_unit_conversions(value, unit, expected):
    assert convert_to_ths(value, unit) == pytest.approx(expected)


def test_unexpected_unit_returns_original_and_logs_warning(caplog):
    with caplog.at_level(logging.WARNING):
        result = convert_to_ths(7.5, "unknown")
    assert result == 7.5
    assert any("Unexpected hashrate unit" in rec.message for rec in caplog.records)


def test_negative_or_none_returns_zero():
    assert convert_to_ths(-5, "TH/s") == 0
    assert convert_to_ths(None, "TH/s") == 0


@pytest.mark.parametrize(
    "value, unit, expected",
    [
        ("10", "TH/s", 10),
        ("1.5", "PH/s", 1500),
        ("2,000", "GH/s", 2.0),
    ],
)
def test_string_values(value, unit, expected):
    assert convert_to_ths(value, unit) == pytest.approx(expected)
