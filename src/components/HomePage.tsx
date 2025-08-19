'use client';

import { useState } from 'react';

interface AnalysisResult {
  pageAnalysis: {
    url: string;
    title: string;
    description?: string;
    headings: { level: number; text: string }[];
    keyContent: string;
    technicalStack: {
      framework?: string;
      cms?: string;
      analytics: string[];
    };
    seoMetrics: {
      hasMetaTitle: boolean;
      hasMetaDescription: boolean;
      hasStructuredData: boolean;
      imageCount: number;
      linkCount: number;
    };
  };
  lytxRecommendations: {
    tagPlacements: {
      location: string;
      reason: string;
      priority: string;
      code: string;
    }[];
    trackingEvents: {
      event: string;
      trigger: string;
      implementation: string;
    }[];
    optimizations: {
      category: string;
      suggestion: string;
      impact: string;
    }[];
  };
  analysisId: string;
  timestamp: string;
}

export function HomePage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyzeWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.statusText}`);
      }

      const analysisResult: AnalysisResult = await response.json();
      setResult(analysisResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Site Planner
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Intelligent website analysis for optimal LYTX.io analytics integration. 
            Get comprehensive recommendations for tag placement, tracking, and optimization.
          </p>
        </header>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <form onSubmit={analyzeWebsite} className="space-y-4">
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
                Website URL to analyze
              </label>
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !url}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Analyzing...' : 'Analyze Website'}
            </button>
          </form>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Analysis Error</h3>
                <div className="mt-2 text-sm text-red-700">{error}</div>
                {error.includes('blocked') && (
                  <div className="mt-3 text-sm text-red-600">
                    <strong>Bot Protection Detected:</strong> This website is using security measures that may block automated analysis. 
                    This is common with sites protected by Cloudflare, Imperva, or other security services.
                    <br />
                    <em>Tip: Try analyzing a different page on the same domain or wait a few minutes before retrying.</em>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Page Analysis</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Basic Information</h3>
                  <p><strong>Title:</strong> {result.pageAnalysis.title}</p>
                  {result.pageAnalysis.description && (
                    <p><strong>Description:</strong> {result.pageAnalysis.description}</p>
                  )}
                  <p><strong>URL:</strong> {result.pageAnalysis.url}</p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">Technical Stack</h3>
                  {result.pageAnalysis.technicalStack.framework && (
                    <p><strong>Framework:</strong> {result.pageAnalysis.technicalStack.framework}</p>
                  )}
                  {result.pageAnalysis.technicalStack.cms && (
                    <p><strong>CMS:</strong> {result.pageAnalysis.technicalStack.cms}</p>
                  )}
                  <p><strong>Analytics:</strong> {result.pageAnalysis.technicalStack.analytics.join(', ') || 'None detected'}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">LYTX Implementation Recommendations</h2>
              
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">Tag Placements</h3>
                  <div className="space-y-4">
                    {result.lytxRecommendations.tagPlacements.map((placement, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-medium text-gray-800">Location: {placement.location}</h4>
                          <span className={`px-2 py-1 text-xs rounded ${
                            placement.priority === 'high' 
                              ? 'bg-red-100 text-red-800' 
                              : placement.priority === 'medium'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {placement.priority} priority
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{placement.reason}</p>
                        <pre className="bg-gray-50 p-3 rounded text-sm overflow-x-auto">
                          <code>{placement.code}</code>
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">Tracking Events</h3>
                  <div className="space-y-3">
                    {result.lytxRecommendations.trackingEvents.map((event, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-800">{event.event}</h4>
                        <p className="text-sm text-gray-600 mb-2">Trigger: {event.trigger}</p>
                        <pre className="bg-gray-50 p-2 rounded text-sm">
                          <code>{event.implementation}</code>
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-3">Optimization Suggestions</h3>
                  <div className="space-y-3">
                    {result.lytxRecommendations.optimizations.map((optimization, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-medium text-gray-800 capitalize">{optimization.category}</h4>
                          <span className={`px-2 py-1 text-xs rounded ${
                            optimization.impact === 'high' 
                              ? 'bg-red-100 text-red-800' 
                              : optimization.impact === 'medium'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {optimization.impact} impact
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{optimization.suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}