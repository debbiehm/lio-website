// 狮爷谈金融 Lio Talk website: news home, sign up / log in, the client's profile + needs, policy uploads, a first look at the gaps.
(() => {
  const cfg = window.LIO_CONFIG, TEXT = window.LIO_TEXT;
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  let lang = localStorage.getItem("lio_lang") || "zh";   // Chinese first; EN is one click away
  const t = (k, v = {}) => (TEXT[lang][k] ?? TEXT.zh[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? "");
  const NUM = ["income", "living", "support_years", "debts", "education", "assets", "dependants", "med_room", "med_annual"];
  const CAT_COLOR = { insurance: "#1F4E3D", policy: "#E8792B", finance: "#13A08F", health: "#3B82C4", energy: "#7A5AF8", ipo: "#B45309", musk: "#111827" };

  // ---------------------------------------------------------------- backend: Supabase, or a browser-only demo
  const live = !cfg.DEMO && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase;
  const recovering = /type=recovery/.test(location.hash);   // came from a "reset password" email (read before Supabase clears it)
  const sb = live ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const demo = {
    get db() { try { return JSON.parse(localStorage.getItem("lio_demo") || "{}"); } catch { return {}; } },
    set db(v) { try { localStorage.setItem("lio_demo", JSON.stringify(v)); } catch {} },
  };
  const api = {
    async user() {
      if (sb) return (await sb.auth.getUser()).data.user;
      const d = demo.db; return d.session ? { id: d.session, email: d.users[d.session].email, user_metadata: d.users[d.session].meta } : null;
    },
    async signUp(email, password, meta) {
      if (sb) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: meta, emailRedirectTo: location.href.split("#")[0] } });
        if (error) throw error;
        return !!data.session;                       // false = must confirm the email first
      }
      const d = demo.db; d.users = d.users || {};
      if (Object.values(d.users).some(u => u.email === email)) throw new Error("already registered");
      const id = crypto.randomUUID(); d.users[id] = { email, password, meta }; d.session = id; demo.db = d; return true;
    },
    async signIn(email, password) {
      if (sb) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return; }
      const d = demo.db, id = Object.keys(d.users || {}).find(k => d.users[k].email === email && d.users[k].password === password);
      if (!id) throw new Error("Invalid login credentials"); d.session = id; demo.db = d;
    },
    async signOut() { if (sb) await sb.auth.signOut(); else { const d = demo.db; delete d.session; demo.db = d; } },
    async reset(email) {
      if (sb) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }); if (error) throw error; }
    },
    async profile(uid) {
      if (sb) { const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle(); if (error) throw error; return data; }
      return (demo.db.profiles || {})[uid] || null;
    },
    async saveProfile(row) {
      row.updated_at = new Date().toISOString();
      if (sb) { const { error } = await sb.from("profiles").upsert(row); if (error) throw error; return; }
      const d = demo.db; d.profiles = d.profiles || {}; d.profiles[row.id] = { ...(d.profiles[row.id] || {}), ...row }; demo.db = d;
    },
    async uploads(uid) {
      if (sb) { const { data, error } = await sb.from("policy_uploads").select("*").eq("user_id", uid).order("created_at"); if (error) throw error; return data; }
      return (demo.db.uploads || []).filter(u => u.user_id === uid);
    },
    async upload(uid, file) {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${uid}/${Date.now()}_${safe}`;
      if (sb) {
        const up = await sb.storage.from("policies").upload(path, file, { contentType: file.type || "application/pdf" });
        if (up.error) throw up.error;
        const { data, error } = await sb.from("policy_uploads").insert({ user_id: uid, file_path: path, file_name: file.name }).select().single();
        if (error) throw error;
        sb.functions.invoke("read-policy", { body: { upload_id: data.id } }).catch(() => {});   // 狮爷 reads it in the background
        return data;
      }
      const d = demo.db; d.uploads = d.uploads || [];
      d.uploads.push({ id: crypto.randomUUID(), user_id: uid, file_path: path, file_name: file.name, created_at: new Date().toISOString() });
      demo.db = d;
    },
    async extracts(uid) {   // what 狮爷 read from each uploaded file (none in the demo)
      if (!sb) return [];
      const { data, error } = await sb.from("policy_extracts").select("*").eq("user_id", uid);
      if (error) return [];
      return data;
    },
    async removeUpload(u) {
      if (sb) { await sb.storage.from("policies").remove([u.file_path]); const { error } = await sb.from("policy_uploads").delete().eq("id", u.id); if (error) throw error; return; }
      const d = demo.db; d.uploads = (d.uploads || []).filter(x => x.id !== u.id); demo.db = d;
    },
  };

  // ---------------------------------------------------------------- text + language
  function paint() {
    document.documentElement.lang = lang === "zh" ? "zh" : "en";
    $$("[data-t]").forEach(el => { el.textContent = t(el.dataset.t); });
    $$("[data-t-ph]").forEach(el => { el.placeholder = t(el.dataset.tPh); });
    $("#lang").textContent = lang === "zh" ? "EN" : "中文";
    $("#foot-demo").textContent = live ? "" : " " + t("demo");
    $("#today").textContent = new Date().toLocaleDateString(lang === "zh" ? "zh-CN" : "en-MY", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    if (!$("#quick-out").hidden) quickCheck();
    drawFollow(); drawMarkets();
    drawArticle();
    const st = $("#state"), cur = st.value;
    st.innerHTML = `<option value="">${t("state_pick")}</option>` + window.LIO_STATES.map(s => `<option>${s}</option>`).join("");
    st.value = cur;
    drawNews(); if (me) drawResult();
    setAuthMode(authMode);
  }
  $("#lang").onclick = () => { lang = lang === "zh" ? "en" : "zh"; try { localStorage.setItem("lio_lang", lang); } catch {} paint(); };
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove("show"), 3500); }

  // ---------------------------------------------------------------- news
  let news = null, cat = "all";
  const byId = {};
  // ---------------------------------------------------------------- 市场速览: today's key numbers, each with a plain explanation
  let markets = null;   // comes with news.json
  function drawMarkets() {
    const box = $("#markets"), m = markets && markets.items;
    if (!m || !Object.keys(m).length || cat !== "all") { box.hidden = true; return; }   // on 全部 only
    const loc = lang === "zh" ? "zh-MY" : "en-MY";
    const num = (v, dp = 2) => Number(v).toLocaleString("en-MY", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    const pct = x => x.pct == null ? "" : `${x.pct > 0 ? "+" : ""}${num(x.pct)}%`;
    const tone = (x, invert) => x.pct == null || Math.abs(x.pct) < 0.005 ? "flat" : ((x.pct > 0) !== !!invert ? "up" : "down");
    const md = d => new Date(d).toLocaleDateString(loc, { month: "short", day: "numeric" });
    const vixMood = v => v < 15 ? t("vix_calm") : v < 20 ? t("vix_normal") : v < 30 ? t("vix_tense") : t("vix_panic");
    const tile = (key, value, sub, cls = "flat") => m[key] || key === "cpi" ? `
      <div class="mk"><span class="mk-name">${t("m_" + key)}</span><b class="mk-val">${value}</b>
        <span class="mk-sub ${cls}">${sub}</span><span class="mk-why">${t("mx_" + key)}</span></div>` : "";
    const a = m, local = [
      a.klci && tile("klci", num(a.klci.value), pct(a.klci), tone(a.klci)),
      a.usdmyr && tile("usdmyr", num(a.usdmyr.value, 4), (a.usdmyr.pct < 0 ? t("myr_up") : a.usdmyr.pct > 0 ? t("myr_down") : t("flat")) + (a.usdmyr.pct ? " " + pct(a.usdmyr) : ""), tone(a.usdmyr, true)),
      a.brent && tile("brent", "US$" + num(a.brent.value), pct(a.brent), "flat"),
      a.opr && tile("opr", num(a.opr.value) + "%", (a.opr.change ? (a.opr.change > 0 ? t("rate_up") : t("rate_down")) : t("rate_same")) + " · " + md(a.opr.asof)),
    ];
    const world = [
      a.spx && tile("spx", num(a.spx.value), pct(a.spx), tone(a.spx)),
      a.ndx && tile("ndx", num(a.ndx.value), pct(a.ndx), tone(a.ndx)),
      a.dji && tile("dji", num(a.dji.value), pct(a.dji), tone(a.dji)),
      a.fed && tile("fed", `${num(a.fed.low)}–${num(a.fed.high)}%`, t("fed_range")),
      a.cpi && tile("cpi", num(a.cpi.value, 1) + "%", (a.pce ? `PCE ${num(a.pce.value, 1)}% · ` : "") + t("yoy", { m: new Date(a.cpi.month + "-01").toLocaleDateString(loc, { year: "numeric", month: "short" }) }),
        a.cpi.value > a.cpi.prev ? "down" : a.cpi.value < a.cpi.prev ? "up" : "flat"),
      a.us10y && tile("us10y", num(a.us10y.value) + "%", a.us10y.change ? `${a.us10y.change > 0 ? "+" : ""}${Math.round(a.us10y.change * 100)} ${t("bps")}` : t("flat")),
      a.dxy && tile("dxy", num(a.dxy.value), pct(a.dxy)),
      a.vix && tile("vix", num(a.vix.value), vixMood(a.vix.value) + " " + pct(a.vix), tone(a.vix, true)),
    ];
    const hl = ((markets.highlight && markets.highlight[lang]) || "").replace(/^\s*(今日重点|Today)\s*[:：]\s*/i, "");   // the page adds its own label
    box.hidden = false;
    box.innerHTML = `<div class="mk-head"><h2>${t("mk_title")}</h2>
        <span>${t("mk_updated", { d: new Date(markets.updated).toLocaleString(loc, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) })}</span></div>
      ${hl ? `<p class="mk-hl"><b>${t("mk_today")}</b>${esc(hl)}</p>` : ""}
      <h3>${t("mk_local")}</h3><div class="mk-row">${local.filter(Boolean).join("")}</div>
      <h3>${t("mk_world")}</h3><div class="mk-row">${world.filter(Boolean).join("")}</div>
      <p class="mk-note">${t("mk_note")}</p>`;
  }

  async function loadNews() {
    try { news = await (await fetch("news.json?v=" + Math.floor(Date.now() / 600000))).json(); } catch { news = { categories: {} }; }
    for (const [c, list] of Object.entries(news.categories || {})) for (const x of list) byId[x.id] = { ...x, cat: c };
    markets = news.markets || null;
    drawNews(); drawArticle(); drawMarkets();
  }
  const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function ago(d) {
    const m = Math.max(1, Math.round((Date.now() - new Date(d)) / 60000));
    return m < 60 ? t("ago_min", { n: m }) : m < 1440 ? t("ago_hour", { n: Math.round(m / 60) }) : t("ago_day", { n: Math.round(m / 1440) });
  }
  function drawNews() {
    if (!news) return;
    const cats = ["all", "ipo", "finance", "energy", "policy", "insurance", "health"];
    $("#news-tabs").innerHTML = cats.map(c => `<button class="${c === cat ? "on" : ""}" style="--c:${CAT_COLOR[c] || "var(--gold)"}" data-cat="${c}">${t("cat_" + c)}</button>`).join("");
    $$("#news-tabs button").forEach(b => b.onclick = () => { cat = b.dataset.cat; location.hash = "#home"; drawNews(); drawMarkets(); window.scrollTo(0, 0); });
    let items = [];
    for (const [c, list] of Object.entries(news.categories || {}))
      if (cat === "all" || cat === c) items.push(...list.map(x => ({ ...x, cat: c })));
    const mine = items.filter(x => x.lang === lang || (lang === "zh" && x.ai && x.ai.title_zh));   // English sources, in Chinese
    items = (mine.length >= 6 ? mine : items).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (cat === "all") {   // take turns, local news first, so one busy topic doesn't fill the page
      const by = c => items.filter(x => x.cat === c), q = ["ipo", "finance", "energy", "policy", "insurance", "health"].map(by), mix = [];
      while (q.some(l => l.length)) for (const l of q) if (l.length) mix.push(l.shift());
      items = mix;
    }
    items = items.slice(0, cat === "all" ? 30 : 20);
    $("#news-updated").textContent = news.updated ? " · " + t("news_updated") : "";
    const meta = metaOf;
    const card = x => `<a class="news" style="--c:${CAT_COLOR[x.cat]}" href="#a/${x.id}">
        <span class="tag">${t("cat_" + x.cat)}</span><b>${esc(title(x))}</b>${meta(x)}</a>`;
    if (!items.length) { $("#feat").innerHTML = ""; $("#news").innerHTML = `<p class="muted">${t("news_empty")}</p>`; return; }
    const [top, ...rest] = items, side = rest.slice(0, 3);
    $("#feat").innerHTML = `<a class="top-story" style="--c:${CAT_COLOR[top.cat]}" href="#a/${top.id}">
        <span class="tag">${t("cat_" + top.cat)}</span><h2>${esc(title(top))}</h2>${(ai(top)?.summary || top.summary) ? `<p>${esc(ai(top)?.summary || top.summary)}</p>` : ""}
        ${meta(top)}<span class="read">${t("open_story")}</span></a>
      <div class="also">${side.map(card).join("")}</div>`;
    const promo = `<div class="promo"><img src="assets/lio.png" alt=""><div><b>${t("promo_title")}</b><p>${t("promo_text")}</p>
        <button class="gold" ${me ? 'data-me="1"' : 'data-open="register"'}>${t("promo_btn")}</button></div></div>`;
    const list = rest.slice(3).map(card);
    list.splice(Math.min(6, list.length), 0, promo);
    $("#news").innerHTML = list.join("");
    $$("#news [data-open]").forEach(b => b.onclick = () => openAuth("register"));
    $$("#news [data-me]").forEach(b => b.onclick = () => { location.hash = "#me"; });
  }

  // 狮爷摘要 is written in Chinese: shown on the Chinese site, with the Chinese headline for English sources
  function ai(x) { return lang === "zh" ? x.ai : null; }
  function title(x) { return (lang === "zh" && x.ai && x.ai.title_zh) || x.title; }

  function metaOf(x) {
    return `<span class="meta">${x.site ? `<img src="https://www.google.com/s2/favicons?domain=${esc(x.site)}&sz=32" alt="" loading="lazy" onerror="this.remove()">` : ""}
      ${esc(x.source)}${x.date ? " · " + ago(x.date) : ""}</span>`;
  }

  // ---------------------------------------------------------------- one story on this site: summary first, the original link at the bottom
  let viewed = null;
  function drawArticle() {
    const m = (location.hash || "").match(/^#a\/(\w+)/);
    if (!m || !news) return;
    const x = byId[m[1]], box = $("#article");
    if (!x) { box.innerHTML = `<p class="muted">${t("story_gone")}</p><a class="btn primary" href="#home">${t("back_home")}</a>`; return; }
    document.title = title(x) + " · 狮爷谈金融 Lio Talk";
    if (viewed !== x.id) { viewed = x.id; track("ViewContent", { content_category: x.cat }); }
    const more = (news.categories[x.cat] || []).filter(y => y.id !== x.id && (y.lang === x.lang || (lang === "zh" && y.ai && y.ai.title_zh))).slice(0, 6)
      .map(y => `<a class="news" style="--c:${CAT_COLOR[x.cat]}" href="#a/${y.id}"><b>${esc(title(y))}</b>${metaOf(y)}</a>`).join("");
    box.style.setProperty("--c", CAT_COLOR[x.cat]);
    box.innerHTML = `<p class="crumb"><a href="#home">${t("home")}</a> › <a href="#home" data-cat="${x.cat}">${t("cat_" + x.cat)}</a></p>
      <span class="tag">${t("cat_" + x.cat)}</span>
      <h1>${esc(title(x))}</h1>${title(x) !== x.title ? `<p class="orig">${t("orig_title")}${esc(x.title)}</p>` : ""}${metaOf(x)}
      ${ai(x) ? `<div class="plain"><h3>🦁 ${t("plain_title")}</h3><p>${esc(ai(x).summary)}</p>
        ${ai(x).points.length ? `<ul>${ai(x).points.map(q => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
        ${ai(x).why ? `<p class="why"><b>${t("plain_why")}</b>${esc(ai(x).why)}</p>` : ""}
        <p class="ai-note">${t("plain_note")}</p></div>`
      : `<div class="summary">${x.summary ? `<p>${esc(x.summary)}</p>` : `<p class="muted">${t("no_summary")}</p>`}</div>`}
      <div class="hint"><img src="assets/lio_head.png" alt=""><div><b>${t("hint_" + x.cat)}</b>
        <button class="gold" ${me ? 'data-me="1"' : 'data-open="register"'}>${me ? t("hero_cta_in") : t("promo_btn")}</button></div></div>
      <div class="source-box"><span class="muted small">${t("source_note")}</span>
        <b>${esc(x.source)}</b><a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.link.replace(/^https?:\/\//, "").slice(0, 90))}${x.link.length > 98 ? "…" : ""}</a>
        <a class="btn primary" href="${esc(x.link)}" target="_blank" rel="noopener">${t("read")}</a></div>
      ${more ? `<h3>${t("related")}</h3><div class="related">${more}</div>` : ""}`;
    $$("[data-open]", box).forEach(b => b.onclick = () => openAuth("register"));
    $$("[data-me]", box).forEach(b => b.onclick = () => { location.hash = "#me"; });
    $$("[data-cat]", box).forEach(b => b.onclick = e => { e.preventDefault(); cat = b.dataset.cat; location.hash = "#home"; drawNews(); drawMarkets(); });
  }

  // ---------------------------------------------------------------- 关注狮爷: follow / message on social media (only what's filled in config.js)
  function drawFollow() {
    const s = cfg.SOCIAL || {}, wa = cfg.AGENT.whatsapp, ig = (s.instagram || "").replace(/^@/, "");
    const links = [
      s.facebook && ["fb", s.facebook, "Facebook"],
      ig && ["ig", "https://www.instagram.com/" + ig, "Instagram"],
      s.messenger && ["msg", "https://m.me/" + s.messenger, t("btn_messenger")],
      ig && ["igdm", "https://ig.me/m/" + ig, t("btn_igdm")],
      wa && ["wa", `https://wa.me/${wa}?text=${encodeURIComponent(t("wa_hello"))}`, "WhatsApp"],
    ].filter(Boolean);
    const box = $("#follow");
    box.hidden = !links.length;
    box.innerHTML = `<h3>${t("follow_title")}</h3><p class="small">${t("follow_text")}</p><div class="soc">${links.map(([k, href, label]) =>
      `<a class="s-${k}" href="${esc(href)}" target="_blank" rel="noopener" data-soc="${k}">${label}</a>`).join("")}</div>`;
    $$("[data-soc]", box).forEach(a => a.onclick = () => track("Contact", { content_name: a.dataset.soc }));
  }

  // ---------------------------------------------------------------- Meta Pixel, only with the visitor's consent (PDPA)
  const PIXEL = (cfg.META_PIXEL_ID || "").trim();
  function consent() { try { return localStorage.getItem("lio_cookie"); } catch { return null; } }
  function loadPixel() {
    if (!PIXEL || window.fbq || consent() !== "yes") return;
    /* Meta's standard loader */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", PIXEL);
    fbq("track", "PageView");
  }
  // what people do, never who they are: no names, emails or numbers are sent
  function track(ev, data = {}, custom = false) { if (window.fbq) fbq(custom ? "trackCustom" : "track", ev, data); }
  function cookieBar(show) { $("#cookie").hidden = !show; }
  if (PIXEL) {
    $("#cookie-open").hidden = false;
    $("#cookie-open").onclick = () => cookieBar(true);
    $("#cookie-ok").onclick = () => { try { localStorage.setItem("lio_cookie", "yes"); } catch {} cookieBar(false); loadPixel(); };
    $("#cookie-no").onclick = () => {
      const was = consent() === "yes";
      try { localStorage.setItem("lio_cookie", "no"); } catch {}
      cookieBar(false);
      if (was) location.reload();             // stop the pixel that is already running
    };
    if (!consent()) setTimeout(() => cookieBar(true), 1500);
    loadPixel();
  }

  // ---------------------------------------------------------------- quick check: no sign-up needed (same formulas as the review)
  function quickCheck() {
    const f = $("#quick"), n = k => Number(String(f[k].value).replace(/[,\sRM]/gi, "")) || 0, out = $("#quick-out");
    const age = n("age"), income = n("income"), debts = n("debts");
    out.hidden = false;
    if (!age || !income) { out.innerHTML = `<p class="err">${t("q_need")}</p>`; return; }
    const rm = v => "RM " + Math.max(0, Math.round(v)).toLocaleString("en-MY");
    try { sessionStorage.setItem("lio_quick", JSON.stringify({ income, debts })); } catch {}
    track("QuickCheck", {}, true);
    out.innerHTML = `<div class="q-row"><span>${t("q_tpd")}</span><b>${rm(income * Math.max(0, 60 - age) + debts)}</b></div>
      <div class="q-row"><span>${t("q_ci")}</span><b>${rm(income * 3)}</b></div>
      <p class="small">${t("q_after")}</p>
      <button class="primary" id="q-cta">${me ? t("hero_cta_in") + " →" : t("q_cta")}</button>`;
    $("#q-cta").onclick = () => me ? (location.hash = "#me") : openAuth("register");
  }
  $("#quick").onsubmit = e => { e.preventDefault(); quickCheck(); };

  // ---------------------------------------------------------------- log in / sign up
  let authMode = "login";
  function setAuthMode(m) {
    authMode = m; const d = $("#auth"); d.className = m;
    $$(".auth-tabs button").forEach(b => b.classList.toggle("on", b.dataset.auth === m));
    $("#auth-go").textContent = t(m === "login" ? "go_login" : "go_register");
    $('[name="password"]', d).autocomplete = m === "login" ? "current-password" : "new-password";
  }
  function openAuth(m) { setAuthMode(m); $("#auth-err").textContent = ""; $("#auth").showModal(); }
  $$("[data-open]").forEach(b => b.onclick = () => openAuth(b.dataset.open));
  $$(".auth-tabs button").forEach(b => b.onclick = () => setAuthMode(b.dataset.auth));
  $("#auth-form").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = $("#auth-err"); err.textContent = "";
    try {
      if (authMode === "register") {
        if (!f.consent) { err.textContent = t("need_consent"); return; }
        const meta = { name: f.name.trim(), phone: f.phone.trim(), consent_at: new Date().toISOString() };
        const inNow = await api.signUp(f.email.trim(), f.password, meta);
        track("Lead");
        if (!inNow) { $("#auth").close(); toast(t("check_email")); return; }
      } else {
        await api.signIn(f.email.trim(), f.password);
        toast(t("welcome"));
      }
      $("#auth").close(); e.target.reset(); await session(); location.hash = "#me";
    } catch (x) { err.textContent = t("err_generic", { m: x.message || x }); }
  };
  $("#forgot").onclick = async () => {
    const email = $('#auth-form [name="email"]').value.trim();
    if (!email) { $("#auth-err").textContent = t("need_email"); return; }
    try { await api.reset(email); toast(t("reset_sent")); } catch (x) { $("#auth-err").textContent = t("err_generic", { m: x.message }); }
  };
  $("#logout").onclick = async () => { await api.signOut(); me = null; document.body.classList.remove("in"); location.hash = "#home"; route(); drawNews(); };

  // ---------------------------------------------------------------- my page
  let me = null, profile = {}, files = [], reads = {};   // reads: upload id -> policy_extracts row
  function session() {   // sign-in fires this twice at once (the form and the auth event): share one run
    return session.run || (session.run = loadSession().finally(() => { session.run = null; }));
  }
  async function loadSession() {
    const u = await api.user();
    document.body.classList.toggle("in", !!u);
    if (!u) { me = null; return; }
    me = u;
    profile = (await api.profile(u.id)) || {};
    if (!profile.id) {   // first log-in: create the profile from what was typed at sign-up
      const m = u.user_metadata || {};
      profile = { id: u.id, email: u.email, name: m.name || "", phone: m.phone || "", consent_at: m.consent_at || new Date().toISOString() };
      try { const q = JSON.parse(sessionStorage.getItem("lio_quick") || "{}"); if (q.income) profile.income = q.income; if (q.debts) profile.debts = q.debts; } catch {}
      await api.saveProfile({ ...profile });
      if (sb) sb.functions.invoke("read-policy", { body: { event: "signup" } }).catch(() => {});   // Telegram notice to the adviser
    }
    await loadFiles();
    fillForms(); drawNews();
  }
  async function loadFiles() {
    loadFiles.asked = loadFiles.asked || new Set();
    files = await api.uploads(me.id);
    reads = Object.fromEntries((await api.extracts(me.id)).map(r => [r.upload_id, r]));
    if (sb) for (const f of files)   // uploaded before 狮爷 could read (or the request was lost): ask once
      if (!reads[f.id] && !loadFiles.asked.has(f.id)) {
        loadFiles.asked.add(f.id);
        reads[f.id] = { upload_id: f.id, status: "reading" };
        sb.functions.invoke("read-policy", { body: { upload_id: f.id } }).catch(() => {});
      }
    clearTimeout(loadFiles.poll);
    if (files.some(f => reads[f.id]?.status === "reading"))   // still reading: look again shortly
      loadFiles.poll = setTimeout(async () => { if (!me) return; await loadFiles(); drawFiles(); drawResult(); }, 6000);
  }
  function fillForms() {
    for (const form of [$("#step-basic"), $("#step-money")])
      for (const el of form.elements) if (el.name && profile[el.name] != null) el.value = profile[el.name];
    drawFiles(); drawResult(); markSteps();
  }
  function markSteps() {
    const done = { basic: !!(profile.name && profile.phone && profile.state), money: !!(profile.income || profile.living),
                   upload: files.length > 0, result: false };
    $$("#steps button").forEach(b => b.classList.toggle("done", !!done[b.dataset.step]));
  }
  function showStep(s) {
    $$("#steps button").forEach(b => b.classList.toggle("on", b.dataset.step === s));
    $$(".step").forEach(el => el.hidden = el.id !== "step-" + s);
    if (s === "result") drawResult();
  }
  $$("#steps button").forEach(b => b.onclick = () => showStep(b.dataset.step));
  $$("[data-goto]").forEach(b => b.onclick = () => showStep(b.dataset.goto));
  for (const [id, next] of [["#step-basic", "money"], ["#step-money", "upload"]]) {
    $(id).onsubmit = async e => {
      e.preventDefault();
      const row = { id: me.id, email: me.email };
      for (const el of e.target.elements) {
        if (!el.name) continue;
        const v = el.value.trim();
        row[el.name] = NUM.includes(el.name) ? (v === "" ? null : Number(v.replace(/[,\sRM]/gi, ""))) : v;
        if (NUM.includes(el.name) && v !== "" && Number.isNaN(row[el.name])) { el.focus(); toast(t("err_generic", { m: el.previousElementSibling.textContent })); return; }
      }
      try {
        await api.saveProfile(row); Object.assign(profile, row);
        const s = $(".saved", e.target); s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 1500);
        markSteps(); showStep(next);
      } catch (x) { toast(t("err_generic", { m: x.message })); }
    };
  }
  $("#file").onchange = async e => {
    for (let f of e.target.files) {
      if (f.size > 20 * 1024 * 1024) { toast(t("file_big", { name: f.name })); continue; }
      try {
        f = await unlockPdf(f);          // null = the client skipped a password-protected file
        if (f) await api.upload(me.id, f);
      } catch (x) { toast(t("err_generic", { m: x.message })); }
    }
    e.target.value = ""; await loadFiles(); drawFiles(); markSteps();
  };
  // A password-protected PDF can't be read by 狮爷, so it is opened here, in the client's own browser, and the unlocked
  // copy is uploaded. The password never leaves this device and is not saved.
  async function isLockedPdf(f) {
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) return false;
    const buf = new Uint8Array(await f.arrayBuffer());
    const txt = new TextDecoder("latin1").decode(buf.length > 200000 ? new Uint8Array([...buf.slice(0, 4096), ...buf.slice(-65536)]) : buf);
    return /\/Encrypt\b/.test(txt);
  }
  async function unlockPdf(f) {
    if (!(await isLockedPdf(f))) return f;
    const mupdf = await import("https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf.js");
    const doc = mupdf.Document.openDocument(await f.arrayBuffer(), "application/pdf");
    if (doc.needsPassword()) {
      let msg = t("pw_text", { name: f.name });
      for (;;) {
        const pw = await askPassword(msg);
        if (pw == null) return null;
        if (doc.authenticatePassword(pw)) break;
        msg = t("pw_wrong", { name: f.name });
      }
    }
    const out = doc.asPDF().saveToBuffer("decrypt").asUint8Array();
    return new File([out], f.name, { type: "application/pdf" });
  }
  function askPassword(msg) {
    const box = $("#pw-box"), input = $("#pw-input");
    $("#pw-msg").textContent = msg; input.value = ""; box.hidden = false; input.focus();
    return new Promise(done => {
      const finish = v => { box.hidden = true; input.value = ""; done(v); };
      $("#pw-ok").onclick = () => finish(input.value);
      $("#pw-skip").onclick = () => finish(null);
      input.onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); finish(input.value); } };
    });
  }
  function drawFiles() {
    const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const state = f => {
      const r = reads[f.id];
      if (!sb) return "";
      if (!r || r.status === "reading") return `<small class="rd reading">⏳ ${t("rd_reading")}</small>`;
      if (r.status === "failed") return `<small class="rd failed">⚠ ${t("rd_failed")}</small>`;
      const ps = (r.data && r.data.policies) || [];
      if (!r.data?.readable || !ps.length) return `<small class="rd failed">⚠ ${t("rd_nothing")}</small>`;
      return `<small class="rd done">✓ ${esc(ps.map(p => [p.insurer, p.plan].filter(Boolean).join(" ")).join("、"))}</small>`;
    };
    $("#files").innerHTML = files.length ? files.map((f, i) => `<li>📄 <span>${esc(f.file_name)}${state(f)}</span>
      <small class="muted">${new Date(f.created_at).toLocaleDateString()}</small><button data-del="${i}" aria-label="delete">🗑</button></li>`).join("")
      : `<li class="muted">${t("upload_none")}</li>`;
    $$("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm(t("deleting"))) return;
      await api.removeUpload(files[+b.dataset.del]); await loadFiles(); drawFiles(); markSteps();
    });
  }
  function age() {
    const ic = String(profile.ic || "").replace(/\D/g, "");
    if (ic.length !== 12) return null;
    let y = +ic.slice(0, 2); const now = new Date(); y += 2000 + y <= now.getFullYear() ? 2000 : 1900;
    const born = new Date(y, +ic.slice(2, 4) - 1, +ic.slice(4, 6));
    return Number.isNaN(born.getTime()) ? null : Math.floor((now - born) / 31557600000);
  }
  function drawResult() {
    if (!me) return;
    const esc2 = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const p = profile, n = k => (p[k] == null || p[k] === "" ? null : Number(p[k]));
    const rm = v => "RM " + Math.max(0, Math.round(v)).toLocaleString("en-MY");
    const a = age();
    const z = k => n(k) ?? 0;   // debts, education and savings may be left blank (= none)
    // what the uploaded policies already cover for this client (policies on other family members are listed, not counted)
    const read = files.map(f => reads[f.id]).filter(r => r?.status === "done" && r.data?.readable);
    const all = read.flatMap(r => (r.data.policies || []).map(pol => ({ ...pol, illustration: r.data.doc_type === "illustration" })));
    const norm = s => String(s || "").toUpperCase().replace(/\b(BIN|BINTI|A\/L|A\/P|@)\b/g, " ").split(/[^A-Z0-9\u4e00-\u9fff]+/).filter(w => w.length > 1);
    const mine = pol => { const a2 = norm(pol.life_assured), b2 = norm(p.name);
      return !a2.length || !b2.length || a2.filter(w => b2.includes(w)).length >= Math.min(2, b2.length); };
    const inForce = all.filter(pol => !pol.illustration), myPol = inForce.filter(mine);
    const sum = k => myPol.reduce((s, pol) => s + (Number(pol[k]) || 0), 0);
    const best = k => myPol.reduce((m, pol) => Math.max(m, Number(pol[k]) || 0), 0);
    const have = read.length ? { res_death: sum("life"), res_tpd: sum("tpd"), res_ci: sum("ci") } : null;
    const blocks = [
      ["res_death", "res_death_how", "#1F4E3D", ["living", "support_years"],
        () => n("living") * n("support_years") + z("debts") + z("education") - z("assets")],
      ["res_tpd", "res_tpd_how", "#E8792B", ["income"],
        () => a == null ? null : n("income") * Math.max(0, 60 - a) + z("debts") - z("assets")],
      ["res_ci", "res_ci_how", "#13A08F", ["income"], () => n("income") * 3],
    ];
    const gapLine = (need, got) => need == null ? "" : got >= need
      ? `<div class="gap ok">${t("gap_have", { a: rm(got) })} · ✓ ${t("gap_enough")}</div>`
      : `<div class="gap">${t("gap_have", { a: rm(got) })} · <b>${t("gap_short", { a: rm(need - got) })}</b></div>`;
    const cards = blocks.map(([title, how, c, need, f]) => {
      const ok = need.every(k => n(k) != null), val = ok ? f() : null;
      const why = ok && title === "res_tpd" ? t("res_need_ic") : t("res_missing");   // TPD needs the age, from the IC
      return `<div style="--c:${c}"><h3>${t(title)}</h3>${val != null ? `<div class="amt">${rm(val)}</div>` : `<div class="missing">${why}</div>`}
        ${have && val != null ? gapLine(Math.max(0, val), have[title]) : ""}<div class="how">${t(how)}</div></div>`;
    }).join("") + (() => {   // medical: the room and limit wanted vs the best card held
      const wantRoom = n("med_room"), wantYear = n("med_annual");
      const want = [wantRoom != null && t("res_room", { a: wantRoom.toLocaleString("en-MY") }),
                    wantYear != null && t("res_annual", { a: wantYear.toLocaleString("en-MY") })].filter(Boolean).join("<br>");
      const room = best("room_board"), year = best("annual_limit"), card = myPol.some(pol => pol.medical_card);
      const got = !have ? "" : !card ? `<div class="gap"><b>${t("gap_no_card")}</b></div>`
        : `<div class="gap ${(wantRoom == null || room >= wantRoom) && (wantYear == null || year >= wantYear) ? "ok" : ""}">${t("gap_card", { r: room ? room.toLocaleString("en-MY") : "?", y: year ? year.toLocaleString("en-MY") : "?" })}</div>`;
      return `<div style="--c:#3B82C4"><h3>${t("res_med")}</h3>${want ? `<div class="amt">${want}</div>` : `<div class="missing">${t("res_missing")}</div>`}
        ${got}<div class="how">${t("res_med_how")}</div></div>`;
    })();
    const reading = files.some(f => sb && (!reads[f.id] || reads[f.id].status === "reading"));
    const polRow = pol => `<tr><td><b>${esc2(pol.insurer || "")}</b><br>${esc2(pol.plan || "")}${pol.illustration ? ` <small class="muted">(${t("ex_illustration")})</small>` : ""}</td>
      <td>${esc2(pol.life_assured || "")}</td>
      <td>${[pol.life && `${t("ex_life")} ${rm(pol.life)}`, pol.ci && `${t("ex_ci")} ${rm(pol.ci)}`, pol.early_ci && `${t("ex_early_ci")} ${rm(pol.early_ci)}`,
             pol.medical_card && `${t("ex_med")}${pol.room_board ? " " + pol.room_board : ""}${pol.annual_limit ? " / " + rm(pol.annual_limit) : ""}`,
             pol.accident_death && `${t("ex_pa")} ${rm(pol.accident_death)}`].filter(Boolean).join("<br>") || "—"}</td>
      <td>${pol.premium ? `RM ${Number(pol.premium).toLocaleString("en-MY")}${pol.payment_mode ? " / " + esc2(pol.payment_mode) : ""}` : "—"}</td></tr>`;
    const existing = !sb ? "" : `<h3 class="ex-h">${t("ex_title")}</h3>${reading ? `<p class="rd reading">⏳ ${t("rd_reading_all")}</p>` : ""}
      ${all.length ? `<div class="ex-wrap"><table class="ex"><thead><tr><th>${t("ex_policy")}</th><th>${t("ex_la")}</th><th>${t("ex_cover")}</th><th>${t("ex_premium")}</th></tr></thead>
        <tbody>${all.map(polRow).join("")}</tbody></table></div>
        <p class="muted small">${t("ex_note")}</p>` : ""}`;
    const wa = cfg.AGENT.whatsapp ? `https://wa.me/${cfg.AGENT.whatsapp}?text=${encodeURIComponent((lang === "zh" ? "你好，我已经在网站提交了保单分析资料：" : "Hi, I've submitted my cover review details on the website: ") + (p.name || ""))}` : "";
    // the numbers come only from step 2; the uploaded policies are read by the adviser, so say both plainly
    const noMoney = NUM.every(k => n(k) == null);
    const askMoney = noMoney ? `<div class="res-todo"><b>${t("res_need_money")}</b><p>${t("res_need_money_text")}</p>
        <button class="primary" data-step-to="money">${t("res_go_money")}</button></div>` : "";
    const policies = files.length
      ? `<div class="res-got">✓ ${t("res_got_policies", { n: files.length })}</div>`
      : `<div class="res-todo"><b>${t("upload_none")}</b><p>${t("res_need_upload")}</p><button class="primary" data-step-to="upload">${t("step_upload")}</button></div>`;
    $("#result").innerHTML = `<h2>${t("res_title")}</h2>${askMoney}${noMoney ? "" : `<p class="muted">${t(have ? "res_note_ai" : "res_note")}</p><div class="res">${cards}</div>`}
      ${policies}${existing}
      ${wa ? `<div class="cta"><span>${t("cta_text")}</span><a class="btn gold" href="${wa}" target="_blank" rel="noopener">${t("cta_btn")}</a></div>` : ""}`;
    $$("[data-step-to]", $("#result")).forEach(b => b.onclick = () => showStep(b.dataset.stepTo));
  }

  // ---------------------------------------------------------------- pages
  let routed = false;
  function route() {
    let page = (location.hash || "#home").slice(1);
    if (page === "me" && !me) { page = "home"; setAuthMode("login"); $("#auth").showModal(); }
    if (page.startsWith("a/")) page = "article";
    if (!$("#page-" + page)) page = "home";
    if (page !== "article") document.title = "狮爷谈金融 Lio Talk";
    $$(".page").forEach(s => s.hidden = s.id !== "page-" + page);
    const slot = $("#page-" + page + " .side-slot");
    if (slot) slot.appendChild($("#side"));   // the quick check follows the reader onto the story page
    if (page === "article") drawArticle();
    if (routed) track("PageView");             // the site is one page: count each screen
    routed = true;
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  if (sb) sb.auth.onAuthStateChange((ev) => {
    if (ev === "PASSWORD_RECOVERY") askNewPassword();
    if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") session().then(route);
  });
  // the reset-password email lands here: let the person choose a new password
  function askNewPassword() {
    const d = $("#newpw");
    if (d.open) return;
    $("#newpw-err").textContent = ""; $("#newpw-input").value = "";
    d.showModal();
  }
  $("#newpw-form").onsubmit = async e => {
    e.preventDefault();
    const pw = $("#newpw-input").value;
    if (pw.length < 8) { $("#newpw-err").textContent = t("f_password"); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { $("#newpw-err").textContent = t("err_generic", { m: error.message }); return; }
    $("#newpw").close(); toast(t("newpw_done"));
    if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname);
  };
  if (sb && recovering) setTimeout(askNewPassword, 800);

  paint(); loadNews();
  session().then(route).catch(x => { toast(t("err_generic", { m: x.message })); route(); });
})();
