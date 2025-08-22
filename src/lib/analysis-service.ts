import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { CloudflareBrowserService } from './browser-service';
import { SiteAnalysisResult, PageAnalysis, LYTXRecommendation, PageAnalysisSchema, LYTXRecommendationSchema } from './types';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});



// Detect presence of LYTX script in raw HTML
function hasLytxScriptTag(html: string): boolean {
  if (!html) return false;
  return /<script[^>]+src=["'][^"']*(?:lytx\.io\/lytx\.js|analytics\.lytx\.io)[^"']*["'][^>]*>/i.test(html)
    || /window\.(?:lytx|lytxApi)\b/i.test(html);
}

export class SiteAnalysisService {
  private browserService: CloudflareBrowserService;

  constructor() {
    this.browserService = new CloudflareBrowserService();
  }

  async analyzeSite(url: string): Promise<SiteAnalysisResult> {
    const analysisId = crypto.randomUUID();
    const startTime = Date.now();
    
    console.log(`🔍 [${analysisId}] Starting site analysis for: ${url}`, {
      timestamp: new Date().toISOString(),
      url
    });
    
    try {
      // Step 1: Fetch the webpage HTML using Cloudflare Browser Rendering
      console.log(`🌐 [${analysisId}] Step 1: Fetching HTML content...`);
      
      let pageContent;
      try {
        pageContent = await this.browserService.renderPage(url, {
          takeScreenshot: false,
          useCache: true,
        });
      } catch (error) {
        // If we get blocked content error, clear cache and retry once without cache
        if (error instanceof Error && error.message.includes('blocked')) {
          console.warn(`🚫 [${analysisId}] Got blocked content, clearing cache and retrying...`);
          await this.browserService.clearCache(url, { takeScreenshot: false, useCache: true });
          
          // Retry without cache
          console.log(`🔄 [${analysisId}] Retrying without cache...`);
          pageContent = await this.browserService.renderPage(url, {
            takeScreenshot: false,
            useCache: false,
          });
        } else {
          console.error(`💥 [${analysisId}] Browser service error:`, error);
          throw error;
        }
      }
      
      console.log(`✅ [${analysisId}] HTML content fetched successfully`, {
        htmlLength: pageContent.html.length,
        title: pageContent.title,
        loadTime: pageContent.metadata.loadTime
      });

      // Step 2: Analyze page structure using AI with structured output
      console.log(`🤖 [${analysisId}] Step 2: Analyzing page structure with AI...`);
      const lytxDetected = hasLytxScriptTag(pageContent.html);
      if (lytxDetected) {
        console.log(`🔎 [${analysisId}] Detected existing LYTX script tag in HTML.`);
      }
      const pageAnalysisResult = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: PageAnalysisSchema,
        prompt: `Analyze this webpage HTML: ${pageContent.url}

HTML (truncated if needed):
${pageContent.html.substring(0, 8000)} ${pageContent.html.length > 8000 ? '... (truncated)' : ''}

LYTX Detection: ${lytxDetected ? 'Existing LYTX script detected - include "LYTX" in analytics array' : 'No LYTX script detected'}`,
      });

      // Extract structured data from AI response
      console.log(`📊 [${analysisId}] Processing structured analysis response...`);
      
      let pageAnalysis: PageAnalysis = pageAnalysisResult.object;

      // Ensure analytics reflects detected LYTX script
      if (lytxDetected && !pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        pageAnalysis.technicalStack.analytics = [...pageAnalysis.technicalStack.analytics, 'LYTX'];
      }
      console.log(`✅ [${analysisId}] Page analysis completed successfully:`, {
        title: pageAnalysis.title,
        headingsCount: pageAnalysis.headings.length,
        framework: pageAnalysis.technicalStack.framework,
        cms: pageAnalysis.technicalStack.cms,
        analyticsCount: pageAnalysis.technicalStack.analytics.length
      });

      // Step 3: Generate LYTX recommendations
      console.log(`🏷️ [${analysisId}] Step 3: Generating LYTX recommendations...`);
      const recommendationsResult = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: LYTXRecommendationSchema,
        prompt: `You are a LYTX analytics expert. Generate LYTX implementation recommendations based on this page analysis.

IMPORTANT IMPLEMENTATION RULES:
1) The core tag MUST use: <script defer data-domain="<domain>" src="https://lytx.io/lytx.js?account=<ACCOUNT>"></script>
2) For custom events, ALWAYS use: window.lytxApi.event('<ACCOUNT>', 'web', '<event_name>')
3) Do NOT use 'lytrack', 'analytics.lytx.io', or other vendors. Use only LYTX patterns above.
4) Provide minimal, copy-pasteable code that matches these rules.

Page Analysis Data:
${JSON.stringify(pageAnalysis, null, 2)}

LYTX Detection: ${pageAnalysis.technicalStack.analytics.includes('LYTX') ? 'LYTX already installed - acknowledge in tagPlacements and avoid duplicating core tag' : 'LYTX not detected - include core tag placement'}

Focus on conversion impact and provide clear implementation guidance.`,
      });

      // Extract structured recommendations from AI response
      console.log(`📋 [${analysisId}] Processing LYTX recommendations...`);
      
      let lytxRecommendations: LYTXRecommendation = recommendationsResult.object;

      // Enforce vendor-specific implementation details post-parse as a safeguard
      lytxRecommendations.tagPlacements = lytxRecommendations.tagPlacements.map(p => ({
        ...p,
        code: p.code
          .replace(/analytics\.lytx\.io\S*/gi, 'lytx.io/lytx.js?account=<ACCOUNT>')
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      lytxRecommendations.trackingEvents = lytxRecommendations.trackingEvents.map(e => ({
        ...e,
        implementation: e.implementation
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      // If LYTX already installed, avoid duplicate core tag recommendations and add acknowledgement
      if (pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        const isCoreTagCode = (code: string) => /lytx\.io\/lytx\.js|analytics\.lytx\.io/i.test(code);
        let placements = lytxRecommendations.tagPlacements.filter(p => !isCoreTagCode(p.code));
        const acknowledgment = {
          location: 'head' as const,
          reason: 'LYTX appears to be already installed on this site. Verify configuration and ensure events are firing as expected.',
          priority: 'low' as const,
          code: ''
        };
        placements = [acknowledgment, ...placements];
        lytxRecommendations.tagPlacements = placements;
      }

      console.log(`✅ [${analysisId}] LYTX recommendations completed successfully:`, {
        tagPlacementsCount: lytxRecommendations.tagPlacements.length,
          trackingEventsCount: lytxRecommendations.trackingEvents.length,
          optimizationsCount: lytxRecommendations.optimizations.length
        });

      // Step 4: Combine results
      console.log(`📦 [${analysisId}] Step 4: Combining results...`);
      const totalTime = Date.now() - startTime;
      
      const analysisResult: SiteAnalysisResult = {
        pageAnalysis: {
          ...pageAnalysis,
          // Add metadata about potential bot protection
          ...(pageAnalysis.title.toLowerCase().includes('attention required') && {
            technicalStack: {
              ...pageAnalysis.technicalStack,
              analytics: [...pageAnalysis.technicalStack.analytics, 'Bot Protection Detected']
            }
          })
        },
        lytxRecommendations,
        analysisId,
        timestamp: new Date().toISOString(),
      };

      console.log(`🏁 [${analysisId}] Site analysis completed successfully in ${totalTime}ms`, {
        url,
        totalTime: `${totalTime}ms`,
        htmlSize: pageContent.html.length,
        pageTitle: pageAnalysis.title,
        recommendationsGenerated: lytxRecommendations.tagPlacements.length + lytxRecommendations.trackingEvents.length + lytxRecommendations.optimizations.length
      });

      return analysisResult;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`💥 [${analysisId}] Site analysis failed after ${totalTime}ms:`, {
        url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
        totalTime: `${totalTime}ms`,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async analyzeMultiplePages(urls: string[]): Promise<SiteAnalysisResult[]> {
    const results: SiteAnalysisResult[] = [];
    
    for (const url of urls) {
      try {
        const result = await this.analyzeSite(url);
        results.push(result);
      } catch (error) {
        console.error(`Failed to analyze ${url}:`, error);
        // Continue with other URLs even if one fails
      }
    }
    
    return results;
  }

  // Analyze provided HTML directly (no fetching/rendering)
  async analyzeProvidedHtml(url: string, html: string): Promise<SiteAnalysisResult> {
    const analysisId = crypto.randomUUID();
    const startTime = Date.now();
    console.log(`🔍 [${analysisId}] Starting direct HTML analysis for: ${url}`);

    // Prepare a faux pageContent
    const pageContent = {
      html,
      title: (html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || 'No title found').trim(),
      url,
      metadata: {
        viewport: { width: 1280, height: 720 },
        loadTime: 0,
        timestamp: new Date().toISOString(),
      },
    } as const;

    try {
      // Reuse the same AI steps as analyzeSite
      console.log(`🤖 [${analysisId}] Analyzing page structure with AI (provided HTML)...`);
      const lytxDetected = hasLytxScriptTag(pageContent.html);
      const pageAnalysisResult = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: PageAnalysisSchema,
        prompt: `Analyze this webpage HTML: ${pageContent.url}

HTML (truncated if needed):
${pageContent.html.substring(0, 8000)} ${pageContent.html.length > 8000 ? '... (truncated)' : ''}

LYTX Detection: ${lytxDetected ? 'Existing LYTX script detected - include "LYTX" in analytics array' : 'No LYTX script detected'}`,
      });

      let pageAnalysis: PageAnalysis = pageAnalysisResult.object;
      if (lytxDetected && !pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        pageAnalysis.technicalStack.analytics = [...pageAnalysis.technicalStack.analytics, 'LYTX'];
      }

      // Recommendations
      const recommendationsResult = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: LYTXRecommendationSchema,
        prompt: `You are a LYTX analytics expert. Generate LYTX implementation recommendations based on this page analysis.

IMPORTANT IMPLEMENTATION RULES:
1) The core tag MUST use: <script defer data-domain="<domain>" src="https://lytx.io/lytx.js?account=<ACCOUNT>"></script>
2) For custom events, ALWAYS use: window.lytxApi.event('<ACCOUNT>', 'web', '<event_name>')
3) Do NOT use 'lytrack', 'analytics.lytx.io', or other vendors. Use only LYTX patterns above.
4) Provide minimal, copy-pasteable code that matches these rules.

Page Analysis Data:
${JSON.stringify(pageAnalysis, null, 2)}

LYTX Detection: ${pageAnalysis.technicalStack.analytics.includes('LYTX') ? 'LYTX already installed - acknowledge in tagPlacements and avoid duplicating core tag' : 'LYTX not detected - include core tag placement'}

Focus on conversion impact and provide clear implementation guidance.`,
      });

      let lytxRecommendations: LYTXRecommendation = recommendationsResult.object;
      lytxRecommendations.tagPlacements = lytxRecommendations.tagPlacements.map(p => ({
        ...p,
        code: p.code
          .replace(/analytics\.lytx\.io\S*/gi, 'lytx.io/lytx.js?account=<ACCOUNT>')
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      lytxRecommendations.trackingEvents = lytxRecommendations.trackingEvents.map(e => ({
        ...e,
        implementation: e.implementation
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      if (pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        const isCoreTagCode = (code: string) => /lytx\.io\/lytx\.js|analytics\.lytx\.io/i.test(code);
        let placements = lytxRecommendations.tagPlacements.filter(p => !isCoreTagCode(p.code));
        placements = [{
          location: 'head' as const,
          reason: 'LYTX appears to be already installed on this site. Verify configuration and ensure events are firing as expected.',
          priority: 'low' as const,
          code: ''
        }, ...placements];
        lytxRecommendations.tagPlacements = placements;
      }

      const totalTime = Date.now() - startTime;
      const analysisResult: SiteAnalysisResult = {
        pageAnalysis,
        lytxRecommendations,
        analysisId,
        timestamp: new Date().toISOString(),
      };
      console.log(`🏁 [${analysisId}] Direct HTML analysis completed in ${totalTime}ms`);
      return analysisResult;
    } catch (error) {
      console.error(`💥 [${analysisId}] Direct HTML analysis failed:`, error);
      throw error;
    }
  }
}