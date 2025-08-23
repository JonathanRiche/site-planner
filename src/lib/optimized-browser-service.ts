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
    isReusedSession: boolean;
    sessionId?: string;
  };
}

const DEFAULT_BROWSER_OPTIONS = {
  timeout: 30000,
  waitFor: 1000,
} as const;

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

export class OptimizedCloudflareBrowserService {
  private sessionManagerId?: DurableObjectId;

  constructor() {
    // Initialize the session manager Durable Object ID
    this.sessionManagerId = env.BROWSER_SESSION_MANAGER.idFromName("global-session-manager");
  }

  private async getSessionManager() {
    if (!this.sessionManagerId) {
      this.sessionManagerId = env.BROWSER_SESSION_MANAGER.idFromName("global-session-manager");
    }
    return env.BROWSER_SESSION_MANAGER.get(this.sessionManagerId);
  }

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
    blockResources?: boolean;
    optimizeForContent?: boolean;
  } = {}): Promise<PageContent> {
    const {
      takeScreenshot = false,
      viewport = { width: 1280, height: 720 },
      waitFor = DEFAULT_BROWSER_OPTIONS.waitFor,
      useCache = true,
      blockResources = true,
      optimizeForContent = true,
    } = options;

    const cacheKey = `page:${url}:${JSON.stringify(options)}`;
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);

    console.log(`[${requestId}] 🚀 Starting optimized page render for: ${url}`, {
      viewport,
      takeScreenshot,
      waitFor,
      useCache,
      blockResources,
      optimizeForContent,
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
    }

    let sessionId: string | undefined;
    let browser: any;
    let isReusedSession = false;
    
    try {
      // Get session manager
      const sessionManager = await this.getSessionManager();

      // Try to acquire a session
      console.log(`[${requestId}] 🔄 Acquiring browser session...`);
      const acquireResponse = await sessionManager.fetch(new Request('https://dummy.com/acquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'normal' })
      }));

      if (!acquireResponse.ok) {
        throw new Error(`Failed to acquire session: ${acquireResponse.status} ${await acquireResponse.text()}`);
      }

      const sessionInfo = await acquireResponse.json() as { sessionId: string; isReused: boolean; };
      sessionId = sessionInfo.sessionId;
      isReusedSession = sessionInfo.isReused;

      console.log(`[${requestId}] ${isReusedSession ? '♻️ Reusing' : '🚀 Using new'} session: ${sessionId}`);

      // Connect to the session
      if (isReusedSession) {
        browser = await puppeteer.connect(env.MYBROWSER, sessionId);
      } else {
        browser = await puppeteer.launch(env.MYBROWSER);
        sessionId = browser.sessionId();
      }

      console.log(`[${requestId}] 📄 Creating new browser page...`);
      const page = await browser.newPage();

      // Set viewport
      console.log(`[${requestId}] 📐 Setting viewport to ${viewport.width}x${viewport.height}`);
      await page.setViewport(viewport);

      // Resource blocking for performance
      if (blockResources) {
        console.log(`[${requestId}] 🚫 Setting up resource blocking...`);
        await page.setRequestInterception(true);
        page.on('request', (req: any) => {
          const resourceType = req.resourceType();
          const url = req.url();
          
          // Block unnecessary resources but allow essential ones
          if (optimizeForContent) {
            // For content extraction, block most media
            if (['image', 'media', 'font', 'websocket'].includes(resourceType)) {
              req.abort();
              return;
            }
            // Block some stylesheets unless they might contain critical layout info
            if (resourceType === 'stylesheet' && !url.includes('critical') && !url.includes('inline')) {
              req.abort();
              return;
            }
          } else {
            // More conservative blocking - only block obvious non-essentials
            if (['media', 'websocket'].includes(resourceType)) {
              req.abort();
              return;
            }
          }
          
          req.continue();
        });
      }

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

      // Navigate with optimized wait strategy
      let html: string = '';
      let title: string = '';
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        const attemptStartTime = Date.now();
        console.log(`[${requestId}] 🎯 Navigation attempt ${retryCount + 1}/${maxRetries + 1}`);

        try {
          console.log(`[${requestId}] ⏳ Navigating with optimized wait strategy...`);
          
          // Use networkidle2 for dynamic content, but with a reasonable timeout
          const waitUntil = optimizeForContent ? 'domcontentloaded' : 'networkidle2';
          
          await page.goto(url, {
            waitUntil,
            timeout: DEFAULT_BROWSER_OPTIONS.timeout
          });
          
          console.log(`[${requestId}] ✅ Navigation completed in ${Date.now() - attemptStartTime}ms`);

          // Additional wait if specified
          if (waitFor > 0) {
            console.log(`[${requestId}] ⌛ Waiting ${waitFor}ms for additional content...`);
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
              throw new Error(`Content blocked after ${maxRetries + 1} attempts: ${blockCheck.reason}`);
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
            throw error;
          }
        }
      }

      let screenshot: Buffer | undefined;
      if (takeScreenshot) {
        console.log(`[${requestId}] 📸 Taking optimized screenshot...`);
        const screenshotStartTime = Date.now();
        screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 70, // Optimized quality for performance
          fullPage: false, // Just viewport for performance
        }) as Buffer;
        console.log(`[${requestId}] ✅ Screenshot captured in ${Date.now() - screenshotStartTime}ms (${screenshot.length} bytes)`);
      }

      // IMPORTANT: Disconnect instead of close to reuse the session
      console.log(`[${requestId}] 🔌 Disconnecting from browser session (keeping alive for reuse)...`);
      browser.disconnect();

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
          isReusedSession,
          sessionId,
        },
      };

      console.log(`[${requestId}] 📊 Optimized render summary:`, {
        totalTime: `${loadTime}ms`,
        htmlSize: `${html.length} chars`,
        hasScreenshot: !!screenshot,
        screenshotSize: screenshot ? `${screenshot.length} bytes` : 'N/A',
        sessionReused: isReusedSession,
        resourcesBlocked: blockResources
      });

      // Release the session back to the pool
      if (sessionId) {
        try {
          const sessionManager = await this.getSessionManager();
          await sessionManager.fetch(new Request('https://dummy.com/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          }));
          console.log(`[${requestId}] ✅ Session released back to pool: ${sessionId}`);
        } catch (error) {
          console.warn(`[${requestId}] ⚠️ Failed to release session:`, error);
        }
      }

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

      console.log(`[${requestId}] 🏁 Optimized page render completed successfully in ${loadTime}ms`);
      return result;
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`[${requestId}] 💥 Optimized browser rendering failed after ${totalTime}ms for ${url}:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
        timestamp: new Date().toISOString(),
        url,
        options,
        sessionId,
        isReusedSession
      });

      // Clean up: try to release session if we had one
      if (sessionId) {
        try {
          const sessionManager = await this.getSessionManager();
          await sessionManager.fetch(new Request('https://dummy.com/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          }));
        } catch (releaseError) {
          console.warn(`[${requestId}] Failed to release session on error:`, releaseError);
        }
      }

      throw new Error(`Failed to render page: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Legacy method for compatibility
  async takeScreenshot(url: string, options: {
    viewport?: { width: number; height: number };
    fullPage?: boolean;
    quality?: number;
  } = {}): Promise<Buffer> {
    const result = await this.renderPage(url, {
      ...options,
      takeScreenshot: true,
      blockResources: true,
      optimizeForContent: false
    });
    
    if (!result.screenshot) {
      throw new Error('Screenshot was not captured');
    }
    
    return result.screenshot;
  }

  // Legacy method for compatibility
  async extractStructuredData(url: string, selectors: Record<string, string>): Promise<Record<string, any>> {
    console.log('Extracting structured data for:', url);

    // For structured data extraction, we need a full browser session
    // This is less optimized but necessary for complex DOM queries
    try {
      const browser = await puppeteer.launch(env.MYBROWSER);
      const page = await browser.newPage();

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

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

      await browser.close(); // Close this one since it's a special case
      return data;
    } catch (error) {
      console.error('Data extraction error for', url, ':', error);
      throw new Error(`Failed to extract data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Utility method to get session manager status
  async getSessionStatus(): Promise<any> {
    try {
      const sessionManager = await this.getSessionManager();
      const response = await sessionManager.fetch(new Request('https://dummy.com/status'));
      return await response.json();
    } catch (error) {
      console.error('Failed to get session status:', error);
      return { error: 'Failed to get session status' };
    }
  }

  // Utility method to trigger cleanup
  async triggerSessionCleanup(): Promise<any> {
    try {
      const sessionManager = await this.getSessionManager();
      const response = await sessionManager.fetch(new Request('https://dummy.com/cleanup'));
      return await response.json();
    } catch (error) {
      console.error('Failed to trigger cleanup:', error);
      return { error: 'Failed to trigger cleanup' };
    }
  }
}