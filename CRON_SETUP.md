# Fragile City Scraper - Cron Setup

## Hourly Execution with Cron

To run the scraper automatically at the top of every hour:

1. **Open your crontab for editing:**
   ```bash
   crontab -e
   ```

2. **Add this line to run at the top of every hour (update path to your install location):**
   ```
   0 * * * * /path/to/fragile-city-scraper/run-scraper.sh
   ```

3. **Alternative schedules:**

   Every 2 hours at the top of the hour:
   ```
   0 */2 * * * /path/to/fragile-city-scraper/run-scraper.sh
   ```

   Every 30 minutes:
   ```
   */30 * * * * /path/to/fragile-city-scraper/run-scraper.sh
   ```

   Every day at 3 AM:
   ```
   0 3 * * * /path/to/fragile-city-scraper/run-scraper.sh
   ```

4. **Verify cron is running:**
   ```bash
   sudo systemctl status cron
   ```

5. **View cron logs:**
   ```bash
   # Ubuntu/Debian
   grep CRON /var/log/syslog

   # Or view scraper-specific logs (from project directory)
   tail -f logs/scrape-*.log
   ```

## Cron Format Reference

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * * /path/to/script.sh
```

## Manual Execution

You can also run the scraper manually:

```bash
# Direct execution (from project directory)
cd fragile-city-scraper
node index.js

# Or using the script (creates logs)
./run-scraper.sh
```

## Monitoring

- Logs are stored in `logs/scrape-YYYYMMDD-HHMM.log`
- Old logs (>7 days) are automatically cleaned up
- Each run logs: start time, scrape results, errors/warnings, completion status

## Using PM2 (Alternative to Cron)

For more robust scheduling with automatic restarts and monitoring:

```bash
# Install PM2 globally
npm install -g pm2

# Start with cron pattern (hourly at minute 0)
pm2 start index.js --name fragile-city-scraper --cron "0 * * * *" --no-autorestart

# Save PM2 configuration
pm2 save

# Start PM2 on system boot
pm2 startup

# View logs
pm2 logs fragile-city-scraper

# Monitor
pm2 monit
```
