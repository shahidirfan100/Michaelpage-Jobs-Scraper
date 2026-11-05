import { Actor, log } from 'apify';
import { Impit } from 'impit';

const DOMAINS = [
    'www.michaelpage.com',
    'www.michaelpage.co.uk',
    'www.michaelpage.fr',
    'www.michaelpage.de',
    'www.michaelpage.es',
    'www.michaelpage.it',
    'www.michaelpage.nl',
    'www.michaelpage.ch',
    'www.michaelpage.be',
    'www.michaelpage.at',
    'www.michaelpage.ie',
    'www.michaelpage.pt',
    'www.michaelpage.ae',
    'www.michaelpage.com.au',
    'www.michaelpage.ca',
    'www.michaelpage.com.sg',
    'www.michaelpage.com.hk',
    'www.michaelpage.com.cn',
    'www.michaelpage.co.jp',
    'www.michaelpage.com.mx',
    'www.michaelpage.com.br',
];

const MARKET_COUNTRIES = {
    'www.michaelpage.com': 'US',
    'www.michaelpage.co.uk': 'GB',
    'www.michaelpage.fr': 'FR',
    'www.michaelpage.de': 'DE',
    'www.michaelpage.es': 'ES',
    'www.michaelpage.it': 'IT',
    'www.michaelpage.nl': 'NL',
    'www.michaelpage.ch': 'CH',
    'www.michaelpage.be': 'BE',
    'www.michaelpage.at': 'AT',
    'www.michaelpage.ie': 'IE',
    'www.michaelpage.pt': 'PT',
    'www.michaelpage.ae': 'AE',
    'www.michaelpage.com.au': 'AU',
    'www.michaelpage.ca': 'CA',
    'www.michaelpage.com.sg': 'SG',
    'www.michaelpage.com.hk': 'HK',
    'www.michaelpage.com.cn': 'CN',
    'www.michaelpage.co.jp': 'JP',
    'www.michaelpage.com.mx': 'MX',
    'www.michaelpage.com.br': 'BR',
};

const DEFAULT_DOMAIN = 'www.michaelpage.com';
const PROFILE_POOL = ['chrome151', 'chrome142', 'firefox144', 'ios18', 'okhttp5'];
const MAX_ATTEMPTS = 5;
const MAX_REDIRECTS = 5;
const MAX_PAGES_HARD_LIMIT = 200;
const REQUEST_TIMEOUT_MS = 45000;
const BASE_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;
const RECOVERY_COOLDOWN_MS = 30000;
const PACE_MIN_DIRECT_MS = 900;
const PACE_MAX_DIRECT_MS = 6000;
const PACE_MIN_PROXY_MS = 500;
const PACE_MAX_PROXY_MS = 4000;
const PROXY_POOL_MAX = 8;
const DEFAULT_DETAIL_CONCURRENCY = 6;
const MAX_DETAIL_CONCURRENCY = 20;
const SECOND_PASS_CONCURRENCY = 2;
const PUSH_BATCH_SIZE = 10;

const EMPTY_DETAIL = {
    title: null,
    location: null,
    salary: null,
    contractType: null,
    companyType: null,
    jobNature: null,
    descriptionHtml: null,
    applyUrl: null,
    consultant: null,
    jobReference: null,
    sector: null,
    subSector: null,
    industry: null,
};

const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const briefError = (error) => String(error?.message || error || 'unknown error')
    .replace(/\s+/g, ' ')
    .slice(0, 160);

const normalizePositiveInt = (value, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 1) return fallback;
    return Math.floor(number);
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const decodeEntities = (value) => {
    if (!value) return '';
    return String(value)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#0?39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&ndash;/g, '-')
        .replace(/&mdash;/g, '-')
        .replace(/&euro;/g, 'EUR')
        .replace(/&pound;/g, 'GBP')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            const code = Number.parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _;
        })
        .replace(/&#(\d+);/g, (_, digits) => {
            const code = Number(digits);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _;
        });
};

const stripTags = (html) => {
    if (!html) return '';
    const separated = String(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|li|div|dd|dt|h[1-6]|tr|span)>/gi, ' ')
        .replace(/<[^>]*>/g, ' ');
    return decodeEntities(separated).replace(/\s+/g, ' ').trim();
};

const readBlock = (html, className) => {
    if (!html) return '';
    const pattern = new RegExp(
        `<([a-z0-9]+)\\b[^>]*class=["'][^"']*(?<![\\w-])${escapeRegExp(className)}(?![\\w-])[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
        'i',
    );
    return html.match(pattern)?.[2] || '';
};

const firstText = (...values) => {
    for (const value of values) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text) return text;
    }
    return null;
};

const getHeader = (headers, name) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    if (Array.isArray(headers)) {
        const found = headers.find(([key]) => String(key).toLowerCase() === name.toLowerCase());
        return found ? found[1] : null;
    }
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
};

const parseRetryAfter = (headers) => {
    const value = getHeader(headers, 'retry-after');
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
    return null;
};

const isChallenge = (status, body) => {
    if (status === 429) return true;
    const sample = String(body).slice(0, 12000);
    return /just a moment\.\.\.|cf-chl|enable javascript and cookies|attention required|checking your browser|cf-mitigated/i.test(sample);
};

const isClosedOffice = (body) => /CLOUDFLARE_ERROR_1000S_BOX|our office .{0,120} is now closed/i.test(String(body));

const isRetryableStatus = (status) => status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;

const isTransientError = (error) => {
    if (!error?.isHttpError) return true;
    if (error.noResults || error.closed) return false;
    const { status } = error;
    return !status || status >= 500 || status === 403 || status === 408 || status === 425 || status === 429;
};

const visibleText = (html) => stripTags(
    String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' '),
);

const isNoResultsHtml = (html) => {
    const text = visibleText(html);
    return /search returned no results|aucun r[eé]sultat|keine ergebnisse|nessun risultato|no hay resultados|geen resultaten|sem resultados|没有找到|検索結果がありません/i.test(text);
};

const looksLikeDetail = (html) => /JobPosting|job-apply-job-title|job_advert__job-desc-role/i.test(String(html));

const jobKeyFromUrl = (url) => {
    const reference = String(url).match(/\/ref\/([^/?#]+)/i)?.[1];
    if (reference) return reference.toLowerCase();
    try {
        return new URL(url).pathname.toLowerCase().replace(/\/+$/, '');
    } catch {
        return null;
    }
};

const getJobReferenceFromUrl = (url) => String(url).match(/\/ref\/([^/?#]+)/i)?.[1] || null;

const formatJobLocation = (jobLocation) => {
    if (!jobLocation) return null;
    const first = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
    const address = first?.address || first;
    if (!address || typeof address !== 'object') return null;
    return firstText(
        [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', '),
        address.name,
        address.addressLocality,
    );
};

const getIdentifierValue = (identifier) => {
    if (!identifier) return null;
    if (typeof identifier === 'string') return identifier;
    if (typeof identifier === 'object') return identifier.value || identifier['@id'] || null;
    return null;
};

const normalizeBaseSalary = (baseSalary) => {
    if (!baseSalary) return null;
    if (typeof baseSalary === 'string') return baseSalary.trim() || null;

    const { value } = baseSalary;
    const currency = baseSalary.currency || value?.currency || null;
    const unitText = value?.unitText || null;

    if (value && typeof value === 'object') {
        const normalized = {
            currency: currency || null,
            unitText: unitText || null,
            minValue: value.minValue === '' ? null : (value.minValue ?? null),
            maxValue: value.maxValue === '' ? null : (value.maxValue ?? null),
            value: value.value === '' ? null : (value.value ?? null),
        };
        const hasValue = [normalized.currency, normalized.minValue, normalized.maxValue, normalized.value]
            .some((entry) => entry !== null && entry !== undefined && entry !== '');
        return hasValue ? normalized : null;
    }

    return value === '' || value === undefined ? null : { currency, unitText, value };
};

const removeNullValues = (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;

    if (Array.isArray(value)) {
        const cleaned = value
            .map((item) => removeNullValues(item))
            .filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const cleanedEntries = Object.entries(value)
            .map(([key, entry]) => [key, removeNullValues(entry)])
            .filter(([, entry]) => entry !== undefined);
        return cleanedEntries.length ? Object.fromEntries(cleanedEntries) : undefined;
    }

    return value;
};

const sanitizeJsonString = (raw) => {
    const input = String(raw);
    let out = '';
    let inString = false;
    let escapeNext = false;

    for (const character of input) {
        if (escapeNext) {
            out += character;
            escapeNext = false;
            continue;
        }
        if (inString && character === '\\') {
            out += character;
            escapeNext = true;
            continue;
        }
        if (character === '"') {
            out += character;
            inString = !inString;
            continue;
        }
        if (inString) {
            const code = character.codePointAt(0);
            if (character === '\n') {
                out += '\\n';
                continue;
            }
            if (character === '\r') {
                out += '\\r';
                continue;
            }
            if (character === '\t') {
                out += '\\t';
                continue;
            }
            if (character === '\f') {
                out += '\\f';
                continue;
            }
            if (character === '\b') {
                out += '\\b';
                continue;
            }
            if (code < 0x20) {
                out += ' ';
                continue;
            }
        }
        out += character;
    }

    return out;
};

const salvageJobPosting = (raw) => {
    const readString = (key) => {
        const match = String(raw).match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
        if (!match) return null;
        try {
            return JSON.parse(`"${match[1]}"`);
        } catch {
            return match[1];
        }
    };

    return {
        '@type': 'JobPosting',
        title: readString('title'),
        datePosted: readString('datePosted'),
        employmentType: readString('employmentType'),
        industry: readString('industry'),
        description: readString('description'),
        additionalType: readString('additionalType'),
        url: readString('url'),
    };
};

const parseJsonLdBlocks = (html) => {
    const blocks = [...String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
        .map((match) => match[1]);
    const parsed = [];

    for (const block of blocks) {
        const trimmed = block.replace(/^\uFEFF/, '').trim();
        if (!trimmed) continue;
        let succeeded = false;
        for (const candidate of [trimmed, sanitizeJsonString(trimmed)]) {
            try {
                parsed.push(JSON.parse(candidate));
                succeeded = true;
                break;
            } catch {
                // Try the sanitized variant, then fall back to the salvage path.
            }
        }
        if (!succeeded) {
            const salvaged = salvageJobPosting(trimmed);
            if (salvaged.title || salvaged.description) parsed.push(salvaged);
        }
    }

    return parsed;
};

const findJobPosting = (value, depth = 0) => {
    if (!value || depth > 8) return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findJobPosting(item, depth + 1);
            if (found) return found;
        }
        return null;
    }
    if (typeof value !== 'object') return null;
    if (value['@type'] === 'JobPosting') return value;
    for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity']) {
        if (value[key]) {
            const found = findJobPosting(value[key], depth + 1);
            if (found) return found;
        }
    }
    return null;
};

const findTile = (html, path) => {
    const index = html.indexOf(path);
    if (index === -1) return '';

    const forwardClass = html.indexOf('job-tile', index);
    const backwardClass = html.lastIndexOf('job-tile', index);
    const tileClass = forwardClass !== -1 && forwardClass - index < 600
        ? forwardClass
        : backwardClass;

    if (tileClass === -1) {
        return html.slice(Math.max(0, index - 2500), Math.min(html.length, index + 8000));
    }

    const start = Math.max(0, html.lastIndexOf('<div', tileClass));
    const openTagEnd = html.indexOf('>', tileClass);
    const nextClass = openTagEnd === -1 ? -1 : html.indexOf('job-tile', openTagEnd + 1);
    const end = nextClass === -1
        ? Math.min(html.length, start + 12000)
        : Math.max(start, html.lastIndexOf('<div', nextClass));
    return html.slice(start, end);
};

const extractListingJobs = (html, pageUrl) => {
    const jobs = [];
    const seen = new Set();
    const linkPattern = /\b(?:about|href)=["']([^"']*?\/job-detail\/[^"']*)["']/gi;

    for (const match of String(html).matchAll(linkPattern)) {
        const rawPath = decodeEntities(match[1]);
        if (!rawPath) continue;

        let url;
        try {
            url = new URL(rawPath, pageUrl).href;
        } catch {
            continue;
        }

        const key = jobKeyFromUrl(url);
        if (!key || seen.has(key)) continue;
        seen.add(key);

        const tile = findTile(html, match[1]);
        const titleBlock = readBlock(tile, 'job-title');
        const bulletBlock = readBlock(tile, 'job_advert__job-desc-bullet-points');
        const title = firstText(
            stripTags(titleBlock.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || ''),
            stripTags(titleBlock),
            stripTags(readBlock(tile, 'job-apply-job-title')),
        );
        const listingJobId = tile.match(/id=["']job-(\d+)["']/i)?.[1]
            || tile.match(/class=["'][^"']*job-title[^"']*["'][^>]*id=["'](\d+)["']/i)?.[1]
            || null;
        const bulletPoints = [...bulletBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
            .map((entry) => stripTags(entry[1]))
            .filter(Boolean);

        jobs.push({
            key,
            url,
            referer: pageUrl,
            title: title || null,
            location: firstText(stripTags(readBlock(tile, 'job-location'))),
            salary: firstText(stripTags(readBlock(tile, 'job-salary'))),
            job_type: firstText(stripTags(readBlock(tile, 'job-contract-type'))),
            job_nature: firstText(stripTags(readBlock(tile, 'job-nature'))),
            company_type: firstText(stripTags(readBlock(tile, 'job-company-type'))),
            sector: firstText(stripTags(readBlock(tile, 'job-sector'))),
            summary: firstText(stripTags(readBlock(tile, 'job_advert__job-summary-text'))),
            bullet_points: bulletPoints.length ? bulletPoints : null,
            listing_job_id: listingJobId,
            job_reference: getJobReferenceFromUrl(url),
        });
    }

    return jobs;
};

const parseSummaryFields = (html) => {
    const pairs = [...String(html).matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)]
        .map((match) => [stripTags(match[1]), stripTags(match[2])])
        .filter(([label]) => label);
    const indexOfLabel = (pattern) => pairs.findIndex(([label]) => pattern.test(label));
    const valueAt = (index) => (index >= 0 ? pairs[index][1] || null : null);

    const sectorIndex = indexOfLabel(/^(sector|secteur|branche|settore|sektor|setor|セクター|行业)/i);
    const subSectorIndex = indexOfLabel(/^(sub\s*sector|sous[\s-]*secteur|sottosettore|subsektor|subsector|teilbranche|サブセクター|子行业)/i);

    return {
        sector: sectorIndex >= 0 ? valueAt(sectorIndex) : valueAt(0),
        subSector: subSectorIndex >= 0 ? valueAt(subSectorIndex) : valueAt(1),
        industry: valueAt(indexOfLabel(/^(industry|industrie|industria|業界|indústria)/i)),
        contractType: valueAt(indexOfLabel(/^(contract type|type de contrat|vertragsart|tipo di contratto|tipo de contrato|contracttype|合同类型|雇用形態)/i)),
        consultant: valueAt(indexOfLabel(/consultant|consultor|consulente|berater|コンサルタント|顾问/i)),
        jobReference: valueAt(indexOfLabel(/référence|reference|referenz|referencia|referência|referentie|求人番号|职位编号|職位編號/i)),
    };
};

const parseContactFields = (html) => {
    const start = String(html).indexOf('job-contact-info');
    if (start === -1) return { consultant: null, jobReference: null };
    const block = String(html).slice(start, start + 4000);
    const pairs = [...block.matchAll(/<div[^>]*class=["'][^"']*field--label[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class=["'][^"']*field--item[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
        .map((match) => [stripTags(match[1]), stripTags(match[2])])
        .filter(([label, value]) => label && value);

    return {
        consultant: pairs.find(([label]) => /contact|kontakt|consultant|consultor|consulente|berater|コンサルタント|顾问|联系人/i.test(label))?.[1]
            || pairs[0]?.[1]
            || null,
        jobReference: pairs.find(([label]) => /ref|réf|referenz|referencia|referência|referentie|求人番号|职位编号|職位編號/i.test(label))?.[1] || null,
    };
};

const parseDetailHtml = (html) => {
    const header = readBlock(html, 'job-apply-fields') || html;
    const sections = [
        ['About Our Client', readBlock(html, 'job_advert__job-desc-company')],
        ['Job Description', readBlock(html, 'job_advert__job-desc-role')],
        ['The Successful Applicant', readBlock(html, 'job_advert__job-desc-candidate')],
        ["What's on Offer", readBlock(html, 'job_advert__job-desc-deal')],
    ].filter(([, content]) => stripTags(content));
    const descriptionHtml = sections.length
        ? sections.map(([heading, content]) => `<h2>${heading}</h2>${content}`).join('\n')
        : null;
    const contact = parseContactFields(html);
    const summary = parseSummaryFields(html);
    const applyPath = html.match(/href=["']([^"']*\/job-apply\/[^"']+)["']/i)?.[1] || null;

    return {
        title: firstText(stripTags(readBlock(html, 'job-apply-job-title')), stripTags(readBlock(html, 'job-title'))),
        location: firstText(stripTags(readBlock(header, 'job-location'))),
        salary: firstText(stripTags(readBlock(header, 'job-salary'))),
        contractType: firstText(stripTags(readBlock(header, 'job-contract-type')), summary.contractType),
        companyType: firstText(stripTags(readBlock(header, 'job-company-type'))),
        jobNature: firstText(stripTags(readBlock(header, 'job-nature'))),
        descriptionHtml,
        applyUrl: applyPath,
        consultant: firstText(contact.consultant, summary.consultant),
        jobReference: firstText(contact.jobReference, summary.jobReference),
        sector: summary.sector,
        subSector: summary.subSector,
        industry: summary.industry,
    };
};

const buildRecord = ({ listing, detailUrl, html }) => {
    let jobPosting = null;
    let extras = EMPTY_DETAIL;

    if (html) {
        try {
            jobPosting = findJobPosting(parseJsonLdBlocks(html));
            extras = parseDetailHtml(html);
        } catch (error) {
            log.warning(`Detail parsing fell back to listing fields for ${jobKeyFromUrl(detailUrl)}: ${briefError(error)}`);
        }
    }

    let origin = null;
    try {
        origin = new URL(detailUrl).origin;
    } catch {
        origin = null;
    }

    const employmentType = jobPosting?.employmentType ?? null;
    const employmentText = Array.isArray(employmentType) ? employmentType.join(', ') : employmentType;
    const descriptionHtml = firstText(jobPosting?.description, extras.descriptionHtml);
    const applyUrl = extras.applyUrl && origin
        ? new URL(extras.applyUrl, detailUrl).href
        : extras.applyUrl;

    const record = {
        title: firstText(listing.title, jobPosting?.title, extras.title),
        company: firstText(jobPosting?.hiringOrganization?.name),
        location: firstText(formatJobLocation(jobPosting?.jobLocation), listing.location, extras.location),
        salary: firstText(listing.salary, extras.salary),
        job_type: firstText(listing.job_type, extras.contractType, employmentText),
        job_nature: firstText(listing.job_nature, extras.jobNature),
        company_type: firstText(listing.company_type, extras.companyType),
        sector: firstText(listing.sector, extras.sector),
        sub_sector: extras.subSector,
        industry: firstText(jobPosting?.industry, extras.industry),
        date_posted: jobPosting?.datePosted || null,
        description_html: descriptionHtml,
        description_text: descriptionHtml ? stripTags(descriptionHtml) : null,
        url: detailUrl,
        apply_url: applyUrl,
        scrapedAt: new Date().toISOString(),
        listing_job_id: listing.listing_job_id || null,
        job_id: getIdentifierValue(jobPosting?.identifier),
        job_reference: firstText(extras.jobReference, listing.job_reference, getJobReferenceFromUrl(detailUrl)),
        additional_type: jobPosting?.additionalType || null,
        employment_type: employmentType,
        valid_through: jobPosting?.validThrough || null,
        direct_apply: typeof jobPosting?.directApply === 'boolean' ? jobPosting.directApply : null,
        job_location: jobPosting?.jobLocation ?? null,
        job_location_type: jobPosting?.jobLocationType || null,
        applicant_location_requirements: jobPosting?.applicantLocationRequirements ?? null,
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
        consultant: extras.consultant,
        summary: listing.summary || null,
        bullet_points: listing.bullet_points || null,
        source_domain: origin ? new URL(origin).host : null,
    };

    return removeNullValues(record) || null;
};

const createHttpError = (message, options = {}) => {
    const error = new Error(message);
    error.name = 'HttpError';
    error.status = options.status || 0;
    error.noResults = Boolean(options.noResults);
    error.closed = Boolean(options.closed);
    error.isHttpError = true;
    return error;
};

class RequestPool {
    constructor({ proxyConfiguration, size, minPaceMs, maxPaceMs }) {
        this.proxyConfiguration = proxyConfiguration;
        this.size = Math.max(1, size);
        this.minPaceMs = minPaceMs;
        this.maxPaceMs = maxPaceMs;
        this.slots = [];
        this.cursor = 0;
        this.profileCursor = 0;
        this.rotationCounter = 0;
        this.runTag = Date.now().toString(36);
    }

    async init() {
        for (let index = 0; index < this.size; index += 1) {
            this.slots.push(await this.createSlot(index, 0, this.minPaceMs));
        }
        if (this.proxyConfiguration && this.slots.some((slot) => !slot.proxyUrl)) {
            log.warning('Apify Proxy could not be reached; continuing without a proxy.');
            await this.useDirect();
        }
    }

    async createSlot(index, attempt, pacingMs) {
        const profile = PROFILE_POOL[this.profileCursor % PROFILE_POOL.length];
        this.profileCursor += 1;
        this.rotationCounter += 1;
        let proxyUrl;
        if (this.proxyConfiguration) {
            try {
                proxyUrl = await this.proxyConfiguration.newUrl(
                    `mp_${this.runTag}_${index}_${attempt}_${this.rotationCounter}`,
                );
            } catch (error) {
                log.warning(`Proxy session could not be created: ${briefError(error)}`);
            }
        }
        return {
            index,
            attempt,
            profile,
            proxyUrl,
            pacingMs: Math.max(this.minPaceMs, Math.min(this.maxPaceMs, pacingMs)),
            nextSlotAt: 0,
            client: new Impit({
                browser: profile,
                timeout: REQUEST_TIMEOUT_MS,
                followRedirects: false,
                ...(proxyUrl ? { proxyUrl } : {}),
            }),
        };
    }

    nextSlot() {
        const slot = this.slots[this.cursor % this.slots.length];
        this.cursor += 1;
        return slot;
    }

    async rotateSlot(slot) {
        const current = this.slots[slot.index];
        const next = await this.createSlot(slot.index, current.attempt + 1, current.pacingMs);
        if (this.proxyConfiguration && !next.proxyUrl) {
            log.warning('Proxy session rotation failed; keeping the current session.');
            return current;
        }
        this.slots[slot.index] = next;
        return next;
    }

    async rotateAll() {
        for (let index = 0; index < this.slots.length; index += 1) {
            const current = this.slots[index];
            const next = await this.createSlot(index, current.attempt + 1, current.pacingMs);
            if (!this.proxyConfiguration || next.proxyUrl) this.slots[index] = next;
        }
    }

    // Drop the proxy and collapse to one direct slot: direct IPs throttle, so parallel slots would hurt.
    async useDirect() {
        this.proxyConfiguration = null;
        this.size = 1;
        this.minPaceMs = PACE_MIN_DIRECT_MS;
        this.maxPaceMs = PACE_MAX_DIRECT_MS;
        this.slots = [await this.createSlot(0, 1, PACE_MIN_DIRECT_MS)];
    }

    async useProxyConfiguration(proxyConfiguration, size, minPaceMs, maxPaceMs) {
        this.proxyConfiguration = proxyConfiguration;
        this.size = Math.max(1, size);
        this.minPaceMs = minPaceMs;
        this.maxPaceMs = maxPaceMs;
        this.slots = [];
        for (let index = 0; index < this.size; index += 1) {
            this.slots.push(await this.createSlot(index, 1, minPaceMs));
        }
        if (this.slots.some((slot) => !slot.proxyUrl)) {
            log.warning('Default proxy pool could not be reached; continuing without a proxy.');
            await this.useDirect();
        }
    }

    // Stagger request starts using the latest slot state, not the caller's stale copy.
    async pace(slot) {
        const current = this.slots[slot.index];
        const now = Date.now();
        const at = Math.max(now, current.nextSlotAt);
        const nextSlotAt = at + current.pacingMs + Math.floor(Math.random() * current.pacingMs * 0.4);
        const next = { ...current, nextSlotAt };
        this.slots[slot.index] = next;
        const wait = at - now;
        if (wait > 0) await sleep(wait);
        return next;
    }

    setPacing(slot, pacingMs) {
        const next = { ...this.slots[slot.index], pacingMs };
        this.slots[slot.index] = next;
        return next;
    }

    noteThrottle(slot) {
        return this.setPacing(slot, Math.min(this.maxPaceMs, Math.round(this.slots[slot.index].pacingMs * 1.7)));
    }

    noteSuccess(slot) {
        return this.setPacing(slot, Math.max(this.minPaceMs, Math.round(this.slots[slot.index].pacingMs * 0.9)));
    }

    async cooldown(ms) {
        const until = Date.now() + ms;
        for (const slot of this.slots) {
            slot.nextSlotAt = Math.max(slot.nextSlotAt, until);
        }
        await sleep(ms);
    }

    retryDelay(attempt, headers) {
        const retryAfter = parseRetryAfter(headers);
        if (retryAfter !== null) return Math.min(retryAfter, MAX_RETRY_DELAY_MS);
        const backoff = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1));
        return Math.min(MAX_RETRY_DELAY_MS, backoff + Math.floor(Math.random() * 500));
    }

    async requestOnce(slot, url, headers) {
        const response = await slot.client.fetch(url, {
            headers,
            timeout: REQUEST_TIMEOUT_MS,
            redirect: 'manual',
        });
        const body = await response.text();
        return {
            body,
            status: response.status,
            url: response.url || url,
            headers: response.headers,
        };
    }

    getRedirectTarget(result, currentUrl) {
        let target = getHeader(result.headers, 'location');
        if (!target) {
            const meta = result.body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']([^"']+)["']/i)?.[1];
            target = meta?.match(/url\s*=\s*['"]?([^'"]+)['"]?/i)?.[1] || null;
        }
        if (!target) return null;
        try {
            const next = new URL(decodeEntities(target.trim()), currentUrl).href;
            return /^https?:/i.test(next) ? next : null;
        } catch {
            return null;
        }
    }

    async requestFollowingRedirects(slot, url, headers) {
        let current = url;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            const result = await this.requestOnce(slot, current, headers);
            if (result.status >= 300 && result.status < 400) {
                const target = this.getRedirectTarget(result, current);
                if (target && target !== current) {
                    current = target;
                    continue;
                }
            }
            return result;
        }
        throw createHttpError(`Too many redirects for ${url}`, { status: 508 });
    }

    async fetchHtml(url, options = {}) {
        const { referer, kind = 'page' } = options;
        const headers = referer ? { referer } : undefined;
        let slot = this.nextSlot();
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            slot = await this.pace(slot);
            try {
                const result = await this.requestFollowingRedirects(slot, url, headers);
                const { status, body } = result;

                if (isClosedOffice(body)) {
                    throw createHttpError('This market is closed. Choose a different Michael Page country site.', { status, closed: true });
                }

                if (isChallenge(status, body)) {
                    lastError = createHttpError(`Blocked by the site (HTTP ${status})`, { status });
                    if (attempt < MAX_ATTEMPTS) {
                        log.warning(`Request challenged (HTTP ${status}, profile ${slot.profile}); rotating session and backing off.`);
                        slot = this.noteThrottle(slot);
                        slot = await this.rotateSlot(slot);
                        await sleep(this.retryDelay(attempt, result.headers));
                        continue;
                    }
                    break;
                }

                if (status === 404 && isNoResultsHtml(body)) {
                    throw createHttpError('No results for this search', { status, noResults: true });
                }

                if (status >= 300 && status < 400) {
                    lastError = createHttpError(`Unresolved redirect (HTTP ${status})`, { status });
                    if (attempt < MAX_ATTEMPTS) {
                        log.warning(`Redirect could not be resolved (HTTP ${status}); retrying with a fresh session.`);
                        slot = await this.rotateSlot(slot);
                        await sleep(this.retryDelay(attempt, result.headers));
                        continue;
                    }
                    break;
                }

                if (isRetryableStatus(status)) {
                    lastError = createHttpError(`HTTP ${status} from the site`, { status });
                    if (attempt < MAX_ATTEMPTS) {
                        log.warning(`Request returned HTTP ${status}; retrying with a fresh session.`);
                        slot = this.noteThrottle(slot);
                        slot = await this.rotateSlot(slot);
                        await sleep(this.retryDelay(attempt, result.headers));
                        continue;
                    }
                    break;
                }

                if (status < 200 || status >= 400) {
                    throw createHttpError(`HTTP ${status} from the site`, { status });
                }

                if (kind === 'detail' && !looksLikeDetail(body)) {
                    lastError = createHttpError('Detail page returned no job markers', { status });
                    if (attempt < MAX_ATTEMPTS) {
                        log.warning('Detail page returned no job markers; retrying with a fresh session.');
                        slot = await this.rotateSlot(slot);
                        await sleep(this.retryDelay(attempt, result.headers));
                        continue;
                    }
                    break;
                }

                slot = this.noteSuccess(slot);
                return {
                    body,
                    status,
                    url: result.url,
                    profile: slot.profile,
                    pacingMs: slot.pacingMs,
                };
            } catch (error) {
                // A 404/410/400 will not heal on a retry; only transient failures are worth the attempts.
                if (error.isHttpError && !isTransientError(error)) throw error;
                lastError = error;
                // A proxy auth rejection never reaches the site; stop retrying so the pool can be swapped.
                if (/proxy authentication required/i.test(briefError(error))) break;
                if (attempt >= MAX_ATTEMPTS) break;
                log.warning(`Request failed (${briefError(error)}); retrying.`);
                slot = this.noteThrottle(slot);
                slot = await this.rotateSlot(slot);
                await sleep(this.retryDelay(attempt));
            }
        }

        throw lastError.isHttpError
            ? lastError
            : createHttpError(lastError?.message || 'Request failed');
    }
}

const getMarketCountry = (value) => {
    const raw = normalizeText(value);
    if (!raw) return null;
    try {
        const host = new URL(raw.includes('://') ? raw : `https://${raw}`).host.toLowerCase();
        return MARKET_COUNTRIES[host] || null;
    } catch {
        return null;
    }
};

const normalizeDomain = (value) => {
    const raw = normalizeText(value);
    if (!raw) return DEFAULT_DOMAIN;
    const host = raw
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
    const withWww = host.startsWith('www.') ? host : `www.${host}`;
    if (!DOMAINS.includes(withWww)) {
        throw new Error(`Unsupported Michael Page market "${raw}". Use one of: ${DOMAINS.join(', ')}`);
    }
    return withWww;
};

const slugify = (value) => normalizeText(value)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const buildSearchUrl = (domain, keyword, location) => {
    const url = new URL(`https://${domain}/jobs`);
    if (keyword) url.searchParams.set('search', keyword);
    if (location) url.searchParams.set('location', location);
    return url.href;
};

const buildPrettyUrl = (domain, keyword, location) => {
    const keywordSlug = slugify(keyword);
    if (!keywordSlug) return null;
    const locationSlug = location ? slugify(location) : '';
    return `https://${domain}/jobs/${keywordSlug}${locationSlug ? `/${locationSlug}` : ''}`;
};

const dedupeUrls = (urls) => [...new Set(urls.filter(Boolean))];

const buildSearchCandidates = ({ startUrl, keyword, location, domain }) => {
    if (startUrl) {
        const candidates = [startUrl];
        try {
            const parsed = new URL(startUrl);
            const search = parsed.searchParams.get('search');
            if (search && !/\/job-detail\//i.test(parsed.pathname)) {
                const alternate = new URL(`https://${parsed.host}/jobs`);
                alternate.searchParams.set('search', search);
                const alternateLocation = parsed.searchParams.get('location');
                if (alternateLocation) alternate.searchParams.set('location', alternateLocation);
                candidates.push(alternate.href);
            }
        } catch {
            throw new Error(`Invalid startUrl: ${startUrl}`);
        }
        return dedupeUrls(candidates);
    }

    const candidates = [buildSearchUrl(domain, keyword, location)];
    if (keyword) candidates.push(buildPrettyUrl(domain, keyword, location));
    return dedupeUrls(candidates);
};

const withPage = (url, page) => {
    const parsed = new URL(url);
    if (page > 0) parsed.searchParams.set('page', String(page));
    else parsed.searchParams.delete('page');
    return parsed.href;
};

const hasNextPage = (html) => /rel=["']next["']/i.test(String(html));

const collectJobs = async ({ fetcher, candidates, referer, maxPages, resultsWanted }) => {
    let sawNoResults = false;
    let lastReason = 'not_attempted';
    let lastTransient = false;

    const fetchPage = async (candidate, page) => {
        const pageUrl = withPage(candidate, page);
        try {
            const response = await fetcher.fetchHtml(pageUrl, { kind: 'listing', referer });
            return { page, pageUrl, html: response.body };
        } catch (error) {
            return { page, pageUrl, error };
        }
    };

    for (const candidate of candidates) {
        const first = await fetchPage(candidate, 0);
        if (first.error) {
            lastTransient = isTransientError(first.error);
            if (first.error.noResults) {
                sawNoResults = true;
                lastReason = 'no_results';
                continue;
            }
            lastReason = briefError(first.error);
            continue;
        }
        const firstJobs = extractListingJobs(first.html, first.pageUrl);
        if (!firstJobs.length) {
            lastTransient = false;
            if (isNoResultsHtml(first.html)) sawNoResults = true;
            lastReason = sawNoResults ? 'no_results' : 'no_job_rows';
            continue;
        }

        const pageResults = [first];
        const observedPageSize = Math.max(1, firstJobs.length);
        const pagesToTry = resultsWanted <= firstJobs.length
            ? 1
            : Math.min(maxPages, Math.ceil(resultsWanted / observedPageSize) + 1);
        const parallelListing = fetcher.size > 1 && pagesToTry > 1 && hasNextPage(first.html);
        let stopReason = 'max_pages';

        if (parallelListing) {
            const requests = [];
            for (let page = 1; page < pagesToTry; page += 1) requests.push(fetchPage(candidate, page));
            const settled = await Promise.all(requests);
            pageResults.push(...settled);
        } else {
            let pageErrors = 0;
            for (let page = 1; page < pagesToTry; page += 1) {
                const lastGood = pageResults.filter((entry) => !entry.error).at(-1);
                if (!lastGood || !hasNextPage(lastGood.html)) {
                    stopReason = 'last_page';
                    break;
                }
                const result = await fetchPage(candidate, page);
                pageResults.push(result);
                if (result.error) {
                    if (result.error.noResults) {
                        sawNoResults = true;
                        stopReason = 'no_results';
                        break;
                    }
                    lastTransient = isTransientError(result.error);
                    pageErrors += 1;
                    log.warning(`Listing page ${page + 1} failed (${briefError(result.error)}); skipping it.`);
                    // Skip a flaky page, but stop after two in a row so an outage does not burn every page.
                    if (pageErrors >= 2) {
                        stopReason = 'page_error';
                        break;
                    }
                    continue;
                }
                pageErrors = 0;
                if (!extractListingJobs(result.html, result.pageUrl).length) {
                    stopReason = 'no_job_rows';
                    break;
                }
            }
        }

        const jobs = [];
        const seen = new Set();
        let pagesWithJobs = 0;

        for (const result of pageResults) {
            if (result.error) {
                lastTransient = isTransientError(result.error);
                if (result.error.noResults) sawNoResults = true;
                continue;
            }
            const parsedJobs = extractListingJobs(result.html, result.pageUrl);
            if (!parsedJobs.length) continue;
            pagesWithJobs += 1;
            for (const job of parsedJobs) {
                if (seen.has(job.key)) continue;
                seen.add(job.key);
                jobs.push(job);
                if (jobs.length >= resultsWanted) break;
            }
            if (jobs.length >= resultsWanted) break;
        }

        if (jobs.length) {
            return { jobs, pages: pagesWithJobs, reason: stopReason, noResults: false };
        }
        lastReason = sawNoResults ? 'no_results' : stopReason;
    }

    return { jobs: [], pages: 0, reason: lastReason, noResults: sawNoResults, transient: lastTransient };
};

const createProxyConfiguration = async (proxyInput) => {
    const hasCustomUrls = Array.isArray(proxyInput?.proxyUrls) && proxyInput.proxyUrls.length > 0;
    const wantsApifyProxy = Boolean(proxyInput?.useApifyProxy);
    if (!hasCustomUrls && !(wantsApifyProxy && Actor.isAtHome())) return undefined;

    try {
        return await Actor.createProxyConfiguration(proxyInput);
    } catch (error) {
        log.warning(`Proxy configuration could not be created: ${briefError(error)}. Continuing without a proxy.`);
        return undefined;
    }
};

const main = async () => {
    const input = (await Actor.getInput()) || {};
    const keyword = normalizeText(input.keyword);
    const location = normalizeText(input.location);
    const startUrl = normalizeText(input.startUrl);
    const domain = startUrl ? DEFAULT_DOMAIN : normalizeDomain(input.domain);
    const resultsWanted = normalizePositiveInt(input.results_wanted, 20);
    const maxPages = Math.min(normalizePositiveInt(input.max_pages, 10), MAX_PAGES_HARD_LIMIT);

    const maxConcurrency = Math.min(
        normalizePositiveInt(input.maxConcurrency, DEFAULT_DETAIL_CONCURRENCY),
        MAX_DETAIL_CONCURRENCY,
    );
    const includeJobDetails = input.includeJobDetails !== false;
    const proxyInput = { ...(input.proxyConfiguration || {}) };
    const autoPinnedCountry = proxyInput.useApifyProxy && !proxyInput.apifyProxyCountry
        ? getMarketCountry(startUrl || domain)
        : null;
    if (autoPinnedCountry) proxyInput.apifyProxyCountry = autoPinnedCountry;
    const proxyConfiguration = await createProxyConfiguration(proxyInput);
    // Some accounts reject specific country pools; keep an unpinned fallback for the recovery pass.
    const unpinnedProxyConfiguration = autoPinnedCountry
        ? await createProxyConfiguration({ ...proxyInput, apifyProxyCountry: undefined })
        : undefined;
    const poolSize = proxyConfiguration
        ? Math.max(1, Math.min(PROXY_POOL_MAX, Math.ceil(maxConcurrency / 2)))
        : 1;
    const fetcher = new RequestPool({
        proxyConfiguration,
        size: poolSize,
        minPaceMs: proxyConfiguration ? PACE_MIN_PROXY_MS : PACE_MIN_DIRECT_MS,
        maxPaceMs: proxyConfiguration ? PACE_MAX_PROXY_MS : PACE_MAX_DIRECT_MS,
    });
    await fetcher.init();

    if (startUrl && /\/job-detail\//i.test(startUrl)) {
        const response = await fetcher.fetchHtml(startUrl, { kind: 'detail' });
        const html = response.body;
        const record = buildRecord({
            listing: { title: null, job_reference: getJobReferenceFromUrl(startUrl) },
            detailUrl: startUrl,
            html,
        });
        if (record) await Actor.pushData([record]);
        log.info(`Done | saved=${record ? 1 : 0} | source=detail-url`);
        return;
    }

    const candidates = buildSearchCandidates({ startUrl, keyword, location, domain });
    let referer;
    try {
        referer = new URL(candidates[0]).origin;
    } catch {
        referer = `https://${domain}`;
    }

    let mode = 'market';
    if (startUrl) mode = 'url';
    else if (keyword && location) mode = 'keyword+location';
    else if (keyword) mode = 'keyword';
    log.info(
        `Start run | market=${new URL(candidates[0]).host} | mode=${mode} | limit=${resultsWanted} | pages=${maxPages} | pool=${fetcher.size} | concurrency=${maxConcurrency} | details=${includeJobDetails}`,
    );

    const runCollect = (list = candidates) => collectJobs({
        fetcher,
        candidates: list,
        referer,
        maxPages,
        resultsWanted,
    });

    let collected = await runCollect();

    // A 200 page with no tiles can still be a soft block, so retry once even when the error is not a 5xx.
    if (!collected.jobs.length && !collected.noResults) {
        const cooldown = collected.transient ? RECOVERY_COOLDOWN_MS : 5000;
        log.warning(`No listings on the first pass (${collected.reason}); cooling down ${Math.round(cooldown / 1000)}s and retrying.`);
        await fetcher.cooldown(cooldown);
        await fetcher.rotateAll();
        collected = await runCollect([...candidates].reverse());
    }

    // A country-pinned pool can be unavailable for some accounts while the default pool works.
    if (!collected.jobs.length && !collected.noResults && collected.transient && unpinnedProxyConfiguration) {
        log.warning(`Proxy pool for ${autoPinnedCountry} is failing; retrying with the default pool.`);
        await fetcher.useProxyConfiguration(unpinnedProxyConfiguration, poolSize, PACE_MIN_PROXY_MS, PACE_MAX_PROXY_MS);
        collected = await runCollect();
    }

    // Datacenter proxy IPs sometimes stay blocked while a direct connection still works.
    if (!collected.jobs.length && !collected.noResults && collected.transient && proxyConfiguration) {
        log.warning('Proxy endpoints are still blocked; retrying without a proxy.');
        await fetcher.useDirect();
        collected = await runCollect();
    }

    if (!collected.jobs.length) {
        if (collected.noResults) {
            log.warning('The search returned no jobs. Nothing to save.');
            return;
        }
        if (collected.transient) {
            log.warning(`No job listings could be read (${collected.reason}) after recovery. Finishing without items.`);
            return;
        }
        throw new Error(`No job listings could be read (${collected.reason}). See API_DISCOVERY.md for the failure playbook.`);
    }

    const targets = collected.jobs.slice(0, resultsWanted);
    log.info(`Found ${collected.jobs.length} unique jobs over ${collected.pages} page(s). Enriching ${includeJobDetails ? targets.length : 0}.`);

    let saved = 0;
    let detailFailures = 0;
    let buffer = [];

    const flush = async () => {
        if (!buffer.length) return;
        await Actor.pushData(buffer);
        saved += buffer.length;
        log.info(`Saved ${buffer.length} jobs. Total: ${saved}/${targets.length}`);
        buffer = [];
    };

    if (!includeJobDetails) {
        for (const job of targets) {
            const record = buildRecord({ listing: job, detailUrl: job.url, html: null });
            if (record) buffer.push(record);
            if (buffer.length >= PUSH_BATCH_SIZE) await flush();
        }
        await flush();
        log.info(`Done | saved=${saved} | pages=${collected.pages} | details=skipped`);
        return;
    }

    const failedJobs = [];

    for (let index = 0; index < targets.length; index += maxConcurrency) {
        const chunk = targets.slice(index, index + maxConcurrency);
        const settled = await Promise.allSettled(
            chunk.map(async (job) => {
                const response = await fetcher.fetchHtml(job.url, { kind: 'detail', referer: job.referer });
                return buildRecord({ listing: job, detailUrl: job.url, html: response.body });
            }),
        );

        for (let offset = 0; offset < settled.length; offset += 1) {
            const result = settled[offset];
            const job = chunk[offset];
            if (result.status === 'fulfilled' && result.value) {
                buffer.push(result.value);
                continue;
            }
            failedJobs.push(job);
            const reason = result.status === 'rejected' ? briefError(result.reason) : 'empty record';
            log.warning(`Detail attempt failed for ${job.key} (${reason}); queued for a second pass.`);
        }

        if (buffer.length >= PUSH_BATCH_SIZE) await flush();
    }

    if (failedJobs.length) {
        log.warning(`${failedJobs.length} detail page(s) failed; retrying with lower concurrency and fresh sessions.`);
        await fetcher.rotateAll();
        for (let index = 0; index < failedJobs.length; index += SECOND_PASS_CONCURRENCY) {
            const chunk = failedJobs.slice(index, index + SECOND_PASS_CONCURRENCY);
            const settled = await Promise.allSettled(
                chunk.map(async (job) => {
                    const response = await fetcher.fetchHtml(job.url, { kind: 'detail', referer: job.referer });
                    return buildRecord({ listing: job, detailUrl: job.url, html: response.body });
                }),
            );

            for (let offset = 0; offset < settled.length; offset += 1) {
                const result = settled[offset];
                const job = chunk[offset];
                if (result.status === 'fulfilled' && result.value) {
                    buffer.push(result.value);
                    continue;
                }
                detailFailures += 1;
                const reason = result.status === 'rejected' ? briefError(result.reason) : 'empty record';
                log.warning(`Detail still unavailable for ${job.key} (${reason}); saving listing fields.`);
                const fallback = buildRecord({ listing: job, detailUrl: job.url, html: null });
                if (fallback) buffer.push(fallback);
            }
            await flush();
        }
    }

    await flush();

    const finalSlot = fetcher.slots[0];
    log.info(
        `Done | saved=${saved} | pages=${collected.pages} | stop=${collected.reason} | detail_failures=${detailFailures} | pool=${fetcher.size} | profile=${finalSlot?.profile || 'n/a'} | pacing_ms=${finalSlot?.pacingMs || 0}`,
    );
};

await Actor.init();

try {
    await main();
    await Actor.exit();
} catch (error) {
    log.error(`Actor failed: ${briefError(error)}`);
    await Actor.fail(error?.message || 'Actor failed');
}
