// Michael Page jobs scraper - CheerioCrawler implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import HeaderGenerator from 'header-generator';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '', location = '', category = '', results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 999, collectDetails = true, startUrl, startUrls, url, proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;

        const toAbs = (href, base = 'https://www.michaelpage.com') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const buildStartUrl = (kw, loc, cat) => {
            const u = new URL('https://www.michaelpage.com/jobs');
            if (kw) u.searchParams.set('search', String(kw).trim());
            if (loc) u.searchParams.set('location', String(loc).trim());
            u.searchParams.set('sort_by', 'relevance');
            u.searchParams.set('field_job_salary_min', '-1');
            u.searchParams.set('field_job_salary_max', '-1');
            u.searchParams.set('Search', 'Search');
            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location, category));

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        const headerGenerator = new HeaderGenerator({
            browsers: [{ name: 'chrome', minVersion: 100 }],
            devices: ['desktop'],
            operatingSystems: ['windows', 'macos', 'linux'],
        });

        let saved = 0;
        const seenUrls = new Set();

        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                            return {
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                description_html: e.description || null,
                                location: (e.jobLocation && e.jobLocation.address && (e.jobLocation.address.addressLocality || e.jobLocation.address.addressRegion)) || null,
                                salary: e.baseSalary?.value || null,
                                job_type: e.employmentType || null,
                            };
                        }
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            return null;
        }

        function findJobLinks($, base) {
            const links = new Set();
            $('li.views-row a[href*="/job-detail/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (href) {
                    const abs = toAbs(href, base);
                    if (abs && !seenUrls.has(abs)) {
                        links.add(abs);
                        seenUrls.add(abs);
                    }
                }
            });
            return [...links];
        }

        function findNextPage($, base, currentPageNo) {
            // For Michael Page, pagination is via ?page=1, ?page=2, etc.
            // If currentPageNo < MAX_PAGES, return next URL
            // But to check if more, perhaps always assume until no jobs
            // For now, since we have MAX_PAGES, we can enqueue next always, but limit by MAX_PAGES
            return null; // Will handle in the handler
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 2, // Lower for stealth
            useHttp2: false,
            requestHandlerTimeoutSecs: 60,
            preNavigationHooks: [
                ({ request }) => {
                    const headers = headerGenerator.getHeaders();
                    request.headers = { ...request.headers, ...headers };
                },
            ],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                try {
                    const label = request.userData?.label || 'LIST';
                    const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    const links = findJobLinks($, request.url);
                    crawlerLog.info(`LIST ${request.url} -> found ${links.length} new links`);

                    if (collectDetails) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                    } else {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = links.slice(0, Math.max(0, remaining));
                        if (toPush.length) { await Dataset.pushData(toPush.map(u => ({ url: u, _source: 'michaelpage.com' }))); saved += toPush.length; }
                    }

                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES && links.length > 0) {
                        const nextPageNo = pageNo + 1;
                        const nextUrl = new URL(request.url);
                        nextUrl.searchParams.set('page', nextPageNo);
                        await enqueueLinks({ urls: [nextUrl.href], userData: { label: 'LIST', pageNo: nextPageNo } });
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;
                    try {
                        const json = extractFromJsonLd($);
                        const data = json || {};
                        if (!data.title) data.title = $('h1').first().text().trim() || null;
                        if (!data.company) data.company = null; // Michael Page doesn't list company name
                        if (!data.description_html) {
                            const descSections = $('div.job-summary, div.job_advert__job-desc-bullet-points, div.job_advert__job-summary-text');
                            data.description_html = descSections.map((_, el) => $(el).html()).get().join('') || null;
                        }
                        data.description_text = data.description_html ? cleanText(data.description_html) : null;
                        if (!data.location) {
                            data.location = $('div.job-location').text().trim() || null;
                        }
                        if (!data.salary) {
                            data.salary = $('div.job-salary').text().trim() || null;
                        }
                        if (!data.job_type) {
                            data.job_type = $('div.job-contract-type').text().trim() || null;
                        }

                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            category: category || null,
                            location: data.location || null,
                            salary: data.salary || null,
                            job_type: data.job_type || null,
                            date_posted: data.date_posted || null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            url: request.url,
                        };

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`DETAIL ${request.url} -> saved item ${saved}`);
                    } catch (err) { crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`); }
                }
                } catch (err) {
                    crawlerLog.error(`Request ${request.url} failed: ${err.message}`);
                }
            }
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`Finished. Saved ${saved} items`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
