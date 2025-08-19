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
    try {
      // Step 1: Fetch the webpage HTML using Cloudflare Browser Rendering
      console.log(`Fetching HTML for ${url}...`);
      
      let pageContent;
      try {
        pageContent = await this.browserService.renderPage(url, {
          takeScreenshot: false,
          useCache: true,
        });
      } catch (error) {
        // If we get blocked content error, clear cache and retry once without cache
        if (error instanceof Error && error.message.includes('blocked')) {
          console.warn('Got blocked content, clearing cache and retrying...');
          await this.browserService.clearCache(url, { takeScreenshot: false, useCache: true });
          
          // Retry without cache
          pageContent = await this.browserService.renderPage(url, {
            takeScreenshot: false,
            useCache: false,
          });
        } else {
          throw error;
        }
      }

      // Step 2: Analyze page structure using AI with structured output
      console.log('Analyzing page structure with AI...');
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
      let pageAnalysis: PageAnalysis;
      try {
        pageAnalysis = JSON.parse(pageAnalysisResult.text);
      } catch (parseError) {
        console.error('Failed to parse page analysis JSON:', parseError);
        throw new Error('AI returned invalid JSON for page analysis');
      }

      // Step 3: Generate LYTX recommendations
      console.log('Generating LYTX recommendations...');
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
      let lytxRecommendations: LYTXRecommendation;
      try {
        lytxRecommendations = JSON.parse(recommendationsResult.text);
      } catch (parseError) {
        console.error('Failed to parse LYTX recommendations JSON:', parseError);
        throw new Error('AI returned invalid JSON for LYTX recommendations');
      }

      // Step 4: Combine results
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
        analysisId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      return analysisResult;
    } catch (error) {
      console.error('Site analysis failed:', error);
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