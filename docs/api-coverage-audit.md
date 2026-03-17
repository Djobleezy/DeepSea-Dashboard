# DS-01: API Coverage Audit

_Created: 2026-03-16 | PR: DS-01_

## Summary

`data_service.py` uses a **dual data strategy**: the official Ocean.xyz REST API
as the primary source, with BeautifulSoup HTML scraping as the fallback.  This
audit maps every `OceanData` field to its source(s) and documents which scraping
calls are now guarded by "skip if API already filled this" logic.

---

## Ocean.xyz API Endpoints

| Endpoint | Base URL | Fields provided |
|----------|----------|-----------------|
| `user_hashrate/{wallet}` | `https://api.ocean.xyz/v1` | hashrate_60s, hashrate_300s, hashrate_600s, hashrate_86400, hashrate_10800/7200/3600 |
| `statsnap/{wallet}` | `https://api.ocean.xyz/v1` | unpaid, estimated_earn_next_block, shares_in_tides, lastest_share_ts |
| `pool_stat` | `https://api.ocean.xyz/v1` | hashrate_60s (pool), workers/active_workers, blocks/blocks_found |
| `blocks/{page}/{size}/{legacy}` | `https://api.ocean.xyz/v1` | height, time/timestamp (of latest block) |
| `earnpay/{wallet}/{start}/{end}` | `https://api.ocean.xyz/v1` | payout history (ts, on_chain_txid, lightning_txid, total_satoshis_net_paid) |

---

## Field Coverage Map

### API-Primary Fields (scrape skipped when API succeeds)

| OceanData field | API endpoint | HTML fallback (element id) |
|-----------------|-------------|---------------------------|
| `hashrate_60sec` | `user_hashrate` (hashrate_60s) | `hashrates-tablerows` |
| `hashrate_5min` | `user_hashrate` (hashrate_300s) | `hashrates-tablerows` |
| `hashrate_10min` | `user_hashrate` (hashrate_600s) | `hashrates-tablerows` |
| `hashrate_3hr` | `user_hashrate` (hashrate_10800/7200/3600) | `hashrates-tablerows` |
| `hashrate_24hr` | `user_hashrate` (hashrate_86400) | `hashrates-tablerows` |
| `pool_total_hashrate` | `pool_stat` (hashrate_60s) | `pool-status-item` |
| `workers_hashing` | `pool_stat` (workers/active_workers) | `usersnap-statcards` |
| `blocks_found` | `pool_stat` (blocks/blocks_found) | blocks-found `div` |
| `last_block_height` | `blocks` (height) | `pool-status-item` LAST BLOCK span |
| `last_block_time` | `blocks` (time/timestamp) | `pool-status-item` LAST BLOCK span |
| `unpaid_earnings` | `statsnap` (unpaid) | `usersnap-statcards` |
| `estimated_earnings_next_block` | `statsnap` (estimated_earn_next_block) | `payoutsnap-statcards` |
| `estimated_rewards_in_window` | `statsnap` (shares_in_tides) | `payoutsnap-statcards` |
| `total_last_share` | `statsnap` (lastest_share_ts) | `workers-tablerows` Total row |

### Scrape-Only Fields (no API equivalent)

| OceanData field | HTML source | Notes |
|-----------------|-------------|-------|
| `pool_fees_percentage` | `earnings-tablerows` col 3/4 ratio | Derived: (pool_fees_BTC / earnings_BTC) × 100. No API field. |
| `last_block_earnings` | `earnings-tablerows` col 2 (BTC → sats) | Earnings for the most recent block; not exposed by API. |
| `estimated_earnings_per_day` | `lifetimesnap-statcards` "earnings/day" card | Pool-displayed estimate; no direct API equivalent. |
| `est_time_to_payout` | `usersnap-statcards` "estimated time until minimum payout" | Human-readable string; no API equivalent. |

### Payout History

| Source | Method | Notes |
|--------|--------|-------|
| `earnpay` API | `get_payment_history_api()` | Primary; covers last N days via date range |
| HTML `payouts-tablerows` | `get_payment_history_scrape()` | Fallback; paginated scrape |

---

## Changes Made (DS-01)

1. **Added `API_FIELD_COVERAGE` constant** in `data_service.py` — machine-readable
   dict documenting every field's source, API endpoint, and scrape fallback.

2. **Added skip guards in `get_ocean_data()`** — before each BeautifulSoup DOM
   query block, check whether the API already populated the field. If so, log at
   DEBUG level and skip the parse. Affected sections:
   - `pool-status-item` (pool hashrate + last block)
   - `hashrates-tablerows` (all 5 hashrate intervals)
   - `payoutsnap-statcards` (estimated_earnings_next_block, estimated_rewards_in_window)
   - `usersnap-statcards` (workers_hashing, unpaid_earnings — est_time_to_payout still always scraped)
   - `blocks-found div` (blocks_found)
   - `workers-tablerows` Total row (total_last_share)

3. **Scrape-only sections unchanged** — `earnings-tablerows` (pool_fees_percentage,
   last_block_earnings) and `lifetimesnap-statcards` (estimated_earnings_per_day)
   are never skipped as they have no API equivalent.

---

## Gaps / Future Work

- `pool_fees_percentage` — derived from HTML only.  Would require Ocean.xyz to
  expose a `/fee_schedule` or `/earnings_detail` endpoint to move API-primary.
- `estimated_earnings_per_day` — Ocean.xyz does not expose a daily earnings
  estimate endpoint.  The `lifetimesnap` card is the only source.
- `est_time_to_payout` — human-readable string not available via API.
- `last_block` (raw formatted string, e.g. "876543 (2h 14m ago)") — partially
  reconstructable from API but the age-formatted string is scrape-only.

---

_See `API_FIELD_COVERAGE` dict in `data_service.py` for the authoritative machine-readable version._
