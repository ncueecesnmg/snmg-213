# SNMG 213

中央大學工二機房：Astro 靜態前台、GitHub Pages、自行開發的 Cloudflare Workers 內容管理後台。沒有使用第三方 CMS，也不需要 VM、Node 常駐伺服器或資料庫。

- [前台](https://ncueecesnmg.github.io/snmg-213/)
- [自製後台](https://snmg-213-admin.ncueecesnmg.workers.dev/)
- [GitHub repo](https://github.com/ncueecesnmg/snmg-213)
- [前台部署紀錄](https://github.com/ncueecesnmg/snmg-213/actions)

## 使用後台

1. 開啟後台，由 Cloudflare Zero Trust Access 登入；允許的使用者由 Access policy 管理。
2. 登入後即可編輯文章、成員、網站介紹、聯絡資訊、值班表或其他頁面，不需要輸入 GitHub token。
3. 內容支援 Markdown 與 HTML、預覽、草稿、日期發布、置頂、標籤、PNG/JPEG/WebP 圖片上傳（2 MB）。圖片先提交，再把圖片路徑寫進文章。
4. 按「提交到 GitHub」產生 commit。Actions 檢查、建置成功後更新前台，實際狀態以部署紀錄為準。

Worker 使用 `jose` 驗證 Access JWT 的 RS256 簽章、Team domain、Application AUD、有效期限與使用者身分；靜態後台與所有 API 都必須通過驗證。舊的 GitHub token 登入端點與自製 session 已移除，也不再限制為 `fearnot221` 帳號。前台網站仍公開，只有管理後台受 Access 保護。

GitHub token 存在 Worker Secret `GITHUB_TOKEN`，不傳到瀏覽器、不存入 cookie 或 repo。所有編輯者共用這個伺服器端憑證，GitHub commit 的帳號由該 token 決定。Token 的 Resource owner 選 `ncueecesnmg`，只授權 `snmg-213`，設定 Contents: Read and write、Actions: Read-only。Token 到期或撤銷時由管理員更新 Secret，編輯者不需要重新輸入。

Access 登入逾時或 GitHub token 出錯時，編輯器保留目前輸入。重新載入前先自行複製尚未儲存的內容；登出按鈕會進入 Cloudflare Access 的登出流程。Access 登出會影響同一使用者的其他 Access 應用程式，詳見 [Cloudflare session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)。

API 測試使用本機簽發的測試 JWT 與模擬 GitHub，不會修改正式 repo。

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

Worker 使用 `wrangler.jsonc`，部署到 `ncueecesnmg` Cloudflare 帳號（`wrangler.jsonc` 的 `account_id`）：

```sh
npx wrangler login
npm run worker:dev
npm run worker:deploy
```

`wrangler.jsonc` 固定 repo、Cloudflare 帳號、`TEAM_DOMAIN` 與 `POLICY_AUD`。Access application 必須保護整個後台（包含 `/api/*`）；Worker 也會自行驗證 JWT，未設定或驗證失敗一律拒絕。

更新 GitHub 憑證：

```sh
npx wrangler secret put GITHUB_TOKEN
```

不要把 token 放進 `vars`、repo 或瀏覽器。正式部署使用 Cloudflare Secret；本機開發可使用已忽略的 `.dev.vars`，但仍需有效的 Access JWT，不提供略過驗證的開關。舊 `SESSION_KEY` 已不再使用。

後台程式更新用 Wrangler 手動部署，前台內容 commit 則走 GitHub Actions。原 Fearnot 帳號的後台網址已改為轉址入口；舊 `/api/` 回傳 410，請在新網址重新登入。

測試涵蓋 Access JWT 簽章、發行者、AUD、有效期限、靜態資源保護、伺服器端 token 不外洩、跨站請求與限流，以及內容驗證、發布排序、內部連結、XSS 清理、SHA 衝突與圖片類型。部署前先 build 再 test。

遷移已完成，匯入工具與 `migration/` 資料夾已移除。網站建置與日常維護直接使用 `src/content/`。

## 原站與驗證範圍

原站 46 個 sitemap 網址均已在本次版本產生對應頁面；含完整 7 篇文章、19 位成員、值班表、分類／標籤、元件示例與原本空白的隱私權頁。原本的 Google 表單、Drive 文件維持既有外部入口，未搬動其權限或內容。隱私權頁原站沒有條文，未替學校編造政策。

舊站頭像、機櫃照片及教學截圖已移除，保留圖片位置與教學圖片說明。補圖時，成員照片可由後台填入頭像路徑；文章中的 `/images/placeholder.svg` 替換為上傳圖片路徑；關於機房與招募頁的照片位置在各自的 Astro 頁面。LOGO 使用提供的 PNG，favicon 使用中央大學校徽。

桌面、平板與手機瀏覽器已檢查；未以實體手機、螢幕閱讀器或真實師生進行任務測試，也未宣稱取得 Awwwards / Webby / FWA 認證。視覺與動態決策見 `DESIGN.md`。
