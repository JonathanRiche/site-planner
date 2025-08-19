import puppeteer from '@cloudflare/puppeteer';
import { env } from 'cloudflare:workers';

export interface PageContent {
  html: string;
  title: string;
  url: string;
  screenshot?: Buffer;
  metadata: {
    viewport: { width: number; height: number };
    loadTime: number;
    timestamp: string;
  };
}

// Simple fallback for development when browser rendering isn't available
async function fetchPageFallback(url: string): Promise<{ html: string; title: string; url: string }> {
  console.log('Using fallback fetch method for:', url);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SitePlanner/1.0; +https://siteplanner.io)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'No title found';

    return { html, title, url };
  } catch (error) {
    console.error('Fallback fetch error:', error);
    throw error;
  }
}

export class CloudflareBrowserService {

  async renderPage(url: string, options: {
    takeScreenshot?: boolean;
    viewport?: { width: number; height: number };
    waitFor?: number;
    useCache?: boolean;
  } = {}): Promise<PageContent> {
    const {
      takeScreenshot = false,
      viewport = { width: 1280, height: 720 },
      waitFor = 2000,
      useCache = true,
    } = options;

    const cacheKey = `page:${url}:${JSON.stringify(options)}`;
    const startTime = Date.now();

    // Check cache first if enabled
    if (useCache && env.SITE_ANALYSIS_CACHE) {
      try {
        const cached = await env.SITE_ANALYSIS_CACHE.get(cacheKey);
        if (cached) {
          console.log('Cache hit for:', url);
          return JSON.parse(cached);
        }
      } catch (error) {
        console.warn('Cache read error:', error);
      }
    }

    console.log('Launching browser for:', url);
    
    try {
      // Check if browser binding is available
      if (!env.MYBROWSER) {
        console.warn('MYBROWSER binding not available, using fallback fetch method');
        
        // Use simple fetch fallback for development
        const fallbackResult = await fetchPageFallback(url);
        const loadTime = Date.now() - startTime;
        
        return {
          html: fallbackResult.html,
          title: fallbackResult.title,
          url: fallbackResult.url,
          metadata: {
            viewport,
            loadTime,
            timestamp: new Date().toISOString(),
          },
        };
      }
      
      // Launch browser with Cloudflare's Puppeteer
      const browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();

      // Set viewport
      await page.setViewport(viewport);

      // Set user agent to appear as regular browser
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Navigate to the page
      console.log('Navigating to:', url);
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Wait for additional content to load
      if (waitFor > 0) {
        await new Promise(resolve => setTimeout(resolve, waitFor));
      }

      // Extract page content
      const [html, title] = await Promise.all([
        page.content(),
        page.title().catch(() => 'No title found')
      ]);

      let screenshot: Buffer | undefined;
      if (takeScreenshot) {
        screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 85,
          fullPage: false, // Just viewport for performance
        }) as Buffer;
      }

      await browser.close();

      const loadTime = Date.now() - startTime;
      const result: PageContent = {
        html,
        title,
        url,
        screenshot,
        metadata: {
          viewport,
          loadTime,
          timestamp: new Date().toISOString(),
        },
      };

      // Cache the result if enabled
      if (useCache && env.SITE_ANALYSIS_CACHE) {
        try {
          await env.SITE_ANALYSIS_CACHE.put(
            cacheKey,
            JSON.stringify(result),
            {
              expirationTtl: 60 * 60 * 24, // 24 hours
            }
          );
          console.log('Cached result for:', url);
        } catch (error) {
          console.warn('Cache write error:', error);
        }
      }

      return result;
    } catch (error) {
      console.error('Browser rendering error for', url, ':', error);
      throw new Error(`Failed to render page: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async takeScreenshot(url: string, options: {
    viewport?: { width: number; height: number };
    fullPage?: boolean;
    quality?: number;
  } = {}): Promise<Buffer> {
    const {
      viewport = { width: 1280, height: 720 },
      fullPage = false,
      quality = 85,
    } = options;

    console.log('Taking screenshot for:', url);
    
    try {
      const browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();

      await page.setViewport(viewport);
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Wait for page to fully load
      await new Promise(resolve => setTimeout(resolve, 2000));

      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality,
        fullPage,
      }) as Buffer;

      await browser.close();
      return screenshot;
    } catch (error) {
      console.error('Screenshot error for', url, ':', error);
      throw new Error(`Failed to take screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async extractStructuredData(url: string, selectors: Record<string, string>): Promise<Record<string, any>> {
    console.log('Extracting structured data for:', url);
    
    try {
      const browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();

      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Extract data using provided selectors
      const data: Record<string, any> = {};
      
      for (const [key, selector] of Object.entries(selectors)) {
        try {
          const element = await page.$(selector);
          if (element) {
            data[key] = await element.evaluate((el) => el.textContent?.trim() || '');
          } else {
            data[key] = null;
          }
        } catch (error) {
          console.warn(`Failed to extract ${key} with selector ${selector}:`, error);
          data[key] = null;
        }
      }

      await browser.close();
      return data;
    } catch (error) {
      console.error('Data extraction error for', url, ':', error);
      throw new Error(`Failed to extract data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}