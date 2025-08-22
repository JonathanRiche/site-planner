import { SiteAnalysisService } from '../lib/analysis-service';
import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";
import { getDb, searches } from '../lib/db';

export default async function analyzeHtmlHandler({ request }: RequestInfo<any, AppContext>) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
    });
  }

  try {
    const body: { url: string; html: string } = await request.json();
    const { url, html } = body;

    if (!url || !html) {
      return new Response(JSON.stringify({ error: 'Both url and html are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const analysisService = new SiteAnalysisService();
    const result = await analysisService.analyzeProvidedHtml(url, html);
    // Persist search
    try {
      const db = getDb();
      await db.insert(searches).values({
        id: result.analysisId,
        url: url
      });
    } catch (dbErr) {
      console.warn('Failed to persist search:', dbErr);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Analyze HTML API error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Analyze HTML failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
