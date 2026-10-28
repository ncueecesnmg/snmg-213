# SNMG 213

國立中央大學工程二館網路機房網站，提供服務入口、公告、教學文件、團隊介紹與值班表。

[網站](https://ncueecesnmg.github.io/snmg-213/) · [管理後台](https://snmg-213-admin.ncueecesnmg.workers.dev/) · [部署紀錄](https://github.com/ncueecesnmg/snmg-213/actions)

前台使用 Astro，發布到 GitHub Pages；後台使用 Cloudflare Workers，以 Zero Trust Access 控制登入，透過 GitHub 儲存內容。不需要自行維護伺服器或資料庫。

## 更新網站內容

1. 開啟管理後台，完成 Cloudflare Access 登入。
2. 選擇文章、成員、網站設定或值班表，編輯並預覽。
3. 按「提交到 GitHub」，等待[部署成功](https://github.com/ncueecesnmg/snmg-213/actions)後查看網站。

一般編輯者不需要提供 GitHub token。文章支援 Markdown、HTML、草稿、預約發布、置頂與標籤；圖片接受 PNG、JPEG、WebP，每張上限 2 MB。

使用時請留意：

- **這是公開 repo，草稿原始內容與 Git 歷史也公開，請勿放入機密資料。** 未發布或未來日期的文章只是不顯示在網站上。
- 登入逾時或發生儲存衝突時，先複製保留輸入，再重新登入或讀取最新內容。尚未提交的編輯不會自動儲存。
- 刪除成員或頁面前，先更新相關文章、值班表與連結。建置失敗時，網站維持上一次成功部署的版本。
- 登出會結束 Cloudflare Access session，也可能影響其他 Access 應用程式，詳見 [Cloudflare 說明](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)。

## 本機開發

使用 Node.js **22.23.4 以上**，建議 Node.js 24。

```sh
npm ci
npm run dev -- --port 4321
```

開啟 [本機網站](http://localhost:4321/snmg-213/)。提交程式前執行：

```sh
npm run check
npm run build
npm test
```

測試會檢查建置結果，因此請先 build 再 test。測試使用模擬 GitHub，不會改動正式 repo。

## 部署與管理員設定

**前台**：push 到 `main` 後自動部署，也會每天台灣時間約 00:05 重建。可在 GitHub Actions 手動執行；排程時間可能延遲。流程定義於 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)。

**後台**：手動部署到 `ncueecesnmg` Cloudflare 帳號：

```sh
npx wrangler login
npm run worker:deploy
```

後台帳號、repo、前台網址與 Access 設定都在 [wrangler.jsonc](wrangler.jsonc)。Access 必須保護整個後台，包含 `/api/*`；Worker 也會驗證登入憑證。誰能編輯網站，由 Access policy 決定。

### 更新 GitHub token

建立 fine-grained token，Resource owner 選 `ncueecesnmg`，只授權 `snmg-213`：

- **Contents: Read and write**：讀寫內容與上傳圖片。
- **Actions: Read-only**：查看部署狀態。

執行下列指令，在提示後貼上 token：

```sh
npx wrangler secret put GITHUB_TOKEN
```

Token 只存於 Worker Secret，不會傳到瀏覽器。所有編輯者共用這個憑證，GitHub commit 的帳號由 token 決定；到期或撤銷時再更新即可。請勿把 token 寫進 repo 或 `wrangler.jsonc`。

若需開發後台，可執行 `npm run worker:dev`；本機 Secret 放在已忽略的 `.dev.vars`，仍需有效的 Access JWT 才能存取，沒有略過登入驗證的模式。

## 檔案位置

| 內容 | 位置 |
| --- | --- |
| 公告與文章 | `src/content/posts/` |
| 成員資料 | `src/content/members/` |
| 網站介紹、聯絡方式與表單連結 | `src/content/site/settings.json` |
| 值班表 | `src/content/site/schedule.json` |
| 其他內容頁 | `src/content/legacy/` |
| 成員舊網址對應 | `src/content/member-aliases.json` |
| LOGO、圖片與上傳檔案 | `public/images/` |
| 後台 API 與介面 | `worker/` |
| 視覺與互動設計說明 | [DESIGN.md](DESIGN.md) |

舊站圖片已移除，保留待補位置。補圖時可更新成員的 `image`、文章中的 `/images/placeholder.svg`，或關於機房與招募頁的圖片路徑。成員舊網址對應請保留，避免既有文章與值班表連結失效。

原站 Google 表單與 Drive 文件維持原連結；學校正式網域與 DNS 尚未切換。舊 Fearnot 後台網址會轉到新後台，舊 API 已停用。

## 授權

本專案採用 [MIT License](LICENSE)。
