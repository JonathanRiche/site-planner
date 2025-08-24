import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";
import { env } from 'cloudflare:workers';

export interface SessionData {
  id: string;
  url: string;
  crawl: boolean;
  maxPages: number;
  status: 'pending' | 'crawling' | 'analyzing' | 'completed' | 'error';
  progress: {
    stage: 'idle' | 'crawling' | 'analyzing' | 'completed' | 'error';
    current?: number;
    total?: number;
    message?: string;
    urls?: string[];
    allUrls?: string[];
  };
  results?: any[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export default async function sessionHandler({ request }: RequestInfo<any, AppContext>) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  
  // Handle different session endpoints
  // GET /api/session/[uuid] - Get session status
  // POST /api/session - Create new session
  // PUT /api/session/[uuid] - Update session
  
  if (request.method === 'POST' && pathParts.length === 3) {
    // Create new session
    return createSession(request);
  }
  
  if (request.method === 'GET' && pathParts.length === 4) {
    // Get session status
    const sessionId = pathParts[3];
    return getSession(sessionId);
  }
  
  if (request.method === 'PUT' && pathParts.length === 4) {
    // Update session
    const sessionId = pathParts[3];
    return updateSession(sessionId, request);
  }
  
  return new Response(JSON.stringify({ error: 'Invalid session endpoint' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function createSession(request: Request): Promise<Response> {
  try {
    const body: any = await request.json();
    const { url: siteUrl, crawl = true, maxPages = 5 } = body;
    
    if (!siteUrl) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Generate UUID for session
    const sessionId = crypto.randomUUID();
    
    // Create session data
    const sessionData: SessionData = {
      id: sessionId,
      url: siteUrl,
      crawl,
      maxPages: Math.min(Math.max(maxPages, 1), 20),
      status: 'pending',
      progress: {
        stage: 'idle',
        message: 'Session created, analysis will begin shortly...'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Store in KV
    if (env.SITE_ANALYSIS_CACHE) {
      await env.SITE_ANALYSIS_CACHE.put(
        `session:${sessionId}`, 
        JSON.stringify(sessionData),
        { expirationTtl: 60 * 60 * 24 } // 24 hours
      );
    }
    
    console.log(`📝 Created session ${sessionId} for URL: ${siteUrl}`);
    
    // Start analysis in background (fire and forget)
    console.log(`🚀 Starting background analysis for session ${sessionId}...`);
    
    // Use setTimeout to ensure the function starts executing
    setTimeout(() => {
      console.log(`⚡ Timeout triggered, about to call startBackgroundAnalysis for ${sessionId}`);
      startBackgroundAnalysis(sessionId, sessionData).catch(error => {
        console.error(`💥 Background analysis failed for session ${sessionId}:`, error);
        console.error(`Stack trace:`, error.stack);
        
        // Update session to error state
        if (env.SITE_ANALYSIS_CACHE) {
          env.SITE_ANALYSIS_CACHE.put(
            `session:${sessionId}`,
            JSON.stringify({
              ...sessionData,
              status: 'error',
              error: error.message,
              progress: {
                stage: 'error',
                message: `Analysis failed: ${error.message}`
              },
              updatedAt: new Date().toISOString()
            }),
            { expirationTtl: 60 * 60 * 24 }
          ).catch(cacheError => {
            console.error(`Failed to update session ${sessionId} with error state:`, cacheError);
          });
        }
      });
    }, 100); // Small delay to ensure response is sent first
    
    return new Response(JSON.stringify({
      sessionId,
      status: 'created',
      message: 'Session created successfully. Analysis starting...'
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Session creation error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to create session',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function getSession(sessionId: string): Promise<Response> {
  try {
    if (!env.SITE_ANALYSIS_CACHE) {
      return new Response(JSON.stringify({ error: 'Session storage not available' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const sessionData = await env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
    
    if (!sessionData) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const data = JSON.parse(sessionData) as SessionData;
    
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Session retrieval error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to retrieve session',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function updateSession(sessionId: string, request: Request): Promise<Response> {
  try {
    const updates: any = await request.json();
    
    if (!env.SITE_ANALYSIS_CACHE) {
      return new Response(JSON.stringify({ error: 'Session storage not available' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const sessionData = await env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
    
    if (!sessionData) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const data = JSON.parse(sessionData) as SessionData;
    
    // Update session data  
    const updatedData = {
      ...data,
      ...updates,
      updatedAt: new Date().toISOString()
    } as SessionData;
    
    await env.SITE_ANALYSIS_CACHE.put(
      `session:${sessionId}`, 
      JSON.stringify(updatedData),
      { expirationTtl: 60 * 60 * 24 } // 24 hours
    );
    
    return new Response(JSON.stringify(updatedData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Session update error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to update session',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function startBackgroundAnalysis(sessionId: string, sessionData: SessionData) {
  console.log(`⚡ BACKGROUND ANALYSIS FUNCTION CALLED for session ${sessionId}, URL: ${sessionData.url}`);
  console.log(`⚡ Session data:`, JSON.stringify(sessionData, null, 2));
  
  const updateSession = async (updates: Partial<SessionData>) => {
    try {
      if (!env.SITE_ANALYSIS_CACHE) {
        console.error(`❌ No SITE_ANALYSIS_CACHE available for session ${sessionId}`);
        return;
      }
      
      const currentData = await env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
      if (!currentData) {
        console.error(`❌ Session ${sessionId} not found in cache`);
        return;
      }
      
      const data = JSON.parse(currentData) as SessionData;
      const updatedData = {
        ...data,
        ...updates,
        updatedAt: new Date().toISOString()
      } as SessionData;
      
      console.log(`📝 Updating session ${sessionId}:`, { status: updatedData.status, stage: updatedData.progress?.stage });
      
      await env.SITE_ANALYSIS_CACHE.put(
        `session:${sessionId}`, 
        JSON.stringify(updatedData),
        { expirationTtl: 60 * 60 * 24 }
      );
    } catch (error) {
      console.error(`💥 Failed to update session ${sessionId}:`, error);
    }
  };
   
  try {
    // Check for required environment variables first
    console.log(`🔍 Checking environment for session ${sessionId}...`);
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured. Cannot proceed with analysis.');
    }
    console.log(`✅ OPENAI_API_KEY is configured for session ${sessionId}`);
    
    // Import the analysis service dynamically to avoid circular dependencies
    console.log(`📦 Importing analysis services for session ${sessionId}...`);
    const { SiteAnalysisService } = await import('../lib/analysis-service');
    const { OptimizedCloudflareBrowserService } = await import('../lib/optimized-browser-service');
    console.log(`✅ Services imported successfully for session ${sessionId}`);
    
    if (sessionData.crawl) {
      // Update status to crawling
      await updateSession({
        status: 'crawling',
        progress: {
          stage: 'crawling',
          message: `Crawling pages from ${sessionData.url}...`
        }
      });
      
      // Step 1: Crawl links
      const browser = new OptimizedCloudflareBrowserService();
      const page = await browser.renderPage(sessionData.url, { 
        useCache: true, 
        blockResources: true, 
        optimizeForContent: true 
      });
      
      // Extract internal links (using same logic as analyze-crawl.ts)
      const internalLinks = extractInternalLinks(page.html, page.url, sessionData.maxPages - 1);
      const rootUrlInLinks = internalLinks.includes(sessionData.url);
      const urlsToAnalyze = rootUrlInLinks 
        ? internalLinks.slice(0, sessionData.maxPages)
        : [sessionData.url, ...internalLinks.slice(0, sessionData.maxPages - 1)];
      
      // Update with found URLs
      await updateSession({
        status: 'analyzing',
        progress: {
          stage: 'analyzing',
          current: 0,
          total: urlsToAnalyze.length,
          message: `Found ${internalLinks.length} internal links. Analyzing ${urlsToAnalyze.length} pages...`,
          urls: urlsToAnalyze,
          allUrls: internalLinks
        }
      });
      
      // Step 2: Analyze pages in parallel
      const analysisService = new SiteAnalysisService();
      const results = await analysisService.analyzeMultiplePages(urlsToAnalyze, { 
        concurrency: Math.min(urlsToAnalyze.length, 3)
      });
      
      // Update with completed results
      await updateSession({
        status: 'completed',
        progress: {
          stage: 'completed',
          current: results.length,
          total: urlsToAnalyze.length,
          message: `Analysis completed. Successfully analyzed ${results.length} out of ${urlsToAnalyze.length} pages.`
        },
        results
      });
      
    } else {
      // Single page analysis
      await updateSession({
        status: 'analyzing',
        progress: {
          stage: 'analyzing',
          current: 0,
          total: 1,
          message: `Analyzing ${sessionData.url}...`
        }
      });
      
      const analysisService = new SiteAnalysisService();
      const result = await analysisService.analyzeSite(sessionData.url);
      
      await updateSession({
        status: 'completed',
        progress: {
          stage: 'completed',
          current: 1,
          total: 1,
          message: 'Analysis completed successfully!'
        },
        results: [result]
      });
    }
    
    console.log(`✅ Background analysis completed for session ${sessionId}`);
    
  } catch (error) {
    console.error(`❌ Background analysis failed for session ${sessionId}:`, error);
    
    await updateSession({
      status: 'error',
      progress: {
        stage: 'error',
        message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      error: error instanceof Error ? error.message : 'Analysis failed'
    });
  }
}

// Helper function to extract internal links (copied from analyze-crawl.ts)
function extractInternalLinks(html: string, baseUrl: string, limit: number): string[] {
  const base = new URL(baseUrl);
  const hrefs = new Set<string>();

  // Find anchor hrefs
  const anchorRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) && hrefs.size < limit * 2) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;

    try {
      const url = new URL(raw, base);
      // Same origin only
      if (url.origin !== base.origin) continue;
      // Skip files (images, assets, docs)
      if (/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|pdf|zip|rar|7z|mp4|mp3)(\?.*)?$/i.test(url.pathname)) continue;

      // Normalize: drop hash, keep path+search minimally to avoid duplicates
      url.hash = '';
      const normalized = url.toString();
      hrefs.add(normalized);
    } catch {
      continue;
    }
  }

  // De-duplicate by pathname first, then limit
  const seenPath = new Set<string>();
  const result: string[] = [];
  for (const u of hrefs) {
    const p = new URL(u).pathname;
    if (seenPath.has(p)) continue;
    seenPath.add(p);
    result.push(u);
    if (result.length >= limit) break;
  }
  return result;
}