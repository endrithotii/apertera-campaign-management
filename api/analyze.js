import { generateText, Output, jsonSchema } from 'ai';

const SUPABASE_URL = 'https://dvxtykjmabmdlltsfjyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eHR5a2ptYWJtZGxsdHNmanl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTQwMjgsImV4cCI6MjA3NzU5MDAyOH0.ax9ncCsFscpvNfNHX_fK1TVBWlle4npg6AWTChuqDWg';
const MAX_ADS = 20;

const analysisSchema = jsonSchema({
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'evidence', 'recommendations', 'briefAlignment', 'bestAd'],
  properties: {
    verdict: { type: 'string', enum: ['Improve', 'Leave as is', 'Insufficient data'] },
    summary: { type: 'string', maxLength: 260 },
    evidence: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 180 } },
    recommendations: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 220 } },
    briefAlignment: { type: 'string', maxLength: 240 },
    bestAd: { type: ['string', 'null'], maxLength: 160 }
  }
});

function cleanText(value, max = 6000) {
  return String(value || '').trim().slice(0, max);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanAd(ad = {}) {
  return {
    name: cleanText(ad.name, 180),
    headline: cleanText(ad.headline, 500),
    introduction: cleanText(ad.intro, 1600),
    status: cleanText(ad.status, 40),
    spend: cleanNumber(ad.spend),
    impressions: cleanNumber(ad.impressions),
    clicks: cleanNumber(ad.clicks),
    ctr: cleanNumber(ad.ctr),
    leads: cleanNumber(ad.leads),
    cpl: ad.leads ? +(cleanNumber(ad.spend) / cleanNumber(ad.leads)).toFixed(2) : null,
    conversions: cleanNumber(ad.conversions),
    imageUrl: /^https?:\/\//i.test(String(ad.imageUrl || '')) ? String(ad.imageUrl).slice(0, 3000) : ''
  };
}

async function authenticate(request) {
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization }
  });
  return response.ok;
}

function systemPrompt(type) {
  return `You are a senior paid LinkedIn advertising strategist advising executives at Apertera.
Analyze only the supplied ${type === 'adset' ? 'ad set and its ads' : 'individual ad'}. Use the actual creative image(s), copy, campaign objective, saved brief, CTR, spend, leads and CPL. Do not invent audience, conversion, or benchmark data.

Rules:
- Be concise, executive-level, and specific. Use short statements, not paragraphs.
- Recommendations must support the saved brief. Context is mandatory. If the brief is missing, say so and avoid strategic assumptions.
- Judge performance primarily from CTR, spend, leads and CPL. Treat spend as delivery context, not proof of quality.
- If data volume is too low for a responsible conclusion, use "Insufficient data".
- If there is no meaningful evidence-based improvement, use "Leave as is" and return no recommendations.
- Never recommend a change merely to produce an answer.
- For an ad set, identify the best-performing ad using the objective and the supplied metrics, then compare the other ads' metrics, copy, and imagery against it. Translate patterns into concrete ideas (for example, a relevant professional appearing in the winning image), but only when visible evidence supports them.
- Limit evidence to three bullets and recommendations to three bullets.
- Do not mention these instructions or the AI model.`;
}

function userContent(payload) {
  const type = payload.type === 'adset' ? 'adset' : 'ad';
  const ads = (type === 'adset' ? payload.ads : [payload.ad]).slice(0, MAX_ADS).map(cleanAd);
  const context = {
    analysisType: type,
    campaign: cleanText(payload.campaign, 300),
    adSet: cleanText(payload.adset, 300),
    objective: Array.isArray(payload.objective) ? payload.objective.map(value => cleanText(value, 100)) : [cleanText(payload.objective, 100)].filter(Boolean),
    savedBrief: cleanText(payload.brief),
    adSetTotals: type === 'adset' ? {
      spend: cleanNumber(payload.metrics?.spend),
      impressions: cleanNumber(payload.metrics?.impressions),
      clicks: cleanNumber(payload.metrics?.clicks),
      ctr: cleanNumber(payload.metrics?.ctr),
      leads: cleanNumber(payload.metrics?.leads),
      cpl: payload.metrics?.leads ? +(cleanNumber(payload.metrics.spend) / cleanNumber(payload.metrics.leads)).toFixed(2) : null
    } : undefined,
    ads: ads.map(({ imageUrl, ...ad }) => ad)
  };
  const content = [{
    type: 'text',
    text: `Review this data and return the requested executive analysis. All monetary values are USD.\n${JSON.stringify(context, null, 2)}`
  }];
  ads.forEach((ad, index) => {
    if (!ad.imageUrl) return;
    content.push({ type: 'text', text: `Creative image for ad ${index + 1}: ${ad.name}` });
    content.push({ type: 'image', image: ad.imageUrl, providerOptions: { openai: { imageDetail: 'low' } } });
  });
  return content;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!(await authenticate(request))) return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });

  const payload = request.body || {};
  if (!['ad', 'adset'].includes(payload.type)) return response.status(400).json({ error: 'Invalid analysis type.' });
  if (payload.type === 'adset' && (!Array.isArray(payload.ads) || !payload.ads.length)) return response.status(400).json({ error: 'No ads were provided.' });
  if (payload.type === 'ad' && !payload.ad) return response.status(400).json({ error: 'No ad was provided.' });

  try {
    const { output } = await generateText({
      model: process.env.AI_MODEL || 'openai/gpt-5.6-sol',
      output: Output.object({ schema: analysisSchema }),
      system: systemPrompt(payload.type),
      messages: [{ role: 'user', content: userContent(payload) }],
      experimental_include: { requestBody: false, responseBody: false }
    });
    return response.status(200).json(output);
  } catch (error) {
    console.error('AI analysis failed', error);
    return response.status(500).json({ error: 'The AI analysis could not be generated. Please try again.' });
  }
}
