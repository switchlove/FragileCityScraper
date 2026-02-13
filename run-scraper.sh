#!/bin/bash

# Fragile City Hourly Scraper
# This script runs the scraper and logs output

# Change to the script directory
cd "$(dirname "$0")"

# Create logs directory if it doesn't exist
mkdir -p logs

# Generate log filename with timestamp
LOG_FILE="logs/scrape-$(date +%Y%m%d-%H%M).log"

echo "=== Starting Fragile City Scrape ===" | tee -a "$LOG_FILE"
echo "Time: $(date)" | tee -a "$LOG_FILE"

# Run the scraper and capture output
node index.js 2>&1 | tee -a "$LOG_FILE"

# Check exit code
if [ $? -eq 0 ]; then
    echo "✓ Scrape completed successfully" | tee -a "$LOG_FILE"
else
    echo "✗ Scrape failed with exit code $?" | tee -a "$LOG_FILE"
fi

echo "=== Scrape Finished ===" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Optional: Clean up old logs (keep last 7 days)
find logs -name "scrape-*.log" -mtime +7 -delete 2>/dev/null

exit 0
