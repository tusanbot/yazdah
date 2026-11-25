import { app } from "./server.js";

export default {
  async fetch(request: Request): Promise<Response> {
    // Do not share Fastify's readiness promise across Worker requests. A promise
    // created in one request can outlive that request in Cloudflare's runtime.
    await app.ready();

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
