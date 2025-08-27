import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";
import { env } from 'cloudflare:workers';
import { DEFAULT_MAX_PAGES } from "@/lib/defaults";
import { NewSessionRequest } from "@/lib/types";

export interface SessionData {
  id: string;
  url: string;
  urls?: string[];
  crawl: boolean;
  maxPages: number;
  usePuppeteer: boolean;
  extraInstructions?: string;
  useExternalFetcher: boolean;
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

export default async function sessionHandler({ request, params }: RequestInfo<any, AppContext>) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  console.log('Session is:', params);

  // Handle different session endpoints
  // GET /api/session/[uuid] - Get session status
  // POST /api/session - Create new session
  // PUT /api/session/[uuid] - Update session

  if (request.method === 'POST' && pathParts.length === 3) {
    // Create new session
    //NOTE: THIS IS ALWAY THE ENTRY POINT FOR SESSION ANALYSIS
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
    const body = await request.json() as NewSessionRequest;
    const { url: siteUrl, crawl = true, maxPages = 5, usePuppeteer = false, useExternalFetcher = false, extraInstructions } = body;

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
      usePuppeteer,
      useExternalFetcher,
      extraInstructions,
      crawl,
      maxPages: Math.min(Math.max(maxPages, 1), DEFAULT_MAX_PAGES),
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
        { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
      );
    }

    console.log(`📝 Created session ${sessionId} for URL: ${siteUrl}`);

    // Use Durable Object for background analysis
    console.log(`🚀 Starting background analysis using Durable Object for session ${sessionId}...`);

    try {
      // Get the Durable Object instance
      const durableObjectId = env.SESSION_ANALYSIS_MANAGER.idFromName(sessionId);
      const durableObject = env.SESSION_ANALYSIS_MANAGER.get(durableObjectId);

      // Start the analysis in the Durable Object
      await durableObject.fetch('https://internal/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          sessionData
        })
      });

      console.log(`✅ Analysis process initiated via Durable Object for session ${sessionId}`);

    } catch (error) {
      console.error(`💥 Failed to initiate Durable Object analysis for session ${sessionId}:`, error);

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
          { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
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
      { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
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
