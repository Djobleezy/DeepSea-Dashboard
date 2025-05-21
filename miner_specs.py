# Mapping of miner model information and helper to parse worker names
from typing import Optional, Dict
import re

# Each entry maps regex pattern to specs
# Specs include model, type, default hashrate (TH/s), efficiency in J/TH
MODEL_SPECS = [
    (r"s9", {"model": "Bitmain Antminer S9", "type": "ASIC", "hashrate": 13.5, "efficiency": 98}),
    (r"s17[-_\s]*pro", {"model": "Bitmain Antminer S17 Pro", "type": "ASIC", "hashrate": 53, "efficiency": 39.5}),
    (r"t19", {"model": "Bitmain Antminer T19", "type": "ASIC", "hashrate": 84, "efficiency": 37.5}),
    (r"s19[-_\s]*pro", {"model": "Bitmain Antminer S19 Pro", "type": "ASIC", "hashrate": 110, "efficiency": 29.5}),
    (r"s19[-_\s]*xp", {"model": "Bitmain Antminer S19 XP", "type": "ASIC", "hashrate": 140, "efficiency": 21.5}),
    (r"s21[-_\s]*pro", {"model": "Bitmain Antminer S21 Pro", "type": "ASIC", "hashrate": 234, "efficiency": 15.0}),
    (r"m20s", {"model": "MicroBT Whatsminer M20S", "type": "ASIC", "hashrate": 68, "efficiency": 49.4}),
    (r"m30s\+\+", {"model": "MicroBT Whatsminer M30S++", "type": "ASIC", "hashrate": 112, "efficiency": 31}),
    (r"m50s", {"model": "MicroBT Whatsminer M50S", "type": "ASIC", "hashrate": 126, "efficiency": 26}),
    (r"1246", {"model": "Canaan AvalonMiner 1246", "type": "ASIC", "hashrate": 90, "efficiency": 38}),
    (r"1366", {"model": "Canaan AvalonMiner 1366", "type": "ASIC", "hashrate": 130, "efficiency": 25}),
    (r"t3\+", {"model": "Innosilicon T3+", "type": "ASIC", "hashrate": 52, "efficiency": 53.8}),
    (r"e11\+\+", {"model": "Ebang Ebit E11++", "type": "ASIC", "hashrate": 44, "efficiency": 45}),
    (r"apollo", {"model": "FutureBit Apollo BTC", "type": "ASIC", "hashrate": 3, "efficiency": 66}),
    (r"compac", {"model": "GekkoScience Compac F", "type": "USB", "hashrate": 0.3, "efficiency": 37.5}),
    (r"bitaxe", {"model": "Bitaxe Gamma", "type": "Bitaxe", "hashrate": 1.1, "efficiency": 15}),
    (r"nerdaxe", {"model": "NerdAxe", "type": "Bitaxe", "hashrate": 0.5, "efficiency": 20}),
    (r"urlacher", {"model": "The Urlacher", "type": "DIY", "hashrate": 56, "efficiency": 23}),
    (r"slim", {"model": "Antminer Slim", "type": "DIY", "hashrate": 32, "efficiency": 28}),
    (r"heatbit", {"model": "Heatbit Heater", "type": "DIY", "hashrate": 10, "efficiency": 40}),
]


def parse_worker_name(name: str) -> Optional[Dict[str, float]]:
    """Return model specs parsed from worker name.

    Args:
        name: Worker name string.

    Returns:
        Dict with model, type, efficiency (J/TH), hashrate and power, or None if unknown.
    """
    if not name:
        return None
    name_lower = name.lower()
    for pattern, specs in MODEL_SPECS:
        if re.search(pattern, name_lower):
            power = specs.get("hashrate", 0) * specs.get("efficiency", 0)
            return {
                "model": specs["model"],
                "type": specs["type"],
                "efficiency": specs["efficiency"],
                "default_hashrate": specs["hashrate"],
                "power": power,
            }
    return None
