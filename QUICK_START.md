# Fragile City Scraper - Quick Start Guide

Complete guide for setting up hourly automated scraping with database tracking.

## 🚀 Quick Setup (5 minutes)

### 1. Install Dependencies
```bash
cd fragile-city-scraper
npm install
```

### 2. Configure Database

**Option A: Local SQLite (Easiest for testing)**
```bash
echo "TURSO_DATABASE_URL=file:fragile-city.db" > .env
```

**Option B: Turso Cloud (Recommended for production)**
```bash
# Sign up at https://turso.tech
turso auth signup

# Create database
turso db create fragile-city

# Get credentials
turso db show fragile-city

# Create .env file
cat > .env << EOF
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token-here
EOF
```

### 3. Test the Scraper
```bash
# Run once manually
node index.js

# View database queries
node query.js
```

### 4. Set Up Hourly Cron Job
```bash
# Make script executable (if not already)
chmod +x run-scraper.sh

# Edit crontab
crontab -e

# Add this line to run every hour at minute 0 (update path to your install location)
0 * * * * /path/to/fragile-city-scraper/run-scraper.sh
```

Done! The scraper will now run automatically every hour and track all stats in the database.

## 📊 What Gets Tracked

Every hour, the scraper collects and stores:

### Global Stats
- Game year and day
- Total cities (2100+)
- Active cities (~20)
- Total citizens across all cities
- Global pollution levels

### City Data (per city)
- Population and pollution
- 15 city statistics (housing, jobs, energy, money, happiness, etc.)
- 6 job/education levels with employment data
- 27 resource types with current/max amounts
- 73-76 building types with exact counts (including 0-count buildings)
- Verification status and region

### Wars
- Attacker and defender cities
- Missile counts
- Activity status (both cities active?)

### Performance Metadata
- Scrape duration
- Success/failure counts
- Errors and warnings
- Average time per city

## 📈 Analyzing Data

### View Latest Statistics
```bash
node query.js
```

Shows:
- Latest scrape runs
- Global statistics
- Top polluting cities
- Active wars
- Performance metrics

### Custom SQL Queries
```bash
# City growth over time
node query.js --query "SELECT scraped_at, citizens FROM city_details 
                       WHERE name = 'Arabica' 
                       ORDER BY scraped_at DESC LIMIT 20"

# Building trends
node query.js --query "SELECT building_name, AVG(count) as avg_count 
                       FROM city_buildings 
                       GROUP BY building_name 
                       ORDER BY avg_count DESC LIMIT 10"

# Pollution leaders
node query.js --query "SELECT name, pollution, citizens 
                       FROM cities 
                       WHERE scrape_run_id = (SELECT id FROM scrape_runs ORDER BY scraped_at DESC LIMIT 1)
                       ORDER BY pollution DESC"
```

### Access Database Directly
```bash
# Local SQLite
sqlite3 fragile-city.db

# Turso Cloud
turso db shell fragile-city
```

## 🔍 Monitoring

### Check Logs
```bash
# Latest log
ls -lt logs/ | head -5

# View specific log
tail -f logs/scrape-20260213-0100.log

# Search for errors
grep -i error logs/*.log
```

### Verify Cron Job
```bash
# Check cron is running
sudo systemctl status cron

# View cron logs
grep CRON /var/log/syslog | tail -20

# List your cron jobs
crontab -l
```

### Database Health Check
```bash
# Check scrape runs
node query.js --query "SELECT * FROM scrape_runs ORDER BY scraped_at DESC LIMIT 5"

# Check for errors
node query.js --query "SELECT scraped_at, errors_count, warnings_count FROM scrape_runs WHERE errors_count > 0"
```

## 📁 File Structure

```
fragile-city-scraper/
├── index.js              # Main scraper
├── database.js           # Database integration
├── query.js              # Example queries
├── run-scraper.sh        # Cron wrapper script
├── package.json          # Dependencies
├── .env                  # Database credentials (gitignored)
├── .env.example          # Template for .env
├── README.md             # Full documentation
├── CRON_SETUP.md         # Scheduling guide
├── QUICK_START.md        # This file
├── cities.json           # Latest city list (backup)
├── wars.json             # Latest wars (backup)
├── city_details.json     # Latest city details (backup)
├── fragile-city.db       # SQLite database (if using local)
└── logs/                 # Scrape logs
    └── scrape-*.log
```

## 🎯 Common Tasks

### Change Scrape Frequency

**Every 30 minutes:**
```
*/30 * * * * /path/to/fragile-city-scraper/run-scraper.sh
```

**Every 2 hours:**
```
0 */2 * * * /path/to/fragile-city-scraper/run-scraper.sh
```

**Daily at 3 AM:**
```
0 3 * * * /path/to/fragile-city-scraper/run-scraper.sh
```

### Disable Database (JSON only)
Edit `index.js`:
```javascript
const scraper = new FragileCityScraper({ enableDatabase: false });
```

### Adjust Performance
Edit `index.js`:
```javascript
const scraper = new FragileCityScraper({
    concurrency: 10,     // More parallel requests (faster, higher load)
    maxRetries: 5,       // More retry attempts
    retryDelay: 2000     // Longer initial delay
});
```

### Export Data
```bash
# Export to CSV
node query.js --query "SELECT name, pollution, citizens FROM cities 
                       WHERE scrape_run_id = (SELECT id FROM scrape_runs ORDER BY scraped_at DESC LIMIT 1)
                       ORDER BY pollution DESC" > cities-export.csv

# Backup database
cp fragile-city.db fragile-city-backup-$(date +%Y%m%d).db
```

## 🐛 Troubleshooting

### Scraper Fails
```bash
# Check latest log
tail -100 logs/scrape-*.log | grep -i error

# Run manually to see errors
node index.js
```

### Cron Not Running
```bash
# Check cron service
sudo systemctl status cron

# Restart cron
sudo systemctl restart cron

# Check crontab syntax
crontab -l
```

### Database Errors
```bash
# Check database file permissions
ls -l fragile-city.db

# Reinitialize database
rm fragile-city.db
node index.js
```

### Network Issues
The scraper has automatic retry with exponential backoff. Check logs for retry attempts:
```bash
grep -i retry logs/*.log
```

## 📊 Example Analyses

### City Growth Tracking
Track how a specific city grows over time:
```bash
node query.js --query "SELECT 
    DATE(scraped_at) as date, 
    citizens, 
    year, 
    day 
FROM city_details 
JOIN scrape_runs ON city_details.scrape_run_id = scrape_runs.id 
WHERE name = 'Arabica' 
ORDER BY scraped_at DESC 
LIMIT 100"
```

### Pollution Trends
```bash
node query.js --query "SELECT 
    DATE(sr.scraped_at) as date, 
    AVG(c.pollution) as avg_pollution,
    SUM(c.citizens) as total_citizens
FROM cities c
JOIN scrape_runs sr ON c.scrape_run_id = sr.id
GROUP BY DATE(sr.scraped_at)
ORDER BY date DESC
LIMIT 30"
```

### Building Evolution
```bash
node query.js --query "SELECT 
    building_name, 
    SUM(count) as total_built
FROM city_buildings cb
JOIN city_details cd ON cb.city_detail_id = cd.id
WHERE cd.scrape_run_id = (SELECT id FROM scrape_runs ORDER BY scraped_at DESC LIMIT 1)
GROUP BY building_name
ORDER BY total_built DESC
LIMIT 20"
```

## 🎉 You're All Set!

The scraper is now running hourly and tracking:
- ✅ 20+ cities with complete details
- ✅ All wars and conflicts
- ✅ Historical growth trends
- ✅ Building inventories over time
- ✅ Resource production
- ✅ Pollution changes

Check back in a few hours and run `node query.js` to see your historical data accumulating!
