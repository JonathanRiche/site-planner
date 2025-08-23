import { OptimizedCloudflareBrowserService } from '../lib/optimized-browser-service';
import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";

export default async function browserSessionsHandler({ request }: RequestInfo<any, AppContext>) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'GET' },
    });
  }

  try {
    const browserService = new OptimizedCloudflareBrowserService();
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    switch (action) {
      case 'status':
        const status = await browserService.getSessionStatus();
        return new Response(JSON.stringify(status, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      
      case 'cleanup':
        const cleanupResult = await browserService.triggerSessionCleanup();
        return new Response(JSON.stringify(cleanupResult, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      
      default:
        // Default to status
        const defaultStatus = await browserService.getSessionStatus();
        return new Response(JSON.stringify(defaultStatus, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Browser sessions API error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Browser sessions failed',
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}