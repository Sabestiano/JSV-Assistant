const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version', 'Notion-Version']
}));

app.options('*', cors());
app.use(express.json({limit:'2mb'}));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_KEY = process.env.NOTION_API_KEY;
const NOTION_DB = process.env.NOTION_DB_ID;
const NOTION_LOG_DB = process.env.NOTION_LOG_DB_ID;

// ── AI Chat ──────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  try {
    console.log('Chat request received');
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

// ── Notion: Get all tasks ─────────────────────────────────────────────────────
app.get('/notion/tasks', async (req, res) => {
  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB}/query`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100 })
    });
    const data = await r.json();
    console.log('Notion tasks fetched:', data.results?.length);
    res.json(data);
  } catch(e) {
    console.error('Notion tasks error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Notion: Create task ───────────────────────────────────────────────────────
app.post('/notion/tasks', async (req, res) => {
  try {
    const t = req.body;
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent: { database_id: NOTION_DB },
        properties: {
          Name: { title: [{ text: { content: t.name || '' } }] },
          Horizon: { select: { name: t.h || 'weekly' } },
          Priority: { select: { name: t.p === 'high' ? 'High' : t.p === 'med' ? 'Medium' : 'Low' } },
          Category: { select: { name: t.cat || 'Admin' } },
          Status: { select: { name: 'Active' } },
          'Next Action': { rich_text: [{ text: { content: t.na || '' } }] },
          'Last Touched': t.lt ? { date: { start: t.lt } } : undefined,
          'Task ID': { rich_text: [{ text: { content: String(t.id || Date.now()) } }] }
        }
      })
    });
    const data = await r.json();
    console.log('Task created in Notion:', data.id);
    res.json(data);
  } catch(e) {
    console.error('Create task error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Notion: Update task ───────────────────────────────────────────────────────
app.patch('/notion/tasks/:pageId', async (req, res) => {
  try {
    const t = req.body;
    const props = {};
    if (t.na !== undefined) props['Next Action'] = { rich_text: [{ text: { content: t.na || '' } }] };
    if (t.lt !== undefined) props['Last Touched'] = { date: { start: t.lt } };
    if (t.p !== undefined) props['Priority'] = { select: { name: t.p === 'high' ? 'High' : t.p === 'med' ? 'Medium' : 'Low' } };
    if (t.status !== undefined) props['Status'] = { select: { name: t.status } };

    const r = await fetch(`https://api.notion.com/v1/pages/${req.params.pageId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: props })
    });
    const data = await r.json();
    console.log('Task updated in Notion:', req.params.pageId);
    res.json(data);
  } catch(e) {
    console.error('Update task error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Notion: Log activity ──────────────────────────────────────────────────────
app.post('/notion/log', async (req, res) => {
  try {
    const { taskName, note, date, cat } = req.body;
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent: { database_id: NOTION_LOG_DB || NOTION_DB },
        properties: {
          Name: { title: [{ text: { content: `[LOG] ${taskName}: ${note}`.substring(0, 100) } }] },
          'Next Action': { rich_text: [{ text: { content: note || '' } }] },
          Category: { select: { name: cat || 'Admin' } },
          Status: { select: { name: 'Done' } },
          'Last Touched': { date: { start: date || new Date().toISOString().split('T')[0] } }
        }
      })
    });
    const data = await r.json();
    console.log('Log entry created:', data.id);
    res.json(data);
  } catch(e) {
    console.error('Log error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ai: ANTHROPIC_KEY ? 'present' : 'missing',
    notion: NOTION_KEY ? 'present' : 'missing',
    db: NOTION_DB ? 'present' : 'missing'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('QE Proxy running on port ' + PORT));
