# Enhanced Project Structure Documentation

This document provides a comprehensive overview of the Bitcoin Mining Dashboard project architecture, component relationships, and technical design decisions.

## Directory Structure

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
├── requirements.txt            # Python dependencies
├── Dockerfile                  # Docker configuration
├── docker-compose.yml          # Docker Compose configuration
├── routes/                  # Flask route modules (main_routes.py, memory_routes.py, notification_routes.py)
│
├── templates/                  # HTML templates
│   ├── base.html              # Base template with common elements
│   ├── boot.html              # Boot sequence animation
│   ├── dashboard.html         # Main dashboard template
│   ├── workers.html           # Workers dashboard template
│   ├── blocks.html            # Bitcoin blocks template
│   ├── notifications.html     # Notifications template
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
│   │   ├── error.css          # Error page styles
│   │   ├── retro-refresh.css  # Floating refresh bar styles
│   │   └── theme-toggle.css   # Theme toggle styles
│   │
│   └── js/                    # JavaScript files
│       ├── main.js            # Main dashboard functionality
│       ├── workers.js         # Workers page functionality
│       ├── blocks.js          # Blocks page functionality
│       ├── notifications.js   # Notifications functionality
│       ├── block-animation.js # Block mining animation
│       ├── BitcoinProgressBar.js # System monitor functionality
│       └── theme.js           # Theme toggle functionality
│
├── docs/DEPLOYMENT.md          # Deployment guide
├── project_structure.md        # Additional structure documentation
├── LICENSE.md                  # License information
└── logs/                       # Application logs (generated at runtime)
```

## Core Components

### Backend Services

#### App.py
The main Flask application that serves as the entry point. It:
- Initializes the application and its components
- Registers routes from `routes/main_routes.py` (where most route handlers reside) and configures middleware
- Sets up the background scheduler for data updates
- Manages Server-Sent Events (SSE) connections
- Handles error recovery and graceful shutdown

Key features:
- Custom middleware for error handling
- Connection limiting for SSE to prevent resource exhaustion
- Watchdog process for scheduler health
- Metrics caching with controlled update frequency

#### data_service.py
Service responsible for fetching data from external sources:
- Retrieves mining statistics from Ocean.xyz
- Collects Bitcoin network data (price, difficulty, hashrate)
- Calculates profitability metrics
- Handles connection issues and retries

Notable implementations:
- Concurrent API requests using ThreadPoolExecutor
- Multiple parsing strategies for resilience against HTML changes
- Intelligent caching to reduce API load
- Unit normalization for consistent display

#### worker_service.py
Service for managing worker data:
- Fetches worker statistics from Ocean.xyz
- Simulates worker data when real data is unavailable
- Provides filtering and search capabilities
- Tracks worker status and performance

Key features:
- Fallback data generation for testing or connectivity issues
- Smart worker count synchronization
- Hashrate normalization across different units

#### state_manager.py
Manager for application state and history:
- Maintains hashrate history and metrics over time
- Provides persistence via Redis (optional)
- Implements data pruning to prevent memory growth
- Records indicator arrows for value changes

Implementation details:
- Thread-safe collections with locking
- Optimized storage format for Redis
- Data compression techniques for large state objects
- Automatic recovery of critical state

### Frontend Components

#### Templates
The application uses Jinja2 templates with a retro-themed design:
- **base.html**: Defines the common layout, navigation, and includes shared assets
- **dashboard.html**: Main metrics display with hashrate chart and financial calculations
- **workers.html**: Grid layout of worker cards with filtering controls
- **blocks.html**: Bitcoin block explorer with detailed information
- **boot.html**: Animated terminal boot sequence
- **error.html**: Styled error page with technical information

#### JavaScript Modules
Client-side functionality is organized into modular JavaScript files:
- **main.js**: Dashboard functionality, real-time updates, and chart rendering
- **workers.js**: Worker grid rendering, filtering, and mini-chart creation
- **blocks.js**: Block explorer with data fetching from mempool.guide
- **block-animation.js**: Interactive block mining animation
- **BitcoinProgressBar.js**: Floating system monitor with uptime and connection status

Key client-side features:
- Real-time data updates via Server-Sent Events (SSE)
- Automatic reconnection with exponential backoff
- Cross-tab synchronization using localStorage
- Data normalization for consistent unit display
- Animated UI elements for status changes

## Architecture Overview

### Data Flow

1. **Data Acquisition**:
   - `data_service.py` fetches data from Ocean.xyz and blockchain sources
   - Data is normalized, converted, and enriched with calculated metrics
   - Results are cached in memory

2. **State Management**:
   - `state_manager.py` tracks historical data points
   - Maintains arrow indicators for value changes
   - Optionally persists state to Redis

3. **Background Updates**:
   - Scheduler runs periodic updates (typically once per minute)
   - Updates are throttled to prevent API overload
   - Watchdog monitors scheduler health

4. **Real-time Distribution**:
   - New data is pushed to clients via Server-Sent Events
   - Clients process and render updates without page reloads
   - Connection management prevents resource exhaustion

5. **Client Rendering**:
   - Browser receives and processes JSON updates
   - Chart.js visualizes hashrate trends
   - DOM updates show changes with visual indicators
   - BitcoinProgressBar shows system status

### System Resilience

The application implements multiple resilience mechanisms:

#### Server-Side Resilience
- **Scheduler Recovery**: Auto-detects and restarts failed schedulers
- **Memory Management**: Prunes old data to prevent memory growth
- **Connection Limiting**: Caps maximum concurrent SSE connections
- **Graceful Degradation**: Falls back to simpler data when sources are unavailable
- **Adaptive Parsing**: Multiple strategies to handle API and HTML changes

#### Client-Side Resilience
- **Connection Recovery**: Automatic reconnection with exponential backoff
- **Fallback Polling**: Switches to traditional AJAX if SSE fails
- **Local Storage Synchronization**: Shares data across browser tabs
- **Visibility Handling**: Optimizes updates based on page visibility

### Technical Design Decisions

#### Server-Sent Events vs WebSockets
The application uses SSE instead of WebSockets because:
- Data flow is primarily one-directional (server to client)
- SSE has better reconnection handling
- Simpler implementation without additional dependencies
- Better compatibility with proxy servers

#### Single Worker Model
The application uses a single Gunicorn worker with multiple threads because:
- Shared in-memory state is simpler than distributed state
- Reduces complexity of synchronization
- Most operations are I/O bound, making threads effective
- Typical deployments have moderate user counts

#### Optional Redis Integration
Redis usage is optional because:
- Small deployments don't require persistence
- Makes local development simpler
- Allows for flexible deployment options

#### Hashrate Normalization
All hashrates are normalized to TH/s internally because:
- Provides consistent basis for comparisons
- Simplifies trend calculations and charts
- Allows for unit conversion on display

## Component Interactions

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Ocean.xyz API  │      │ blockchain.info │      │  mempool.guide  │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌────────────────────────────────────────────────────────────────────┐
│                           data_service.py                          │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                             App.py                                 │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  worker_service │    │  state_manager  │    │ Background Jobs │ │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘ │
│                                                                    │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                         Flask Routes & SSE                         │
└───────────────────────────────┬────────────────────────────────────┘
                                │
         ┌────────────────────────────────────────────┐
         │                                            │
         ▼                                            ▼
┌─────────────────┐                          ┌─────────────────┐
│  Browser Tab 1  │                          │  Browser Tab N  │
└─────────────────┘                          └─────────────────┘
```

## Performance Considerations

### Memory Usage
- Arrow history is pruned to prevent unbounded growth
- Older data points are stored at reduced resolution
- Regular garbage collection cycles are scheduled
- Memory usage is logged for monitoring

### Network Optimization
- Data is cached to reduce API calls
- Updates are throttled to reasonable frequencies
- SSE connections have a maximum lifetime
- Failed connections use exponential backoff

### Browser Performance
- Charts use optimized rendering with limited animation
- DOM updates are batched where possible
- Data is processed in small chunks
- CSS transitions are used for smooth animations

## Future Enhancement Areas

1. **Database Integration**: Option for SQL database for long-term metrics storage
2. **User Authentication**: Multi-user support with separate configurations
3. **Mining Pool Expansion**: Support for additional mining pools beyond Ocean.xyz
4. **Mobile App**: Dedicated mobile application with push notifications
5. **Advanced Analytics**: Profitability projections and historical analysis
