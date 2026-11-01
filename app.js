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
        const { error } = await sb.from("policy_uploads").insert({ user_id: uid, file_path: path, file_name: file.name });
        if (error) throw error; return;
      }
      const d = demo.db; d.uploads = d.uploads || [];
      d.uploads.push({ id: crypto.randomUUID(), user_id: uid, file_path: path, file_name: file.name, created_at: new Date().toISOString() });
      demo.db = d;
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
    const mine = items.filter(x => x.lang === lang);
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
        <span class="tag">${t("cat_" + x.cat)}</span><b>${esc(x.title)}</b>${meta(x)}</a>`;
    if (!items.length) { $("#feat").innerHTML = ""; $("#news").innerHTML = `<p class="muted">${t("news_empty")}</p>`; return; }
    const [top, ...rest] = items, side = rest.slice(0, 3);
    $("#feat").innerHTML = `<a class="top-story" style="--c:${CAT_COLOR[top.cat]}" href="#a/${top.id}">
        <span class="tag">${t("cat_" + top.cat)}</span><h2>${esc(top.title)}</h2>${(top.ai?.summary || top.summary) ? `<p>${esc(top.ai?.summary || top.summary)}</p>` : ""}
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
    document.title = x.title + " · 狮爷谈金融 Lio Talk";
    if (viewed !== x.id) { viewed = x.id; track("ViewContent", { content_category: x.cat }); }
    const more = (news.categories[x.cat] || []).filter(y => y.id !== x.id && (y.lang === x.lang)).slice(0, 6)
      .map(y => `<a class="news" style="--c:${CAT_COLOR[x.cat]}" href="#a/${y.id}"><b>${esc(y.title)}</b>${metaOf(y)}</a>`).join("");
    box.style.setProperty("--c", CAT_COLOR[x.cat]);
    box.innerHTML = `<p class="crumb"><a href="#home">${t("home")}</a> › <a href="#home" data-cat="${x.cat}">${t("cat_" + x.cat)}</a></p>
      <span class="tag">${t("cat_" + x.cat)}</span>
      <h1>${esc(x.title)}</h1>${metaOf(x)}
      ${x.ai ? `<div class="plain"><h3>🦁 ${t("plain_title")}</h3><p>${esc(x.ai.summary)}</p>
        ${x.ai.points.length ? `<ul>${x.ai.points.map(q => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
        ${x.ai.why ? `<p class="why"><b>${t("plain_why")}</b>${esc(x.ai.why)}</p>` : ""}
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
  let me = null, profile = {}, files = [];
  async function session() {
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
    }
    files = await api.uploads(u.id);
    fillForms(); drawNews();
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
    for (const f of e.target.files) {
      if (f.size > 20 * 1024 * 1024) { toast(t("file_big", { name: f.name })); continue; }
      try { await api.upload(me.id, f); } catch (x) { toast(t("err_generic", { m: x.message })); }
    }
    e.target.value = ""; files = await api.uploads(me.id); drawFiles(); markSteps();
  };
  function drawFiles() {
    const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    $("#files").innerHTML = files.length ? files.map((f, i) => `<li>📄 <span>${esc(f.file_name)}</span>
      <small class="muted">${new Date(f.created_at).toLocaleDateString()}</small><button data-del="${i}" aria-label="delete">🗑</button></li>`).join("")
      : `<li class="muted">${t("upload_none")}</li>`;
    $$("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm(t("deleting"))) return;
      await api.removeUpload(files[+b.dataset.del]); files = await api.uploads(me.id); drawFiles(); markSteps();
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
    const p = profile, n = k => (p[k] == null || p[k] === "" ? null : Number(p[k]));
    const rm = v => "RM " + Math.max(0, Math.round(v)).toLocaleString("en-MY");
    const a = age();
    const blocks = [
      ["res_death", "res_death_how", "#1F4E3D", ["living", "support_years", "debts", "education", "assets"],
        () => rm(n("living") * n("support_years") + n("debts") + n("education") - n("assets"))],
      ["res_tpd", "res_tpd_how", "#E8792B", ["income", "debts", "assets"],
        () => a == null ? null : rm(n("income") * Math.max(0, 60 - a) + n("debts") - n("assets"))],
      ["res_ci", "res_ci_how", "#13A08F", ["income"], () => rm(n("income") * 3)],
      ["res_med", "res_med_how", "#3B82C4", ["med_room", "med_annual"],
        () => t("res_room", { a: n("med_room").toLocaleString("en-MY") }) + "<br>" + t("res_annual", { a: n("med_annual").toLocaleString("en-MY") })],
    ];
    const cards = blocks.map(([title, how, c, need, f]) => {
      const ok = need.every(k => n(k) != null), val = ok ? f() : null;
      return `<div style="--c:${c}"><h3>${t(title)}</h3>${val ? `<div class="amt">${val}</div>` : `<div class="missing">${t("res_missing")}</div>`}
        <div class="how">${t(how)}</div></div>`;
    }).join("");
    const wa = cfg.AGENT.whatsapp ? `https://wa.me/${cfg.AGENT.whatsapp}?text=${encodeURIComponent((lang === "zh" ? "你好，我已经在网站提交了保单分析资料：" : "Hi, I've submitted my cover review details on the website: ") + (p.name || ""))}` : "";
    $("#result").innerHTML = `<h2>${t("res_title")}</h2><p class="muted">${t("res_note")}</p><div class="res">${cards}</div>
      <p class="muted small">${t("res_uploads", { n: files.length })}</p>
      ${wa ? `<div class="cta"><span>${t("cta_text")}</span><a class="btn gold" href="${wa}" target="_blank" rel="noopener">${t("cta_btn")}</a></div>` : ""}`;
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
  if (sb) sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") session().then(route); });

  paint(); loadNews();
  session().then(route).catch(x => { toast(t("err_generic", { m: x.message })); route(); });
})();
