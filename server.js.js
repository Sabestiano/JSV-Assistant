const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version']
}));

app.options('*', cors());
app.use(express.json({limit:'2mb'}));

const KEY = process.env.ANTHROPIC_API_KEY;

app.post('/chat', async (req, res) => {
  try {
    console.log('Received chat request');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    console.log('Anthropic response status:', response.status);
    res.json(data);
  } catch(e) {
    console.error('Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => {
  console.log('Health check');
  res.json({ ok: true, key: KEY ? 'present' : 'missing' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('QE Proxy running on port ' + PORT));
