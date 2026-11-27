import type { APIRequestContext } from "@playwright/test";

/** Clear the shared auth limiter on the Playwright API. The route is off in production. */
export async function resetAuthGuard(request: APIRequestContext) {
  const res = await request.post("http://127.0.0.1:8790/api/v1/debug/auth-guard/reset");
  if (!res.ok()) throw new Error(`auth guard reset failed: ${res.status()}`);
}
