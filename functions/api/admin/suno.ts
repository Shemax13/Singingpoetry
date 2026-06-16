import { requireAuth, jsonResponse, handleOptions } from '../../_utils/auth';
import { fetchSunoTrack, parseSunoUrl } from '../../_utils/suno';
import type { Env } from '../../_utils/types';

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!await requireAuth(context.request, context.env)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }
  try {
    const body = await context.request.json<{ url: string }>();
    const url = parseSunoUrl(body.url);
    if (!url) {
      return jsonResponse({ ok: false, error: 'Invalid Suno URL' }, 400);
    }
    const track = await fetchSunoTrack(url);
    if (!track) {
      return jsonResponse({ ok: false, error: 'Could not fetch track from Suno' }, 404);
    }
    return jsonResponse({ ok: true, data: track });
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
}

export function onRequestOptions(context: { request: Request }): Response {
  return handleOptions(context.request) || new Response(null, { status: 204 });
}
