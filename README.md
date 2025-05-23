# DeepSea Dashboard

## A Retro Mining Monitoring Solution

This open-source dashboard monitors Ocean.xyz pool miners in real time.
It presents hashrate, profitability, worker status and network metrics
through a retro terminal interface. The goal is to keep miners fully
informed with minimal fuss.

---
## Gallery:

![DeepSea Boot](https://github.com/user-attachments/assets/77222f13-1e95-48ee-a418-afd0e6b7a920)
![DeepSea Config](https://github.com/user-attachments/assets/e23859bd-76f3-4239-aa6b-060b5bf13f1b)
![DeepSea Dashboard](https://github.com/user-attachments/assets/8a96fd5e-5ba2-4e0e-be83-965ecb046671)
![DeepSea Workers](https://github.com/user-attachments/assets/075d3f25-bbfb-4e0d-a4d1-1e7f23b96715)
![DeepSea Blocks](https://github.com/user-attachments/assets/078fc533-62c7-4375-bdb4-5f33e4a07925)
![DeepSea Notifications](https://github.com/user-attachments/assets/881ffac0-e447-4455-8b6e-39e2aac1b94e)


---

## Key Features


### Real-Time Mining Metrics
- **Live Hashrate Tracking**: Monitor 60-second, 10-minute, 3-hour, and 24-hour average hashrates
- **Profitability Analysis**: View daily and monthly earnings in both BTC and USD
- **Financial Calculations**: Automatically calculate revenue, power costs, and net profit
- **Break-Even Electricity Price**: Shows the maximum power rate that still yields profit
- **Network Statistics**: Track current Bitcoin price, difficulty, and network hashrate
- **Payout Monitoring**: View unpaid balance and estimated time to next payout
- **Pool Fee Analysis**: Monitor pool fee percentages with visual indicator when optimal rates (0.9-1.3%) are detected
- **Official Ocean API**: Supplement scraping with data from the official Ocean.xyz API for greater accuracy
- **Scraping Fallback**: When the API lacks payout history, the dashboard
  scrapes each stats page to fill in missing records.

### Multi-Currency Support
- **Flexible Currency Configuration**: Set your preferred fiat currency for displaying Bitcoin value and earnings
- **Wide Currency Selection**: Choose from USD, EUR, GBP, JPY, CAD, AUD, CNY, KRW, BRL, CHF and more
- **Real-Time Exchange Rates**: Automatically fetches up-to-date exchange rates from public APIs
- **Persistent Configuration**: Currency preferences saved and restored between sessions
- **Adaptive Notifications**: Financial notifications display in your selected currency

### Worker Management
- **Fleet Overview**: Comprehensive view of all mining devices in one interface
- **Status Monitoring**: Real-time status indicators for online and offline devices
- **Performance Data**: Individual hashrate, temperature, and acceptance rate metrics
- **Filtering Options**: Sort and search by device type or operational status

### Bitcoin Block Explorer
- **Recent Blocks**: View the latest blocks added to the blockchain
- **Block Details**: Examine transaction counts, fees, and mining pool information
- **Visual Indicators**: Track network difficulty and block discovery times
- **Pagination Controls**: Seamlessly move between older and newer blocks with a quick link back to the latest view

### Earnings Page
- **Detailed Earnings Breakdown**: View earnings by time period (daily, weekly, monthly)
- **Currency Conversion**: Automatically convert earnings to your preferred
  fiat currency. Profitability metrics are calculated in USD first and
  converted using live rates.
- **Historical Data**: Access past earnings data for analysis

### System Resilience
- **Connection Recovery**: Automatic reconnection after network interruptions
- **Backup Polling**: Fallback to traditional polling if real-time connection fails
- **API Worker Fallback**: Uses the Ocean.xyz API for worker lists when HTML parsing fails
- **Cross-Tab Synchronization**: Data consistency across multiple browser tabs
- **Server Health Monitoring**: Built-in watchdog processes ensure reliability
- **Error Handling**: Displays a user-friendly error page (`error.html`) for unexpected issues.

### Distinctive Design Elements
- **Retro Terminal Aesthetic**: Nostalgic interface with modern functionality
- **Boot Sequence Animation**: Engaging initialization sequence on startup
- **System Monitor**: Floating status display with uptime and refresh information
- **Responsive Interface**: Adapts to desktop and mobile devices
- **Ambient Audio**: Soft ocean sounds play in the DeepSea theme while the Bitcoin theme cycles through
  `bitcoin.mp3`, `bitcoin1.mp3` and `bitcoin2.mp3`. Playback position persists between page loads. Place the files
  in `static/audio/`. The Docker configuration mounts this directory automatically. Hover the speaker icon to reveal
  a vertical volume slider. Tracks now crossfade seamlessly with a 2 second overlap and when switching themes.

### DeepSea Theme
- **Underwater Effects**: Light rays and digital noise create an immersive experience.
- **Retro Glitch Effects**: Subtle animations for a nostalgic feel.
- **Theme Toggle**: Switch between Bitcoin and DeepSea themes with a single click.

## Documentation

Comprehensive guides have been moved to the `docs` directory:

- [Installation guide](docs/INSTALL.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Configuration options](docs/CONFIGURATION.md)
- [Worker naming guide](docs/WORKER-NAMING.md)
- [Testing guide](docs/TESTING.md)

### Customization

You can modify the following environment variables in the `docker-compose.yml` file:
- `WALLET`: Your Bitcoin wallet address.
- `POWER_COST`: Cost of power per kWh.
- `POWER_USAGE`: Power usage in watts.
- `NETWORK_FEE`: Additional fees beyond pool fees (e.g., firmware fees).
- `TIMEZONE`: Local timezone for displaying time information.
- `CURRENCY`: Preferred fiat currency for earnings display.
- `EXCHANGE_RATE_API_KEY`: ExchangeRate-API key used for fetching currency rates.
  Falls back to `config.json` if unset. Metrics requiring currency conversion
  will not work without a valid key.

Redis data is stored in a persistent volume (`redis_data`), and application logs
are saved in the `./logs` directory. Logs rotate automatically when they reach
5MB, with up to five backups kept.

For more details, refer to the [docker-compose documentation](https://docs.docker.com/compose/).

## Dashboard Components

### Main Dashboard

- Interactive hashrate visualization with trend analysis
- Real-time profitability metrics with cost calculations
- Network statistics with difficulty and price tracking
- Payout information with estimation timing
- Visual indicators for metric changes

### Workers Dashboard

- Fleet summary with aggregate statistics
- Individual worker cards with detailed metrics
- Status indicators with color-coded alerts
- Search and filtering functionality
- Performance trend mini-charts

### Earnings Page
- Detailed earnings breakdown by time period
- Currency conversion for earnings in selected fiat
- Historical data for earnings analysis

### Blocks Explorer

- Recent block visualization with mining details
- Transaction statistics and fee information
- Mining pool attribution
- Block details modal with comprehensive data

### Notifications
- Real-time alerts for important events
- Notification history with read/unread status

### System Monitor

- Floating interface providing system statistics
- Progress indicator for data refresh cycles
- System uptime display
- Real-time connection status

## System Requirements

The application is designed for efficient resource utilization:
- **Server**: Any system capable of running Python 3.9+
- **Memory**: Minimal requirements (~100MB RAM)
- **Storage**: Less than 50MB for application files
- **Database**: Optional Redis for persistent state
- **Compatible with**: Windows, macOS, and Linux

## Development

To set up a development environment:

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Prepare directories and assets:
   ```bash
   make setup
   ```
   Run `make minify` whenever static files or templates change.
3. Check code style with ruff:
   ```bash
   ruff check .
   ```
4. Execute tests:
   ```bash
   pytest
   ```

See the [Testing guide](docs/TESTING.md) for more details.


## Technical Architecture

Built with a modern stack for reliability and performance:
- **Backend**: Flask with Server-Sent Events for real-time updates
- **Frontend**: Vanilla JavaScript with Chart.js for visualization
- **Data Processing**: Concurrent API calls with smart caching
- **Resilience**: Automatic recovery mechanisms and state persistence
- **Configuration**: Environment variables and JSON-based settings

## Historical Data Retention

The dashboard stores a rolling window of historical metrics in memory. Each
dataset (arrow history, metrics log and hashrate history) is capped at 180
entries, equating to roughly three hours of data. Older points are pruned by the
`StateManager` before saving to Redis, ensuring memory usage remains stable.
Short-term variance history for earnings metrics is also persisted so 3-hour
variance values remain visible after restarts.

## API Endpoints
- `/api/metrics`: Provides real-time mining metrics.
- `/api/available_timezones`: Returns a list of supported timezones.
- `/api/config`: Fetches or updates the mining configuration.
- `/api/health`: Returns the health status of the application.
- `/api/notifications`: Manages notifications for the user.
- `/api/workers`: Manages worker data and status.
- `api/time`: Returns the current server time.
- `api/timezone`: Returns the current timezone.
- `api/scheduler-health`: Returns the health status of the scheduler.
- `api/fix-scheduler`: Fixes the scheduler if it is not running.
- `api/force-refresh`: Forces a refresh of the data.
- `api/reset-chart-data`: Resets the chart data.
- `api/memory-profile`: Returns the memory profile of the application.
- `api/memory-history`: Returns the memory history of the application.
- `api/force-gc`: Forces garbage collection to free up memory.
- `api/notifications/clear`: Clears all notifications.
- `api/notifications/delete`: Deletes a specific notification.
- `api/notifications/mark_read`: Marks a notification as read.
- `api/notifications/unread_count`: Returns the count of unread notifications.

## Project Structure

The project follows a modular architecture with clear separation of concerns:

```
DeepSea-Dashboard/
│
├── App.py                      # Main application entry point
├── config.py                   # Configuration management
├── config.json                 # Configuration file
├── data_service.py             # Service for fetching mining data
├── models.py                   # Data models
├── state_manager.py            # Manager for persistent state
├── worker_service.py           # Service for worker data management
├── notification_service.py     # Service for notifications
├── minify.py                   # Script for minifying assets
├── setup.py                    # Setup script for organizing files
├── Makefile                    # Common development commands
├── requirements.txt            # Python dependencies
├── Dockerfile                  # Docker configuration
├── docker-compose.yml          # Docker Compose configuration
DeepSea-Dashboard/
│
├── templates/                  # HTML templates
│   ├── base.html              # Base template with common elements
│   ├── boot.html              # Boot sequence animation
│   ├── dashboard.html         # Main dashboard template
│   ├── workers.html           # Workers dashboard template
│   ├── blocks.html            # Bitcoin blocks template
│   ├── notifications.html     # Notifications template
│   ├── earnings.html          # Earnings page template
│   └── error.html             # Error page template
│
├── static/                     # Static assets
│   ├── css/                   # CSS files
│   │   ├── common.css         # Shared styles across all pages
│   │   ├── dashboard.css      # Main dashboard styles
│   │   ├── workers.css        # Workers page styles
│   │   ├── boot.css           # Boot sequence styles
│   │   ├── blocks.css         # Blocks page styles
│   │   ├── notifications.css  # Notifications page styles
│   │   ├── earnings.css       # Earnings page styles
│   │   ├── error.css          # Error page styles
│   │   ├── retro-refresh.css  # Floating refresh bar styles
│   │   └── theme-toggle.css   # Theme toggle styles
│   │
│   └── js/                    # JavaScript files
│       ├── main.js            # Main dashboard functionality
│       ├── workers.js         # Workers page functionality
│       ├── blocks.js          # Blocks page functionality
│       ├── notifications.js   # Notifications functionality
│       ├── earnings.js        # Earnings page functionality
│       ├── block-animation.js # Block mining animation
│       ├── BitcoinProgressBar.js # System monitor functionality
│       └── theme.js           # Theme toggle functionality
│
├── docs/DEPLOYMENT.md          # Deployment guide
├── project_structure.md        # Additional structure documentation
├── LICENSE.md                  # License information
└── logs/                       # Application logs (generated at runtime)
```

For more details on the architecture and component interactions,
see [project_structure.md](project_structure.md).

## Troubleshooting

For optimal performance:

1. Ensure your wallet address is correctly configured
2. Check network connectivity for consistent updates
3. Use the system monitor to verify connection status
4. Access the health endpoint at `/api/health` for diagnostics
5. For stale data issues, use the Force Refresh function
6. Use hotkey Shift+R to clear chart and Redis data (as needed, not required)
7. Check the currency settings if financial calculations appear incorrect
8. Verify timezone settings for accurate time displays
9. Alt + W on Dashboard resets wallet configuration and redirects to Boot sequence
10. If block event lines persist, run `window.clearBlockAnnotations()` in your
    browser console to remove them. Older annotations are pruned automatically.

## Easter Egg

Activate the Konami Code (⇡ ⇡ ⇣ ⇣ ◀ ▶ ◀ ▶ b a) on any page to reveal a brief
deep sea surprise complete with random fun facts!

## Debug Logging

Client-side logging can be noisy in production. All `console.log` calls are
wrapped with a simple debug flag. Set `localStorage.setItem('debugLogging',
'true')` in your browser to enable verbose logging. Remove the item or set it to
`false` to silence debug output.

## License

Available under the MIT License. This is an independent project not affiliated with Ocean.xyz.

## Acknowledgments

- Ocean.xyz mining pool for their service
- mempool.guide
- The open-source community for their contributions
- Bitcoin protocol developers
