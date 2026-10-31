# 狮爷谈金融 Dato Lio Talk 网站：上线步骤

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

## 3a. 用自己的网址 www.datoliotalk.com

1. 买好 `datoliotalk.com` 后，到卖 domain 的网站（例如 Exabytes、GoDaddy、Namecheap、Cloudflare）的 **DNS 设定**加这几条：

   | 类型 | 名称 / Host | 内容 / Value |
   |---|---|---|
   | CNAME | `www` | `debbiehm.github.io` |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |

   （4 条 A 记录让没打 www 的 `datoliotalk.com` 也能打开。）
2. GitHub → lio-website → Settings → **Pages** → Custom domain 填 `www.datoliotalk.com` → Save。
   DNS 生效通常要几分钟到几小时；绿色勾出现后，勾选 **Enforce HTTPS**。
3. Supabase → Authentication → URL Configuration：**Site URL** 改成 `https://www.datoliotalk.com`。

## 3b. 白话总结（可选，需要 Anthropic API key）

新闻的「白话总结」由 Claude 自动写：读完原文，用自己的话写 2–4 句总结、几个重点，和「跟你有什么关系」。
1. 到 https://console.anthropic.com 开帐号、充值，在 API Keys 建一个 key。
2. GitHub repository → Settings → Secrets and variables → Actions → **New repository secret**：
   名称 `ANTHROPIC_API_KEY`，内容贴上 key。
3. 之后每 3 小时更新新闻时，只总结**新的**新闻（每次最多 60 则），总结过的会存在 `summaries.json` 不重复收费。

费用（大约，每天 100–150 则新新闻）：用 Claude Haiku 5.5，约 US$0.0006 / 则，每月约 US$2–3。
想要写得更好可以换 Claude Opus 5.5（约 US$0.02 / 则，每月约 US$75–110）：同一个页面加一个 **Variables**（不是 Secret）：`LIO_SUMMARY_MODEL` = `claude-opus-5-5`。
没有设 key 也没关系：网站会显示媒体自己的简短摘要。

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
1. 到 Meta Business Suite → **Events Manager** → Connect data sources → **Web** → 取名（例如 Dato Lio Talk）→ 选 **Meta Pixel**。
2. 不用照它的「安装代码」步骤，只要复制 **Pixel ID**（一串数字）填进 `config.js` 的 `META_PIXEL_ID`。
3. 网站会先问访客同意 cookie，按「接受」的人才会加载 Pixel（PDPA）。只记录行为，不传名字、电邮、电话：
   - `PageView` 看了哪一页 · `ViewContent` 看了哪类新闻 · `QuickCheck` 用了「算一算」· `Lead` 注册 · `Contact` 按了私讯 / WhatsApp
4. 之后在 Ads Manager → Audiences → **Custom audience → Website**，例如「过去 30 天看过保险新闻的人」，就可以投广告给他们。
5. 网址换成 datoliotalk.com 后，到 Business Settings → **Domains** 验证网域（Meta 会给一行 DNS 记录）。

## 4. Lio 设定

Lio → ⚙ 设定 → **网站同步**：填 Supabase 网址、anon key、第 1 步的顾问电邮和密码 → 保存（密码用 Windows 加密存在这台电脑）。
之后在保客资料库按 **🔄 同步网站**。

## 本地试用（不用任何帐号）

`config.js` 的网址留空 = 示范模式：注册、资料、上传都只存在那个浏览器里，方便先看效果。
在 `website` 文件夹执行 `python -m http.server 8770`，打开 http://localhost:8770 。
手动更新新闻：`python fetch_news.py`。
