export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voice_id, speed, apiKey } = req.body;

  if (!text || !voice_id || !apiKey) {
    return res.status(400).json({ error: 'Missing required fields: text, voice_id, apiKey' });
  }

  // Minimax 글로벌(minimax.io): API Key만으로 인증, GroupId/UID 불필요
  const url = `https://api.minimax.io/v1/t2a_v2`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-01-hd',
        text,
        stream: false,
        voice_setting: {
          voice_id,
          speed: speed || 1.0,
          vol: 1.0,
          pitch: 0,
        },
        audio_setting: {
          audio_sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Minimax API error' });
    }

    if (data?.data?.audio) {
      return res.status(200).json({ audio: data.data.audio, format: 'mp3' });
    }

    return res.status(500).json({ error: 'No audio data returned from Minimax', raw: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
