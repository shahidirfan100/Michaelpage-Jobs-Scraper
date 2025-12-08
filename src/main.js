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

        log.info('Starting crawl', { urls: initial });

        let proxyConf;
        try {
            proxyConf = proxyConfiguration
                ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
                : await Actor.createProxyConfiguration({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });
            log.info('Proxy configured');
        } catch (err) {
            log.warning(`Proxy error: ${err.message}`);
            proxyConf = undefined;
        }

        let saved = 0;
        const seenUrls = new Set();
        const capturedJobs = [];

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

        // Extract jobs from any JSON structure
        const extractJobsFromJson = (obj, depth = 0) => {
            if (!obj || depth > 10) return;

            if (Array.isArray(obj)) {
                obj.forEach(item => extractJobsFromJson(item, depth + 1));
                return;
            }

            if (typeof obj === 'object') {
                if (obj.title && typeof obj.title === 'string') {
                    const jobUrl = obj.url || obj.link || obj.href ||
                        (obj.slug ? `https://www.michaelpage.com/job-detail/${obj.slug}` : null) ||
                        (obj.id ? `https://www.michaelpage.com/job-detail/${obj.id}` : null);

                    if (jobUrl && !capturedJobs.find(j => j.url === jobUrl)) {
                        capturedJobs.push({
                            title: obj.title || obj.name,
                            company: obj.company?.name || obj.hiringOrganization?.name || null,
                            location: obj.location?.name || (typeof obj.location === 'string' ? obj.location : null) || null,
                            salary: obj.salary || obj.compensation || null,
                            job_type: obj.employmentType || obj.type || null,
                            date_posted: obj.datePosted || obj.createdAt || null,
                            description_text: obj.description || obj.summary || null,
                            url: jobUrl,
                        });
                    }
                }
                Object.values(obj).forEach(val => extractJobsFromJson(val, depth + 1));
            }
        };

        const crawler = new PlaywrightCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            persistCookiesPerSession: true,
            sessionPoolOptions: { maxPoolSize: 5 },
            maxConcurrency: 1,
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
                    ],
                },
            },

            preNavigationHooks: [
                async ({ page, request }) => {
                    // Remove webdriver flag
                    await page.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    });

                    // Set headers
                    await page.setExtraHTTPHeaders({
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                    });

                    // Intercept API responses
                    page.on('response', async (response) => {
                        const respUrl = response.url();
                        if (respUrl.includes('graphql') || respUrl.includes('/api/')) {
                            try {
                                const ct = response.headers()['content-type'] || '';
                                if (ct.includes('application/json') && response.status() === 200) {
                                    const json = await response.json().catch(() => null);
                                    if (json) {
                                        log.debug(`Captured API response: ${respUrl}`);
                                        extractJobsFromJson(json);
                                    }
                                }
                            } catch (e) {
                                // Ignore
                            }
                        }
                    });

                    log.debug(`Navigating: ${request.url}`);
                },
            ],

            async requestHandler({ request, page, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 0;

                crawlerLog.info(`[${label}] Loading: ${request.url}`);

                try {
                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                    crawlerLog.info('DOM loaded');

                    // Handle cookie consent
                    const cookieSelectors = [
                        'button:has-text("Accept")',
                        'button:has-text("Accept All")',
                        'button:has-text("OK")',
                        '[id*="cookie"] button',
                        '[class*="cookie"] button',
                    ];

                    for (const sel of cookieSelectors) {
                        try {
                            const btn = page.locator(sel).first();
                            if (await btn.isVisible({ timeout: 2000 })) {
                                await btn.click();
                                crawlerLog.info('Clicked cookie consent');
                                break;
                            }
                        } catch {
                            // Continue
                        }
                    }

                    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
                    await page.waitForTimeout(3000);

                    const content = await page.content();
                    const $ = cheerioLoad(content);

                    if (label === 'LIST') {
                        // Check API captured jobs
                        if (capturedJobs.length > 0) {
                            crawlerLog.info(`Got ${capturedJobs.length} jobs from API`);

                            for (const job of capturedJobs) {
                                if (saved >= RESULTS_WANTED) break;
                                if (seenUrls.has(job.url)) continue;
                                seenUrls.add(job.url);

                                await Dataset.pushData({ ...job, scrapedAt: new Date().toISOString() });
                                saved++;
                            }
                            capturedJobs.length = 0;
                        }

                        // Find job links in HTML
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

                        crawlerLog.info(`Found ${jobLinks.length} job links in HTML`);

                        if (jobLinks.length === 0 && pageNo === 0) {
                            const title = await page.title();
                            crawlerLog.warning(`No jobs found. Page: ${title}`);

                            // Debug screenshot
                            const screenshot = await page.screenshot({ type: 'png' });
                            await Actor.setValue('debug-screenshot', screenshot, { contentType: 'image/png' });
                            crawlerLog.info('Saved debug screenshot');
                        }

                        if (collectDetails && jobLinks.length > 0) {
                            const remaining = RESULTS_WANTED - saved;
                            const toEnqueue = jobLinks.slice(0, Math.min(remaining, 50));

                            for (const jobUrl of toEnqueue) {
                                await crawler.addRequests([{ url: jobUrl, userData: { label: 'DETAIL' } }]);
                            }
                            crawlerLog.info(`Enqueued ${toEnqueue.length} detail pages`);
                        } else if (!collectDetails && jobLinks.length > 0) {
                            const remaining = RESULTS_WANTED - saved;
                            const toPush = jobLinks.slice(0, remaining);
                            await Dataset.pushData(toPush.map(u => ({ url: u, scrapedAt: new Date().toISOString() })));
                            saved += toPush.length;
                        }

                        // Pagination
                        if (saved < RESULTS_WANTED && pageNo < MAX_PAGES - 1 && jobLinks.length > 0) {
                            const nextPageNo = pageNo + 1;
                            const nextUrl = new URL(request.url);
                            nextUrl.searchParams.set('page', String(nextPageNo));

                            await crawler.addRequests([{ url: nextUrl.href, userData: { label: 'LIST', pageNo: nextPageNo } }]);
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

                        const title = jsonLd?.title || jsonLd?.name ||
                            $('h1').first().text().trim() ||
                            $('title').text().split('|')[0]?.trim();

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
                            description = parts.join('\n\n') || $('article, main').text().trim().substring(0, 2000);
                        }

                        let jobLocation = null;
                        if (jsonLd?.jobLocation) {
                            const loc = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation[0] : jsonLd.jobLocation;
                            if (loc?.address) {
                                jobLocation = [loc.address.addressLocality, loc.address.addressRegion].filter(Boolean).join(', ');
                            }
                        }
                        if (!jobLocation) {
                            jobLocation = $('.job-location, .location').first().text().trim() || null;
                        }

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
                            crawlerLog.warning(`No title: ${request.url}`);
                            return;
                        }

                        await Dataset.pushData(data);
                        saved++;
                        crawlerLog.info(`Saved ${saved}/${RESULTS_WANTED}: ${data.title}`);
                    }

                } catch (err) {
                    crawlerLog.error(`Error: ${err.message}`);
                }
            },

            async failedRequestHandler({ request }, error) {
                log.error(`Failed: ${request.url}`, { error: error.message });
            },
        });

        log.info('Starting crawler...');
        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 0 } })));

        log.info(`Done. Saved ${saved} jobs.`);

        if (saved === 0) {
            log.warning('No jobs saved. Check debug-screenshot in key-value store.');
        }
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
