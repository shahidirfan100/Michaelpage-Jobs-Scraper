# Michael Page Jobs Scraper

An Apify actor for extracting job listings from Michael Page's career portal. This scraper provides comprehensive job data extraction, supporting targeted searches by keywords and locations, with options for detailed descriptions and pagination handling.

## Features

- **Complete Job Data Extraction**: Captures essential job information including titles, locations, salary ranges, employment types, and detailed descriptions.
- **Advanced Search Capabilities**: Enables precise job searches using keywords and geographic filters for customized results.
- **Multi-Page Scraping**: Seamlessly handles pagination to gather large volumes of job listings across multiple result pages.
- **In-Depth Detail Mode**: Includes functionality to scrape full job descriptions and additional metadata from individual job pages.
- **Clean Data Output**: Delivers structured JSON data, perfect for database integration, analytics, and reporting.
- **Reliable Scraping Infrastructure**: Incorporates proxy support for consistent and efficient data collection.

## Input

The actor requires the following input parameters for operation:

- `keyword` (string): Keywords for job search, such as "marketing manager" or "financial analyst".
- `location` (string): Geographic filter, e.g., "Chicago" or "Los Angeles".
- `results_wanted` (integer): Total jobs to collect, defaults to 100.
- `max_pages` (integer): Maximum pages to scrape, defaults to 20.
- `collectDetails` (boolean): Toggle for fetching detailed job descriptions, defaults to true.
- `proxyConfiguration` (object): Proxy settings for optimal performance.

### Example Input

```json
{
  "keyword": "sales director",
  "location": "Boston",
  "results_wanted": 25,
  "collectDetails": true
}
```

## Output

The actor generates a dataset with job records in JSON format, each containing:

```json
{
  "title": "Sales Director",
  "company": null,
  "location": "Boston, MA",
  "salary": "USD 120,000 - USD 150,000 per year",
  "job_type": "Permanent",
  "date_posted": null,
  "description_html": "<p>Detailed job description...</p>",
  "description_text": "Plain text job description...",
  "url": "https://www.michaelpage.com/job-detail/sales-director/..."
}
```

## Usage

1. **Setup**: Configure input parameters in the Apify platform.
2. **Execution**: Run the actor to initiate scraping.
3. **Retrieval**: Download results as JSON or CSV from the dataset.

### Configuration

- **Proxy Usage**: Recommended for large-scale scraping to ensure reliability.
- **Limits**: Adjust `results_wanted` and `max_pages` based on needs.
- **Detail Level**: Enable `collectDetails` for richer data.

## Cost

- **Free Tier**: Suitable for small-scale extractions.
- **Paid Usage**: Scales with compute and proxy requirements.

## Limits

- **Rate Limits**: Respects website policies; use proxies to manage.
- **Data Volume**: No hard limits, but optimize for efficiency.

## SEO Keywords

- Michael Page jobs scraper
- Job listings extractor
- Recruitment data scraper
- Employment opportunities crawler
- Career site data mining
- Job search automation
- Professional job scraper
- Job market data tool
- Recruitment analytics scraper

## Contributing

Contributions welcome. Follow Apify guidelines for submissions.

## License

Licensed under MIT. Use responsibly and comply with terms of service.