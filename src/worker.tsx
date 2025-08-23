import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "./Document";
import { HomePage } from "./components/HomePage";
import analyzeHandler from "./api/analyze";
import analyzeCrawlHandler from "./api/analyze-crawl";
import crawlLinksHandler from "./api/crawl-links";
import analyzeHtmlHandler from "./api/analyze-html";
export type AppContext = {
	env: Env;
};
export default defineApp([
	render(Document, [
		route("/", () => <HomePage />),
		route("/api/analyze", analyzeHandler),
		route("/api/analyze-crawl", analyzeCrawlHandler),
		route("/api/crawl-links", crawlLinksHandler),
		route("/api/analyze-html", analyzeHtmlHandler),
	]),
]);
