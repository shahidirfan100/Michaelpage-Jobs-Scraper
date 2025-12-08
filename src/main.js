// Michael Page jobs scraper - Playwright with GraphQL API interception
// Priority: 1) Intercept GraphQL API calls, 2) Extract from page HTML
import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';

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

        log.info('Starting Michael Page Playwright scraper', { keyword, location, RESULTS_WANTED, MAX_PAGES, collectDetails });

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

        log.info('Initial URLs:', { urls: initial });

        // Setup proxy configuration
        let proxyConf;
        try {
            proxyConf = proxyConfiguration
                ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
                : await Actor.createProxyConfiguration({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });
        } catch (err) {
            log.warning(`Proxy config error: ${err.message}. Proceeding without proxy.`);
            proxyConf = undefined;
        }

        let saved = 0;
        const seenUrls = new Set();
        const graphqlJobs = []; // Store jobs from GraphQL responses

        // Clean HTML to plain text
        const cleanText = (html) => {
            if (!html) return '';
            return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        };

        const crawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 10,
                sessionOptions: { maxUsageCount: 30 },
            },
            maxConcurrency: 2,
            minConcurrency: 1,
            requestHandlerTimeoutSecs: 120,
            navigationTimeoutSecs: 60,

            // Browser launch options for stealth
            launchContext: {
                launchOptions: {
                    headless: true,
                    args: [
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                    ],
                },
            },

            // Setup request interception for GraphQL
            async preNavigationHooks({ page, request, log: crawlerLog }) {
                // Set realistic viewport
                await page.setViewportSize({ width: 1920, height: 1080 });

                // Intercept GraphQL API responses
                page.on('response', async (response) => {
                    const url = response.url();
                    if (url.includes('/graphql')) {
                        try {
                            const json = await response.json();
                            crawlerLog.debug(`GraphQL response captured from ${url}`);

                            // Try to extract job data from various GraphQL response structures
                            const extractJobs = (obj, path = '') => {
                                if (!obj || typeof obj !== 'object') return;

                                // Look for job-like objects
                                if (obj.title && (obj.url || obj.slug || obj.id)) {
                                    graphqlJobs.push({
                                        title: obj.title,
                                        company: obj.company?.name || obj.hiringOrganization?.name || null,
                                        location: obj.location?.name || obj.location || obj.city || null,
                                        salary: obj.salary || obj.compensation || null,
                                        job_type: obj.employmentType || obj.type || obj.contractType || null,
                                        date_posted: obj.datePosted || obj.createdAt || obj.publishedAt || null,
                                        description_text: obj.description || obj.summary || null,
                                        url: obj.url || (obj.slug ? `https://www.michaelpage.com/job-detail/${obj.slug}` : null),
                                    });
                                }

                                // Recurse into arrays and objects
                                if (Array.isArray(obj)) {
                                    obj.forEach((item, i) => extractJobs(item, `${path}[${i}]`));
                                } else {
                                    Object.keys(obj).forEach(key => {
                                        if (key === 'jobs' || key === 'items' || key === 'results' || key === 'nodes' || key === 'edges') {
                                            extractJobs(obj[key], `${path}.${key}`);
                                        } else if (typeof obj[key] === 'object') {
                                            extractJobs(obj[key], `${path}.${key}`);
                                        }
                                    });
                                }
                            };

                            extractJobs(json);
                            if (graphqlJobs.length > 0) {
                                crawlerLog.info(`Extracted ${graphqlJobs.length} jobs from GraphQL so far`);
                            }
                        } catch (err) {
                            crawlerLog.debug(`Failed to parse GraphQL response: ${err.message}`);
                        }
                    }
                });

                // Accept cookies automatically
                page.on('dialog', async (dialog) => {
                    await dialog.accept();
                });
            },

            async requestHandler({ request, page, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 0;

                crawlerLog.info(`[${label}] Processing: ${request.url}`);

                try {
                    // Wait for page to load
                    await page.waitForLoadState('domcontentloaded');

                    // Try to close cookie consent if present
                    try {
                        const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("OK"), button:has-text("Agree"), [id*="cookie"] button, [class*="cookie"] button');
                        if (await cookieBtn.first().isVisible({ timeout: 3000 })) {
                            await cookieBtn.first().click();
                            crawlerLog.info('Clicked cookie consent button');
                            await page.waitForTimeout(1000);
                        }
                    } catch {
                        // Cookie button not found, continue
                    }

                    // Wait for content to load
                    await page.waitForTimeout(2000);
                    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

                    if (label === 'LIST') {
                        // First check if we got jobs from GraphQL interception
                        if (graphqlJobs.length > 0) {
                            crawlerLog.info(`Found ${graphqlJobs.length} jobs from GraphQL API`);

                            for (const job of graphqlJobs) {
                                if (saved >= RESULTS_WANTED) break;
                                if (job.url && seenUrls.has(job.url)) continue;
                                if (job.url) seenUrls.add(job.url);

                                await Dataset.pushData({
                                    ...job,
                                    scrapedAt: new Date().toISOString(),
                                });
                                saved++;
                            }
                            graphqlJobs.length = 0; // Clear processed jobs

                            if (saved >= RESULTS_WANTED) {
                                crawlerLog.info(`Reached target of ${RESULTS_WANTED} jobs`);
                                return;
                            }
                        }

                        // Fallback: Find job links from HTML
                        const jobLinks = await page.$$eval('a[href*="/job-detail/"]', (links) => {
                            return links
                                .map(a => a.href)
                                .filter(href => href && !href.includes('javascript:'));
                        });

                        const uniqueLinks = jobLinks.filter(link => {
                            if (seenUrls.has(link)) return false;
                            seenUrls.add(link);
                            return true;
                        });

                        crawlerLog.info(`[LIST] Page ${pageNo}: Found ${uniqueLinks.length} new job links from HTML`);

                        if (uniqueLinks.length === 0 && graphqlJobs.length === 0 && pageNo === 0) {
                            // Debug: log page title and content snippet
                            const pageTitle = await page.title();
                            crawlerLog.warning(`No jobs found on first page. Title: ${pageTitle}`);

                            // Take screenshot for debugging
                            const screenshot = await page.screenshot({ type: 'png' });
                            await Actor.setValue('debug-screenshot', screenshot, { contentType: 'image/png' });
                            crawlerLog.info('Saved debug screenshot to key-value store');
                        }

                        if (collectDetails && uniqueLinks.length > 0) {
                            const remaining = RESULTS_WANTED - saved;
                            const toEnqueue = uniqueLinks.slice(0, Math.max(0, remaining));
                            if (toEnqueue.length) {
                                await enqueueLinks({
                                    urls: toEnqueue,
                                    userData: { label: 'DETAIL' },
                                });
                                crawlerLog.info(`Enqueued ${toEnqueue.length} detail pages`);
                            }
                        } else if (!collectDetails && uniqueLinks.length > 0) {
                            const remaining = RESULTS_WANTED - saved;
                            const toPush = uniqueLinks.slice(0, Math.max(0, remaining));
                            await Dataset.pushData(toPush.map(u => ({
                                url: u,
                                scrapedAt: new Date().toISOString(),
                            })));
                            saved += toPush.length;
                        }

                        // Pagination
                        if (saved < RESULTS_WANTED && pageNo < MAX_PAGES && uniqueLinks.length > 0) {
                            const nextPageNo = pageNo + 1;
                            const nextUrl = new URL(request.url);
                            nextUrl.searchParams.set('page', String(nextPageNo));

                            await enqueueLinks({
                                urls: [nextUrl.href],
                                userData: { label: 'LIST', pageNo: nextPageNo },
                            });
                            crawlerLog.info(`Enqueued page ${nextPageNo}`);
                        }
                        return;
                    }

                    if (label === 'DETAIL') {
                        if (saved >= RESULTS_WANTED) {
                            crawlerLog.info('Already reached target. Skipping.');
                            return;
                        }

                        // Extract JSON-LD from script tag
                        let jsonLdData = null;
                        try {
                            const jsonLdScript = await page.$eval('script[type="application/ld+json"]', el => el.textContent);
                            if (jsonLdScript) {
                                const parsed = JSON.parse(jsonLdScript);
                                const arr = Array.isArray(parsed) ? parsed : [parsed];
                                for (const item of arr) {
                                    if (item?.['@type'] === 'JobPosting' ||
                                        (Array.isArray(item?.['@type']) && item['@type'].includes('JobPosting'))) {
                                        jsonLdData = item;
                                        break;
                                    }
                                }
                            }
                        } catch {
                            crawlerLog.debug('No JSON-LD found');
                        }

                        // Extract from HTML as fallback
                        const title = jsonLdData?.title || jsonLdData?.name ||
                            await page.$eval('h1', el => el.textContent?.trim()).catch(() => null) ||
                            await page.title().then(t => t.split('|')[0]?.trim());

                        // Get description from page sections
                        let description = jsonLdData?.description || '';
                        if (!description) {
                            const sections = await page.$$eval('h2', (headings) => {
                                return headings.map(h2 => {
                                    const text = h2.textContent?.toLowerCase() || '';
                                    if (text.includes('about') || text.includes('description') ||
                                        text.includes('applicant') || text.includes('offer')) {
                                        let content = '';
                                        let sibling = h2.nextElementSibling;
                                        while (sibling && sibling.tagName !== 'H2') {
                                            content += sibling.textContent + ' ';
                                            sibling = sibling.nextElementSibling;
                                        }
                                        return content.trim();
                                    }
                                    return '';
                                }).filter(Boolean);
                            });
                            description = sections.join('\n\n');
                        }

                        // Extract location
                        let location = null;
                        if (jsonLdData?.jobLocation) {
                            const loc = Array.isArray(jsonLdData.jobLocation) ? jsonLdData.jobLocation[0] : jsonLdData.jobLocation;
                            if (loc?.address) {
                                location = [loc.address.addressLocality, loc.address.addressRegion]
                                    .filter(Boolean).join(', ');
                            }
                        }
                        if (!location) {
                            location = await page.$eval('div.job-location, .location', el => el.textContent?.trim()).catch(() => null);
                        }

                        // Extract salary
                        let salary = null;
                        if (jsonLdData?.baseSalary) {
                            const bs = jsonLdData.baseSalary;
                            if (typeof bs === 'string') {
                                salary = bs;
                            } else if (bs?.value) {
                                const val = bs.value;
                                if (typeof val === 'object') {
                                    salary = `${val.minValue || ''} - ${val.maxValue || ''} ${bs.currency || ''}`.trim();
                                } else {
                                    salary = `${val} ${bs.currency || ''}`.trim();
                                }
                            }
                        }
                        if (!salary) {
                            salary = await page.$eval('div.job-salary, .salary', el => el.textContent?.trim()).catch(() => null);
                        }

                        const job_type = jsonLdData?.employmentType ||
                            await page.$eval('div.job-contract-type', el => el.textContent?.trim()).catch(() => null);

                        const data = {
                            title: title || null,
                            company: jsonLdData?.hiringOrganization?.name || null,
                            location: location || null,
                            salary: salary || null,
                            job_type: Array.isArray(job_type) ? job_type.join(', ') : job_type || null,
                            date_posted: jsonLdData?.datePosted || null,
                            description_html: description || null,
                            description_text: cleanText(description || ''),
                            url: request.url,
                            scrapedAt: new Date().toISOString(),
                        };

                        if (!data.title) {
                            crawlerLog.warning(`Skipping job with no title: ${request.url}`);
                            return;
                        }

                        await Dataset.pushData(data);
                        saved++;
                        crawlerLog.info(`[DETAIL] Saved job ${saved}/${RESULTS_WANTED}: ${data.title}`);
                    }
                } catch (err) {
                    crawlerLog.error(`Handler error: ${err.message}`);
                }
            },

            failedRequestHandler({ request, log: crawlerLog }, error) {
                crawlerLog.error(`Failed: ${request.url}`, { error: error.message });
            },
        });

        await crawler.run(initial.map(u => ({
            url: u,
            userData: { label: 'LIST', pageNo: 0 },
        })));

        log.info(`Scraping complete. Total jobs saved: ${saved}`);

        if (saved === 0) {
            log.warning('No jobs saved. Check debug-screenshot in key-value store for page state.');
        }
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
