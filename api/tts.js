// api/tts.js — Vercel Serverless Function
// Minimax 글로벌(api.minimax.io) T2A v2 — 공식 문서 기준
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

  const url = 'https://api.minimax.io/v1/t2a_v2';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'speech-2.8-hd',          // 최신 모델
        text,
        stream: false,
        output_format: 'hex',           // 명시적으로 hex 지정
        language_boost: 'Korean',       // 한국어 인식 강화
        voice_setting: {
          voice_id,
          speed: speed || 1.0,
          vol: 1.0,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,           // ← 공식 문서: sample_rate (audio_sample_rate 아님)
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
    });

    const data = await response.json();

    // Minimax 자체 오류 코드 확인 (0 = 성공)
    if (data?.base_resp?.status_code !== 0) {
      return res.status(400).json({
        error: `Minimax [${data?.base_resp?.status_code}]: ${data?.base_resp?.status_msg || 'Unknown error'}`,
        raw: data,
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.base_resp?.status_msg || 'Minimax API error',
        raw: data,
      });
    }

    // 응답: data.data.audio = hex string → base64 변환
    if (data?.data?.audio) {
      const bytes = Buffer.from(data.data.audio, 'hex');
      const base64 = bytes.toString('base64');
      return res.status(200).json({ audio: base64, format: 'mp3' });
    }

    return res.status(500).json({
      error: 'No audio in response',
      raw: data,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
