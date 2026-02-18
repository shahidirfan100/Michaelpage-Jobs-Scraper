/**
 * Michael Page Jobs Scraper
 *
 * Fast listing pagination + concurrent detail enrichment + batched dataset pushes.
 */
import { Actor, log } from 'apify';
import { Dataset, gotScraping } from 'crawlee';

log.setLevel(log.LEVELS.WARNING);
await Actor.init();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0';
const BASE_URL = 'https://www.michaelpage.com';
const PUSH_BATCH_SIZE = 25;
const DETAIL_CONCURRENCY = 12;

const cleanText = (html) => {
    if (!html) return '';
    return String(html)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const decodeHtmlEntities = (value) => {
    if (!value) return '';
    return String(value)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => {
            const code = Number(n);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/\s+/g, ' ')
        .trim();
};

const buildStartUrl = (keyword, location) => {
    const url = new URL(`${BASE_URL}/jobs`);
    if (keyword) url.searchParams.set('search', String(keyword).trim());
    if (location) url.searchParams.set('location', String(location).trim());
    return url.href;
};

const buildPagedUrl = (baseListingUrl, pageNo) => {
    const url = new URL(baseListingUrl);
    if (pageNo > 0) url.searchParams.set('page', String(pageNo));
    else url.searchParams.delete('page');
    return url.href;
};

const sanitizeJsonWithControlCharsInStrings = (raw) => {
    const input = String(raw);
    let out = '';
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (escapeNext) {
            out += ch;
            escapeNext = false;
            continue;
        }

        if (inString && ch === '\\') {
            out += ch;
            escapeNext = true;
            continue;
        }

        if (ch === '"') {
            out += ch;
            inString = !inString;
            continue;
        }

        if (inString) {
            if (ch === '\n') {
                out += '\\n';
                continue;
            }
            if (ch === '\r') {
                out += '\\r';
                continue;
            }
            if (ch === '\t') {
                out += '\\t';
                continue;
            }
            if (ch === '\f') {
                out += '\\f';
                continue;
            }
            if (ch === '\b') {
                out += '\\b';
                continue;
            }
        }

        out += ch;
    }

    return out;
};

const extractJobsFromListingHtml = (html) => {
    const out = [];
    const content = String(html);

    for (const match of content.matchAll(/<li class="views-row">([\s\S]*?)<\/li>/g)) {
        const row = match[1];

        const aboutPath = row.match(/<div[^>]+about="([^"]+)"[^>]*class="job-tile/iu)?.[1];
        const hrefPath = row.match(/<a[^>]+href="(\/job-detail\/[^"]+)"/iu)?.[1];
        const path = aboutPath || hrefPath;
        if (!path) continue;

        const url = new URL(path, BASE_URL).href;
        const listingJobId = row.match(/<div class="job-title[^"]*" id="(\d+)"/iu)?.[1] || null;
        const titleRaw = row.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/iu)?.[1] || '';
        const locationBlock = row.match(/<div class="job-location">([\s\S]*?)<\/div>/iu)?.[1] || '';
        const contractBlock = row.match(/<div class="job-contract-type">([\s\S]*?)<\/div>/iu)?.[1] || '';
        const salaryBlock = row.match(/<div class="job-salary">([\s\S]*?)<\/div>/iu)?.[1] || '';
        const summaryBlock = row.match(/job_advert__job-summary-text">([\s\S]*?)<\/div>/iu)?.[1] || '';
        const bulletsBlock = row.match(/job_advert__job-desc-bullet-points">([\s\S]*?)<\/div>/iu)?.[1] || '';

        const title = decodeHtmlEntities(cleanText(titleRaw)) || null;
        const location = decodeHtmlEntities(cleanText(locationBlock.replace(/<i[\s\S]*?<\/i>/iu, '')));
        const jobType = decodeHtmlEntities(cleanText(contractBlock.replace(/<i[\s\S]*?<\/i>/iu, '')));
        const salary = decodeHtmlEntities(cleanText(salaryBlock.replace(/<i[\s\S]*?<\/i>/iu, '')));
        const summary = decodeHtmlEntities(cleanText(summaryBlock)) || null;
        const bulletPoints = Array.from(bulletsBlock.matchAll(/<li>([\s\S]*?)<\/li>/giu))
            .map((m) => decodeHtmlEntities(cleanText(m[1])))
            .filter(Boolean);

        out.push({
            listing_job_id: listingJobId,
            title,
            location: location || null,
            salary: salary || null,
            job_type: jobType || null,
            summary,
            bullet_points: bulletPoints.length ? bulletPoints : null,
            url,
        });
    }

    return out;
};

const extractJobPostingJsonLd = (html) => {
    const content = String(html);
    const results = [];

    let idx = 0;
    while (true) {
        const hit = content.indexOf('application/ld+json', idx);
        if (hit === -1) break;

        const scriptStart = content.lastIndexOf('<script', hit);
        if (scriptStart === -1) {
            idx = hit + 1;
            continue;
        }

        const tagEnd = content.indexOf('>', scriptStart);
        if (tagEnd === -1) {
            idx = hit + 1;
            continue;
        }

        const close = content.indexOf('</script>', tagEnd + 1);
        if (close === -1) {
            idx = hit + 1;
            continue;
        }

        const raw = content.slice(tagEnd + 1, close).trim();
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) results.push(...parsed);
                else results.push(parsed);
            } catch {
                try {
                    const sanitized = sanitizeJsonWithControlCharsInStrings(raw);
                    const parsed = JSON.parse(sanitized);
                    if (Array.isArray(parsed)) results.push(...parsed);
                    else results.push(parsed);
                } catch {
                    // ignore invalid JSON-LD blocks
                }
            }
        }

        idx = close + 9;
    }

    return results.find((x) => x && typeof x === 'object' && x['@type'] === 'JobPosting') || null;
};

const normalizeBaseSalary = (baseSalary) => {
    if (!baseSalary) return null;
    if (typeof baseSalary === 'string') return baseSalary;

    const currency = baseSalary.currency || baseSalary?.value?.currency || null;
    const unitText = baseSalary?.value?.unitText || null;
    const { value } = baseSalary;

    if (value && typeof value === 'object') {
        return {
            currency,
            unitText,
            minValue: value.minValue ?? null,
            maxValue: value.maxValue ?? null,
            value: value.value ?? null,
        };
    }

    return {
        currency,
        unitText,
        value,
    };
};

const removeNullValues = (value) => {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        const cleaned = value
            .map((item) => removeNullValues(item))
            .filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const cleanedEntries = Object.entries(value)
            .map(([key, val]) => [key, removeNullValues(val)])
            .filter(([, val]) => val !== undefined);
        return cleanedEntries.length ? Object.fromEntries(cleanedEntries) : undefined;
    }

    return value;
};

const getJobLocationText = (jobPosting) => {
    const loc = Array.isArray(jobPosting?.jobLocation) ? jobPosting.jobLocation[0] : jobPosting?.jobLocation;
    const addr = loc?.address;
    if (!addr) return null;
    return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ') || null;
};

const getIdentifierValue = (identifier) => {
    if (!identifier) return null;
    if (typeof identifier === 'string') return identifier;
    if (typeof identifier === 'object') return identifier.value || identifier['@id'] || null;
    return null;
};

const pushBatch = async (items, savedCount) => {
    if (!items.length) return savedCount;
    await Dataset.pushData(items);
    const nextSavedCount = savedCount + items.length;
    log.warning('Detail data push', { batchSize: items.length, totalSaved: nextSavedCount });
    return nextSavedCount;
};

const fetchListingPage = async ({ pageUrl, proxyConf }) => {
    const proxyUrl = proxyConf ? await proxyConf.newUrl() : undefined;
    const { body } = await gotScraping({
        url: pageUrl,
        method: 'GET',
        headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
        },
        proxyUrl,
        timeout: {
            request: 60000,
        },
        retry: {
            limit: 2,
        },
    });
    return body;
};

const fetchDetailRecord = async ({ detailUrl, listing, proxyConf }) => {
    const proxyUrl = proxyConf ? await proxyConf.newUrl() : undefined;
    const { body } = await gotScraping({
        url: detailUrl,
        method: 'GET',
        headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
            referer: `${BASE_URL}/jobs`,
        },
        proxyUrl,
        timeout: {
            request: 60000,
        },
        retry: {
            limit: 2,
        },
    });

    const jobPosting = extractJobPostingJsonLd(body);
    const descriptionHtml = jobPosting?.description || null;
    const jobLocation = getJobLocationText(jobPosting);
    const jobId = getIdentifierValue(jobPosting?.identifier);
    const employmentType = Array.isArray(jobPosting?.employmentType)
        ? jobPosting.employmentType.join(', ')
        : (jobPosting?.employmentType || null);

    const data = {
        title: listing.title || jobPosting?.title || jobPosting?.name || null,
        company: listing.company || jobPosting?.hiringOrganization?.name || null,
        location: listing.location || jobLocation || null,
        salary: listing.salary || null,
        job_type: listing.job_type || employmentType || null,
        job_nature: listing.job_nature || null,
        sector: listing.sector || null,
        industry: listing.industry || jobPosting?.industry || null,
        date_posted: listing.date_posted || jobPosting?.datePosted || null,
        description_html: descriptionHtml,
        description_text: cleanText(descriptionHtml || ''),
        url: detailUrl,
        scrapedAt: new Date().toISOString(),
        listing_job_id: listing.listing_job_id || null,
        job_id: jobId || null,
        additional_type: jobPosting?.additionalType || null,
        employment_type: jobPosting?.employmentType || null,
        valid_through: jobPosting?.validThrough || null,
        direct_apply: typeof jobPosting?.directApply === 'boolean' ? jobPosting.directApply : null,
        job_location: jobPosting?.jobLocation || null,
        base_salary: normalizeBaseSalary(jobPosting?.baseSalary),
        job_benefits: jobPosting?.jobBenefits || null,
        occupational_category: jobPosting?.occupationalCategory || null,
        qualifications: jobPosting?.qualifications || null,
        responsibilities: jobPosting?.responsibilities || null,
        skills: jobPosting?.skills || null,
        education_requirements: jobPosting?.educationRequirements || null,
        experience_requirements: jobPosting?.experienceRequirements || null,
        work_hours: jobPosting?.workHours || null,
        hiring_organization: jobPosting?.hiringOrganization || null,
        identifier: jobPosting?.identifier || null,
        summary: listing.summary || null,
        bullet_points: listing.bullet_points || null,
    };

    return removeNullValues(data) || null;
};

async function main() {
    const input = (await Actor.getInput()) || {};
    const {
        keyword = '',
        location = '',
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPagesRaw = 10,
        startUrl,
        startUrls,
        url,
        proxyConfiguration,
    } = input;

    const RESULTS_WANTED = Number.isFinite(+resultsWantedRaw)
        ? Math.max(1, +resultsWantedRaw)
        : Number.MAX_SAFE_INTEGER;
    const MAX_PAGES = Number.isFinite(+maxPagesRaw)
        ? Math.max(1, +maxPagesRaw)
        : 999;

    const initial = [];
    if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
    if (startUrl) initial.push(startUrl);
    if (url) initial.push(url);
    if (!initial.length) initial.push(buildStartUrl(keyword, location));
    const listingUrl = initial[0];

    let proxyConf;
    try {
        proxyConf = proxyConfiguration
            ? await Actor.createProxyConfiguration({ ...proxyConfiguration })
            : await Actor.createProxyConfiguration({
                useApifyProxy: true,
                apifyProxyGroups: ['RESIDENTIAL'],
            });
    } catch (err) {
        log.warning(`Proxy configuration failed: ${err.message}`);
        proxyConf = undefined;
    }

    const foundByUrl = new Map();
    const orderedUrls = [];

    for (let pageNo = 0; pageNo < MAX_PAGES && orderedUrls.length < RESULTS_WANTED; pageNo++) {
        const pageUrl = buildPagedUrl(listingUrl, pageNo);
        const listingHtml = await fetchListingPage({ pageUrl, proxyConf });
        const jobs = extractJobsFromListingHtml(listingHtml);
        if (!jobs.length) break;

        let newOnPage = 0;
        for (const job of jobs) {
            if (!job?.url || foundByUrl.has(job.url)) continue;
            foundByUrl.set(job.url, job);
            orderedUrls.push(job.url);
            newOnPage++;
            if (orderedUrls.length >= RESULTS_WANTED) break;
        }

        if (!newOnPage) break;
    }

    if (!orderedUrls.length) return;

    const detailUrls = orderedUrls.slice(0, RESULTS_WANTED);
    let savedCount = 0;
    const pushBuffer = [];

    for (let i = 0; i < detailUrls.length; i += DETAIL_CONCURRENCY) {
        const chunk = detailUrls.slice(i, i + DETAIL_CONCURRENCY);
        const settled = await Promise.allSettled(
            chunk.map(async (detailUrl) => {
                const listing = foundByUrl.get(detailUrl) || {};
                try {
                    return await fetchDetailRecord({ detailUrl, listing, proxyConf });
                } catch {
                    const fallback = removeNullValues({
                        ...listing,
                        url: detailUrl,
                        scrapedAt: new Date().toISOString(),
                    });
                    return fallback || null;
                }
            }),
        );

        for (const result of settled) {
            if (result.status !== 'fulfilled' || !result.value) continue;
            pushBuffer.push(result.value);
            if (pushBuffer.length >= PUSH_BATCH_SIZE) {
                savedCount = await pushBatch(pushBuffer, savedCount);
                pushBuffer.length = 0;
            }
        }

        if (pushBuffer.length) {
            savedCount = await pushBatch(pushBuffer, savedCount);
            pushBuffer.length = 0;
        }
    }
}

try {
    await main();
} catch (err) {
    log.error(`Fatal: ${err?.message || err}`);
} finally {
    await Actor.exit();
}
