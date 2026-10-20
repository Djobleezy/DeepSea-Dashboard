# Configuration Reference

DeepSea Dashboard reads its active configuration from `/config/config.json` in Docker.
Copy `config.json.example` to `config.json` and edit it before the first start.
The default Compose setup imports that file into a persistent named volume once;
later changes belong on the dashboard Config page. Editing the original seed file
does not overwrite saved settings.

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

Your electricity rate in US dollars per kilowatt-hour. The Config and Workers
pages share this saved rate. Both pages use it for daily power-cost and profit
estimates; changing it in either place updates the same setting.

On upgrade, an existing custom Workers rate is imported once if the Config rate
is still the default. An already customized Config rate takes precedence. Later
changes always use the shared setting and do not re-import the old value.

---

### `power_usage`
- **Type:** `float` (watts)
- **Default:** `3000`
- **Range:** `0` – `100,000`

Fallback total power draw in **watts**, used when worker power data is unavailable.
When workers are available, the dashboard uses their estimated power draw and
saved overrides instead. Offline workers use zero estimated watts unless you
set an explicit fixed-power override. Daily cost is
`(effective_power_watts / 1000) × 24 × power_cost`.

Worker earnings and the unpaid balance are separate from estimated daily
revenue. Daily profit subtracts one day's power cost from estimated daily
revenue, not from the accumulated unpaid balance. These are projections;
actual payouts depend on pool luck, fees, and variance.

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

Optional URL of a local [DATUM Gateway](https://github.com/OCEAN-xyz/datum_gateway).
The dashboard checks its `/umbrel-api` widget endpoint, with a TCP connection
on port 23334 as a fallback, and reports **gateway reachability**.

Reachability does not prove an active connection to the DATUM pool. In DATUM
v0.4.1 the widget reports miner connections and hashrate, but no live pool
connection status. `/api/datum/status` returns `reachable`, `unreachable`, or
`unknown` independently of historical fees. Historical pool fees are shown only
as supporting evidence;
they do not establish whether the gateway is currently connected or offline.

`DATUM_GATEWAY_URL` overrides this setting when it contains a valid URL. Hosts
must be loopback, private IP addresses, or supported local Docker service names.
The probe is cached for 15 seconds and each HTTP/TCP attempt times out after
2 seconds. A failed check can indicate an incorrect address or network problem
while the gateway itself remains active.

With no explicit gateway URL, `DATUM_GATEWAY_AUTODISCOVER=1` enables checks of
the standard Umbrel address and loopback API ports 7152 and 21000. Each candidate
tries the widget and then Stratum; candidates run concurrently under a 6-second
total deadline. If none responds, the status is `unreachable`, rather than
`unknown` (which means no check is configured or no result is available).

---

### `low_hashrate_threshold_ths`
- **Type:** `float` (TH/s)
- **Default:** `3.0`
- **Range:** `0`–`1,000,000`; finite values only. Set `0` to disable.

The **3-hour average** below which the dashboard enters low-hashrate mode. Charts
emphasize the steadier 3-hour series, dashboard labels explain short-window
variance, and hashrate-drop alerts use a more tolerant threshold. At exactly the
configured boundary, normal mode applies. Change this value on the Configuration
page or through `POST /api/config`; it is also returned by `GET /api/config`.
Saving the setting updates the current snapshot immediately without changing
the age of its mining data or waiting for the next Ocean request.

Invalid values in a hand-edited configuration file fall back to `3.0`.

---

### Legacy `high_hashrate_threshold_ths`

This old example setting has no effect and is no longer offered. Existing files
may retain it for compatibility. Hashrate units scale automatically at standard
SI boundaries: `1 TH/s`, `1,000 TH/s` (PH/s), and `1,000,000 TH/s` (EH/s), rather
than at an arbitrary high-rate threshold.

---

## Full Example

```json
{
  "wallet": "",
  "power_cost": 0.12,
  "power_usage": 3000,
  "currency": "USD",
  "timezone": "America/Los_Angeles",
  "network_fee": 2.0,
  "extended_history": false,
  "exchange_rate_api_key": "",
  "datum_gateway_url": "",
  "low_hashrate_threshold_ths": 3.0
}
```

## Docker Usage

The repository's `docker-compose.yml` includes a one-shot `config-init` service.
It imports `./config.json` from a read-only mount, including private files with
`0600` permissions, into the `deepsea-config` volume. The initializer assigns
the active file to the unprivileged app user with owner-only permissions, then
exits. The dashboard starts only after initialization succeeds.

Existing settings are preserved on restart and container recreation. The host
seed file is neither modified nor given broader permissions. Export active settings with
`docker compose cp app:/config/config.json ./config.backup.json`.

For custom bind mounts of the active file, make sure the container user owns and
can write the file and its parent directory; otherwise dashboard saves will fail.

The config path can be overridden with the `CONFIG_PATH` environment variable:

```yaml
environment:
  - CONFIG_PATH=/app/myconfig.json
```

## Security Note

`config.json` is written with `0600` permissions (owner read/write only). Do not commit your
real `config.json` to version control — the file contains your Bitcoin wallet address.
`config.json` is already listed in `.gitignore`.
