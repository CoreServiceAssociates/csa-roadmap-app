export default async function handler(req, res) {

  // ── CORS ────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const debugMode = req.body?.debug === true;
  const log = (...args) => { if (debugMode) console.log('[resend]', ...args); };

  try {
    const { submissionId, am_id } = req.body;

    if (!submissionId) return res.status(400).json({ error: 'Missing required field: submissionId' });
    if (!am_id)        return res.status(400).json({ error: 'Missing required field: am_id' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    // ── 1. Fetch the original submission ─────────────────────
    log('Fetching submission:', submissionId);

    const subRes = await fetch(
      `${supabaseUrl}/rest/v1/submissions?id=eq.${encodeURIComponent(submissionId)}&limit=1`,
      {
        headers: {
          'apikey':        supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type':  'application/json'
        }
      }
    );

    const submissions = await subRes.json();
    if (!submissions || submissions.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const sub = submissions[0];
    log('Submission found', { email: sub.email, pdfUrl: sub.pdf_url });

    // ── 2. Fetch affiliate webhook URL ───────────────────────
    const affRes = await fetch(
      `${supabaseUrl}/rest/v1/affiliates?am_id=eq.${encodeURIComponent(am_id)}&active=eq.true&limit=1`,
      {
        headers: {
          'apikey':        supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type':  'application/json'
        }
      }
    );

    const affiliates = await affRes.json();
    if (!affiliates || affiliates.length === 0) {
      return res.status(404).json({ error: `No active affiliate found for am_id: ${am_id}` });
    }

    const affiliate = affiliates[0];
    log('Affiliate found', { name: affiliate.name });

    // ── 3. Re-POST to GHL webhook ────────────────────────────
    const webhookPayload = {
      firstName:    sub.first_name,
      lastName:     '',
      email:        sub.email,
      phone:        sub.phone || '',
      source:       'CSA Roadmap App',
      tags:         ['CSA-Roadmap-Resent', `affiliate-${am_id}`],
      customFields: {
        am_id,
        roadmapPdfUrl:  sub.pdf_url,
        roadmapContent: sub.roadmap_text,
        resent:         true
      },
      timestamp: new Date().toISOString()
    };

    log('Re-firing webhook', { url: affiliate.webhook_url });

    let webhookStatus = 'skipped';
    if (affiliate.webhook_url && !affiliate.webhook_url.includes('PLACEHOLDER')) {
      try {
        const whRes = await fetch(affiliate.webhook_url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(webhookPayload)
        });
        webhookStatus = whRes.ok ? 'success' : `failed (${whRes.status})`;
      } catch (whErr) {
        webhookStatus = `error: ${whErr.message}`;
        console.error('[resend] Webhook error:', whErr.message);
      }
    }

    log('Webhook status:', webhookStatus);

    return res.status(200).json({
      success: true,
      webhookStatus,
      ...(debugMode && { _debug: { sub, webhookPayload, webhookStatus } })
    });

  } catch (err) {
    console.error('[resend] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
