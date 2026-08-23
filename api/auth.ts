import type { Request, Response } from './_shared'

export default async function handler(req: Request, res: Response) {
  const action = typeof req.body === 'object' && req.body && 'action' in req.body ? (req.body as { action?: unknown }).action : null
  const endpoint = action === 'signup' ? 'sign-up/email' : action === 'signin' ? 'sign-in/email' : action === 'signout' ? 'sign-out' : 'get-session'
  const baseUrl = process.env.NEON_AUTH_BASE_URL
  if (!baseUrl) return res.status(503).json({ error: 'Authentication unavailable' })
  try {
    const payload = endpoint === 'get-session' || endpoint === 'sign-out' ? undefined : JSON.stringify(req.body)
    const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/${endpoint}`, {
      method: endpoint === 'get-session' ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(req.headers.cookie ? { cookie: String(req.headers.cookie) } : {}) },
      body: payload,
    })
    const setCookie = upstream.headers.get('set-cookie')
    if (setCookie && typeof res.setHeader === 'function') res.setHeader('set-cookie', setCookie)
    const data = await upstream.json().catch(() => ({}))
    return res.status(upstream.status).json(data)
  } catch {
    return res.status(503).json({ error: 'Authentication unavailable' })
  }
}
