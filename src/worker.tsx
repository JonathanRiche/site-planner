import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "./Document";
import { HomePage } from "./components/HomePage";
import { SessionPage } from "./components/SessionPage";
import analyzeCrawlHandler from "./api/analyze-crawl";
import crawlLinksHandler from "./api/crawl-links";
import analyzeHtmlHandler from "./api/analyze-html";
import browserSessionsHandler from "./api/browser-sessions";
import sessionHandler from "./api/session";
import { SimpleBrowserSessionManager } from "./lib/simple-session-manager";
import { SessionAnalysisManager } from "./lib/session-analysis-manager";
export type AppContext = {
	env: Env;
};
export default defineApp([
	render(Document, [
		route("/", () => <HomePage />),
		route("/session/:sessionId", ({ params }) => <SessionPage sessionId={params.sessionId} />),
		//NOTE: This endpoint might be uselss
		// route("/api/analyze", analyzeHandler),
		route("/api/analyze-crawl", analyzeCrawlHandler),
		route("/api/crawl-links", crawlLinksHandler),
		route("/api/analyze-html", analyzeHtmlHandler),
		route("/api/browser-sessions", browserSessionsHandler),
		//NOTE: Entry point for session analysis
		route("/api/session", sessionHandler),
		route("/api/session/:sessionId", sessionHandler),
	]),
]);

// Export Durable Objects
export { SimpleBrowserSessionManager as BrowserSessionManager };
export { SessionAnalysisManager };
