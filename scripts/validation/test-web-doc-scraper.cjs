const WebDocScraper = require('../server/web-doc-scraper.cjs');

const htmlSample = '<html><body><h1>Documentation Title</h1><p>This is a paragraph of local AI docs.</p><code>curl http://localhost:1420</code></body></html>';
const md = WebDocScraper.cleanHtmlToMarkdown(htmlSample);

if (md.includes('# Documentation Title') && md.includes('`curl http://localhost:1420`')) {
  console.log('PASS: Web & Documentation Ingestion Scraper successfully converted HTML to markdown.');
} else {
  console.error('FAIL: Scraper markdown extraction incorrect.');
  process.exit(1);
}
