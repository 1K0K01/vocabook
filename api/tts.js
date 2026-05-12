// api/tts.js — Vercel Serverless Function
// Minimax 글로벌(minimax.io) TTS 프록시
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

  // Minimax 글로벌 엔드포인트 (minimax.io) — API Key만으로 인증
  const url = 'https://api.minimax.io/v1/t2a_v2';

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

    // 응답 본문을 한 번만 읽어야 함
    const data = await response.json();

    // Minimax API 오류 응답 처리 (base_resp.status_code가 0이 아니면 오류)
    if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
      return res.status(400).json({
        error: `Minimax 오류 [${data.base_resp.status_code}]: ${data.base_resp.status_msg || 'Unknown error'}`,
        raw: data,
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.base_resp?.status_msg || data?.message || 'Minimax API error',
        raw: data,
      });
    }

    // 글로벌 API 응답: data.audio (hex string)
    if (data?.data?.audio) {
      // hex → base64 변환
      const hex = data.data.audio;
      const bytes = Buffer.from(hex, 'hex');
      const base64 = bytes.toString('base64');
      return res.status(200).json({ audio: base64, format: 'mp3' });
    }

    return res.status(500).json({
      error: 'No audio data returned from Minimax',
      raw: data,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
