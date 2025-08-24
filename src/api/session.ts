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
    
    // Simplified approach: Just call the existing analyze-crawl endpoint
    console.log(`🚀 Starting analysis via direct call for session ${sessionId}...`);
    
    try {
      // Create a fake request to the analyze-crawl endpoint
      const analyzeRequest = new Request('https://internal/api/analyze-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: sessionData.url, 
          maxPages: sessionData.maxPages,
          concurrency: 3
        })
      });
      
      // Import and call the analyze-crawl handler directly
      const { default: analyzeCrawlHandler } = await import('./analyze-crawl');
      
      // Call the handler in a separate execution context
      analyzeCrawlHandler({ request: analyzeRequest } as any).then(async (response) => {
        if (response.ok) {
          const results = await response.json() as any[];
          
          // Update session with completed results
          if (env.SITE_ANALYSIS_CACHE) {
            await env.SITE_ANALYSIS_CACHE.put(
              `session:${sessionId}`,
              JSON.stringify({
                ...sessionData,
                status: 'completed',
                progress: {
                  stage: 'completed',
                  current: results.length,
                  total: results.length,
                  message: `Analysis completed. Successfully analyzed ${results.length} pages.`
                },
                results,
                updatedAt: new Date().toISOString()
              }),
              { expirationTtl: 60 * 60 * 24 }
            );
            console.log(`✅ Session ${sessionId} marked as completed with ${results.length} results`);
          }
        } else {
          throw new Error(`Analysis failed: ${response.statusText}`);
        }
      }).catch(async (error) => {
        console.error(`💥 Analysis failed for session ${sessionId}:`, error);
        
        // Update session to error state
        if (env.SITE_ANALYSIS_CACHE) {
          await env.SITE_ANALYSIS_CACHE.put(
            `session:${sessionId}`,
            JSON.stringify({
              ...sessionData,
              status: 'error',
              error: error instanceof Error ? error.message : 'Analysis failed',
              progress: {
                stage: 'error',
                message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
              },
              updatedAt: new Date().toISOString()
            }),
            { expirationTtl: 60 * 60 * 24 }
          );
        }
      });
      
      console.log(`✅ Analysis process initiated for session ${sessionId}`);
      
    } catch (error) {
      console.error(`💥 Failed to initiate analysis for session ${sessionId}:`, error);
      
      // Update session to error state immediately
      if (env.SITE_ANALYSIS_CACHE) {
        await env.SITE_ANALYSIS_CACHE.put(
          `session:${sessionId}`,
          JSON.stringify({
            ...sessionData,
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to start analysis',
            progress: {
              stage: 'error',
              message: `Failed to start analysis: ${error instanceof Error ? error.message : 'Unknown error'}`
            },
            updatedAt: new Date().toISOString()
          }),
          { expirationTtl: 60 * 60 * 24 }
        );
      }
    }
    
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

// Removed unused background analysis function - replaced with direct analyze-crawl call