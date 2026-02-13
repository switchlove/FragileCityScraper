const { createClient } = require('@libsql/client');

class FragileCityDatabase {
    constructor(config = {}) {
        // Support both Turso cloud and local SQLite
        if (config.url && config.authToken) {
            // Turso cloud database
            this.client = createClient({
                url: config.url,
                authToken: config.authToken
            });
        } else {
            // Local SQLite file
            this.client = createClient({
                url: config.url || 'file:fragile-city.db'
            });
        }
    }

    /**
     * Initialize database schema
     */
    async initialize() {
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS scrape_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scraped_at TEXT NOT NULL,
                version TEXT NOT NULL,
                duration_seconds REAL,
                total_cities INTEGER,
                successful_scrapes INTEGER,
                failed_scrapes INTEGER,
                concurrency INTEGER,
                errors_count INTEGER,
                warnings_count INTEGER
            )
        `);

        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS global_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scrape_run_id INTEGER NOT NULL,
                year INTEGER,
                day INTEGER,
                total_cities INTEGER,
                active_cities INTEGER,
                total_citizens INTEGER,
                total_pollution INTEGER,
                daily_pollution INTEGER,
                FOREIGN KEY (scrape_run_id) REFERENCES scrape_runs(id)
            )
        `);

        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS cities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scrape_run_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                url TEXT,
                pollution INTEGER,
                citizens INTEGER,
                email_verified INTEGER,
                is_patron INTEGER,
                has_contributed INTEGER,
                FOREIGN KEY (scrape_run_id) REFERENCES scrape_runs(id)
            )
        `);

        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS city_details (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scrape_run_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                region TEXT,
                year INTEGER,
                day INTEGER,
                season TEXT,
                citizens INTEGER,
                stats TEXT,
                resources TEXT,
                buildings TEXT,
                FOREIGN KEY (scrape_run_id) REFERENCES scrape_runs(id)
            )
        `);

        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS wars (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scrape_run_id INTEGER NOT NULL,
                attacker TEXT NOT NULL,
                defender TEXT NOT NULL,
                attacker_url TEXT,
                defender_url TEXT,
                missiles INTEGER,
                attacker_active INTEGER,
                defender_active INTEGER,
                both_active INTEGER,
                FOREIGN KEY (scrape_run_id) REFERENCES scrape_runs(id)
            )
        `);

        // Create indexes for common queries
        await this.client.execute(`
            CREATE INDEX IF NOT EXISTS idx_cities_scrape_run 
            ON cities(scrape_run_id)
        `);

        await this.client.execute(`
            CREATE INDEX IF NOT EXISTS idx_cities_name 
            ON cities(name)
        `);

        await this.client.execute(`
            CREATE INDEX IF NOT EXISTS idx_city_details_scrape_run 
            ON city_details(scrape_run_id)
        `);

        await this.client.execute(`
            CREATE INDEX IF NOT EXISTS idx_city_details_name 
            ON city_details(name)
        `);

        await this.client.execute(`
            CREATE INDEX IF NOT EXISTS idx_scrape_runs_scraped_at 
            ON scrape_runs(scraped_at)
        `);

        console.log('✓ Database schema initialized');
    }

    /**
     * Save scrape run and return the run ID
     */
    async saveScrapeRun(metadata) {
        const result = await this.client.execute({
            sql: `
                INSERT INTO scrape_runs 
                (scraped_at, version, duration_seconds, total_cities, successful_scrapes, 
                 failed_scrapes, concurrency, errors_count, warnings_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
                metadata.scrapedAt,
                metadata.version,
                parseFloat(metadata.scrapeDuration) || 0,
                metadata.totalCities || 0,
                metadata.successfulScrapes || 0,
                metadata.failedScrapes || 0,
                metadata.concurrency || 0,
                (metadata.errors || []).length,
                (metadata.warnings || []).length
            ]
        });

        return result.lastInsertRowid;
    }

    /**
     * Save global stats
     */
    async saveGlobalStats(runId, globalStats) {
        await this.client.execute({
            sql: `
                INSERT INTO global_stats 
                (scrape_run_id, year, day, total_cities, active_cities, 
                 total_citizens, total_pollution, daily_pollution)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
                runId,
                globalStats.year || 0,
                globalStats.day || 0,
                globalStats.totalCities || 0,
                globalStats.activeCities || 0,
                globalStats.totalCitizens || 0,
                globalStats.totalPollution || 0,
                globalStats.dailyPollution || 0
            ]
        });
    }

    /**
     * Save cities data
     */
    async saveCities(runId, cities) {
        for (const city of cities) {
            await this.client.execute({
                sql: `
                    INSERT INTO cities 
                    (scrape_run_id, name, url, pollution, citizens, 
                     email_verified, is_patron, has_contributed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
                args: [
                    runId,
                    city.name,
                    city.url,
                    city.pollution || 0,
                    city.citizens || 0,
                    city.emailVerified ? 1 : 0,
                    city.isPatron ? 1 : 0,
                    city.hasContributed ? 1 : 0
                ]
            });
        }
    }

    /**
     * Save city details with stats, resources, and buildings as JSON
     */
    async saveCityDetails(runId, cityDetails) {
        for (const city of cityDetails) {
            await this.client.execute({
                sql: `
                    INSERT INTO city_details 
                    (scrape_run_id, name, region, year, day, season, citizens, stats, resources, buildings)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                args: [
                    runId,
                    city.name,
                    city.region || null,
                    city.year || 0,
                    city.day || 0,
                    city.season || null,
                    city.citizens || 0,
                    JSON.stringify(city.stats || {}),
                    JSON.stringify(city.resources || {}),
                    JSON.stringify(city.buildings || {})
                ]
            });
        }
    }

    /**
     * Save wars data
     */
    async saveWars(runId, wars) {
        for (const war of wars) {
            await this.client.execute({
                sql: `
                    INSERT INTO wars 
                    (scrape_run_id, attacker, defender, attacker_url, defender_url, 
                     missiles, attacker_active, defender_active, both_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                args: [
                    runId,
                    war.attacker,
                    war.defender,
                    war.attackerUrl || null,
                    war.defenderUrl || null,
                    war.missiles || 0,
                    war.attackerActive ? 1 : 0,
                    war.defenderActive ? 1 : 0,
                    war.bothActive ? 1 : 0
                ]
            });
        }
    }

    /**
     * Get city growth history
     */
    async getCityGrowth(cityName, limit = 100) {
        const result = await this.client.execute({
            sql: `
                SELECT 
                    sr.scraped_at,
                    cd.citizens,
                    cd.year,
                    cd.day
                FROM city_details cd
                JOIN scrape_runs sr ON cd.scrape_run_id = sr.id
                WHERE cd.name = ?
                ORDER BY sr.scraped_at DESC
                LIMIT ?
            `,
            args: [cityName, limit]
        });

        return result.rows;
    }

    /**
     * Get latest global stats
     */
    async getLatestGlobalStats() {
        const result = await this.client.execute(`
            SELECT * FROM global_stats
            ORDER BY id DESC
            LIMIT 1
        `);

        return result.rows[0] || null;
    }

    /**
     * Get scrape run statistics
     */
    async getScrapeRunStats(limit = 10) {
        const result = await this.client.execute({
            sql: `
                SELECT * FROM scrape_runs
                ORDER BY scraped_at DESC
                LIMIT ?
            `,
            args: [limit]
        });

        return result.rows;
    }

    /**
     * Close database connection
     */
    async close() {
        // libSQL doesn't require explicit close, but good practice
        console.log('Database connection closed');
    }
}

module.exports = FragileCityDatabase;
