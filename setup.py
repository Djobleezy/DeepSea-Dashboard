#!/usr/bin/env python3
"""
Enhanced setup script for Bitcoin Mining Dashboard.

This script prepares the project structure, installs dependencies,
verifies configuration, and provides system checks for optimal operation.
"""

import os
import sys
import shutil
import logging
import argparse
import subprocess
import json
import re

# Configure logging with color support
try:
    import colorlog

    handler = colorlog.StreamHandler()
    handler.setFormatter(
        colorlog.ColoredFormatter(
            "%(log_color)s%(asctime)s - %(levelname)s - %(message)s",
            log_colors={
                "DEBUG": "cyan",
                "INFO": "green",
                "WARNING": "yellow",
                "ERROR": "red",
                "CRITICAL": "red,bg_white",
            },
        )
    )

    logger = colorlog.getLogger()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
except ImportError:
    # Fallback to standard logging if colorlog is not available
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
    logger = logging.getLogger()

# Directory structure to create
DIRECTORIES = [
    "static/css",
    "static/js",
    "static/js/min",  # For minified JS files
    "templates",
    "logs",
    "data",  # For temporary data storage
]

# Files to move to their correct locations
FILE_MAPPINGS = {
    # CSS files
    "common.css": "static/css/common.css",
    "dashboard.css": "static/css/dashboard.css",
    "workers.css": "static/css/workers.css",
    "boot.css": "static/css/boot.css",
    "error.css": "static/css/error.css",
    "retro-refresh.css": "static/css/retro-refresh.css",
    "blocks.css": "static/css/blocks.css",
    "notifications.css": "static/css/notifications.css",
    "theme-toggle.css": "static/css/theme-toggle.css",  # Added theme-toggle.css
    "earnings.css": "static/css/earnings.css",  # Added earnings.css
    # JS files
    "main.js": "static/js/main.js",
    "workers.js": "static/js/workers.js",
    "blocks.js": "static/js/blocks.js",
    "BitcoinProgressBar.js": "static/js/BitcoinProgressBar.js",
    "notifications.js": "static/js/notifications.js",
    "theme.js": "static/js/theme.js",  # Added theme.js
    "earnings.js": "static/js/earnings.js",  # Added earnings.js
    # Template files
    "base.html": "templates/base.html",
    "dashboard.html": "templates/dashboard.html",
    "workers.html": "templates/workers.html",
    "boot.html": "templates/boot.html",
    "error.html": "templates/error.html",
    "blocks.html": "templates/blocks.html",
    "notifications.html": "templates/notifications.html",
    "earnings.html": "templates/earnings.html",  # Added earnings.html
}

# Default configuration
DEFAULT_CONFIG = {
    "power_cost": 0.0,
    "power_usage": 0.0,
    "wallet": "yourwallethere",
    "timezone": "America/Los_Angeles",  # Added default timezone
    "network_fee": 0.0,  # Added default network fee
    "currency": "USD",
}


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Setup the Bitcoin Mining Dashboard")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--wallet", type=str, help="Set your Ocean.xyz wallet address")
    parser.add_argument("--power-cost", type=float, help="Set your electricity cost per kWh")
    parser.add_argument("--power-usage", type=float, help="Set your power consumption in watts")
    parser.add_argument(
        "--network-fee", type=float, help="Set your network fee percentage"
    )  # Added network fee parameter
    parser.add_argument(
        "--timezone", type=str, help="Set your timezone (e.g., America/Los_Angeles)"
    )  # Added timezone parameter
    parser.add_argument("--skip-checks", action="store_true", help="Skip dependency checks")
    parser.add_argument("--force", action="store_true", help="Force file overwrite")
    parser.add_argument("--config", type=str, help="Path to custom config.json")
    parser.add_argument("--minify", action="store_true", help="Minify JavaScript files")
    parser.add_argument(
        "--theme", choices=["bitcoin", "deepsea"], help="Set the default UI theme"
    )  # Added theme parameter
    return parser.parse_args()


def create_directory_structure():
    """Create the necessary directory structure."""
    logger.info("Creating directory structure...")
    success = True

    for directory in DIRECTORIES:
        try:
            os.makedirs(directory, exist_ok=True)
            logger.debug(f"Created directory: {directory}")
        except Exception as e:
            logger.error(f"Failed to create directory {directory}: {str(e)}")
            success = False

    if success:
        logger.info("✓ Directory structure created successfully")
    else:
        logger.warning("⚠ Some directories could not be created")

    return success


def move_files(force=False):
    """
    Move files to their correct locations.

    Args:
        force (bool): Force overwriting of existing files
    """
    logger.info("Moving files to their correct locations...")
    success = True
    moved_count = 0
    skipped_count = 0
    missing_count = 0

    for source, destination in FILE_MAPPINGS.items():
        if os.path.exists(source):
            # Create the directory if it doesn't exist
            os.makedirs(os.path.dirname(destination), exist_ok=True)

            # Check if destination exists and handle according to force flag
            if os.path.exists(destination) and not force:
                logger.debug(f"Skipped {source} (destination already exists)")
                skipped_count += 1
                continue

            try:
                # Copy the file to its destination
                shutil.copy2(source, destination)
                logger.debug(f"Moved {source} to {destination}")
                moved_count += 1
            except Exception as e:
                logger.error(f"Failed to copy {source} to {destination}: {str(e)}")
                success = False
        else:
            logger.warning(f"Source file not found: {source}")
            missing_count += 1

    if success:
        logger.info(f"✓ File movement completed: {moved_count} moved, {skipped_count} skipped, {missing_count} missing")
    else:
        logger.warning("⚠ Some files could not be moved")

    return success


def minify_js_files():
    """Minify JavaScript files."""
    logger.info("Minifying JavaScript files...")

    try:
        import jsmin
    except ImportError:
        logger.error("jsmin package not found. Installing...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "jsmin"], check=True)
            import jsmin

            logger.info("✓ jsmin package installed successfully")
        except Exception as e:
            logger.error(f"Failed to install jsmin: {str(e)}")
            logger.error("Please run: pip install jsmin")
            return False

    js_dir = "static/js"
    min_dir = os.path.join(js_dir, "min")
    os.makedirs(min_dir, exist_ok=True)

    minified_count = 0
    for js_file in os.listdir(js_dir):
        if js_file.endswith(".js") and not js_file.endswith(".min.js"):
            input_path = os.path.join(js_dir, js_file)
            output_path = os.path.join(min_dir, js_file.replace(".js", ".min.js"))

            try:
                with open(input_path, "r") as f:
                    js_content = f.read()

                # Minify the content
                minified = jsmin.jsmin(js_content)

                # Write minified content
                with open(output_path, "w") as f:
                    f.write(minified)

                minified_count += 1
                logger.debug(f"Minified {js_file}")
            except Exception as e:
                logger.error(f"Failed to minify {js_file}: {str(e)}")

    logger.info(f"✓ JavaScript minification completed: {minified_count} files processed")
    return True


def validate_wallet_address(wallet):
    """
    Validate Bitcoin wallet address format.

    Args:
        wallet (str): Bitcoin wallet address

    Returns:
        bool: True if valid, False otherwise
    """
    # Basic validation patterns for different Bitcoin address formats
    patterns = [
        r"^1[a-km-zA-HJ-NP-Z1-9]{25,34}$",  # Legacy
        r"^3[a-km-zA-HJ-NP-Z1-9]{25,34}$",  # P2SH
        r"^bc1[a-zA-Z0-9]{39,59}$",  # Bech32
        r"^bc1p[a-zA-Z0-9]{39,59}$",  # Taproot
        r"^bc1p[a-z0-9]{73,107}$",  # Longform Taproot
    ]

    # Check if the wallet matches any of the patterns
    for pattern in patterns:
        if re.match(pattern, wallet):
            return True

    return False


def create_config(args):
    """
    Create or update config.json file.

    Args:
        args: Command line arguments
    """
    config_file = args.config if args.config else "config.json"
    config = DEFAULT_CONFIG.copy()

    # Load existing config if available
    if os.path.exists(config_file):
        try:
            with open(config_file, "r") as f:
                existing_config = json.load(f)
                config.update(existing_config)
            logger.info(f"Loaded existing configuration from {config_file}")
        except json.JSONDecodeError:
            logger.warning(f"Invalid JSON in {config_file}, using default configuration")
        except Exception as e:
            logger.error(f"Error reading {config_file}: {str(e)}")

    # Update config from command line arguments
    if args.wallet:
        if validate_wallet_address(args.wallet):
            config["wallet"] = args.wallet
        else:
            logger.warning(f"Invalid wallet address format: {args.wallet}")
            logger.warning("Using default or existing wallet address")

    if args.power_cost is not None:
        if args.power_cost >= 0:
            config["power_cost"] = args.power_cost
        else:
            logger.warning("Power cost cannot be negative, using default or existing value")

    if args.power_usage is not None:
        if args.power_usage >= 0:
            config["power_usage"] = args.power_usage
        else:
            logger.warning("Power usage cannot be negative, using default or existing value")

    # Update config from command line arguments
    if args.timezone:
        config["timezone"] = args.timezone

    if args.network_fee is not None:
        if args.network_fee >= 0:
            config["network_fee"] = args.network_fee
        else:
            logger.warning("Network fee cannot be negative, using default or existing value")

    if args.theme:
        config["theme"] = args.theme

    # Save the configuration
    try:
        with open(config_file, "w") as f:
            json.dump(config, f, indent=2, sort_keys=True)
        logger.info(f"✓ Configuration saved to {config_file}")
    except Exception as e:
        logger.error(f"Failed to save configuration: {str(e)}")
        return False

    # Print current configuration
    logger.info("Current configuration:")
    logger.info(f"  ├── Wallet address: {config['wallet']}")
    logger.info(f"  ├── Power cost: ${config['power_cost']} per kWh")
    logger.info(f"  ├── Power usage: {config['power_usage']} watts")
    logger.info(f"  ├── Network fee: {config['network_fee']}%")
    logger.info(f"  └── Timezone: {config['timezone']}")

    return True


def check_dependencies(skip=False):
    """
    Check if required Python dependencies are installed.

    Args:
        skip (bool): Skip the dependency check
    """
    if skip:
        logger.info("Skipping dependency check")
        return True

    logger.info("Checking dependencies...")

    try:
        # Check if pip is available
        subprocess.run([sys.executable, "-m", "pip", "--version"], check=True, capture_output=True, text=True)
    except Exception as e:
        logger.error(f"Pip is not available: {str(e)}")
        logger.error("Please install pip before continuing")
        return False

    # Check if requirements.txt exists
    if not os.path.exists("requirements.txt"):
        logger.error("requirements.txt not found")
        return False

    # Check currently installed packages
    try:
        result = subprocess.run([sys.executable, "-m", "pip", "freeze"], check=True, capture_output=True, text=True)
        installed_output = result.stdout
        installed_packages = {
            line.split("==")[0].lower(): line.split("==")[1] if "==" in line else ""
            for line in installed_output.splitlines()
        }
    except Exception as e:
        logger.error(f"Failed to check installed packages: {str(e)}")
        installed_packages = {}

    # Read requirements
    try:
        with open("requirements.txt", "r") as f:
            requirements = f.read().splitlines()
    except Exception as e:
        logger.error(f"Failed to read requirements.txt: {str(e)}")
        return False

    # Check each requirement
    missing_packages = []
    for req in requirements:
        if req and not req.startswith("#"):
            package = req.split("==")[0].lower()
            if package not in installed_packages:
                missing_packages.append(req)

    if missing_packages:
        logger.warning(f"Missing {len(missing_packages)} required packages")
        logger.info("Installing missing packages...")

        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"],
                check=True,
                capture_output=True,
                text=True,
            )
            logger.info("✓ Dependencies installed successfully")
        except Exception as e:
            logger.error(f"Failed to install dependencies: {str(e)}")
            logger.error("Please run: pip install -r requirements.txt")
            return False
    else:
        logger.info("✓ All required packages are installed")

    return True


def check_redis():
    """Check if Redis is available."""
    logger.info("Checking Redis availability...")

    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        logger.info("⚠ Redis URL not configured (REDIS_URL environment variable not set)")
        logger.info("  └── The dashboard will run without persistent state")
        logger.info("  └── Set REDIS_URL for better reliability")
        return True

    try:
        import redis

        client = redis.Redis.from_url(redis_url)
        client.ping()
        logger.info(f"✓ Successfully connected to Redis at {redis_url}")
        return True
    except ImportError:
        logger.warning("Redis Python package not installed")
        logger.info("  └── Run: pip install redis")
        return False
    except Exception as e:
        logger.warning(f"Failed to connect to Redis: {str(e)}")
        logger.info(f"  └── Check that Redis is running and accessible at {redis_url}")
        return False


def perform_system_checks():
    """Perform system checks and provide recommendations."""
    logger.info("Performing system checks...")

    # Check Python version
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if sys.version_info.major < 3 or (sys.version_info.major == 3 and sys.version_info.minor < 9):
        logger.warning(f"⚠ Python version {python_version} is below recommended (3.9+)")
    else:
        logger.info(f"✓ Python version {python_version} is compatible")

    # Check available memory
    try:
        import psutil

        memory = psutil.virtual_memory()
        memory_gb = memory.total / (1024**3)
        if memory_gb < 1:
            logger.warning(f"⚠ Low system memory: {memory_gb:.2f} GB (recommended: 1+ GB)")
        else:
            logger.info(f"✓ System memory: {memory_gb:.2f} GB")
    except ImportError:
        logger.debug("psutil not available, skipping memory check")

    # Check write permissions
    log_dir = "logs"
    try:
        test_file = os.path.join(log_dir, "test_write.tmp")
        with open(test_file, "w") as f:
            f.write("test")
        os.remove(test_file)
        logger.info("✓ Write permissions for logs directory")
    except Exception as e:
        logger.warning(f"⚠ Cannot write to logs directory: {str(e)}")

    # Check port availability
    port = 5000  # Default port
    try:
        import socket

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("localhost", port))
        s.close()
        logger.info(f"✓ Port {port} is available")
    except Exception:
        logger.warning(f"⚠ Port {port} is already in use")

    logger.info("System checks completed")


def main():
    """Main setup function."""
    args = parse_arguments()

    # Set logging level
    if args.debug:
        logger.setLevel(logging.DEBUG)
        logger.debug("Debug logging enabled")

    logger.info("=== Bitcoin Mining Dashboard Setup ===")

    # Check dependencies
    if not check_dependencies(args.skip_checks):
        logger.error("Dependency check failed. Please install required packages and retry.")
        return 1

    # Create directory structure
    if not create_directory_structure():
        logger.error("Failed to create directory structure.")
        return 1

    # Move files to their correct locations
    if not move_files(args.force):
        logger.warning("Some files could not be moved, but continuing...")

    # Create or update configuration
    if not create_config(args):
        logger.error("Failed to create configuration file.")
        return 1

    # Minify JavaScript files if requested
    if args.minify:
        if not minify_js_files():
            logger.warning("JavaScript minification failed, but continuing...")

    # Check Redis if available
    check_redis()

    # Perform system checks
    if not args.skip_checks:
        perform_system_checks()

    logger.info("=== Setup completed successfully ===")
    logger.info("")
    logger.info("Next steps:")
    logger.info("1. Verify configuration in config.json")
    logger.info("2. Start the application with: python App.py")
    logger.info("3. Access the dashboard at: http://localhost:5000")

    return 0


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
