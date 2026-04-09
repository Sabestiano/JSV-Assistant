const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version']
}));
app.options('*', cors());
app.use(express.json({ limit: '2mb' }));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

// ── Google Auth ──────────────────────────────────────────────────────────────
async function getGoogleToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).toString('base64url');

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const sig = sign.sign(SERVICE_ACCOUNT.private_key, 'base64url');
  const jwt = `${header}.${claim}.${sig}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const data = await r.json();
  return data.access_token;
}

async function sheetsGet(range) {
  const token = await getGoogleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return r.json();
}

async function sheetsAppend(range, values) {
  const token = await getGoogleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return r.json();
}

async function sheetsUpdate(range, values) {
  const token = await getGoogleToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return r.json();
}

// ── AI Chat ──────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  try {
    const body = { ...req.body, model: 'claude-opus-4-5', max_tokens: req.body.max_tokens || 1000 };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    console.log('AI status:', r.status);
    res.json(data);
  } catch(e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Get all tasks ────────────────────────────────────────────────────────────
app.get('/tasks', async (req, res) => {
  try {
    const data = await sheetsGet('Tasks!A:H');
    const rows = data.values || [];
    if (rows.length <= 1) return res.json({ tasks: [] });
    const tasks = rows.slice(1).map(r => ({
      id: r[0] || '',
      name: r[1] || '',
      h: r[2] || 'weekly',
      p: r[3] || 'med',
      cat: r[4] || 'Admin',
      na: r[5] || '',
      lt: r[6] || null,
      status: r[7] || 'Active'
    })).filter(t => t.id && t.name);
    console.log('Tasks fetched:', tasks.length);
    res.json({ tasks });
  } catch(e) {
    console.error('Get tasks error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Save all tasks ───────────────────────────────────────────────────────────
app.post('/tasks', async (req, res) => {
  try {
    const { tasks } = req.body;
    const values = [
      ['ID', 'Name', 'Horizon', 'Priority', 'Category', 'Next Action', 'Last Touched', 'Status'],
      ...tasks.map(t => [t.id, t.name, t.h, t.p, t.cat, t.na || '', t.lt || '', t.status || 'Active'])
    ];
    await sheetsUpdate('Tasks!A1', values);
    console.log('Tasks saved:', tasks.length);
    res.json({ success: true, count: tasks.length });
  } catch(e) {
    console.error('Save tasks error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Update single task ───────────────────────────────────────────────────────
app.patch('/tasks/:id', async (req, res) => {
  try {
    const data = await sheetsGet('Tasks!A:H');
    const rows = data.values || [];
    const rowIndex = rows.findIndex(r => r[0] === req.params.id);
    if (rowIndex === -1) return res.status(404).json({ error: 'Task not found' });
    const row = rows[rowIndex];
    const updates = req.body;
    if (updates.na !== undefined) row[5] = updates.na;
    if (updates.lt !== undefined) row[6] = updates.lt;
    if (updates.p !== undefined) row[3] = updates.p;
    if (updates.status !== undefined) row[7] = updates.status;
    const sheetRow = rowIndex + 1;
    await sheetsUpdate(`Tasks!A${sheetRow}:H${sheetRow}`, [row]);
    console.log('Task updated:', req.params.id);
    res.json({ success: true });
  } catch(e) {
    console.error('Update task error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Get all logs ─────────────────────────────────────────────────────────────
app.get('/logs', async (req, res) => {
  try {
    const data = await sheetsGet('Logs!A:D');
    const rows = data.values || [];
    if (rows.length <= 1) return res.json({ logs: [] });
    const logs = rows.slice(1).map(r => ({
      date: r[0] || '',
      taskName: r[1] || '',
      note: r[2] || '',
      cat: r[3] || ''
    })).filter(l => l.date);
    console.log('Logs fetched:', logs.length);
    res.json({ logs });
  } catch(e) {
    console.error('Get logs error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Add log entry ────────────────────────────────────────────────────────────
app.post('/logs', async (req, res) => {
  try {
    const { date, taskName, note, cat } = req.body;
    console.log('Adding log:', date, taskName);
    const result = await sheetsAppend('Logs!A:D', [[date, taskName, note, cat]]);
    console.log('Sheets append result:', JSON.stringify(result).substring(0, 200));
    res.json({ success: true });
  } catch(e) {
    console.error('Add log error:', e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

app.post('/test-log', async (req, res) => {
  try {
    const result = await sheetsAppend('Logs!A:D', [['2026-04-09', 'Test Task', 'Test note', 'Admin']]);
    console.log('Test log result:', JSON.stringify(result).substring(0, 300));
    res.json({ success: true, result });
  } catch(e) {
    console.error('Test log error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, ai: ANTHROPIC_KEY ? 'present' : 'missing', sheet: SHEET_ID ? 'present' : 'missing' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('QE Proxy running on port ' + PORT));
