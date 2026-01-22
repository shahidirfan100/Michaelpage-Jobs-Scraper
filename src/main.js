/**
 * Michael Page Jobs Scraper - Optimized Hybrid Approach v3
 * Fast Playwright for listings, HTTP for details with proper field extraction
 * 
 * @description A production-ready Apify Actor that scrapes job listings from Michael Page.
 * Uses a two-phase approach: Playwright for pagination-heavy listing pages,
 * and CheerioCrawler for fast detail page extraction.
 */
import { Actor, log } from 'apify';
import { PlaywrightCrawler, CheerioCrawler, Dataset } from 'crawlee';

await Actor.init();

/**
 * Strips HTML tags and normalizes whitespace from a string.
 * @param {string} html - The HTML string to clean
 * @returns {string} Plain text with normalized whitespace
 */
const cleanText = (html) => {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};

/**
 * Extracts a field value from the job summary section by its label.
 * Searches through dt/dd pairs in the DOM to find matching fields.
 * @param {CheerioAPI} $ - Cheerio instance loaded with the page HTML
 * @param {string} labelText - The label text to search for (case-insensitive)
 * @returns {string|null} The extracted value or null if not found
 */
const extractSummaryField = ($, labelText) => {
    const searchLabel = labelText.toLowerCase();
    let value = null;

    // Primary: Search dt elements for matching label
    $('dt').each((_, dt) => {
        const label = $(dt).text().toLowerCase().trim();
        if (label.includes(searchLabel)) {
            value = $(dt).next('dd').text().trim() ||
                $(dt).next('dd.field--item').text().trim() ||
                $(dt).siblings('dd.field--item').first().text().trim();
        }
    });

    // Fallback: Search dl structure
    if (!value) {
        $('dl').each((_, dl) => {
            const dt = $(dl).find('dt').text().toLowerCase().trim();
            if (dt.includes(searchLabel)) {
                value = $(dl).find('dd.field--item, dd.summary-detail-field-value').text().trim();
            }
        });
    }

    return value || null;
};

/**
 * Extracts field value from dd elements by checking previous dt label.
 * @param {CheerioAPI} $ - Cheerio instance
 * @param {string} labelText - Label to match in previous dt element
 * @returns {string|null} Extracted value or null
 */
const extractFieldByDtLabel = ($, labelText) => {
    const searchLabel = labelText.toLowerCase();
    const result = $('dd.field--item.summary-detail-field-value')
        .filter((_, el) => $(el).prev('dt').text().toLowerCase().includes(searchLabel))
        .first()
        .text()
        .trim();
    return result || null;
};

/**
 * Builds the Michael Page search URL with query parameters.
 * @param {string} keyword - Job search keyword
 * @param {string} location - Location filter
 * @returns {string} Complete search URL
 */
const buildStartUrl = (keyword, location) => {
    const url = new URL('https://www.michaelpage.com/jobs');
    if (keyword) url.searchParams.set('search', String(keyword).trim());
    if (location) url.searchParams.set('location', String(location).trim());
    return url.href;
};

/**
 * Main scraper entry point.
 * Orchestrates the two-phase scraping process.
 * @returns {Promise<void>}
 */
async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '',
            location = '',
            results_wanted: RESULTS_WANTED_RAW = 20,
            max_pages: MAX_PAGES_RAW = 10,
            collectDetails = true,
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW)
            ? Math.max(1, +RESULTS_WANTED_RAW)
            : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW)
            ? Math.max(1, +MAX_PAGES_RAW)
            : 999;

        log.info('Starting Michael Page scraper', { keyword, location, RESULTS_WANTED, MAX_PAGES });

        // Build initial URLs from various input sources
        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location));

        // Setup proxy configuration
        let proxyConf;
        try {
            proxyConf = proxyConfiguration
                ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
                : await Actor.createProxyConfiguration({
                    useApifyProxy: true,
                    apifyProxyGroups: ['RESIDENTIAL']
                });
        } catch (err) {
            log.warning(`Proxy error: ${err.message}`);
            proxyConf = undefined;
        }

        let saved = 0;
        const seenUrls = new Set();
        const jobUrls = [];

        // ============================================================
        // PHASE 1: Fast Playwright for listing pages only
        // ============================================================
        log.info('Phase 1: Collecting job URLs...');

        const listingCrawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 2,
            useSessionPool: true,
            persistCookiesPerSession: true,
            maxConcurrency: 1,
            requestHandlerTimeoutSecs: 90,
            navigationTimeoutSecs: 45,

            launchContext: {
                launchOptions: {
                    headless: true,
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-gpu'
                    ],
                },
            },

            preNavigationHooks: [
                async ({ page }) => {
                    // Hide webdriver property to avoid detection
                    await page.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    });
                    // Block unnecessary resources for faster loading
                    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf}', route => route.abort());
                },
            ],

            async requestHandler({ request, page, log: crawlerLog }) {
                const pageNo = request.userData?.pageNo || 0;
                crawlerLog.info(`[LIST] Page ${pageNo + 1}`);

                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

                // Dismiss cookie consent if present
                try {
                    const cookieBtn = page.locator('button:has-text("Accept")').first();
                    if (await cookieBtn.isVisible({ timeout: 1500 })) {
                        await cookieBtn.click();
                    }
                } catch { /* Cookie button not found - continue */ }

                await page.waitForTimeout(1500);

                // Extract unique job detail links
                const links = await page.$$eval('a[href*="/job-detail/"]', (anchors) =>
                    [...new Set(anchors.map(a => a.href).filter(h => h && !h.includes('javascript:')))]
                );

                const uniqueLinks = links.filter(link => {
                    if (seenUrls.has(link)) return false;
                    seenUrls.add(link);
                    return true;
                });

                jobUrls.push(...uniqueLinks);
                crawlerLog.info(`Found ${uniqueLinks.length} links (total: ${jobUrls.length})`);

                // Paginate if more results needed
                if (jobUrls.length < RESULTS_WANTED && pageNo < MAX_PAGES - 1 && uniqueLinks.length > 0) {
                    const nextUrl = new URL(request.url);
                    nextUrl.searchParams.set('page', String(pageNo + 1));
                    await listingCrawler.addRequests([{
                        url: nextUrl.href,
                        userData: { pageNo: pageNo + 1 }
                    }]);
                }
            },
        });

        await listingCrawler.run(initial.map(u => ({ url: u, userData: { pageNo: 0 } })));
        log.info(`Phase 1 done. Collected ${jobUrls.length} URLs`);

        if (jobUrls.length === 0) {
            log.warning('No job URLs found');
            await Actor.exit();
            return;
        }

        // ============================================================
        // PHASE 2: Fast HTTP for detail pages
        // ============================================================
        if (!collectDetails) {
            const toSave = jobUrls.slice(0, RESULTS_WANTED);
            await Dataset.pushData(toSave.map(u => ({
                url: u,
                scrapedAt: new Date().toISOString()
            })));
            log.info(`Saved ${toSave.length} URLs`);
            await Actor.exit();
            return;
        }

        log.info('Phase 2: Fetching details...');

        const urlsToFetch = jobUrls.slice(0, RESULTS_WANTED);
        log.info(`Queuing ${urlsToFetch.length} detail URLs`);

        const detailCrawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            maxConcurrency: 15,
            requestHandlerTimeoutSecs: 20,

            async requestHandler({ request, $, log: crawlerLog }) {
                if (saved >= RESULTS_WANTED) return;

                // Extract JSON-LD structured data (primary source)
                let jsonLd = null;
                $('script[type="application/ld+json"]').each((_, el) => {
                    try {
                        const text = $(el).html();
                        if (text) {
                            const parsed = JSON.parse(text);
                            const items = Array.isArray(parsed) ? parsed : [parsed];
                            const found = items.find(item => item?.['@type'] === 'JobPosting');
                            if (found) jsonLd = found;
                        }
                    } catch { /* Invalid JSON - skip */ }
                });

                // Extract Title
                const title = jsonLd?.title || jsonLd?.name ||
                    $('h1').first().text().trim() ||
                    $('meta[property="og:title"]').attr('content')?.split('|')[0]?.trim();

                // Extract Description HTML
                let descriptionHtml = '';
                if (jsonLd?.description) {
                    descriptionHtml = jsonLd.description;
                } else {
                    const sections = [];
                    const relevantHeadings = ['about', 'description', 'applicant', 'offer', 'job summary', 'responsibilities'];

                    $('h2').each((_, h2) => {
                        const heading = $(h2).text().toLowerCase();
                        if (relevantHeadings.some(term => heading.includes(term))) {
                            let sectionHtml = '';
                            $(h2).nextUntil('h2').each((_, sib) => {
                                sectionHtml += $.html(sib);
                            });
                            if (sectionHtml.trim()) {
                                sections.push(`<h2>${$(h2).text()}</h2>${sectionHtml}`);
                            }
                        }
                    });
                    descriptionHtml = sections.length > 0
                        ? sections.join('')
                        : ($('article, main .content, .job-description, .job-content').first().html() || '');
                }

                // Extract Location
                let jobLocation = null;
                if (jsonLd?.jobLocation) {
                    const loc = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation[0] : jsonLd.jobLocation;
                    if (loc?.address) {
                        jobLocation = [
                            loc.address.addressLocality,
                            loc.address.addressRegion,
                            loc.address.addressCountry
                        ].filter(Boolean).join(', ');
                    }
                }
                if (!jobLocation) {
                    jobLocation = extractSummaryField($, 'location') ||
                        $('[itemprop="addressLocality"]').text().trim() ||
                        $('.job-location').text().trim() || null;
                }

                // Extract Salary
                let salary = null;
                if (jsonLd?.baseSalary) {
                    const bs = jsonLd.baseSalary;
                    if (typeof bs === 'string') {
                        salary = bs;
                    } else if (bs?.value) {
                        const val = bs.value;
                        const currency = bs.currency || '';
                        if (typeof val === 'object') {
                            salary = `${currency} ${val.minValue || ''} - ${val.maxValue || ''}`.trim();
                        } else {
                            salary = `${currency} ${val}`.trim();
                        }
                    }
                }
                if (!salary) {
                    salary = extractSummaryField($, 'salary') ||
                        $('[itemprop="baseSalary"]').text().trim() ||
                        $('.job-salary, .salary').text().trim() || null;
                }

                // Extract Job Type / Contract Type
                let jobType = null;
                if (jsonLd?.employmentType) {
                    jobType = Array.isArray(jsonLd.employmentType)
                        ? jsonLd.employmentType.join(', ')
                        : jsonLd.employmentType;
                }
                if (!jobType) {
                    jobType = extractSummaryField($, 'contract') ||
                        extractSummaryField($, 'job type') ||
                        extractSummaryField($, 'employment') ||
                        extractFieldByDtLabel($, 'contract') ||
                        extractFieldByDtLabel($, 'type') ||
                        $('[itemprop="employmentType"]').text().trim() ||
                        $('.job-contract-type').text().trim() || null;
                }

                // Extract Sector
                const sector = extractSummaryField($, 'sector') ||
                    extractFieldByDtLabel($, 'sector') || null;

                // Extract Industry
                const industry = extractSummaryField($, 'industry') ||
                    extractFieldByDtLabel($, 'industry') ||
                    jsonLd?.industry || null;

                // Extract Job Nature (Permanent/Contract/Temporary)
                const jobNature = extractSummaryField($, 'job nature') ||
                    extractSummaryField($, 'nature') ||
                    extractFieldByDtLabel($, 'nature') || null;

                // Extract Company
                let company = null;
                if (jsonLd?.hiringOrganization) {
                    company = typeof jsonLd.hiringOrganization === 'string'
                        ? jsonLd.hiringOrganization
                        : jsonLd.hiringOrganization.name;
                }
                if (!company) {
                    company = extractSummaryField($, 'company') ||
                        extractSummaryField($, 'employer') ||
                        extractFieldByDtLabel($, 'company') ||
                        extractFieldByDtLabel($, 'employer') ||
                        $('[itemprop="hiringOrganization"] [itemprop="name"]').text().trim() ||
                        $('.company-name').text().trim() || null;
                }

                // Extract Date Posted
                let datePosted = jsonLd?.datePosted || null;
                if (!datePosted) {
                    datePosted = extractSummaryField($, 'posted') ||
                        extractSummaryField($, 'date') ||
                        $('[itemprop="datePosted"]').attr('content') ||
                        $('[itemprop="datePosted"]').text().trim() ||
                        $('time[datetime]').attr('datetime') ||
                        $('.posted-date, .date-posted').text().trim() || null;
                }

                // Build final data object
                const data = {
                    title: title || null,
                    company,
                    location: jobLocation,
                    salary,
                    job_type: jobType,
                    job_nature: jobNature,
                    sector,
                    industry,
                    date_posted: datePosted,
                    description_html: descriptionHtml || null,
                    description_text: cleanText(descriptionHtml),
                    url: request.url,
                    scrapedAt: new Date().toISOString(),
                };

                if (!data.title) {
                    crawlerLog.debug(`No title: ${request.url}`);
                    return;
                }

                await Dataset.pushData(data);
                saved++;

                if (saved % 10 === 0 || saved === RESULTS_WANTED) {
                    crawlerLog.info(`Progress: ${saved}/${RESULTS_WANTED}`);
                }
            },

            async failedRequestHandler({ request }) {
                log.debug(`Failed: ${request.url}`);
            },
        });

        await detailCrawler.run(urlsToFetch);
        log.info(`Done. Saved ${saved} jobs.`);

    } catch (err) {
        log.error(`Fatal: ${err.message}`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
