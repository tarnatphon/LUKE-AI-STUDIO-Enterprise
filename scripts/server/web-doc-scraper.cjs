const https = require('https');
const http = require('http');

class WebDocScraper {
  static async fetchUrl(urlStr) {
    return new Promise((resolve, reject) => {
      const client = urlStr.startsWith('https') ? https : http;
      client.get(urlStr, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Apple Silicon)' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', err => reject(err));
    });
  }

  static cleanHtmlToMarkdown(html) {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n\s+\n/g, '\n\n')
      .trim();
  }

  static async ingestDocumentation(urlStr) {
    const raw = await this.fetchUrl(urlStr);
    const markdown = this.cleanHtmlToMarkdown(raw);
    return {
      url: urlStr,
      markdown,
      characterCount: markdown.length,
      timestamp: Date.now()
    };
  }
}

module.exports = WebDocScraper;
