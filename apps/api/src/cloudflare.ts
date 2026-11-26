import { app } from "./server.js";

// Start Fastify's readiness lifecycle once while the Worker module is being
// evaluated. Do not await it at module scope (Workers reject top-level await),
// and do not create it inside fetch (the request context may end before it
// settles). All requests share this module-scoped initialization promise.
const appReady = app.ready();

export default {
  async fetch(request: Request): Promise<Response> {
    await appReady;
    const url = new URL(request.url);
    const payload = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text();
    const response = await app.inject({
      method: request.method,
      url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers.entries()),
      payload,
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as HeadersInit,
    });
  },
};

// Keep the historical Durable Object class export available while existing
// Cloudflare instances still reference its namespace. The current API no
// longer routes work through this class; retain a safe, explicit tombstone.
export class MatchCoordinator {
  async fetch(request: Request): Promise<Response> {
    void request;
    return new Response("MatchCoordinator is retired.", { status: 410 });
  }
}
