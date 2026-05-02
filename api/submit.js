export default async function handler(req, res) {

  // ── CORS ────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const debugMode = req.body?.debug === true;
  const log = (...args) => { if (debugMode) console.log('[submit]', ...args); };

  try {
    const {
      am_id,
      firstName,
      bizName,
      email,
      phone,
      bizDesc,
      challenge,
      stage
    } = req.body;

    log('Received submission', { am_id, firstName, email, phone });

    // ── 1. Validate required fields ─────────────────────────
    if (!am_id)      return res.status(400).json({ error: 'Missing required field: am_id' });
    if (!firstName)  return res.status(400).json({ error: 'Missing required field: firstName' });
    if (!email)      return res.status(400).json({ error: 'Missing required field: email' });

    // ── 2. Look up affiliate in Supabase ─────────────────────
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[submit] Missing Supabase environment variables');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    log('Querying Supabase for am_id:', am_id);

    const sbRes = await fetch(
      `${supabaseUrl}/rest/v1/affiliates?am_id=eq.${encodeURIComponent(am_id)}&active=eq.true&limit=1`,
      {
        headers: {
          'apikey':        supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type':  'application/json'
        }
      }
    );

    if (!sbRes.ok) {
      const sbErr = await sbRes.text();
      console.error('[submit] Supabase error:', sbErr);
      return res.status(500).json({ error: 'Database lookup failed' });
    }

    const affiliates = await sbRes.json();
    log('Supabase response', affiliates);

    if (!affiliates || affiliates.length === 0) {
      return res.status(404).json({ error: `No active affiliate found for am_id: ${am_id}` });
    }

    const affiliate = affiliates[0];
    log('Affiliate found', { name: affiliate.name, hasWebhook: !!affiliate.webhook_url });

    // ── 3. Fire webhook to affiliate's GHL sub-portal ────────
    const contactPayload = {
      firstName:    firstName,
      lastName:     '',
      email:        email,
      phone:        phone || '',
      source:       'CSA Roadmap App',
      tags:         ['CSA-Roadmap-Completed', `affiliate-${am_id}`],
      customFields: {
        bizName:   bizName   || '',
        bizDesc:   bizDesc   || '',
        challenge: challenge || '',
        stage:     stage     || '',
        am_id:     am_id
      },
      timestamp: new Date().toISOString()
    };

    log('Contact payload built', contactPayload);

    let webhookStatus = 'skipped';

    if (affiliate.webhook_url && !affiliate.webhook_url.includes('PLACEHOLDER')) {
      log('Firing webhook to:', affiliate.webhook_url);
      try {
        const whRes = await fetch(affiliate.webhook_url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(contactPayload)
        });
        webhookStatus = whRes.ok ? 'success' : `failed (${whRes.status})`;
        log('Webhook response:', webhookStatus);
      } catch (whErr) {
        webhookStatus = `error: ${whErr.message}`;
        log('Webhook threw:', whErr.message);
        // Don't fail the whole request if webhook fails —
        // contact data was still received, just log it
        console.error('[submit] Webhook error for am_id', am_id, whErr.message);
      }
    } else {
      log('Webhook skipped — placeholder or missing URL');
    }

    // ── 4. Return partner data to frontend ───────────────────
    const responsePayload = {
      success: true,
      partner: {
        name: affiliate.name
      },
      ...(debugMode && {
        _debug: {
          am_id,
          affiliateName:  affiliate.name,
          webhookStatus,
          contactPayload
        }
      })
    };

    log('Returning success response', responsePayload);
    return res.status(200).json(responsePayload);

  } catch (err) {
    console.error('[submit] Unhandled error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      ...(req.body?.debug && {
        _debug: { message: err.message, stack: err.stack }
      })
    });
  }
}
