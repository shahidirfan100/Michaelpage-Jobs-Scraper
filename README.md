# Michael Page Jobs Scraper

Extract job listings from Michael Page at scale with fast pagination and rich detail extraction. Collect titles, locations, salaries, full job descriptions, and structured job metadata for analysis and monitoring.

## Features

- **Targeted job search** — Filter by keyword and location for precise collection
- **Configurable volume** — Control total jobs with `results_wanted` and crawl scope with `max_pages`
- **Rich detail extraction** — Opens job pages to capture `description_html`, `description_text`, and structured fields
- **Incremental batched saving** — Pushes dataset items in batches during the run
- **Clean output format** — Null and undefined values are removed before data is saved
- **Automation-ready data** — Export to JSON, CSV, Excel, or connect to downstream tools

## Use Cases

### Recruitment Intelligence
Track open roles across regions and functions to identify hiring demand. Build talent market snapshots with location, compensation, and role-level signals.

### Salary and Role Benchmarking
Collect compensation and job type data to compare hiring packages across markets. Support planning with current role requirements and demand trends.

### Competitive Hiring Monitoring
Monitor postings from target business areas to detect expansion patterns. Spot new hiring waves and strategic role openings quickly.

### Workforce and Economic Research
Build repeatable datasets for labor market studies and internal analytics. Analyze changes in role demand, skill mentions, and geography over time.

### Lead and Opportunity Discovery
Find relevant openings for staffing, consulting, and business development workflows. Route fresh job data into CRM, outreach, or alerting pipelines.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Start from a specific Michael Page search URL |
| `keyword` | String | No | `""` | Search keyword, for example `project manager` |
| `location` | String | No | `""` | Location filter, for example `New York` |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to save |
| `max_pages` | Integer | No | `10` | Maximum listing pages to process |
| `proxyConfiguration` | Object | No | Apify Residential | Proxy settings for reliable collection |

---

## Output Data

Each dataset item omits fields with `null` or `undefined` values.

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Job title |
| `company` | String | Hiring organization name |
| `location` | String | Job location |
| `salary` | String | Salary text or range |
| `job_type` | String | Employment type label |
| `industry` | String | Industry category |
| `date_posted` | String | Posting date |
| `description_html` | String | Full description in HTML |
| `description_text` | String | Plain text description |
| `url` | String | Direct job URL |
| `scrapedAt` | String | Extraction timestamp |
| `listing_job_id` | String | Listing-level job identifier |
| `job_id` | String | Identifier from job metadata |
| `employment_type` | String/Array | Employment type from structured data |
| `base_salary` | Object/String | Structured salary information |
| `hiring_organization` | Object | Structured company details |
| `summary` | String | Listing summary text |
| `bullet_points` | Array | Listing bullet points |

---

## Usage Examples

### Basic Job Search

Collect 50 project manager jobs:

```json
{
  "keyword": "project manager",
  "results_wanted": 50
}
```

### Keyword + Location Search

Collect software engineering jobs in New York:

```json
{
  "keyword": "software engineer",
  "location": "New York",
  "results_wanted": 100,
  "max_pages": 20
}
```

### Start From a Custom Search URL

Use a prepared Michael Page search page:

```json
{
  "startUrl": "https://www.michaelpage.com/jobs?search=data+analyst&location=California",
  "results_wanted": 75
}
```

---

## Sample Output

```json
{
  "title": "Quality Manager - USDA Food Manufacturer",
  "company": "Michael Page",
  "location": "Vernon, California",
  "salary": "USD110,000 - USD140,000 per year",
  "job_type": "Permanent",
  "industry": "Engineering & Manufacturing",
  "date_posted": "2026-02-17",
  "description_html": "<p>...</p>",
  "description_text": "Potential for Growth and Advancement ...",
  "summary": "The Quality Manager will oversee quality assurance processes ...",
  "bullet_points": [
    "Potential for Growth and Advancement",
    "Fast Paced, Exciting Work Environment"
  ],
  "url": "https://www.michaelpage.com/job-detail/quality-manager/ref/jn-022026-6950214",
  "scrapedAt": "2026-02-18T07:20:59.304Z",
  "listing_job_id": "6130071",
  "employment_type": "FULL_TIME"
}
```

---

## Tips for Best Results

### Start Small, Then Scale
- Begin with `results_wanted` between 20 and 50 during setup
- Increase volume after validating your target query patterns
- Use focused keywords to improve relevance

### Improve Result Quality
- Combine `keyword` and `location` for cleaner matching
- Use specific role names instead of broad terms when possible

### Keep Runs Reliable
- Keep `max_pages` aligned with realistic result volume
- Use proxy configuration for stable large runs
- Schedule periodic runs to monitor fresh openings

---

## Integrations

Connect output data with:

- **Google Sheets** — Build shared tracking and reporting views
- **Airtable** — Create searchable recruitment datasets
- **Slack** — Send run notifications and job alerts
- **Webhooks** — Push records to custom APIs and services
- **Make** — Automate data routing workflows
- **Zapier** — Trigger actions from new dataset items

### Export Formats

- **JSON** — API and engineering workflows
- **CSV** — Spreadsheet analysis
- **Excel** — Business reporting
- **XML** — Legacy and system integrations

---

## Frequently Asked Questions

### How many jobs can I collect?
Set `results_wanted` to your target count. Actual output depends on available listings for your query.

### Does it support pagination?
Yes. The actor automatically continues through results pages until limits are reached.

### Why are some fields missing in an item?
Fields with `null` or `undefined` values are omitted. If a source value is not provided, that field will not appear in the item.

### Can I run location-specific searches?
Yes. Use the `location` input or pass a pre-filtered `startUrl`.

### Does it open each job detail page?
Yes. It visits detail pages to enrich each result with full description and additional structured metadata.

### Can I schedule recurring runs?
Yes. Use Apify schedules to run daily, weekly, or on custom intervals.

### Where can I use the output?
You can export directly or connect to analytics, ATS, CRM, or automation tools.

---

## Support

For issues or feature requests, use support channels in the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Schedules](https://docs.apify.com/platform/schedules)
- [Apify Integrations](https://docs.apify.com/platform/integrations)

---

## Legal Notice

This actor is intended for legitimate data collection use cases. You are responsible for compliance with applicable laws and the target website terms. Use data responsibly.
