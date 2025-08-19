import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { CloudflareBrowserService } from './browser-service';
import { SiteAnalysisResult, PageAnalysis, LYTXRecommendation } from './types';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
      const pageAnalysisResult = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content: `You are a website analysis expert. Analyze the provided HTML and return a JSON object with the following structure:
{
  "url": "string",
  "title": "string", 
  "description": "string (optional)",
  "headings": [{"level": number, "text": "string"}],
  "keyContent": "string (first 500 chars of main content)",
  "technicalStack": {
    "framework": "string (optional - React, Next.js, etc)",
    "cms": "string (optional - WordPress, Shopify, etc)", 
    "analytics": ["string array of detected analytics tools"]
  },
  "seoMetrics": {
    "hasMetaTitle": boolean,
    "hasMetaDescription": boolean,
    "hasStructuredData": boolean,
    "imageCount": number,
    "linkCount": number
  }
}

Only return valid JSON, no other text.`,
          },
          {
            role: 'user',
            content: `Please analyze this webpage HTML: ${pageContent.url}

HTML (truncated if needed):
${pageContent.html.substring(0, 8000)} ${pageContent.html.length > 8000 ? '... (truncated)' : ''}`,
          },
        ],
      });

      // Parse the JSON response
      console.log(`📊 [${analysisId}] Parsing AI analysis response...`, {
        responseLength: pageAnalysisResult.text.length,
        preview: pageAnalysisResult.text.substring(0, 200)
      });
      
      let pageAnalysis: PageAnalysis;
      try {
        pageAnalysis = JSON.parse(pageAnalysisResult.text);
        console.log(`✅ [${analysisId}] Page analysis parsed successfully:`, {
          title: pageAnalysis.title,
          headingsCount: pageAnalysis.headings.length,
          framework: pageAnalysis.technicalStack.framework,
          cms: pageAnalysis.technicalStack.cms,
          analyticsCount: pageAnalysis.technicalStack.analytics.length
        });
      } catch (parseError) {
        console.error(`💥 [${analysisId}] Failed to parse page analysis JSON:`, {
          error: parseError,
          rawResponse: pageAnalysisResult.text.substring(0, 500)
        });
        throw new Error('AI returned invalid JSON for page analysis');
      }

      // Step 3: Generate LYTX recommendations
      console.log(`🏷️ [${analysisId}] Step 3: Generating LYTX recommendations...`);
      const recommendationsResult = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content: `You are a LYTX analytics expert. Based on page analysis data, provide LYTX implementation recommendations in this JSON format:
{
  "tagPlacements": [{
    "location": "head|body_start|body_end|after_content",
    "reason": "string explaining why this placement",
    "priority": "high|medium|low", 
    "code": "string with actual implementation code"
  }],
  "trackingEvents": [{
    "event": "string event name",
    "trigger": "string describing when it triggers", 
    "implementation": "string with code example"
  }],
  "optimizations": [{
    "category": "performance|user_experience|conversion",
    "suggestion": "string describing the optimization",
    "impact": "high|medium|low"
  }]
}

Focus on LYTX-specific implementation. Only return valid JSON, no other text.`,
          },
          {
            role: 'user',
            content: `Generate LYTX recommendations for this page analysis:
${JSON.stringify(pageAnalysis, null, 2)}

Consider the technical stack, content type, and existing analytics when making recommendations.`,
          },
        ],
      });

      // Parse the LYTX recommendations
      console.log(`📋 [${analysisId}] Parsing LYTX recommendations...`, {
        responseLength: recommendationsResult.text.length
      });
      
      let lytxRecommendations: LYTXRecommendation;
      try {
        lytxRecommendations = JSON.parse(recommendationsResult.text);
        console.log(`✅ [${analysisId}] LYTX recommendations parsed successfully:`, {
          tagPlacementsCount: lytxRecommendations.tagPlacements.length,
          trackingEventsCount: lytxRecommendations.trackingEvents.length,
          optimizationsCount: lytxRecommendations.optimizations.length
        });
      } catch (parseError) {
        console.error(`💥 [${analysisId}] Failed to parse LYTX recommendations JSON:`, {
          error: parseError,
          rawResponse: recommendationsResult.text.substring(0, 500)
        });
        throw new Error('AI returned invalid JSON for LYTX recommendations');
      }

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
}