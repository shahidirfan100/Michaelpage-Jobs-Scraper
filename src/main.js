// Michael Page jobs scraper - Optimized Hybrid Approach v3
// Fast Playwright for listings, HTTP for details with proper field extraction
import { Actor, log } from 'apify';
import { PlaywrightCrawler, CheerioCrawler, Dataset } from 'crawlee';
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

        log.info('Starting Michael Page scraper', { keyword, location, RESULTS_WANTED, MAX_PAGES });

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

        const cleanText = (html) => {
            if (!html) return '';
            return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        };

        // Helper: Extract field value from summary detail section by label
        const extractSummaryField = ($, labelText) => {
            // Find dt containing the label and get adjacent dd value
            let value = null;
            $('dt').each((_, dt) => {
                const label = $(dt).text().toLowerCase().trim();
                if (label.includes(labelText.toLowerCase())) {
                    value = $(dt).next('dd').text().trim() ||
                        $(dt).next('dd.field--item').text().trim() ||
                        $(dt).siblings('dd.field--item').first().text().trim();
                }
            });
            // Also try the specific class structure
            if (!value) {
                $('dl').each((_, dl) => {
                    const dt = $(dl).find('dt').text().toLowerCase().trim();
                    if (dt.includes(labelText.toLowerCase())) {
                        value = $(dl).find('dd.field--item, dd.summary-detail-field-value').text().trim();
                    }
                });
            }
            return value || null;
        };

        // ============================================================
        // PHASE 1: Fast Playwright for listing pages only
        // ============================================================
        log.info('Phase 1: Collecting job URLs...');

        const jobUrls = [];

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
                    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-gpu'],
                },
            },

            preNavigationHooks: [
                async ({ page }) => {
                    await page.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    });
                    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf}', route => route.abort());
                },
            ],

            async requestHandler({ request, page, log: crawlerLog }) {
                const pageNo = request.userData?.pageNo || 0;
                crawlerLog.info(`[LIST] Page ${pageNo + 1}`);

                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

                try {
                    const cookieBtn = page.locator('button:has-text("Accept")').first();
                    if (await cookieBtn.isVisible({ timeout: 1500 })) {
                        await cookieBtn.click();
                    }
                } catch { }

                await page.waitForTimeout(1500);

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

                if (jobUrls.length < RESULTS_WANTED && pageNo < MAX_PAGES - 1 && uniqueLinks.length > 0) {
                    const nextUrl = new URL(request.url);
                    nextUrl.searchParams.set('page', String(pageNo + 1));
                    await listingCrawler.addRequests([{ url: nextUrl.href, userData: { pageNo: pageNo + 1 } }]);
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
            await Dataset.pushData(toSave.map(u => ({ url: u, scrapedAt: new Date().toISOString() })));
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

                // ====== Extract JSON-LD (primary source) ======
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

                // ====== Title ======
                const title = jsonLd?.title || jsonLd?.name ||
                    $('h1').first().text().trim() ||
                    $('meta[property="og:title"]').attr('content')?.split('|')[0]?.trim();

                // ====== Description HTML (with tags) ======
                let descriptionHtml = '';
                if (jsonLd?.description) {
                    descriptionHtml = jsonLd.description;
                } else {
                    const sections = [];
                    $('h2').each((_, h2) => {
                        const heading = $(h2).text().toLowerCase();
                        if (heading.includes('about') || heading.includes('description') ||
                            heading.includes('applicant') || heading.includes('offer') ||
                            heading.includes('job summary') || heading.includes('responsibilities')) {
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
                        : $('article, main .content, .job-description, .job-content').first().html() || '';
                }

                // ====== Location ======
                let jobLocation = null;
                if (jsonLd?.jobLocation) {
                    const loc = Array.isArray(jsonLd.jobLocation) ? jsonLd.jobLocation[0] : jsonLd.jobLocation;
                    if (loc?.address) {
                        jobLocation = [loc.address.addressLocality, loc.address.addressRegion, loc.address.addressCountry]
                            .filter(Boolean).join(', ');
                    }
                }
                if (!jobLocation) {
                    jobLocation = extractSummaryField($, 'location') ||
                        $('[itemprop="addressLocality"]').text().trim() ||
                        $('.job-location').text().trim() || null;
                }

                // ====== Salary ======
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

                // ====== Job Type / Contract Type ======
                let jobType = null;
                if (jsonLd?.employmentType) {
                    jobType = Array.isArray(jsonLd.employmentType) ? jsonLd.employmentType.join(', ') : jsonLd.employmentType;
                }
                if (!jobType) {
                    jobType = extractSummaryField($, 'contract') ||
                        extractSummaryField($, 'job type') ||
                        extractSummaryField($, 'employment') ||
                        $('dd.field--item.summary-detail-field-value').filter((_, el) => {
                            const prev = $(el).prev('dt').text().toLowerCase();
                            return prev.includes('contract') || prev.includes('type');
                        }).first().text().trim() ||
                        $('[itemprop="employmentType"]').text().trim() ||
                        $('.job-contract-type').text().trim() || null;
                }

                // ====== Sector ======
                let sector = extractSummaryField($, 'sector') ||
                    $('dd.field--item.summary-detail-field-value').filter((_, el) => {
                        return $(el).prev('dt').text().toLowerCase().includes('sector');
                    }).first().text().trim() || null;

                // ====== Industry ======
                let industry = extractSummaryField($, 'industry') ||
                    $('dd.field--item.summary-detail-field-value').filter((_, el) => {
                        return $(el).prev('dt').text().toLowerCase().includes('industry');
                    }).first().text().trim() ||
                    jsonLd?.industry || null;

                // ====== Job Nature (Permanent/Contract/Temporary) ======
                let jobNature = extractSummaryField($, 'job nature') ||
                    extractSummaryField($, 'nature') ||
                    $('dd.field--item.summary-detail-field-value').filter((_, el) => {
                        return $(el).prev('dt').text().toLowerCase().includes('nature');
                    }).first().text().trim() || null;

                // ====== Company ======
                let company = null;
                if (jsonLd?.hiringOrganization) {
                    company = typeof jsonLd.hiringOrganization === 'string'
                        ? jsonLd.hiringOrganization
                        : jsonLd.hiringOrganization.name;
                }
                if (!company) {
                    company = extractSummaryField($, 'company') ||
                        extractSummaryField($, 'employer') ||
                        $('dd.field--item.summary-detail-field-value').filter((_, el) => {
                            const prev = $(el).prev('dt').text().toLowerCase();
                            return prev.includes('company') || prev.includes('employer');
                        }).first().text().trim() ||
                        $('[itemprop="hiringOrganization"] [itemprop="name"]').text().trim() ||
                        $('.company-name').text().trim() || null;
                }

                // ====== Date Posted ======
                let datePosted = jsonLd?.datePosted || null;
                if (!datePosted) {
                    datePosted = extractSummaryField($, 'posted') ||
                        extractSummaryField($, 'date') ||
                        $('[itemprop="datePosted"]').attr('content') ||
                        $('[itemprop="datePosted"]').text().trim() ||
                        $('time[datetime]').attr('datetime') ||
                        $('.posted-date, .date-posted').text().trim() || null;
                }

                const data = {
                    title: title || null,
                    company: company,
                    location: jobLocation,
                    salary: salary,
                    job_type: jobType,
                    job_nature: jobNature,
                    sector: sector,
                    industry: industry,
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

            async failedRequestHandler({ request }, error) {
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
