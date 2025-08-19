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

// Enhanced user agents to rotate through
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function isBlockedContent(html: string, title: string): { isBlocked: boolean; reason?: string } {
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();
  
  // Common bot detection indicators
  const blockIndicators = [
    { pattern: /attention required.*cloudflare/i, reason: 'Cloudflare bot protection' },
    { pattern: /sorry, you have been blocked/i, reason: 'Cloudflare security block' },
    { pattern: /access denied/i, reason: 'Access denied' },
    { pattern: /forbidden/i, reason: 'Forbidden access' },
    { pattern: /captcha/i, reason: 'CAPTCHA challenge' },
    { pattern: /security check/i, reason: 'Security check' },
    { pattern: /bot detection/i, reason: 'Bot detection' },
    { pattern: /rate limit/i, reason: 'Rate limited' },
  ];
  
  for (const indicator of blockIndicators) {
    if (indicator.pattern.test(lowerHtml) || indicator.pattern.test(lowerTitle)) {
      return { isBlocked: true, reason: indicator.reason };
    }
  }
  
  // Check if page content is suspiciously short
  const bodyMatch = html.match(/<body[^>]*>(.*?)<\/body>/is);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const textContent = bodyContent.replace(/<[^>]+>/g, '').trim();
  
  if (textContent.length < 100) {
    return { isBlocked: true, reason: 'Suspiciously short content' };
  }
  
  return { isBlocked: false };
}

// Enhanced fallback for development when browser rendering isn't available
async function fetchPageFallback(url: string, retryCount = 0): Promise<{ html: string; title: string; url: string }> {
  const maxRetries = 3;
  const userAgent = getRandomUserAgent();
  
  console.log(`Using fallback fetch method for: ${url} (attempt ${retryCount + 1})`);
  
  try {
    // Add delay between retries to avoid rate limiting
    if (retryCount > 0) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff up to 10s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'No title found';
    
    // Check if content is blocked
    const blockCheck = isBlockedContent(html, title);
    if (blockCheck.isBlocked) {
      console.warn(`Content blocked: ${blockCheck.reason}`);
      
      // Retry with different user agent if we have retries left
      if (retryCount < maxRetries) {
        console.log(`Retrying with different user agent...`);
        return await fetchPageFallback(url, retryCount + 1);
      }
      
      throw new Error(`Content blocked by bot protection: ${blockCheck.reason}`);
    }

    return { html, title, url };
  } catch (error) {
    if (retryCount < maxRetries) {
      console.warn(`Fetch failed (attempt ${retryCount + 1}), retrying...`, error);
      return await fetchPageFallback(url, retryCount + 1);
    }
    
    console.error('All fallback fetch attempts failed:', error);
    throw error;
  }
}

export class CloudflareBrowserService {
  
  // Method to clear cached results for a URL (useful when blocked content is detected)
  async clearCache(url: string, options: any = {}): Promise<void> {
    if (!env.SITE_ANALYSIS_CACHE) return;
    
    const cacheKey = `page:${url}:${JSON.stringify(options)}`;
    try {
      await env.SITE_ANALYSIS_CACHE.delete(cacheKey);
      console.log('Cleared cache for:', url);
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  }

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

      // Set randomized user agent and headers to appear more human-like
      const userAgent = getRandomUserAgent();
      await page.setUserAgent(userAgent);
      
      // Set additional headers to mimic real browser behavior
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      });

      // Navigate to the page with retry logic
      console.log('Navigating to:', url);
      let html: string = '';
      let title: string = '';
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount <= maxRetries) {
        try {
          await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
          });

          // Wait for additional content to load
          if (waitFor > 0) {
            await new Promise(resolve => setTimeout(resolve, waitFor));
          }

          // Extract page content
          [html, title] = await Promise.all([
            page.content(),
            page.title().catch(() => 'No title found')
          ]);
          
          // Check if we got blocked content
          const blockCheck = isBlockedContent(html, title);
          if (blockCheck.isBlocked) {
            console.warn(`Browser rendering blocked: ${blockCheck.reason}`);
            
            if (retryCount < maxRetries) {
              console.log('Waiting before retry...');
              await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 5000)); // 5-10s random delay
              
              // Try with a different user agent
              await page.setUserAgent(getRandomUserAgent());
              retryCount++;
              continue;
            } else {
              throw new Error(`Content blocked after ${maxRetries + 1} attempts: ${blockCheck.reason}`);
            }
          }
          
          // Success - break out of retry loop
          break;
          
        } catch (error) {
          if (retryCount < maxRetries) {
            console.warn(`Navigation failed (attempt ${retryCount + 1}), retrying...`, error);
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay before retry
          } else {
            throw error;
          }
        }
      }

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