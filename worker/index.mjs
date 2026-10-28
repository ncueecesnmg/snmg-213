import { validateDocument, collections } from '../src/lib/schema.mjs';
import { renderMarkdown } from '../src/lib/markdown.mjs';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
const decoder = new TextDecoder();
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
const fileEncode = text => Buffer.from(text,'utf8').toString('base64');
const fileDecode = text => Buffer.from(text,'base64').toString('utf8');
const keySets = new Map();
async function accessIdentity(request, env, fetcher) {
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.TEAM_DOMAIN||'') || !env.POLICY_AUD)fail('後台尚未設定 Cloudflare Access。',503);
  const assertion=request.headers.get('cf-access-jwt-assertion');
  if(!assertion)fail('請透過 Cloudflare Access 登入管理後台。',401);
  if(!keySets.has(env.TEAM_DOMAIN))keySets.set(env.TEAM_DOMAIN,createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`),{[customFetch]:fetcher}));
  try {
    const {payload}=await jwtVerify(assertion,keySets.get(env.TEAM_DOMAIN),{issuer:env.TEAM_DOMAIN,audience:env.POLICY_AUD,algorithms:['RS256'],requiredClaims:['exp','sub','email']});
    if(payload.type!=='app'||typeof payload.email!=='string'||!payload.email)fail('需要使用者身分登入。',401);
    return payload;
  } catch { fail('Cloudflare Access 登入已失效，請重新登入。',401); }
}
async function readJson(request, limit = 250000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail('請使用 JSON 格式。',415);
  const reader = request.body?.getReader();
  if (!reader) fail('請求內容不能空白。');
  const chunks=[];let size=0;
  while(true) {
    const {done,value}=await reader.read();if(done)break;
    size+=value.length;if(size>limit){await reader.cancel();fail('內容超過大小限制。',413);}chunks.push(value);
  }
  const buffer=new Uint8Array(size);let position=0;
  for(const chunk of chunks){buffer.set(chunk,position);position+=chunk.length;}
  try{const data=JSON.parse(decoder.decode(buffer));if(!data||typeof data!=='object'||Array.isArray(data))fail('請提供 JSON 物件。');return data;}catch{fail('JSON 格式錯誤。');}
}
async function github(token, path, options, fetcher) {
  const response=await fetcher(`https://api.github.com${path}`,{
    ...options,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'SNMG-213-Own-CMS',...(options?.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(15000),
  });
  if(response.status===401)fail('後台 GitHub token 已失效，請由管理員更新 GITHUB_TOKEN。',503);
  if(response.status===403)fail('GitHub 拒絕操作；請確認 token 的 Contents 讀寫權限或稍後重試。',403);
  if(response.status===409||response.status===422)fail('內容已有新版本或網址重複。輸入內容已保留，請先重新讀取後再合併。',409);
  if(response.status===404)return null;
  if(!response.ok)fail('GitHub 暫時無法完成操作，請稍後重試。',502);
  return response.status===204?{}:response.json();
}
const repo = env => `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
const contentPath=(env,collection,filename='')=>`${repo(env)}/contents/${collections[collection].path}${filename?`/${encodeURIComponent(filename)}`:''}`;
export async function handleRequest(request, env, fetcher = fetch) {
  const url=new URL(request.url);
  try {
    const identity=await accessIdentity(request,env,fetcher);
    if(!url.pathname.startsWith('/api/'))return secure(await env.ASSETS.fetch(request));
    if(request.method!=='GET' && request.headers.get('origin')!==url.origin)fail('拒絕跨站請求。',403);
    if(env.API_LIMITER && !(await env.API_LIMITER.limit({key:`api:${identity.sub}`})).success)fail('操作較頻繁，請稍後重試。',429);
    if(typeof env.GITHUB_TOKEN!=='string'||env.GITHUB_TOKEN.length<20||/\s/.test(env.GITHUB_TOKEN))fail('後台尚未設定有效的 GITHUB_TOKEN。',503);
    if(url.pathname==='/api/session' && request.method==='GET')return secure(json({login:identity.email,repository:`${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,branch:env.GITHUB_BRANCH,frontend:env.FRONTEND_URL}));
    if(url.pathname==='/api/preview' && request.method==='POST') {
      const {body}=await readJson(request);if(typeof body!=='string'||body.length>100000)fail('內容過長。');
      const html=renderMarkdown(body,path=>path.startsWith('/')&&!path.startsWith('//') ? new URL(path.startsWith('/snmg-213/') ? path : `/snmg-213${path}`,env.FRONTEND_URL).href : path);
      return secure(json({html}));
    }
    if(url.pathname==='/api/content') {
      const collection=url.searchParams.get('collection');
      if(!Object.hasOwn(collections,collection))fail('不允許的內容集合。');
      const filename=url.searchParams.get('file');
      if(filename && !/^[\p{L}\p{N}_-]+\.json$/u.test(filename))fail('不允許的檔案路徑。');
      if(request.method==='GET') {
        const raw=await github(env.GITHUB_TOKEN,`${contentPath(env,collection,filename)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`,{},fetcher);
        if(!raw)fail('找不到內容。',404);
        if(filename)return secure(json({filename,sha:raw.sha,data:JSON.parse(fileDecode(raw.content))}));
        if(!Array.isArray(raw))fail('內容列表格式不正確。',502);
        const files=raw.filter(f=>f.type==='file'&&f.name.endsWith('.json'));
        // shortcut: one directory is limited to 200 documents; use a Git tree snapshot for larger sites.
        if(files.length>200)fail('此集合超過 200 篇內容，請改用 GitHub 管理。',413);
        const items=[];
        // Cloudflare limits subrequests per invocation; list metadata first, fetch an item only when opened.
        for(const file of files)items.push({filename:file.name,sha:file.sha});
        return secure(json({items}));
      }
      if(!filename)fail('缺少內容檔名。');
      const input=await readJson(request);
      if(request.method==='PUT') {
        try { validateDocument(collection,input.data,filename); } catch (error) { fail(error.message); }
        if(input.sha && !/^[a-f0-9]{40}$/.test(input.sha))fail('版本格式錯誤。');
        const saved=await github(env.GITHUB_TOKEN,contentPath(env,collection,filename),{method:'PUT',body:JSON.stringify({message:`content: ${input.sha?'update':'add'} ${collection}/${filename}`,branch:env.GITHUB_BRANCH,content:fileEncode(JSON.stringify(input.data,null,2)+'\n'),...(input.sha?{sha:input.sha}:{})})},fetcher);
        if(!saved)fail('找不到儲存位置。',404);
        return secure(json({sha:saved.content.sha,commit:saved.commit.html_url,commitSha:saved.commit.sha}));
      }
      if(request.method==='DELETE') {
        if(collection==='site')fail('網站設定不能刪除。',403);
        if(input.confirm!==true||!/^[a-f0-9]{40}$/.test(input.sha||''))fail('請確認刪除並提供目前版本。');
        const removed=await github(env.GITHUB_TOKEN,contentPath(env,collection,filename),{method:'DELETE',body:JSON.stringify({message:`content: remove ${collection}/${filename}`,branch:env.GITHUB_BRANCH,sha:input.sha})},fetcher);
        if(!removed)fail('內容已不存在。',404);
        return secure(json({ok:true,commit:removed.commit.html_url}));
      }
    }
    if(url.pathname==='/api/uploads' && request.method==='POST') {
      const {content}=await readJson(request,3000000);
      if(typeof content!=='string'||content.length>2800000||!/^[A-Za-z0-9+/]*={0,2}$/.test(content))fail('圖片格式或大小不正確。');
      const bytes=Buffer.from(content,'base64');
      if(bytes.length>2*1024*1024)fail('圖片上限為 2 MB。',413);
      let extension='';
      if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))extension='png';
      else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)extension='jpg';
      else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')extension='webp';
      else fail('僅接受 PNG、JPEG 或 WebP 圖片。');
      const name=`${crypto.randomUUID()}.${extension}`;
      const saved=await github(env.GITHUB_TOKEN,`${repo(env)}/contents/public/images/uploads/${name}`,{method:'PUT',body:JSON.stringify({message:`content: upload ${name}`,branch:env.GITHUB_BRANCH,content})},fetcher);
      return secure(json({path:`/images/uploads/${name}`,commit:saved.commit.html_url}));
    }
    if(url.pathname==='/api/deployments' && request.method==='GET') {
      const result=await github(env.GITHUB_TOKEN,`${repo(env)}/actions/runs?branch=${encodeURIComponent(env.GITHUB_BRANCH)}&per_page=5`,{},fetcher);
      return secure(json({runs:(result?.workflow_runs||[]).map(r=>({status:r.status,conclusion:r.conclusion,url:r.html_url,sha:r.head_sha}))}));
    }
    fail('找不到此操作。',404);
  } catch(error) {return secure(json({error:error.status?error.message:'服務暫時無法完成操作，請稍後重試。'},error.status||500));}
}
function secure(response) {
  const result=new Response(response.body,response);
  result.headers.set('Cache-Control','no-store');
  result.headers.set('X-Content-Type-Options','nosniff');
  result.headers.set('Referrer-Policy','no-referrer');
  result.headers.set('X-Frame-Options','DENY');
  result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return result;
}
export default {fetch(request,env) { return handleRequest(request,env); }};
