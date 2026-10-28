/** @typedef {{file:string,title:string,slug:string,category:string,summary:string,body:string,date:string,published:boolean,pinned:boolean,source?:string,sourceType?:string,tags?:string[],author?:string,authorName?:string,order?:number}} Post */

export const categories = ['公告', '教學文件', '機房日誌', '招募資訊'];
function requiredString(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} 必須是 1–${max} 字的文字。`);
}
function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
function httpsUrl(value, name) {
  try { if (new URL(value).protocol === 'https:') return; } catch {}
  throw new Error(`${name} 必須是 HTTPS 網址。`);
}
/** @param {Post} post */
export function validatePost(post) {
  for (const [field, max] of Object.entries({ title: 100, slug: 120, summary: 300, body: 50000 })) requiredString(post[field], field, max);
  if (!/^[\p{L}\p{N}_-]+$/u.test(post.slug)) throw new Error('文章網址只能使用文字、數字、連字號與底線。');
  if (!categories.includes(post.category)) throw new Error('無效的文章分類。');
  if (!validDate(post.date)) throw new Error('無效的發布日期。');
  if (typeof post.published !== 'boolean' || typeof post.pinned !== 'boolean') throw new Error('公開與置頂欄位必須是布林值。');
  if (post.source) httpsUrl(post.source, '原文來源');
  if (post.author && (typeof post.author !== 'string' || !/^\/members\/[\p{L}\p{N}_-]+\/$/u.test(post.author))) throw new Error('作者必須是成員頁面路徑。');
  if (post.tags && (!Array.isArray(post.tags) || post.tags.some(tag => typeof tag !== 'string' || tag.length > 40))) throw new Error('標籤格式錯誤。');
  return post;
}
export function validateSettings(settings) {
  for (const [field, max] of Object.entries({ heroTitle: 24, heroDescription: 240, aboutText: 1000, recruitmentText: 1000, email: 120, officeHours: 120, phone: 80 })) requiredString(settings[field], field, max);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) throw new Error('聯絡信箱格式錯誤。');
  for (const key of ['networkForm', 'mailForm', 'dnsForm']) httpsUrl(settings[key], key);
  return settings;
}

/** @param {Post[]} posts */
export function selectPublishedPosts(posts, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' })) {
  const slugs = new Set();
  for (const post of posts) {
    validatePost(post);
    if (slugs.has(post.slug)) throw new Error(`重複的文章網址：${post.slug}`);
    slugs.add(post.slug);
  }
  return posts.filter(p => p.published && p.date <= today)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date.localeCompare(a.date) || (a.order ?? 0) - (b.order ?? 0) || a.slug.localeCompare(b.slug));
}

export const collections = {
  posts: { label: '文章與公告', path: 'src/content/posts' },
  members: { label: '團隊成員', path: 'src/content/members' },
  legacy: { label: '其他頁面', path: 'src/content/legacy' },
  site: { label: '網站與值班表', path: 'src/content/site' },
};
export function validateDocument(collection, data, filename) {
  if (!Object.hasOwn(collections, collection) || !/^[\p{L}\p{N}_-]+\.json$/u.test(filename)) throw new Error('不允許的內容路徑。');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('內容必須是物件。');
  if (collection === 'posts') {
    validatePost(data);
    if (`${data.slug}.json` !== filename) throw new Error('既有文章網址不能更改，請新增另一篇文章以保留舊連結。');
  } else if (collection === 'members') {
    requiredString(data.name, '成員姓名', 100);
    requiredString(data.slug, '成員網址', 120);
    if (!/^[\p{L}\p{N}_-]+$/u.test(data.slug) || `${data.slug}.json` !== filename) throw new Error('成員網址與檔案不一致。');
    if (typeof data.body !== 'string' || data.body.length > 50000) throw new Error('成員介紹過長。');
    if (data.image && !(data.image.startsWith('/images/') || data.image.startsWith('https://'))) throw new Error('頭像網址無效。');
    if (!Array.isArray(data.links) || data.links.length > 12) throw new Error('個人連結格式錯誤。');
    for (const link of data.links) { try { if (!['https:', 'mailto:'].includes(new URL(link).protocol)) throw new Error(); } catch { throw new Error('個人連結必須使用有效的 HTTPS 或 mailto 網址。'); } }
  } else if (collection === 'legacy') {
    requiredString(data.title, '頁面標題', 100);
    if (`${data.path?.slice(1,-1)}.json` !== filename) throw new Error('頁面路徑與檔名不一致。');
    if (!/^\/[\p{L}\p{N}_-]+\/$/u.test(data.path) || /^(?:\/)(?:admin|api|about|forms|members|sched|joinus|documents|tutorials|announcements|categories|tags)\/$/.test(data.path)) throw new Error('頁面路徑與既有頁面衝突。');
    if (typeof data.body !== 'string' || data.body.length > 100000) throw new Error('頁面內容過長。');
  } else if (filename === 'settings.json') validateSettings(data);
  else if (filename === 'schedule.json') {
    if (!validDate(data.updated) || !Array.isArray(data.rows) || data.rows.length > 30) throw new Error('值班表日期或列數錯誤。');
    for (const row of data.rows) {
      if (!Array.isArray(row) || row.length !== 6) throw new Error('每一列必須有時間與週一至週五共六欄。');
      for (const cell of row) {
        if (typeof cell.text !== 'string' || cell.text.length > 150 || !Array.isArray(cell.members)) throw new Error('值班欄位格式錯誤。');
        for (const member of cell.members) if (typeof member.name !== 'string' || !/^\/members\/[\p{L}\p{N}_-]+\/$/u.test(member.href)) throw new Error('值班成員連結格式錯誤。');
      }
    }
  } else throw new Error('不允許修改這個設定檔。');
  return data;
}
