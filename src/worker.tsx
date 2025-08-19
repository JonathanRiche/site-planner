import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "./Document";
export default defineApp([
	render(Document, [
		route("/", () => new Response("Hello, World!")),

	]),
]);
