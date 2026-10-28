import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { getSettings, getPosts, getMembers, validatePost, validateSettings, selectPublishedPosts, renderMarkdown } from '../src/lib/content.mjs';
import { withBase } from '../src/lib/paths.mjs';
const post = { title:'測試文章',slug:'test-post',category:'公告',summary:'摘要',body:'## 測試\n\n本文',date:'2026-01-01',published:true,pinned:false };

test('repository files supply validated site settings and article content', () => {
  assert.ok(getSettings().email.includes('@'));
  const posts = getPosts();
  assert.ok(Array.isArray(posts));
  assert.ok(posts.every(p => p.published && p.file.endsWith('.json')));
});
test('drafts and future posts are excluded; pinned posts precede newer articles', () => {
  const published = selectPublishedPosts([post,{...post,slug:'draft',published:false},{...post,slug:'future',date:'2099-01-01'},{...post,slug:'pinned',pinned:true,date:'2025-01-01'}],'2026-10-22');
  assert.deepEqual(published.map(p=>p.slug),['pinned','test-post']);
  assert.ok(selectPublishedPosts([{...post,date:'2026-10-22'}],'2026-10-22').length);
});
test('invalid content and duplicate slugs fail the build', () => {
  for (const change of [{title:''},{slug:'../escape'},{date:'2026-02-30'},{category:'unknown'},{published:'false'},{pinned:1},{body:'a'.repeat(50001)},{source:'javascript:alert(1)'}]) assert.throws(()=>validatePost({...post,...change}));
  assert.throws(()=>selectPublishedPosts([post,post]));
});
test('settings reject unsafe service URLs and invalid email addresses', () => {
  const settings = getSettings();
  assert.throws(()=>validateSettings({...settings,email:'broken'}));
  assert.throws(()=>validateSettings({...settings,networkForm:'javascript:alert(1)'}));
  assert.throws(()=>validateSettings({...settings,dnsForm:'http://insecure.example'}));
});
test('Markdown preserves formatting while stripping XSS and prefixing repo media paths', () => {
  const html=renderMarkdown('## 標題\n\n**粗體**\n\n<script>alert(1)</script>\n\n<img src="/images/uploads/test.png" onerror="alert(1)">\n\n[危險](javascript:alert(1))\n\n[內頁](/forms/)');
  assert.match(html,/<h2 id="標題">標題<\/h2>/);assert.match(html,/<strong>粗體<\/strong>/);
  assert.doesNotMatch(html,/<script|onerror|javascript:/i);
  assert.match(html,/src="\/snmg-213\/images\/uploads\/test.png"/);
  assert.match(html,/href="\/snmg-213\/forms\/"/);
});
test('base paths work for pages, anchors and CMS media without doubling the prefix', () => {
  for(const [input,expected] of [['/','/snmg-213/'],['/#services','/snmg-213/#services'],['/images/a.jpg','/snmg-213/images/a.jpg'],['/snmg-213/forms/','/snmg-213/forms/'],['https://example.com/','https://example.com/'],['mailto:test@example.com','mailto:test@example.com'],['#main','#main'],['/forms','/snmg-213/forms/'],['/forms#dns','/snmg-213/forms/#dns'],['/announcements?category=a','/snmg-213/announcements/?category=a'],['/snmg-213','/snmg-213/']]) assert.equal(withBase(input),expected);
});
function htmlFiles(folder) {return readdirSync(folder,{withFileTypes:true}).flatMap(item=>item.isDirectory()?htmlFiles(join(folder,item.name)):item.name.endsWith('.html')?[join(folder,item.name)]:[]);}
test('production output is static, all internal page and asset URLs resolve under the repo base', () => {
  assert.ok(existsSync('dist/index.html'),'Run npm run build before tests');
  assert.ok(!existsSync('dist/server'),'No server runtime should be deployed');
  assert.ok(existsSync('dist/admin/index.html'));
  for(const file of htmlFiles('dist')) {
    const html=readFileSync(file,'utf8');
    assert.doesNotMatch(html,/snmg_session|ADMIN_PASSWORD|\/api\/admin|node:sqlite/);
    for(const match of html.matchAll(/(?:href|src)="(\/(?!\/)[^"]*)"/g)) {
      const path=match[1].split(/[?#]/)[0];
      assert.ok(path.startsWith('/snmg-213/'),`${file}: unprefixed URL ${path}`);
      const target=join('dist',decodeURIComponent(path.slice('/snmg-213/'.length)));
      assert.ok(extname(target)?existsSync(target):existsSync(join(target,'index.html')),`${file}: missing target ${path}`);
    }
  }
});
test('draft contents do not ship in the published HTML', () => {
  const all=readdirSync('src/content/posts').filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join('src/content/posts',f),'utf8')));
  const drafts=all.filter(p=>!p.published);
  for(const file of htmlFiles('dist')) for(const draft of drafts) assert.ok(!readFileSync(file,'utf8').includes(draft.title));
});

test('retired site images are replaced with placeholders while article context remains', () => {
  assert.ok(!existsSync('public/images/original'));
  assert.ok(!existsSync('public/images/joining.jpg'));
  assert.ok(!existsSync('migration'));
  const html=renderMarkdown('<img src="/images/placeholder.svg" alt="教學截圖（圖片待補）">');
  assert.match(html,/src="\/snmg-213\/images\/placeholder.svg"/);
  assert.match(html,/教學截圖（圖片待補）/);
  for(const file of htmlFiles('dist')) {
    const html=readFileSync(file,'utf8');
    assert.doesNotMatch(html,/\/images\/(?:original\/|joining\.jpg)/);
    assert.doesNotMatch(html,/<img\b[^>]*snmg\.ce\.ncu\.edu\.tw/);
  }
  for(const person of getMembers().filter(person=>!person.image))assert.match(readFileSync(`dist/members/${person.slug}/index.html`,'utf8'),/placeholder\.svg/);
});
