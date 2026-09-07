// ---------- helpers ----------
const fmtMoney = (n, decimals=0) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:decimals, maximumFractionDigits:decimals});
};
const fmtInt = (n) => n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US');
const fmtPct = (n) => n === null || n === undefined || isNaN(n) ? '—' : n.toFixed(2) + '%';

const SCORE_CONFIG_KEY = 'score_legend';
const CAMPAIGN_OBJECTIVES_KEY = 'campaign_objectives';
const ADSET_DISPLAY_NAMES_KEY = 'adset_display_names';
const ADSET_BRIEFS_KEY = 'adset_briefs';
const FEEDBACK_HISTORY_KEY = 'feedback_resolution_history';
const CAMPAIGN_OBJECTIVE_OPTIONS = [
  'Brand Awareness',
  'Website Visits',
  'Engagement',
  'Video Views',
  'Lead Generation',
  'Website Conversions'
];
let CAMPAIGN_OBJECTIVES = {};
let ADSET_DISPLAY_NAMES = {};
let ADSET_BRIEFS = {};
let FEEDBACK_HISTORY = {};
const escapeHTML = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const DEFAULT_SCORE_BANDS = [
  { min: 75, label: 'Strong', color: '#16845b' },
  { min: 50, label: 'Solid', color: '#c47c00' },
  { min: 0, label: 'Needs work', color: '#d04444' }
];
let SCORE_BANDS = DEFAULT_SCORE_BANDS.map(b => ({...b}));
function validScoreBands(value){
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every(b => Number.isFinite(Number(b.min)) && typeof b.label === 'string' && /^#[0-9a-f]{6}$/i.test(b.color || '')) &&
    Number(value[0].min) > Number(value[1].min) &&
    Number(value[1].min) > Number(value[2].min);
}
function scoreBandFor(score){
  return SCORE_BANDS.find(b => score >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];
}
function normalizeCampaignObjective(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  const match = CAMPAIGN_OBJECTIVE_OPTIONS.find(option => option.toLowerCase() === raw.toLowerCase());
  return match || '';
}
function normalizeCampaignObjectives(value){
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(normalizeCampaignObjective).filter(Boolean))]
    .sort((a,b) => CAMPAIGN_OBJECTIVE_OPTIONS.indexOf(a) - CAMPAIGN_OBJECTIVE_OPTIONS.indexOf(b));
}
function objectiveKey(value){
  return normalizeCampaignObjectives(value).join(' + ');
}
function campaignObjectiveFor(campaignName, importedObjective){
  const saved = normalizeCampaignObjectives(CAMPAIGN_OBJECTIVES[campaignName]);
  return saved.length ? saved : normalizeCampaignObjectives(importedObjective);
}
function objectivePickerHTML(campaignName, selected, detail=false){
  const selectedSet = new Set(normalizeCampaignObjectives(selected));
  const safeName = campaignName.replace(/"/g,'&quot;');
  return `<fieldset class="campaign-objective-picker${detail ? ' objective-picker-detail' : ''}" data-campaign-objectives="${safeName}">
    <legend>Campaign objectives <span>select one or more</span></legend>
    <div class="objective-checkboxes">${CAMPAIGN_OBJECTIVE_OPTIONS.map(option =>
      `<label><input type="checkbox" value="${option}"${selectedSet.has(option) ? ' checked' : ''}><span>${option}</span></label>`
    ).join('')}</div>
    <div class="objective-save-state" aria-live="polite"></div>
  </fieldset>`;
}

const GRADIENTS = [
  'linear-gradient(135deg,#0c1224 0%,#1b2547 55%,#2c3a72 100%)',
  'linear-gradient(135deg,#151038 0%,#332468 55%,#5237a0 100%)',
  'linear-gradient(135deg,#0d1b2a 0%,#173654 55%,#265179 100%)',
  'linear-gradient(135deg,#1a1030 0%,#3a1f52 55%,#6a3577 100%)',
  'linear-gradient(135deg,#0e1420 0%,#202b47 55%,#38507e 100%)'
];

function deriveStatus(trend){
  if(!trend || trend.length < 4) return {label:'Active', cls:'status-steady'};
  const half = Math.floor(trend.length/2);
  const prior = trend.slice(0, half);
  const recent = trend.slice(half);
  const avg = a => a.reduce((x,y)=>x+y,0) / (a.length || 1);
  const pAvg = avg(prior), rAvg = avg(recent);
  if (rAvg < 0.5) return {label:'Paused', cls:'status-paused'};
  if (rAvg > pAvg * 1.15) return {label:'Scaling', cls:'status-scaling'};
  if (rAvg < pAvg * 0.6) return {label:'Slowing', cls:'status-slowing'};
  return {label:'Steady', cls:'status-steady'};
}

// ---------- performance-based status (red/yellow/green), derived from actual CTR vs account average ----------
function computeAvgCtr(cards){
  const withImpr = cards.filter(c => c.impressions > 0);
  if(!withImpr.length) return 0;
  const totalClicks = withImpr.reduce((s,c)=>s+c.clicks,0);
  const totalImpr = withImpr.reduce((s,c)=>s+c.impressions,0);
  return totalImpr ? (totalClicks/totalImpr*100) : 0;
}

function derivePerformanceStatus(card, avgCtr){
  if(card.status.label === 'Paused') return {label:'Needs attention', cls:'status-paused'};
  if(!avgCtr || card.impressions < 200) return {label:'Needs review', cls:'status-slowing'};
  if(card.ctr >= avgCtr * 1.3) return {label:'Performing well', cls:'status-scaling'};
  if(card.ctr <= avgCtr * 0.6) return {label:'Needs attention', cls:'status-paused'};
  return {label:'Needs review', cls:'status-slowing'};
}

const OBJECTIVE_SCORE_RULES = {
  'Brand Awareness': 'CPM 40 + CTR 25',
  'Website Visits': 'CTR 45 + CPC 20',
  'Engagement': 'Engagement rate 40 + CTR 25',
  'Video Views': 'CTR proxy 65 (until video-view fields are imported)',
  'Lead Generation': 'Lead rate 35 + CPL 20 + CTR 10',
  'Website Conversions': 'Conversion rate 35 + CPA 20 + CTR 10'
};
const cappedPoints = (ratio, points) => Math.max(0, Math.min(points, Math.round(Number(ratio || 0) * points)));
function aggregatePeerMetrics(peers){
  const totals = peers.reduce((out, peer) => {
    out.spend += Number(peer.spend || 0);
    out.impressions += Number(peer.impressions || 0);
    out.clicks += Number(peer.clicks || 0);
    out.leads += Number(peer.leads || 0);
    out.conversions += Number(peer.conversions || 0);
    out.reactions += Number(peer.reactions || 0);
    return out;
  }, { spend:0, impressions:0, clicks:0, leads:0, conversions:0, reactions:0 });
  return {
    ctr: totals.impressions ? totals.clicks / totals.impressions * 100 : 0,
    cpc: totals.clicks ? totals.spend / totals.clicks : 0,
    cpm: totals.impressions ? totals.spend / totals.impressions * 1000 : 0,
    leadRate: totals.clicks ? totals.leads / totals.clicks * 100 : 0,
    cpl: totals.leads ? totals.spend / totals.leads : 0,
    conversionRate: totals.clicks ? totals.conversions / totals.clicks * 100 : 0,
    cpa: totals.conversions ? totals.spend / totals.conversions : 0,
    engagementRate: totals.impressions ? totals.reactions / totals.impressions * 100 : 0
  };
}
function metricRatio(value, benchmark, lowerIsBetter=false){
  if(!benchmark) return 0;
  if(lowerIsBetter) return value > 0 ? benchmark / value : 0;
  return value / benchmark;
}
function scoreForObjective(ad, objective, benchmark){
  const metrics = {
    ctr: Number(ad.ctr || 0),
    cpc: ad.clicks ? Number(ad.spend || 0) / Number(ad.clicks) : 0,
    cpm: ad.impressions ? Number(ad.spend || 0) / Number(ad.impressions) * 1000 : 0,
    leadRate: ad.clicks ? Number(ad.leads || 0) / Number(ad.clicks) * 100 : 0,
    cpl: ad.leads ? Number(ad.spend || 0) / Number(ad.leads) : 0,
    conversionRate: ad.clicks ? Number(ad.conversions || 0) / Number(ad.clicks) * 100 : 0,
    cpa: ad.conversions ? Number(ad.spend || 0) / Number(ad.conversions) : 0,
    engagementRate: ad.impressions ? Number(ad.reactions || 0) / Number(ad.impressions) * 100 : 0
  };
  let points = 0;
  if(objective === 'Brand Awareness'){
    points = cappedPoints(metricRatio(metrics.cpm, benchmark.cpm, true), 40) + cappedPoints(metricRatio(metrics.ctr, benchmark.ctr), 25);
  } else if(objective === 'Website Visits'){
    points = cappedPoints(metricRatio(metrics.ctr, benchmark.ctr), 45) + cappedPoints(metricRatio(metrics.cpc, benchmark.cpc, true), 20);
  } else if(objective === 'Engagement'){
    points = cappedPoints(metricRatio(metrics.engagementRate, benchmark.engagementRate), 40) + cappedPoints(metricRatio(metrics.ctr, benchmark.ctr), 25);
  } else if(objective === 'Video Views'){
    points = cappedPoints(metricRatio(metrics.ctr, benchmark.ctr), 65);
  } else if(objective === 'Lead Generation'){
    points = cappedPoints(metricRatio(metrics.leadRate, benchmark.leadRate), 35) + cappedPoints(metricRatio(metrics.cpl, benchmark.cpl, true), 20) + cappedPoints(metricRatio(metrics.ctr, benchmark.ctr), 10);
  } else if(objective === 'Website Conversions'){
    points = cappedPoints(metricRatio(metrics.conversionRate, benchmark.conversionRate), 35) + cappedPoints(metricRatio(metrics.cpa, benchmark.cpa, true), 20) + cappedPoints(metricRatio(metrics.ctr, benchmark.ctr), 10);
  }
  return { objective, points: Math.min(65, points), rule: OBJECTIVE_SCORE_RULES[objective] };
}
function objectiveBenchmarkFor(ad){
  const objectives = normalizeCampaignObjectives(ad && ad.objective);
  if(!objectives.length) return { objective:'', objectives:[], comparisonCount:0, goalBreakdown:[] };
  const breakdown = objectives.map(objective => {
    const peers = (DATA.flatAds || []).filter(peer =>
      normalizeCampaignObjectives(peer.objective).includes(objective) &&
      Number(peer.impressions) >= 50
    );
    const benchmark = aggregatePeerMetrics(peers);
    return { ...scoreForObjective(ad, objective, benchmark), comparisonCount: peers.length, benchmark };
  });
  return {
    objective: objectives.join(' + '),
    objectives,
    comparisonCount: Math.min(...breakdown.map(item => item.comparisonCount)),
    goalBreakdown: breakdown
  };
}

// ---------- rule-based ad score + recommendations ----------
function computeAdScore(ad){
  if(!ad || !ad.impressions || ad.impressions < 50){
    return { score: null, label: 'Not enough data', cls: 'status-slowing', notes: ['Fewer than 50 impressions — too little delivery yet to score reliably.'] };
  }
  const benchmark = objectiveBenchmarkFor(ad);
  if(!benchmark.objective){
    return { score: null, label: 'Select objective', cls: 'status-slowing', notes: ['Select a campaign objective before scoring this ad.'] };
  }
  if(!benchmark.goalBreakdown.length || benchmark.goalBreakdown.some(item => !item.comparisonCount)){
    return { score: null, label: 'Not enough benchmark data', cls: 'status-slowing', notes: [`There is not enough delivered ${benchmark.objective} data to calculate a goal-specific benchmark.`] };
  }
  let score = Math.round(benchmark.goalBreakdown.reduce((sum, item) => sum + item.points, 0) / benchmark.goalBreakdown.length);
  const notes = [];
  benchmark.goalBreakdown.forEach(item => notes.push(`${item.objective}: ${item.points}/65 performance points using ${item.rule}.`));
  const introLen = (ad.intro||'').length;
  if(introLen >= 80 && introLen <= 200) score += 20;
  else if(introLen < 40){ score += 5; notes.push('Primary text is very short — add more context or a concrete benefit.'); }
  else if(introLen > 250){ score += 10; notes.push('Primary text may run long for the LinkedIn feed — consider trimming.'); }
  else score += 15;

  const hlLen = (ad.headline||'').length;
  if(hlLen >= 10 && hlLen <= 70) score += 15;
  else if(!ad.headline) notes.push('No headline set for this ad.');
  else score += 8;

  score = Math.max(0, Math.min(100, score));
  const band = scoreBandFor(score);
  const label = band.label;
  const color = band.color;
  const cls = score >= SCORE_BANDS[0].min ? 'status-scaling' : score >= SCORE_BANDS[1].min ? 'status-slowing' : 'status-paused';
  if(!notes.length) notes.push('No major issues detected in the scored performance and copy signals.');
  return { score, label, color, cls, notes, ...benchmark };
}

// ---------- campaign summary blurb, derived from the ad copy actually in the export (not real audience data) ----------
function objectiveGoal(objective){
  const objectives = normalizeCampaignObjectives(objective);
  if(!objectives.length) return 'engagement';
  return objectives.map(item => {
    if(/lead/i.test(item)) return 'lead-gen downloads';
    if(/website/i.test(item)) return 'website visits';
    return item.toLowerCase();
  }).join(' and ');
}

function campaignBlurb(card){
  const text = (((card.top_ad && card.top_ad.headline)||'') + ' ' + ((card.top_ad && card.top_ad.intro)||'')).toLowerCase();
  let audience = 'legal, financial & regulatory teams';
  if(/website translation|multilingual website|localization/.test(text)) audience = 'teams managing website translation';
  else if(/law firm/.test(text)) audience = 'law firms';
  else if(/billable|lawyer time|non-billable/.test(text)) audience = 'legal teams tracking billable hours';
  else if(/legal, financial|legal, regulatory|legal and financial/.test(text)) audience = 'legal, financial & regulatory teams';
  const goal = objectiveGoal(card.objective);
  return `Targeting ${audience}. Goal: ${goal}.`;
}

function shortCampaignName(name){
  return name.replace(/\s*\|\s*/g,' · ');
}

function objectiveTag(objective){
  const objectives = normalizeCampaignObjectives(objective);
  if(!objectives.length) return 'CAMPAIGN';
  return objectives.map(item => item.toUpperCase()).join(' + ') + ' · LINKEDIN';
}

function adLabel(ad){
  return (ad && ad.displayName) ? ad.displayName : (ad && ad.name) || '';
}
function adsetKey(campaignName, adsetName){
  return `${campaignName}|||${adsetName}`;
}
function adsetLabel(card){
  return (card && card.displayName) ? card.displayName : (card && card.name) || '';
}

function shortUrl(url){
  try{
    const u = new URL(url);
    return u.hostname.replace('www.','') + u.pathname;
  } catch(e){
    return url.length > 60 ? url.slice(0,60) + '…' : url;
  }
}
function isLikelyExpiringAssetUrl(url){
  const value = String(url || '');
  if(!value) return false;
  return /(?:media|static-exp)\.licdn\.com/i.test(value) || /[?&](?:e|exp|expires|se|sig|signature|token)=/i.test(value);
}

// ---------- per-ad preview overrides (image URL + LinkedIn preview URL) ----------
// Shared across everyone via a small Supabase table (not per-browser localStorage).
const SUPABASE_URL = 'https://dvxtykjmabmdlltsfjyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eHR5a2ptYWJtZGxsdHNmanl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTQwMjgsImV4cCI6MjA3NzU5MDAyOH0.ax9ncCsFscpvNfNHX_fK1TVBWlle4npg6AWTChuqDWg';
function supabaseHeaders(extra = {}){
  const session = typeof getStoredSession === 'function' ? getStoredSession() : null;
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`, ...extra };
}

let OVERRIDES_CACHE = {};
let OVERRIDES_BY_EXTERNAL_ID = {};
const CREATIVE_BUCKET = 'campaign-creatives';

// LinkedIn CDN image links are temporary and can expire. Keep repaired creatives
// that we have recovered inside the deployment so they remain stable.
const DURABLE_IMAGE_OVERRIDES = {
  'Where the Hours Go': 'data:image/png;base64,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'
};

async function fetchOverrides(){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_overrides?select=ad_name,ad_external_id,image_url,image_storage_path,preview_url,cta_label,cta_url,feedback_note,feedback_applied,display_name`, { headers: supabaseHeaders() });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const map = {};
    const byExternalId = {};
    rows.forEach(r => {
      const value = { imageUrl: r.image_url || '', imageStoragePath: r.image_storage_path || '', previewUrl: r.preview_url || '', ctaLabel: r.cta_label || '', ctaUrl: r.cta_url || '', feedbackNote: r.feedback_note || '', feedbackApplied: !!r.feedback_applied, displayName: r.display_name || '', externalId: r.ad_external_id || '' };
      map[r.ad_name] = value;
      if(r.ad_external_id) byExternalId[r.ad_external_id] = mergeOverrideValues(byExternalId[r.ad_external_id], value);
    });
    OVERRIDES_CACHE = map;
    OVERRIDES_BY_EXTERNAL_ID = byExternalId;
  } catch(e){
    console.error('Could not load shared ad previews:', e);
  }
  await fetchCommentCounts();
  return OVERRIDES_CACHE;
}

function getOverrides(){
  return OVERRIDES_CACHE;
}

function mergeOverrideValues(current = {}, next = {}){
  const imageStoragePath = next.imageStoragePath || current.imageStoragePath || '';
  const imageUrl = next.imageStoragePath
    ? next.imageUrl
    : current.imageStoragePath
      ? current.imageUrl
      : (next.imageUrl || current.imageUrl || '');
  return {
    imageUrl: imageUrl || '',
    imageStoragePath,
    previewUrl: next.previewUrl || current.previewUrl || '',
    ctaLabel: next.ctaLabel || current.ctaLabel || '',
    ctaUrl: next.ctaUrl || current.ctaUrl || '',
    feedbackNote: next.feedbackNote || current.feedbackNote || '',
    feedbackApplied: !!(next.feedbackApplied || current.feedbackApplied),
    displayName: next.displayName || current.displayName || '',
    externalId: next.externalId || current.externalId || ''
  };
}

function overrideForAd(adOrName){
  const ad = typeof adOrName === 'string' ? AD_INDEX[adOrName] : adOrName;
  const adName = typeof adOrName === 'string' ? adOrName : ad?.name;
  if(ad?.externalId && OVERRIDES_BY_EXTERNAL_ID[ad.externalId]) return OVERRIDES_BY_EXTERNAL_ID[ad.externalId];
  return (adName && OVERRIDES_CACHE[adName]) || {};
}

async function saveOverride(adName, imageUrl, previewUrl, ctaLabel, ctaUrl, imageStoragePath=''){
  const ad = AD_INDEX[adName] || {};
  const existing = overrideForAd(adName);
  const externalId = ad.externalId || existing.externalId || '';
  if(!imageUrl && !previewUrl && !ctaLabel && !ctaUrl && !existing.feedbackNote && !existing.feedbackApplied && !existing.displayName){
    await fetch(`${SUPABASE_URL}/rest/v1/ad_overrides?ad_name=eq.${encodeURIComponent(adName)}`, {
      method: 'DELETE', headers: supabaseHeaders()
    });
    delete OVERRIDES_CACHE[adName];
    return;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_overrides`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ ad_name: adName, ad_external_id: externalId || null, image_url: imageUrl || '', image_storage_path: imageStoragePath || '', preview_url: previewUrl || '', cta_label: ctaLabel || '', cta_url: ctaUrl || '', updated_at: new Date().toISOString() })
  });
  if(!res.ok) throw new Error(`Could not save preview override (HTTP ${res.status}).`);
  OVERRIDES_CACHE[adName] = { ...existing, externalId, imageUrl: imageUrl || '', imageStoragePath: imageStoragePath || '', previewUrl: previewUrl || '', ctaLabel: ctaLabel || '', ctaUrl: ctaUrl || '' };
  if(externalId) OVERRIDES_BY_EXTERNAL_ID[externalId] = OVERRIDES_CACHE[adName];
}

async function uploadCreativeImage(adName, file){
  if(!file) return null;
  if(!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error('Choose a PNG, JPG, WebP, or GIF image.');
  if(file.size > 10 * 1024 * 1024) throw new Error('The image must be 10 MB or smaller.');
  let session = getStoredSession();
  if(!session || session.expires_at <= Date.now() + 60000) session = session?.refresh_token ? await refreshSession(session.refresh_token) : null;
  if(!session?.access_token) throw new Error('Your session expired. Please sign in again.');
  const ad = AD_INDEX[adName] || {};
  const identity = String(ad.externalId || adName).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0,100) || 'creative';
  const ext = ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[file.type.toLowerCase()];
  const digest = await fileDigestHex(file);
  const unique = digest || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${identity}/${unique}.${ext}`;
  const publicUrl = creativePublicUrl(path);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${CREATIVE_BUCKET}/${encodeURIComponent(path).replace(/%2F/g,'/')}`, {
    method:'POST',
    headers:{ apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${session.access_token}`, 'Content-Type':file.type, 'Cache-Control':'31536000' },
    body:file
  });
  if(!res.ok){
    let message = `upload failed (HTTP ${res.status})`;
    try{ const data = await res.json(); message = data.message || data.error || message; } catch(e){}
    if(res.status === 409 || /already exists/i.test(message)) return { path, url: publicUrl };
    throw new Error(message);
  }
  return { path, url: publicUrl };
}

async function fileDigestHex(file){
  if(!crypto?.subtle) return '';
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

function creativePublicUrl(path){
  return `${SUPABASE_URL}/storage/v1/object/public/${CREATIVE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function saveDisplayName(adName, displayName){
  const ad = AD_INDEX[adName] || {};
  const existing = overrideForAd(adName);
  const externalId = ad.externalId || existing.externalId || '';
  await fetch(`${SUPABASE_URL}/rest/v1/ad_overrides`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ ad_name: adName, ad_external_id: externalId || null, display_name: displayName || '', updated_at: new Date().toISOString() })
  });
  OVERRIDES_CACHE[adName] = { ...existing, externalId, displayName: displayName || '' };
  if(externalId) OVERRIDES_BY_EXTERNAL_ID[externalId] = OVERRIDES_CACHE[adName];
}

async function setResolved(adName, applied){
  const ad = AD_INDEX[adName] || {};
  const existing = overrideForAd(adName) || { imageUrl: '', previewUrl: '' };
  const externalId = ad.externalId || existing.externalId || '';
  await fetch(`${SUPABASE_URL}/rest/v1/ad_overrides`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ ad_name: adName, ad_external_id: externalId || null, feedback_applied: !!applied, updated_at: new Date().toISOString() })
  });
  OVERRIDES_CACHE[adName] = { ...existing, externalId, feedbackApplied: !!applied };
  if(externalId) OVERRIDES_BY_EXTERNAL_ID[externalId] = OVERRIDES_CACHE[adName];
  if(applied){
    FEEDBACK_HISTORY[adName] = {
      resolvedAt: new Date().toISOString(),
      resolvedBy: getCurrentUserEmail() || 'Team'
    };
  } else {
    delete FEEDBACK_HISTORY[adName];
  }
  await setAppSetting(FEEDBACK_HISTORY_KEY, JSON.stringify(FEEDBACK_HISTORY));
  COMMENT_COUNTS[adName] = applied ? 0 : (await fetchComments(adName)).length;
}

// ---------- comment threads (per-ad, multi-comment, author-attributed) ----------
let COMMENT_COUNTS = {};

async function fetchCommentCounts(){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_comments?select=id,ad_name`, { headers: supabaseHeaders() });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const counts = {};
    rows.forEach(r => {
      if(!commentResolution(r.ad_name, r.id)) counts[r.ad_name] = (counts[r.ad_name] || 0) + 1;
    });
    COMMENT_COUNTS = counts;
  } catch(e){
    console.error('Could not load comment counts:', e);
  }
  return COMMENT_COUNTS;
}

async function fetchComments(adName){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_comments?ad_name=eq.${encodeURIComponent(adName)}&select=id,author,body,created_at&order=created_at.asc`, { headers: supabaseHeaders() });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch(e){
    console.error('Could not load comments:', e);
    return [];
  }
}

async function postComment(adName, author, body){
  await fetch(`${SUPABASE_URL}/rest/v1/ad_comments`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ad_name: adName, author, body })
  });
}

async function deleteComment(id){
  await fetch(`${SUPABASE_URL}/rest/v1/ad_comments?id=eq.${id}`, { method: 'DELETE', headers: supabaseHeaders() });
}

function decodeJwtEmail(token){
  try{
    const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const payload = JSON.parse(atob(b64));
    return payload.email || '';
  } catch(e){ return ''; }
}
function getCurrentUserEmail(){
  const s = getStoredSession && getStoredSession();
  return s ? decodeJwtEmail(s.access_token) : '';
}

function applyOverride(ad){
  if(!ad || !ad.name) return ad;
  const o = overrideForAd(ad);
  const durableSavedImage = o.imageStoragePath ? o.imageUrl : '';
  return {
    ...ad,
    // Durable uploads win first. A recovered local asset must not be hidden by
    // an older expired LinkedIn override; temporary URLs remain the fallback.
    imageUrl: durableSavedImage || DURABLE_IMAGE_OVERRIDES[ad.name] || o.imageUrl || ad.imageUrl || '',
    previewUrl: o.previewUrl || ad.previewUrl || '',
    cta: o.ctaLabel || ad.cta || '',
    ctaUrl: o.ctaUrl || ad.url || '',
    feedbackNote: o.feedbackNote || '',
    feedbackApplied: !!o.feedbackApplied,
    displayName: o.displayName || '',
    savedPreview: !!(o.imageUrl || o.previewUrl || o.ctaLabel || o.ctaUrl),
    imageDurable: !!o.imageStoragePath
  };
}
function applyOverridesToData(data){
  const dateByAdset = new Map();
  (data.campaigns || []).forEach(camp => {
    (camp.adsets || []).forEach(as => {
      dateByAdset.set(adsetKey(camp.name, as.name), { start: as.start || '', end: as.end || '' });
    });
  });
  data.flatAds = (data.flatAds || []).map(applyOverride);
  data.flatAds = data.flatAds.map(ad => {
    const dates = dateByAdset.get(adsetKey(ad.campaign, ad.adset)) || {};
    return { ...ad, start: ad.start || dates.start || '', end: ad.end || dates.end || '' };
  });
  data.campaigns.forEach(camp => {
    camp.adsets.forEach(as => {
      as.top_ad = applyOverride(as.top_ad);
      as.ads = (as.ads || []).map(applyOverride);
    });
  });
  AD_INDEX = {};
  (data.flatAds || []).forEach(a => { if(a && a.name) AD_INDEX[a.name] = a; });
  return data;
}

// ---------- shared app settings (sheet URL + pinned version) — same for everyone, stored in Supabase ----------
async function getAppSetting(key){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, { headers: supabaseHeaders() });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    return rows.length ? rows[0].value : '';
  } catch(e){
    console.error('Could not read app setting', key, e);
    return '';
  }
}
async function setAppSetting(key, value){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ key, value: value || '', updated_at: new Date().toISOString() })
  });
  if(!res.ok) throw new Error(`Could not save shared setting (HTTP ${res.status}).`);
}
async function loadSharedScoreBands(){
  const saved = await getAppSetting(SCORE_CONFIG_KEY);
  if(!saved) return;
  try{
    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if(validScoreBands(parsed)){
      SCORE_BANDS = parsed.map(b => ({ min: Number(b.min), label: b.label.trim(), color: b.color }));
    }
  } catch(e){
    console.error('Could not parse shared score legend:', e);
  }
}
async function loadCampaignObjectives(){
  const saved = await getAppSetting(CAMPAIGN_OBJECTIVES_KEY);
  if(!saved) return;
  try{
    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if(parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
      CAMPAIGN_OBJECTIVES = Object.fromEntries(
        Object.entries(parsed)
          .map(([campaign, objectives]) => [campaign, normalizeCampaignObjectives(objectives)])
          .filter(([, objectives]) => objectives.length)
      );
    }
  } catch(e){
    console.error('Could not parse campaign objectives:', e);
  }
}
async function saveCampaignObjectives(campaignName, objectives){
  const normalized = normalizeCampaignObjectives(objectives);
  if(normalized.length) CAMPAIGN_OBJECTIVES[campaignName] = normalized;
  else delete CAMPAIGN_OBJECTIVES[campaignName];
  await setAppSetting(CAMPAIGN_OBJECTIVES_KEY, JSON.stringify(CAMPAIGN_OBJECTIVES));
}
async function loadAdsetDisplayNames(){
  const saved = await getAppSetting(ADSET_DISPLAY_NAMES_KEY);
  if(!saved) return;
  try{
    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if(parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
      ADSET_DISPLAY_NAMES = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string' && value.trim())
      );
    }
  } catch(e){
    console.error('Could not parse ad set display names:', e);
  }
}
async function saveAdsetDisplayName(campaignName, adsetName, displayName){
  const key = adsetKey(campaignName, adsetName);
  if(displayName) ADSET_DISPLAY_NAMES[key] = displayName;
  else delete ADSET_DISPLAY_NAMES[key];
  await setAppSetting(ADSET_DISPLAY_NAMES_KEY, JSON.stringify(ADSET_DISPLAY_NAMES));
}
async function loadAdsetBriefs(){
  const saved = await getAppSetting(ADSET_BRIEFS_KEY);
  if(!saved) return;
  try{
    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if(parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
      ADSET_BRIEFS = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string' && value.trim())
      );
    }
  } catch(e){
    console.error('Could not parse ad set briefs:', e);
  }
}
async function loadFeedbackHistory(){
  const saved = await getAppSetting(FEEDBACK_HISTORY_KEY);
  if(!saved) return;
  try{
    const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if(parsed && typeof parsed === 'object' && !Array.isArray(parsed)) FEEDBACK_HISTORY = parsed;
  } catch(e){
    console.error('Could not parse feedback resolution history:', e);
  }
}
async function saveAdsetBrief(campaignName, adsetName, brief){
  const key = adsetKey(campaignName, adsetName);
  if(brief) ADSET_BRIEFS[key] = brief;
  else delete ADSET_BRIEFS[key];
  await setAppSetting(ADSET_BRIEFS_KEY, JSON.stringify(ADSET_BRIEFS));
}
function adsetBriefFor(campaignName, adsetName){
  return ADSET_BRIEFS[adsetKey(campaignName, adsetName)] || '';
}

// ---------- version history — full snapshots of aggregated sheet data, revertible for everyone ----------
async function saveDataVersion(data, label, source){
  try{
    await fetch(`${SUPABASE_URL}/rest/v1/data_versions`, {
      method: 'POST',
      headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ label, source, data })
    });
  } catch(e){
    console.error('Could not save version snapshot', e);
  }
}
async function fetchVersions(){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/data_versions?select=id,created_at,label,source&order=created_at.desc&limit=30`, { headers: supabaseHeaders() });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch(e){
    console.error('Could not load version history', e);
    return [];
  }
}
async function fetchVersionData(id){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/data_versions?id=eq.${id}&select=data`, { headers: supabaseHeaders() });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const rows = await res.json();
  return rows.length ? rows[0].data : null;
}

// ---------- fallback snapshot (fetched from data.json, same-origin) ----------
let FALLBACK_DATA = null;
const FALLBACK_DATE = 'Jul 22, 2026';

async function getFallbackData(){
  if(FALLBACK_DATA) return FALLBACK_DATA;
  const res = await fetch('data.json');
  FALLBACK_DATA = await res.json();
  return FALLBACK_DATA;
}

let CARDS = [];
let ACCOUNT_AVG_CTR = 0;
let AD_INDEX = {};
let DATA = { campaigns: [], flatAds: [], landingPages: [], accountTrend: [] };
let state = { search: '', sortKey: 'spend', selectedId: null, statusFilter: 'All', dateRange: 'all' };
const STATUS_FILTERS = ['Active', 'All', 'Paused', 'Deleted'];
let filterIdx = 0;

function passesStatusFilter(status){
  const normalized = String(status || '').trim().toLowerCase();
  if(state.statusFilter === 'All') return true;
  if(state.statusFilter === 'Paused') return normalized === 'paused' || normalized === 'passive';
  return normalized === state.statusFilter.toLowerCase();
}
let currentView = 'campaigns';

// ---------- CSV parsing (quoted fields, embedded commas/newlines) ----------
function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field=''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c === '\r'){ /* skip */ }
      else field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

function rowsToRecords(rows){
  const headerIdx = rows.findIndex(r => r[0] && r[0].trim() === 'Start Date (in UTC)');
  if(headerIdx === -1) return [];
  const headers = rows[headerIdx].map(h => h.trim());
  const out = [];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i];
    if(!r || r.length < 2 || !r[0]) continue;
    const obj = {};
    headers.forEach((h,idx) => obj[h] = r[idx] !== undefined ? r[idx] : '');
    out.push(obj);
  }
  return out;
}

function num(v){
  if(v===undefined||v===null||v==='') return 0;
  const n = parseFloat(String(v).replace(/,/g,'').replace(/%/g,''));
  return isNaN(n) ? 0 : n;
}

function firstRecordValue(record, keys){
  for(const key of keys){
    const value = record[key];
    if(value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function recordCTA(record){
  return firstRecordValue(record, [
    'Call to Action',
    'Call-to-Action',
    'Call To Action',
    'Ad Call to Action',
    'Ad Call-to-Action',
    'Ad CTA',
    'CTA'
  ]);
}
function recordAdExternalId(record){
  return firstRecordValue(record, [
    'Ad ID',
    'Creative ID',
    'Ad Creative ID',
    'Sponsored Content ID'
  ]);
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseUSDate(v){
  const parts = String(v).split('/');
  if(parts.length !== 3) return null;
  const m = parseInt(parts[0],10), d = parseInt(parts[1],10), y = parseInt(parts[2],10);
  if(!m || !d || !y) return null;
  return new Date(y, m-1, d);
}
function fmtDate(d){ return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() : '—'; }
function parseDisplayDate(v, fallbackYear){
  const match = String(v || '').trim().match(/^([A-Za-z]{3})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if(!match) return null;
  const month = MONTHS.findIndex(m => m.toLowerCase() === match[1].toLowerCase());
  if(month < 0) return null;
  return new Date(Number(match[3] || fallbackYear), month, Number(match[2]));
}

// ---------- aggregation (mirrors the Python groupby used to build the fallback) ----------
function aggregate(records){
  const groups = new Map(); // "campaign|||adset" -> {campaign, adset, objective, status, dailyBudget, costType, rows:[]}
  records.forEach(r => {
    const camp = r['Campaign Name'], adset = r['Ad Set Name'];
    if(!camp || !adset) return;
    const key = camp + '|||' + adset;
    if(!groups.has(key)) groups.set(key, {
      campaign:camp, adset, objective:r['Ad Set Objective'], status:r['Ad Set Status'],
      dailyBudget: num(r['Daily Budget']), costType: r['Cost Type'] || '', rows:[]
    });
    groups.get(key).rows.push(r);
  });

  const byCampaign = new Map();
  const flatAds = [];
  const landingMap = new Map();

  groups.forEach(g => {
    const rows = g.rows;
    const spend = rows.reduce((s,r)=>s+num(r['Total Spent']),0);
    const impressions = rows.reduce((s,r)=>s+num(r['Impressions']),0);
    const clicks = rows.reduce((s,r)=>s+num(r['Clicks']),0);
    const leads = rows.reduce((s,r)=>s+num(r['Leads']),0);
    const conversions = rows.reduce((s,r)=>s+num(r['Conversions']),0);
    const reactions = rows.reduce((s,r)=>s+num(r['Reactions']),0);
    const dates = rows.map(r=>parseUSDate(r['Start Date (in UTC)'])).filter(Boolean).sort((a,b)=>a-b);
    const adNames = new Set(rows.map(r=>r['Ad Name']).filter(Boolean));
    const activeDays = new Set(rows.map(r=>r['Start Date (in UTC)'])).size;
    const ctr = impressions ? +(clicks/impressions*100).toFixed(2) : 0;
    const cpc = clicks ? +(spend/clicks).toFixed(2) : 0;
    const cpl = leads ? +(spend/leads).toFixed(2) : null;

    const dayMap = new Map();
    rows.forEach(r=>{
      const d = r['Start Date (in UTC)'];
      dayMap.set(d, (dayMap.get(d)||0) + num(r['Total Spent']));
    });
    const trend = Array.from(dayMap.entries())
      .map(([d,v])=>({d:parseUSDate(d), v}))
      .filter(x=>x.d)
      .sort((a,b)=>a.d-b.d)
      .slice(-14)
      .map(x=>+x.v.toFixed(2));

    const adMap = new Map();
    rows.forEach(r=>{
      const an = r['Ad Name']; if(!an) return;
      const externalId = recordAdExternalId(r);
      const key = externalId ? `id:${externalId}` : an + '|||' + (r['Ad Headline']||'') + '|||' + (r['Ad Status']||'');
      if(!adMap.has(key)) adMap.set(key, {name:an, externalId, headline:r['Ad Headline']||'', intro:r['Ad Introduction Text']||'', cta:recordCTA(r), status:r['Ad Status']||'', url:r['Click URL']||'', imageUrl:r['Ad Image URL']||'', previewUrl:r['Ad Preview URL']||'', spend:0, impressions:0, clicks:0, leads:0, conversions:0, reactions:0, dates:[]});
      const a = adMap.get(key);
      const rowDate = parseUSDate(r['Start Date (in UTC)']);
      if(rowDate) a.dates.push(rowDate);
      a.spend += num(r['Total Spent']);
      a.impressions += num(r['Impressions']);
      a.clicks += num(r['Clicks']);
      a.leads += num(r['Leads']);
      a.conversions += num(r['Conversions']);
      a.reactions += num(r['Reactions']);
      if(!a.url && r['Click URL']) a.url = r['Click URL'];
      if(!a.imageUrl && r['Ad Image URL']) a.imageUrl = r['Ad Image URL'];
      if(!a.previewUrl && r['Ad Preview URL']) a.previewUrl = r['Ad Preview URL'];
      if(!a.cta) a.cta = recordCTA(r);
      if(!a.externalId) a.externalId = recordAdExternalId(r);
    });
    let adsFull = Array.from(adMap.values())
      .map(a => {
        const sortedDates = a.dates.sort((x,y) => x-y);
        const { dates: _dates, ...cleanAd } = a;
        return {...cleanAd, start:fmtDate(sortedDates[0]), end:fmtDate(sortedDates[sortedDates.length-1]), spend:+a.spend.toFixed(2), ctr: a.impressions ? +(a.clicks/a.impressions*100).toFixed(2) : 0, intro: a.intro || ''};
      })
      .sort((a,b)=>b.spend-a.spend);

    const top_ad = adsFull[0] || {headline:'', intro:''};
    const adsTop = adsFull;

    adsFull.forEach(a => {
      flatAds.push({...a, campaign:g.campaign, campaignShort: shortCampaignName(g.campaign), adset:g.adset});
      if(a.url){
        const base = a.url.split('?')[0];
        if(!landingMap.has(base)) landingMap.set(base, {url:base, spend:0, impressions:0, clicks:0, ads:new Set(), campaigns:new Set()});
        const lp = landingMap.get(base);
        lp.spend += a.spend; lp.impressions += a.impressions; lp.clicks += a.clicks;
        lp.ads.add(a.name); lp.campaigns.add(g.campaign);
      }
    });

    if(!byCampaign.has(g.campaign)) byCampaign.set(g.campaign, []);
    byCampaign.get(g.campaign).push({
      name: g.adset, objective: g.objective, status: g.status,
      dailyBudget: g.dailyBudget, costType: g.costType,
      spend:+spend.toFixed(2), impressions, clicks, leads, conversions, reactions,
      ctr, cpc, cpl, start: fmtDate(dates[0]), end: fmtDate(dates[dates.length-1]),
      n_ads: adNames.size, activeDays, trend, top_ad, ads: adsTop
    });
  });

  const accDay = new Map();
  records.forEach(r=>{
    const d = r['Start Date (in UTC)'];
    accDay.set(d, (accDay.get(d)||0) + num(r['Total Spent']));
  });
  const accountTrend = Array.from(accDay.entries())
    .map(([d,v])=>({date:d, dObj:parseUSDate(d), v}))
    .filter(x=>x.dObj)
    .sort((a,b)=>a.dObj-b.dObj)
    .map(x=>({date:x.date, label:fmtDate(x.dObj), v:+x.v.toFixed(2)}));

  const landingPages = Array.from(landingMap.values()).map(lp => ({
    url: lp.url, spend:+lp.spend.toFixed(2), impressions: lp.impressions, clicks: lp.clicks,
    ctr: lp.impressions ? +(lp.clicks/lp.impressions*100).toFixed(2) : 0,
    n_ads: lp.ads.size, campaigns: Array.from(lp.campaigns).map(shortCampaignName)
  })).sort((a,b)=>b.spend-a.spend);

  return {
    campaigns: Array.from(byCampaign.entries()).map(([name,adsets]) => ({name, adsets})),
    flatAds: flatAds.sort((a,b)=>b.spend-a.spend),
    landingPages,
    accountTrend
  };
}

function buildCards(rawCampaigns){
  const cards = [];
  rawCampaigns.forEach((camp) => {
    camp.adsets.forEach((as) => {
      const id = cards.length + '';
      const allAdsForSet = (DATA.flatAds || []).filter(a => a.campaign === camp.name && a.adset === as.name);
      const selectedObjective = campaignObjectiveFor(camp.name, as.objective);
      const ads = allAdsForSet.length ? allAdsForSet : as.ads;
      ads.forEach(ad => { ad.objective = selectedObjective; });
      cards.push({
        id,
        campaign: camp.name,
        campaignShort: shortCampaignName(camp.name),
        rawStatus: as.status,
        ...as,
        objective: selectedObjective,
        displayName: ADSET_DISPLAY_NAMES[adsetKey(camp.name, as.name)] || '',
        ads,
        top_ad: applyObjectiveToAd(as.top_ad, selectedObjective),
        status: deriveStatus(as.trend),
        gradient: GRADIENTS[cards.length % GRADIENTS.length]
      });
    });
  });
  ACCOUNT_AVG_CTR = computeAvgCtr(cards);
  const objectiveAverages = {};
  cards.forEach(card => {
    const key = objectiveKey(card.objective);
    if(key && !(key in objectiveAverages)){
      objectiveAverages[key] = computeAvgCtr(cards.filter(peer => objectiveKey(peer.objective) === key));
    }
  });
  cards.forEach(c => {
    c.perf = derivePerformanceStatus(c, objectiveAverages[objectiveKey(c.objective)]);
    c.blurb = campaignBlurb(c);
  });
  return cards;
}
function applyObjectiveToAd(ad, objective){
  if(!ad) return ad;
  ad.objective = objective;
  return ad;
}

// ---------- sync status UI ----------
function setSyncStatus(mode, extra){
  const el = document.getElementById('syncStatus');
  const txt = document.getElementById('syncStatusText');
  el.className = 'sync-status ' + (mode==='live'?'live':mode==='stale'?'stale':mode==='err'?'err':'');
  const labels = {
    loading:'Loading…', live:'Live · synced ' + (extra||'just now'),
    stale:'Snapshot data', err:'Sheet error — showing snapshot'
  };
  txt.textContent = labels[mode] || '';
}

let bannerMode = 'live', bannerMessage = '';
function renderBanner(mode, message){
  bannerMode = mode;
  bannerMessage = message || '';
}
function bannerHTML(){
  if(bannerMode === 'live') return '';
  const cls = bannerMode === 'err' ? 'err' : 'stale';
  const isPinned = bannerMode === 'pinned';
  return `
    <div class="data-banner ${cls}">
      <span>${bannerMessage}</span>
      <button class="db-btn" id="${isPinned ? 'bannerResumeBtn' : 'bannerConnectBtn'}">${isPinned ? 'Resume live sync' : 'Connect Google Sheet'}</button>
    </div>`;
}

// ---------- date range filtering ----------
let RAW_RECORDS = null;
function filterRecordsByDateRange(records, days){
  if(days === 'all') return records;
  const dates = records.map(r => parseUSDate(r['Start Date (in UTC)'])).filter(Boolean);
  if(!dates.length) return records;
  const maxDate = new Date(Math.max(...dates));
  const cutoff = new Date(maxDate);
  cutoff.setDate(cutoff.getDate() - Number(days) + 1);
  return records.filter(r => {
    const d = parseUSDate(r['Start Date (in UTC)']);
    return d && d >= cutoff;
  });
}
function updateDateRangeAvailability(){
  const sel = document.getElementById('dateRangeSelect');
  sel.disabled = false;
  sel.title = 'Filter by date';
}
function latestAvailableDate(){
  const trendDates = (DATA.accountTrend || []).map(x => parseUSDate(x.date)).filter(Boolean);
  if(trendDates.length) return new Date(Math.max(...trendDates));
  return new Date();
}
function passesDateFilter(item){
  if(state.dateRange === 'all') return true;
  const latest = latestAvailableDate();
  const year = latest.getFullYear();
  const end = parseDisplayDate(item.end, year) || parseDisplayDate(item.start, year);
  if(!end) return true;
  const cutoff = new Date(latest);
  cutoff.setDate(cutoff.getDate() - Number(state.dateRange) + 1);
  return end >= cutoff;
}

// ---------- load ----------
async function loadData(){
  setSyncStatus('loading');
  await fetchOverrides();
  const [sheetUrl, pinnedId] = await Promise.all([getAppSetting('sheet_url'), getAppSetting('pinned_version_id')]);

  if(pinnedId){
    try{
      const versionData = await fetchVersionData(pinnedId);
      if(!versionData) throw new Error('That version could not be found.');
      RAW_RECORDS = null;
      DATA = applyOverridesToData(versionData);
      CARDS = buildCards(DATA.campaigns);
      setSyncStatus('stale');
      renderBanner('pinned', `Viewing a saved version, not the live sheet — this is what everyone sees right now.`);
      updateDateRangeAvailability();
      renderMain();
      return;
    } catch(e){
      console.error(e);
      // fall through to the normal flow if the pinned version can't be loaded
    }
  }

  if(!sheetUrl){
    RAW_RECORDS = null;
    DATA = applyOverridesToData(await getFallbackData());
    CARDS = buildCards(DATA.campaigns);
    setSyncStatus('stale');
    renderBanner('stale', `Showing a snapshot from ${FALLBACK_DATE}. Connect a Google Sheet to keep this live for everyone.`);
    updateDateRangeAvailability();
    renderMain();
    return;
  }
  try{
    const sep = sheetUrl.includes('?') ? '&' : '?';
    const res = await fetch(sheetUrl + sep + 'cb=' + Date.now());
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const records = rowsToRecords(parseCSV(text));
    if(records.length === 0) throw new Error('No rows found — check the sheet has the LinkedIn export header row.');
    RAW_RECORDS = records;
    DATA = applyOverridesToData(aggregate(filterRecordsByDateRange(records, state.dateRange)));
    CARDS = buildCards(DATA.campaigns);
    setSyncStatus('live', new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
    renderBanner('live');
  } catch(e){
    console.error(e);
    RAW_RECORDS = null;
    DATA = applyOverridesToData(await getFallbackData());
    CARDS = buildCards(DATA.campaigns);
    setSyncStatus('err');
    renderBanner('err', `Couldn't load the connected sheet (${e.message}). Showing the ${FALLBACK_DATE} snapshot instead.`);
  }
  updateDateRangeAvailability();
  renderMain();
}

function wireBannerButtons(){
  const connectBtn = document.getElementById('bannerConnectBtn');
  if(connectBtn) connectBtn.addEventListener('click', openSettings);
  const resumeBtn = document.getElementById('bannerResumeBtn');
  if(resumeBtn) resumeBtn.addEventListener('click', async () => {
    resumeBtn.textContent = 'Resuming…';
    await setAppSetting('pinned_version_id', '');
    loadData();
  });
}

// ---------- settings modal ----------
async function openSettings(){
  document.getElementById('sheetUrlInput').value = '';
  document.getElementById('modalStatus').textContent = 'Loading current connection…';
  document.getElementById('modalStatus').className = 'modal-status';
  document.getElementById('settingsOverlay').classList.add('show');
  const current = await getAppSetting('sheet_url');
  document.getElementById('sheetUrlInput').value = current || '';
  document.getElementById('modalStatus').textContent = '';
}
function closeSettings(){ document.getElementById('settingsOverlay').classList.remove('show'); }

document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('modalCancel').addEventListener('click', closeSettings);
document.getElementById('modalUseSnapshot').addEventListener('click', async () => {
  await Promise.all([setAppSetting('sheet_url', ''), setAppSetting('pinned_version_id', '')]);
  closeSettings();
  loadData();
});
document.getElementById('modalSave').addEventListener('click', async () => {
  const val = document.getElementById('sheetUrlInput').value.trim();
  const statusEl = document.getElementById('modalStatus');
  if(!val){ statusEl.textContent = 'Paste a published CSV link first.'; statusEl.className = 'modal-status bad'; return; }
  statusEl.textContent = 'Checking…'; statusEl.className = 'modal-status';
  try{
    const sep = val.includes('?') ? '&' : '?';
    const res = await fetch(val + sep + 'cb=' + Date.now());
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const records = rowsToRecords(parseCSV(text));
    if(records.length === 0) throw new Error('No matching header row found');
    const aggregated = aggregate(records);
    await Promise.all([setAppSetting('sheet_url', val), setAppSetting('pinned_version_id', '')]);
    await saveDataVersion(aggregated, `Connected — ${new Date().toLocaleString()}`, 'connect');
    statusEl.textContent = `Connected for everyone — found ${records.length} rows.`;
    statusEl.className = 'modal-status ok';
    setTimeout(() => { closeSettings(); loadData(); }, 700);
  } catch(e){
    statusEl.textContent = 'Could not read that sheet (' + e.message + '). Make sure it\'s published to the web as CSV.';
    statusEl.className = 'modal-status bad';
  }
});

// ---------- version history modal ----------
async function openVersionHistory(){
  const list = document.getElementById('versionHistoryList');
  list.innerHTML = '<div class="empty-note">Loading…</div>';
  document.getElementById('versionHistoryOverlay').classList.add('show');
  const [versions, pinnedId] = await Promise.all([fetchVersions(), getAppSetting('pinned_version_id')]);
  if(!versions.length){
    list.innerHTML = '<div class="empty-note">No saved versions yet. Connect a sheet, or click "Save current as version" below.</div>';
    return;
  }
  list.innerHTML = versions.map(v => `
    <div class="creative-row" style="padding:10px 12px;">
      <div class="cr-main">
        <div class="cr-name">${v.label || 'Snapshot'}${String(pinnedId) === String(v.id) ? ' <span class="status-pill status-scaling" style="margin-left:6px;">Active</span>' : ''}</div>
        <div class="cr-meta">${new Date(v.created_at).toLocaleString()} · ${v.source || 'sync'}</div>
      </div>
      <span class="edit-preview-link" data-revert-id="${v.id}">Revert to this</span>
    </div>`).join('');
  list.querySelectorAll('[data-revert-id]').forEach(el => {
    el.addEventListener('click', async () => {
      el.textContent = 'Reverting…';
      await setAppSetting('pinned_version_id', el.getAttribute('data-revert-id'));
      closeVersionHistory();
      loadData();
    });
  });
}
function closeVersionHistory(){ document.getElementById('versionHistoryOverlay').classList.remove('show'); }
document.getElementById('historyBtn').addEventListener('click', openVersionHistory);
document.getElementById('versionHistoryClose').addEventListener('click', closeVersionHistory);
document.getElementById('versionHistorySaveNow').addEventListener('click', async () => {
  const btn = document.getElementById('versionHistorySaveNow');
  btn.textContent = 'Saving…';
  await saveDataVersion(DATA, `Manual save — ${new Date().toLocaleString()}`, 'manual');
  btn.textContent = 'Save current as version';
  openVersionHistory();
});
document.getElementById('versionHistoryOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'versionHistoryOverlay') closeVersionHistory();
});

// ---------- ad preview editor (image URL + LinkedIn preview URL) ----------
async function openAdPreviewEditor(adName){
  if(!adName) return;
  document.getElementById('adPreviewName').textContent = adLabel(AD_INDEX[adName]) || adName;
  document.getElementById('adImageUrlInput').value = '';
  document.getElementById('adPreviewUrlInput').value = '';
  document.getElementById('adCtaLabelInput').value = '';
  document.getElementById('adCtaUrlInput').value = '';
  document.getElementById('adImageFileInput').value = '';
  document.getElementById('adAssetHealth').textContent = '';
  document.getElementById('adPreviewStatus').textContent = 'Loading…';
  document.getElementById('adPreviewStatus').className = 'modal-status';
  document.getElementById('adPreviewOverlay').dataset.adName = adName;
  document.getElementById('adPreviewOverlay').classList.add('show');
  await fetchOverrides();
  const ad = AD_INDEX[adName] || {};
  const existing = overrideForAd(adName);
  document.getElementById('adImageUrlInput').value = existing.imageUrl || '';
  document.getElementById('adPreviewUrlInput').value = existing.previewUrl || '';
  document.getElementById('adCtaLabelInput').value = existing.ctaLabel || ad.cta || '';
  document.getElementById('adCtaUrlInput').value = existing.ctaUrl || ad.url || '';
  const effectiveImage = existing.imageUrl || ad.imageUrl || '';
  const health = [];
  if(existing.imageStoragePath) health.push('Image: durable storage ✓');
  else if(effectiveImage && /(?:licdn\.com|linkedin\.com).*?(?:[?&](?:e|exp|expires)=|dms\/image)/i.test(effectiveImage)) health.push('Image: temporary LinkedIn link — upload the file to make it durable');
  else if(effectiveImage) health.push('Image: external URL');
  else health.push('Image: not added');
  health.push(existing.previewUrl ? 'Preview link: saved in DB ✓' : 'Preview link: using spreadsheet fallback');
  health.push(existing.ctaUrl ? 'CTA destination: saved in DB ✓' : 'CTA destination: using spreadsheet fallback');
  if(ad.externalId) health.push('Matched by creative ID ✓');
  document.getElementById('adAssetHealth').textContent = health.join(' · ');
  document.getElementById('adAssetHealth').className = 'modal-status ' + (existing.imageStoragePath ? 'ok' : '');
  document.getElementById('adPreviewStatus').textContent = '';
}
function closeAdPreviewEditor(){ document.getElementById('adPreviewOverlay').classList.remove('show'); }
document.getElementById('adPreviewClose').addEventListener('click', closeAdPreviewEditor);
document.getElementById('adPreviewClear').addEventListener('click', async () => {
  const adName = document.getElementById('adPreviewOverlay').dataset.adName;
  await saveOverride(adName, '', '', '', '');
  closeAdPreviewEditor();
  loadData();
});
document.getElementById('adPreviewSave').addEventListener('click', async () => {
  const adName = document.getElementById('adPreviewOverlay').dataset.adName;
  let imageUrl = document.getElementById('adImageUrlInput').value.trim();
  const imageFile = document.getElementById('adImageFileInput').files[0];
  const previewUrl = document.getElementById('adPreviewUrlInput').value.trim();
  const ctaLabel = document.getElementById('adCtaLabelInput').value.trim();
  const ctaUrl = document.getElementById('adCtaUrlInput').value.trim();
  const statusEl = document.getElementById('adPreviewStatus');
  if(!imageFile && !imageUrl && !previewUrl && !ctaLabel && !ctaUrl){
    statusEl.textContent = 'Add at least one preview or CTA value.'; statusEl.className = 'modal-status bad'; return;
  }
  if(ctaUrl && !/^https?:\/\//i.test(ctaUrl)){
    statusEl.textContent = 'CTA destination must start with http:// or https://.'; statusEl.className = 'modal-status bad'; return;
  }
  statusEl.textContent = 'Saving…'; statusEl.className = 'modal-status';
  try{
    let imageStoragePath = (OVERRIDES_CACHE[adName] && OVERRIDES_CACHE[adName].imageStoragePath) || '';
    if(imageFile){
      statusEl.textContent = 'Uploading image to durable storage…';
      const uploaded = await uploadCreativeImage(adName, imageFile);
      imageUrl = uploaded.url;
      imageStoragePath = uploaded.path;
    } else if(imageUrl !== ((OVERRIDES_CACHE[adName] && OVERRIDES_CACHE[adName].imageUrl) || '')){
      imageStoragePath = '';
    }
    await saveOverride(adName, imageUrl, previewUrl, ctaLabel, ctaUrl, imageStoragePath);
    statusEl.textContent = 'Saved — visible to everyone.'; statusEl.className = 'modal-status ok';
    setTimeout(() => { closeAdPreviewEditor(); loadData().then(() => { openPanel(state.selectedId); }); }, 500);
  } catch(e){
    statusEl.textContent = 'Could not save (' + e.message + ').'; statusEl.className = 'modal-status bad';
  }
});
document.getElementById('adPreviewOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'adPreviewOverlay') closeAdPreviewEditor();
});
// The creative lists are replaced with innerHTML whenever filters, sorting, or
// the selected preview changes. Delegate this action once so Add/Edit image
// keeps working across every render path.
document.addEventListener('click', (e) => {
  if(!(e.target instanceof Element)) return;
  const trigger = e.target.closest('.edit-preview-link[data-ad]');
  if(!trigger) return;
  e.preventDefault();
  e.stopPropagation();
  openAdPreviewEditor(trigger.getAttribute('data-ad'));
});

// ---------- shared rename editor — original export names remain stable lookup keys ----------
async function openRenameEditor(adName){
  if(!adName) return;
  document.getElementById('renameRealName').textContent = adName;
  document.getElementById('renameInput').value = '';
  document.getElementById('renameStatus').textContent = '';
  document.getElementById('renameOverlay').dataset.adName = adName;
  document.getElementById('renameOverlay').dataset.entityType = 'ad';
  document.getElementById('renameTitle').textContent = 'Rename creative';
  document.getElementById('renameDescription').firstChild.textContent = 'This changes what everyone sees in the workspace only — the underlying creative name (';
  document.getElementById('renameInput').placeholder = 'e.g. Billable Hours — Checklist v2';
  document.getElementById('renameOverlay').classList.add('show');
  await fetchOverrides();
  const existing = getOverrides()[adName] || {};
  document.getElementById('renameInput').value = existing.displayName || '';
}
function openAdsetRenameEditor(campaignName, adsetName){
  if(!campaignName || !adsetName) return;
  const overlay = document.getElementById('renameOverlay');
  overlay.dataset.entityType = 'adset';
  overlay.dataset.campaignName = campaignName;
  overlay.dataset.adsetName = adsetName;
  document.getElementById('renameTitle').textContent = 'Rename ad set';
  document.getElementById('renameDescription').firstChild.textContent = 'This changes what everyone sees in the workspace only — the underlying ad-set name (';
  document.getElementById('renameRealName').textContent = adsetName;
  document.getElementById('renameInput').value = ADSET_DISPLAY_NAMES[adsetKey(campaignName, adsetName)] || '';
  document.getElementById('renameInput').placeholder = 'e.g. Legal Lead Gen — Retargeting';
  document.getElementById('renameStatus').textContent = '';
  overlay.classList.add('show');
}
function closeRenameEditor(){ document.getElementById('renameOverlay').classList.remove('show'); }
document.getElementById('renameClose').addEventListener('click', closeRenameEditor);
document.getElementById('renameClear').addEventListener('click', async () => {
  const overlay = document.getElementById('renameOverlay');
  if(overlay.dataset.entityType === 'adset'){
    await saveAdsetDisplayName(overlay.dataset.campaignName, overlay.dataset.adsetName, '');
  } else {
    await saveDisplayName(overlay.dataset.adName, '');
  }
  closeRenameEditor();
  loadData();
});
document.getElementById('renameSave').addEventListener('click', async () => {
  const overlay = document.getElementById('renameOverlay');
  const displayName = document.getElementById('renameInput').value.trim();
  const statusEl = document.getElementById('renameStatus');
  statusEl.textContent = 'Saving…'; statusEl.className = 'modal-status';
  try{
    if(overlay.dataset.entityType === 'adset'){
      await saveAdsetDisplayName(overlay.dataset.campaignName, overlay.dataset.adsetName, displayName);
    } else {
      await saveDisplayName(overlay.dataset.adName, displayName);
    }
    statusEl.textContent = 'Saved — visible to everyone.'; statusEl.className = 'modal-status ok';
    setTimeout(() => { closeRenameEditor(); loadData(); }, 500);
  } catch(e){
    statusEl.textContent = 'Could not save (' + e.message + ').'; statusEl.className = 'modal-status bad';
  }
});
document.getElementById('renameOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'renameOverlay') closeRenameEditor();
});

// ---------- shared campaign brief editor (stored per ad set) ----------
function openAdsetBriefEditor(campaignName, adsetName){
  if(!campaignName || !adsetName) return;
  const overlay = document.getElementById('briefOverlay');
  overlay.dataset.campaignName = campaignName;
  overlay.dataset.adsetName = adsetName;
  document.getElementById('briefAdsetName').textContent = ADSET_DISPLAY_NAMES[adsetKey(campaignName, adsetName)] || adsetName;
  document.getElementById('briefInput').value = adsetBriefFor(campaignName, adsetName);
  document.getElementById('briefStatus').textContent = '';
  overlay.classList.add('show');
}
function closeAdsetBriefEditor(){ document.getElementById('briefOverlay').classList.remove('show'); }
document.getElementById('briefClose').addEventListener('click', closeAdsetBriefEditor);
document.getElementById('briefClear').addEventListener('click', async () => {
  const overlay = document.getElementById('briefOverlay');
  await saveAdsetBrief(overlay.dataset.campaignName, overlay.dataset.adsetName, '');
  closeAdsetBriefEditor();
  renderMain();
});
document.getElementById('briefSave').addEventListener('click', async () => {
  const overlay = document.getElementById('briefOverlay');
  const brief = document.getElementById('briefInput').value.trim();
  const statusEl = document.getElementById('briefStatus');
  statusEl.textContent = 'Saving…'; statusEl.className = 'modal-status';
  try{
    await saveAdsetBrief(overlay.dataset.campaignName, overlay.dataset.adsetName, brief);
    statusEl.textContent = 'Saved — visible to everyone.'; statusEl.className = 'modal-status ok';
    renderMain();
    setTimeout(closeAdsetBriefEditor, 400);
  } catch(e){
    statusEl.textContent = 'Could not save (' + e.message + ').'; statusEl.className = 'modal-status bad';
  }
});
document.getElementById('briefOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'briefOverlay') closeAdsetBriefEditor();
});
document.addEventListener('click', (e) => {
  if(!(e.target instanceof Element)) return;
  const trigger = e.target.closest('[data-adset-brief]');
  if(!trigger) return;
  e.preventDefault();
  e.stopPropagation();
  openAdsetBriefEditor(trigger.getAttribute('data-campaign'), trigger.getAttribute('data-adset'));
});

// ---------- comments editor (threaded, per-ad, author-attributed) ----------
function commentResolution(adName, commentId){
  const entry = FEEDBACK_HISTORY[adName] || {};
  return (entry.comments && entry.comments[String(commentId)]) || (entry.resolvedAt ? entry : null);
}
function splitComments(adName, comments){
  return comments.reduce((result, comment) => {
    (commentResolution(adName, comment.id) ? result.resolved : result.active).push(comment);
    return result;
  }, {active:[], resolved:[]});
}
async function setCommentResolved(adName, commentId, resolved, comments){
  const oldEntry = FEEDBACK_HISTORY[adName] || {};
  const commentMap = {...(oldEntry.comments || {})};
  if(oldEntry.resolvedAt && !oldEntry.comments){
    comments.forEach(comment => { commentMap[String(comment.id)] = {resolvedAt:oldEntry.resolvedAt, resolvedBy:oldEntry.resolvedBy || 'Team'}; });
  }
  if(resolved){
    commentMap[String(commentId)] = {resolvedAt:new Date().toISOString(), resolvedBy:getCurrentUserEmail() || 'Team'};
  } else {
    delete commentMap[String(commentId)];
  }
  if(Object.keys(commentMap).length) FEEDBACK_HISTORY[adName] = {comments:commentMap};
  else delete FEEDBACK_HISTORY[adName];
  await setAppSetting(FEEDBACK_HISTORY_KEY, JSON.stringify(FEEDBACK_HISTORY));
  const activeCount = comments.filter(comment => !commentMap[String(comment.id)]).length;
  const ad = AD_INDEX[adName] || {};
  const existing = overrideForAd(adName) || {imageUrl:'',previewUrl:''};
  const externalId = ad.externalId || existing.externalId || '';
  await fetch(`${SUPABASE_URL}/rest/v1/ad_overrides`, {
    method:'POST', headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'}),
    body:JSON.stringify({ad_name:adName,ad_external_id:externalId || null,feedback_applied:comments.length > 0 && activeCount === 0,updated_at:new Date().toISOString()})
  });
  OVERRIDES_CACHE[adName] = {...existing,externalId,feedbackApplied:comments.length > 0 && activeCount === 0};
  if(externalId) OVERRIDES_BY_EXTERNAL_ID[externalId] = OVERRIDES_CACHE[adName];
  COMMENT_COUNTS[adName] = activeCount;
}
function commentsHTML(comments, mode='active'){
  const adName = document.getElementById('adFeedbackOverlay').dataset.adName;
  return comments.map(c => `
    <div class="comment-item">
      <div class="comment-head">
        <span class="comment-author">${escapeHTML(c.author || 'Someone')}</span>
        <span class="comment-time">${new Date(c.created_at).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span>
        ${mode === 'active' ? `<span class="comment-del" data-del-id="${c.id}" title="Delete comment">✕</span>` : ''}
      </div>
      <div class="comment-body">${escapeHTML(c.body || '')}</div>
      ${mode === 'active' ? `<div class="comment-actions"><button type="button" class="comment-resolve" data-resolve-id="${c.id}">✓ Resolve</button></div>` : (() => { const meta=commentResolution(adName,c.id)||{}; const when=meta.resolvedAt?new Date(meta.resolvedAt).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Previously'; return `<div class="comment-resolution">Resolved by ${escapeHTML(meta.resolvedBy||'Team')} · ${escapeHTML(when)}</div><div class="comment-actions"><button type="button" class="comment-reopen" data-reopen-id="${c.id}">Reopen</button></div>`; })()}
    </div>`).join('');
}
function renderCommentsList(comments){
  const adName = document.getElementById('adFeedbackOverlay').dataset.adName;
  const groups = splitComments(adName, comments);
  const active = document.getElementById('commentsList');
  const history = document.getElementById('commentsHistoryList');
  active.innerHTML = groups.active.length ? commentsHTML(groups.active,'active') : '<div class="empty-note">No active feedback — add the first comment below or check History.</div>';
  history.innerHTML = groups.resolved.length ? commentsHTML(groups.resolved,'history') : '<div class="empty-note">No resolved feedback yet.</div>';
  document.getElementById('activeFeedbackCount').textContent = `(${groups.active.length})`;
  document.getElementById('historyFeedbackCount').textContent = `(${groups.resolved.length})`;
  active.querySelectorAll('[data-del-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const adName = document.getElementById('adFeedbackOverlay').dataset.adName;
      await deleteComment(el.getAttribute('data-del-id'));
      const comments = await fetchComments(adName);
      COMMENT_COUNTS[adName] = splitComments(adName, comments).active.length;
      renderCommentsList(comments);
      renderMain();
      if(currentView === 'adset-detail') renderAdSetDetailView();
    });
  });
  active.querySelectorAll('[data-resolve-id]').forEach(button => button.addEventListener('click', async () => {
    await setCommentResolved(adName, button.dataset.resolveId, true, comments);
    renderCommentsList(comments); renderMain(); if(currentView === 'adset-detail') renderAdSetDetailView();
  }));
  history.querySelectorAll('[data-reopen-id]').forEach(button => button.addEventListener('click', async () => {
    await setCommentResolved(adName, button.dataset.reopenId, false, comments);
    renderCommentsList(comments); renderMain(); if(currentView === 'adset-detail') renderAdSetDetailView();
  }));
}

function showFeedbackTab(tab){
  const history = tab === 'history';
  document.getElementById('activeFeedbackPanel').hidden = history;
  document.getElementById('historyFeedbackPanel').hidden = !history;
  document.getElementById('feedbackActiveTab').classList.toggle('active',!history);
  document.getElementById('feedbackHistoryTab').classList.toggle('active',history);
}
document.querySelectorAll('[data-feedback-tab]').forEach(button => button.addEventListener('click', () => showFeedbackTab(button.dataset.feedbackTab)));

async function openAdFeedbackEditor(adName){
  if(!adName) return;
  document.getElementById('adFeedbackName').textContent = adLabel(AD_INDEX[adName]) || adName;
  document.getElementById('adFeedbackNoteInput').value = '';
  showFeedbackTab('active');
  document.getElementById('adFeedbackStatus').textContent = '';
  document.getElementById('commentsList').innerHTML = '<div class="empty-note">Loading…</div>';
  document.getElementById('adFeedbackOverlay').dataset.adName = adName;
  document.getElementById('adFeedbackOverlay').classList.add('show');
  await fetchOverrides();
  const comments = await fetchComments(adName);
  renderCommentsList(comments);
}
function closeAdFeedbackEditor(){ document.getElementById('adFeedbackOverlay').classList.remove('show'); }
document.getElementById('adFeedbackClose').addEventListener('click', closeAdFeedbackEditor);
document.getElementById('adFeedbackSave').addEventListener('click', async () => {
  const adName = document.getElementById('adFeedbackOverlay').dataset.adName;
  const body = document.getElementById('adFeedbackNoteInput').value.trim();
  const statusEl = document.getElementById('adFeedbackStatus');
  if(!body){ statusEl.textContent = 'Write a comment first.'; statusEl.className = 'modal-status bad'; return; }
  statusEl.textContent = 'Posting…'; statusEl.className = 'modal-status';
  try{
    const author = getCurrentUserEmail() || 'Team';
    await postComment(adName, author, body);
    if(overrideForAd(adName).feedbackApplied){
      const ad = AD_INDEX[adName] || {};
      const existing = overrideForAd(adName);
      const externalId = ad.externalId || existing.externalId || '';
      await fetch(`${SUPABASE_URL}/rest/v1/ad_overrides`, {
        method:'POST', headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'}),
        body:JSON.stringify({ad_name:adName,ad_external_id:externalId || null,feedback_applied:false,updated_at:new Date().toISOString()})
      });
      OVERRIDES_CACHE[adName] = {...OVERRIDES_CACHE[adName],externalId,feedbackApplied:false};
      if(externalId) OVERRIDES_BY_EXTERNAL_ID[externalId] = OVERRIDES_CACHE[adName];
    }
    document.getElementById('adFeedbackNoteInput').value = '';
    statusEl.textContent = '';
    const comments = await fetchComments(adName);
    COMMENT_COUNTS[adName] = splitComments(adName, comments).active.length;
    renderCommentsList(comments);
    renderMain();
    if(currentView === 'adset-detail') renderAdSetDetailView();
  } catch(e){
    statusEl.textContent = 'Could not post (' + e.message + ').'; statusEl.className = 'modal-status bad';
  }
});
document.getElementById('adFeedbackOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'adFeedbackOverlay') closeAdFeedbackEditor();
});

// ---------- on-demand AI performance analysis ----------
let lastAIAnalysisRequest = null;

function adForAI(ad){
  return {
    name: adLabel(ad), headline: ad.headline || '', intro: ad.intro || '', status: ad.status || '',
    spend: Number(ad.spend) || 0, impressions: Number(ad.impressions) || 0, clicks: Number(ad.clicks) || 0, ctr: Number(ad.ctr) || 0,
    leads: Number(ad.leads) || 0, conversions: Number(ad.conversions) || 0, imageUrl: ad.imageUrl || ''
  };
}

function aiPayloadForAd(ad){
  return {
    type: 'ad', campaign: ad.campaign, adset: ad.adset,
    objective: campaignObjectiveFor(ad.campaign),
    brief: adsetBriefFor(ad.campaign, ad.adset),
    ad: adForAI(ad)
  };
}

function aiPayloadForAdset(card){
  return {
    type: 'adset', campaign: card.campaign, adset: adsetLabel(card),
    objective: campaignObjectiveFor(card.campaign, card.objective),
    brief: adsetBriefFor(card.campaign, card.name),
    metrics: { spend:card.spend, impressions:card.impressions, clicks:card.clicks, ctr:card.ctr, leads:card.leads },
    ads: card.ads.map(adForAI)
  };
}

function aiResultHTML(result){
  const verdictClass = result.verdict === 'Leave as is' ? 'leave' : result.verdict === 'Insufficient data' ? 'insufficient' : '';
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
  return `
    <div class="ai-verdict ${verdictClass}">
      <div><div class="ai-verdict-label">Verdict</div><div class="ai-verdict-value">${escapeHTML(result.verdict)}</div><div class="ai-verdict-summary">${escapeHTML(result.summary)}</div></div>
    </div>
    ${result.bestAd ? `<div class="ai-best-ad">Best-performing ad: ${escapeHTML(result.bestAd)}</div>` : ''}
    ${evidence.length ? `<section class="ai-result-section"><h3>Why</h3><ul>${evidence.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul></section>` : ''}
    ${recommendations.length ? `<section class="ai-result-section"><h3>Recommended actions</h3><ul>${recommendations.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul></section>` : ''}
    <section class="ai-result-section"><h3>Brief alignment</h3><div class="ai-brief-alignment">${escapeHTML(result.briefAlignment || 'No brief-alignment note returned.')}</div></section>`;
}

function closeAIAnalysis(){ document.getElementById('aiAnalysisOverlay').classList.remove('show'); }

async function runAIAnalysis(payload){
  lastAIAnalysisRequest = payload;
  const overlay = document.getElementById('aiAnalysisOverlay');
  const body = document.getElementById('aiAnalysisBody');
  const retry = document.getElementById('aiAnalysisRetry');
  document.getElementById('aiAnalysisTitle').textContent = payload.type === 'adset' ? 'AI Ad Set Analysis' : 'AI Ad Analysis';
  document.getElementById('aiAnalysisContext').textContent = `${payload.campaign} · ${payload.adset}${payload.type === 'ad' ? ` · ${payload.ad.name}` : ''}`;
  body.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div>Reviewing copy, creative, metrics, and brief…</div>';
  retry.hidden = true;
  overlay.classList.add('show');
  try{
    const session = getStoredSession();
    if(!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
    const response = await fetch('/api/analyze', {
      method:'POST',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if(!response.ok) throw new Error(result.error || 'The AI analysis could not be generated.');
    body.innerHTML = aiResultHTML(result);
    retry.hidden = false;
  } catch(error){
    body.innerHTML = `<div class="ai-error">${escapeHTML(error.message || 'The AI analysis could not be generated.')}</div>`;
    retry.hidden = false;
  }
}

document.getElementById('aiAnalysisClose').addEventListener('click', closeAIAnalysis);
document.getElementById('aiAnalysisRetry').addEventListener('click', () => lastAIAnalysisRequest && runAIAnalysis(lastAIAnalysisRequest));
document.getElementById('aiAnalysisOverlay').addEventListener('click', event => { if(event.target.id === 'aiAnalysisOverlay') closeAIAnalysis(); });

// Background images do not emit an error event on their host element. Probe
// them explicitly and replace expired/private CDN links with a useful state.
function verifyCreativeImages(root = document){
  root.querySelectorAll('[data-creative-image]:not([data-image-checked])').forEach(el => {
    el.dataset.imageChecked = 'true';
    const probe = new Image();
    probe.onload = () => el.classList.add('image-loaded');
    probe.onerror = () => {
      el.classList.add('image-failed');
      el.style.backgroundImage = 'linear-gradient(135deg,#0f1420,#1c2544 60%,#2a3766)';
    };
    probe.src = el.getAttribute('data-creative-image');
  });
}

const creativeImageObserver = new MutationObserver(() => verifyCreativeImages());
creativeImageObserver.observe(document.body, { childList:true, subtree:true });
verifyCreativeImages();

// ---------- big ad preview + score/recommendations modal ----------
function renderLiPreview(ad, fallbackHeadline){
  ad = ad || {};
  const hasImage = !!ad.imageUrl;
  const headline = ad.headline || fallbackHeadline || '';
  const cta = ad.cta || '';
  const ctaUrl = ad.ctaUrl || ad.url || '';
  const mediaStyle = hasImage
    ? `background-image:url('${ad.imageUrl.replace(/'/g,"\\'")}');background-size:contain;background-position:center;background-repeat:no-repeat;background-color:#0f1420;`
    : `background:linear-gradient(135deg,#0f1420,#1c2544 60%, #2a3766);`;
  return `
    <div class="li-preview">
      <div class="li-head">
        <div class="li-logo">A</div>
        <div class="li-head-text">
          <div class="name">Apertera</div>
          <div class="sub">Promoted</div>
        </div>
      </div>
      <div class="li-intro">${escapeHTML(ad.intro || 'No creative copy recorded for this ad.')}</div>
      <div class="li-media${hasImage ? ' has-image' : ' no-image'}" ${hasImage ? `data-creative-image="${escapeHTML(ad.imageUrl)}"` : ''} style="${mediaStyle}">
        ${hasImage ? '<div class="creative-image-message">Image unavailable — edit image</div>' : `<div class="creative-no-image-label">No image added</div><div class="headline">${escapeHTML(headline)}</div>`}
      </div>
      <div class="li-offer">
        <div class="li-offer-copy">
          <span class="domain">apertera.com</span>
          ${headline ? `<span class="li-offer-headline">${escapeHTML(headline)}</span>` : ''}
        </div>
        ${cta ? (ctaUrl ? `<a class="li-cta" href="${escapeHTML(ctaUrl)}" target="_blank" rel="noopener">${escapeHTML(cta)}</a>` : `<span class="li-cta">${escapeHTML(cta)}</span>`) : ''}
      </div>
      <div class="li-foot">
        <span class="li-cta-meta">${cta ? `CTA: ${escapeHTML(cta)}${ctaUrl ? ` → ${escapeHTML(shortUrl(ctaUrl))}` : ''}` : 'CTA not included in this data snapshot'}</span>
        ${ad.previewUrl ? `<a class="learn" href="${escapeHTML(ad.previewUrl)}" target="_blank" rel="noopener">View on LinkedIn ↗</a>` : ''}
      </div>
      <div class="li-actions">
        <span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span><span>✉ Send</span>
      </div>
    </div>`;
}

function feedbackLabel(ad){
  const count = COMMENT_COUNTS[ad.name] || 0;
  if(ad.feedbackApplied) return '✓ Resolved' + (count ? ` (${count})` : '');
  if(count) return `💬 ${count}`;
  return '+ Comment';
}

function scoreSummaryHTML(scoreInfo){
  const circleTxt = scoreInfo.score === null ? '—' : scoreInfo.score;
  const circleStyle = scoreInfo.color ? ` style="background:${scoreInfo.color}"` : '';
  return `
    <div class="score-summary">
      <div class="score-circle ${scoreInfo.cls}"${circleStyle}>${circleTxt}</div>
      <div class="score-meta">
        <div class="score-label">${scoreInfo.label}${scoreInfo.score !== null ? ' · ' + scoreInfo.score + '/100' : ''}</div>
        <div class="score-sub">${scoreInfo.objective ? `Goal-specific performance model: ${scoreInfo.objective}. Each selected goal is benchmarked against delivered ads that include that same goal.` : 'Select the campaign objective to calculate an apples-to-apples score.'}</div>
      </div>
    </div>
    <ul class="reco-list">${scoreInfo.notes.map(n => `<li>${n}</li>`).join('')}</ul>`;
}

function openAdBigPreview(adName){
  const ad = AD_INDEX[adName];
  if(!ad) return;
  document.getElementById('adBigPreviewOverlay').dataset.adName = adName;
  document.getElementById('adBigPreviewName').textContent = adLabel(ad);
  const scoreInfo = computeAdScore(ad);
  document.getElementById('adBigPreviewBody').innerHTML = renderLiPreview(ad, ad.name) + scoreSummaryHTML(scoreInfo);
  document.getElementById('adBigPreviewOverlay').classList.add('show');
}
function closeAdBigPreview(){ document.getElementById('adBigPreviewOverlay').classList.remove('show'); }
document.getElementById('adBigPreviewClose').addEventListener('click', closeAdBigPreview);
document.getElementById('adBigPreviewComment').addEventListener('click', () => {
  const adName = document.getElementById('adBigPreviewOverlay').dataset.adName;
  closeAdBigPreview();
  openAdFeedbackEditor(adName);
});
document.getElementById('adBigPreviewOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'adBigPreviewOverlay') closeAdBigPreview();
});

// ---------- sections awaiting a connected data source ----------
const LOCKED_INFO = {
  audiences: {
    title: 'Audiences',
    body: `Audience targeting details—such as job titles, industries, seniority, company size, and geography—are not included in the connected performance report.`,
    ask: `Connect a LinkedIn Campaign Manager audience export to make targeting details available for each campaign.`
  },
  content: {
    title: 'Content',
    body: `The connected report covers paid-ad creative and performance data. It does not include the supporting content library, such as articles, checklists, playbooks, or other campaign assets.`,
    ask: `Connect the campaign content library to view and manage supporting assets alongside their related ads.`
  },
  pipeline: {
    title: 'Leads & Pipeline',
    body: `The connected report includes attributed lead counts, but CRM outcomes such as contact records, deal stage, pipeline value, and won or lost status are not included.`,
    ask: `Connect HubSpot campaign attribution using campaign IDs or UTM parameters to add lead and pipeline outcomes.`
  }
};

function openLockedModal(key){
  const info = LOCKED_INFO[key];
  if(!info) return;
  document.getElementById('lockedTitle').textContent = info.title;
  document.getElementById('lockedBody').textContent = info.body;
  document.getElementById('lockedAsk').textContent = info.ask;
  document.getElementById('lockedOverlay').classList.add('show');
}
function closeLockedModal(){ document.getElementById('lockedOverlay').classList.remove('show'); }
document.getElementById('lockedClose').addEventListener('click', closeLockedModal);
document.getElementById('lockedOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'lockedOverlay') closeLockedModal();
});

// ---------- sidebar navigation ----------
const VIEW_TITLES = {
  campaigns: 'All Campaigns — Gallery',
  'campaign-grid': 'Campaigns — Grid',
  'status-kanban': 'Campaigns by Status',
  'campaign-calendar': 'Campaign Calendar',
  'executive-dashboard': 'Executive Dashboard',
  'ads-gallery': 'Ads Gallery',
  amplify: 'Amplify Challenge',
  creatives: 'All Creatives',
  'landing-pages': 'Landing Pages',
  budget: 'Budget Pacing',
  insights: 'Account Insights',
  'score-guide': 'How the Ad Score Works'
};
const VIEW_SORTS = {
  campaigns: ['spend','impressions','clicks','ctr','leads'],
  'campaign-grid': ['spend','impressions','clicks','ctr','leads'],
  'status-kanban': ['spend','impressions','clicks','ctr','leads'],
  'campaign-calendar': [],
  'executive-dashboard': [],
  'ads-gallery': ['spend','impressions','clicks','ctr','leads'],
  amplify: [],
  creatives: ['spend','impressions','clicks','ctr'],
  'landing-pages': ['spend','clicks','impressions','ctr'],
  budget: ['spend','dailyBudget','pacing'],
  insights: [],
  'score-guide': []
};
function setView(view){
  closeMobileNav();
  currentView = view;
  // Ad-set detail intentionally hides the toolbar. Any sidebar navigation
  // back to a regular view must restore it, not only the detail Back button.
  document.querySelector('.toolbar').style.display = 'flex';
  state.search = '';
  document.getElementById('searchInput').value = '';
  const keys = VIEW_SORTS[view];
  state.sortKey = keys && keys.length ? keys[0] : 'spend';
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-view') === view);
  });
  document.querySelectorAll('.view-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-view') === view);
  });
  document.getElementById('viewTitle').textContent = VIEW_TITLES[view] || 'All Campaigns';
  const crumb = document.querySelector('.crumb b');
  if(crumb) crumb.textContent = VIEW_TITLES[view] || 'All Campaigns';
  document.getElementById('groupChip').style.display = view === 'campaigns' ? 'inline-flex' : 'none';
  document.getElementById('sortSelect').style.display = (keys && keys.length) ? 'inline-flex' : 'none';
  const filterable = ['campaigns','campaign-grid','status-kanban','campaign-calendar','executive-dashboard','ads-gallery','creatives'].includes(view);
  document.getElementById('filterSelect').style.display = filterable ? 'inline-flex' : 'none';
  document.getElementById('dateRangeSelect').style.display = filterable ? 'inline-flex' : 'none';
  document.querySelector('.search-box').style.display = view === 'amplify' ? 'none' : 'flex';
  document.getElementById('filterSelect').value = state.statusFilter;
  document.getElementById('dateRangeSelect').value = state.dateRange;
  populateSortSelect();
  renderMain();
}

document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => setView(el.getAttribute('data-view')));
});
document.querySelectorAll('.view-item[data-view]').forEach(el => {
  el.addEventListener('click', () => setView(el.getAttribute('data-view')));
});
document.querySelectorAll('.nav-item[data-locked]').forEach(el => {
  el.addEventListener('click', () => { closeMobileNav(); openLockedModal(el.getAttribute('data-locked')); });
});

function closeMobileNav(){
  const app = document.querySelector('.app');
  const button = document.getElementById('mobileMenuBtn');
  if(app) app.classList.remove('nav-open');
  if(button) button.setAttribute('aria-expanded','false');
}
function toggleMobileNav(){
  const app = document.querySelector('.app');
  const button = document.getElementById('mobileMenuBtn');
  if(!app || !button) return;
  const open = app.classList.toggle('nav-open');
  button.setAttribute('aria-expanded', String(open));
}
document.getElementById('mobileMenuBtn').addEventListener('click', toggleMobileNav);
document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileNav);
window.addEventListener('resize', () => { if(window.innerWidth > 900) closeMobileNav(); });

const SORT_LABELS = { dailyBudget: 'Daily Budget', pacing: 'Pacing', ctr: 'CTR', cpl: 'CPL' };
function sortLabel(key){
  return SORT_LABELS[key] || (key ? key[0].toUpperCase() + key.slice(1) : '');
}
function populateSortSelect(){
  const sel = document.getElementById('sortSelect');
  const keys = VIEW_SORTS[currentView] || [];
  sel.innerHTML = keys.map(k => `<option value="${k}">Sort: ${sortLabel(k)}</option>`).join('');
  sel.value = state.sortKey;
}
document.getElementById('sortSelect').addEventListener('change', (e) => {
  state.sortKey = e.target.value;
  renderMain();
});

document.getElementById('filterSelect').addEventListener('change', (e) => {
  state.statusFilter = e.target.value;
  renderMain();
});

document.getElementById('dateRangeSelect').addEventListener('change', (e) => {
  state.dateRange = e.target.value;
  if(RAW_RECORDS){
    DATA = applyOverridesToData(aggregate(filterRecordsByDateRange(RAW_RECORDS, state.dateRange)));
    CARDS = buildCards(DATA.campaigns);
  }
  renderMain();
});

function renderMain(){
  document.getElementById('nav-count').textContent = CARDS.length;
  document.getElementById('gallery-nav-count').textContent = DATA.flatAds.length;
  if(currentView === 'campaigns') renderGallery();
  else if(currentView === 'campaign-grid') renderCampaignGridView();
  else if(currentView === 'status-kanban') renderStatusKanbanView();
  else if(currentView === 'campaign-calendar') renderCampaignCalendarView();
  else if(currentView === 'executive-dashboard') renderExecutiveDashboardView();
  else if(currentView === 'ads-gallery') renderAdsGalleryView();
  else if(currentView === 'amplify') renderAmplifyView();
  else if(currentView === 'adset-detail') renderAdSetDetailView();
  else if(currentView === 'creatives') renderCreativesView();
  else if(currentView === 'landing-pages') renderLandingPagesView();
  else if(currentView === 'budget') renderBudgetView();
  else if(currentView === 'insights') renderInsightsView();
  else if(currentView === 'score-guide') renderScoreGuideView();
}

// ---------- Amplify Challenge (independent from paid-ad spreadsheet data) ----------
const AMPLIFY_DEPARTMENTS = [
  { name:'Marketing', total:8, color:'#ef3f36' },
  { name:'HR', total:4, color:'#fbbc04' },
  { name:'Management', total:8, color:'#34a853' },
  { name:'Go-to-Market / BD', total:7, color:'#ff6d01' },
  { name:'Finance', total:6, color:'#4dbcc3' },
  { name:'Client Success', total:9, color:'#79a7ee' },
  { name:'Linguistic Operations', total:68, color:'#ee756f' },
  { name:'Tech', total:39, color:'#6d7a90' },
  { name:'Product', total:7, color:'#a57bd9' }
];
const AMPLIFY_DEPARTMENT_OPTIONS = AMPLIFY_DEPARTMENTS.map(dept=>dept.name);
let AMPLIFY_DATA = { leaderboard:[], posts:[], participants:[], config:null, runs:[], loaded:false, error:'' };
function amplifyHeaders(extra={}){
  const session = getStoredSession();
  return { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${session?.access_token || ''}`, ...extra };
}
async function amplifyGet(path){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers:amplifyHeaders() });
  if(!res.ok) throw new Error((await res.text()) || `Amplify request failed (${res.status})`);
  return res.json();
}
async function loadAmplifyData(force=false){
  if(AMPLIFY_DATA.loaded && !force) return;
  try{
    const [leaderboard,posts,participants,config,runs] = await Promise.all([
      amplifyGet('amplify_leaderboard?select=*&order=total_points.desc,full_name.asc'),
      amplifyGet('amplify_posts?select=post_url,full_name,content,score,is_repost,posted_at,post_date_label&score=gt.0&order=posted_at.desc.nullslast&limit=8'),
      amplifyGet('amplify_participants?select=profile_key,profile_url,full_name,department,active&order=full_name.asc'),
      amplifyGet('amplify_config?select=*&id=eq.true'),
      amplifyGet('amplify_sync_runs?select=*&order=started_at.desc&limit=5')
    ]);
    AMPLIFY_DATA = {leaderboard,posts,participants,config:config[0]||null,runs,loaded:true,error:''};
  }catch(error){ AMPLIFY_DATA = {...AMPLIFY_DATA,loaded:true,error:error.message}; }
}
function amplifyDate(value){
  if(!value) return '';
  const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function normalizeAmplifyDepartment(value=''){
  const raw = String(value || '').trim();
  const compact = raw.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ');
  if(!compact) return '';
  if(compact.includes('marketing')) return 'Marketing';
  if(compact === 'hr' || compact.includes('human resources')) return 'HR';
  if(compact.includes('management')) return 'Management';
  if(compact.includes('go to market') || compact.includes('business development') || compact.includes('bd')) return 'Go-to-Market / BD';
  if(compact.includes('finance')) return 'Finance';
  if(compact.includes('client success')) return 'Client Success';
  if(compact.includes('linguistic')) return 'Linguistic Operations';
  if(compact.includes('tech') || compact.includes('engineering')) return 'Tech';
  if(compact.includes('product')) return 'Product';
  return raw;
}
function amplifyDepartmentStats(participants=[]){
  const counts = new Map(AMPLIFY_DEPARTMENTS.map(dept=>[dept.name,0]));
  const unassigned = [];
  participants.filter(row=>row.active !== false).forEach(row=>{
    const dept = normalizeAmplifyDepartment(row.department);
    if(counts.has(dept)) counts.set(dept, counts.get(dept) + 1);
    else unassigned.push(row);
  });
  const rows = AMPLIFY_DEPARTMENTS.map(dept=>{
    const registered = counts.get(dept.name) || 0;
    const participation = dept.total ? Math.round(registered / dept.total * 100) : 0;
    return {...dept, registered, participation};
  });
  const totalRegistered = rows.reduce((sum,row)=>sum + row.registered, 0);
  const totalEmployees = rows.reduce((sum,row)=>sum + row.total, 0);
  return { rows, unassigned, totalRegistered, totalEmployees, participation: totalEmployees ? Math.round(totalRegistered / totalEmployees * 100) : 0 };
}
function departmentPieGradient(rows){
  let cursor = 0;
  const total = rows.reduce((sum,row)=>sum + row.total, 0) || 1;
  return rows.map(row=>{
    const start = cursor;
    cursor += row.total / total * 100;
    return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  }).join(',');
}
function renderAmplifyDepartmentView(participants){
  const stats = amplifyDepartmentStats(participants);
  const sortedParticipants = [...participants].sort((a,b)=>
    normalizeAmplifyDepartment(a.department).localeCompare(normalizeAmplifyDepartment(b.department)) ||
    String(a.full_name||'').localeCompare(String(b.full_name||''))
  );
  return `<section class="amplify-dept-grid">
    <div class="amplify-panel amplify-dept-panel">
      <div class="amplify-panel-head"><h3>Department participation</h3><span>${fmtInt(stats.totalRegistered)} of ${fmtInt(stats.totalEmployees)} registered</span></div>
      <div class="amplify-table-wrap"><table class="amplify-table amplify-dept-table"><thead><tr><th>Dept</th><th>Registered</th><th>Total employees</th><th>Participation</th></tr></thead><tbody>
        ${stats.rows.map(row=>`<tr><td><span class="amplify-dept-dot" style="background:${row.color}"></span>${escapeHTML(row.name)}</td><td>${fmtInt(row.registered)}</td><td>${fmtInt(row.total)}</td><td><div class="amplify-participation"><span>${fmtInt(row.participation)}%</span><div><i style="width:${Math.min(100,row.participation)}%"></i></div></div></td></tr>`).join('')}
        <tr class="amplify-dept-total"><td>Total</td><td>${fmtInt(stats.totalRegistered)}</td><td>${fmtInt(stats.totalEmployees)}</td><td>${fmtInt(stats.participation)}%</td></tr>
      </tbody></table></div>
      ${stats.unassigned.length ? `<div class="amplify-dept-note"><strong>Needs department:</strong> ${stats.unassigned.map(row=>escapeHTML(row.full_name)).join(', ')}</div>` : ''}
    </div>
    <div class="amplify-panel amplify-chart-panel">
      <div class="amplify-panel-head"><h3>Headcount by department</h3><span>Based on total employees</span></div>
      <div class="amplify-chart-body"><div class="amplify-pie" style="background:conic-gradient(${departmentPieGradient(stats.rows)})"></div>
        <div class="amplify-legend">${stats.rows.map(row=>`<div><span style="background:${row.color}"></span><b>${escapeHTML(row.name)}</b><em>${fmtInt(row.total)}</em></div>`).join('')}</div></div>
    </div>
    <div class="amplify-panel amplify-employee-panel">
      <div class="amplify-panel-head"><h3>Employee departments</h3><span>${fmtInt(sortedParticipants.length)} employees</span></div>
      <div class="amplify-table-wrap"><table class="amplify-table amplify-employee-table"><thead><tr><th>Employee</th><th>Department</th>${isAmplifyAdmin()?'<th></th>':''}</tr></thead><tbody>
        ${sortedParticipants.map(row=>{
          const dept = normalizeAmplifyDepartment(row.department);
          return `<tr><td><a class="amplify-name" href="${escapeHTML(row.profile_url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(row.full_name)}</a></td><td>${dept ? escapeHTML(dept) : '<span class="amplify-missing-dept">Missing</span>'}</td>${isAmplifyAdmin()?`<td><button class="amplify-assign-btn" data-amplify-department="${escapeHTML(row.profile_key)}">Edit</button></td>`:''}</tr>`;
        }).join('')}
      </tbody></table></div>
    </div>
  </section>`;
}
function isAmplifyAdmin(){return String(getCurrentUserEmail()||'').toLowerCase()==='growth@apertera.com';}
const AMPLIFY_UPDATE_TYPES = {
  activity:{label:'Employee activity',calls:2,working:'Syncing employee posts and reposts…'},
  likes:{label:'Likes',calls:1,working:'Syncing employee likes…'},
  comments:{label:'Comments',calls:1,working:'Syncing employee comments…'},
  all:{label:'All data',calls:4,working:'Syncing all Amplify data…'}
};
let amplifyImportType='all';
let RECOVERED_PARTICIPANT=null;
const RECOVERED_LABELS={recovered_post:'Original Apertera post',recovered_repost:'Repost / share',recovered_like:'Like company post',recovered_comment:'Comment on company post',other:'Other adjustment',marketing_pick:"Marketing's Pick"};
function recoveredDefaultPoints(type){
  const config=AMPLIFY_DATA.config||{};
  return {recovered_post:config.post_points||15,recovered_repost:config.repost_points||5,recovered_like:config.like_points||3,recovered_comment:config.comment_points||5,other:1}[type]||1;
}
function closeRecoveredPoints(){document.getElementById('recoveredPointsOverlay').classList.remove('show');RECOVERED_PARTICIPANT=null;}
async function loadRecoveredHistory(){
  const box=document.getElementById('recoveredPointsHistory');
  if(!RECOVERED_PARTICIPANT)return;
  box.innerHTML='<div class="amplify-empty" style="padding:12px">Loading history…</div>';
  try{
    const rows=await amplifyGet(`amplify_bonuses?participant_key=eq.${encodeURIComponent(RECOVERED_PARTICIPANT.profile_key)}&select=id,adjustment_type,reason,points,note,evidence_url,awarded_at,reversed_at,reversal_reason&order=awarded_at.desc`);
    box.innerHTML=rows.length?rows.map(row=>`<div class="recovered-history-item ${row.reversed_at?'reversed':''}"><div class="recovered-history-main"><strong>${escapeHTML(RECOVERED_LABELS[row.adjustment_type]||row.reason)}</strong><span>${amplifyDate(row.awarded_at)}${row.note?` · ${escapeHTML(row.note)}`:''}${row.reversed_at?` · Reversed${row.reversal_reason?`: ${escapeHTML(row.reversal_reason)}`:''}`:''}</span>${row.evidence_url?`<a href="${escapeHTML(row.evidence_url)}" target="_blank" rel="noopener noreferrer" style="font-size:10.5px;color:var(--accent)">View evidence</a>`:''}</div><div><div class="recovered-history-points">+${fmtInt(row.points)}</div>${!row.reversed_at&&row.adjustment_type!=='marketing_pick'?`<button class="recovered-reverse" data-reverse-adjustment="${row.id}">Reverse</button>`:''}</div></div>`).join(''):'<div class="amplify-empty" style="padding:12px">No manual adjustments yet.</div>';
    box.querySelectorAll('[data-reverse-adjustment]').forEach(button=>button.onclick=()=>reverseRecoveredPoints(button.dataset.reverseAdjustment));
  }catch(error){box.innerHTML=`<div class="amplify-empty" style="padding:12px">Could not load history: ${escapeHTML(error.message)}</div>`;}
}
async function openRecoveredPoints(row){
  if(!isAmplifyAdmin()||!row)return;
  RECOVERED_PARTICIPANT=row;
  document.getElementById('recoveredPersonName').textContent=row.full_name;
  document.getElementById('recoveredPersonCurrent').textContent=`${fmtInt(row.recovered_points||0)} recovered points`;
  document.getElementById('recoveredType').value='recovered_post';
  document.getElementById('recoveredPoints').value=recoveredDefaultPoints('recovered_post');
  document.getElementById('recoveredEvidence').value='';
  document.getElementById('recoveredNote').value='';
  document.getElementById('recoveredPointsStatus').textContent='';
  document.getElementById('recoveredPointsStatus').className='modal-status';
  document.getElementById('recoveredPointsOverlay').classList.add('show');
  await loadRecoveredHistory();
}
async function saveRecoveredPoints(){
  const status=document.getElementById('recoveredPointsStatus'),button=document.getElementById('recoveredPointsSave');
  const adjustmentType=document.getElementById('recoveredType').value;
  const points=Number(document.getElementById('recoveredPoints').value);
  const evidenceUrl=document.getElementById('recoveredEvidence').value.trim();
  const note=document.getElementById('recoveredNote').value.trim();
  if(!RECOVERED_PARTICIPANT)return;
  if(!Number.isInteger(points)||points<1||points>1000){status.textContent='Enter a whole number between 1 and 1,000.';status.className='modal-status bad';return;}
  if(!note){status.textContent='Add a short reason so the adjustment can be audited.';status.className='modal-status bad';return;}
  if(evidenceUrl&&!/^https:\/\//i.test(evidenceUrl)){status.textContent='The evidence URL must start with https://.';status.className='modal-status bad';return;}
  button.disabled=true;status.textContent='Assigning points…';status.className='modal-status';
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/amplify_bonuses`,{method:'POST',headers:amplifyHeaders({'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify({participant_key:RECOVERED_PARTICIPANT.profile_key,profile_url:RECOVERED_PARTICIPANT.profile_url,full_name:RECOVERED_PARTICIPANT.full_name,adjustment_type:adjustmentType,reason:RECOVERED_LABELS[adjustmentType],points,evidence_url:evidenceUrl||null,note})});
    if(!res.ok)throw new Error((await res.text())||`Could not assign points (${res.status})`);
    status.textContent=`+${points} recovered points assigned.`;status.className='modal-status ok';
    AMPLIFY_DATA.loaded=false;await loadAmplifyData(true);await loadRecoveredHistory();
    const updated=AMPLIFY_DATA.leaderboard.find(row=>row.profile_key===RECOVERED_PARTICIPANT.profile_key);if(updated)document.getElementById('recoveredPersonCurrent').textContent=`${fmtInt(updated.recovered_points||0)} recovered points`;
    setTimeout(()=>{closeRecoveredPoints();if(currentView==='amplify')renderAmplifyView();},650);
  }catch(error){status.textContent=error.message.includes('duplicate')?'This activity appears to have already been recovered.':error.message;status.className='modal-status bad';}finally{button.disabled=false;}
}
async function reverseRecoveredPoints(id){
  const reason=window.prompt('Why are you reversing this adjustment?');
  if(reason===null)return;
  if(!reason.trim()){document.getElementById('recoveredPointsStatus').textContent='A reversal reason is required.';document.getElementById('recoveredPointsStatus').className='modal-status bad';return;}
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/amplify_bonuses?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:amplifyHeaders({'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify({reversed_at:new Date().toISOString(),reversal_reason:reason.trim()})});
    if(!res.ok)throw new Error((await res.text())||`Could not reverse points (${res.status})`);
    AMPLIFY_DATA.loaded=false;await loadAmplifyData(true);await loadRecoveredHistory();
    const updated=AMPLIFY_DATA.leaderboard.find(row=>row.profile_key===RECOVERED_PARTICIPANT.profile_key);if(updated)document.getElementById('recoveredPersonCurrent').textContent=`${fmtInt(updated.recovered_points||0)} recovered points`;
  }catch(error){document.getElementById('recoveredPointsStatus').textContent=error.message;document.getElementById('recoveredPointsStatus').className='modal-status bad';}
}
async function amplifyConnectionRequest(payload){
  const session=getStoredSession();const res=await fetch('/api/amplify-sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token||''}`},body:JSON.stringify(payload)});const result=await res.json();if(!res.ok)throw new Error(result.error||'Connection request failed.');return result;
}
function openAmplifyParticipant(){
  const overlay=document.getElementById('amplifyParticipantOverlay');
  document.getElementById('amplifyParticipantName').value='';
  document.getElementById('amplifyParticipantUrl').value='';
  document.getElementById('amplifyParticipantDepartment').value='';
  document.getElementById('amplifyParticipantAliases').value='';
  document.getElementById('amplifyParticipantStatus').textContent='';
  document.getElementById('amplifyParticipantStatus').className='modal-status';
  overlay.classList.add('show');
}
function closeAmplifyParticipant(){document.getElementById('amplifyParticipantOverlay').classList.remove('show');}
async function saveAmplifyParticipant(){
  const status=document.getElementById('amplifyParticipantStatus'),button=document.getElementById('amplifyParticipantSave');
  const fullName=document.getElementById('amplifyParticipantName').value.trim();
  const profileUrl=document.getElementById('amplifyParticipantUrl').value.trim();
  const department=document.getElementById('amplifyParticipantDepartment').value.trim();
  const aliases=document.getElementById('amplifyParticipantAliases').value.split(/\n+/).map(value=>value.trim()).filter(Boolean);
  if(!fullName){status.textContent='Enter the employee full name.';status.className='modal-status bad';return;}
  if(!profileUrl){status.textContent='Enter the LinkedIn profile URL.';status.className='modal-status bad';return;}
  button.disabled=true;status.textContent='Adding employee…';status.className='modal-status';
  try{
    const result=await amplifyConnectionRequest({mode:'add-participant',fullName,profileUrl,department,aliases});
    status.textContent=result.message;status.className='modal-status ok';
    AMPLIFY_DATA.loaded=false;
    await loadAmplifyData(true);
    setTimeout(()=>{closeAmplifyParticipant();if(currentView==='amplify')renderAmplifyView();},700);
  }catch(error){status.textContent=error.message;status.className='modal-status bad';}
  finally{button.disabled=false;}
}
async function editAmplifyDepartment(profileKey){
  if(!isAmplifyAdmin())return;
  const participant=AMPLIFY_DATA.participants.find(row=>row.profile_key===profileKey);
  if(!participant)return;
  const current=normalizeAmplifyDepartment(participant.department);
  const options=AMPLIFY_DEPARTMENT_OPTIONS.join('\n');
  const next=window.prompt(`Department for ${participant.full_name}\n\nUse one of these:\n${options}\n\nLeave empty to mark as missing.`, current);
  if(next===null)return;
  const normalized=normalizeAmplifyDepartment(next);
  if(normalized && !AMPLIFY_DEPARTMENT_OPTIONS.includes(normalized)){
    alert('Please use one of the existing department names shown in the prompt.');
    return;
  }
  try{
    const result=await amplifyConnectionRequest({mode:'update-participant-department',profileKey,department:normalized});
    AMPLIFY_DATA.loaded=false;
    await loadAmplifyData(true);
    if(currentView==='amplify')renderAmplifyView();
    const nextStatus=document.getElementById('amplifyStatus');
    if(nextStatus)nextStatus.textContent=result.message;
  }catch(error){
    alert(error.message || 'Could not update department.');
  }
}
async function openAmplifyConnection(){
  const overlay=document.getElementById('amplifyConnectionOverlay'),status=document.getElementById('amplifyConnectionStatus');overlay.classList.add('show');status.textContent='Checking saved connection…';status.className='modal-status';document.getElementById('amplifyApiToken').value='';
  try{const saved=await amplifyConnectionRequest({mode:'connection-status'});document.getElementById('amplifyTaskId').value=saved.task_id||'RS6sriGQCVOsTrDUW';status.textContent=saved.connected?'Connected securely · enter a token only to replace it.':'Not connected yet.';status.className=`modal-status ${saved.connected?'ok':''}`;}catch(e){status.textContent=e.message;status.className='modal-status bad';}
}
function closeAmplifyConnection(){document.getElementById('amplifyConnectionOverlay').classList.remove('show');}
document.getElementById('amplifyConnectionCancel').onclick=closeAmplifyConnection;
document.getElementById('amplifyConnectionOverlay').addEventListener('click',e=>{if(e.target.id==='amplifyConnectionOverlay')closeAmplifyConnection();});
document.getElementById('amplifyConnectionSave').onclick=async()=>{const taskId=document.getElementById('amplifyTaskId').value.trim(),apiToken=document.getElementById('amplifyApiToken').value.trim(),status=document.getElementById('amplifyConnectionStatus'),button=document.getElementById('amplifyConnectionSave');if(!taskId||!apiToken){status.textContent='Enter both the Task ID and API token.';status.className='modal-status bad';return;}button.disabled=true;status.textContent='Encrypting and saving…';status.className='modal-status';try{const result=await amplifyConnectionRequest({mode:'save-connection',taskId,apiToken});status.textContent=result.message;status.className='modal-status ok';document.getElementById('amplifyApiToken').value='';setTimeout(closeAmplifyConnection,900);}catch(e){status.textContent=e.message;status.className='modal-status bad';}finally{button.disabled=false;}};
document.getElementById('amplifyParticipantCancel').onclick=closeAmplifyParticipant;
document.getElementById('amplifyParticipantSave').onclick=saveAmplifyParticipant;
document.getElementById('amplifyParticipantOverlay').addEventListener('click',event=>{if(event.target.id==='amplifyParticipantOverlay')closeAmplifyParticipant();});
document.getElementById('recoveredPointsCancel').onclick=closeRecoveredPoints;
document.getElementById('recoveredPointsSave').onclick=saveRecoveredPoints;
document.getElementById('recoveredType').onchange=event=>{document.getElementById('recoveredPoints').value=recoveredDefaultPoints(event.target.value);};
document.getElementById('recoveredPointsOverlay').addEventListener('click',event=>{if(event.target.id==='recoveredPointsOverlay')closeRecoveredPoints();});
async function renderAmplifyView(){
  const content = document.getElementById('content');
  if(!AMPLIFY_DATA.loaded){
    content.innerHTML='<div class="amplify-empty">Loading Amplify Challenge…</div>';
    await loadAmplifyData();
    if(currentView !== 'amplify') return;
  }
  const {leaderboard,posts,participants,config,runs,error}=AMPLIFY_DATA;
  document.getElementById('amplify-nav-count').textContent = participants.length || leaderboard.length || '0';
  if(error){ content.innerHTML=`<div class="amplify-empty">Could not load Amplify Challenge: ${escapeHTML(error)}</div>`; return; }
  const active = leaderboard.filter(row=>Number(row.total_points)>0);
  const totalPoints = active.reduce((sum,row)=>sum+Number(row.total_points||0),0);
  const entries = active.reduce((sum,row)=>sum+Number(row.entries||0),0);
  const lastRun = runs.find(run=>run.status==='success'||run.status==='partial') || null;
  content.innerHTML=`<div class="amplify-shell">
    <section class="amplify-hero"><div><div class="amplify-kicker">Employee advocacy</div><h2>Apertera Amplify Challenge</h2><p>A standalone challenge tracking employee posts, reposts, likes, comments and Marketing's Pick bonuses. Its scores never affect paid campaign reporting.</p></div>
      <div class="amplify-actions">${isAmplifyAdmin()?'<button class="amplify-btn secondary" id="amplifyParticipantBtn">Add employee</button><button class="amplify-btn secondary" id="amplifyConnectBtn">API connections</button>':''}</div></section>
    <section class="amplify-update-panel" aria-label="Amplify data updates">
      ${isAmplifyAdmin()?`<div class="amplify-update-group"><div class="amplify-update-head"><div><h3>API sync</h3><p>Run only the data source you need. Existing records are updated without creating duplicates.</p></div><span class="amplify-credit-pill">Uses credits</span></div><div class="amplify-choice-grid"><button class="amplify-choice" data-amplify-sync="activity"><strong>Employee activity</strong><span>Posts + reposts · 2 calls</span></button><button class="amplify-choice" data-amplify-sync="likes"><strong>Likes</strong><span>1 Apify call</span></button><button class="amplify-choice" data-amplify-sync="comments"><strong>Comments</strong><span>1 Apify call</span></button><button class="amplify-choice all" data-amplify-sync="all"><strong>Run all</strong><span>4 Apify calls</span></button></div></div>`:''}
      <div class="amplify-update-group"><div class="amplify-update-head"><div><h3>Manual import</h3><p>Upload one export at a time, or use the combined tracker workbook.</p></div><span class="amplify-credit-pill free">No API credits</span></div><div class="amplify-choice-grid"><button class="amplify-choice" data-amplify-import="activity"><strong>Employee activity</strong><span>Activity Excel / JSON</span></button><button class="amplify-choice" data-amplify-import="likes"><strong>Likes</strong><span>Likes Excel / JSON</span></button><button class="amplify-choice" data-amplify-import="comments"><strong>Comments</strong><span>Comments Excel / JSON</span></button><button class="amplify-choice all" data-amplify-import="all"><strong>All-in-one</strong><span>Workbook / combined JSON</span></button></div><input id="amplifyFile" type="file" accept="application/json,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" hidden></div>
    </section>
    <div class="amplify-status" id="amplifyStatus">${lastRun ? `Last sync ${amplifyDate(lastRun.finished_at||lastRun.started_at)} · ${escapeHTML(lastRun.message||lastRun.status)}` : 'Historical workbook imported · API sync is ready to configure'}</div>
    <div class="kpi-row amplify-kpi-row"><div class="kpi"><div class="kpi-label">Participants</div><div class="kpi-value">${fmtInt(participants.length || leaderboard.length)}</div><div class="kpi-sub">employee whitelist</div></div><div class="kpi"><div class="kpi-label">Active scorers</div><div class="kpi-value">${fmtInt(active.length)}</div><div class="kpi-sub">with at least one point</div></div><div class="kpi"><div class="kpi-label">Points awarded</div><div class="kpi-value">${fmtInt(totalPoints)}</div><div class="kpi-sub">posts + interactions + bonuses</div></div><div class="kpi"><div class="kpi-label">Draw entries</div><div class="kpi-value">${fmtInt(entries)}</div><div class="kpi-sub">1 per ${config?.points_per_entry||10} points</div></div></div>
    ${renderAmplifyDepartmentView(participants)}
    <div class="amplify-grid"><section class="amplify-panel"><div class="amplify-panel-head"><h3>Leaderboard</h3><span>${active.length} scoring participants</span></div><div class="amplify-table-wrap"><table class="amplify-table"><thead><tr><th>#</th><th>Participant</th><th>Posts</th><th>Interactions</th><th>Recovered</th><th>Marketing's Pick</th><th>Total</th><th>Entries</th>${isAmplifyAdmin()?'<th></th>':''}</tr></thead><tbody>${leaderboard.map((row,index)=>`<tr><td class="amplify-rank">${index+1}</td><td><a class="amplify-name" href="${escapeHTML(row.profile_url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(row.full_name)}</a></td><td>${fmtInt(row.post_points)}</td><td>${fmtInt(row.interaction_points)}</td><td>${fmtInt(row.recovered_points)}</td><td>${fmtInt(row.marketing_pick_points)}</td><td class="amplify-total">${fmtInt(row.total_points)}</td><td><span class="amplify-entry">${fmtInt(row.entries)}</span></td>${isAmplifyAdmin()?`<td><button class="amplify-assign-btn" data-amplify-adjust="${index}">+ Assign</button></td>`:''}</tr>`).join('')}</tbody></table></div></section>
      <div><section class="amplify-panel"><div class="amplify-panel-head"><h3>Scoring rules</h3><span>Current</span></div><div class="amplify-rule-list"><div class="amplify-rule">Original Apertera post <b>+${config?.post_points||15}</b></div><div class="amplify-rule">Repost / share <b>+${config?.repost_points||5}</b></div><div class="amplify-rule">Like company post <b>+${config?.like_points||3}</b></div><div class="amplify-rule">Comment on company post <b>+${config?.comment_points||5}</b></div><div class="amplify-rule">Marketing's Pick <b>+${config?.marketing_pick_points||20}</b></div></div></section>
      <section class="amplify-panel" style="margin-top:18px"><div class="amplify-panel-head"><h3>Recent scoring posts</h3><span>${posts.length} shown</span></div><div class="amplify-feed">${posts.length?posts.map(post=>`<div class="amplify-post"><div class="amplify-post-top"><strong>${escapeHTML(post.full_name)}</strong><span>${post.is_repost?'Repost':'Post'} · ${amplifyDate(post.posted_at)||escapeHTML(post.post_date_label)}</span><a class="amplify-post-score" href="${escapeHTML(post.post_url)}" target="_blank" rel="noopener noreferrer">+${post.score}</a></div><div class="amplify-post-copy">${escapeHTML(post.content)}</div></div>`).join(''):'<div class="amplify-empty">No scoring posts yet.</div>'}</div></section></div>
    </div></div>`;
  document.querySelectorAll('[data-amplify-sync]').forEach(button=>button.onclick=()=>{
    const syncType=button.dataset.amplifySync,meta=AMPLIFY_UPDATE_TYPES[syncType];
    const detail=syncType==='activity'?'employee posts and reposts':syncType;
    if(!window.confirm(`Run ${meta.label} sync?\n\nThis will start ${meta.calls} Apify ${meta.calls===1?'call':'calls'} for ${detail}. Existing data will be deduplicated.`))return;
    runAmplifySync({mode:'configured',syncType},button);
  });
  if(document.getElementById('amplifyConnectBtn'))document.getElementById('amplifyConnectBtn').onclick=openAmplifyConnection;
  if(document.getElementById('amplifyParticipantBtn'))document.getElementById('amplifyParticipantBtn').onclick=openAmplifyParticipant;
  document.querySelectorAll('[data-amplify-department]').forEach(button=>button.onclick=()=>editAmplifyDepartment(button.dataset.amplifyDepartment));
  document.querySelectorAll('[data-amplify-adjust]').forEach(button=>button.onclick=()=>openRecoveredPoints(leaderboard[Number(button.dataset.amplifyAdjust)]));
  document.querySelectorAll('[data-amplify-import]').forEach(button=>button.onclick=()=>{amplifyImportType=button.dataset.amplifyImport;document.getElementById('amplifyFile').click();});
  document.getElementById('amplifyFile').onchange=async event=>{
    const file=event.target.files[0]; if(!file)return;
    try{
      if(file.size>3*1024*1024)throw new Error('Please upload a file smaller than 3 MB.');
      if(file.name.toLowerCase().endsWith('.json')){
        const data=JSON.parse(await file.text()); await runAmplifySync({mode:'import',importType:amplifyImportType,items:data,fileName:file.name});
      }else if(file.name.toLowerCase().endsWith('.xlsx')){
        const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
        await runAmplifySync({mode:amplifyImportType==='all'?'workbook':'import-source-workbook',importType:amplifyImportType,fileName:file.name,fileBase64:btoa(binary)});
      }else throw new Error('Use the Amplify tracker .xlsx workbook or an Apify .json export.');
    }catch(e){document.getElementById('amplifyStatus').textContent=`Import failed: ${e.message}`;} finally{event.target.value='';}
  };
}
function amplifySourcePayloads(payload){
  if(payload.mode === 'configured'){
    const sources = payload.syncType === 'all' ? ['posts','reposts','likes','comments'] : payload.syncType === 'activity' ? ['posts','reposts'] : [payload.syncType];
    return sources.map(source=>({mode:'sync-source',source}));
  }
  if(payload.mode === 'import'){
    const source = payload.importType === 'likes' ? 'likes' : payload.importType === 'comments' ? 'comments' : 'posts';
    return [{mode:'import-source',source,items:payload.items,fileName:payload.fileName}];
  }
  if(payload.mode === 'import-source-workbook'){
    const source = payload.importType === 'likes' ? 'likes' : payload.importType === 'comments' ? 'comments' : 'posts';
    return [{mode:'import-source-workbook',source,fileBase64:payload.fileBase64,fileName:payload.fileName}];
  }
  return [payload];
}
async function runAmplifySync(payload,triggerButton=null){
  const buttons=[...document.querySelectorAll('[data-amplify-sync],[data-amplify-import]')]; const status=document.getElementById('amplifyStatus');
  buttons.forEach(button=>button.disabled=true); if(status)status.textContent=payload.mode==='import'||payload.mode==='workbook'?`Importing ${AMPLIFY_UPDATE_TYPES[payload.importType||'all'].label.toLowerCase()}…`:AMPLIFY_UPDATE_TYPES[payload.syncType||'all'].working;
  try{
    const session=getStoredSession();
    const results=[];
    for(const step of amplifySourcePayloads(payload)){
      const res=await fetch('/api/amplify-sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token||''}`},body:JSON.stringify(step)});
      const result=await res.json();
      if(!res.ok)throw new Error(result.error||'Sync failed.');
      results.push(result);
    }
    AMPLIFY_DATA.loaded=false; await renderAmplifyView(); const next=document.getElementById('amplifyStatus'); if(next)next.textContent=results.map(result=>result.message).join(' ');
  }catch(error){if(status)status.textContent=`Update failed: ${error.message}`;buttons.forEach(button=>button.disabled=false);}
}

// ---------- KPI row (campaigns view) ----------
function renderKPIs(){
  const totalSpend = CARDS.reduce((s,c)=>s+c.spend,0);
  const totalImpr = CARDS.reduce((s,c)=>s+c.impressions,0);
  const totalClicks = CARDS.reduce((s,c)=>s+c.clicks,0);
  const totalLeads = CARDS.reduce((s,c)=>s+c.leads,0);
  const avgCtr = totalImpr ? (totalClicks/totalImpr*100) : 0;
  return `
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Total Spend</div><div class="kpi-value">${fmtMoney(totalSpend,0)}</div><div class="kpi-sub">Apr 24 – Jul 22, 2026</div></div>
    <div class="kpi"><div class="kpi-label">Impressions</div><div class="kpi-value">${fmtInt(totalImpr)}</div><div class="kpi-sub">across ${CARDS.length} ad sets</div></div>
    <div class="kpi"><div class="kpi-label">Clicks</div><div class="kpi-value">${fmtInt(totalClicks)}</div><div class="kpi-sub">${fmtPct(avgCtr)} blended CTR</div></div>
    <div class="kpi"><div class="kpi-label">Leads</div><div class="kpi-value">${fmtInt(totalLeads)}</div><div class="kpi-sub">from lead-gen forms</div></div>
    <div class="kpi"><div class="kpi-label">Live Creatives</div><div class="kpi-value">${DATA.flatAds.length}</div><div class="kpi-sub">${DATA.flatAds.filter(a=>a.status==='Active').length} currently active</div></div>
  </div>`;
}

// ---------- card (campaigns view) ----------
function statBlock(card){
  const useCPL = card.leads > 0;
  return `
  <div class="stat-grid">
    <div class="stat-cell"><div class="s-label">Spend</div><div class="s-value">${fmtMoney(card.spend,0)}</div></div>
    <div class="stat-cell"><div class="s-label">Impr.</div><div class="s-value">${fmtInt(card.impressions)}</div></div>
    <div class="stat-cell"><div class="s-label">CTR</div><div class="s-value">${fmtPct(card.ctr)}</div></div>
    <div class="stat-cell"><div class="s-label">${useCPL ? 'CPL' : 'CPC'}</div><div class="s-value">${useCPL ? fmtMoney(card.cpl,0) : fmtMoney(card.cpc,2)}</div></div>
    <div class="stat-cell"><div class="s-label">Leads</div><div class="s-value ${useCPL ? 'lead-highlight' : ''}">${fmtInt(card.leads)}</div></div>
  </div>`;
}

function renderCard(card){
  const headline = (card.top_ad && card.top_ad.headline) ? card.top_ad.headline : adsetLabel(card);
  const bannerStyle = 'background:linear-gradient(135deg,#050e1e 0%,#092b35 72%,#0d7e89 135%);';
  const brief = adsetBriefFor(card.campaign, card.name);
  const safeCampaign = escapeHTML(card.campaign);
  const safeAdset = escapeHTML(card.name);
  return `
  <div class="card" data-id="${card.id}">
    <div class="compare-check ${isCompareSelected('card', card.id) ? 'checked' : ''}" data-compare-card="${card.id}" title="Select to compare"></div>
    <div class="card-banner" style="${bannerStyle}">
      <div class="banner-tag">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 21h20L12 2z"/></svg>
        ${objectiveTag(card.objective)}
      </div>
      <div class="banner-headline">${headline}</div>
    </div>
    <div class="card-body">
      <div class="card-identity">
        <div class="card-title">${adsetLabel(card)}</div>
        <div class="card-meta">${card.campaignShort}<span class="meta-dot"></span>${card.n_ads} creatives</div>
        <div class="adset-card-actions">
          <button type="button" class="ask-ai-button" data-ai-adset data-campaign="${safeCampaign}" data-adset="${safeAdset}">✦ Ask AI</button>
          <button type="button" class="edit-preview-link action-link-button" data-rename-adset data-campaign="${safeCampaign}" data-adset="${safeAdset}">Rename ad set</button>
          <button type="button" class="edit-preview-link action-link-button" data-adset-brief data-campaign="${safeCampaign}" data-adset="${safeAdset}">${brief ? 'Edit brief' : 'Add brief'}</button>
        </div>
      </div>
      <div class="card-context">
        ${objectivePickerHTML(card.campaign, card.objective)}
        ${brief ? `<div class="brief-preview"><div class="brief-preview-label">Campaign brief</div><div class="brief-preview-text">${escapeHTML(brief)}</div><button type="button" class="brief-read-more" data-adset-brief data-campaign="${safeCampaign}" data-adset="${safeAdset}">View full brief</button></div>` : ''}
        <div class="card-blurb">${card.blurb}</div>
      </div>
      <div class="card-performance">
        <div class="card-performance-head"><span class="performance-label">Performance</span><span class="status-pill ${card.perf.cls}"><span class="dot"></span>${card.perf.label}</span></div>
        ${statBlock(card)}
        <div class="card-footer">
        <div class="footer-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>
        </div>
          <span>${card.start} – ${card.end}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function applyFilters(cards){
  let out = cards.filter(c => passesStatusFilter(c.rawStatus) && passesDateFilter(c));
  if(state.search.trim()){
    const q = state.search.toLowerCase();
    out = out.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.campaign.toLowerCase().includes(q) ||
      (c.top_ad && c.top_ad.headline && c.top_ad.headline.toLowerCase().includes(q))
    );
  }
  const key = state.sortKey;
  out = [...out].sort((a,b) => (b[key]||0) - (a[key]||0));
  return out;
}

// ---------- compare (ad sets and creatives) ----------
let compareSelection = [];

function isCompareSelected(type, key){
  return compareSelection.some(c => c.type === type && c.key === key);
}
function toggleCompare(type, key){
  const idx = compareSelection.findIndex(c => c.type === type && c.key === key);
  if(idx >= 0) compareSelection.splice(idx, 1);
  else {
    if(compareSelection.length >= 4) return;
    compareSelection.push({ type, key });
  }
  renderCompareBar();
  renderMain();
  if(currentView === 'adset-detail') renderAdSetDetailView();
}

function renderCompareBar(){
  const existing = document.getElementById('compareBar');
  if(compareSelection.length < 2){
    if(existing) existing.remove();
    return;
  }
  const html = `
    <div class="compare-bar" id="compareBar">
      <span>${compareSelection.length} selected</span>
      <button class="cb-compare" id="cbCompareBtn">Compare</button>
      <button class="cb-clear" id="cbClearBtn">Clear</button>
    </div>`;
  if(existing) existing.outerHTML = html;
  else document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('cbCompareBtn').addEventListener('click', openCompareModal);
  document.getElementById('cbClearBtn').addEventListener('click', () => {
    compareSelection = [];
    renderCompareBar();
    renderMain();
    if(currentView === 'adset-detail') renderAdSetDetailView();
  });
}

function compareItemData(sel){
  if(sel.type === 'card'){
    const c = CARDS.find(x => x.id === sel.key);
    if(!c) return null;
    const ta = c.top_ad || {};
    return { label: c.name, sub: c.campaignShort, headline: ta.headline || '', intro: ta.intro || '',
      imageUrl: ta.imageUrl, gradient: c.gradient, url: ta.url,
      spend: c.spend, impressions: c.impressions, clicks: c.clicks, ctr: c.ctr,
      cpcLabel: c.leads > 0 ? 'CPL' : 'CPC', cpcVal: c.leads > 0 ? c.cpl : c.cpc, leads: c.leads, status: c.perf.label };
  }
  const a = AD_INDEX[sel.key];
  if(!a) return null;
  const cpl = a.leads > 0 ? +(a.spend / a.leads).toFixed(2) : null;
  return { label: adLabel(a), sub: a.adset || a.campaignShort || '', headline: a.headline || '', intro: a.intro || '',
    imageUrl: a.imageUrl, gradient: null, url: a.url,
    spend: a.spend, impressions: a.impressions, clicks: a.clicks, ctr: a.ctr,
    cpcLabel: a.leads > 0 ? 'CPL' : 'CPC', cpcVal: a.leads > 0 ? cpl : (a.clicks ? +(a.spend / a.clicks).toFixed(2) : 0),
    leads: a.leads || 0, status: a.status };
}

function compareCardHTML(i){
  const visualStyle = i.imageUrl
    ? `background-image:url('${i.imageUrl.replace(/'/g,"\\'")}');background-size:cover;background-position:center;`
    : `background:${i.gradient || 'linear-gradient(135deg,#0f1420,#1c2544 60%, #2a3766)'};`;
  return `
  <div class="compare-card">
    <div class="cc-visual" style="${visualStyle}"></div>
    <div class="cc-body">
      <div class="cc-name" title="${(i.label||'').replace(/"/g,'&quot;')}">${i.label}</div>
      <div class="cc-sub">${i.sub || ''}</div>
      <div class="cc-headline">${i.headline || 'No headline recorded'}</div>
      <div class="cc-intro">${i.intro ? i.intro.slice(0,140) + (i.intro.length>140?'…':'') : ''}</div>
      ${i.url ? `<a class="ad-thumb-dest" href="${i.url}" target="_blank" rel="noopener">↗ ${shortUrl(i.url)}</a>` : ''}
      <div class="cc-stats-list">
        <div><span>Spend</span><b>${fmtMoney(i.spend,0)}</b></div>
        <div><span>Impressions</span><b>${fmtInt(i.impressions)}</b></div>
        <div><span>Clicks</span><b>${fmtInt(i.clicks)}</b></div>
        <div><span>CTR</span><b>${fmtPct(i.ctr)}</b></div>
        <div><span>${i.cpcLabel}</span><b>${fmtMoney(i.cpcVal, i.cpcLabel === 'CPL' ? 0 : 2)}</b></div>
        <div><span>Leads</span><b>${fmtInt(i.leads)}</b></div>
        <div><span>Status</span><b>${i.status}</b></div>
      </div>
    </div>
  </div>`;
}

function openCompareModal(){
  const items = compareSelection.map(compareItemData).filter(Boolean);
  document.getElementById('compareModalBody').innerHTML = `
    <div class="compare-cards">
      ${items.map(compareCardHTML).join('')}
    </div>`;
  document.getElementById('compareOverlay').classList.add('show');
}
function closeCompareModal(){ document.getElementById('compareOverlay').classList.remove('show'); }
document.getElementById('compareModalClose').addEventListener('click', closeCompareModal);
document.getElementById('compareOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'compareOverlay') closeCompareModal();
});

function renderGallery(){
  const filtered = applyFilters(CARDS);
  const byCampaign = {};
  filtered.forEach(c => {
    byCampaign[c.campaign] = byCampaign[c.campaign] || [];
    byCampaign[c.campaign].push(c);
  });

  let html = bannerHTML() + renderKPIs();

  if(filtered.length === 0){
    html += `<div class="empty-note">No creatives match "${state.search}".</div>`;
  }

  Object.keys(byCampaign).forEach(camp => {
    const cards = byCampaign[camp];
    html += `
    <div class="group-block">
      <div class="group-head">
        <span class="g-title">${shortCampaignName(camp)}</span>
        <span class="g-count">${cards.length} ad set${cards.length>1?'s':''}</span>
        <span class="group-line"></span>
      </div>
      <div class="gallery">
        ${cards.map(renderCard).join('')}
      </div>
    </div>`;
  });

  document.getElementById('content').innerHTML = html;

  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', (event) => {
      if(event.target.closest('[data-campaign-objectives], [data-rename-adset], [data-adset-brief], [data-ai-adset]')) return;
      openPanel(el.getAttribute('data-id'));
    });
  });
  document.querySelectorAll('[data-rename-adset]').forEach(el => {
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      openAdsetRenameEditor(el.getAttribute('data-campaign'), el.getAttribute('data-adset'));
    });
  });
  document.querySelectorAll('[data-compare-card]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); toggleCompare('card', el.getAttribute('data-compare-card')); });
  });
  wireBannerButtons();
}

// ---------- alternate campaign views ----------
function wireAdsetViewCards(selector){
  document.querySelectorAll(selector).forEach(el => {
    el.addEventListener('click', (event) => {
      if(event.target.closest('[data-campaign-objectives], [data-rename-adset], [data-adset-brief], [data-ai-adset], [data-compare-card]')) return;
      openPanel(el.getAttribute('data-id'), null, currentView);
    });
  });
}

function renderCampaignGridView(){
  const filtered = applyFilters(CARDS);
  document.getElementById('content').innerHTML = bannerHTML() + renderKPIs() +
    (filtered.length
      ? `<div class="campaign-grid-view">${filtered.map(renderCard).join('')}</div>`
      : `<div class="empty-note">No campaigns match the current filters.</div>`);
  wireAdsetViewCards('.campaign-grid-view .card');
  document.querySelectorAll('[data-rename-adset]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation(); openAdsetRenameEditor(el.getAttribute('data-campaign'), el.getAttribute('data-adset'));
  }));
  document.querySelectorAll('[data-compare-card]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation(); toggleCompare('card', el.getAttribute('data-compare-card'));
  }));
  wireBannerButtons();
}

function statusBucket(card){
  const s = String(card.rawStatus || card.status || '').toLowerCase();
  if(s.includes('delete') || s.includes('archive')) return 'Deleted';
  if(s.includes('pause') || s.includes('passive') || s.includes('inactive')) return 'Paused';
  return 'Active';
}

function kanbanCardHTML(card){
  return `<div class="kanban-card" data-id="${card.id}" tabindex="0">
    <div class="kanban-card-title">${adsetLabel(card)}</div>
    <div class="kanban-card-campaign">${shortCampaignName(card.campaign)}</div>
    <div class="kanban-metrics">
      <div><span>Spend</span><b>${fmtMoney(card.spend,0)}</b></div>
      <div><span>CTR</span><b>${fmtPct(card.ctr)}</b></div>
      <div><span>Leads</span><b>${fmtInt(card.leads)}</b></div>
    </div>
  </div>`;
}

function renderStatusKanbanView(){
  const filtered = applyFilters(CARDS);
  const lanes = ['Active','Paused','Deleted'];
  const laneClass = {Active:'active',Paused:'paused',Deleted:'deleted'};
  const html = lanes.map(status => {
    const items = filtered.filter(c => statusBucket(c) === status);
    return `<section class="kanban-column">
      <div class="kanban-head"><span class="kanban-dot ${laneClass[status]}"></span>${status === 'Paused' ? 'Passive / Paused' : status}<span class="kanban-count">${items.length}</span></div>
      ${items.map(kanbanCardHTML).join('') || `<div class="empty-note">No ${status.toLowerCase()} ad sets</div>`}
    </section>`;
  }).join('');
  document.getElementById('content').innerHTML = bannerHTML() + renderKPIs() + `<div class="kanban-board">${html}</div>`;
  wireAdsetViewCards('.kanban-card');
  document.querySelectorAll('.kanban-card').forEach(el => el.addEventListener('keydown', e => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openPanel(el.getAttribute('data-id'), null, currentView); }
  }));
  wireBannerButtons();
}

function cardDate(value){
  if(!value) return null;
  const parsed = new Date(`${value}, 2026 12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

let calendarCursor = new Date(2026, 6, 1);
function renderCampaignCalendarView(){
  const filtered = applyFilters(CARDS);
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());
  const days = Array.from({length:42}, (_,i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate()+i));
  const dayHTML = days.map(day => {
    const events = filtered.filter(c => {
      const start = cardDate(c.start), end = cardDate(c.end);
      return start && end && day >= start && day <= end;
    });
    const muted = day.getMonth() !== month ? ' muted' : '';
    return `<div class="calendar-day${muted}">
      <div class="day-number">${day.getDate()}</div>
      ${events.slice(0,4).map(c => `<button class="calendar-event ${statusBucket(c).toLowerCase()}" data-id="${c.id}" title="${escapeHTML(adsetLabel(c))}">${escapeHTML(adsetLabel(c))}</button>`).join('')}
      ${events.length > 4 ? `<div class="day-number">+${events.length-4} more</div>` : ''}
    </div>`;
  }).join('');
  document.getElementById('content').innerHTML = bannerHTML() + `<div class="calendar-shell">
    <div class="calendar-head">
      <div><div class="calendar-title">${first.toLocaleString('en-US',{month:'long'})} ${year}</div><div class="exec-sub">${filtered.length} filtered ad sets scheduled</div></div>
      <div class="calendar-nav"><button id="calendarPrev">← Previous</button><button id="calendarToday">Jul 2026</button><button id="calendarNext">Next →</button></div>
    </div>
    <div class="calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div>${d}</div>`).join('')}</div>
    <div class="calendar-grid">${dayHTML}</div>
    <div class="calendar-legend"><span>Active</span><span class="paused">Passive / Paused</span><span class="deleted">Deleted</span></div>
  </div>`;
  document.getElementById('calendarPrev').onclick = () => { calendarCursor = new Date(year,month-1,1); renderCampaignCalendarView(); };
  document.getElementById('calendarNext').onclick = () => { calendarCursor = new Date(year,month+1,1); renderCampaignCalendarView(); };
  document.getElementById('calendarToday').onclick = () => { calendarCursor = new Date(2026,6,1); renderCampaignCalendarView(); };
  wireAdsetViewCards('.calendar-event');
  wireBannerButtons();
}

function campaignRollups(cards){
  const map = {};
  cards.forEach(c => {
    const row = map[c.campaign] || (map[c.campaign] = {name:c.campaign,spend:0,impressions:0,clicks:0,leads:0,adsets:0,objectives:new Set()});
    row.spend += c.spend || 0; row.impressions += c.impressions || 0; row.clicks += c.clicks || 0; row.leads += c.leads || 0; row.adsets++;
    (Array.isArray(c.objective) ? c.objective : [c.objective]).filter(Boolean).forEach(o => row.objectives.add(o));
  });
  return Object.values(map).map(r => ({...r,ctr:r.impressions ? r.clicks/r.impressions*100 : 0,cpl:r.leads ? r.spend/r.leads : null}));
}

function renderExecutiveDashboardView(){
  const filtered = applyFilters(CARDS);
  const campaigns = campaignRollups(filtered).sort((a,b)=>b.spend-a.spend);
  const totalSpend = campaigns.reduce((s,c)=>s+c.spend,0);
  const totalImpressions = campaigns.reduce((s,c)=>s+c.impressions,0);
  const totalClicks = campaigns.reduce((s,c)=>s+c.clicks,0);
  const totalLeads = campaigns.reduce((s,c)=>s+c.leads,0);
  const objectives = {};
  filtered.forEach(c => (Array.isArray(c.objective) ? c.objective : [c.objective]).filter(Boolean).forEach(o => objectives[o]=(objectives[o]||0)+(c.spend||0)));
  const objectiveRows = Object.entries(objectives).sort((a,b)=>b[1]-a[1]);
  const statuses = {Active:0,Paused:0,Deleted:0}; filtered.forEach(c => statuses[statusBucket(c)]++);
  document.getElementById('content').innerHTML = bannerHTML() + `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Total Spend</div><div class="kpi-value">${fmtMoney(totalSpend,0)}</div><div class="kpi-sub">${campaigns.length} campaigns</div></div>
      <div class="kpi"><div class="kpi-label">Impressions</div><div class="kpi-value">${fmtInt(totalImpressions)}</div><div class="kpi-sub">${fmtPct(totalImpressions ? totalClicks/totalImpressions*100 : 0)} blended CTR</div></div>
      <div class="kpi"><div class="kpi-label">Clicks</div><div class="kpi-value">${fmtInt(totalClicks)}</div><div class="kpi-sub">${fmtMoney(totalClicks ? totalSpend/totalClicks : 0,2)} blended CPC</div></div>
      <div class="kpi"><div class="kpi-label">Leads</div><div class="kpi-value">${fmtInt(totalLeads)}</div><div class="kpi-sub">${totalLeads ? fmtMoney(totalSpend/totalLeads,0)+' blended CPL' : 'No attributed leads'}</div></div>
      <div class="kpi"><div class="kpi-label">Active Ad Sets</div><div class="kpi-value">${statuses.Active}</div><div class="kpi-sub">${filtered.length} total ad sets</div></div>
    </div>
    <div class="exec-grid">
      <section class="exec-card"><h2>Campaign performance</h2><div class="exec-sub">Campaign-level totals ranked by spend</div>
        <table class="exec-table"><thead><tr><th>Campaign</th><th>Spend</th><th>CTR</th><th>Leads</th><th>CPL</th></tr></thead><tbody>
          ${campaigns.map(c=>`<tr><td><b>${escapeHTML(shortCampaignName(c.name))}</b><br><span class="exec-sub">${c.adsets} ad set${c.adsets===1?'':'s'}</span></td><td>${fmtMoney(c.spend,0)}</td><td>${fmtPct(c.ctr)}</td><td>${fmtInt(c.leads)}</td><td>${c.cpl ? fmtMoney(c.cpl,0) : '—'}</td></tr>`).join('')}
        </tbody></table>
      </section>
      <section class="exec-card"><h2>Investment mix</h2><div class="exec-sub">Spend distribution by selected campaign objective</div>
        ${objectiveRows.map(([name,value])=>`<div class="mix-row"><div class="mix-label"><span>${escapeHTML(name)}</span><b>${totalSpend ? Math.round(value/totalSpend*100) : 0}%</b></div><div class="mix-track"><div class="mix-fill" style="width:${totalSpend ? Math.min(100,value/totalSpend*100) : 0}%"></div></div></div>`).join('') || '<div class="empty-note">No objective data</div>'}
        <div class="status-summary"><div><b>${statuses.Active}</b><span>Active</span></div><div><b>${statuses.Paused}</b><span>Paused</span></div><div><b>${statuses.Deleted}</b><span>Deleted</span></div></div>
      </section>
    </div>`;
  wireBannerButtons();
}

// ---------- Ads Gallery: every ad across every campaign and ad set ----------
let gallerySelectedAdName = null;

function galleryAdDetailHTML(ad){
  const scoreInfo = computeAdScore(ad);
  const safeName = (ad.name || '').replace(/"/g,'&quot;');
  const adsetName = ADSET_DISPLAY_NAMES[adsetKey(ad.campaign, ad.adset)] || ad.adset;
  return `
    <aside class="gallery-detail-panel" aria-label="Selected ad details">
      <div class="gallery-detail-head">
        <div>
          <div class="gallery-detail-eyebrow">Selected ad</div>
          <div class="gallery-detail-title">${adLabel(ad)}</div>
          <div class="gallery-detail-meta">${ad.campaignShort}<br>${adsetName}</div>
        </div>
        <button type="button" class="gallery-detail-close" id="closeGalleryDetail" aria-label="Close selected ad">&times;</button>
      </div>
      <div class="gallery-detail-body">
        ${renderLiPreview(ad, adsetName)}
        <div class="gallery-detail-metrics">
          <div class="gallery-detail-metric"><div class="s-label">Spend</div><div class="s-value">${fmtMoney(ad.spend,0)}</div></div>
          <div class="gallery-detail-metric"><div class="s-label">Impressions</div><div class="s-value">${fmtInt(ad.impressions)}</div></div>
          <div class="gallery-detail-metric"><div class="s-label">Clicks</div><div class="s-value">${fmtInt(ad.clicks)}</div></div>
          <div class="gallery-detail-metric"><div class="s-label">CTR</div><div class="s-value">${fmtPct(ad.ctr)}</div></div>
          <div class="gallery-detail-metric"><div class="s-label">Leads</div><div class="s-value ${ad.leads > 0 ? 'lead-highlight' : ''}">${fmtInt(ad.leads || 0)}</div></div>
          <div class="gallery-detail-metric"><div class="s-label">Score</div><div class="s-value">${scoreInfo.score === null ? '—' : scoreInfo.score}</div></div>
        </div>
        ${scoreSummaryHTML(scoreInfo)}
        <div class="gallery-detail-actions" data-ad-actions>
          <button type="button" class="ask-ai-button" data-ai-ad="${safeName}">✦ Ask AI</button>
          <button type="button" class="edit-preview-link action-link-button" data-ad="${safeName}">Edit preview</button>
          <button type="button" class="edit-preview-link action-link-button" data-rename-ad="${safeName}">Rename</button>
          <button type="button" class="edit-preview-link action-link-button fb-link ${ad.feedbackApplied ? 'fb-applied' : (ad.feedbackNote ? 'fb-pending' : '')}" data-fb-ad="${safeName}">${feedbackLabel(ad)}</button>
        </div>
      </div>
    </aside>`;
}

function renderAdsGalleryView(){
  let ads = DATA.flatAds.filter(a => passesStatusFilter(a.status) && passesDateFilter(a));
  if(state.search.trim()){
    const q = state.search.toLowerCase();
    ads = ads.filter(a =>
      (a.name || '').toLowerCase().includes(q) ||
      (a.displayName || '').toLowerCase().includes(q) ||
      (a.headline || '').toLowerCase().includes(q) ||
      (a.campaign || '').toLowerCase().includes(q) ||
      (a.adset || '').toLowerCase().includes(q)
    );
  }
  ads = [...ads].sort((a,b) => (b[state.sortKey] || 0) - (a[state.sortKey] || 0));

  const totalSpend = ads.reduce((sum,ad) => sum + ad.spend, 0);
  const campaigns = new Set(ads.map(ad => ad.campaign)).size;
  const adsets = new Set(ads.map(ad => `${ad.campaign}|||${ad.adset}`)).size;
  const temporaryAssets = ads.reduce((count, ad) => count + [ad.imageUrl, ad.previewUrl, ad.ctaUrl || ad.url].filter(isLikelyExpiringAssetUrl).length, 0);
  let html = bannerHTML() + `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Ads shown</div><div class="kpi-value">${ads.length}</div><div class="kpi-sub">${state.statusFilter.toLowerCase()} · ${state.dateRange === 'all' ? 'all dates' : `last ${state.dateRange} days`}</div></div>
      <div class="kpi"><div class="kpi-label">Campaigns</div><div class="kpi-value">${campaigns}</div><div class="kpi-sub">together in one view</div></div>
      <div class="kpi"><div class="kpi-label">Ad sets</div><div class="kpi-value">${adsets}</div><div class="kpi-sub">represented in gallery</div></div>
      <div class="kpi"><div class="kpi-label">Spend shown</div><div class="kpi-value">${fmtMoney(totalSpend,0)}</div><div class="kpi-sub">for visible ads</div></div>
      <div class="kpi"><div class="kpi-label">With images</div><div class="kpi-value">${ads.filter(ad => ad.imageUrl).length}</div><div class="kpi-sub">${ads.length ? Math.round(ads.filter(ad => ad.imageUrl).length / ads.length * 100) : 0}% image coverage</div></div>
    </div>
    ${temporaryAssets ? `<div class="empty-note" style="margin-bottom:16px;"><b>Asset health:</b> ${temporaryAssets} temporary or signed URL${temporaryAssets === 1 ? '' : 's'} detected. Open <b>Edit preview</b> on an ad to replace temporary images with a durable file upload. Saved CTA and preview overrides remain attached after spreadsheet syncs.</div>` : ''}`;

  if(!ads.length){
    html += `<div class="empty-note">No ads match the current search, status, and date filters.</div>`;
  } else {
    if(gallerySelectedAdName && !ads.some(ad => ad.name === gallerySelectedAdName)) gallerySelectedAdName = null;
    const selectedAd = gallerySelectedAdName ? AD_INDEX[gallerySelectedAdName] : null;
    html += `<div class="ads-gallery-layout${selectedAd ? ' has-selection' : ''}"><div class="ads-gallery">${ads.map(ad => {
      const safeName = (ad.name || '').replace(/"/g,'&quot;');
      const visualStyle = ad.imageUrl
        ? `background-image:url('${ad.imageUrl.replace(/'/g,"\\'")}');`
        : '';
      return `
        <article class="ad-gallery-card${ad.name === gallerySelectedAdName ? ' selected-detail' : ''}" data-open-gallery-ad="${safeName}" tabindex="0" role="button" aria-label="Preview ${adLabel(ad).replace(/"/g,'&quot;')}">
          <div class="compare-check ${isCompareSelected('ad', ad.name) ? 'checked' : ''}" data-compare-ad-toggle="${safeName}" title="Select to compare"></div>
          <div class="ad-gallery-visual${ad.imageUrl ? '' : ' no-image'}" ${ad.imageUrl ? `data-creative-image="${escapeHTML(ad.imageUrl)}"` : ''} style="${visualStyle}">
            <span class="ad-gallery-status">${ad.status || 'Unknown'}</span>
            <span class="creative-image-message">Image unavailable — edit image</span>
            ${ad.imageUrl ? '' : '<span class="creative-no-image-label">No image added</span>'}
          </div>
          <div class="ad-gallery-body">
            <div>
              <div class="ad-gallery-name">${adLabel(ad)}</div>
              <div class="ad-gallery-headline">${ad.headline || 'No headline recorded'}</div>
            </div>
            <div class="ad-gallery-meta">${ad.campaignShort}<br>${ADSET_DISPLAY_NAMES[adsetKey(ad.campaign, ad.adset)] || ad.adset}</div>
            <div class="ad-gallery-stats">
              <div><div class="s-label">Spend</div><div class="s-value">${fmtMoney(ad.spend,0)}</div></div>
              <div><div class="s-label">Impr.</div><div class="s-value">${fmtInt(ad.impressions)}</div></div>
              <div><div class="s-label">Clicks</div><div class="s-value">${fmtInt(ad.clicks)}</div></div>
              <div><div class="s-label">CTR</div><div class="s-value">${fmtPct(ad.ctr)}</div></div>
              <div><div class="s-label">Leads</div><div class="s-value ${ad.leads > 0 ? 'lead-highlight' : ''}">${fmtInt(ad.leads || 0)}</div></div>
            </div>
            <div class="ad-gallery-actions" data-ad-actions>
              <button type="button" class="ask-ai-button" data-ai-ad="${safeName}">✦ Ask AI</button>
              <button type="button" class="edit-preview-link action-link-button" data-ad="${safeName}">Edit preview</button>
              <button type="button" class="edit-preview-link action-link-button" data-rename-ad="${safeName}">Rename</button>
              <button type="button" class="edit-preview-link action-link-button fb-link ${ad.feedbackApplied ? 'fb-applied' : (ad.feedbackNote ? 'fb-pending' : '')}" data-fb-ad="${safeName}">${feedbackLabel(ad)}</button>
            </div>
          </div>
        </article>`;
    }).join('')}</div>${selectedAd ? galleryAdDetailHTML(selectedAd) : ''}</div>`;
  }

  document.getElementById('content').innerHTML = html;
  wireBannerButtons();
  document.querySelectorAll('[data-compare-ad-toggle]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCompare('ad', el.getAttribute('data-compare-ad-toggle'));
    });
  });
  document.querySelectorAll('[data-open-gallery-ad]').forEach(el => {
    const openAdDetail = (event) => {
      if(event.target.closest('[data-ad-actions], [data-compare-ad-toggle]')) return;
      const ad = AD_INDEX[el.getAttribute('data-open-gallery-ad')];
      if(!ad) return;
      gallerySelectedAdName = ad.name;
      renderAdsGalleryView();
    };
    el.addEventListener('click', openAdDetail);
    el.addEventListener('keydown', event => {
      if(event.key === 'Enter' || event.key === ' '){
        event.preventDefault();
        openAdDetail(event);
      }
    });
  });
  const closeGalleryDetail = document.getElementById('closeGalleryDetail');
  if(closeGalleryDetail) closeGalleryDetail.addEventListener('click', () => {
    gallerySelectedAdName = null;
    renderAdsGalleryView();
  });
}

// ---------- Creatives view ----------
function renderCreativesView(){
  let ads = DATA.flatAds.filter(a => passesStatusFilter(a.status) && passesDateFilter(a));
  if(state.search.trim()){
    const q = state.search.toLowerCase();
    ads = ads.filter(a =>
      (a.name||'').toLowerCase().includes(q) ||
      (a.displayName||'').toLowerCase().includes(q) ||
      (a.headline||'').toLowerCase().includes(q) ||
      (a.campaign||'').toLowerCase().includes(q)
    );
  }
  ads = [...ads].sort((a,b) => (b[state.sortKey]||0) - (a[state.sortKey]||0));

  const totalSpend = DATA.flatAds.reduce((s,a)=>s+a.spend,0);
  const activeCount = DATA.flatAds.filter(a=>a.status==='Active').length;

  let html = bannerHTML() + `
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">${state.statusFilter} Creatives</div><div class="kpi-value">${ads.length}</div><div class="kpi-sub">${DATA.flatAds.length} total \u00b7 ${activeCount} active</div></div>
    <div class="kpi"><div class="kpi-label">Creative Spend</div><div class="kpi-value">${fmtMoney(totalSpend,0)}</div><div class="kpi-sub">across all ads</div></div>
    <div class="kpi"><div class="kpi-label">Top CTR</div><div class="kpi-value">${fmtPct(Math.max(...DATA.flatAds.map(a=>a.ctr),0))}</div><div class="kpi-sub">best-performing creative</div></div>
  </div>`;

  if(ads.length === 0){
    html += `<div class="empty-note">No ${state.statusFilter !== 'All' ? state.statusFilter.toLowerCase() + ' ' : ''}creatives match "${state.search}". Try the Filter chip above to widen the view.</div>`;
  } else {
    html += `<div class="creative-list">`;
    html += ads.map(ad => `
      <div class="creative-row">
        <div class="cr-status" style="background:${ad.status==='Active' ? '#0f9d58' : ad.status==='Deleted' ? '#c23b3b' : '#b8790a'}"></div>
        <div class="cr-main">
          <div class="cr-name">${adLabel(ad)}</div>
          <div class="cr-headline">${ad.headline || '—'}</div>
          <div class="cr-meta">${ad.campaignShort} <span class="meta-dot"></span> ${ad.adset}${ad.url ? ` <span class="meta-dot"></span> <a class="ad-thumb-dest" href="${ad.url}" target="_blank" rel="noopener">↗ ${shortUrl(ad.url)}</a>` : ''}</div>
        </div>
        <div class="cr-stats">
          <div><div class="s-label">Spend</div><div class="s-value">${fmtMoney(ad.spend,0)}</div></div>
          <div><div class="s-label">Impr.</div><div class="s-value">${fmtInt(ad.impressions)}</div></div>
          <div><div class="s-label">Clicks</div><div class="s-value">${fmtInt(ad.clicks)}</div></div>
          <div><div class="s-label">CTR</div><div class="s-value">${fmtPct(ad.ctr)}</div></div>
        </div>
        <button type="button" class="ask-ai-button" data-ai-ad="${(ad.name||'').replace(/"/g,'&quot;')}">✦ Ask AI</button>
        <span class="edit-preview-link" data-ad="${(ad.name||'').replace(/"/g,'&quot;')}">${ad.imageUrl ? 'Edit preview' : 'Add preview'}</span>
        <span class="edit-preview-link" data-rename-ad="${(ad.name||'').replace(/"/g,'&quot;')}">Rename</span>
        <span class="edit-preview-link fb-link ${ad.feedbackApplied ? 'fb-applied' : (ad.feedbackNote ? 'fb-pending' : '')}" data-fb-ad="${(ad.name||'').replace(/"/g,'&quot;')}">${feedbackLabel(ad)}</span>
        <span class="status-pill ${ad.status==='Active'?'status-scaling':ad.status==='Deleted'?'status-paused':'status-slowing'}">${ad.status}</span>
      </div>`).join('');
    html += `</div>`;
  }

  document.getElementById('content').innerHTML = html;
  wireBannerButtons();
  document.querySelectorAll('[data-rename-ad]').forEach(el => {
    el.addEventListener('click', () => openRenameEditor(el.getAttribute('data-rename-ad')));
  });
  document.querySelectorAll('.fb-link[data-fb-ad]').forEach(el => {
    el.addEventListener('click', () => openAdFeedbackEditor(el.getAttribute('data-fb-ad')));
  });
}

// ---------- Landing Pages view ----------
function renderLandingPagesView(){
  let pages = DATA.landingPages;
  if(state.search.trim()){
    const q = state.search.toLowerCase();
    pages = pages.filter(p => p.url.toLowerCase().includes(q));
  }
  pages = [...pages].sort((a,b) => (b[state.sortKey]||0) - (a[state.sortKey]||0));

  const totalSpend = DATA.landingPages.reduce((s,p)=>s+p.spend,0);

  let html = bannerHTML() + `
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Landing Pages</div><div class="kpi-value">${DATA.landingPages.length}</div><div class="kpi-sub">unique destinations</div></div>
    <div class="kpi"><div class="kpi-label">Spend Directed</div><div class="kpi-value">${fmtMoney(totalSpend,0)}</div><div class="kpi-sub">across all pages</div></div>
  </div>
  <div class="empty-note" style="margin-bottom:18px;">Grouped by destination URL (query params like UTM tags stripped). Source: the "Click URL" column in the LinkedIn export.</div>`;

  if(pages.length === 0){
    html += `<div class="empty-note">No landing pages match "${state.search}".</div>`;
  } else {
    html += `<div class="creative-list">`;
    html += pages.map(p => `
      <div class="creative-row">
        <div class="cr-main" style="flex:1;">
          <div class="cr-name">${shortUrl(p.url)}</div>
          <div class="cr-headline" style="word-break:break-all;">${p.url}</div>
          <div class="cr-meta">${p.campaigns.join(', ')} <span class="meta-dot"></span> ${p.n_ads} creative${p.n_ads>1?'s':''}</div>
        </div>
        <div class="cr-stats">
          <div><div class="s-label">Spend</div><div class="s-value">${fmtMoney(p.spend,0)}</div></div>
          <div><div class="s-label">Impr.</div><div class="s-value">${fmtInt(p.impressions)}</div></div>
          <div><div class="s-label">Clicks</div><div class="s-value">${fmtInt(p.clicks)}</div></div>
          <div><div class="s-label">CTR</div><div class="s-value">${fmtPct(p.ctr)}</div></div>
        </div>
      </div>`).join('');
    html += `</div>`;
  }

  document.getElementById('content').innerHTML = html;
  wireBannerButtons();
}

// ---------- Budget view ----------
function renderBudgetView(){
  let rows = CARDS.map(c => {
    const spendPerDay = c.activeDays ? c.spend / c.activeDays : 0;
    const pacing = c.dailyBudget ? +(spendPerDay / c.dailyBudget * 100).toFixed(0) : null;
    return {...c, spendPerDay, pacing};
  });
  if(state.search.trim()){
    const q = state.search.toLowerCase();
    rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.campaign.toLowerCase().includes(q));
  }
  const sortKey = state.sortKey === 'pacing' ? 'pacing' : state.sortKey;
  rows = [...rows].sort((a,b) => (b[sortKey]||0) - (a[sortKey]||0));

  const totalDailyBudget = CARDS.reduce((s,c)=>s+(c.dailyBudget||0),0);
  const totalSpend = CARDS.reduce((s,c)=>s+c.spend,0);

  let html = bannerHTML() + `
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Combined Daily Budget</div><div class="kpi-value">${fmtMoney(totalDailyBudget,0)}</div><div class="kpi-sub">across ${CARDS.length} ad sets</div></div>
    <div class="kpi"><div class="kpi-label">Total Spend</div><div class="kpi-value">${fmtMoney(totalSpend,0)}</div><div class="kpi-sub">Apr 24 – Jul 22, 2026</div></div>
  </div>
  <div class="empty-note" style="margin-bottom:18px;">Pacing = actual average daily spend ÷ set daily budget. Over 100% means an ad set is spending faster than its daily budget on the days it runs (common with CPM ad sets that don't spend every single day).</div>
  <div class="budget-table">
    <div class="budget-head">
      <div>Ad Set</div><div>Daily Budget</div><div>Avg Spend / Day</div><div>Pacing</div><div>Total Spend</div>
    </div>
    ${rows.map(r => `
    <div class="budget-row">
      <div>
        <div class="cr-name">${r.name}</div>
        <div class="cr-meta">${r.campaignShort} <span class="meta-dot"></span> ${r.costType || '—'}</div>
      </div>
      <div class="s-value">${r.dailyBudget ? fmtMoney(r.dailyBudget,0) : '—'}</div>
      <div class="s-value">${fmtMoney(r.spendPerDay,0)}</div>
      <div>${r.pacing===null ? '<span class="s-value">—</span>' : `<span class="status-pill ${r.pacing>110?'status-slowing':r.pacing<70?'status-steady':'status-scaling'}">${r.pacing}%</span>`}</div>
      <div class="s-value">${fmtMoney(r.spend,0)}</div>
    </div>`).join('')}
  </div>`;

  document.getElementById('content').innerHTML = html;
  wireBannerButtons();
}

// ---------- Insights view ----------
function bigSparkSVG(trend){
  if(!trend || trend.length===0) return '';
  const w = 1000, h = 220, pad = 24;
  const values = trend.map(t=>t.v);
  const max = Math.max(...values, 1);
  const step = (w - pad*2) / (trend.length - 1 || 1);
  const pts = values.map((v,i) => `${(pad+i*step).toFixed(1)},${(h - pad - (v/max)*(h-pad*2)).toFixed(1)}`).join(' ');
  const areaPts = `${pad},${h-pad} ` + pts + ` ${w-pad},${h-pad}`;
  const everyN = Math.ceil(trend.length / 8);
  const labels = trend.map((t,i) => (i % everyN === 0 || i === trend.length-1) ? `<text x="${(pad+i*step).toFixed(1)}" y="${h-4}" font-size="10" fill="#8890a6" text-anchor="middle">${t.label}</text>` : '').join('');
  return `
  <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <polygon points="${areaPts}" fill="#3b6ef6" opacity="0.08"></polygon>
    <polyline points="${pts}" fill="none" stroke="#3b6ef6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
    ${labels}
  </svg>`;
}

function renderInsightsView(){
  const trend = DATA.accountTrend;
  const totalSpend = trend.reduce((s,t)=>s+t.v,0);
  const avgDaily = trend.length ? totalSpend/trend.length : 0;
  const best = trend.reduce((m,t)=> t.v > m.v ? t : m, trend[0] || {v:0,label:'—'});

  const byCampaignSpend = {};
  CARDS.forEach(c => { byCampaignSpend[c.campaignShort] = (byCampaignSpend[c.campaignShort]||0) + c.spend; });
  const campaignRows = Object.entries(byCampaignSpend).sort((a,b)=>b[1]-a[1]);
  const maxCampSpend = Math.max(...campaignRows.map(r=>r[1]), 1);

  let html = bannerHTML() + `
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Total Spend</div><div class="kpi-value">${fmtMoney(totalSpend,0)}</div><div class="kpi-sub">${trend.length} active days</div></div>
    <div class="kpi"><div class="kpi-label">Avg Daily Spend</div><div class="kpi-value">${fmtMoney(avgDaily,0)}</div><div class="kpi-sub">across the flight</div></div>
    <div class="kpi"><div class="kpi-label">Peak Day</div><div class="kpi-value">${fmtMoney(best.v,0)}</div><div class="kpi-sub">${best.label}</div></div>
  </div>
  <div class="panel-section" style="margin-bottom:24px;">
    <h3 style="margin-bottom:14px;">Daily spend — full flight</h3>
    <div class="spark-wrap" style="padding:18px;">
      ${bigSparkSVG(trend)}
    </div>
  </div>
  <div class="panel-section">
    <h3 style="margin-bottom:14px;">Spend by campaign</h3>
    <div class="budget-table">
      ${campaignRows.map(([name, spend]) => `
      <div class="budget-row" style="grid-template-columns:220px 1fr 100px;">
        <div class="cr-name">${name}</div>
        <div style="display:flex;align-items:center;">
          <div style="height:8px;border-radius:4px;background:#3b6ef6;width:${(spend/maxCampSpend*100).toFixed(1)}%;min-width:4px;"></div>
        </div>
        <div class="s-value" style="text-align:right;">${fmtMoney(spend,0)}</div>
      </div>`).join('')}
    </div>
  </div>`;

  document.getElementById('content').innerHTML = html;
  wireBannerButtons();
}

// ---------- Score guide + user-customizable legend ----------
function bandRangeText(index){
  const band = SCORE_BANDS[index];
  if(index === 0) return `${band.min}–100`;
  return `${band.min}–${SCORE_BANDS[index - 1].min - 1}`;
}

function renderScoreGuideView(){
  const html = `
  <div class="score-guide">
    <div class="score-guide-intro">
      <div>
        <div class="eyebrow">INTERNAL RULE-BASED MODEL</div>
        <h2>What this score means</h2>
        <p>The ad score is an internal comparison aid—not a LinkedIn score or an industry benchmark. Its performance metrics and weights change according to the campaign objective.</p>
      </div>
      <div class="score-example">
        <div class="score-circle" style="background:${scoreBandFor(71).color}">71</div>
        <div><b>${scoreBandFor(71).label} · 71/100</b><span>Example using your current legend</span></div>
      </div>
    </div>

    <div class="score-guide-grid">
      <section class="guide-card">
        <div class="guide-card-head"><span>How the 100 points are calculated</span><b>100 total</b></div>
        <div class="formula-row"><div class="formula-points">65</div><div><b>Goal-specific performance</b><p>The selected campaign objective determines which metrics are used. Each metric is compared with the weighted average of delivered ads that include the same objective. Matching a benchmark earns that metric's full allocated points; performance above it remains capped.</p></div></div>
        <div class="formula-row"><div class="formula-points">20</div><div><b>Primary-text length</b><p>80–200 characters: 20 points; 40–79 or 201–250: 15; over 250: 10; under 40: 5.</p></div></div>
        <div class="formula-row"><div class="formula-points">15</div><div><b>Headline length</b><p>10–70 characters: 15 points; any other non-empty length: 8; no headline: 0.</p></div></div>
      </section>

      <section class="guide-card">
        <div class="guide-card-head"><span>Your score legend</span><b>Customizable</b></div>
        <p class="guide-help">Set the minimum score, label, and color for each band. These settings change how scores are described and displayed; they do not change the point calculation.</p>
        <div class="band-editor">
          ${SCORE_BANDS.map((band, i) => `
          <div class="band-row" data-band-index="${i}">
            <input class="band-color" type="color" value="${band.color}" aria-label="Band color">
            <input class="band-label-input" type="text" value="${band.label.replace(/"/g,'&quot;')}" maxlength="30" aria-label="Band label">
            <label>Minimum <input class="band-min-input" type="number" min="0" max="100" value="${band.min}" ${i === 2 ? 'disabled' : ''}></label>
            <span class="band-range" style="color:${band.color}">${bandRangeText(i)}</span>
          </div>`).join('')}
        </div>
        <div class="legend-preview">
          ${SCORE_BANDS.map((band, i) => `<div><span style="background:${band.color}"></span><b>${band.label}</b><small>${bandRangeText(i)}</small></div>`).join('')}
        </div>
        <div id="scoreConfigStatus" class="modal-status"></div>
        <div class="score-config-actions">
          <button class="ghost" id="resetScoreConfig">Reset defaults</button>
          <button class="primary" id="saveScoreConfig">Save legend</button>
        </div>
        <p class="storage-note">Saved in the shared database. Changes apply to everyone using this app.</p>
      </section>
    </div>

    <section class="guide-card score-important">
      <div class="guide-card-head"><span>Performance score by campaign goal</span><b>65 points</b></div>
      <div class="important-grid">
        ${Object.entries(OBJECTIVE_SCORE_RULES).map(([objective, rule]) => `<div><b>${objective}</b><p>${rule}</p></div>`).join('')}
      </div>
      <p class="guide-help">For cost metrics (CPC, CPM, CPL and CPA), lower than the objective benchmark scores better. For rate metrics, higher scores better. When multiple goals are selected, the app calculates each goal's 65-point performance score separately and uses their average; copy can then add up to 35 points.</p>
    </section>

    <section class="guide-card score-important">
      <div class="guide-card-head"><span>Important when interpreting the score</span></div>
      <div class="important-grid">
        <div><b>Minimum data requirement</b><p>Ads with fewer than 50 impressions show “Not enough data” and receive no score.</p></div>
        <div><b>Apples-to-apples benchmark</b><p>Each metric is compared only with delivered ads that include the same campaign objective—never with the account-wide average.</p></div>
        <div><b>Multiple objectives</b><p>Each selected objective is scored independently, then the objective scores are averaged. This prevents one goal from silently using another goal's thresholds.</p></div>
        <div><b>Available-data boundary</b><p>Video Views temporarily uses CTR as a proxy until video-view and completion fields are imported. Lead quality is not yet scored.</p></div>
        <div><b>Use it to prioritize review</b><p>Treat the score as a quick diagnostic signal. Use actual CTR, conversions, CPL, and business outcomes for decisions.</p></div>
      </div>
    </section>
  </div>`;
  document.getElementById('content').innerHTML = html;

  document.getElementById('saveScoreConfig').addEventListener('click', async () => {
    const rows = [...document.querySelectorAll('.band-row')];
    const next = rows.map((row, i) => ({
      min: i === 2 ? 0 : Number(row.querySelector('.band-min-input').value),
      label: row.querySelector('.band-label-input').value.trim(),
      color: row.querySelector('.band-color').value
    }));
    const status = document.getElementById('scoreConfigStatus');
    if(next.some(b => !b.label) || next[0].min <= next[1].min || next[0].min > 100 || next[1].min < 1){
      status.textContent = 'Use labels for all bands and descending minimums (for example 75, 50, 0).';
      status.className = 'modal-status bad';
      return;
    }
    const saveBtn = document.getElementById('saveScoreConfig');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try{
      await setAppSetting(SCORE_CONFIG_KEY, JSON.stringify(next));
      SCORE_BANDS = next;
      renderScoreGuideView();
      const saved = document.getElementById('scoreConfigStatus');
      saved.textContent = 'Legend saved for everyone. Score labels and colors are updated across the app.';
      saved.className = 'modal-status good';
    } catch(e){
      status.textContent = e.message;
      status.className = 'modal-status bad';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save legend';
    }
  });
  document.getElementById('resetScoreConfig').addEventListener('click', async () => {
    const resetBtn = document.getElementById('resetScoreConfig');
    resetBtn.disabled = true;
    resetBtn.textContent = 'Resetting…';
    try{
      const defaults = DEFAULT_SCORE_BANDS.map(b => ({...b}));
      await setAppSetting(SCORE_CONFIG_KEY, JSON.stringify(defaults));
      SCORE_BANDS = defaults;
      renderScoreGuideView();
      const saved = document.getElementById('scoreConfigStatus');
      saved.textContent = 'Default legend restored for everyone.';
      saved.className = 'modal-status good';
    } catch(e){
      const status = document.getElementById('scoreConfigStatus');
      status.textContent = e.message;
      status.className = 'modal-status bad';
      resetBtn.disabled = false;
      resetBtn.textContent = 'Reset defaults';
    }
  });
}

// ---------- detail panel (campaign card click) ----------
let activeTab = 'overview';

function sparkSVG(trend){
  if(!trend || trend.length===0) return '';
  const w = 400, h = 70, pad = 4;
  const max = Math.max(...trend, 1);
  const step = (w - pad*2) / (trend.length - 1 || 1);
  const pts = trend.map((v,i) => `${(pad+i*step).toFixed(1)},${(h - pad - (v/max)*(h-pad*2)).toFixed(1)}`).join(' ');
  const areaPts = `${pad},${h-pad} ` + pts + ` ${w-pad},${h-pad}`;
  return `
  <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <polygon points="${areaPts}" fill="#3b6ef6" opacity="0.08"></polygon>
    <polyline points="${pts}" fill="none" stroke="#3b6ef6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline>
  </svg>`;
}

function insightNote(card){
  if(card.status.label === 'Scaling') return `Spend has ramped up over the back half of the flight — recent daily spend is running ahead of the earlier period, usually a sign LinkedIn's delivery system is finding efficient audience segments.`;
  if(card.status.label === 'Slowing') return `Daily spend has cooled off versus the start of the flight. Worth checking budget pacing or audience saturation.`;
  if(card.status.label === 'Paused') return `No meaningful spend in the most recent days — this ad set has effectively gone dark.`;
  return `Spend has stayed fairly consistent day to day across the flight.`;
}

let adsetPreviewName = null;
let detailReturnView = 'campaigns';

function openPanel(id, previewName=null, returnView='campaigns'){
  state.selectedId = id;
  activeTab = 'overview';
  currentView = 'adset-detail';
  adsetPreviewName = previewName;
  detailReturnView = returnView;
  document.querySelector('.toolbar').style.display = 'none';
  document.querySelectorAll('.nav-item[data-view]').forEach(el => el.classList.remove('active'));
  renderAdSetDetailView();
  document.getElementById('content').scrollTop = 0;
}

function closePanel(){
  if(currentView !== 'adset-detail') return;
  currentView = detailReturnView;
  document.querySelector('.toolbar').style.display = 'flex';
  const navEl = document.querySelector(`.nav-item[data-view="${detailReturnView}"]`);
  if(navEl) navEl.classList.add('active');
  const viewEl = document.querySelector(`.view-item[data-view="${detailReturnView}"]`);
  if(viewEl) viewEl.classList.add('active');
  renderMain();
}

// ---------- full-page ad set detail view ----------
function renderAdThumbLarge(ad, isSelected){
  const img = ad.imageUrl;
  const thumbStyle = img
    ? `background-image:url('${img.replace(/'/g,"\\'")}');background-size:contain;background-position:center;background-repeat:no-repeat;`
    : `background:linear-gradient(135deg,#0f1420,#1c2544 60%, #2a3766);`;
  const dotColor = ad.status==='Active' ? '#0f9d58' : ad.status==='Deleted' ? '#c23b3b' : '#b8790a';
  const dest = ad.url ? shortUrl(ad.url) : '—';
  const scoreInfo = computeAdScore(ad);
  const safeName = (ad.name||'').replace(/"/g,'&quot;');
  const label = adLabel(ad);
  const count = COMMENT_COUNTS[ad.name] || 0;
  const commentCls = ad.feedbackApplied ? 'resolved' : (count ? 'has-comments' : '');
  const commentLabel = ad.feedbackApplied ? `✓ Resolved${count?` (${count})`:''}` : (count ? `💬 ${count} comment${count>1?'s':''}` : '💬 Add feedback');
  return `
  <div class="ad-thumb ad-thumb-lg${isSelected ? ' selected-preview' : ''}">
    <div class="ad-thumb-img${img ? '' : ' no-image'}" data-select-preview="${safeName}" ${img ? `data-creative-image="${escapeHTML(img)}"` : ''} title="Click to preview in detail" style="${thumbStyle}">
      <span class="dot" style="background:${dotColor}"></span>
      <span class="creative-image-message">Image unavailable — edit image</span>
      ${img ? '' : '<span class="creative-no-image-label">No image added</span>'}
      <div class="compare-check ${isCompareSelected('ad', ad.name) ? 'checked' : ''}" data-compare-ad-toggle="${safeName}" title="Select to compare"></div>
      ${scoreInfo.score !== null ? `<span class="score-badge ${scoreInfo.cls}" style="background:${scoreInfo.color}">${scoreInfo.score}</span>` : ''}
      ${isSelected ? `<span class="preview-badge">Previewing</span>` : ''}
    </div>
    <div class="ad-thumb-body">
      <div class="ad-thumb-name" title="${(label||'').replace(/"/g,'&quot;')}">${label}</div>
      <div class="ad-thumb-stats"><span>${fmtMoney(ad.spend,0)}</span><span><b>${fmtPct(ad.ctr)}</b> CTR</span></div>
      ${ad.url ? `<a class="ad-thumb-dest" href="${ad.url}" target="_blank" rel="noopener" title="${ad.url.replace(/"/g,'&quot;')}">↗ ${dest}</a>` : '<div class="ad-thumb-dest">No destination URL</div>'}
      <div class="ad-thumb-actions" style="margin-top:6px;" data-ad-actions>
        <button type="button" class="ask-ai-button" data-ai-ad="${safeName}">✦ Ask AI</button>
        <button type="button" class="edit-preview-link edit-preview-button" data-ad="${safeName}">Edit preview</button>
        <button type="button" class="edit-preview-link action-link-button" data-rename-ad="${safeName}">Rename</button>
        <button type="button" class="comment-btn action-comment-button ${commentCls}" data-fb-ad="${safeName}">${commentLabel}</button>
      </div>
    </div>
  </div>`;
}

function renderAdSetDetailView(){
  const card = CARDS.find(c => c.id === state.selectedId);
  if(!card){ closePanel(); return; }
  const topAd = card.top_ad || {};
  const visibleAds = card.ads.filter(a => passesStatusFilter(a.status));
  const hiddenCount = card.ads.length - visibleAds.length;
  const withComments = card.ads.filter(a => (COMMENT_COUNTS[a.name]||0) > 0).length;
  const resolvedCount = card.ads.filter(a => a.feedbackApplied).length;

  const previewAd = (adsetPreviewName && (AD_INDEX[adsetPreviewName] || card.ads.find(a => a.name === adsetPreviewName))) || topAd;
  const isTopAd = !adsetPreviewName || adsetPreviewName === topAd.name;
  const scoreInfo = computeAdScore(previewAd);
  const brief = adsetBriefFor(card.campaign, card.name);
  const safeCampaign = escapeHTML(card.campaign);
  const safeAdset = escapeHTML(card.name);

  const html = `
  <div class="adset-page">
    <div class="adset-back" id="adsetBackBtn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      Back to ${detailReturnView === 'ads-gallery' ? 'Ads Gallery' : 'campaigns'}
    </div>
    <div class="adset-head">
      <div class="adset-head-top">
        <h1>${adsetLabel(card)}</h1>
        <button type="button" class="ask-ai-button" data-ai-adset data-campaign="${safeCampaign}" data-adset="${safeAdset}">✦ Ask AI</button>
        <button type="button" class="edit-preview-link action-link-button" data-rename-adset data-campaign="${safeCampaign}" data-adset="${safeAdset}">Rename ad set</button>
        <button type="button" class="edit-preview-link action-link-button" data-adset-brief data-campaign="${safeCampaign}" data-adset="${safeAdset}">${brief ? 'Edit brief' : 'Add brief'}</button>
        <span class="status-pill ${card.perf.cls}"><span class="dot"></span>${card.perf.label}</span>
      </div>
      <div class="adset-head-meta">${card.campaignShort} <span class="meta-dot"></span> ${card.n_ads} creatives <span class="meta-dot"></span> ${card.start} – ${card.end}</div>
      ${objectivePickerHTML(card.campaign, card.objective, true)}
    </div>
    <section class="adset-brief-section">
      <div>
        <div class="brief-section-label">Campaign brief</div>
        ${brief ? `<div class="brief-section-copy">${escapeHTML(brief).replace(/\n/g, '<br>')}</div>` : '<div class="brief-section-empty">No brief has been added for this ad set yet.</div>'}
      </div>
      <button type="button" class="brief-section-action" data-adset-brief data-campaign="${safeCampaign}" data-adset="${safeAdset}">${brief ? 'Edit brief' : 'Add brief'}</button>
    </section>

    <div class="adset-stats-row">
      <div class="kpi"><div class="kpi-label">Spend</div><div class="kpi-value">${fmtMoney(card.spend,0)}</div></div>
      <div class="kpi"><div class="kpi-label">Impressions</div><div class="kpi-value">${fmtInt(card.impressions)}</div></div>
      <div class="kpi"><div class="kpi-label">Clicks</div><div class="kpi-value">${fmtInt(card.clicks)}</div></div>
      <div class="kpi"><div class="kpi-label">CTR</div><div class="kpi-value">${fmtPct(card.ctr)}</div></div>
      <div class="kpi"><div class="kpi-label">Leads</div><div class="kpi-value" style="${card.leads>0?'color:var(--green);':''}">${fmtInt(card.leads)}</div></div>
    </div>

    <div class="adset-grid">
      <div class="adset-main">
        <div class="adset-section">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
            <h2 style="margin:0;">${state.statusFilter} creatives (${visibleAds.length}${hiddenCount>0 ? ', '+hiddenCount+' hidden by filter':''})</h2>
            <div style="display:flex;gap:10px;font-size:11.5px;color:var(--text-3);font-weight:600;">
              ${withComments ? `<span>💬 ${withComments} with feedback</span>` : ''}
              ${resolvedCount ? `<span style="color:var(--green);">✓ ${resolvedCount} resolved</span>` : ''}
            </div>
          </div>
          <div class="ad-thumb-grid-3">
            ${visibleAds.map(a => renderAdThumbLarge(a, a.name === previewAd.name)).join('') || '<div class="empty-note">No creatives match the current filter. Try the Filter dropdown in the toolbar.</div>'}
          </div>
        </div>
      </div>
      <div class="adset-side">
        <div class="adset-section">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <h2 style="margin:0;">${isTopAd ? 'Top-Performing Creative' : 'Selected Creative'}</h2>
            ${isTopAd ? '' : `<span class="edit-preview-link" id="resetPreviewLink">↩ Top performer</span>`}
          </div>
          ${renderLiPreview(previewAd, card.name)}
          ${scoreSummaryHTML(scoreInfo)}
        </div>
        <div class="adset-section">
          <h2>Budget &amp; Cost</h2>
          <div class="metric-grid">
            <div class="metric-box"><div class="m-label">Daily Budget</div><div class="m-value">${card.dailyBudget?fmtMoney(card.dailyBudget,0):'—'}</div></div>
            <div class="metric-box"><div class="m-label">Cost per Lead</div><div class="m-value">${card.leads>0?fmtMoney(card.cpl,0):'—'}</div></div>
          </div>
        </div>
        <div class="adset-section">
          <h2>Daily Spend — last ${card.trend.length} active days</h2>
          <div class="spark-wrap">
            <div class="sw-label">${fmtMoney(card.spend,0)} spent · trend is ${card.status.label.toLowerCase()}</div>
            ${sparkSVG(card.trend)}
          </div>
          <div class="empty-note" style="margin-top:10px;">${insightNote(card)}</div>
        </div>
        <div class="adset-section">
          <h2>Targeting</h2>
          <div class="empty-note">Audience targeting criteria isn't included in the LinkedIn performance export — only spend and engagement metrics are. Pull this from the Campaign Manager audience tab to fill it in here.</div>
        </div>
      </div>
    </div>
  </div>`;

  document.getElementById('content').innerHTML = html;
  document.querySelectorAll('[data-rename-adset]').forEach(el => {
    el.addEventListener('click', () => openAdsetRenameEditor(el.getAttribute('data-campaign'), el.getAttribute('data-adset')));
  });
  document.getElementById('adsetBackBtn').addEventListener('click', closePanel);
  document.querySelectorAll('[data-select-preview]').forEach(el => {
    el.addEventListener('click', () => {
      adsetPreviewName = el.getAttribute('data-select-preview');
      renderAdSetDetailView();
      const sidebar = document.querySelector('.adset-side');
      if(sidebar) sidebar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  const resetLink = document.getElementById('resetPreviewLink');
  if(resetLink) resetLink.addEventListener('click', () => { adsetPreviewName = null; renderAdSetDetailView(); });
  document.querySelectorAll('[data-compare-ad-toggle]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); toggleCompare('ad', el.getAttribute('data-compare-ad-toggle')); });
  });
}

// The gallery is rebuilt with innerHTML. Bind each action directly whenever a
// card appears so parent-card clicks, nested labels, and browser differences
// cannot swallow Edit preview, Rename, Comment, or Ask AI.
function runAdAction(trigger){
  if(trigger.hasAttribute('data-ai-ad')){
    const ad = AD_INDEX[trigger.getAttribute('data-ai-ad')];
    if(ad) runAIAnalysis(aiPayloadForAd(ad));
  } else if(trigger.hasAttribute('data-ai-adset')){
    const campaign = trigger.getAttribute('data-campaign');
    const adset = trigger.getAttribute('data-adset');
    const card = CARDS.find(item => item.campaign === campaign && item.name === adset);
    if(card) runAIAnalysis(aiPayloadForAdset(card));
  } else if(trigger.hasAttribute('data-ad')){
    openAdPreviewEditor(trigger.getAttribute('data-ad'));
  } else if(trigger.hasAttribute('data-rename-ad')){
    openRenameEditor(trigger.getAttribute('data-rename-ad'));
  } else {
    openAdFeedbackEditor(trigger.getAttribute('data-fb-ad'));
  }
}
function wireAdActionButtons(root=document){
  const selector='[data-ai-ad], [data-ai-adset], [data-ad-actions] [data-ad], [data-ad-actions] [data-rename-ad], [data-ad-actions] [data-fb-ad]';
  root.querySelectorAll(selector).forEach(trigger=>{
    if(trigger.dataset.adActionBound==='true')return;
    trigger.dataset.adActionBound='true';
    trigger.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      runAdAction(trigger);
    });
  });
}
const contentActionsRoot=document.getElementById('content');
const adActionObserver=new MutationObserver(()=>wireAdActionButtons(contentActionsRoot));
adActionObserver.observe(contentActionsRoot,{childList:true,subtree:true});
wireAdActionButtons(contentActionsRoot);
document.getElementById('content').addEventListener('change', async (e) => {
  if(!(e.target instanceof HTMLInputElement) || !e.target.matches('[data-campaign-objectives] input[type="checkbox"]')) return;
  const picker = e.target.closest('[data-campaign-objectives]');
  const campaignName = picker.getAttribute('data-campaign-objectives');
  const objectives = [...picker.querySelectorAll('input:checked')].map(input => input.value);
  const inputs = [...picker.querySelectorAll('input')];
  const state = picker.querySelector('.objective-save-state');
  inputs.forEach(input => { input.disabled = true; });
  state.textContent = 'Saving…';
  try{
    await saveCampaignObjectives(campaignName, objectives);
    CARDS = buildCards(DATA.campaigns);
    renderMain();
  } catch(error){
    inputs.forEach(input => { input.disabled = false; });
    state.textContent = 'Could not save';
    alert(error.message || 'Could not save the campaign objectives.');
  }
});

document.getElementById('overlay').addEventListener('click', closePanel);
document.getElementById('settingsOverlay').addEventListener('click', (e) => {
  if(e.target.id === 'settingsOverlay') closeSettings();
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){ closeMobileNav(); closePanel(); closeSettings(); closeAmplifyConnection(); closeAmplifyParticipant(); closeRecoveredPoints(); closeLockedModal(); closeAdPreviewEditor(); closeAdFeedbackEditor(); closeAdBigPreview(); closeCompareModal(); closeAIAnalysis(); }
});

// ---------- toolbar behavior ----------
document.getElementById('searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderMain();
});

// ---------- auth (shared login for growth@apertera.com, session per browser) ----------
const AUTH_SESSION_KEY = 'apertera_auth_session';

function getStoredSession(){
  try{
    const s = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
    return (s && s.access_token && s.expires_at) ? s : null;
  } catch(e){ return null; }
}
function storeSession(s){ localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(s)); }
function clearSession(){ localStorage.removeItem(AUTH_SESSION_KEY); }

async function refreshSession(refresh_token){
  try{
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token })
    });
    const data = await res.json();
    if(!res.ok || !data.access_token) return null;
    const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
    storeSession(session);
    return session;
  } catch(e){ return null; }
}

async function ensureAuthed(){
  const s = getStoredSession();
  if(s && s.expires_at > Date.now() + 60000) return true;
  if(s && s.refresh_token && await refreshSession(s.refresh_token)) return true;
  clearSession();
  return false;
}

function showLogin(){ document.getElementById('loginScreen').style.display = 'flex'; }
function hideLogin(){ document.getElementById('loginScreen').style.display = 'none'; }

async function doLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const statusEl = document.getElementById('loginStatus');
  if(!email || !password){ statusEl.textContent = 'Enter email and password.'; statusEl.className = 'modal-status bad'; return; }
  statusEl.textContent = 'Signing in…'; statusEl.className = 'modal-status';
  try{
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if(!res.ok || !data.access_token) throw new Error(data.error_description || data.msg || 'Invalid email or password.');
    storeSession({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 });
    statusEl.textContent = '';
    hideLogin();
    startApp();
  } catch(e){
    statusEl.textContent = e.message; statusEl.className = 'modal-status bad';
  }
}
document.getElementById('loginSubmit').addEventListener('click', doLogin);
document.getElementById('loginPassword').addEventListener('keydown', (e) => { if(e.key === 'Enter') doLogin(); });

function signOut(){ clearSession(); location.reload(); }
document.getElementById('signOutBtn').addEventListener('click', signOut);

// ---------- init ----------
async function startApp(){
  populateSortSelect();
  await Promise.all([loadSharedScoreBands(), loadCampaignObjectives(), loadAdsetDisplayNames(), loadAdsetBriefs(), loadFeedbackHistory()]);
  await loadData();
}
(async () => {
  if(await ensureAuthed()) startApp();
  else showLogin();
})();
