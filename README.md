# Fragile City Scraper

A Node.js web scraper for [fragile.city](https://fragile.city/), an MMO game about urban design and civilization collapse.

## Features

- Scrapes city list with pollution, citizens, and verification status
- Extracts ongoing wars data with validation
- Scrapes detailed individual city pages including:
  - Basic info (year, day, season, citizens, region)
  - Statistics (pollution, housing, jobs, energy, money, happiness, etc.)
  - Job levels (6 education levels with employment and tax data)
  - Resources (27 resource types with current/max values)
  - Buildings (all building types and counts from Transit to Storage)
- Saves data to structured JSON files with metadata tracking
- **Database integration** with Turso.io (libSQL) or local SQLite for historical tracking
- **Parallel processing** with configurable concurrency (~3x faster)
- **Automatic retry logic** with exponential backoff for network resilience
- **Data validation** with warnings for incomplete or invalid data
- **Hourly cron scheduling** for automated tracking
- Comprehensive error handling and logging
- Smart rate limiting to respect server resources

## Installation

```bash
npm install
```

## Usage

### Run Full Scrape

```bash
npm start
```

This will scrape all cities and wars, plus detailed information for each active city, saving the results to:
- `cities.json` - Global stats and city list
- `wars.json` - Ongoing wars with validation
- `city_details.json` - Detailed city data including stats, jobs, resources, and buildings

### Use as Module

```javascript
const FragileCityScraper = require('./index.js');

// Default options
const scraper = new FragileCityScraper();

// Custom options with retry configuration
const scraper = new FragileCityScraper({
    maxRetries: 3,        // Number of retry attempts (default: 3)
    retryDelay: 1000,     // Initial retry delay in ms (default: 1000)
    concurrency: 5,       // Parallel requests (default: 5)
    enableDatabase: true  // Enable database storage (default: true)
});

// Scrape all cities
scraper.scrapeCityList().then(data => {
    console.log(data);
});

// Scrape a specific city
scraper.scrapeCity('Helltown').then(data => {
    console.log(data);
});

// Run full scrape
scraper.runFullScrape();
```

## Configuration

### Database Setup

The scraper supports both **Turso.io** (cloud SQLite) and **local SQLite** for historical tracking:

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **For Turso Cloud (recommended for production):**
   - Sign up at [turso.tech](https://turso.tech)
   - Create a database: `turso db create fragile-city`
   - Get your credentials: `turso db show fragile-city`
   - Update `.env`:
     ```
     TURSO_DATABASE_URL=libsql://your-database.turso.io
     TURSO_AUTH_TOKEN=your-token-here
     ```

3. **For Local SQLite (development):**
   - Update `.env`:
     ```
     TURSO_DATABASE_URL=file:fragile-city.db
     ```
   - Database file will be created automatically

4. **Disable database** (JSON only):
   ```javascript
   const scraper = new FragileCityScraper({ enableDatabase: false });
   ```

### Retry Options

The scraper includes automatic retry logic with exponential backoff:

- **maxRetries**: Maximum number of retry attempts (default: 3)
- **retryDelay**: Initial retry delay in milliseconds (default: 1000ms)
- Exponential backoff: Each retry doubles the delay (1s → 2s → 4s)

### Performance Options

Optimize scraping speed with parallel processing:

- **concurrency**: Number of parallel city scrapes (default: 5)
- **requestDelay**: Delay between batches in milliseconds (default: 100ms)

Example configurations:

```javascript
// Balanced (default)
const scraper = new FragileCityScraper({
    concurrency: 5,
    requestDelay: 100
});

// High performance (faster, more aggressive)
const scraper = new FragileCityScraper({
    concurrency: 10,
    requestDelay: 50
});

// Conservative (slower, server-friendly)
const scraper = new FragileCityScraper({
    concurrency: 2,
    requestDelay: 500
});

// All options combined
const scraper = new FragileCityScraper({
    maxRetries: 5,
    retryDelay: 2000,
    concurrency: 8,
    requestDelay: 100
});
```

**Performance improvements:**
- Default settings: ~3x faster than sequential scraping
- 20 cities scraped in ~7 seconds (vs ~21 seconds sequential)
- Average 0.34s per city with parallel processing

## Output Format

### Cities Data (`cities.json`)

```json
{
  "globalStats": {
    "year": 22756,
    "day": 96,
    "totalCities": 2147,
    "activeCities": 20,
    "totalCitizens": 1625893,
    "totalPollution": 0,
    "dailyPollution": -71531
  },
  "cities": [
    {
      "name": "Helltown",
      "url": "https://fragile.city/city/Helltown",
      "pollution": -18651,
      "citizens": 300370,
      "emailVerified": true,
      "isPatron": false,
      "hasContributed": false
    }
  ],
  "metadata": {
    "scrapedAt": "2026-02-13T00:48:28.385Z",
    "version": "1.0.0",
    "totalCities": 2147,
    "activeCities": 20,
    "scrapedActiveCities": 20
  }
}
```

### Wars Data (`wars.json`)

```json
{
  "wars": [
    {
      "attacker": "CityA",
      "attackerUrl": "https://fragile.city/city/CityA",
      "defender": "CityB",
      "defenderUrl": "https://fragile.city/city/CityB",
      "missiles": 5,
      "attackerActive": true,
      "defenderActive": true,
      "bothActive": true
    }
  ],
  "metadata": {
    "scrapedAt": "2026-02-12T23:35:10.823Z",
    "version": "1.0.0",
    "totalWars": 5,
    "activeWars": 0
  }
}
```

### City Details (`city_details.json`)

```json
{
  "cities": [
    {
      "name": "Helltown",
      "url": "https://fragile.city/city/Helltown",
      "region": "Northwind",
      "year": "22755",
      "day": "70",
      "season": "spring",
      "citizens": 300370,
      "stats": {
        "pollution": { "current": -18651, "max": 0 },
        "housing": { "current": 245145, "max": 300370 },
        "jobs": { "current": 54733, "max": 294569 },
        "energy": { "current": 57931, "max": 60073 }
      },
      "jobLevels": [
        {
          "level": 0,
          "citizens": 38651,
          "totalJobs": 38651,
          "availableJobs": 0,
          "taxRate": "0%"
        }
      ],
      "resources": {
        "sulfur": { "current": 23, "max": 500 },
        "uranium": { "current": 5832, "max": 6500 }
      },
      "buildings": {
        "subway_lines": 466,
        "bike_lanes": 1500,
        "apartments": 25,
        "coal_plants": 14,
        "schools": 601,
        "mines": 374
      }
    }
  ],
  "metadata": {
    "scrapedAt": "2026-02-12T23:35:32.703Z",
    "version": "1.0.0",
    "totalCities": 22,
    "successfulScrapes": 22,
    "failedScrapes": 0,
    "scrapeDuration": "23.21s",
    "errors": [],
    "warnings": []
  }
}
```

## Metadata

Each output file includes comprehensive metadata:

### cities.json
- **scrapedAt**: ISO 8601 timestamp
- **version**: Scraper version
- **totalCities**: Total cities in the game
- **activeCities**: Number of active cities on homepage
- **scrapedActiveCities**: Number of cities scraped

### wars.json
- **scrapedAt**: ISO 8601 timestamp
- **version**: Scraper version
- **totalWars**: Total ongoing wars
- **activeWars**: Wars with both cities active

### city_details.json
- **scrapedAt**: ISO 8601 timestamp
- **version**: Scraper version
- **totalCities**: Total cities attempted
- **successfulScrapes**: Successfully scraped cities
- **failedScrapes**: Failed scrapes
- **scrapeDuration**: Total time taken
- **concurrency**: Parallel requests used
- **averageTimePerCity**: Average scrape time per city

## Database Schema

When database is enabled, data is stored in the following tables:

### scrape_runs
- Metadata for each scrape execution
- Tracks duration, success rate, errors, warnings

### global_stats
- Global game statistics per scrape
- Year, day, total cities, citizens, pollution

### cities
- City list data per scrape
- Name, pollution, citizens, verification status

### city_details
- Detailed city information per scrape
- Region, year, day, season, citizens

### city_stats
- City statistics (15 metrics per city)
- Pollution, housing, jobs, energy, money, happiness, etc.

### city_resources
- Resource inventory (27 resource types)
- Current and maximum amounts

### city_buildings
- Building counts (73-76 building types)
- Includes zero-count buildings

### wars
- Active wars data
- Attacker, defender, missiles, activity status

## Database Queries

View example queries and analytics:

```bash
# Run example queries
node query.js

# Custom SQL query
node query.js --query "SELECT * FROM scrape_runs ORDER BY scraped_at DESC LIMIT 5"
```

Example queries include:
- Latest scrape statistics
- City growth history
- Top polluters
- Building inventories
- War tracking
- Performance metrics

## Scheduled Execution

See [CRON_SETUP.md](CRON_SETUP.md) for instructions on setting up hourly automated scraping.

### Quick Setup (Hourly Cron)

```bash
# Edit crontab
crontab -e

# Add this line for hourly execution (update path to your install location)
0 * * * * /path/to/fragile-city-scraper/run-scraper.sh
```

### Manual Execution with Logging

```bash
./run-scraper.sh
```

Logs are saved to `logs/scrape-YYYYMMDD-HHMM.log`
- **errors**: Array of errors encountered
- **warnings**: Array of validation warnings

## Data Validation

The scraper automatically validates all scraped data and logs warnings for:

### City Data
- Missing required fields (name, url, pollution, citizens)
- Invalid numeric values (negative citizens count)

### War Data
- Missing required fields (attacker, defender, URLs)
- Invalid missile counts

### City Details
- Missing or empty stats, jobLevels, resources, or buildings
- Invalid citizen counts

Validation warnings are:
- Logged to console during scraping (with ⚠ symbol)
- Included in metadata.warnings array
- Non-blocking (scraping continues with warnings)

## Dependencies

- **axios**: HTTP client for making requests
- **cheerio**: Fast, flexible HTML parser for Node.js

## Notes

- Respect the site's rate limits
- The scraper uses a User-Agent header to identify itself
- Data structure may change if the website layout changes
