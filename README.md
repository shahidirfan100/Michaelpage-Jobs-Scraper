# Michael Page Jobs Scraper

An Apify actor for extracting job listings from Michael Page's career portal. This production-ready scraper provides comprehensive job data extraction with stealth measures for reliable scraping.

## Features

- **Smart Data Extraction**: Prioritizes JSON-LD structured data with HTML parsing fallback
- **Advanced Search**: Filter jobs by keywords and locations
- **Automatic Pagination**: Seamlessly handles multi-page results
- **Stealth Mode**: Session management, proxy rotation, and realistic headers
- **Production Ready**: Robust error handling and retry mechanisms

## Input

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `keyword` | string | - | Job search keywords (e.g., "Project Manager") |
| `location` | string | - | Location filter (e.g., "New York") |
| `results_wanted` | integer | 100 | Maximum jobs to collect |
| `max_pages` | integer | 20 | Maximum pages to scrape |
| `collectDetails` | boolean | true | Fetch full job descriptions |
| `startUrl` | string | - | Custom start URL (overrides filters) |
| `proxyConfiguration` | object | Residential | Apify Proxy settings |

### Example Input

```json
{
  "keyword": "software engineer",
  "location": "New York",
  "results_wanted": 50,
  "collectDetails": true
}
```

## Output

Each job record contains:

```json
{
  "title": "Senior Software Engineer",
  "company": null,
  "location": "New York, NY",
  "salary": "$150,000 - $180,000",
  "job_type": "Permanent",
  "date_posted": "2025-12-07",
  "description_html": "<p>Full job description...</p>",
  "description_text": "Plain text description...",
  "url": "https://www.michaelpage.com/job-detail/...",
  "scrapedAt": "2025-12-08T10:00:00.000Z"
}
```

## Usage

1. Configure input parameters on the Apify platform
2. Run the actor
3. Download results as JSON, CSV, or Excel

### Tips

- Use **Residential proxies** for best results
- Start with lower `results_wanted` to test
- Enable `collectDetails` for full job descriptions

## Cost Estimation

- ~1-2 CU per 100 jobs with details
- ~0.5 CU per 100 jobs without details

## Technical Details

- **Runtime**: Node.js 22
- **Framework**: Crawlee CheerioCrawler
- **Proxy**: Apify Residential recommended
- **Data Sources**: JSON-LD (primary), HTML (fallback)

## License

MIT License - Use responsibly and comply with website terms of service.