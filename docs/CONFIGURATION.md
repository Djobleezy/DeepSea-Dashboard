# Configuration

The dashboard can be customized through a combination of a `config.json` file and environment variables. Environment variables always override values found in the configuration file.

Profitability calculations are always performed in USD. When a non-USD currency is configured, values are converted using the latest exchange rates before being displayed.

## `config.json`

The default configuration file contains the following keys:

| Key | Description | Default |
|-----|-------------|---------|
| `power_cost` | Electricity cost per kWh | `0.0` |
| `power_usage` | Power usage in watts | `0.0` |
| `wallet` | Ocean.xyz wallet address | `"yourwallethere"` |
| `timezone` | Local timezone identifier | `"America/Los_Angeles"` |
| `network_fee` | Additional fees beyond pool fees | `0.0` |
| `currency` | Preferred fiat currency for earnings display | `"USD"` |

Configuration files are validated when loaded. Missing keys or incorrect types
cause the application to fall back to default values and log an error.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL for persistent state | None |
| `WALLET` | Ocean.xyz wallet address | from `config.json` |
| `POWER_COST` | Electricity cost per kWh | from `config.json` |
| `POWER_USAGE` | Power consumption in watts | from `config.json` |
| `NETWORK_FEE` | Additional fees beyond pool fees | from `config.json` |
| `TIMEZONE` | Local timezone identifier | from `config.json` |
| `CURRENCY` | Preferred fiat currency | from `config.json` |
| `FLASK_ENV` | Application environment | `development` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `PORT` | Application port | `5000` |

Refer to [INSTALL.md](INSTALL.md) and [DEPLOYMENT.md](DEPLOYMENT.md) for instructions on how these variables are used during setup and deployment.

## Caching

Expensive operations such as network requests, complex calculations and Redis queries are cached to reduce
load on external services. Results are retained for up to 60 seconds before being refreshed. The built-in
cache requires no configuration.
