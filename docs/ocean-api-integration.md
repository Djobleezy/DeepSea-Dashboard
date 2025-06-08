# Ocean.xyz API Integration

This application integrates with the [Ocean.xyz](https://ocean.xyz) mining pool API to retrieve user hashrates, payout data, and other mining stats.

Base URL:  
https://api.ocean.xyz/v1

Example Request:  
https://api.ocean.xyz/v1/user_hashrate/3QomtEj5nfzEkxPXoVD3hvxgJDzA6M6evt

---

## API Endpoints Used

| Endpoint | Description | Arguments | Returns |
|----------|-------------|-----------|---------|
| /ping | Server status test | None | "PONG" |
| /statsnap/{username} | Latest TIDES snapshot for a user or worker | username[.workername] | Hashrate, shares, earnings estimation |
| /pool_stat | Pool-wide stats (hashrate, workers, blocks) | None | Stats snapshot of active users, workers, and blocks found |
| /pool_hashrate | Pool-wide hashrate info | None | Hashrate averages over 60s and 300s |
| /userinfo_full/{username} | statsnap for all of a user’s workers | username | Array of statsnap results per worker |
| /multitemplate_stats | Multitemplate share breakdown | None | Array of shares per mining template |
| /monthly_payout_report/{username}/[YYYY-MM]/[text|csv|json] | Monthly payouts for a user | Optional date & format | List of payouts (default is JSON) |
| /monthly_earnings_report/{username}/[YYYY-MM]/[text|csv|json] | Monthly earnings per block | Optional date & format | List of block-level earnings (default is JSON) |
| /blocks/[page]/[page_size]/[include_legacy] | Ocean blocks found | Optional pagination and legacy flag | Array of block metadata |
| /latest_block | Latest block info | None | Same as /blocks/0/1/0 |
| /user_hashrate/{username} | Latest hashrate snapshot | username | Hashrate estimates across multiple intervals |
| /user_hashrate_full/{username} | Full hashrate data for all workers | username | Array of hashrates per worker plus total |
| /earnpay/{username}/[start]/[end] | Earnings and payouts for a time range | Optional timestamps | Earnings and payout summary |
| /monthly_user_report/{username}/[YYYY-MM]/[text|csv|json] | Daily user earnings and hashrate | Optional date & format | Daily snapshot report |

---

## Example: /statsnap/{username}

{
  "snap_type": "user",
  "snap_ts": 1710000000,
  "shares_60s": 12,
  "shares_300s": 60,
  "hashrate_60s": 68719476736,
  "hashrate_300s": 68719476736,
  "lastest_share_ts": 1709999940,
  "shares_in_tides": 300,
  "estimated_earn_next_block": 100000,
  "estimated_bonus_earn_next_block": 0,
  "estimated_total_earn_next_block": 100000,
  "estimated_payout_next_block": 150000,
  "unpaid": 50000
}

---

## Example: /monthly_payout_report/{username}

[
  {
    "TimeUTC": "2025-05-01T00:00:00Z",
    "PayoutAmt": 200000,
    "PayoutAddress": "3QomtEj5nfzEkxPXoVD3hvxgJDzA6M6evt",
    "TXID": "abcd1234...",
    "Generated": true
  }
]

---

##  Notes

- username typically refers to the user's Bitcoin payout address.
- Append /csv or /text to endpoints to receive alternate formats if supported.
- Ocean uses a proprietary reward model called TIDES, which depends on time-based difficulty1 share logs.
- The dashboard calculates rewards dynamically using the current block subsidy and the `avg_fee_per_block` metric.
- Timestamps can be formatted as:
  - YYYY-MM-DD
  - YYYY-MM-DDTHH:MM:SS
  - Unix timestamps
- To estimate hashrate from shares:
  hashrate = (difficulty1_shares * 2^32) / time_window_in_seconds

---

## References

- https://ocean.xyz
- https://ocean.xyz/tides
