# 狮爷谈金融 Lio Talk 网站：上线步骤

网站 = 首页新闻 + 保客注册 / 登录 + 填资料 + 上传保单。资料存在 **Supabase**（免费方案就够），网站本身放在 **GitHub Pages**（免费）。
Lio 狮爷软件的「🔄 同步网站」再把这些保客和保单拉进你电脑的保客资料库。

> 这些帐号都要你自己开、密码你自己填。我（Claude）不会替你开帐号或输入密码。

## 1. 开 Supabase 项目（约 10 分钟）

1. 到 https://supabase.com 用你的电邮注册 → **New project**。
   - Name：`lio`；Region：**Southeast Asia (Singapore)**；Database password：自己定一个，记好。
2. **先开你自己的顾问帐号**（一定要比任何保客早）：Authentication → Users → **Add user → Create new user**，
   填你要在 Lio 用的电邮和密码，勾 *Auto Confirm User*。
3. Authentication → Sign In / Providers → Email：**Confirm email 保持打开**（别人就不能冒用你的电邮）。
4. SQL Editor → New query → 打开 `website/supabase/schema.sql`，把里面的 `AGENT_EMAIL` 换成第 2 步的电邮 → **Run**。
5. Project Settings → API：抄下 **Project URL** 和 **anon public** key。

## 2. 填 config.js

打开 `website/config.js`：

```js
SUPABASE_URL: "https://xxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJ...",          // anon public key（这个本来就是公开的，安全靠数据库规则）
AGENT: { name: "CHENG HSZE MIN", iac: "6950741", whatsapp: "60123456789" },
```

`whatsapp` 填了，保客的「初步分析」页会出现 WhatsApp 你的按钮。

## 3. 放上 GitHub Pages

1. 在 GitHub 开一个新的 repository（例如 `lio-website`），把 `website` 文件夹**里面的所有文件**放上去（`index.html` 要在最外层）。
2. Settings → Pages → Source：*Deploy from a branch* → `main` / root。几分钟后网址是 `https://<你的帐号>.github.io/lio-website/`。
3. Settings → Actions → General → Workflow permissions：选 **Read and write**。
   新闻会每 3 小时自动更新（`.github/workflows/news.yml`）；Actions 页也可以按 *Run workflow* 马上更新。
4. 回到 Supabase → Authentication → URL Configuration：**Site URL** 填上面的网址（确认电邮、重设密码的链接会回到这里）。

## 3a. 用自己的网址 www.liotalk.com

1. 买好 `liotalk.com` 后，到卖 domain 的网站（例如 Exabytes、GoDaddy、Namecheap、Cloudflare）的 **DNS 设定**加这几条：

   | 类型 | 名称 / Host | 内容 / Value |
   |---|---|---|
   | CNAME | `www` | `debbiehm.github.io` |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |

   （4 条 A 记录让没打 www 的 `liotalk.com` 也能打开。）
2. GitHub → lio-website → Settings → **Pages** → Custom domain 填 `www.liotalk.com` → Save。
   DNS 生效通常要几分钟到几小时；绿色勾出现后，勾选 **Enforce HTTPS**。
3. Supabase → Authentication → URL Configuration：**Site URL** 改成 `https://www.liotalk.com`。

## 3b. 狮爷摘要（可选，需要 Anthropic API key）

新闻的「狮爷摘要」由 Claude 自动写：读完原文，用自己的话写 2–4 句总结、几个重点，和「跟你有什么关系」。
1. 到 https://console.anthropic.com 开帐号、充值，在 API Keys 建一个 key。
2. GitHub repository → Settings → Secrets and variables → Actions → **New repository secret**：
   名称 `ANTHROPIC_API_KEY`，内容贴上 key。
3. 之后每 3 小时更新新闻时，只总结**新的**新闻（每次最多 60 则），总结过的会存在 `summaries.json` 不重复收费。

每则新闻（中文和英文）都写中文狮爷摘要；英文新闻另外写中文标题，所以中文网站只显示中文。费用（大约）：用 Claude Haiku 5.5，每月约 US$2–6。
想省钱只总结中文新闻：在 Variables 加 `LIO_SUMMARY_LANGS` = `zh`（中文网站会少一些新闻）。
想要写得更好可以换 Claude Opus 5.5（约 US$0.02 / 则，每月约 US$75–110）：同一个页面加一个 **Variables**（不是 Secret）：`LIO_SUMMARY_MODEL` = `claude-opus-5-5`。
没有设 key 也没关系：网站会显示媒体自己的简短摘要。

## 3b-2. 新闻来源（马股IPO·企业、财经市场、马来西亚政策）

这三个分页只用以下来源（`fetch_news.py` 的 `TABLE`），狮爷摘要会按「转化方向」来写，英文新闻也会写成中文标题和中文摘要：

| 来源 | 重点关注 | 狮爷摘要的转化方向 |
|---|---|---|
| The Edge | 企业、经济、基金 | 深度解读、财富规划 |
| The Star Business | 每日财经快讯 | 新闻白话解说 |
| 南洋商报 | 中文财经、企业新闻 | 华语读者容易理解的话题 |
| BFM 89.9 | 经济专家访谈 | 专业知识、观点分析（BFM 以电台/播客为主，常常抓不到文字新闻） |
| Reuters Markets | 美股、利率、全球市场 | 基金及全球投资教育 |
| KWSP / EPF | 退休储蓄、提款政策 | 退休规划 |
| BNM | OPR、通胀、保险监管 | 家庭财务与医疗保障 |
| SC Malaysia | 投资监管、风险提示 | 基金知识、投资者教育 |
| LHDN | 税务、减免 | 合法节税与退休储蓄 |

BNM、KWSP、SC 的官网挡自动读取，所以用各大媒体对它们公告的报道；LHDN 另外直接读它的官方 RSS。
每个来源在每个分页最多 6 则，确保每个来源都有位置。保险、医疗、科技能源分页照旧。

## 3b-3. 狮爷自动读取保单（Claude Sonnet 5.5）

保客上传保单后，Supabase 的云端函数 `read-policy` 把文件交给 Claude Sonnet 5.5 读取，结果存在 `policy_extracts` 表：
网站「初步分析」显示「狮爷读到的现有保单」和每项「已有 / 还差」；Lio 狮爷「🔄 同步网站」后，在保客的「网站资料」下每份保单旁按 **＋ 确认加入**，核对后才进保客资料库。

- 有密码的 PDF：在保客自己的手机/电脑上用密码打开，再上传没密码的版本；**密码不会上传、不会保存**。
- 设定（一次）：
  1. Supabase → SQL Editor 跑 `supabase/policy_reading.sql`。
  2. Supabase → Edge Functions → 新建函数 `read-policy`，贴上 `supabase/functions/read-policy/index.ts`，Deploy。
  3. Supabase → Edge Functions → **Secrets**：`ANTHROPIC_API_KEY` = 你的 key（跟 GitHub 用的同一把即可）。
- 费用：每份保单约 US$0.10–0.20（视页数）。想换模型：Secrets 加 `LIO_POLICY_MODEL`。
- 结果是 AI 初步读取，网站和 Lio 都标明「以顾问确认为准」。
- **Telegram 通知**：Secrets 加 `TELEGRAM_BOT_TOKEN`（BotFather 给的）和 `TELEGRAM_CHAT_ID`。有新保客注册、狮爷读好（或读不到）新保单时，Telegram 会通知你（只有名字、州属、电话、保险公司和计划，不含 IC 和金额）。
- Lio 开着时每 10 分钟自动看一次网站，有新保客 / 新保单就自动同步并在右下角提示。

## 3c. 社交媒体：「关注狮爷」按钮 + Meta Pixel

打开 `config.js`，填你有的就好（没填的按钮不会出现）：

```js
AGENT: { ..., whatsapp: "60123456789" },          // WhatsApp 号码，国家码开头，不要 + 和空格
SOCIAL: {
  facebook: "https://www.facebook.com/你的专页",
  messenger: "你的专页用户名",                    // m.me/后面那段
  instagram: "你的IG用户名",                      // 不用 @
},
META_PIXEL_ID: "1234567890",                      // 下面第 2 步拿
```

**Meta Pixel（在 FB / IG 再接触看过网站的人）**
1. 到 Meta Business Suite → **Events Manager** → Connect data sources → **Web** → 取名（例如 Lio Talk）→ 选 **Meta Pixel**。
2. 不用照它的「安装代码」步骤，只要复制 **Pixel ID**（一串数字）填进 `config.js` 的 `META_PIXEL_ID`。
3. 网站会先问访客同意 cookie，按「接受」的人才会加载 Pixel（PDPA）。只记录行为，不传名字、电邮、电话：
   - `PageView` 看了哪一页 · `ViewContent` 看了哪类新闻 · `QuickCheck` 用了「算一算」· `Lead` 注册 · `Contact` 按了私讯 / WhatsApp
4. 之后在 Ads Manager → Audiences → **Custom audience → Website**，例如「过去 30 天看过保险新闻的人」，就可以投广告给他们。
5. 网址换成 liotalk.com 后，到 Business Settings → **Domains** 验证网域（Meta 会给一行 DNS 记录）。

## 4. Lio 设定

Lio → ⚙ 设定 → **网站同步**：填 Supabase 网址、anon key、第 1 步的顾问电邮和密码 → 保存（密码用 Windows 加密存在这台电脑）。
之后在保客资料库按 **🔄 同步网站**。

## 本地试用（不用任何帐号）

`config.js` 的网址留空 = 示范模式：注册、资料、上传都只存在那个浏览器里，方便先看效果。
在 `website` 文件夹执行 `python -m http.server 8770`，打开 http://localhost:8770 。
手动更新新闻：`python fetch_news.py`。
