import { tool } from 'ai';
import { z } from 'zod';
import { PageAnalysisSchema, LYTXRecommendationSchema } from './types';

export const analyzePageStructureTool = tool({
  description: 'Analyze webpage HTML structure, content, and technical stack',
  inputSchema: z.object({
    html: z.string(),
    url: z.string(),
  }),
  outputSchema: PageAnalysisSchema,
  execute: async ({ html, url }) => {
    // Parse HTML to extract key information
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'No title found';
    
    const descriptionMatch = html.match(/<meta[^>]*name=['""]description['""][^>]*content=['""]([^'"]*)['""][^>]*>/i);
    const description = descriptionMatch ? descriptionMatch[1] : undefined;
    
    // Extract headings
    const headingMatches = html.match(/<(h[1-6])[^>]*>(.*?)<\/h[1-6]>/gi) || [];
    const headings = headingMatches.map(match => {
      const levelMatch = match.match(/<h([1-6])/i);
      const textMatch = match.match(/>(.*?)<\/h[1-6]>/i);
      return {
        level: levelMatch ? parseInt(levelMatch[1]) : 1,
        text: textMatch ? textMatch[1].replace(/<[^>]*>/g, '').trim() : '',
      };
    });
    
    // Extract key content (first few paragraphs)
    const paragraphs = html.match(/<p[^>]*>(.*?)<\/p>/gi) || [];
    const keyContent = paragraphs
      .slice(0, 3)
      .map(p => p.replace(/<[^>]*>/g, '').trim())
      .join(' ')
      .substring(0, 500);
    
    // Detect technical stack
    const hasReact = /react/i.test(html);
    const hasNext = /next\.js|_next/i.test(html);
    const hasWordPress = /wp-content|wordpress/i.test(html);
    const hasShopify = /shopify|cdn\.shopify/i.test(html);
    
    let framework: string | undefined;
    let cms: string | undefined;
    
    if (hasNext) framework = 'Next.js';
    else if (hasReact) framework = 'React';
    
    if (hasWordPress) cms = 'WordPress';
    else if (hasShopify) cms = 'Shopify';
    
    // Detect existing analytics
    const analytics: string[] = [];
    if (/google-analytics|gtag|ga\(/i.test(html)) analytics.push('Google Analytics');
    if (/gtm\.js|googletagmanager/i.test(html)) analytics.push('Google Tag Manager');
    if (/facebook\.net\/tr|fbevents/i.test(html)) analytics.push('Facebook Pixel');
    if (/lytx\.io|lytx-analytics/i.test(html)) analytics.push('LYTX');
    
    // SEO metrics
    const hasMetaTitle = !!titleMatch;
    const hasMetaDescription = !!descriptionMatch;
    const hasStructuredData = /application\/ld\+json|schema\.org/i.test(html);
    const imageCount = (html.match(/<img[^>]*>/gi) || []).length;
    const linkCount = (html.match(/<a[^>]*href/gi) || []).length;
    
    return {
      url,
      title,
      description,
      headings,
      keyContent,
      technicalStack: {
        framework,
        cms,
        analytics,
      },
      seoMetrics: {
        hasMetaTitle,
        hasMetaDescription,
        hasStructuredData,
        imageCount,
        linkCount,
      },
    };
  },
});

export const generateLYTXRecommendationsTool = tool({
  description: 'Generate LYTX analytics tag placement and tracking recommendations based on page analysis',
  inputSchema: PageAnalysisSchema,
  outputSchema: LYTXRecommendationSchema,
  execute: async (pageAnalysis) => {
    const { technicalStack, seoMetrics, headings } = pageAnalysis;
    
    // Generate tag placements based on technical stack
    const tagPlacements = [];
    
    // Core LYTX tag placement
    tagPlacements.push({
      location: 'head' as const,
      reason: 'Core LYTX analytics tracking script for page views and user sessions',
      priority: 'high' as const,
      code: `<script defer data-domain="${new URL(pageAnalysis.url).hostname}" src="https://analytics.lytx.io/js/script.js"></script>`,
    });
    
    // Enhanced tracking for content sites
    if (headings.length > 3) {
      tagPlacements.push({
        location: 'body_end' as const,
        reason: 'Enhanced content engagement tracking for article/blog content',
        priority: 'medium' as const,
        code: `<script>
  window.lytx = window.lytx || [];
  window.lytx.push(['trackEngagement', {
    content_type: 'article',
    sections: ${headings.length}
  }]);
</script>`,
      });
    }
    
    // E-commerce specific tracking
    if (technicalStack.cms === 'Shopify') {
      tagPlacements.push({
        location: 'body_end' as const,
        reason: 'E-commerce conversion tracking for Shopify store',
        priority: 'high' as const,
        code: `<script>
  window.lytx = window.lytx || [];
  window.lytx.push(['enableEcommerce']);
</script>`,
      });
    }
    
    // Generate tracking events
    const trackingEvents = [
      {
        event: 'page_view',
        trigger: 'Page load',
        implementation: 'Automatic with core script',
      },
      {
        event: 'scroll_depth',
        trigger: '25%, 50%, 75%, 100% scroll',
        implementation: 'window.lytx.push([\'trackScroll\'])',
      },
    ];
    
    // Add form tracking if likely to have forms
    if (pageAnalysis.keyContent.includes('contact') || pageAnalysis.keyContent.includes('subscribe')) {
      trackingEvents.push({
        event: 'form_submit',
        trigger: 'Form submission',
        implementation: 'window.lytx.push([\'trackEvent\', \'form_submit\', { form_type: \'contact\' }])',
      });
    }
    
    // Generate optimizations
    const optimizations = [];
    
    if (!seoMetrics.hasMetaDescription) {
      optimizations.push({
        category: 'user_experience' as const,
        suggestion: 'Add meta description to improve social sharing and search result snippets',
        impact: 'medium' as const,
      });
    }
    
    if (technicalStack.analytics.length > 2) {
      optimizations.push({
        category: 'performance' as const,
        suggestion: 'Consider consolidating analytics tools to reduce page load impact',
        impact: 'medium' as const,
      });
    }
    
    if (!technicalStack.analytics.includes('LYTX')) {
      optimizations.push({
        category: 'conversion' as const,
        suggestion: 'Implement LYTX analytics for privacy-compliant tracking without cookies',
        impact: 'high' as const,
      });
    }
    
    return {
      tagPlacements,
      trackingEvents,
      optimizations,
    };
  },
});