import { DurableObject } from "cloudflare:workers";
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

export class SessionAnalysisManager extends DurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/start' && request.method === 'POST') {
      const { sessionId, sessionData } = await request.json() as { sessionId: string, sessionData: SessionData };
      return this.startAnalysis(sessionId, sessionData);
    }
    
    return new Response('Not found', { status: 404 });
  }

  async startAnalysis(sessionId: string, sessionData: SessionData): Promise<Response> {
    console.log(`🚀 Durable Object: Starting analysis for session ${sessionId}`);
    
    // Start analysis immediately (not in background)
    this.performAnalysis(sessionId, sessionData);
    
    return new Response(JSON.stringify({ 
      success: true, 
      message: "Analysis started" 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async performAnalysis(sessionId: string, sessionData: SessionData) {
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
        
        console.log(`📝 DO: Updating session ${sessionId}:`, { status: updatedData.status, stage: updatedData.progress?.stage });
        
        await env.SITE_ANALYSIS_CACHE.put(
          `session:${sessionId}`, 
          JSON.stringify(updatedData),
          { expirationTtl: 60 * 60 * 24 }
        );
      } catch (error) {
        console.error(`💥 DO: Failed to update session ${sessionId}:`, error);
      }
    };
    
    try {
      // Check for required environment variables first
      console.log(`🔍 DO: Checking environment for session ${sessionId}...`);
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured. Cannot proceed with analysis.');
      }
      console.log(`✅ DO: OPENAI_API_KEY is configured for session ${sessionId}`);
      
      // Import the analysis service dynamically
      console.log(`📦 DO: Importing analysis services for session ${sessionId}...`);
      const { SiteAnalysisService } = await import('./analysis-service');
      const { OptimizedCloudflareBrowserService } = await import('./optimized-browser-service');
      console.log(`✅ DO: Services imported successfully for session ${sessionId}`);
      
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
        console.log(`🕷️ DO: Starting crawl for session ${sessionId}`);
        const browser = new OptimizedCloudflareBrowserService();
        const page = await browser.renderPage(sessionData.url, { 
          useCache: true, 
          blockResources: true, 
          optimizeForContent: true 
        });
        
        // Extract internal links
        const internalLinks = this.extractInternalLinks(page.html, page.url, sessionData.maxPages - 1);
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
        console.log(`🤖 DO: Starting parallel analysis for session ${sessionId}`);
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
        
        console.log(`🤖 DO: Starting single page analysis for session ${sessionId}`);
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
      
      console.log(`✅ DO: Background analysis completed for session ${sessionId}`);
      
    } catch (error) {
      console.error(`❌ DO: Background analysis failed for session ${sessionId}:`, error);
      
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

  // Helper function to extract internal links
  private extractInternalLinks(html: string, baseUrl: string, limit: number): string[] {
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
}