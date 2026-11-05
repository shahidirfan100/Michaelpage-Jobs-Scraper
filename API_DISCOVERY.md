# Michael Page API Discovery

Checked: 2026-10-22

## Summary

Michael Page is a Drupal site. There is no public JSON API for job search:

- `/jsonapi` and `/jsonapi/node/job_advert` return `403 Permission denied`.
- `/jobs?_format=json` returns `406`, with the message that only `html` is supported.
- `/views/ajax` returns `404`.
- `/jobs/rss.xml` returns `404`.
- `/sitemap.xml?lang=en` lists 2,056 `/jobs/...` search pages and 273 advice pages. It does not list job-detail pages.

The usable sources are the server-rendered search page and the `JobPosting` block embedded in each job-detail page.

## Selected sources

### 1. Search results page

- URL: `https://<market>/jobs?search=<keyword>&location=<location>&page=<n>`
- Method: `GET`
- Auth: none
- Pagination: `page` is zero-based; 30 rows per page for most markets, 20 for FR and CN
- Response: HTML containing `li.views-row` blocks with `div.job-tile`
- Job link: `about="/job-detail/<slug>/ref/<ref>"` and a matching `href`
- Fields on the tile: title, location, contract type, salary (when published), job nature, company type, summary, bullet points, internal listing id
- Location is supported as a query parameter. The site then redirects to a pretty path such as `/jobs/project-manager/de-witt-texas`.

The query form responds with `302` and a small HTML meta-refresh page:

```
302 Location: https://www.michaelpage.com/jobs/manager
<meta http-equiv="refresh" content="0;url='https://www.michaelpage.com/jobs/manager'">
```

The client must follow the `Location` header and the meta-refresh body. The response body is 406 bytes and contains no jobs.

### 2. Job detail page

- URL: `https://<market>/job-detail/<slug>/ref/<ref>`
- Method: `GET`
- Auth: none
- Response: HTML with one `script[type="application/ld+json"]` block and an HTML fallback

`JobPosting` keys observed in US, UK, FR, DE, and JP:

```
@context, @type, title, additionalType, image, datePosted,
hiringOrganization, url, employmentType, industry, description,
baseSalary, jobLocation
```

Optional keys observed on some markets: `jobLocationType`, `applicantLocationRequirements`.

The embedded JSON contains raw newlines inside `description`, so it is not valid JSON until control characters inside strings are escaped.

HTML fallback and extra fields:

- `h1.job-apply-job-title`
- `.job-apply-fields` → `.job-location`, `.job-contract-type`, `.job-salary`
- `.job_advert__job-desc-company`, `.job_advert__job-desc-role`, `.job_advert__job-desc-candidate`, `.job_advert__job-desc-deal`
- `.job-contact-info` → contact name, quote job ref
- `#summary` → Sector, Sub Sector, Industry, Where, Contract Type, Consultant name, Job Reference
- `.apply-link a[href*="/job-apply/"]`

The summary labels are localized, so the parser maps English labels first and falls back to field order for Sector and Sub Sector.

## Request requirements

- No cookies, tokens, API keys, or login are needed.
- The default is an Apify datacenter proxy. No proxy works for small runs, but repeated detail requests are throttled.
- Every tested profile returned complete pages without an HTTP version override. HTTP/3 is not required.
- No browser or JavaScript rendering is needed. All job data arrives in the HTML response.
- The actor rotates the profile and the proxy session on a retry, not on every request.
- The tested US run populated 25 output fields. The mapping keeps the original field names and adds `apply_url`, `job_reference`, `consultant`, `sub_sector`, `company_type`, and `source_domain`.

## Candidate matrix

| Candidate | Status | Body marker | Fields | Pagination | Decision |
|---|---|---|---|---|---|
| `/jobs?search=` HTML | 200 after 302 | `li.views-row`, `div.job-tile` | listing fields | `page=N` | Selected |
| `/jobs/<keyword>` HTML | 200 | same | same | `page=N` | Used as fallback when query form returns no rows |
| `/job-detail/...` JSON-LD | 200 | `JobPosting` | rich structured fields | n/a | Selected for detail |
| `/job-detail/...` HTML | 200 | `job-apply-job-title` | description, sector, consultant, apply link | n/a | Fallback and extra fields |
| `/jsonapi` | 403 | `Permission denied` | none | n/a | Rejected |
| `?_format=json` | 406 | format error | none | n/a | Rejected |
| `/views/ajax` | 404 | error page | none | n/a | Rejected |
| `/jobs/rss.xml` | 404 | error page | none | n/a | Rejected |
| `/mp-search-autocomplete/search` | 200 | JSON suggestions | suggestions only | n/a | Rejected (no jobs) |
| Mobile app endpoint | not found | n/a | n/a | n/a | Rejected |

## Browser profile matrix

Tested with `impit` 0.14.7 against `https://www.michaelpage.com/jobs/project-manager` and a US detail page.

| Profile | Listing | Detail | Notes |
|---|---|---|---|
| `chrome` | 200, 30 rows | 200, `JobPosting` | Works |
| `chrome151`, `chrome142`, `chrome136`, `chrome131`, `chrome124` | 200, 30 rows | 200, `JobPosting` | Work |
| `firefox`, `firefox144`, `firefox135` | 200, 30 rows | 200, `JobPosting` | Work; listing is one byte shorter |
| `ios18` | 200, 30 rows | 200, `JobPosting` | Works; same desktop markup |
| `okhttp5`, `okhttp4` | 200, 30 rows | 200, `JobPosting` | Works; mobile page is 432 KB instead of 135 KB, same job tiles |

All profiles return the same job tiles. Mobile and Android profiles do not expose a separate data source. The actor therefore rotates `chrome151`, `chrome142`, `firefox144`, `ios18`, and `okhttp5` only as a recovery mechanism when a request is blocked.

## Market domains

Working on 2026-10-22 (listing returned 200 and job tiles):

```
www.michaelpage.com
www.michaelpage.co.uk
www.michaelpage.fr
www.michaelpage.de
www.michaelpage.es
www.michaelpage.it
www.michaelpage.nl
www.michaelpage.ch
www.michaelpage.be
www.michaelpage.at
www.michaelpage.ie
www.michaelpage.pt
www.michaelpage.ae
www.michaelpage.com.au
www.michaelpage.ca
www.michaelpage.com.sg
www.michaelpage.com.hk
www.michaelpage.com.cn
www.michaelpage.co.jp
www.michaelpage.com.mx
www.michaelpage.com.br
```

`www.michaelpage.co.nz` returns `403` with this page text: "Our office in Auckland, New Zealand is now closed." It is excluded from the domain list.

## Request pitfalls found during discovery

1. **Redirects are not followed by the HTTP client.** A search request returns `302` with both a `Location` header and a meta-refresh body. The actor follows both, up to five hops.
2. **Bursts trigger a Cloudflare challenge.** After roughly 20 rapid requests, the site returned `429` with the title "Just a moment...". The actor paces request starts, backs off on `429`, rotates the profile, and rotates the proxy session when a proxy is configured.
3. **Response headers are an array of pairs.** `response.headers.get()` is not always available. The header helper handles `Headers`, arrays of pairs, and plain objects.
4. **JSON-LD is not strict JSON.** The description contains raw newlines. The parser escapes control characters inside strings before a second parse attempt.
5. **Chinese and French listings use 20 rows per page.** Stop conditions must use the observed row count, not a hardcoded 30.

## Cloud test results

Tested on 2026-10-22 and 2026-10-23 with 200 US jobs for `project manager` on the Apify platform, build 1.0.6.

| Mode | Status | Items | Duration | Compute units | Challenges | Detail failures |
|---|---|---|---|---|---|---|
| No proxy | Succeeded | 200 | 403 s | 0.448 | 12 | 0 |
| Datacenter, 8 sessions, 16 concurrency, US | Succeeded | 200 | 46 s | 0.051 | 2 | 0 |
| Datacenter, 5 sessions, 10 concurrency, auto US | Succeeded | 200 | 57 to 90 s | 0.063 to 0.100 | 0 to 4 | 0 |
| Datacenter, 4 sessions, 10 concurrency | Succeeded | 200 | 60 to 257 s | 0.066 to 0.286 | 0 to 8 | 0 |
| Residential, 4 sessions, 10 concurrency | Succeeded | 200 | 61 s | 0.067 | 2 | 0 |

- Default settings (`maxConcurrency` 10, `useApifyProxy: true`) finished 200 jobs in 57 to 90 seconds. A few occasional challenges were recovered without losing a job.
- Datacenter latency varies with the assigned proxy IP. Eight sessions with 16 concurrency gave the best result at 46 seconds.
- The residential run used 0.0045 GB for 200 jobs and finished in about one minute.
- The no-proxy run completed, but the site throttled repeated requests and the run took nearly seven minutes.
- The earlier 271 s datacenter result came from an invalid proxy session ID. Apify rejected the ID, the client fell back to the direct IP, and the run hit the same `429` throttling as no proxy. The session ID now uses only allowed characters, and a failed proxy session is treated as an error instead of silently falling back to direct.
- The actor pins Apify Proxy to the market country automatically unless the caller supplied a country.
- The actor opens up to eight proxy sessions, paces each session separately, fetches listing pages in parallel when a proxy is present, and runs a slower second pass for failed detail pages.
- The default is an Apify datacenter proxy. Residential works but is not required. No proxy is fine for small runs or when `includeJobDetails` is false.

## Speed strategy

No hidden JSON API exists. The speed gains come from the request pattern:

1. One search request returns 30 jobs on most markets; France and China return 20.
2. Up to eight proxy sessions spread detail requests across separate IPs.
3. Listing pages 1 to N are fetched in parallel when a proxy is present.
4. Detail requests run with the configured `maxConcurrency` (default 10, up to 20). Use 12 to 16 for large proxy runs.
5. Failed detail pages are retried once with lower concurrency and fresh sessions before the actor falls back to listing fields.

`includeJobDetails: false` skips the per-job requests entirely and returns listing fields only.

## Output mapping

| Output field | Source |
|---|---|
| `title` | Tile title, then JSON-LD title, then HTML title |
| `company` | JSON-LD `hiringOrganization.name` |
| `location` | JSON-LD address, then tile location |
| `salary` | Tile salary, then HTML `.job-salary` |
| `job_type` | Tile contract type, then HTML contract type, then `employmentType` |
| `job_nature` | Tile `.job-nature` |
| `company_type` | Tile `.job-company-type` |
| `sector` | `#summary` Sector |
| `sub_sector` | `#summary` Sub Sector |
| `industry` | JSON-LD `industry`, then summary Industry |
| `date_posted` | JSON-LD `datePosted` |
| `description_html` / `description_text` | JSON-LD `description`, then the four `job_advert__job-desc-*` blocks |
| `url` | Canonical job-detail URL |
| `apply_url` | `.apply-link` / `/job-apply/` link |
| `consultant` | `.job-contact-info` or summary Consultant name |
| `job_reference` | Summary Job Reference, then contact block, then URL ref |
| `base_salary` | JSON-LD `baseSalary` normalized |
| Remaining structured fields | JSON-LD keys, passed through with the original names |

## Failure playbook

When the actor starts failing, read this file first, then inspect the failing request:

1. **302 / redirect page**: confirm the client follows `Location` and the meta-refresh body.
2. **403 / 429 / "Just a moment"**: the request was challenged. Check the profile, proxy session, and pacing. The actor retries, rotates the profile, and rotates the proxy session.
3. **200 with no `views-row`**: the search page layout changed. Check `extractListingJobs` tile and anchor fallbacks.
4. **200 with no `JobPosting`**: the detail page changed. Check the HTML fallback classes before changing the JSON-LD parser.
5. **A market returns 403 with an office-closure message**: remove that market from the domain list; do not retry it.
6. **Redirect loop**: the site may route a query to a path that redirects back. The redirect helper caps hops and stops on a repeated URL.

## Resilience and recovery

- Every request gets five attempts with exponential backoff (2 s to 30 s, jittered) and `Retry-After` support. Session pacing reads the current slot state, so concurrent requests queue instead of bursting.
- Minimum pacing is 500 ms per proxy session and 900 ms on a direct connection. Successful requests speed up gradually; `403`, `429`, and `5xx` slow the session down.
- When the first listing pass returns nothing and the failure looks transient, the actor pauses 30 s, rotates every session, and retries both search candidates.
- If the automatically pinned country pool is rejected (for example HTTP 407 from the proxy), the retry loop stops early and the actor retries with the default Apify Proxy pool before changing anything else.
- If the proxy is still blocked, the actor drops the proxy, collapses to one direct session, and retries once. Proxy creation failures also fall back to direct with a warning instead of ending the run.
- Non-retryable responses such as `404` or `410` fail fast; only `403`, `408`, `425`, `429`, `5xx`, and network errors consume retry attempts.
- A failed listing page no longer stops pagination. The page is skipped, and pagination stops only after two consecutive page failures.
- A run that still cannot reach the site after recovery logs a warning and finishes successfully with zero items. A `200` page with no job rows (a real layout change) is still reported as an error.
- Detail pages that still fail after the second pass are saved with listing fields, so one blocked job never ends the run.

Any change to selectors, endpoints, or header handling must be reflected in this file.
