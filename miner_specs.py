# Mapping of miner model information and helper to parse worker names
from typing import Optional, Dict
import re

# Each entry maps regex pattern to specs
# Specs include model, type, default hashrate (TH/s), efficiency in J/TH
MODEL_SPECS = [
    # Bitmain Antminer models
    (r"s9", {"model": "Bitmain Antminer S9", "type": "ASIC", "hashrate": 13.5, "efficiency": 98}),
    (r"s17[-_\s]*pro", {"model": "Bitmain Antminer S17 Pro", "type": "ASIC", "hashrate": 53, "efficiency": 39.5}),
    (r"t19", {"model": "Bitmain Antminer T19", "type": "ASIC", "hashrate": 84, "efficiency": 37.5}),
    (
        r"s19\s*pro\+\s*hydro",
        {"model": "Bitmain Antminer S19 Pro+ Hydro", "type": "ASIC", "hashrate": 198, "efficiency": 27.5},
    ),
    (
        r"s19\s*xp\s*hydro",
        {"model": "Bitmain Antminer S19 XP Hydro", "type": "ASIC", "hashrate": 255, "efficiency": 20.8},
    ),
    (r"s19k[-_\s]*pro", {"model": "Bitmain Antminer S19k Pro", "type": "ASIC", "hashrate": 112, "efficiency": 23}),
    (r"s19j[-_\s]*pro", {"model": "Bitmain Antminer S19j Pro", "type": "ASIC", "hashrate": 104, "efficiency": 29.5}),
    (r"s19j\b", {"model": "Bitmain Antminer S19j", "type": "ASIC", "hashrate": 90, "efficiency": 36.1}),
    (r"s19[-_\s]*pro", {"model": "Bitmain Antminer S19 Pro", "type": "ASIC", "hashrate": 110, "efficiency": 29.5}),
    (r"s19[-_\s]*xp", {"model": "Bitmain Antminer S19 XP", "type": "ASIC", "hashrate": 140, "efficiency": 21.5}),
    (r"s19\b", {"model": "Bitmain Antminer S19", "type": "ASIC", "hashrate": 95, "efficiency": 34.5}),
    (
        r"s21\s*xp\s*hydro",
        {"model": "Bitmain Antminer S21 XP Hydro", "type": "ASIC", "hashrate": 300, "efficiency": 12},
    ),
    (r"s21[-_\s]*pro", {"model": "Bitmain Antminer S21 Pro", "type": "ASIC", "hashrate": 234, "efficiency": 15.0}),
    (r"s21\b", {"model": "Bitmain Antminer S21", "type": "ASIC", "hashrate": 200, "efficiency": 17.5}),
    (r"t21\b", {"model": "Bitmain Antminer T21", "type": "ASIC", "hashrate": 162, "efficiency": 20.2}),
    # MicroBT Whatsminer series
    (r"m20s", {"model": "MicroBT Whatsminer M20S", "type": "ASIC", "hashrate": 68, "efficiency": 49.4}),
    (r"m30s\+\+", {"model": "MicroBT Whatsminer M30S++", "type": "ASIC", "hashrate": 112, "efficiency": 31}),
    (r"m30s\+", {"model": "MicroBT Whatsminer M30S+", "type": "ASIC", "hashrate": 100, "efficiency": 34}),
    (r"m30s\b", {"model": "MicroBT Whatsminer M30S", "type": "ASIC", "hashrate": 88, "efficiency": 38}),
    (r"m50s", {"model": "MicroBT Whatsminer M50S", "type": "ASIC", "hashrate": 126, "efficiency": 26}),
    (r"m50\b", {"model": "MicroBT Whatsminer M50", "type": "ASIC", "hashrate": 118, "efficiency": 29}),
    (r"m53", {"model": "MicroBT Whatsminer M53", "type": "ASIC", "hashrate": 226, "efficiency": 29}),
    (r"m60s", {"model": "MicroBT Whatsminer M60S", "type": "ASIC", "hashrate": 186, "efficiency": 18.5}),
    (r"m66s", {"model": "MicroBT Whatsminer M66S", "type": "ASIC", "hashrate": 266, "efficiency": 18.5}),
    # Canaan Avalon series
    (r"1166", {"model": "Canaan AvalonMiner 1166 Pro", "type": "ASIC", "hashrate": 81, "efficiency": 42}),
    (r"1246", {"model": "Canaan AvalonMiner 1246", "type": "ASIC", "hashrate": 90, "efficiency": 38}),
    (r"1346", {"model": "Canaan AvalonMiner 1346", "type": "ASIC", "hashrate": 110, "efficiency": 30}),
    (r"1366", {"model": "Canaan AvalonMiner 1366", "type": "ASIC", "hashrate": 130, "efficiency": 25}),
    (
        r"1566.*immersion",
        {"model": "Canaan AvalonMiner 1566 Immersion", "type": "ASIC", "hashrate": 195, "efficiency": 19},
    ),
    (r"1566", {"model": "Canaan AvalonMiner 1566", "type": "ASIC", "hashrate": 185, "efficiency": 19.9}),
    # Other ASICs and DIY devices
    (r"sealminer[-_\s]*a2", {"model": "Sealminer A2", "type": "ASIC", "hashrate": 260, "efficiency": 16.5}),
    (r"t3\+", {"model": "Innosilicon T3+", "type": "ASIC", "hashrate": 52, "efficiency": 53.8}),
    (r"e11\+\+", {"model": "Ebang Ebit E11++", "type": "ASIC", "hashrate": 44, "efficiency": 45}),
    # Small form factor miners
    (r"apollo", {"model": "FutureBit Apollo BTC", "type": "ASIC", "hashrate": 3, "efficiency": 52}),
    (r"compac", {"model": "GekkoScience Compac F", "type": "USB", "hashrate": 0.3, "efficiency": 35}),
    (r"supra", {"model": "Bitaxe Supra", "type": "Bitaxe", "hashrate": 1.0, "efficiency": 17.5}),
    (r"bitaxe", {"model": "Bitaxe Gamma", "type": "Bitaxe", "hashrate": 1.1, "efficiency": 15}),
    (r"nerdaxe", {"model": "NerdAxe", "type": "Bitaxe", "hashrate": 0.5, "efficiency": 20}),
    (r"bitchimney", {"model": "BitChimney Heater", "type": "DIY", "hashrate": 0.55, "efficiency": 32.5}),
    (r"loki", {"model": "Loki Single-Board Rig", "type": "DIY", "hashrate": 2, "efficiency": 27}),
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
        boundary_pattern = rf"(?<![A-Za-z0-9]){pattern}(?![A-Za-z0-9])"
        if re.search(boundary_pattern, name_lower):
            power = specs.get("hashrate", 0) * specs.get("efficiency", 0)
            return {
                "model": specs["model"],
                "type": specs["type"],
                "efficiency": specs["efficiency"],
                "default_hashrate": specs["hashrate"],
                "power": power,
            }
    if "axe" in name_lower:
        hashrate = 1.1
        efficiency = 15
        return {
            "model": "Generic Bitaxe",
            "type": "Bitaxe",
            "efficiency": efficiency,
            "default_hashrate": hashrate,
            "power": hashrate * efficiency,
        }
    return None
