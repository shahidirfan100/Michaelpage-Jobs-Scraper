// Michael Page jobs scraper - Optimized Hybrid Approach
// Playwright for listing pages (to handle JS/cookies), HTTP for detail pages (fast)
import { Actor, log } from 'apify';
import { PlaywrightCrawler, CheerioCrawler, Dataset, RequestQueue } from 'crawlee';
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

        log.info('Starting optimized Michael Page scraper', { keyword, location, RESULTS_WANTED, MAX_PAGES, collectDetails });

        const buildStartUrl = (kw, loc) => {
            const u = new URL('https://www.michaelpage.com/jobs');
            if (kw) u.searchParams.set('search', String(kw).trim());
            if (loc) u.searchParams.set('location', String(loc).trim());
            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location));

        log.info('URLs to crawl', { urls: initial });

        // Setup proxy
        let proxyConf;
        try {
            proxyConf = proxyConfiguration
                ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
                : await Actor.createProxyConfiguration({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });
        } catch (err) {
            log.warning(`Proxy error: ${err.message}`);
            proxyConf = undefined;
        }

        let saved = 0;
        const seenUrls = new Set();
        const detailQueue = await RequestQueue.open('detail-queue');

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

        // ============================================================
        // PHASE 1: Use Playwright ONLY for listing pages (handles JS)
        // ============================================================
        log.info('Phase 1: Collecting job URLs with Playwright...');

        const jobUrls = [];
        let currentPage = 0;

        const listingCrawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 2,
            useSessionPool: true,
            persistCookiesPerSession: true,
            maxConcurrency: 1,
            requestHandlerTimeoutSecs: 120,
            navigationTimeoutSecs: 60,

            browserPoolOptions: {
                useFingerprints: true,
            },

            launchContext: {
                launchOptions: {
                    headless: true,
                    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
                },
            },

            preNavigationHooks: [
                async ({ page }) => {
                    await page.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    });
                    await page.setExtraHTTPHeaders({
                        'Accept-Language': 'en-US,en;q=0.9',
                    });
                },
            ],

            async requestHandler({ request, page, log: crawlerLog }) {
                const pageNo = request.userData?.pageNo || 0;
                crawlerLog.info(`[LIST] Page ${pageNo + 1}: ${request.url}`);

                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

                // Handle cookie consent ONCE
                try {
                    const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("OK")').first();
                    if (await cookieBtn.isVisible({ timeout: 3000 })) {
                        await cookieBtn.click();
                        crawlerLog.info('Accepted cookies');
                    }
                } catch { }

                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
                await page.waitForTimeout(2000);

                // Extract all job links
                const links = await page.$$eval('a[href*="/job-detail/"]', (anchors) => {
                    return anchors
                        .map(a => a.href)
                        .filter(href => href && !href.includes('javascript:'));
                });

                const uniqueLinks = links.filter(link => {
                    if (seenUrls.has(link)) return false;
                    seenUrls.add(link);
                    return true;
                });

                jobUrls.push(...uniqueLinks);
                crawlerLog.info(`Found ${uniqueLinks.length} new links (total: ${jobUrls.length})`);

                // Pagination: enqueue next page if needed
                if (jobUrls.length < RESULTS_WANTED && pageNo < MAX_PAGES - 1 && uniqueLinks.length > 0) {
                    const nextPageNo = pageNo + 1;
                    const nextUrl = new URL(request.url);
                    nextUrl.searchParams.set('page', String(nextPageNo));

                    await listingCrawler.addRequests([{
                        url: nextUrl.href,
                        userData: { pageNo: nextPageNo },
                    }]);
                }
            },
        });

        await listingCrawler.run(initial.map(u => ({ url: u, userData: { pageNo: 0 } })));
        log.info(`Phase 1 complete. Collected ${jobUrls.length} job URLs`);

        if (jobUrls.length === 0) {
            log.warning('No job URLs found. Check if site structure changed.');
            await Actor.exit();
            return;
        }

        // ============================================================
        // PHASE 2: Use fast HTTP/Cheerio for detail pages
        // ============================================================
        if (!collectDetails) {
            // Just save URLs
            const toSave = jobUrls.slice(0, RESULTS_WANTED);
            await Dataset.pushData(toSave.map(u => ({ url: u, scrapedAt: new Date().toISOString() })));
            log.info(`Saved ${toSave.length} job URLs (no details mode)`);
            await Actor.exit();
            return;
        }

        log.info('Phase 2: Fetching job details with fast HTTP...');

        // Queue only needed URLs
        const urlsToFetch = jobUrls.slice(0, RESULTS_WANTED);
        for (const jobUrl of urlsToFetch) {
            await detailQueue.addRequest({ url: jobUrl });
        }

        const detailCrawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            requestQueue: detailQueue,
            maxRequestRetries: 3,
            maxConcurrency: 10, // Fast parallel fetching
            requestHandlerTimeoutSecs: 30,

            async requestHandler({ request, $, log: crawlerLog }) {
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

                // Title
                const title = jsonLd?.title || jsonLd?.name ||
                    $('h1').first().text().trim() ||
                    $('title').text().split('|')[0]?.trim();

                // Description
                let description = jsonLd?.description || '';
                if (!description) {
                    const parts = [];
                    $('h2').each((_, h2) => {
                        const heading = $(h2).text().toLowerCase();
                        if (heading.includes('about') || heading.includes('description') ||
                            heading.includes('applicant') || heading.includes('offer')) {
                            let text = '';
                            $(h2).nextUntil('h2').each((_, sib) => {
                                text += $(sib).text() + ' ';
                            });
                            if (text.trim()) parts.push(text.trim());
                        }
                    });
                    description = parts.join('\n\n') || $('article, main, .content').text().trim().substring(0, 3000);
                }

                // Location
                let jobLocation = null;
                if (jsonLd?.jobLocation) {
                    const loc = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation[0] : jsonLd.jobLocation;
                    if (loc?.address) {
                        jobLocation = [loc.address.addressLocality, loc.address.addressRegion].filter(Boolean).join(', ');
                    }
                }
                if (!jobLocation) {
                    jobLocation = $('.job-location, .location, [itemprop="addressLocality"]').first().text().trim() || null;
                }

                // Salary
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
                    job_type: Array.isArray(jsonLd?.employmentType) ? jsonLd.employmentType.join(', ') : jsonLd?.employmentType || null,
                    date_posted: jsonLd?.datePosted || null,
                    description_html: description,
                    description_text: cleanText(description),
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
                    crawlerLog.info(`Progress: ${saved}/${RESULTS_WANTED} jobs saved`);
                }
            },

            async failedRequestHandler({ request }, error) {
                log.debug(`Failed: ${request.url} - ${error.message}`);
            },
        });

        await detailCrawler.run();
        log.info(`Phase 2 complete. Total jobs saved: ${saved}`);

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
