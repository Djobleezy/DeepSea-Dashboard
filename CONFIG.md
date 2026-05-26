# Configuration Reference

DeepSea Dashboard is configured via `config.json` (mounted at `/config/config.json` in Docker).
Copy `config.json.example` to `config.json` and edit as needed.

All fields are optional except `wallet`. Missing fields fall back to the defaults listed below.

---

## Fields

### `wallet`
- **Type:** `string`
- **Required:** Yes
- **Example:** `"bc1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`

Your Bitcoin address registered with [Ocean.xyz](https://ocean.xyz). This is used to fetch your
hashrate, unpaid earnings, payout history, and worker data from the Ocean API. Without a valid
wallet address the dashboard shows only network-level data.

---

### `power_cost`
- **Type:** `float` ($/kWh)
- **Default:** `0.12`
- **Range:** `0.00` – `10.00`

Your electricity rate in US dollars per kilowatt-hour. Used together with `power_usage` to
calculate daily power cost and profitability estimates.

---

### `power_usage`
- **Type:** `float` (watts)
- **Default:** `3000`
- **Range:** `0` – `100,000`

Total power draw of your mining rigs in **watts**. If you run multiple ASICs, sum their rated
wattages. Used to compute `daily_power_cost = (power_usage / 1000) × 24 × power_cost`.

---

### `currency`
- **Type:** `string` (ISO 4217, 3-letter uppercase)
- **Default:** `"USD"`
- **Examples:** `"USD"`, `"EUR"`, `"GBP"`, `"AUD"`, `"CAD"`

Display currency for profit/revenue figures. The dashboard fetches the BTC→USD price from
mempool.space and converts using the exchange rate fetched from the configured API (see
`exchange_rate_api_key`). If no API key is configured, only USD is available.

---

### `timezone`
- **Type:** `string` (IANA timezone name)
- **Default:** `"America/Los_Angeles"`
- **Examples:** `"America/New_York"`, `"Europe/London"`, `"Asia/Tokyo"`, `"UTC"`

Timezone used for displaying timestamps (last share, payout dates, block times).
Must be a valid [IANA timezone identifier](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

---

### `network_fee`
- **Type:** `float` (percentage)
- **Default:** `2.0`
- **Range:** `0.0` – `100.0`

Ocean.xyz pool fee percentage. Used in earnings projections. Ocean's standard fee is 2%;
update this if the fee structure changes.

---

### `extended_history`
- **Type:** `boolean`
- **Default:** `false`

When `true`, the dashboard fetches up to 360 days of payout history instead of the default 90
days. Enabling this may increase load time for the earnings view.

---

### `exchange_rate_api_key`
- **Type:** `string`
- **Default:** `""` (disabled)
- **Example:** `"abc123yourkeyhere"`

Optional API key for a currency exchange rate provider. Required if `currency` is set to
anything other than `"USD"`. Leave empty if you only need USD display.

---

### `datum_gateway_url`
- **Type:** `string` (URL)
- **Default:** `""` (disabled)
- **Examples:**
  - UmbrelOS (DATUM app installed): `"http://datum_datum_1:21000"`
  - Stock self-build on the same host: `"http://127.0.0.1:7152"`
  - Bare metal on the LAN: `"http://192.168.1.50:21000"`
- **Environment override:** `DATUM_GATEWAY_URL`

Optional URL of a local [DATUM Gateway](https://github.com/OCEAN-xyz/datum_gateway). When set,
the dashboard probes the gateway directly (via its `/umbrel-api` JSON endpoint and a TCP
stratum-port check as a fallback) to render a **real-time** DATUM connection badge.

**Why this matters:** the default DATUM badge is derived from `pool_fees_percentage`, which is
an *average* of historical work as reported on Ocean's stats page. After a user enables DATUM
that average can take **hours or days** to land inside the 0.9%–1.3% "DATUM range" — during
that window the badge would show OFFLINE even though the gateway is fully operational. Setting
`datum_gateway_url` gives the dashboard a current-state signal so it can show a clearly
labelled "DATUM ACTIVE (fees settling)" badge during that transition window.

The environment variable `DATUM_GATEWAY_URL` overrides this field at request time, which is
useful for Docker / Umbrel compose setups where you'd rather wire the URL via the service
rather than the JSON file.

Probe traffic is small (one ~2 s HTTP `GET` cached for 15 s) and never leaves your network.

---

### `low_hashrate_threshold_ths`
- **Type:** `float` (TH/s)
- **Default:** `3.0`

Hashrate (in TH/s) below which the dashboard enters **low-hashrate mode**. In this mode the UI
may display simplified metrics suitable for small miners or single BitAxe units. Triggers an
informational status indicator in the header.

---

### `high_hashrate_threshold_ths`
- **Type:** `float` (TH/s)
- **Default:** `20.0`

Hashrate (in TH/s) above which the dashboard uses larger-scale display formatting. Set to
match the upper end of your expected operating range.

---

## Full Example

```json
{
  "wallet": "bc1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "power_cost": 0.12,
  "power_usage": 3000,
  "currency": "USD",
  "timezone": "America/Los_Angeles",
  "network_fee": 2.0,
  "extended_history": false,
  "exchange_rate_api_key": "",
  "datum_gateway_url": "",
  "low_hashrate_threshold_ths": 3.0,
  "high_hashrate_threshold_ths": 20.0
}
```

## Docker Usage

```yaml
volumes:
  - ./config.json:/config/config.json
```

The config path can be overridden with the `CONFIG_PATH` environment variable:

```yaml
environment:
  - CONFIG_PATH=/app/myconfig.json
```

## Security Note

`config.json` is written with `0600` permissions (owner read/write only). Do not commit your
real `config.json` to version control — the file contains your Bitcoin wallet address.
`config.json` is already listed in `.gitignore`.
