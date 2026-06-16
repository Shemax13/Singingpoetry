import type { ApiResponse, Env, D1Database } from './types';

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function login(password: string, storedPassword: string, db: D1Database): Promise<ApiResponse<{ token: string }>> {
  if (password !== storedPassword) {
    return { ok: false, error: 'Invalid password' };
  }
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    'INSERT INTO admin_sessions (id, expires_at) VALUES (?, ?)'
  ).bind(token, expiresAt).run();
  return { ok: true, data: { token } };
}

export async function requireAuth(request: Request, env: Env): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const result = await env.DB.prepare(
    'SELECT id FROM admin_sessions WHERE id = ? AND expires_at > datetime(\'now\')'
  ).bind(token).first();
  return !!result;
}

export function corsHeaders(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export function handleOptions(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders(),
    });
  }
  return null;
}
