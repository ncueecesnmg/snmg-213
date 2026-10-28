import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../worker/index.mjs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {validateDocument} from '../src/lib/schema.mjs';
import {getPosts,getMembers,getSchedule,getLegacyPages,getTaxonomies,taxonomySlug} from '../src/lib/content.mjs';
import {articleHeadings,renderMarkdown} from '../src/lib/markdown.mjs';
import {readFileSync,existsSync} from 'node:fs';
const origin='https://admin.example.com',token='github_pat_test_12345678901234567890';
const env={GITHUB_TOKEN:token,TEAM_DOMAIN:'https://test.cloudflareaccess.com',POLICY_AUD:'test-audience',GITHUB_OWNER:'ncueecesnmg',GITHUB_REPO:'snmg-213',GITHUB_BRANCH:'main',FRONTEND_URL:'https://ncueecesnmg.github.io/snmg-213/',API_LIMITER:{limit:async()=>({success:true})},ASSETS:{fetch:async()=>new Response('protected asset')}};
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256'};
const post={title:'安全測試',slug:'test',category:'公告',summary:'摘要',body:'## 本文',date:'2026-01-01',published:false,pinned:false};
const sha='a'.repeat(40);
function mockGitHub(calls,writeStatus=200){return async(url,options)=>{
  if(url===env.TEAM_DOMAIN+'/cdn-cgi/access/certs')return Response.json({keys:[jwk]});
  assert.ok(url.startsWith('https://api.github.com/repos/ncueecesnmg/snmg-213'));
  assert.equal(options.headers.Authorization,`Bearer ${token}`);calls.push({url,...options});
  if(options.method==='PUT'||options.method==='DELETE')return Response.json({content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40),html_url:'https://github.com/ncueecesnmg/snmg-213/commit/test'}},{status:writeStatus});
  return Response.json({sha,content:Buffer.from(JSON.stringify(post)).toString('base64')});
};}
async function request(path,method='GET',body,changes={},assertion){return handleRequest(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...(assertion?{'cf-access-jwt-assertion':assertion}:{}),...changes.headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),{...env,...changes.env},changes.fetcher||mockGitHub([]));}
async function accessToken(changes={},signingKey=privateKey){return new SignJWT({iss:env.TEAM_DOMAIN,aud:[env.POLICY_AUD],sub:'access-user',email:'editor@example.com',type:'app',exp:Math.floor(Date.now()/1000)+600,...changes}).setProtectedHeader({alg:'RS256',kid:'test-key'}).sign(signingKey);}
test('Access requires a signed, unexpired user JWT for this issuer and application, including static assets',async()=>{
  const calls=[];
  for(const path of ['/','/app.js','/api/session','/api/content?collection=posts']){
    assert.equal((await request(path,'GET',undefined,{fetcher:mockGitHub(calls)})).status,401);
    assert.equal((await request(path,'GET',undefined,{headers:{'cf-access-authenticated-user-email':'editor@example.com',cookie:'__Host-snmg=old-session'}})).status,401);
  }
  for(const changes of [{iss:'https://other.cloudflareaccess.com'},{aud:['another-app']},{exp:1},{exp:undefined},{nbf:Math.floor(Date.now()/1000)+600},{email:undefined},{type:'service'}]){
    assert.equal((await request('/api/session','GET',undefined,{},await accessToken(changes))).status,401);
  }
  const other=await generateKeyPair('RS256');
  assert.equal((await request('/api/session','GET',undefined,{},await accessToken({},other.privateKey))).status,401);
  assert.equal((await request('/api/session','GET',undefined,{},'forged.jwt.value')).status,401);
  assert.equal(calls.length,0);
});
test('Access identity reaches the UI while the configured GitHub token stays on the server',async()=>{
  const assertion=await accessToken();
  const result=await request('/api/session','GET',undefined,{},assertion);
  assert.equal(result.status,200);assert.equal((await result.clone().json()).login,'editor@example.com');
  assert.ok(!(await result.text()).includes(token));assert.equal(result.headers.get('set-cookie'),null);
  const asset=await request('/app.js','GET',undefined,{},assertion);
  assert.equal(asset.status,200);assert.equal(asset.headers.get('cache-control'),'no-store');
  assert.equal((await request('/api/login','POST',{token:'browser_supplied_token'}, {},assertion)).status,404);
});
test('missing Access settings or server GitHub token fail closed, and revoked token errors do not expose secrets',async()=>{
  const assertion=await accessToken();
  for(const changes of [{TEAM_DOMAIN:''},{TEAM_DOMAIN:'https://untrusted.example'},{POLICY_AUD:''},{GITHUB_TOKEN:undefined},{GITHUB_TOKEN:'invalid token'}])assert.equal((await request('/api/session','GET',undefined,{env:changes},assertion)).status,503);
  const expired=await request('/api/content?collection=posts','GET',undefined,{fetcher:async()=>Response.json({}, {status:401})},assertion);
  assert.equal(expired.status,503);assert.ok(!(await expired.text()).includes(token));
});
test('cross-origin and rate limited operations fail before GitHub writes',async()=>{
  const assertion=await accessToken(),calls=[];
  assert.equal((await request('/api/content?collection=posts&file=test.json','PUT',{data:post},{headers:{origin:'https://evil.example'},fetcher:mockGitHub(calls)},assertion)).status,403);
  assert.equal((await request('/api/content?collection=posts&file=test.json','PUT',{data:post},{env:{API_LIMITER:{limit:async()=>({success:false})}},fetcher:mockGitHub(calls)},assertion)).status,429);
  assert.equal(calls.length,0);
});
test('write validates schema and paths, sends the expected SHA, and preserves conflict response',async()=>{const assertion=await accessToken(),calls=[];for(const collection of ['__proto__','constructor','unknown'])assert.equal((await request(`/api/content?collection=${collection}&file=test.json`,'PUT',{data:post},{},assertion)).status,400);assert.equal((await request('/api/content?collection=posts&file=../test.json','PUT',{data:post},{},assertion)).status,400);assert.equal((await request('/api/content?collection=posts&file=test.json','PUT',{data:{...post,title:''}},{},assertion)).status,400);const response=await request('/api/content?collection=posts&file=test.json','PUT',{data:post,sha},{fetcher:mockGitHub(calls)},assertion);assert.equal(response.status,200);const write=calls.find(call=>call.method==='PUT'),body=JSON.parse(write.body);assert.equal(body.sha,sha);assert.deepEqual(JSON.parse(Buffer.from(body.content,'base64')),post);assert.equal((await request('/api/content?collection=posts&file=test.json','PUT',{data:post,sha},{fetcher:mockGitHub([],409)},assertion)).status,409);});
test('preview sanitizes HTML, resolves frontend assets, upload rejects active content, settings cannot be deleted',async()=>{const assertion=await accessToken();const response=await request('/api/preview','POST',{body:'<img src="/images/a.png" onerror="alert(1)"><script>alert(1)</script>'},{},assertion);const {html}=await response.json();assert.doesNotMatch(html,/<script|onerror/);assert.match(html,/https:\/\/ncueecesnmg.github.io\/snmg-213\/images\/a.png/);assert.equal((await request('/api/uploads','POST',{content:Buffer.from('<svg onload="alert(1)">').toString('base64')},{},assertion)).status,400);assert.equal((await request('/api/content?collection=site&file=settings.json','DELETE',{confirm:true,sha},{},assertion)).status,403);assert.equal((await request('/api/content?collection=posts&file=test.json','DELETE',{sha},{},assertion)).status,400);assert.equal((await request('/api/preview','POST','{broken',{},assertion)).status,400);});
test('content validates and current documents, member aliases and taxonomy routes exist in the static build',()=>{
  const posts=getPosts(),members=getMembers(),pages=getLegacyPages();
  for(const item of posts)validateDocument('posts',item,item.file);
  for(const item of members)validateDocument('members',item,`${item.slug}.json`);
  validateDocument('site',getSchedule(),'schedule.json');
  for(const item of pages)validateDocument('legacy',item,item.path.slice(1,-1)+'.json');
  const aliases=JSON.parse(readFileSync('src/content/member-aliases.json'));
  const routes=[...posts.map(post=>`/announcements/${post.slug}/`),...members.map(person=>`/members/${person.slug}/`),...pages.map(page=>page.path),...Object.entries(aliases).filter(([,target])=>members.some(person=>`/members/${person.slug}/`===target)).map(([path])=>path),...['categories','tags'].flatMap(kind=>getTaxonomies(kind).map(value=>`/${kind}/${taxonomySlug(value)}/`))];
  for(const path of routes)assert.ok(existsSync(`dist${path}index.html`),path);
});
test('original HTML images stay images and Markdown heading IDs remain unique',()=>{const html=renderMarkdown('<h2 id="original">標題</h2>\n    <img src="/images/a.png" alt="截圖">');assert.match(html,/<img src="\/snmg-213\/images\/a.png"/);assert.doesNotMatch(html,/<pre>/);assert.deepEqual(articleHeadings(renderMarkdown('## 同一標題\n\n## 同一標題')).map(item=>item.id),['同一標題','同一標題-1']);});

test('editors can pin and unpin an announcement without changing its content', async () => {
  const assertion = await accessToken();
  for (const pinned of [true, false]) {
    const calls = [];
    const data = {...post, published:true, pinned};
    const response = await request('/api/content?collection=posts&file=test.json', 'PUT', {data, sha}, {fetcher:mockGitHub(calls)}, assertion);
    assert.equal(response.status, 200);
    const write = calls.find(call => call.method === 'PUT');
    const saved = JSON.parse(Buffer.from(JSON.parse(write.body).content, 'base64'));
    assert.deepEqual(saved, data);
  }
});
