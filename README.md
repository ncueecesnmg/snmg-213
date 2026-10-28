# SNMG 213

中央大學工二機房：Astro 靜態前台、GitHub Pages、自行開發的 Cloudflare Workers 內容管理後台。沒有使用第三方 CMS，也不需要 VM、Node 常駐伺服器或資料庫。

- [前台](https://fearnot221.github.io/snmg-213/)
- [自製後台](https://snmg-213-admin.kenin221.workers.dev/)
- [GitHub repo](https://github.com/fearnot221/snmg-213)
- [前台部署紀錄](https://github.com/fearnot221/snmg-213/actions)

## 使用後台

1. 由 GitHub 建立 **fine-grained personal access token**。Resource owner 選 `fearnot221`，Only select repositories 只勾 `snmg-213`。
2. Repository permissions 給 **Contents: Read and write**；若要在後台查看建置紀錄，再給 **Actions: Read-only**。設定合適到期日。後台登入頁有建立入口。
3. 在自製後台貼上 token 登入，編輯文章、成員、網站介紹、聯絡資訊、值班表或其他頁面。
4. 內容支援 Markdown 與原站匯入的 HTML，提供預覽、草稿、日期發布、置頂、標籤、PNG/JPEG/WebP 圖片上傳（2 MB）。圖片先提交，再把圖片路徑寫進文章。
5. 按「提交到 GitHub」產生 commit。Actions 檢查、建置成功後更新前台，實際狀態以部署紀錄為準。

這個 token 由你自己的 Worker 接收，僅送到 GitHub API。Worker 限制指定管理帳號與固定 repo。token 經 AES-GCM 加密後存入 Secure / HttpOnly / SameSite=Strict cookie，8 小時到期，不放 localStorage，也不寫進 repo。金鑰存於 Cloudflare Secret。每次請求會重新驗證 GitHub 權限。登出清除瀏覽器 cookie；若懷疑憑證遭竊，請在 GitHub 撤銷 token，這會立即阻止後續操作。不要使用本機 gh CLI 的廣泛權限憑證登入。

先用限權 token 在正式後台登入，確認讀取與一次內容提交；這步尚未用你的正式 token 測試。本機瀏覽器儲存／衝突流程用模擬 GitHub 驗證，API 測試同樣不會修改正式 repo。

## 內容與發布

- `src/content/posts/*.json`：完整公告／文章，每篇獨立檔案；日期為原始發布日期。
- `src/content/members/*.json`：19 位成員資料與公開連結；`image` 可填入之後上傳的正式照片路徑。
- `src/content/site/settings.json`：首頁介紹、聯絡資料與原站服務表單網址。
- `src/content/site/schedule.json`：原站值班表與更新日期。
- `src/content/legacy/*.json`：其他內容頁。
- `public/images/`：LOGO、分享圖與 `placeholder.svg` 待補圖片；`public/images/uploads/` 存放後台上傳圖片。
- `src/content/member-aliases.json`：保留已改名的成員網址，供既有文章與值班表使用。

`published: false` 與未來日期的文章不輸出到前台。**Repo 是公開的，草稿原始內容與 Git 歷史仍公開，不能用來保存機密。** main push 會重建；排程每日台灣時間約 00:05 重建，GitHub 排程可能延遲或因長期無活動停用。需要時可手動執行 Actions。

修改以檔案 SHA 防止覆蓋他人更新。發生衝突時，先複製保留輸入，再重新讀取最新內容合併。既有 slug 不變；刪除會留下可還原的 Git commit。刪除成員或頁面前，先更新引用它的文章、值班表與導覽；建置的連結檢查會阻止壞連結上線。建置失敗時，先前發布的前台持續服務。

## 開發與部署

需求 Node.js 22.23.4 以上，建議 Node 24。

```sh
npm ci
npm run dev -- --port 4321
npm run check
npm run build
npm test
```

本機前台：`http://localhost:4321/snmg-213/`。前台由 `.github/workflows/deploy.yml` 發布，Pages 設定使用 GitHub Actions。尚未更動學校正式網域或 DNS。

Worker 使用 `wrangler.jsonc`，部署到自己的 Cloudflare 帳號：

```sh
npx wrangler login
npm run worker:dev
npm run worker:deploy
```

`SESSION_KEY` 需要 32 bytes 的隨機 base64url 值，以 `wrangler secret put SESSION_KEY` 設定。首次部署的金鑰已設定，不要重新產生，除非你要撤銷所有既有 session。本機 `.dev.vars` 已列入 gitignore，裡面只放開發用加密金鑰。不要提交金鑰或 token。設定 Cloudflare Secret 時，值必須是 43 字元的 base64url 字串，不能包含 `.dev.vars` 的包覆引號；讀取 `.dev.vars` 時應使用 dotenv 解析（例如 Node.js `util.parseEnv`），不能用逐行擷取代替。帳號、repo、前台網址與登入限流綁定均在 `wrangler.jsonc`。後台程式更新目前用 Wrangler 手動部署，前台內容 commit 則走 GitHub Actions。

測試涵蓋內容驗證、發布排序、內容頁與成員舊網址對應、所有內部連結、XSS 清理、登入加密、到期、跨站請求、限流、路徑限制、SHA 衝突與圖片類型。部署前先 build 再 test。

遷移已完成，匯入工具與 `migration/` 資料夾已移除。網站建置與日常維護直接使用 `src/content/`。

## 原站與驗證範圍

原站 46 個 sitemap 網址均已在本次版本產生對應頁面；含完整 7 篇文章、19 位成員、值班表、分類／標籤、元件示例與原本空白的隱私權頁。原本的 Google 表單、Drive 文件維持既有外部入口，未搬動其權限或內容。隱私權頁原站沒有條文，未替學校編造政策。

舊站頭像、機櫃照片及教學截圖已移除，保留圖片位置與教學圖片說明。補圖時，成員照片可由後台填入頭像路徑；文章中的 `/images/placeholder.svg` 替換為上傳圖片路徑；關於機房與招募頁的照片位置在各自的 Astro 頁面。LOGO 使用提供的 PNG，favicon 使用中央大學校徽。

桌面、平板與手機瀏覽器已檢查；未以實體手機、螢幕閱讀器或真實師生進行任務測試，也未宣稱取得 Awwwards / Webby / FWA 認證。視覺與動態決策見 `DESIGN.md`。
