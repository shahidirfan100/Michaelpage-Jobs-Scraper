// Michael Page jobs scraper - Production-ready CheerioCrawler implementation
// Uses JSON-LD extraction as primary data source with HTML parsing fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import HeaderGenerator from 'header-generator';

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

        // Convert relative URL to absolute
        const toAbs = (href, base = 'https://www.michaelpage.com') => {
            try {
                return new URL(href, base).href;
            } catch {
                return null;
            }
        };

        // Clean HTML to plain text
        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        // Build search URL with proper parameters
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

        // Setup proxy configuration
        const proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : await Actor.createProxyConfiguration({ useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] });

        // Header generator for stealth
        const headerGenerator = new HeaderGenerator({
            browsers: [{ name: 'chrome', minVersion: 110 }, { name: 'firefox', minVersion: 100 }],
            devices: ['desktop'],
            operatingSystems: ['windows', 'macos'],
        });

        let saved = 0;
        const seenUrls = new Set();

        // Extract JobPosting data from JSON-LD script tags
        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const text = $(scripts[i]).html();
                    if (!text) continue;
                    const parsed = JSON.parse(text);
                    const arr = Array.isArray(parsed) ? parsed : [parsed];

                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                            // Extract salary robustly
                            let salary = null;
                            if (e.baseSalary) {
                                if (typeof e.baseSalary === 'string') {
                                    salary = e.baseSalary;
                                } else if (e.baseSalary.value) {
                                    const val = e.baseSalary.value;
                                    if (typeof val === 'object') {
                                        salary = `${val.minValue || ''} - ${val.maxValue || ''} ${e.baseSalary.currency || ''}`.trim();
                                    } else {
                                        salary = `${val} ${e.baseSalary.currency || ''}`.trim();
                                    }
                                }
                            }

                            // Extract location robustly
                            let jobLocation = null;
                            if (e.jobLocation) {
                                const loc = Array.isArray(e.jobLocation) ? e.jobLocation[0] : e.jobLocation;
                                if (loc?.address) {
                                    const addr = loc.address;
                                    jobLocation = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                                        .filter(Boolean).join(', ');
                                } else if (typeof loc === 'string') {
                                    jobLocation = loc;
                                }
                            }

                            return {
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                description_html: e.description || null,
                                location: jobLocation,
                                salary: salary,
                                job_type: Array.isArray(e.employmentType) ? e.employmentType.join(', ') : e.employmentType || null,
                            };
                        }
                    }
                } catch (err) {
                    log.debug(`JSON-LD parse error: ${err.message}`);
                }
            }
            return null;
        }

        // Find all job detail links on a listing page - FIXED SELECTOR
        function findJobLinks($, base) {
            const links = new Set();

            // Primary selector: any link containing /job-detail/
            $('a[href*="/job-detail/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (href && !href.includes('javascript:')) {
                    const abs = toAbs(href, base);
                    if (abs && !seenUrls.has(abs)) {
                        links.add(abs);
                        seenUrls.add(abs);
                    }
                }
            });

            return [...links];
        }

        // Extract job data from HTML as fallback
        function extractFromHtml($, url) {
            const data = {};

            // Title - try multiple selectors
            data.title = $('h1').first().text().trim() ||
                $('meta[property="og:title"]').attr('content') ||
                $('title').text().split('|')[0]?.trim() || null;

            // Company - Michael Page typically doesn't show company names
            data.company = $('meta[itemprop="hiringOrganization"]').attr('content') ||
                $('.company-name').text().trim() || null;

            // Description - collect all relevant sections
            const descParts = [];
            $('h2').each((_, h2) => {
                const heading = $(h2).text().trim().toLowerCase();
                if (heading.includes('about') || heading.includes('job description') ||
                    heading.includes('successful applicant') || heading.includes('offer')) {
                    const section = $(h2).nextUntil('h2').text().trim();
                    if (section) descParts.push(section);
                }
            });

            // Fallback: look for common job description containers
            if (!descParts.length) {
                const descSelectors = [
                    'div.job_advert__job-summary-text',
                    'div.job-summary',
                    'div.job_advert__job-desc-bullet-points',
                    'article.job-content',
                    '.job-description',
                    '[itemprop="description"]',
                ];
                for (const sel of descSelectors) {
                    const content = $(sel).html();
                    if (content) {
                        descParts.push(cleanText(content));
                    }
                }
            }
            data.description_html = descParts.join('\n\n') || null;
            data.description_text = data.description_html ? cleanText(data.description_html) : null;

            // Location - try multiple sources
            data.location = $('meta[itemprop="addressLocality"]').attr('content') ||
                $('div.job-location').text().trim() ||
                $('.location').text().trim() ||
                $('a[href*="/jobs/"][href*="-"]').filter((_, el) => {
                    const text = $(el).text().trim().toLowerCase();
                    return text.includes('york') || text.includes('london') || text.includes('city');
                }).first().text().trim() || null;

            // Salary
            data.salary = $('meta[itemprop="baseSalary"]').attr('content') ||
                $('div.job-salary').text().trim() ||
                $('.salary').text().trim() || null;

            // Job type
            data.job_type = $('meta[itemprop="employmentType"]').attr('content') ||
                $('div.job-contract-type').text().trim() ||
                $('a[href*="contract=permanent"]').length ? 'Permanent' :
                $('a[href*="contract=contract"]').length ? 'Contract' : null;

            // Date posted
            data.date_posted = $('meta[itemprop="datePosted"]').attr('content') ||
                $('time').attr('datetime') || null;

            return data;
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 5,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: {
                    maxUsageCount: 50,
                },
            },
            maxConcurrency: 3,
            minConcurrency: 1,
            requestHandlerTimeoutSecs: 60,
            navigationTimeoutSecs: 45,

            preNavigationHooks: [
                ({ request }) => {
                    const headers = headerGenerator.getHeaders();
                    request.headers = {
                        ...request.headers,
                        ...headers,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache',
                    };
                },
            ],

            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 0;

                try {
                    if (label === 'LIST') {
                        const links = findJobLinks($, request.url);
                        crawlerLog.info(`[LIST] Page ${pageNo}: ${request.url} → found ${links.length} new job links`);

                        if (links.length === 0 && pageNo === 0) {
                            crawlerLog.warning('No job links found on first page. Check if site structure changed.');
                        }

                        if (collectDetails) {
                            const remaining = RESULTS_WANTED - saved;
                            const toEnqueue = links.slice(0, Math.max(0, remaining));
                            if (toEnqueue.length) {
                                await enqueueLinks({
                                    urls: toEnqueue,
                                    userData: { label: 'DETAIL' },
                                });
                            }
                        } else {
                            // If not collecting details, save basic info from listing
                            const remaining = RESULTS_WANTED - saved;
                            const toPush = links.slice(0, Math.max(0, remaining));
                            if (toPush.length) {
                                await Dataset.pushData(toPush.map(u => ({
                                    url: u,
                                    scrapedAt: new Date().toISOString(),
                                })));
                                saved += toPush.length;
                            }
                        }

                        // Handle pagination
                        if (saved < RESULTS_WANTED && pageNo < MAX_PAGES && links.length > 0) {
                            const nextPageNo = pageNo + 1;
                            const nextUrl = new URL(request.url);
                            nextUrl.searchParams.set('page', String(nextPageNo));

                            await enqueueLinks({
                                urls: [nextUrl.href],
                                userData: { label: 'LIST', pageNo: nextPageNo },
                            });
                            crawlerLog.info(`Enqueued next page: ${nextUrl.href}`);
                        }
                        return;
                    }

                    if (label === 'DETAIL') {
                        if (saved >= RESULTS_WANTED) {
                            crawlerLog.info(`Already reached ${RESULTS_WANTED} results. Skipping.`);
                            return;
                        }

                        // Try JSON-LD first (primary source)
                        const jsonData = extractFromJsonLd($);

                        // Fall back to HTML parsing
                        const htmlData = extractFromHtml($, request.url);

                        // Merge data, preferring JSON-LD
                        const data = {
                            title: jsonData?.title || htmlData.title || null,
                            company: jsonData?.company || htmlData.company || null,
                            location: jsonData?.location || htmlData.location || null,
                            salary: jsonData?.salary || htmlData.salary || null,
                            job_type: jsonData?.job_type || htmlData.job_type || null,
                            date_posted: jsonData?.date_posted || htmlData.date_posted || null,
                            description_html: jsonData?.description_html || htmlData.description_html || null,
                            description_text: cleanText(jsonData?.description_html || htmlData.description_html || ''),
                            url: request.url,
                            scrapedAt: new Date().toISOString(),
                        };

                        // Validate required fields
                        if (!data.title && !data.url) {
                            crawlerLog.warning(`Skipping job with no title: ${request.url}`);
                            return;
                        }

                        await Dataset.pushData(data);
                        saved++;
                        crawlerLog.info(`[DETAIL] Saved job ${saved}/${RESULTS_WANTED}: ${data.title || request.url}`);
                    }
                } catch (err) {
                    crawlerLog.error(`Request handler error for ${request.url}: ${err.message}`);
                }
            },

            failedRequestHandler({ request, log: crawlerLog }, error) {
                crawlerLog.error(`Request failed after retries: ${request.url}`, { error: error.message });
            },
        });

        await crawler.run(initial.map(u => ({
            url: u,
            userData: { label: 'LIST', pageNo: 0 },
        })));

        log.info(`Scraping complete. Total jobs saved: ${saved}`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
