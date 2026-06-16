import { login, jsonResponse, handleOptions } from '../../_utils/auth';
import type { Env } from '../../_utils/types';

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  try {
    const body = await context.request.json<{ password: string }>();
    const result = await login(body.password, context.env.ADMIN_PASSWORD, context.env.DB);
    return jsonResponse(result, result.ok ? 200 : 401);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export function onRequestOptions(context: { request: Request }): Response {
  const result = handleOptions(context.request);
  return result || new Response(null, { headers: { 'Allow': 'POST, OPTIONS' } });
}
