const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
require('dotenv').config();
const FragileCityDatabase = require('./database');

const BASE_URL = 'https://fragile.city';

class FragileCityScraper {
    constructor(options = {}) {
        this.baseUrl = BASE_URL;
        this.version = '1.0.0';
        this.errors = [];
        this.warnings = [];
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000;
        this.concurrency = options.concurrency || 5; // Parallel requests
        this.requestDelay = options.requestDelay || 100; // Delay between batches (ms)
        
        // Database support (optional)
        this.database = null;
        if (options.enableDatabase !== false) {
            const dbConfig = process.env.TURSO_DATABASE_URL ? {
                url: process.env.TURSO_DATABASE_URL,
                authToken: process.env.TURSO_AUTH_TOKEN
            } : {
                url: 'file:fragile-city.db' // Local SQLite fallback
            };
            this.database = new FragileCityDatabase(dbConfig);
        }
    }

    /**
     * Process items in parallel batches
     * @param {Array} items - Items to process
     * @param {Function} processFn - Async function to process each item
     * @param {number} concurrency - Number of concurrent operations
     */
    async processBatch(items, processFn, concurrency = this.concurrency) {
        const results = [];
        const errors = [];
        
        for (let i = 0; i < items.length; i += concurrency) {
            const batch = items.slice(i, i + concurrency);
            
            const batchPromises = batch.map(async (item) => {
                try {
                    return await processFn(item);
                } catch (error) {
                    errors.push({ item, error: error.message });
                    return null;
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(r => r !== null));
            
            // Small delay between batches to avoid overwhelming server
            if (i + concurrency < items.length) {
                await new Promise(resolve => setTimeout(resolve, this.requestDelay));
            }
        }
        
        return { results, errors };
    }

    /**
     * Add a validation warning
     */
    addWarning(type, message, context = {}) {
        this.warnings.push({
            type,
            message,
            context,
            timestamp: new Date().toISOString()
        });
        console.warn(`  ⚠ ${type}: ${message}`);
    }

    /**
     * Validate city data
     */
    validateCity(city) {
        const requiredFields = ['name', 'url', 'pollution', 'citizens'];
        const missing = requiredFields.filter(field => city[field] === null || city[field] === undefined);
        
        if (missing.length > 0) {
            this.addWarning('InvalidCityData', `Missing required fields: ${missing.join(', ')}`, { city: city.name });
            return false;
        }
        
        if (typeof city.citizens !== 'number' || city.citizens < 0) {
            this.addWarning('InvalidCityData', `Invalid citizens count: ${city.citizens}`, { city: city.name });
        }
        
        return true;
    }

    /**
     * Validate city details
     */
    validateCityDetails(cityData) {
        if (!cityData.name) {
            this.addWarning('InvalidCityDetails', 'City name is missing');
            return false;
        }

        // Check for critical fields
        if (!cityData.stats || Object.keys(cityData.stats).length === 0) {
            this.addWarning('IncompleteCityDetails', 'No stats data found', { city: cityData.name });
        }

        if (!cityData.jobLevels || cityData.jobLevels.length === 0) {
            this.addWarning('IncompleteCityDetails', 'No job levels data found', { city: cityData.name });
        }

        if (!cityData.resources || Object.keys(cityData.resources).length === 0) {
            this.addWarning('IncompleteCityDetails', 'No resources data found', { city: cityData.name });
        }

        if (!cityData.buildings || Object.keys(cityData.buildings).length === 0) {
            this.addWarning('IncompleteCityDetails', 'No buildings data found', { city: cityData.name });
        }

        // Validate numeric fields
        if (cityData.citizens !== null && (typeof cityData.citizens !== 'number' || cityData.citizens < 0)) {
            this.addWarning('InvalidCityDetails', `Invalid citizens: ${cityData.citizens}`, { city: cityData.name });
        }

        return true;
    }

    /**
     * Validate war data
     */
    validateWar(war) {
        const requiredFields = ['attacker', 'defender', 'attackerUrl', 'defenderUrl'];
        const missing = requiredFields.filter(field => !war[field]);
        
        if (missing.length > 0) {
            this.addWarning('InvalidWarData', `Missing required fields: ${missing.join(', ')}`, { war: `${war.attacker} vs ${war.defender}` });
            return false;
        }

        if (typeof war.missiles !== 'number' || war.missiles < 0) {
            this.addWarning('InvalidWarData', `Invalid missiles count: ${war.missiles}`, { war: `${war.attacker} vs ${war.defender}` });
        }

        return true;
    }

    /**
     * Fetch with automatic retry logic
     * @param {string} url - URL to fetch
     * @param {object} options - Axios options
     * @param {number} retryCount - Current retry attempt
     */
    async fetchWithRetry(url, options = {}, retryCount = 0) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'X-Requested-With': 'SwitchScraper/1.0'
                },
                ...options
            });
            return response;
        } catch (error) {
            if (retryCount < this.maxRetries) {
                const delay = this.retryDelay * Math.pow(2, retryCount); // Exponential backoff
                console.log(`  Retry ${retryCount + 1}/${this.maxRetries} after ${delay}ms for ${url}`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.fetchWithRetry(url, options, retryCount + 1);
            }
            throw error;
        }
    }

    /**
     * Fetch and parse the main city listing page
     */
    async scrapeCityList() {
        try {
            console.log('Fetching city list from fragile.city...');
            const response = await this.fetchWithRetry(this.baseUrl);

            const $ = cheerio.load(response.data);
            const cities = [];

            // Parse global stats from the structured divs
            const globalStats = {
                year: null,
                day: null,
                totalCities: null,
                activeCities: null,
                totalCitizens: null,
                totalPollution: null,
                dailyPollution: null
            };

            // Extract global stats
            $('section .flex.flex-row.items-center').each((i, elem) => {
                const $elem = $(elem);
                const text = $elem.text();
                
                if (text.includes('Year')) {
                    const yearText = $elem.find('span').last().text().trim();
                    globalStats.year = parseInt(yearText);
                } else if (text.includes('Day') && !text.includes('Daily')) {
                    const dayText = $elem.find('span').last().text().trim();
                    globalStats.day = parseInt(dayText);
                } else if (text.includes('Cities')) {
                    // Structure: Cities <hr> <span><span class="opacity-50">2,147</span>(22)</span>
                    const allSpans = $elem.find('span');
                    // The opacity-50 span contains total cities
                    const totalText = allSpans.filter('.opacity-50').text().trim();
                    // The parent span contains both total and active
                    const fullText = allSpans.eq(1).text().trim();
                    const activeMatch = fullText.match(/\((\d+)\)/);
                    
                    if (totalText) {
                        globalStats.totalCities = parseInt(totalText.replace(/,/g, ''));
                    }
                    if (activeMatch) {
                        globalStats.activeCities = parseInt(activeMatch[1]);
                    }
                } else if (text.includes('Total Citizens')) {
                    const citizensText = $elem.find('span').last().text().trim();
                    globalStats.totalCitizens = this.extractNumber(citizensText);
                } else if (text.includes('Total Pollution')) {
                    const pollutionText = $elem.find('span').last().text().trim();
                    globalStats.totalPollution = this.extractNumber(pollutionText);
                } else if (text.includes('Daily Pollution')) {
                    const dailyText = $elem.find('span').last().text().trim();
                    globalStats.dailyPollution = this.extractNumber(dailyText);
                }
            });

            // Extract city data - each city is in a div.flex.flex-row.items-center.space-x-1
            $('article div.flex.flex-row.items-center.space-x-1').each((i, elem) => {
                const $cityDiv = $(elem);
                
                // Get city name and link
                const cityLink = $cityDiv.find('a[href^="/city/"]').first();
                if (cityLink.length === 0) return;
                
                const cityName = cityLink.text().trim();
                const cityUrl = this.baseUrl + cityLink.attr('href');
                
                // Check for email verification
                const isEmailVerified = $cityDiv.find('img[src*="mail"]').length > 0;
                
                // Check for patron badge
                const isPatron = $cityDiv.text().includes('patreon') || 
                                $cityDiv.find('a[href*="patreon"]').length > 0;
                
                // Check for contributor badge
                const hasContributed = $cityDiv.text().includes('codebase') || 
                                      $cityDiv.find('a[href*="github"]').length > 0;
                
                // Extract pollution and citizens from the right side
                let pollution = null;
                let citizens = null;
                
                // Find pollution value (with pollution.svg icon)
                $cityDiv.find('img[src*="pollution.svg"]').each((j, img) => {
                    const span = $(img).next('span');
                    if (span.length) {
                        pollution = this.extractNumber(span.text());
                    }
                });
                
                // Find citizens value (with citizen.svg icon)
                $cityDiv.find('img[src*="citizen.svg"]').each((j, img) => {
                    const span = $(img).next('span');
                    if (span.length) {
                        citizens = this.extractNumber(span.text());
                    }
                });

                if (cityName) {
                    const cityData = {
                        name: cityName,
                        url: cityUrl,
                        pollution: pollution,
                        citizens: citizens,
                        emailVerified: isEmailVerified,
                        isPatron: isPatron,
                        hasContributed: hasContributed
                    };

                    // Validate city data before adding
                    if (this.validateCity(cityData)) {
                        cities.push(cityData);
                    }
                }
            });

            console.log(`Scraped ${cities.length} cities`);
            return {
                globalStats,
                cities,
                metadata: {
                    scrapedAt: new Date().toISOString(),
                    version: this.version
                }
            };

        } catch (error) {
            console.error('Error scraping city list:', error.message);
            this.errors.push({ type: 'cityList', message: error.message, timestamp: new Date().toISOString() });
            throw error;
        }
    }

    /**
     * Scrape ongoing wars data
     */
    async scrapeWars() {
        try {
            console.log('Fetching war data...');
            const response = await this.fetchWithRetry(this.baseUrl);

            const $ = cheerio.load(response.data);
            const wars = [];

            // Find all war entries - they come after the "Ongoing wars" paragraph
            // Each war is in a div.flex.flex-row.items-center.space-x-1 structure
            let inWarsSection = false;
            
            $('p').each((i, elem) => {
                if ($(elem).text().includes('Ongoing wars')) {
                    inWarsSection = true;
                    
                    // Get the parent section and find war divs
                    const section = $(elem).parent();
                    
                    section.find('div.flex.flex-row.items-center.space-x-1').each((j, warDiv) => {
                        const $warDiv = $(warDiv);
                        
                        // Find city links
                        const cityLinks = $warDiv.find('a[href^="/city/"]');
                        if (cityLinks.length >= 2) {
                            const attacker = $(cityLinks[0]).text().trim();
                            const defender = $(cityLinks[1]).text().trim();
                            
                            // Find missiles count
                            let missiles = null;
                            const mightImg = $warDiv.find('img[src*="might"]');
                            if (mightImg.length > 0) {
                                const missilesSpan = mightImg.next('span');
                                if (missilesSpan.length > 0) {
                                    missiles = this.extractNumber(missilesSpan.text());
                                }
                            }
                            
                            const warData = {
                                attacker: attacker,
                                attackerUrl: this.baseUrl + $(cityLinks[0]).attr('href'),
                                defender: defender,
                                defenderUrl: this.baseUrl + $(cityLinks[1]).attr('href'),
                                missiles: missiles
                            };

                            // Validate war data before adding
                            if (this.validateWar(warData)) {
                                wars.push(warData);
                            }
                        }
                    });
                }
            });

            console.log(`Found ${wars.length} ongoing wars`);
            return wars;

        } catch (error) {
            console.error('Error scraping wars:', error.message);
            this.errors.push({ type: 'wars', message: error.message, timestamp: new Date().toISOString() });
            throw error;
        }
    }

    /**
     * Scrape individual city page
     */
    async scrapeCity(cityName) {
        try {
            const url = `${this.baseUrl}/city/${encodeURIComponent(cityName)}`;
            console.log(`  Scraping: ${cityName}...`);
            
            const response = await this.fetchWithRetry(url);

            const $ = cheerio.load(response.data);
            
            // Parse city stats from the top info bar
            const stats = {};
            const statLabels = {
                'Pollution': 'pollution',
                'Housing': 'housing',
                'Jobs': 'jobs',
                'Food capacity': 'foodCapacity',
                'Daily Food Consumption': 'dailyFoodConsumption',
                'Money': 'money',
                'Daily Tax Income': 'dailyTaxIncome',
                'Daily Cost': 'dailyCost',
                'Energy': 'energy',
                'Area': 'area',
                'Sprawl': 'sprawl',
                'Crime': 'crime',
                'Fun': 'fun',
                'Culture': 'culture',
                'Health': 'health'
            };
            
            // Extract basic city info from the first table
            let cityInfo = { year: null, day: null, season: null, citizens: null, region: null };
            
            const firstTable = $('table').first();
            const headerRow = firstTable.find('tr').first();
            const dataRow = firstTable.find('tr').eq(1);
            
            // Map headers to values
            const headers = [];
            headerRow.find('td.top_td').each((i, cell) => {
                headers.push($(cell).text().trim());
            });
            
            dataRow.find('td.top_td').each((i, cell) => {
                const header = headers[i];
                const value = $(cell).text().trim();
                
                if (header === 'Year') {
                    cityInfo.year = parseInt(value);
                } else if (header === 'Day') {
                    cityInfo.day = parseInt(value);
                } else if (header === 'Season') {
                    cityInfo.season = value;
                } else if (header === 'Citizens') {
                    cityInfo.citizens = parseInt(value.replace(/,/g, ''));
                } else if (i === 0) {
                    // First cell is the region
                    cityInfo.region = value;
                }
            });
            
            // Parse stats from the second table with tooltips
            $('td.top_td').each((i, elem) => {
                const $td = $(elem);
                const tooltip = $td.find('.tooltip').text().trim();
                const cellText = $td.text().trim();
                
                // Find matching stat label
                Object.keys(statLabels).forEach(label => {
                    if (tooltip === label || tooltip.includes(label)) {
                        // Get the value from the next row's corresponding cell
                        const nextRow = $td.parent().next('tr');
                        if (nextRow.length) {
                            const tdIndex = $td.parent().find('td').index($td);
                            const valueCell = nextRow.find('td').eq(tdIndex);
                            const value = this.extractStatValue(valueCell.text().trim());
                            if (value !== null) {
                                stats[statLabels[label]] = value;
                            }
                        }
                    }
                });
            });
            
            // Parse job/tax levels
            const jobLevels = [];
            $('h2:contains("Job/tax levels")').next('div').find('div.flex.flex-col').each((i, elem) => {
                const $levelDiv = $(elem);
                const levelText = $levelDiv.find('span.text-sm').text().trim();
                const levelMatch = levelText.match(/Level\s+(\d+)/);
                
                if (levelMatch) {
                    const level = parseInt(levelMatch[1]);
                    
                    // Tax rate is the next text after the span
                    const allText = $levelDiv.text();
                    const taxMatch = allText.match(/Level\s+\d+\s*([\d.]+)/);
                    
                    // Find citizens count
                    const citizensDiv = $levelDiv.find('div:contains("citizens")');
                    const citizensText = citizensDiv.text().trim();
                    const citizensMatch = citizensText.match(/([\d,]+)\s+citizens/);
                    
                    // Find total jobs
                    const jobsDiv = $levelDiv.find('div:contains("total jobs")');
                    const jobsText = jobsDiv.text().trim();
                    const jobsMatch = jobsText.match(/([\d,]+)\s+total jobs/);
                    
                    // Find available jobs
                    const availableDiv = $levelDiv.find('div:contains("available jobs")');
                    const availableText = availableDiv.text().trim();
                    const availableMatch = availableText.match(/([\d,]+)\s+available jobs/);
                    
                    jobLevels.push({
                        level: level,
                        taxRate: taxMatch ? parseFloat(taxMatch[1]) : null,
                        citizens: citizensMatch ? parseInt(citizensMatch[1].replace(/,/g, '')) : 0,
                        totalJobs: jobsMatch ? parseInt(jobsMatch[1].replace(/,/g, '')) : 0,
                        availableJobs: availableMatch ? parseInt(availableMatch[1].replace(/,/g, '')) : 0
                    });
                }
            });
            
            // Check for sanctions
            const sanctions = [];
            $('h2:contains("Sanctions")').next().find('a[href^="/city/"]').each((i, elem) => {
                sanctions.push($(elem).text().trim());
            });
            
            // Parse resources
            const resources = {};
            $('div.flex.flex-row.items-center.justify-between').each((i, elem) => {
                const $div = $(elem);
                const img = $div.find('img[src*="/images/"]');
                const alt = img.attr('alt');
                const spans = $div.find('span');
                
                if (alt && alt.includes('total') && spans.length >= 2) {
                    // Resource name from alt text
                    const resourceMatch = alt.match(/total\s+(\w+)/);
                    if (resourceMatch) {
                        const resourceName = resourceMatch[1];
                        const valueText = spans.last().text().trim();
                        
                        // Parse values like "373.69k/374.05k" or "1/50"
                        const fractionMatch = valueText.match(/([\d.]+[kMG]?)\/([\d.]+[kMG]?)/);
                        if (fractionMatch) {
                            resources[resourceName] = {
                                current: this.parseStatNumber(fractionMatch[1]),
                                max: this.parseStatNumber(fractionMatch[2])
                            };
                        } else {
                            const singleValue = this.parseStatNumber(valueText);
                            if (singleValue !== null) {
                                resources[resourceName] = singleValue;
                            }
                        }
                    }
                }
            });
            
            // Parse buildings - organized by category
            const buildings = {};
            
            // Find all h3 tags with building names and their following table with counts
            $('h3.text-l').each((i, h3Elem) => {
                const $h3 = $(h3Elem);
                const buildingName = $h3.text().trim();
                
                if (buildingName && buildingName.length > 0) {
                    // Go up 2 parent levels to find the container that has table siblings
                    const $container = $h3.parent().parent();
                    const $greenCell = $container.siblings().find('table td.bg-green-100 p.text-green-700').first();
                    
                    if ($greenCell.length) {
                        const countText = $greenCell.text().trim();
                        const count = this.extractNumber(countText);
                        
                        if (count !== null) {
                            const cleanName = buildingName.toLowerCase().replace(/\s+/g, '_');
                            buildings[cleanName] = count;
                        }
                    } else {
                        // No green cell means 0 buildings
                        const cleanName = buildingName.toLowerCase().replace(/\s+/g, '_');
                        buildings[cleanName] = 0;
                    }
                }
            });
            
            const cityData = {
                name: cityName,
                url: url,
                region: cityInfo.region,
                year: cityInfo.year,
                day: cityInfo.day,
                season: cityInfo.season,
                citizens: cityInfo.citizens,
                stats: stats,
                jobLevels: jobLevels,
                resources: resources,
                buildings: buildings,
                sanctionedBy: sanctions,
                scrapedAt: new Date().toISOString()
            };
            // Validate city details
            this.validateCityDetails(cityData);
            return cityData;

        } catch (error) {
            console.error(`Error scraping city ${cityName}:`, error.message);
            this.errors.push({ type: 'city', city: cityName, message: error.message, timestamp: new Date().toISOString() });
            return {
                name: cityName,
                url: `${this.baseUrl}/city/${encodeURIComponent(cityName)}`,
                error: error.message,
                scrapedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Helper function to extract numbers from text
     */
    extractNumber(text) {
        if (!text) return null;
        const match = text.match(/(-?[\d,]+)/);
        if (match) {
            return parseInt(match[1].replace(/,/g, ''));
        }
        return null;
    }

    /**
     * Helper function to extract stat values (handles fractions like "0/300.37k")
     */
    extractStatValue(text) {
        if (!text) return null;
        
        // Handle fractional values like "0/300.37k"
        const fractionMatch = text.match(/([\d,.]+)\/([\d,.]+[kMG]?)/);
        if (fractionMatch) {
            return {
                current: this.parseStatNumber(fractionMatch[1]),
                max: this.parseStatNumber(fractionMatch[2])
            };
        }
        
        // Handle single values with suffixes
        const singleMatch = text.match(/(-?[\d,.]+[kMG]?)/);
        if (singleMatch) {
            return this.parseStatNumber(singleMatch[1]);
        }
        
        return null;
    }

    /**
     * Parse numbers with k/M/G suffixes
     */
    parseStatNumber(text) {
        if (!text) return null;
        
        text = text.trim();
        const match = text.match(/(-?[\d,.]+)([kMG])?/);
        if (!match) return null;
        
        const num = parseFloat(match[1].replace(/,/g, ''));
        const suffix = match[2];
        
        if (suffix === 'k') return num * 1000;
        if (suffix === 'M') return num * 1000000;
        if (suffix === 'G') return num * 1000000000;
        
        return num;
    }

    /**
     * Save data to JSON file
     */
    async saveToFile(data, filename) {
        try {
            const filepath = `./${filename}`;
            await fs.writeFile(filepath, JSON.stringify(data, null, 2));
            console.log(`Data saved to ${filepath}`);
        } catch (error) {
            console.error('Error saving to file:', error.message);
            throw error;
        }
    }

    /**
     * Run complete scrape and save results
     */
    async runFullScrape() {
        const startTime = Date.now();
        this.errors = []; // Reset errors for new scrape
        this.warnings = []; // Reset warnings for new scrape
        
        try {
            console.log('=== Starting Full Scrape ===\n');

            // Scrape city list
            const cityData = await this.scrapeCityList();
            await this.saveToFile({
                globalStats: cityData.globalStats,
                cities: cityData.cities,
                metadata: {
                    scrapedAt: new Date().toISOString(),
                    version: this.version,
                    totalCities: cityData.globalStats.totalCities,
                    activeCities: cityData.globalStats.activeCities,
                    scrapedActiveCities: cityData.cities.length
                }
            }, 'cities.json');

            // Scrape wars
            const wars = await this.scrapeWars();
            
            // Validate wars against active cities
            const activeCities = new Set(cityData.cities.map(c => c.name));
            const warsWithValidation = wars.map(war => ({
                ...war,
                attackerActive: activeCities.has(war.attacker),
                defenderActive: activeCities.has(war.defender),
                bothActive: activeCities.has(war.attacker) && activeCities.has(war.defender)
            }));
            
            await this.saveToFile({
                wars: warsWithValidation,
                metadata: {
                    scrapedAt: new Date().toISOString(),
                    version: this.version,
                    totalWars: warsWithValidation.length,
                    activeWars: warsWithValidation.filter(w => w.bothActive).length
                }
            }, 'wars.json');

            // Scrape individual city pages in parallel batches
            console.log(`\nScraping individual city pages (${this.concurrency} concurrent)...`);
            
            const { results: cityDetails, errors: cityErrors } = await this.processBatch(
                cityData.cities,
                async (city) => {
                    console.log(`  Scraping: ${city.name}...`);
                    return await this.scrapeCity(city.name);
                },
                this.concurrency
            );
            
            const scrapeDuration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            const metadata = {
                scrapedAt: new Date().toISOString(),
                version: this.version,
                totalCities: cityData.cities.length,
                successfulScrapes: cityDetails.length,
                failedScrapes: cityErrors.length,
                scrapeDuration: `${scrapeDuration}s`,
                concurrency: this.concurrency,
                averageTimePerCity: `${(parseFloat(scrapeDuration) / cityDetails.length).toFixed(2)}s`,
                errors: this.errors,
                warnings: this.warnings
            };
            
            await this.saveToFile({
                cities: cityDetails,
                metadata: metadata
            }, 'city_details.json');

            // Save to database if enabled
            if (this.database) {
                console.log('\nSaving to database...');
                try {
                    await this.database.initialize();
                    
                    // Save scrape run metadata
                    const runId = await this.database.saveScrapeRun(metadata);
                    console.log(`  ✓ Scrape run saved (ID: ${runId})`);
                    
                    // Save global stats
                    await this.database.saveGlobalStats(runId, cityData.globalStats);
                    console.log(`  ✓ Global stats saved`);
                    
                    // Save cities
                    await this.database.saveCities(runId, cityData.cities);
                    console.log(`  ✓ ${cityData.cities.length} cities saved`);
                    
                    // Save wars
                    await this.database.saveWars(runId, warsWithValidation);
                    console.log(`  ✓ ${warsWithValidation.length} wars saved`);
                    
                    // Save city details (includes stats, resources, buildings)
                    await this.database.saveCityDetails(runId, cityDetails);
                    console.log(`  ✓ ${cityDetails.length} city details saved`);
                    
                } catch (dbError) {
                    console.error('Database error:', dbError.message);
                    this.errors.push(`Database save failed: ${dbError.message}`);
                }
            }

            const activeWars = warsWithValidation.filter(w => w.bothActive).length;
            
            console.log('\n=== Scrape Complete ===');
            console.log(`Total cities: ${cityData.cities.length}`);
            console.log(`Total wars: ${wars.length}`);
            console.log(`Wars with both cities active: ${activeWars}`);
            console.log(`City details scraped: ${cityDetails.length}`);
            console.log(`Duration: ${scrapeDuration}s`);
            if (this.database) {
                const dbType = process.env.TURSO_DATABASE_URL?.startsWith('libsql://') 
                    ? 'Turso Cloud' 
                    : 'Local SQLite';
                console.log(`Database: ${dbType}`);
            }
            if (this.errors.length > 0) {
                console.log(`Errors encountered: ${this.errors.length}`);
            }
            if (this.warnings.length > 0) {
                console.log(`Warnings: ${this.warnings.length}`);
            }

            return {
                cities: cityData,
                wars: warsWithValidation,
                cityDetails: cityDetails,
                metadata: {
                    scrapedAt: new Date().toISOString(),
                    version: this.version,
                    duration: `${scrapeDuration}s`,
                    errors: this.errors
                }
            };

        } catch (error) {
            console.error('Error in full scrape:', error.message);
            throw error;
        }
    }
}

// Main execution
if (require.main === module) {
    const scraper = new FragileCityScraper();
    
    scraper.runFullScrape()
        .then(data => {
            console.log('\nScraping completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\nScraping failed:', error);
            process.exit(1);
        });
}

module.exports = FragileCityScraper;
