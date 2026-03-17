"""
Worker hardware model catalog for DeepSea Dashboard.

Provides a shared list of known ASIC and other miner models with their
max hashrate and power consumption. Used by the worker simulator to
generate realistic simulated worker data.
"""

MINER_MODELS = [
    # Bitmain S19 Series - High Performance ASICs
    {"type": "ASIC", "model": "Bitmain Antminer S19", "max_hashrate": 95, "power": 3250},
    {"type": "ASIC", "model": "Bitmain Antminer S19 Pro", "max_hashrate": 110, "power": 3250},
    {"type": "ASIC", "model": "Bitmain Antminer S19j Pro", "max_hashrate": 104, "power": 3150},
    {"type": "ASIC", "model": "Bitmain Antminer S19k Pro", "max_hashrate": 112, "power": 3050},
    {"type": "ASIC", "model": "Bitmain Antminer S19 XP", "max_hashrate": 140, "power": 3010},
    {"type": "ASIC", "model": "Bitmain Antminer S19j", "max_hashrate": 90, "power": 3050},
    # Bitmain S21 Series - Newest Generation ASICs
    {"type": "ASIC", "model": "Bitmain Antminer S21", "max_hashrate": 200, "power": 3500},
    {"type": "ASIC", "model": "Bitmain Antminer S21 Pro", "max_hashrate": 230, "power": 3450},
    {"type": "ASIC", "model": "Bitmain Antminer T21", "max_hashrate": 162, "power": 3276},
    # MicroBT Whatsminer Series
    {"type": "ASIC", "model": "MicroBT Whatsminer M30S", "max_hashrate": 88, "power": 3400},
    {"type": "ASIC", "model": "MicroBT Whatsminer M30S+", "max_hashrate": 100, "power": 3400},
    {"type": "ASIC", "model": "MicroBT Whatsminer M50", "max_hashrate": 126, "power": 3500},
    # Canaan Avalon Series
    {"type": "ASIC", "model": "Canaan Avalon A1246", "max_hashrate": 85, "power": 3010},
    {"type": "ASIC", "model": "Canaan Avalon A1346", "max_hashrate": 95, "power": 3276},
    # BitAxe Series - Lower hashrate but efficient small miners
    {"type": "Bitaxe", "model": "BitAxe Gamma 601", "max_hashrate": 3.2, "power": 35},
    {"type": "Bitaxe", "model": "BitAxe 600", "max_hashrate": 2.8, "power": 33},
    {"type": "Bitaxe", "model": "BitAxe 602", "max_hashrate": 3.3, "power": 31},
    {"type": "Bitaxe", "model": "BitAxe 2.0", "max_hashrate": 3.0, "power": 30},
    {"type": "Bitaxe", "model": "BitAxe BM1368", "max_hashrate": 3.5, "power": 32},
    {"type": "Bitaxe", "model": "BitAxe BM1397", "max_hashrate": 2.9, "power": 30},
    # DIY and ESP32-based miners
    {"type": "DIY", "model": "ESP32 BM1387", "max_hashrate": 0.35, "power": 15},
    {"type": "DIY", "model": "DIY Single-chip", "max_hashrate": 0.5, "power": 20},
    # USB and small miners
    {"type": "USB", "model": "Gekkoscience Newpac", "max_hashrate": 0.15, "power": 12},
    {"type": "USB", "model": "Futurebit Moonlander 2", "max_hashrate": 0.05, "power": 10},
    {"type": "Mini", "model": "GoldShell Mini-DOGE", "max_hashrate": 0.19, "power": 233},
]

# Name prefixes used when generating random worker names (no real names available)
WORKER_NAME_PREFIXES = ["Antminer", "Miner", "Rig", "Node", "Worker", "BitAxe", "BTC"]
