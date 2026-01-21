# Michael Page Jobs Scraper

Extract comprehensive job listings from Michael Page with ease. Collect job titles, salaries, locations, company details, and full job descriptions at scale. Perfect for recruitment research, market analysis, and talent intelligence.

## Features

- **Complete Job Data** — Extract titles, companies, salaries, locations, job types, sectors, and industries
- **Smart Search** — Filter jobs by keyword and location to find exactly what you need
- **Automatic Pagination** — Seamlessly handles multiple pages to reach your desired result count
- **Full Descriptions** — Optional detailed job descriptions in both HTML and plain text formats
- **Fast & Reliable** — Optimized extraction with built-in error handling and retry mechanisms
- **Export Ready** — Download results in JSON, CSV, or Excel for immediate use

## Use Cases

### Recruitment Intelligence
Build comprehensive talent pipelines by monitoring job openings across industries and locations. Track hiring trends, identify in-demand skills, and discover competitive salary ranges to inform recruitment strategies.

### Market Research
Analyze employment market trends, skill requirements, and salary benchmarks across different sectors. Understand which companies are hiring, what roles are in demand, and how compensation packages compare.

### Competitive Analysis
Monitor competitor hiring patterns and job postings to identify business expansion, new initiatives, and organizational changes. Stay ahead by understanding market movements and talent acquisition strategies.

### Career Planning
Research available opportunities, salary expectations, and required qualifications for specific roles. Make informed career decisions based on real-time job market data and industry trends.

### Data Analytics
Build datasets for business intelligence, workforce planning, and economic research. Analyze hiring patterns, geographic distribution of opportunities, and industry-specific employment trends.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keyword` | String | No | `""` | Job search keyword (e.g., "project manager", "software engineer") |
| `location` | String | No | `""` | Location filter (e.g., "New York", "London", "Remote") |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to collect |
| `max_pages` | Integer | No | `10` | Safety cap on number of search result pages to visit |
| `collectDetails` | Boolean | No | `true` | Whether to fetch full job descriptions from detail pages |
| `startUrl` | String | No | — | Custom Michael Page search URL (overrides keyword/location) |
| `proxyConfiguration` | Object | No | Residential | Apify Proxy configuration for reliable scraping |

---

## Output Data

Each job listing in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Job title or position name |
| `company` | String | Hiring company or organization name |
| `location` | String | Job location (city, state, country) |
| `salary` | String | Salary range or compensation details |
| `job_type` | String | Employment type (Permanent, Contract, Temporary, etc.) |
| `job_nature` | String | Job nature classification |
| `sector` | String | Industry sector |
| `industry` | String | Specific industry category |
| `date_posted` | String | Job posting date |
| `description_html` | String | Full job description with HTML formatting |
| `description_text` | String | Plain text version of job description |
| `url` | String | Direct link to the job posting |
| `scrapedAt` | String | Timestamp when data was extracted |

---

## Usage Examples

### Basic Job Search

Search for project manager positions:

```json
{
  "keyword": "project manager",
  "results_wanted": 50
}
```

### Location-Based Search

Find software engineering jobs in a specific location:

```json
{
  "keyword": "software engineer",
  "location": "New York",
  "results_wanted": 100,
  "collectDetails": true
}
```

### Quick URL Collection

Collect job URLs without fetching full descriptions for faster scraping:

```json
{
  "keyword": "data analyst",
  "location": "London",
  "results_wanted": 200,
  "collectDetails": false
}
```

### Custom Search URL

Start from a specific Michael Page search URL:

```json
{
  "startUrl": "https://www.michaelpage.com/jobs?search=marketing+manager&location=California",
  "results_wanted": 75
}
```

---

## Sample Output

```json
{
  "title": "Senior Project Manager - Infrastructure",
  "company": "Global Construction Group",
  "location": "New York, NY, United States",
  "salary": "$120,000 - $150,000",
  "job_type": "Permanent",
  "job_nature": "Full-time",
  "sector": "Construction & Property",
  "industry": "Infrastructure",
  "date_posted": "2026-01-15",
  "description_html": "<h2>About the Role</h2><p>Leading infrastructure projects...</p>",
  "description_text": "About the Role: Leading infrastructure projects for major clients...",
  "url": "https://www.michaelpage.com/job-detail/senior-project-manager-infrastructure/ref/jn-012026-123456",
  "scrapedAt": "2026-01-21T12:00:00.000Z"
}
```

---

## Tips for Best Results

### Optimize Your Search Parameters
- Start with broad keywords for comprehensive results
- Use specific job titles for targeted searches
- Combine keyword and location for regional insights
- Test with smaller `results_wanted` values first

### Choose the Right Collection Mode
- Enable `collectDetails` for complete job information
- Disable `collectDetails` for faster URL collection
- Balance speed vs. data completeness based on your needs
- Use pagination limits (`max_pages`) to control run time

### Proxy Configuration

For reliable results, residential proxies are recommended:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Performance Optimization
- Set realistic `results_wanted` based on available jobs
- Use `max_pages` to prevent excessively long runs
- Start small (20-50 results) for testing
- Scale up for production data collection

---

## Integrations

Connect your extracted job data with:

- **Google Sheets** — Export for analysis and team collaboration
- **Airtable** — Build searchable recruitment databases
- **Slack** — Get notifications for new job postings
- **Webhooks** — Send data to custom endpoints and APIs
- **Make** — Create automated recruitment workflows
- **Zapier** — Trigger actions based on new jobs

### Export Formats

Download your data in multiple formats:

- **JSON** — For developers and API integrations
- **CSV** — For spreadsheet analysis and Excel
- **Excel** — For business reporting and presentations
- **XML** — For system integrations and data pipelines

---

## Frequently Asked Questions

### How many jobs can I collect?
You can collect all available job listings. Set `results_wanted` to your desired number, or leave it at the default of 20 for testing. The practical limit depends on search results available on Michael Page.

### Does it handle pagination automatically?
Yes, the scraper automatically navigates through multiple pages until it reaches your `results_wanted` target or runs out of available jobs.

### What if some fields are empty?
Some fields like `salary` or `company` may be null if that information isn't provided in the job listing. The scraper extracts all available data from each posting.

### Can I scrape jobs from a specific region?
Yes, use the `location` parameter to filter jobs by city, state, or country. You can also provide a custom `startUrl` with specific location filters.

### How fast is the scraper?
With `collectDetails` enabled, expect approximately 20-30 jobs per minute. Without detailed descriptions, the scraper is significantly faster, collecting 50-100 URLs per minute.

### What are the costs?
Typical costs are 1-2 Apify Compute Units per 100 jobs with full details, and approximately 0.5 CU per 100 jobs for URL-only collection.

### Can I schedule regular runs?
Yes, use Apify's scheduling feature to run the scraper daily, weekly, or at any interval to monitor new job postings automatically.

### What about rate limiting?
The scraper uses Apify's proxy rotation and implements reasonable request delays to respect website rate limits and ensure reliable data collection.

### Do I need proxies?
Yes, proxies are highly recommended. The scraper defaults to Apify's residential proxies for best results and to avoid blocking.

### Can I export to my ATS or CRM?
Yes, use Apify's integration features or webhooks to send data directly to your Applicant Tracking System, CRM, or any other platform via API.

---

## Support

For issues, feature requests, or questions, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)
- [Integrations Guide](https://docs.apify.com/integrations)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with Michael Page's terms of service and applicable laws. Respect rate limits, use data responsibly, and ensure your use case aligns with legal and ethical standards.