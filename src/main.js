// Michael Page jobs scraper - Playwright with full stealth and API interception
import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '',
            location = '',
            results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 999,
            collectDetails = true,
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

        log.info('Starting Michael Page scraper', { keyword, location, RESULTS_WANTED, MAX_PAGES, collectDetails });

        // Build search URL
        const buildStartUrl = (kw, loc) => {
            const u = new URL('https://www.michaelpage.com/jobs');
            if (kw) u.searchParams.set('search', String(kw).trim());
            if (loc) u.searchParams.set('location', String(loc).trim());
            return u.href;
        };

        // Collect initial URLs
        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location));

        log.info('Starting crawl', { urls: initial });

        // Setup proxy
        let proxyConf;
        try {
            proxyConf = proxyConfiguration
                ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
                : await Actor.createProxyConfiguration({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });
            log.info('Proxy configured successfully');
        } catch (err) {
            log.warning(`Proxy error: ${err.message}. Running without proxy.`);
            proxyConf = undefined;
        }

        let saved = 0;
        const seenUrls = new Set();
        const capturedJobs = [];

        // Clean text
        const cleanText = (html) => {
            if (!html) return '';
            try {
                const $ = cheerioLoad(html);
                $('script, style').remove();
                return $.text().replace(/\s+/g, ' ').trim();
            } catch {
                return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            }
        };

        const crawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            persistCookiesPerSession: true,
            sessionPoolOptions: {
                maxPoolSize: 5,
            },
            maxConcurrency: 1, // Low for stealth
            requestHandlerTimeoutSecs: 180,
            navigationTimeoutSecs: 90,

            browserPoolOptions: {
                useFingerprints: true,
                fingerprintOptions: {
                    fingerprintGeneratorOptions: {
                        browsers: ['chrome'],
                        devices: ['desktop'],
                        operatingSystems: ['windows'],
                    },
                },
            },

            launchContext: {
                launchOptions: {
                    headless: true,
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-web-security',
                        '--disable-features=IsolateOrigins,site-per-process',
                    ],
                },
            },

            async preNavigationHooks({ page, request }) {
                // Remove webdriver property
                await page.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    // Override permissions
                    const originalQuery = window.navigator.permissions.query;
                    window.navigator.permissions.query = (parameters) =>
                        parameters.name === 'notifications'
                            ? Promise.resolve({ state: Notification.permission })
                            : originalQuery(parameters);
                });

                // Set real user agent
                await page.setExtraHTTPHeaders({
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'DNT': '1',
                    'Upgrade-Insecure-Requests': '1',
                });

                // Intercept responses to capture GraphQL/API data
                page.on('response', async (response) => {
                    const url = response.url();
                    const status = response.status();

                    if (url.includes('graphql') || url.includes('/api/') || url.includes('jobs')) {
                        try {
                            const contentType = response.headers()['content-type'] || '';
                            if (contentType.includes('application/json') && status === 200) {
                                const json = await response.json().catch(() => null);
                                if (json) {
                                    log.debug(`Captured JSON from: ${url}`);
                                    extractJobsFromJson(json);
                                }
                            }
                        } catch (e) {
                            // Ignore
                        }
                    }
                });

                // Function to extract jobs from any JSON structure
                function extractJobsFromJson(obj, depth = 0) {
                    if (!obj || depth > 10) return;

                    if (Array.isArray(obj)) {
                        obj.forEach(item => extractJobsFromJson(item, depth + 1));
                        return;
                    }

                    if (typeof obj === 'object') {
                        // Check if this looks like a job object
                        if (obj.title && typeof obj.title === 'string' && obj.title.length > 0) {
                            const jobUrl = obj.url || obj.link || obj.href ||
                                (obj.slug ? `https://www.michaelpage.com/job-detail/${obj.slug}` : null) ||
                                (obj.id ? `https://www.michaelpage.com/job-detail/${obj.id}` : null);

                            if (jobUrl && !capturedJobs.find(j => j.url === jobUrl)) {
                                capturedJobs.push({
                                    title: obj.title || obj.name,
                                    company: obj.company?.name || obj.hiringOrganization?.name || obj.employer || null,
                                    location: obj.location?.name || obj.location?.city ||
                                        (typeof obj.location === 'string' ? obj.location : null) ||
                                        obj.city || obj.region || null,
                                    salary: obj.salary || obj.compensation || obj.pay || null,
                                    job_type: obj.employmentType || obj.type || obj.contractType || null,
                                    date_posted: obj.datePosted || obj.postedAt || obj.createdAt || null,
                                    description_text: obj.description || obj.summary || obj.content || null,
                                    url: jobUrl,
                                });
                                log.debug(`Captured job from API: ${obj.title}`);
                            }
                        }

                        // Recurse into object properties
                        Object.values(obj).forEach(val => extractJobsFromJson(val, depth + 1));
                    }
                }

                log.debug(`Navigating to: ${request.url}`);
            },

            async requestHandler({ request, page, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 0;

                crawlerLog.info(`[${label}] Loading: ${request.url}`);

                try {
                    // Wait for page load
                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    crawlerLog.info('Page DOM loaded');

                    // Handle cookie consent
                    try {
                        const cookieSelectors = [
                            'button:has-text("Accept")',
                            'button:has-text("Accept All")',
                            'button:has-text("OK")',
                            'button:has-text("I Agree")',
                            '[id*="cookie"] button',
                            '[class*="cookie"] button',
                            '[id*="consent"] button',
                            '.cookie-banner button',
                        ];

                        for (const sel of cookieSelectors) {
                            const btn = page.locator(sel).first();
                            if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                                await btn.click().catch(() => { });
                                crawlerLog.info('Clicked cookie consent');
                                break;
                            }
                        }
                    } catch {
                        // No cookie banner
                    }

                    // Wait for network to settle
                    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });

                    // Extra wait for dynamic content
                    await page.waitForTimeout(3000);

                    // Get page content
                    const content = await page.content();
                    const $ = cheerioLoad(content);

                    if (label === 'LIST') {
                        // Check if we captured any jobs from API
                        if (capturedJobs.length > 0) {
                            crawlerLog.info(`Captured ${capturedJobs.length} jobs from API responses`);

                            for (const job of capturedJobs) {
                                if (saved >= RESULTS_WANTED) break;
                                if (seenUrls.has(job.url)) continue;
                                seenUrls.add(job.url);

                                await Dataset.pushData({
                                    ...job,
                                    scrapedAt: new Date().toISOString(),
                                });
                                saved++;
                            }
                            capturedJobs.length = 0;
                        }

                        // Find job links from HTML
                        const jobLinks = [];
                        $('a[href*="/job-detail/"]').each((_, el) => {
                            const href = $(el).attr('href');
                            if (href && !href.includes('javascript:')) {
                                const fullUrl = href.startsWith('http') ? href : `https://www.michaelpage.com${href}`;
                                if (!seenUrls.has(fullUrl)) {
                                    jobLinks.push(fullUrl);
                                    seenUrls.add(fullUrl);
                                }
                            }
                        });

                        crawlerLog.info(`Found ${jobLinks.length} job links from HTML`);

                        // If no jobs found, try alternative selectors
                        if (jobLinks.length === 0 && capturedJobs.length === 0) {
                            // Check page title
                            const title = await page.title();
                            crawlerLog.warning(`No jobs found. Page title: ${title}`);

                            // Log page HTML structure for debugging
                            const bodyClasses = $('body').attr('class') || 'none';
                            crawlerLog.debug(`Body classes: ${bodyClasses}`);

                            // Try to find any job-like links
                            $('a').each((_, el) => {
                                const href = $(el).attr('href') || '';
                                const text = $(el).text().trim();
                                if ((href.includes('job') || href.includes('career')) &&
                                    text.length > 5 && text.length < 200 &&
                                    !href.includes('javascript:')) {
                                    const fullUrl = href.startsWith('http') ? href : `https://www.michaelpage.com${href}`;
                                    if (!seenUrls.has(fullUrl) && fullUrl.includes('michaelpage.com')) {
                                        jobLinks.push(fullUrl);
                                        seenUrls.add(fullUrl);
                                    }
                                }
                            });

                            if (jobLinks.length > 0) {
                                crawlerLog.info(`Fallback found ${jobLinks.length} potential job links`);
                            }

                            // Take debug screenshot
                            if (pageNo === 0) {
                                const screenshot = await page.screenshot({ type: 'png', fullPage: false });
                                await Actor.setValue('debug-screenshot', screenshot, { contentType: 'image/png' });
                                crawlerLog.info('Saved debug screenshot');
                            }
                        }

                        // Enqueue detail pages
                        if (collectDetails && jobLinks.length > 0) {
                            const remaining = RESULTS_WANTED - saved;
                            const toEnqueue = jobLinks.slice(0, Math.min(remaining, 50));

                            for (const jobUrl of toEnqueue) {
                                await crawler.addRequests([{
                                    url: jobUrl,
                                    userData: { label: 'DETAIL' },
                                }]);
                            }
                            crawlerLog.info(`Enqueued ${toEnqueue.length} detail pages`);
                        } else if (!collectDetails && jobLinks.length > 0) {
                            const remaining = RESULTS_WANTED - saved;
                            const toPush = jobLinks.slice(0, remaining);
                            await Dataset.pushData(toPush.map(u => ({
                                url: u,
                                scrapedAt: new Date().toISOString(),
                            })));
                            saved += toPush.length;
                            crawlerLog.info(`Saved ${toPush.length} URLs`);
                        }

                        // Pagination
                        if (saved < RESULTS_WANTED && pageNo < MAX_PAGES - 1 && jobLinks.length > 0) {
                            const nextPageNo = pageNo + 1;
                            const nextUrl = new URL(request.url);
                            nextUrl.searchParams.set('page', String(nextPageNo));

                            await crawler.addRequests([{
                                url: nextUrl.href,
                                userData: { label: 'LIST', pageNo: nextPageNo },
                            }]);
                            crawlerLog.info(`Enqueued page ${nextPageNo + 1}`);
                        }
                    }

                    if (label === 'DETAIL') {
                        if (saved >= RESULTS_WANTED) return;

                        // Extract JSON-LD
                        let jsonLd = null;
                        $('script[type="application/ld+json"]').each((_, el) => {
                            try {
                                const text = $(el).html();
                                if (text) {
                                    const parsed = JSON.parse(text);
                                    const items = Array.isArray(parsed) ? parsed : [parsed];
                                    for (const item of items) {
                                        if (item?.['@type'] === 'JobPosting') {
                                            jsonLd = item;
                                            break;
                                        }
                                    }
                                }
                            } catch { }
                        });

                        // Extract from HTML
                        const title = jsonLd?.title || jsonLd?.name ||
                            $('h1').first().text().trim() ||
                            $('title').text().split('|')[0]?.trim();

                        // Get description
                        let description = jsonLd?.description || '';
                        if (!description) {
                            const parts = [];
                            $('h2').each((_, h2) => {
                                const heading = $(h2).text().toLowerCase();
                                if (heading.includes('about') || heading.includes('description') ||
                                    heading.includes('applicant') || heading.includes('offer')) {
                                    let text = '';
                                    $(h2).nextUntil('h2').each((_, sibling) => {
                                        text += $(sibling).text() + ' ';
                                    });
                                    if (text.trim()) parts.push(text.trim());
                                }
                            });
                            description = parts.join('\n\n') || $('article, main, .content').text().trim().substring(0, 2000);
                        }

                        // Extract location
                        let jobLocation = null;
                        if (jsonLd?.jobLocation) {
                            const loc = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation[0] : jsonLd.jobLocation;
                            if (loc?.address) {
                                jobLocation = [loc.address.addressLocality, loc.address.addressRegion]
                                    .filter(Boolean).join(', ');
                            }
                        }
                        if (!jobLocation) {
                            jobLocation = $('.job-location, .location, [itemprop="jobLocation"]').first().text().trim() || null;
                        }

                        // Extract salary
                        let salary = null;
                        if (jsonLd?.baseSalary) {
                            const bs = jsonLd.baseSalary;
                            if (typeof bs === 'string') salary = bs;
                            else if (bs?.value) {
                                const val = bs.value;
                                if (typeof val === 'object') {
                                    salary = `${val.minValue || ''} - ${val.maxValue || ''} ${bs.currency || ''}`.trim();
                                } else {
                                    salary = `${val} ${bs.currency || ''}`;
                                }
                            }
                        }
                        if (!salary) {
                            salary = $('.job-salary, .salary').first().text().trim() || null;
                        }

                        const data = {
                            title: title || null,
                            company: jsonLd?.hiringOrganization?.name || null,
                            location: jobLocation,
                            salary: salary,
                            job_type: jsonLd?.employmentType ||
                                (Array.isArray(jsonLd?.employmentType) ? jsonLd.employmentType.join(', ') : null),
                            date_posted: jsonLd?.datePosted || null,
                            description_html: description,
                            description_text: cleanText(description),
                            url: request.url,
                            scrapedAt: new Date().toISOString(),
                        };

                        if (!data.title) {
                            crawlerLog.warning(`No title found: ${request.url}`);
                            return;
                        }

                        await Dataset.pushData(data);
                        saved++;
                        crawlerLog.info(`[DETAIL] Saved ${saved}/${RESULTS_WANTED}: ${data.title}`);
                    }

                } catch (err) {
                    crawlerLog.error(`Error: ${err.message}`, { stack: err.stack });
                }
            },

            async failedRequestHandler({ request }, error) {
                log.error(`Failed: ${request.url}`, { error: error.message });
            },
        });

        log.info('Starting crawler...');
        await crawler.run(initial.map(u => ({
            url: u,
            userData: { label: 'LIST', pageNo: 0 },
        })));

        log.info(`Complete. Saved ${saved} jobs.`);

        if (saved === 0) {
            log.warning('No jobs saved. Check debug-screenshot in key-value store.');
        }
    } catch (err) {
        log.error(`Fatal: ${err.message}`, { stack: err.stack });
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
