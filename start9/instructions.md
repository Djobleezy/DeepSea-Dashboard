# DeepSea Dashboard - StartOS Instructions

## Getting Started

1. Install DeepSea Dashboard from the Start9 Marketplace
2. Start the service
3. Click **Launch UI** to open the dashboard

## Configuration

DeepSea Dashboard automatically connects to the Ocean.xyz mining pool API. No configuration is required for basic operation.

To customize your dashboard (wallet address, notification preferences, theme), use the Settings page within the web interface.

## Data Storage

- **Database:** Mining metrics and notification history are stored in SQLite at `/root/.data/deepsea.db`
- **Config:** Dashboard configuration is stored at `/root/.config/config.json`
- Both are included in backups automatically

## Accessing Over Tor

Your DeepSea Dashboard is accessible over Tor. Use the `.onion` address shown on the service page.

## Troubleshooting

- If the dashboard shows no data, ensure your Ocean.xyz wallet address is configured in Settings
- The dashboard refreshes data every 30 seconds automatically
- Check the health indicator on the StartOS service page — it should show green when the web interface is responding

## More Information

- [GitHub Repository](https://github.com/Djobleezy/DeepSea-Dashboard)
- [Issue Tracker](https://github.com/Djobleezy/DeepSea-Dashboard/issues)
