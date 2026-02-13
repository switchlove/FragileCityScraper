const FragileCityDatabase = require('./database');
require('dotenv').config();

/**
 * Example queries for Fragile City database
 */
async function runExamples() {
    const dbConfig = process.env.TURSO_DATABASE_URL ? {
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    } : {
        url: 'file:fragile-city.db'
    };

    const db = new FragileCityDatabase(dbConfig);

    try {
        console.log('=== Fragile City Database Queries ===\n');

        // 1. Get latest scrape run stats
        console.log('1. Latest Scrape Runs:');
        const runs = await db.getScrapeRunStats(5);
        runs.forEach(run => {
            console.log(`   [${run.scraped_at}] ${run.successful_scrapes}/${run.total_cities} cities, ${run.duration_seconds}s`);
        });

        // 2. Get latest global stats
        console.log('\n2. Latest Global Stats:');
        const globalStats = await db.getLatestGlobalStats();
        if (globalStats) {
            console.log(`   Year: ${globalStats.year}, Day: ${globalStats.day}`);
            console.log(`   Active Cities: ${globalStats.active_cities}/${globalStats.total_cities}`);
            console.log(`   Total Citizens: ${globalStats.total_citizens?.toLocaleString()}`);
            console.log(`   Pollution: ${globalStats.total_pollution?.toLocaleString()} (daily: ${globalStats.daily_pollution})`);
        }

        // 3. Get city growth for a specific city
        console.log('\n3. City Growth History (Laodicea - last 10 scrapes):');
        const growth = await db.getCityGrowth('Laodicea', 10);
        if (growth.length > 0) {
            growth.forEach((record, i) => {
                console.log(`   ${i + 1}. [${record.scraped_at}] Citizens: ${record.citizens}, Year ${record.year} Day ${record.day}`);
            });
        } else {
            console.log('   No data found (try another city name)');
        }

        // 4. Compare latest vs previous scrape
        console.log('\n4. Latest vs Previous Scrape:');
        const latest = await db.client.execute(`
            SELECT 
                sr.scraped_at,
                COUNT(DISTINCT c.id) as city_count,
                SUM(c.citizens) as total_citizens
            FROM scrape_runs sr
            LEFT JOIN cities c ON sr.id = c.scrape_run_id
            GROUP BY sr.id
            ORDER BY sr.scraped_at DESC
            LIMIT 2
        `);
        
        if (latest.rows.length >= 2) {
            const [current, previous] = latest.rows;
            console.log(`   Current:  [${current.scraped_at}] ${current.city_count} cities, ${current.total_citizens} citizens`);
            console.log(`   Previous: [${previous.scraped_at}] ${previous.city_count} cities, ${previous.total_citizens} citizens`);
            const citizenChange = current.total_citizens - previous.total_citizens;
            console.log(`   Change:   ${citizenChange > 0 ? '+' : ''}${citizenChange} citizens`);
        }

        // 5. Top 5 cities by pollution
        console.log('\n5. Top 5 Cities by Pollution (latest scrape):');
        const topPolluters = await db.client.execute(`
            SELECT c.name, c.pollution, c.citizens
            FROM cities c
            WHERE c.scrape_run_id = (SELECT id FROM scrape_runs ORDER BY scraped_at DESC LIMIT 1)
            ORDER BY c.pollution DESC
            LIMIT 5
        `);
        
        topPolluters.rows.forEach((city, i) => {
            console.log(`   ${i + 1}. ${city.name}: ${city.pollution} pollution, ${city.citizens} citizens`);
        });

        // 6. Building counts for a specific city
        console.log('\n6. Building Inventory (Laodicea - latest scrape):');
        const buildings = await db.client.execute(`
            SELECT cb.building_name, cb.count
            FROM city_buildings cb
            JOIN city_details cd ON cb.city_detail_id = cd.id
            JOIN scrape_runs sr ON cd.scrape_run_id = sr.id
            WHERE cd.name = 'Laodicea'
            AND sr.id = (SELECT id FROM scrape_runs ORDER BY scraped_at DESC LIMIT 1)
            AND cb.count > 0
            ORDER BY cb.count DESC
            LIMIT 10
        `);
        
        if (buildings.rows.length > 0) {
            buildings.rows.forEach(b => {
                console.log(`   ${b.building_name}: ${b.count}`);
            });
        } else {
            console.log('   No data found (try another city name)');
        }

        // 7. Active wars
        console.log('\n7. Active Wars (latest scrape):');
        const wars = await db.client.execute(`
            SELECT attacker, defender, missiles, both_active
            FROM wars
            WHERE scrape_run_id = (SELECT id FROM scrape_runs ORDER BY scraped_at DESC LIMIT 1)
            ORDER BY missiles DESC
        `);
        
        if (wars.rows.length > 0) {
            wars.rows.forEach(war => {
                const status = war.both_active ? '🔴 ACTIVE' : '⚪ INACTIVE';
                console.log(`   ${status} ${war.attacker} → ${war.defender} (${war.missiles} missiles)`);
            });
        } else {
            console.log('   No wars found');
        }

        // 8. Average scrape performance
        console.log('\n8. Scrape Performance Stats:');
        const perfStats = await db.client.execute(`
            SELECT 
                AVG(duration_seconds) as avg_duration,
                MIN(duration_seconds) as min_duration,
                MAX(duration_seconds) as max_duration,
                AVG(successful_scrapes) as avg_success
            FROM scrape_runs
        `);
        
        if (perfStats.rows.length > 0) {
            const stats = perfStats.rows[0];
            console.log(`   Average: ${stats.avg_duration?.toFixed(2)}s`);
            console.log(`   Fastest: ${stats.min_duration?.toFixed(2)}s`);
            console.log(`   Slowest: ${stats.max_duration?.toFixed(2)}s`);
            console.log(`   Avg Success: ${stats.avg_success?.toFixed(1)} cities`);
        }

        console.log('\n=== Query Examples Complete ===');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await db.close();
    }
}

// Custom query interface
async function customQuery(sql) {
    const dbConfig = process.env.TURSO_DATABASE_URL ? {
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    } : {
        url: 'file:fragile-city.db'
    };

    const db = new FragileCityDatabase(dbConfig);

    try {
        const result = await db.client.execute(sql);
        console.log('Results:', result.rows);
        return result.rows;
    } catch (error) {
        console.error('Query error:', error.message);
    } finally {
        await db.close();
    }
}

// Export for use as module
module.exports = { runExamples, customQuery };

// Run examples if called directly
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args[0] === '--query' && args[1]) {
        // Custom query mode
        customQuery(args.slice(1).join(' '));
    } else {
        // Run example queries
        runExamples();
    }
}
