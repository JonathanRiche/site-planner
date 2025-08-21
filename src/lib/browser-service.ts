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
  const fallbackId = Math.random().toString(36).substring(7);
  
  console.log(`🔄 [${fallbackId}] Using fallback fetch method for: ${url} (attempt ${retryCount + 1}/${maxRetries + 1})`);
  console.log(`🎭 [${fallbackId}] User agent: ${userAgent.substring(0, 50)}...`);
  
  try {
    // Add delay between retries to avoid rate limiting
    if (retryCount > 0) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff up to 10s
      console.log(`⏱️ [${fallbackId}] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    console.log(`🌐 [${fallbackId}] Making HTTP request...`);
    const fetchStartTime = Date.now();
    
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

    console.log(`📡 [${fallbackId}] Response received in ${Date.now() - fetchStartTime}ms:`, {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length')
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    console.log(`📄 [${fallbackId}] HTML content received: ${html.length} characters`);
    
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
    const requestId = Math.random().toString(36).substring(7);

    console.log(`[${requestId}] 🚀 Starting page render for: ${url}`, {
      viewport,
      takeScreenshot,
      waitFor,
      useCache,
      timestamp: new Date().toISOString()
    });

    // Check cache first if enabled
    if (useCache && env.SITE_ANALYSIS_CACHE) {
      console.log(`[${requestId}] 🔍 Checking cache for: ${url}`);
      try {
        const cached = await env.SITE_ANALYSIS_CACHE.get(cacheKey);
        if (cached) {
          console.log(`[${requestId}] ✅ Cache hit for: ${url} (${Date.now() - startTime}ms)`);
          return JSON.parse(cached);
        } else {
          console.log(`[${requestId}] ❌ Cache miss for: ${url}`);
        }
      } catch (error) {
        console.warn(`[${requestId}] ⚠️ Cache read error for ${url}:`, error);
      }
    } else {
      console.log(`[${requestId}] 🚫 Cache disabled or unavailable`);
    }

    try {
      // Check if browser binding is available
      console.log(`[${requestId}] 🔍 Checking browser binding availability...`);
      console.log(`[${requestId}] 📊 Environment info:`, {
        hasMYBROWSER: !!env.MYBROWSER,
        hasCACHE: !!env.SITE_ANALYSIS_CACHE,
        envKeys: Object.keys(env || {}).length
      });
      
      if (!env.MYBROWSER) {
        console.warn(`[${requestId}] ⚠️ MYBROWSER binding not available, using fallback fetch method`);
        
        // Use simple fetch fallback for development
        const fallbackResult = await fetchPageFallback(url);
        const loadTime = Date.now() - startTime;
        
        console.log(`[${requestId}] ✅ Fallback fetch completed in ${loadTime}ms`);
        
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
      console.log(`[${requestId}] 🌐 Launching Puppeteer browser...`);
      const browserStartTime = Date.now();
      const browser = await puppeteer.launch(env.MYBROWSER);
      console.log(`[${requestId}] ✅ Browser launched successfully in ${Date.now() - browserStartTime}ms`);
      console.log(`[${requestId}] 📄 Creating new browser page...`);
      const page = await browser.newPage();

      // Set viewport
      console.log(`[${requestId}] 📐 Setting viewport to ${viewport.width}x${viewport.height}`);
      await page.setViewport(viewport);

      // Set randomized user agent and headers to appear more human-like
      const userAgent = getRandomUserAgent();
      console.log(`[${requestId}] 🎭 Setting user agent: ${userAgent.substring(0, 50)}...`);
      await page.setUserAgent(userAgent);
      
      // Set additional headers to mimic real browser behavior
      const headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      };
      console.log(`[${requestId}] 🔧 Setting ${Object.keys(headers).length} HTTP headers`);
      await page.setExtraHTTPHeaders(headers);

      // Navigate to the page with retry logic
      console.log(`[${requestId}] 🧭 Starting navigation to: ${url}`);
      let html: string = '';
      let title: string = '';
      let retryCount = 0;
      const maxRetries = 2;
      
      while (retryCount <= maxRetries) {
        const attemptStartTime = Date.now();
        console.log(`[${requestId}] 🎯 Navigation attempt ${retryCount + 1}/${maxRetries + 1}`);
        
        try {
          console.log(`[${requestId}] ⏳ Calling page.goto() with 30s timeout...`);
          await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
          });
          console.log(`[${requestId}] ✅ Navigation completed in ${Date.now() - attemptStartTime}ms`);

          // Wait for additional content to load
          if (waitFor > 0) {
            console.log(`[${requestId}] ⌛ Waiting ${waitFor}ms for dynamic content...`);
            await new Promise(resolve => setTimeout(resolve, waitFor));
          }

          // Extract page content
          console.log(`[${requestId}] 📖 Extracting page content and title...`);
          const contentStartTime = Date.now();
          [html, title] = await Promise.all([
            page.content(),
            page.title().catch(() => 'No title found')
          ]);
          console.log(`[${requestId}] ✅ Content extracted in ${Date.now() - contentStartTime}ms`, {
            htmlLength: html.length,
            title: title.substring(0, 100),
          });
          
          // Check if we got blocked content
          console.log(`[${requestId}] 🔍 Checking for bot detection/blocking...`);
          const blockCheck = isBlockedContent(html, title);
          if (blockCheck.isBlocked) {
            console.warn(`[${requestId}] 🚫 Browser rendering blocked: ${blockCheck.reason}`, {
              titleSnippet: title.substring(0, 100),
              htmlSnippet: html.substring(0, 200)
            });
            
            if (retryCount < maxRetries) {
              const retryDelay = 5000 + Math.random() * 5000; // 5-10s random delay
              console.log(`[${requestId}] 🔄 Waiting ${Math.round(retryDelay)}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              
              // Try with a different user agent
              const newUserAgent = getRandomUserAgent();
              console.log(`[${requestId}] 🎭 Switching to new user agent: ${newUserAgent.substring(0, 50)}...`);
              await page.setUserAgent(newUserAgent);
              retryCount++;
              continue;
            } else {
              // Last-chance fallback to raw HTTP fetch
              try {
                console.warn(`[${requestId}] 🛟 Blocked by bot protection. Trying raw HTTP fallback...`);
                const fallback = await fetchPageFallback(url);
                const loadTime = Date.now() - startTime;
                return {
                  html: fallback.html,
                  title: fallback.title,
                  url: fallback.url,
                  metadata: {
                    viewport,
                    loadTime,
                    timestamp: new Date().toISOString(),
                  },
                } as PageContent;
              } catch (finalErr) {
                throw new Error(`Content blocked after ${maxRetries + 1} attempts: ${blockCheck.reason}`);
              }
            }
          }
          
          // Success - break out of retry loop
          console.log(`[${requestId}] 🎉 Successfully extracted content (${html.length} chars)`);
          break;
          
        } catch (error) {
          console.error(`[${requestId}] ❌ Navigation attempt ${retryCount + 1} failed after ${Date.now() - attemptStartTime}ms:`, {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            url,
            retryCount
          });
          
          if (retryCount < maxRetries) {
            const retryDelay = 2000;
            console.log(`[${requestId}] ⏱️ Waiting ${retryDelay}ms before retry...`);
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            console.error(`[${requestId}] 💥 All navigation attempts failed for: ${url}`);
            // Final fallback: attempt raw HTTP fetch as last resort
            try {
              console.warn(`[${requestId}] 🛟 Falling back to raw HTTP fetch after browser failure...`);
              const fallback = await fetchPageFallback(url);
              const loadTime = Date.now() - startTime;
              return {
                html: fallback.html,
                title: fallback.title,
                url: fallback.url,
                metadata: {
                  viewport,
                  loadTime,
                  timestamp: new Date().toISOString(),
                },
              } as PageContent;
            } catch (finalErr) {
              throw error; // preserve original
            }
          }
        }
      }

      let screenshot: Buffer | undefined;
      if (takeScreenshot) {
        console.log(`[${requestId}] 📸 Taking screenshot...`);
        const screenshotStartTime = Date.now();
        screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 85,
          fullPage: false, // Just viewport for performance
        }) as Buffer;
        console.log(`[${requestId}] ✅ Screenshot captured in ${Date.now() - screenshotStartTime}ms (${screenshot.length} bytes)`);
      }

      console.log(`[${requestId}] 🔒 Closing browser...`);
      const closeStartTime = Date.now();
      await browser.close();
      console.log(`[${requestId}] ✅ Browser closed in ${Date.now() - closeStartTime}ms`);

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

      console.log(`[${requestId}] 📊 Render summary:`, {
        totalTime: `${loadTime}ms`,
        htmlSize: `${html.length} chars`,
        hasScreenshot: !!screenshot,
        screenshotSize: screenshot ? `${screenshot.length} bytes` : 'N/A'
      });

      // Cache the result if enabled
      if (useCache && env.SITE_ANALYSIS_CACHE) {
        console.log(`[${requestId}] 💾 Caching result...`);
        try {
          const cacheStartTime = Date.now();
          await env.SITE_ANALYSIS_CACHE.put(
            cacheKey,
            JSON.stringify(result),
            {
              expirationTtl: 60 * 60 * 24, // 24 hours
            }
          );
          console.log(`[${requestId}] ✅ Result cached in ${Date.now() - cacheStartTime}ms for: ${url}`);
        } catch (error) {
          console.warn(`[${requestId}] ⚠️ Cache write error:`, error);
        }
      }

      console.log(`[${requestId}] 🏁 Page render completed successfully in ${loadTime}ms`);
      return result;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`[${requestId}] 💥 Browser rendering failed after ${totalTime}ms for ${url}:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
        timestamp: new Date().toISOString(),
        url,
        options
      });
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