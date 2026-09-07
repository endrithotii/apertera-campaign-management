const SUPABASE_URL = 'https://dvxtykjmabmdlltsfjyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eHR5a2ptYWJtZGxsdHNmanl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTQwMjgsImV4cCI6MjA3NzU5MDAyOH0.ax9ncCsFscpvNfNHX_fK1TVBWlle4npg6AWTChuqDWg';
const LIKERS_AGENTS = ['5607487070933342','5823161062365923'];
const COMMENTERS_AGENT = '1580560015599391';
const STRICT_CUTOFF = new Date('2026-08-24T00:00:00Z').getTime();
const MANUAL_OVERRIDES = new Map([
  ['linkedin.com/in/taylor-harrison-roy-97baa5189|linkedin.com/feed/update/urn:li:activity:7488969148270796800',5],
  ['linkedin.com/in/kathrin-botkin|linkedin.com/feed/update/urn:li:activity:7488962867103191040',5],
  ['linkedin.com/in/honey-sood|linkedin.com/feed/update/urn:li:activity:7485406767972124624',15]
]);

const APIFY_BASE = 'https://api.apify.com/v2';

function normalizeUrl(value='') {
  return String(value).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('?')[0].replace(/\/$/,'');
}
function cleanText(value='', max=300) {
  return String(value || '').trim().slice(0, max);
}
function cleanLinkedInProfileUrl(value='') {
  const raw = cleanText(value, 800);
  if(!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try{ parsed = new URL(withProtocol); }catch{ return ''; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./,'');
  if(host !== 'linkedin.com') return '';
  const path = parsed.pathname.replace(/\/+$/,'');
  if(!/^\/in\/[^/]+/i.test(path) && !/^\/company\/[^/]+/i.test(path)) return '';
  return `https://www.linkedin.com${path}/`;
}
function activityId(value=''){return String(value).match(/(?:activity[:\/-]|urn:li:(?:ugcPost|activity):)(\d{10,})/i)?.[1]||'';}
async function authenticate(authorization) {
  if (!authorization?.startsWith('Bearer ')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {headers:{apikey:SUPABASE_ANON_KEY,Authorization:authorization}});
  return response.ok ? response.json() : null;
}
function restHeaders(authorization, prefer='') {
  return {apikey:SUPABASE_ANON_KEY,Authorization:authorization,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})};
}
async function db(path, authorization, options={}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {...options,headers:{...restHeaders(authorization,options.prefer),...(options.headers||{})}});
  if (!response.ok) throw new Error(`Database ${response.status}: ${(await response.text()).slice(0,500)}`);
  const text=await response.text(); return text?JSON.parse(text):null;
}
function participantDirectory(rows) {
  const byUrl=new Map(), byName=new Map();
  rows.forEach(row=>{
    [row.profile_url,...(Array.isArray(row.aliases)?row.aliases:[])].forEach(url=>{const key=normalizeUrl(url);if(key)byUrl.set(key,row);});
    if(row.full_name)byName.set(row.full_name.toLowerCase().replace(/[^a-z0-9]/g,''),row);
  });
  return {resolve(url,name){return byUrl.get(normalizeUrl(url))||byName.get(String(name||'').toLowerCase().replace(/[^a-z0-9]/g,''))||null;}};
}
function scorePost(item, participant, config) {
  const postUrl=item.linkedinUrl||item.shareLinkedinUrl||'';
  const override=MANUAL_OVERRIDES.get(`${normalizeUrl(participant.profile_url)}|${normalizeUrl(postUrl)}`);
  if(override!=null)return override;
  const repost=item.repost||null;
  const own=String(item.content||''); const shared=String(repost?.content||'');
  const sharedUrl=String(repost?.linkedinUrl||'');
  if(!(own+' '+shared).toLowerCase().includes('apertera')&&!normalizeUrl(sharedUrl).includes('linkedin.com/company/apertera'))return 0;
  if(!repost)return config.post_points;
  const timestamp=new Date(item.postedAt?.date||0).getTime();
  if(timestamp&&timestamp>=STRICT_CUTOFF)return config.repost_points;
  return own.replace(/#\S+/g,'').replace(/\s+/g,' ').trim().length>2?config.post_points:config.repost_points;
}
function mapPosts(items,directory,config) {
  const posts=[],unmatched=[];
  for(const item of items||[]){
    if(!item||item.type!=='post')continue;
    const author=item.author||{}; const url=item.linkedinUrl||item.shareLinkedinUrl;
    const person=directory.resolve(author.linkedinUrl,author.name); if(!url||!person){if(author.type==='profile')unmatched.push(author.name||author.linkedinUrl||'Unknown');continue;}
    const repost=item.repost||null; const content=`${item.content||''} ${repost?.content||''}`.trim();
    posts.push({post_key:normalizeUrl(url),participant_key:person.profile_key,post_url:url,full_name:person.full_name,like_count:Number(item.engagement?.likes||0),comment_count:Number(item.engagement?.comments||0),post_date_label:item.postedAt?.postedAgoShort||'',content,own_content:item.content||'',shared_post_url:repost?.linkedinUrl||'',action:repost?`${person.full_name} reposted this`:'Post',is_repost:!!repost,has_apertera:content.toLowerCase().includes('apertera')||normalizeUrl(repost?.linkedinUrl).includes('linkedin.com/company/apertera'),posted_at:item.postedAt?.date||null,score:scorePost(item,person,config),source:'apify_api',raw:item});
  }
  const uniquePosts=[...new Map(posts.map(post=>[post.post_key,post])).values()];
  return {posts:uniquePosts,unmatched:[...new Set(unmatched)]};
}
async function latestPhantomResult(agentId,key){
  const list=await fetch(`https://api.phantombuster.com/api/v2/containers/fetch-all?agentId=${encodeURIComponent(agentId)}`,{headers:{'X-Phantombuster-Key':key}});
  if(!list.ok)throw new Error(`PhantomBuster agent ${agentId} returned ${list.status}`);
  const body=await list.json(); const containers=Array.isArray(body)?body:(body.containers||[]);
  const latest=containers.filter(c=>['finished','success'].includes(String(c.status).toLowerCase())).sort((a,b)=>new Date(b.endedAt||b.launchDate||0)-new Date(a.endedAt||a.launchDate||0))[0];
  if(!latest)return [];
  const result=await fetch(`https://api.phantombuster.com/api/v2/containers/fetch-result-object?id=${encodeURIComponent(latest.id)}`,{headers:{'X-Phantombuster-Key':key}});
  if(!result.ok)throw new Error(`PhantomBuster result ${latest.id} returned ${result.status}`);
  const json=await result.json(); const value=typeof json.resultObject==='string'?JSON.parse(json.resultObject):json.resultObject;
  return Array.isArray(value)?value:[];
}
function mapInteractions(rows,action,directory,points){
  const interactions=[]; let unmatched=0;
  for(const row of rows||[]){
    if(!row||row.error)continue; const url=row.profileLink||row.profileUrl; const post=row.postUrl; const person=directory.resolve(url,row.name||row.fullName);
    if(!url||!post||!person){if(url&&post)unmatched++;continue;}
    interactions.push({interaction_key:`${person.profile_key}|${normalizeUrl(post)}|${action}`,participant_key:person.profile_key,profile_url:person.profile_url,full_name:person.full_name,post_url:post,action,occurred_at:row.timestamp||null,score:points,source:'phantombuster_api',raw:row});
  }
  const uniqueInteractions=[...new Map(interactions.map(item=>[item.interaction_key,item])).values()];
  return {interactions:uniqueInteractions,unmatched};
}
function mapApifyInteractions(rows,action,directory,points,existingRows=[]){
  const existing=new Map(existingRows.map(row=>[`${row.participant_key}|${activityId(row.post_url)||normalizeUrl(row.post_url)}|${row.action}`,row.interaction_key]));
  const interactions=[],unmatched=[];
  for(const row of rows||[]){
    const actor=row.actor||{};if(actor.type&&actor.type!=='profile')continue;
    const post=row.query?.post||row.postUrl||'';const person=directory.resolve(actor.linkedinUrl,actor.name);
    if(!post||!person){if(actor.name||actor.linkedinUrl)unmatched.push(actor.name||actor.linkedinUrl);continue;}
    const matchKey=`${person.profile_key}|${activityId(post)||normalizeUrl(post)}|${action}`;
    interactions.push({interaction_key:existing.get(matchKey)||`${person.profile_key}|${normalizeUrl(post)}|${action}`,participant_key:person.profile_key,profile_url:person.profile_url,full_name:person.full_name,post_url:post,action,occurred_at:row.createdAt||row.timestamp?.date||null,score:points,source:`apify_${action}s`,raw:row});
  }
  return {interactions:[...new Map(interactions.map(item=>[item.interaction_key,item])).values()],unmatched:[...new Set(unmatched)]};
}
function mapApifyReshares(rows,directory,config,existingRows=[]){
  const existing=new Map(existingRows.map(row=>[`${row.participant_key}|${activityId(row.post_url)}`,row.post_key]).filter(x=>x[0].split('|')[1]));
  const posts=[],unmatched=[];
  for(const row of rows||[]){
    const actor=row.reposter||{};const person=directory.resolve(actor.profile_url,actor.name);const url=row.url||'';const original=row.reshared_post?.url||row._metadata?.post_url||'';
    if(!url||!person){if(actor.name||actor.profile_url)unmatched.push(actor.name||actor.profile_url);continue;}
    const key=existing.get(`${person.profile_key}|${row.id||activityId(url)}`)||normalizeUrl(url);
    posts.push({post_key:key,participant_key:person.profile_key,post_url:url,full_name:person.full_name,like_count:0,comment_count:0,post_date_label:row.timestamp?.relative||'',content:row.reshared_post?.text||'',own_content:'',shared_post_url:original,action:`${person.full_name} reposted this`,is_repost:true,has_apertera:true,posted_at:row.timestamp?.date||null,score:config.repost_points,source:'apify_reposts',raw:row});
  }
  return {posts:[...new Map(posts.map(item=>[item.post_key,item])).values()],unmatched:[...new Set(unmatched)]};
}
async function runApifyTask(taskId,token){
  if(!taskId)return [];
  const r=await fetch(`${APIFY_BASE}/actor-tasks/${encodeURIComponent(taskId)}/run-sync-get-dataset-items?clean=true&format=json`,{method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json'},body:'{}'});
  if(!r.ok)throw new Error(`Apify task ${taskId} returned ${r.status}: ${(await r.text()).slice(0,220)}`);const data=await r.json();if(!Array.isArray(data))throw new Error(`Apify task ${taskId} did not return a JSON array.`);return data;
}
const AMPLIFY_SOURCES=['posts','reposts','likes','comments'];
const TASK_COLUMNS={posts:'posts_task_id',reposts:'reposts_task_id',likes:'likes_task_id',comments:'comments_task_id'};
function normalizeImportItems(value){
  if(Array.isArray(value))return value;
  for(const key of ['items','data','results','posts'])if(Array.isArray(value?.[key]))return value[key];
  throw new Error('The imported file must contain an array of Apify result rows.');
}
async function fetchConfiguredApifySource(authorization,source){
  if(!AMPLIFY_SOURCES.includes(source))throw new Error('Choose posts, reposts, likes, or comments.');
  const saved=await db('rpc/amplify_get_apify_bundle',authorization,{method:'POST',body:'{}'});
  const row=saved?.[0]||{};const token=process.env.APIFY_API_TOKEN||row.api_token;
  const taskId=row[TASK_COLUMNS[source]]||(source==='posts'?process.env.APIFY_TASK_ID:'');
  if(!token)throw new Error('The Apify API token is not configured.');
  if(!taskId)throw new Error(`The Apify ${source} task is not configured.`);
  return runApifyTask(taskId,token);
}

function cellText(value){
  if(value==null)return '';
  if(value instanceof Date)return value.toISOString();
  if(typeof value==='object')return String(value.text||value.result||value.hyperlink||'');
  return String(value).trim();
}
function sheetObjects(sheet){
  if(!sheet)return [];
  const headers=[]; sheet.getRow(1).eachCell({includeEmpty:true},(cell,col)=>headers[col]=cellText(cell.value));
  const rows=[]; sheet.eachRow((row,index)=>{if(index===1)return;const item={};let found=false;headers.forEach((key,col)=>{if(!key)return;const value=row.getCell(col).value;if(value!=null&&cellText(value)!=='')found=true;item[key]=cellText(value);});if(found)rows.push(item);});
  return rows;
}
function expandDottedRow(row){
  const result={};
  for(const [key,value] of Object.entries(row||{})){
    const parts=String(key).split('.');let cursor=result;
    parts.forEach((part,index)=>{if(index===parts.length-1)cursor[part]=value;else cursor=cursor[part]||(cursor[part]={});});
  }
  return result;
}
async function parseWorkbook(base64){
  if(!base64)throw new Error('The spreadsheet file is empty.');
  const {default:ExcelJS}=await import('exceljs'); const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(base64,'base64'));
  return {
    people:sheetObjects(workbook.getWorksheet('Employee URLs')),
    posts:sheetObjects(workbook.getWorksheet('PhantomBuster Data')),
    interactions:sheetObjects(workbook.getWorksheet('Apertera Interactions')),
    bonuses:sheetObjects(workbook.getWorksheet('Marketing Bonus'))
  };
}
async function parseSourceWorkbook(base64){
  if(!base64)throw new Error('The spreadsheet file is empty.');
  const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(base64,'base64'));
  if(!workbook.worksheets[0])throw new Error('The spreadsheet has no worksheets.');
  return sheetObjects(workbook.worksheets[0]).map(expandDottedRow);
}
async function importTracker(data,authorization,user){
  const people=data.people.map(row=>{const url=row['LinkedIn Profile URL'];const aliases=String(row['Phantom Profile URL']||'').split(/\s+/).filter(Boolean);return {profile_key:normalizeUrl(url),profile_url:url,full_name:row['Full Name'],department:row.Department||'',aliases,active:true,updated_at:new Date().toISOString()};}).filter(x=>x.profile_key&&x.full_name);
  if(people.length)await db('amplify_participants?on_conflict=profile_key',authorization,{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(people)});
  const participants=await db('amplify_participants?select=profile_key,profile_url,full_name,aliases',authorization); const directory=participantDirectory(participants);
  const posts=data.posts.map(row=>{const person=directory.resolve(row['Profile URL'],row['Full Name']);const url=row['Post URL'];if(!person||!url)return null;return {post_key:normalizeUrl(url),participant_key:person.profile_key,post_url:url,full_name:person.full_name,like_count:Number(row['Like Count']||0),comment_count:Number(row['Comment Count']||0),post_date_label:row['Post Date']||'',content:row['Post Content']||'',own_content:row['Own Content']||'',shared_post_url:row['Shared Post URL']||'',action:row.Action||'Post',is_repost:String(row['Is Repost']).toUpperCase()==='YES',has_apertera:String(row['Has Apertera']).toUpperCase()==='YES',posted_at:row['Post Timestamp']||null,score:Number(row.Score||0),source:'tracker_xlsx',raw:row};}).filter(Boolean);
  const interactions=data.interactions.map(row=>{const person=directory.resolve(row['Profile URL'],row['Full Name']);const post=row['Post URL'],action=String(row.Action||'').toLowerCase();if(!person||!post||!action)return null;return {interaction_key:`${person.profile_key}|${normalizeUrl(post)}|${action}`,participant_key:person.profile_key,profile_url:person.profile_url,full_name:person.full_name,post_url:post,action,occurred_at:row.Timestamp||null,score:Number(row.Score||0),source:'tracker_xlsx',raw:row};}).filter(Boolean);
  const bonuses=data.bonuses.map(row=>{const person=directory.resolve(row['Profile URL'],row['Full Name']);const reason=row.Reason||"Marketing's Pick";if(!person||!Number(row['Bonus Points']))return null;return {participant_key:person.profile_key,profile_url:person.profile_url,full_name:person.full_name,reason,points:Number(row['Bonus Points']),awarded_at:row['Awarded Date']||null,awarded_by:user.id};}).filter(Boolean);
  if(posts.length)await db('amplify_posts?on_conflict=post_key',authorization,{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(posts)});
  if(interactions.length)await db('amplify_interactions?on_conflict=interaction_key',authorization,{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(interactions)});
  if(bonuses.length)await db('amplify_bonuses?on_conflict=participant_key,reason',authorization,{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(bonuses)});
  return {people:people.length,posts:posts.length,interactions:interactions.length,bonuses:bonuses.length};
}

export default async function handler(request,response){
  if(request.method!=='POST')return response.status(405).json({error:'Method not allowed.'});
  const authorization=request.headers.authorization||''; const user=await authenticate(authorization);
  if(!user)return response.status(401).json({error:'Your session has expired. Please sign in again.'});
  const mode=request.body?.mode||''; let runId=null;
  try{
    if(request.body?.mode==='connection-status'){
      const status=await db('rpc/amplify_apify_status',authorization,{method:'POST',body:'{}'});return response.status(200).json(status?.[0]||{provider:'apify',task_id:'RS6sriGQCVOsTrDUW',connected:false});
    }
    if(request.body?.mode==='save-connection'){
      const saved=await db('rpc/amplify_save_apify_connection',authorization,{method:'POST',body:JSON.stringify({p_task_id:request.body.taskId,p_token:request.body.apiToken})});return response.status(200).json({...saved?.[0],message:'Apify connection saved securely.'});
    }
    if(mode==='add-participant'){
      const profileUrl=cleanLinkedInProfileUrl(request.body.profileUrl);
      const fullName=cleanText(request.body.fullName,160);
      const department=cleanText(request.body.department,120);
      const aliases=Array.isArray(request.body.aliases)?request.body.aliases.map(cleanLinkedInProfileUrl).filter(Boolean):[];
      if(!profileUrl)return response.status(400).json({error:'Enter a valid LinkedIn profile URL.'});
      if(!fullName)return response.status(400).json({error:'Enter the employee full name.'});
      const profileKey=normalizeUrl(profileUrl);
      const uniqueAliases=[...new Set(aliases.map(normalizeUrl).filter(key=>key&&key!==profileKey))].map(key=>`https://${key}/`);
      await db('amplify_participants?on_conflict=profile_key',authorization,{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify({profile_key:profileKey,profile_url:profileUrl,full_name:fullName,department,aliases:uniqueAliases,active:true,updated_at:new Date().toISOString()})});
      return response.status(200).json({message:`${fullName} was added to the Amplify participant list.`,profileKey});
    }
    if(mode==='workbook'){
      const run=await db('amplify_sync_runs',authorization,{method:'POST',prefer:'return=representation',body:JSON.stringify({source:'tracker_xlsx_import',requested_by:user.id})});runId=run?.[0]?.id;
      const counts=await importTracker(await parseWorkbook(request.body.fileBase64),authorization,user);const message=`Imported ${counts.people} participants, ${counts.posts} posts, ${counts.interactions} interactions and ${counts.bonuses} bonuses from ${request.body.fileName||'workbook'}.`;
      if(runId)await db(`amplify_sync_runs?id=eq.${runId}`,authorization,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({finished_at:new Date().toISOString(),status:'success',posts_added:counts.posts,interactions_added:counts.interactions,message})});
      await db('amplify_config?id=eq.true',authorization,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()})});return response.status(200).json({message,...counts});
    }
    if(!['sync-source','import-source','import-source-workbook'].includes(mode))return response.status(400).json({error:'Choose one Amplify source to sync or import.'});
    const source=String(request.body.source||'').toLowerCase();if(!AMPLIFY_SOURCES.includes(source))return response.status(400).json({error:'Choose posts, reposts, likes, or comments.'});
    const participants=await db('amplify_participants?select=profile_key,profile_url,full_name,aliases',authorization);
    const config=(await db('amplify_config?select=*&id=eq.true',authorization))[0]; const directory=participantDirectory(participants);
    const runSource=mode==='sync-source'?`apify_${source}_task`:`${source}_${mode==='import-source'?'json':'xlsx'}_import`;
    const run=await db('amplify_sync_runs',authorization,{method:'POST',prefer:'return=representation',body:JSON.stringify({source:runSource,requested_by:user.id})}); runId=run?.[0]?.id;
    let items;if(mode==='sync-source')items=await fetchConfiguredApifySource(authorization,source);else if(mode==='import-source-workbook')items=await parseSourceWorkbook(request.body.fileBase64);else items=normalizeImportItems(request.body.items);
    const existingPostRows=await db('amplify_posts?select=post_key,participant_key,post_url',authorization);const existing=new Set(existingPostRows.map(x=>x.post_key));
    const mapped=source==='posts'?mapPosts(items,directory,config):{posts:[],unmatched:[]};const reshares=source==='reposts'?mapApifyReshares(items,directory,config,existingPostRows):{posts:[],unmatched:[]};const allPosts=[...new Map([...mapped.posts,...reshares.posts].map(item=>[item.post_key,item])).values()];
    if(allPosts.length)await db('amplify_posts?on_conflict=post_key',authorization,{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(allPosts)});
    let interactions=[],unmatchedInteractions=0,phantomMessage='';
    if(source==='likes'||source==='comments'){
      const existingInteractionRows=await db('amplify_interactions?select=interaction_key,participant_key,post_url,action',authorization);
      const action=source==='likes'?'like':'comment';const result=mapApifyInteractions(items,action,directory,config[`${action}_points`],existingInteractionRows);
      interactions=result.interactions;unmatchedInteractions=result.unmatched.length;
    }
    interactions=[...new Map(interactions.map(item=>[item.interaction_key,item])).values()];const existingInteractionKeys=new Set((await db('amplify_interactions?select=interaction_key',authorization)).map(x=>x.interaction_key));const interactionsAdded=interactions.filter(x=>!existingInteractionKeys.has(x.interaction_key)).length;if(interactions.length)await db('amplify_interactions?on_conflict=interaction_key',authorization,{method:'POST',prefer:'resolution=merge-duplicates',body:JSON.stringify(interactions)});
    const added=allPosts.filter(x=>!existing.has(x.post_key)).length;const unmatched=[...new Set([...mapped.unmatched,...reshares.unmatched])];
    const processed=allPosts.length||interactions.length;const newlyAdded=added+interactionsAdded;const label={posts:'activity posts',reposts:'reposts',likes:'likes',comments:'comments'}[source];
    const message=`${mode==='sync-source'?'Synced':'Imported'} ${processed} ${label}; ${newlyAdded} new after deduplication. No other source was run.`;
    if(runId)await db(`amplify_sync_runs?id=eq.${runId}`,authorization,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({finished_at:new Date().toISOString(),status:'success',posts_added:added,interactions_added:interactionsAdded,unmatched:unmatched.length+unmatchedInteractions,message})});
    await db('amplify_config?id=eq.true',authorization,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({last_synced_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    return response.status(200).json({message,source,processed,newlyAdded,postsAdded:added,interactionsAdded,unmatched});
  }catch(error){
    if(runId)try{await db(`amplify_sync_runs?id=eq.${runId}`,authorization,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({finished_at:new Date().toISOString(),status:'failed',message:error.message})});}catch{}
    return response.status(500).json({error:error.message||'Amplify sync failed.'});
  }
}
