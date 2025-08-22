import { CloudflareBrowserService } from '../src/lib/browser-service';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: bun scripts/test-render.ts <url>');
    process.exit(1);
  }

  const service = new CloudflareBrowserService();
  const startedAt = Date.now();
  try {
    const page = await service.renderPage(url, { takeScreenshot: false, useCache: false });
    const ms = Date.now() - startedAt;
    console.log('Render completed:', { url: page.url, title: page.title, htmlLength: page.html.length, timeMs: ms });
    const lower = page.html.toLowerCase();
    const blocked = /(attention required.*cloudflare|sorry, you have been blocked|access denied|forbidden|captcha|security check|bot detection|rate limit)/i.test(lower) || /attention required/i.test(page.title.toLowerCase());
    console.log('Blocked content likely?:', blocked);
    console.log('HTML preview:', page.html.substring(0, 400).replace(/\n/g, ' '));
  } catch (err) {
    console.error('Render failed:', err);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
