import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "./Document";
import { HomePage } from "./components/HomePage";
import { SessionPage } from "./components/SessionPage";
// import analyzeCrawlHandler from "./api/analyze-crawl"; // ARCHIVED - unused
// import crawlLinksHandler from "./api/crawl-links"; // ARCHIVED - unused
import analyzeHtmlHandler from "./api/analyze-html";
// import browserSessionsHandler from "./api/browser-sessions"; // ARCHIVED - unused
import sessionHandler from "./api/session";
import { SimpleBrowserSessionManager } from "./lib/simple-session-manager";
import { SessionAnalysisManager } from "./lib/session-analysis-manager";
import { SiteAnalysisDO } from "./lib/site-analysis-do";
export type AppContext = {
};
export default defineApp([
	render(Document, [

		route("/", () => <HomePage />),
		route("/session/:sessionId", ({ params }) => <SessionPage sessionId={params.sessionId} />),
		route("/api/analyze-html", analyzeHtmlHandler),

		route("/api/session", sessionHandler),
		route("/api/session/:sessionId", sessionHandler),

		// route("/api/analyze", analyzeHandler),
		// route("/api/browser-sessions", browserSessionsHandler),
		// ARCHIVED - unused endpoints
		// route("/api/analyze-crawl", analyzeCrawlHandler),
		// route("/api/crawl-links", crawlLinksHandler),

	]),
]);

// Export Durable Objects
export { SimpleBrowserSessionManager as BrowserSessionManager };
export { SessionAnalysisManager };
export { SiteAnalysisDO };
