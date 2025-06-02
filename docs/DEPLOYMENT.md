# Deployment Guide

This guide provides comprehensive instructions for deploying the Bitcoin Mining Dashboard application in various environments, from development to production.

## Prerequisites

- Python 3.9 or higher
- Redis server (optional, for persistent state and improved reliability)
- Docker and Docker Compose (optional, for containerized deployment)
- Network access to Ocean.xyz API endpoints
- Modern web browser (Chrome, Firefox, Edge recommended)

## Installation Options

### Option 1: Standard Installation (Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/Djobleezy/DeepSea-Dashboard.git
   cd DeepSea-Dashboard
   ```

2. Create a virtual environment (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Run the setup script to organize files:
   ```bash
   python setup.py
   ```

5. Start the application:
   ```bash
   python App.py
   ```

6. Access the dashboard at `http://localhost:5000`

### Option 2: Production Deployment with Gunicorn

For better performance and reliability in production environments:

1. Follow steps 1-5 from standard installation

2. Install Gunicorn if not already installed:
   ```bash
   pip install gunicorn
   ```

3. Start with Gunicorn:
   ```bash
   gunicorn -b 0.0.0.0:5000 App:app --workers=1 --threads=16 --timeout=600 --keep-alive=5
   ```

   > **Important**: Use only 1 worker to maintain shared state. Use threads for concurrency.

4. For a more robust setup, create a systemd service:
   ```bash
   sudo nano /etc/systemd/system/mining-dashboard.service
   ```

   Add the following content:
   ```
   [Unit]
   Description=Bitcoin Mining Dashboard
   After=network.target

   [Service]
   User=your_username
   WorkingDirectory=/path/to/bitcoin-mining-dashboard
   ExecStart=/path/to/venv/bin/gunicorn -b 0.0.0.0:5000 App:app --workers=1 --threads=16 --timeout=600 --keep-alive=5
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

5. Enable and start the service:
   ```bash
   sudo systemctl enable mining-dashboard
   sudo systemctl start mining-dashboard
   ```

### Option 3: Docker Deployment

1. Build the Docker image:
   ```bash
   docker build -t bitcoin-mining-dashboard .
   ```

2. Run the container:
   ```bash
    docker run -d -p 5000:5000 \
      -e WALLET=your-wallet-address \
      -e POWER_COST=0.12 \
      -e POWER_USAGE=3450 \
      -v $(pwd)/logs:/app/logs \
      -v $(pwd)/static/audio:/app/static/audio \
      -v $(pwd)/static/vendor:/app/static/vendor \
      -v $(pwd)/static/css:/app/static/css \
      -v $(pwd)/static/js:/app/static/js \
      -v $(pwd)/static/favicon:/app/static/favicon \
      -v $(pwd)/templates:/app/templates \
      --name mining-dashboard \
      bitcoin-mining-dashboard
   ```

   The `static/audio` directory should contain the background tracks and an optional
   `block.mp3` file that plays when a new block is found.

3. Access the dashboard at `http://localhost:5000`

### Option 4: Docker Compose with Redis Persistence

1. Create a `docker-compose.yml` file:
   ```yaml
   version: '3'
   
   services:
     redis:
       image: redis:alpine
       restart: unless-stopped
       volumes:
         - redis_data:/data
     
     dashboard:
       build: .
       restart: unless-stopped
       ports:
         - "5000:5000"
       environment:
        - REDIS_URL=redis://redis:6379
        - WALLET=your-wallet-address
        - POWER_COST=0.12
        - POWER_USAGE=3450
      volumes:
        - ./logs:/app/logs
        - ./static/audio:/app/static/audio  # include block.mp3 here if desired
        - ./static/vendor:/app/static/vendor
        - ./static/css:/app/static/css
        - ./static/js:/app/static/js
        - ./static/favicon:/app/static/favicon
        - ./templates:/app/templates
      depends_on:
        - redis
   
   volumes:
     redis_data:
   ```

2. Launch the services:
   ```bash
   docker-compose up -d
   ```

3. Access the dashboard at `http://localhost:5000`

## Environment Variables

The application can be configured using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL for persistent state | None |
| `WALLET` | Ocean.xyz wallet address | From config.json |
| `POWER_COST` | Electricity cost per kWh | From config.json |
| `POWER_USAGE` | Power consumption in watts | From config.json |
| `FLASK_ENV` | Application environment | development |
| `LOG_LEVEL` | Logging level | INFO |
| `PORT` | Application port | 5000 |

## Reverse Proxy Configuration

For production deployments, it's recommended to use a reverse proxy like Nginx:

1. Install Nginx:
   ```bash
   sudo apt update
   sudo apt install nginx
   ```

2. Create a configuration file:
   ```bash
   sudo nano /etc/nginx/sites-available/mining-dashboard
   ```

3. Add the following configuration:
   ```
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_buffering off;
           proxy_cache off;
       }
   }
   ```

4. Create a symbolic link:
   ```bash
   sudo ln -s /etc/nginx/sites-available/mining-dashboard /etc/nginx/sites-enabled/
   ```

5. Test and restart Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl restart nginx
   ```

6. (Optional) Add SSL with Certbot:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

## Maintenance

### Logs

Logs are stored in the `logs` directory by default and rotate automatically when they reach 5MB (up to five backups). Monitor these logs for errors and warnings:

```bash
tail -f logs/dashboard.log
```

Common log patterns to watch for:
- `ERROR fetching metrics` - Indicates issues with Ocean.xyz API
- `Failed to connect to Redis` - Redis connection problems
- `Scheduler stopped unexpectedly` - Background job issues

### Health Monitoring

#### Health Check Endpoint

A health check endpoint is available at `/api/health` that returns:
- Application status (healthy, degraded, unhealthy)
- Uptime information
- Memory usage
- Data freshness
- Redis connection status
- Scheduler status

Example health check command:
```bash
curl http://localhost:5000/api/health | jq
```

#### Scheduler Health

To monitor the scheduler:
```bash
curl http://localhost:5000/api/scheduler-health | jq
```

### Performance Tuning

1. **Redis Configuration**: For high-traffic deployments, tune Redis:
   ```
   maxmemory 256mb
   maxmemory-policy allkeys-lru
   ```

2. **Gunicorn Threads**: Adjust thread count based on CPU cores:
   ```
   --threads=$(( 2 * $(nproc) ))
   ```

3. **Browser Cache Headers**: Already optimized in the application

## Troubleshooting

### Common Issues

1. **Application not updating data**:
   - Check network connectivity to Ocean.xyz
   - Verify scheduler health:
     ```bash
     curl http://localhost:5000/api/scheduler-health
     ```
   - Force a data refresh:
     ```bash
     curl -X POST http://localhost:5000/api/force-refresh
     ```

2. **High memory usage**:
   - Check for memory leaks in log files
   - Restart the application
   - Enable Redis for better state management

3. **Scheduler failures**:
   - Fix the scheduler:
     ```bash
     curl -X POST http://localhost:5000/api/fix-scheduler
     ```

4. **Workers not showing**:
   - Verify your wallet address is correct
   - Check worker data:
     ```bash
     curl http://localhost:5000/api/workers
     ```

### Recovery Procedures

If the application becomes unresponsive:

1. Check the logs for error messages
2. Restart the application:
   ```bash
   sudo systemctl restart mining-dashboard
   ```
3. If Redis is used and may be corrupted:
   ```bash
   sudo systemctl restart redis
   ```
4. For Docker deployments:
   ```bash
   docker-compose restart
   ```

## Updating

To update the application:

1. Pull the latest changes:
   ```bash
   git pull origin main
   ```

2. Update dependencies:
   ```bash
   pip install -r requirements.txt --upgrade
   ```

3. Run the setup script:
   ```bash
   python setup.py
   ```

4. Restart the application:
   ```bash
   sudo systemctl restart mining-dashboard
   ```

### Docker Update Procedure

1. Pull the latest changes:
   ```bash
   git pull origin main
   ```

2. Rebuild and restart:
   ```bash
   docker-compose build
   docker-compose up -d
   ```

## Backup Strategy

1. **Configuration**: Regularly backup your `config.json` file
2. **Redis Data**: If using Redis, set up regular RDB snapshots
3. **Logs**: The application rotates `dashboard.log` automatically; archive rotated logs periodically if needed.

## Security Recommendations

1. **Run as Non-Root User**: Always run the application as a non-root user
2. **Firewall Configuration**: Restrict access to ports 5000 and 6379 (Redis)
3. **Redis Authentication**: Enable Redis password authentication:
   ```
   requirepass your_strong_password
   ```
4. **HTTPS**: Use SSL/TLS for all production deployments
5. **Regular Updates**: Keep all dependencies updated
