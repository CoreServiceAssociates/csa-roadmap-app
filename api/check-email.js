export default async function handler(req, res) {

  // ── CORS ────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const debugMode = req.body?.debug === true;
  const log = (...args) => { if (debugMode) console.log('[check-email]', ...args); };

  try {
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: 'Missing required field: email' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    log('Checking email:', email);

    const sbRes = await fetch(
      `${supabaseUrl}/rest/v1/submissions?email=eq.${encodeURIComponent(email)}&limit=1&order=created_at.desc`,
      {
        headers: {
          'apikey':        supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type':  'application/json'
        }
      }
    );

    if (!sbRes.ok) {
      const err = await sbRes.text();
      console.error('[check-email] Supabase error:', err);
      return res.status(500).json({ error: 'Database lookup failed' });
    }

    const submissions = await sbRes.json();
    log('Supabase response', submissions);

    if (!submissions || submissions.length === 0) {
      return res.status(200).json({ returning: false });
    }

    const sub = submissions[0];
    return res.status(200).json({
      returning:    true,
      firstName:    sub.first_name,
      submissionId: sub.id,
      pdfUrl:       sub.pdf_url
    });

  } catch (err) {
    console.error('[check-email] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
