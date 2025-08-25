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
  timeout: 15000,
  waitFor: 500,
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

export class SimpleCloudflareBrowserService {
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

    console.log(`[${requestId}] 🚀 Starting simple browser render for: ${url}`, {
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

    let browser: any;
    let sessionId: string | undefined;
    let isReusedSession = false;
    
    try {
      // Use Cloudflare's built-in session management with puppeteer.sessions()
      console.log(`[${requestId}] 🔍 Checking for available Cloudflare sessions...`);
      
      let availableSessions: any[] = [];
      try {
        availableSessions = await puppeteer.sessions(env.MYBROWSER);
        console.log(`[${requestId}] 📊 Found ${availableSessions.length} total sessions`);
        
        // Log session details for debugging
        if (availableSessions.length > 0) {
          console.log(`[${requestId}] 🔍 Session details:`, availableSessions.map(s => ({
            sessionId: s.sessionId?.substring(0, 8) + '...',
            connectionId: s.connectionId,
            hasConnectionId: !!s.connectionId,
            fields: Object.keys(s)
          })));
        }

        // Try to reuse any session - connectionId might persist after disconnect
        if (availableSessions.length > 0) {
          // Try each session until we find one that works
          for (const sessionCandidate of availableSessions) {
            try {
              console.log(`[${requestId}] ♻️ Attempting to connect to session: ${sessionCandidate.sessionId} (connectionId: ${sessionCandidate.connectionId || 'none'})`);
              browser = await puppeteer.connect(env.MYBROWSER, sessionCandidate.sessionId);
              sessionId = sessionCandidate.sessionId;
              isReusedSession = true;
              console.log(`[${requestId}] ✅ Successfully reusing session: ${sessionId}`);
              break;
            } catch (connectError) {
              console.warn(`[${requestId}] ⚠️ Failed to connect to session ${sessionCandidate.sessionId}:`, connectError);
              // Continue to try next session
            }
          }
        }
      } catch (sessionsError) {
        console.warn(`[${requestId}] ⚠️ Failed to get sessions list:`, sessionsError);
        // Fall through to create new session
      }

      // If no session reused, create new one
      if (!browser) {
        console.log(`[${requestId}] 🚀 Creating new browser session...`);
        const browserStartTime = Date.now();
        browser = await puppeteer.launch(env.MYBROWSER);
        sessionId = browser.sessionId();
        isReusedSession = false;
        console.log(`[${requestId}] ✅ New session created: ${sessionId} (${Date.now() - browserStartTime}ms)`);
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

      // Navigate with single attempt - no retry logic for blocked content
      console.log(`[${requestId}] 🎯 Attempting navigation (single attempt)`);
      const attemptStartTime = Date.now();

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
      const [html, title] = await Promise.all([
        page.content(),
        page.title().catch(() => 'No title found')
      ]);
      console.log(`[${requestId}] ✅ Content extracted in ${Date.now() - contentStartTime}ms`, {
        htmlLength: html.length,
        title: title.substring(0, 100),
      });

      // Check if we got blocked content - fail immediately if blocked
      console.log(`[${requestId}] 🔍 Checking for bot detection/blocking...`);
      const blockCheck = isBlockedContent(html, title);
      if (blockCheck.isBlocked) {
        console.warn(`[${requestId}] 🚫 Content blocked - failing immediately: ${blockCheck.reason}`, {
          titleSnippet: title.substring(0, 100),
          htmlSnippet: html.substring(0, 200)
        });
        throw new Error(`Content access blocked: ${blockCheck.reason}`);
      }

      console.log(`[${requestId}] 🎉 Successfully extracted content (${html.length} chars)`);

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

      // IMPORTANT: Disconnect instead of close to allow reuse
      console.log(`[${requestId}] 🔌 Disconnecting from browser session (keeping alive for reuse)...`);
      browser.disconnect();
      
      // Give a small delay to ensure connection is fully released
      await new Promise(resolve => setTimeout(resolve, 100));

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

      console.log(`[${requestId}] 📊 Simple render summary:`, {
        totalTime: `${loadTime}ms`,
        htmlSize: `${html.length} chars`,
        hasScreenshot: !!screenshot,
        screenshotSize: screenshot ? `${screenshot.length} bytes` : 'N/A',
        sessionReused: isReusedSession,
        sessionId: sessionId?.substring(0, 8) + '...',
        resourcesBlocked: blockResources
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

      console.log(`[${requestId}] 🏁 Simple page render completed successfully in ${loadTime}ms`);
      return result;
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`[${requestId}] 💥 Simple browser rendering failed after ${totalTime}ms for ${url}:`, {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        url,
        options,
        sessionId,
        isReusedSession
      });

      throw new Error(`Failed to render page: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}