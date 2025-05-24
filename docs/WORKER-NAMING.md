# Worker Naming Guide

The dashboard estimates power consumption by scanning each worker's name for known miner models. When a match is found, the software can approximate the worker's power usage based on the model's efficiency. If a worker name doesn't contain a recognizable keyword, that worker's power usage cannot be estimated.

## How it works

During metrics collection the function `parse_worker_name` compares each worker name against a list of model patterns. The match is case-insensitive and accepts spaces, hyphens, or underscores. Example logic:

```python
specs = parse_worker_name(worker_name)
if specs:
    power_watts = convert_to_ths(hashrate, unit) * specs["efficiency"]
```

To ensure your miners are detected correctly, include one of the keywords below in each worker name.

## Recognized keywords

| Miner family | Example keywords to include |
|--------------|----------------------------|
| **Bitmain Antminer** | `s9`, `s17 pro`, `t19`, `s19`, `s19 pro`, `s19j`, `s19j pro`, `s19j pro+`, `s19 pro++`, `s19k pro`, `s19 xp`, `s19 xp hyd`, `s19 pro+ hyd`, `t21`, `s21`, `s21 hydro`, `s21 pro`, `s21+`, `s21+ hydro`, `s21 xp hydro` |
| **MicroBT Whatsminer** | `m20s`, `m30s`, `m30s+`, `m30s++`, `m31s`, `m31s+`, `m50`, `m50s`, `m50s++`, `m53`, `m56`, `m60s`, `m66s` |
| **Canaan AvalonMiner** | `1166`, `1246`, `1346`, `1366`, `1466`, `1466i`, `1566` |
| **Other / DIY** | `sealminer a2`, `t3+`, `e11++`, `apollo`, `apollo btc ii`, `compac`, `bitaxe`, `nerdaxe`, `bitchimney`, `loki`, `urlacher`, `slim`, `heatbit` |

The table lists only the identifying portion that needs to appear anywhere in the name. For instance, both `rig-s19pro-01` and `S19 Pro Worker` will match `s19 pro`.

## Examples

```
S19-Pro-01        -> matches Bitmain Antminer S19 Pro
Home_M30S++       -> matches MicroBT Whatsminer M30S++
Avalon1246_unit1  -> matches Canaan AvalonMiner 1246
bitaxe-lab        -> matches Bitaxe Gamma
```

Worker names that omit these keywords (for example `Miner1` or `Online`) will not be recognized, so their power usage is ignored when estimating totals.

## Troubleshooting

If estimated power never appears on your dashboard:

1. Check that each worker name contains an identifying keyword from the list above.
2. Ensure worker names are not short status indicators like `online` or `offline`.
3. If the pool does not expose custom names, edit the names directly on your miner hardware.

Following these guidelines will allow the dashboard to compute more accurate power consumption when explicit power usage is not provided.

