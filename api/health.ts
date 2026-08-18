import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    if (!process.env.DATABASE_URL) return res.status(503).json({ ok:false, error:'DATABASE_URL is not configured' });
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`select now() as server_time`;
    return res.status(200).json({ ok:true, database:'neon', serverTime:rows[0].server_time });
  } catch {
    return res.status(500).json({ ok:false, error:'Database connection failed' });
  }
}
