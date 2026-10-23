## What does Michael Page Jobs Scraper do?

Michael Page Jobs Scraper collects live job listings from Michael Page market sites and returns structured records with titles, locations, salaries, contract types, sectors, full descriptions, and application links. Search by keyword and location, start from a prepared search URL, or choose one of 21 country sites. The result is a clean dataset ready for hiring research, salary checks, and job alert workflows.

## Why use Michael Page Jobs Scraper?

- **One dataset for 21 markets** - Search the United States, United Kingdom, France, Germany, and 17 other Michael Page markets without changing tools.
- **Full job detail** - Each record can include the complete description, salary range, sector, sub sector, consultant name, and job reference.
- **Search control** - Use a keyword, a location, a prepared search URL, or a whole market. The Actor follows the mode you choose.
- **Reliable collection** - Requests are paced and retried, so a short block does not end the run.
- **Partial progress is kept** - Results are saved in batches as the run proceeds.
- **Automation ready** - Export to JSON, CSV, Excel, or XML, or send results to Sheets, webhooks, Make, or Zapier.

## What data can you extract from Michael Page?

| Field | Description |
|-------|-------------|
| `title` | Job title |
| `company` | Hiring organization |
| `location` | Job location, including region and country when published |
| `salary` | Salary text from the listing, for example `USD90,000 - USD140,000 per year` |
| `base_salary` | Structured salary with currency, minimum, maximum, and pay period |
| `job_type` | Contract type such as Permanent, CDI, or Festanstellung |
| `job_nature` | Work arrangement when the market publishes it, such as Home Office |
| `company_type` | Company type when the market publishes it |
| `sector` | Michael Page sector |
| `sub_sector` | Michael Page sub sector |
| `industry` | Industry label from the job record |
| `date_posted` | Posting date |
| `description_html` | Full description as HTML |
| `description_text` | Full description as plain text |
| `summary` | Short summary from the search result |
| `bullet_points` | Highlight bullets from the search result |
| `consultant` | Consultant name when published |
| `job_reference` | Michael Page job reference, for example `JN-102026-7132007` |
| `url` | Direct job page |
| `apply_url` | Direct application link |
| `employment_type` | Structured employment type, for example `FULL_TIME` |
| `job_location` | Structured location object |
| `hiring_organization` | Structured company object |
| `source_domain` | Market site that supplied the record |
| `scrapedAt` | Collection timestamp |

## How to use Michael Page Jobs Scraper

1. Open the Actor on Apify Store.
2. Enter a keyword, a location, or a prepared Michael Page search URL.
3. Choose a country site if you do not want the United States.
4. Set the result limit and page cap.
5. Run the Actor and download the dataset or connect it to a workflow.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | - | A Michael Page search URL. Takes precedence over keyword, location, and market |
| `keyword` | String | No | `project manager` | Search term such as `data analyst` or `operations manager` |
| `location` | String | No | - | City, region, or postal code used to narrow the search |
| `domain` | String | No | `www.michaelpage.com` | Country site to search |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to save |
| `max_pages` | Integer | No | `10` | Maximum number of search pages to read |
| `maxConcurrency` | Integer | No | `10` | Parallel job-detail requests, from 1 to 20 |
| `includeJobDetails` | Boolean | No | `true` | Read each job page for the full description and extra fields |
| `proxyConfiguration` | Object | No | Apify datacenter | Apify datacenter proxy, residential proxy, custom proxies, or no proxy |

### Supported country sites

United States, United Kingdom, France, Germany, Spain, Italy, Netherlands, Switzerland, Belgium, Austria, Ireland, Portugal, United Arab Emirates, Australia, Canada, Singapore, Hong Kong, China, Japan, Mexico, and Brazil.

## Output Data

Each item keeps the source field names. Empty values are omitted.

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Job title |
| `company` | String | Hiring organization |
| `location` | String | Job location |
| `salary` | String | Salary text |
| `job_type` | String | Contract type |
| `sector` | String | Sector |
| `sub_sector` | String | Sub sector |
| `industry` | String | Industry |
| `date_posted` | String | Posting date |
| `description_html` | String | Description HTML |
| `description_text` | String | Description text |
| `url` | String | Job page URL |
| `apply_url` | String | Application URL |
| `job_reference` | String | Michael Page reference |
| `consultant` | String | Consultant name |
| `base_salary` | Object | Structured salary |
| `job_location` | Object | Structured location |
| `summary` | String | Search result summary |
| `bullet_points` | Array | Search result highlights |
| `source_domain` | String | Market site |
| `scrapedAt` | String | Collection timestamp |

## Usage Examples

### Basic keyword search

Collect 50 project manager jobs from the United States:

```json
{
  "keyword": "project manager",
  "results_wanted": 50
}
```

### Keyword and location

Collect finance jobs in Texas:

```json
{
  "keyword": "finance manager",
  "location": "Texas",
  "results_wanted": 40,
  "max_pages": 3
}
```

### Search a different market

Collect operations manager jobs from the United Kingdom:

```json
{
  "keyword": "operations manager",
  "domain": "www.michaelpage.co.uk",
  "results_wanted": 60,
  "max_pages": 4
}
```

### Start from a prepared search URL

Use a saved Michael Page search page:

```json
{
  "startUrl": "https://www.michaelpage.com/jobs?search=data+analyst&location=California",
  "results_wanted": 75,
  "max_pages": 5
}
```

## Sample Output

```json
{
  "title": "Project Manager",
  "company": "Michael Page",
  "location": "Branford, Connecticut, US",
  "salary": "USD90,000 - USD140,000 per year",
  "job_type": "Permanent",
  "sector": "Construction",
  "sub_sector": "Project Manager",
  "industry": "Construction",
  "date_posted": "2026-10-22",
  "description_html": "<p>Manage multiple civil and sitework construction projects from preconstruction through closeout.</p>",
  "description_text": "Manage multiple civil and sitework construction projects from preconstruction through closeout.",
  "url": "https://www.michaelpage.com/job-detail/project-manager/ref/jn-102026-7132007",
  "apply_url": "https://www.michaelpage.com/job-apply/project-manager/ref/jn-102026-7132007",
  "job_reference": "JN-102026-7132007",
  "consultant": "Rick Mancini",
  "base_salary": {
    "currency": "USD",
    "unitText": "YEAR",
    "minValue": "90000",
    "maxValue": "140000"
  },
  "employment_type": "FULL_TIME",
  "summary": "This is an excellent opportunity for a construction professional looking to manage multiple high-impact projects.",
  "bullet_points": [
    "Growth Potential",
    "Excellent backlog of work"
  ],
  "source_domain": "www.michaelpage.com",
  "scrapedAt": "2026-10-22T15:55:00.000Z"
}
```

## Tips for Best Results

- Start with 20 to 50 results to confirm the search before scaling up.
- Use specific role names instead of broad terms to improve relevance.
- Keep `max_pages` aligned with the number of results you want. Most markets show 30 jobs per page; France and China show 20.
- Leave the country site on United States unless you need local listings from another market.
- If a market publishes no salary, the salary fields stay empty. That reflects the source page, not a failed run.
- Schedule repeat runs to track new openings and removed roles.
- For a fast listing-only run, set `includeJobDetails` to false. You get titles, locations, salaries, contract types, summaries, and job links without opening each job page.
- For large detail runs, use a proxy and raise `maxConcurrency` to 12 or 16. The Actor opens several proxy sessions and fetches listing pages in parallel.

### Proxy guidance

Apify datacenter proxy is enabled by default. It avoids the site throttling that direct requests receive and keeps large runs fast.

In a 200-job test, datacenter with 16 concurrency finished in 46 seconds. With the default settings, the same run finished in 57 to 90 seconds. Residential finished in about one minute. No proxy took 4 to 7 minutes.

The Actor pins Apify Proxy to the market country automatically when you do not set one. For example, `www.michaelpage.com` uses US proxies and `www.michaelpage.co.uk` uses GB proxies.

- Datacenter proxy: the default. Recommended for large or repeated detail runs.
- Residential proxy: works and uses residential bandwidth. Use it when datacenter proxies are blocked or when you need a different network identity.
- No proxy: clear the proxy configuration for small or occasional runs, or when `includeJobDetails` is false.

## Integrations

- **Google Sheets** - Build shared hiring trackers and salary tables.
- **Webhooks** - Send new roles to an internal job board or alerting service.
- **Make or Zapier** - Route records to CRM, ATS, or messaging tools.
- **Apify API** - Pull datasets into your own applications and dashboards.
- **CSV, Excel, JSON, XML** - Download results in the format your team uses.

## Frequently Asked Questions

### Can I scrape jobs from more than one country?

Yes. Choose a country site from the `domain` field. The Actor supports 21 Michael Page markets.

### Can I search by city or region?

Yes. Add a value to `location`, for example `New York`, `Texas`, or `London`.

### Does the Actor open each job page?

Yes. It reads the search results first, then collects the full description and structured details from each job page.

### Why is a salary field missing?

Some employers do not publish a salary. In that case the salary fields are omitted for that job.

### Can I export the dataset to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats.

### Can I schedule the Actor?

Yes. Use Apify Schedules to run it hourly, daily, weekly, or at another interval.

### What happens if a job page cannot be opened?

The run keeps the search result fields for that job and continues with the rest. A warning appears in the run log.

### Can I use a prepared Michael Page URL?

Yes. Put the search URL in `startUrl`. It overrides the keyword, location, and market fields.

## Support

For issues or feature requests, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor collects data from publicly available Michael Page job pages. Users are responsible for complying with applicable laws, website terms, and privacy rules, and for using the data responsibly.
