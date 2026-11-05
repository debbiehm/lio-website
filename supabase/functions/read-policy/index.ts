// 狮爷谈金融 Lio Talk: read an uploaded insurance policy with Claude and save what it says.
//
// The website calls this right after a client uploads a file: POST { upload_id } with the client's login token.
// It answers at once (202) and keeps working in the background; the result lands in public.policy_extracts,
// which the website polls. Secrets (Supabase → Edge Functions → Secrets): ANTHROPIC_API_KEY.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = Deno.env.get("LIO_POLICY_MODEL") || "claude-sonnet-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const num = { type: ["number", "null"] };
const str = { type: "string" };   // "" = not stated (the API allows at most 16 nullable fields, so text stays plain)
const POLICY = {
  type: "object",
  additionalProperties: false,
  properties: {
    insurer: str, plan: str, policy_no: str, owner: str, life_assured: str,
    start_date: str, cover_until: str,
    premium: num, payment_mode: str, annual_premium: num,
    life: num, tpd: num, ci: num, early_ci: num, accident_death: num,
    medical_card: { type: "boolean" }, room_board: num, annual_limit: num, lifetime_limit: num,
    lifetime_unlimited: { type: "boolean" }, deductible: num, coinsurance_pct: num, hospital_income_daily: num,
    waiver: { type: "boolean" }, investment_linked: { type: "boolean" },
    riders: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { name: { type: "string" }, benefit: { type: "string" }, amount: num },
        required: ["name", "benefit", "amount"],
      },
    },
    notes: { type: "string" },
  },
  required: ["insurer", "plan", "policy_no", "owner", "life_assured", "start_date", "cover_until", "premium", "payment_mode",
    "annual_premium", "life", "tpd", "ci", "early_ci", "accident_death", "medical_card", "room_board", "annual_limit",
    "lifetime_limit", "lifetime_unlimited", "deductible", "coinsurance_pct", "hospital_income_daily", "waiver",
    "investment_linked", "riders", "notes"],
};
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    doc_type: { type: "string", enum: ["policy", "illustration", "statement", "other"] },
    readable: { type: "boolean" },
    policies: { type: "array", items: POLICY },
    notes: { type: "string" },
  },
  required: ["doc_type", "readable", "policies", "notes"],
};

const SYSTEM = `You read Malaysian life and medical insurance documents for a licensed financial adviser (Great Eastern agency) so she can review a client's existing cover. Accuracy matters more than completeness: a wrong number is worse than an empty one.

Extract only what the document states. Never estimate, infer from typical products, or fill gaps from general knowledge. If a value is not clearly stated, use null for numbers, "" for text, false for yes/no fields, and say so in notes.

What to read:
- doc_type: "policy" (policy contract / schedule / certificate), "illustration" (sales/benefit illustration or quotation, not in force), "statement" (annual / ILP statement), "other" (not an insurance document). readable=false if the pages are blank, unreadable or not insurance.
- One entry in policies per policy (a file may hold several). insurer as printed (e.g. Great Eastern Life, Prudential, AIA, Allianz, Etiqa, Zurich, Tokio Marine, Manulife, Sun Life, Takaful companies). plan = the basic plan name. owner / life_assured = names as printed (no IC numbers).
- Amounts in Malaysian ringgit as plain numbers (RM 100,000.00 -> 100000; "3M" -> 3000000). Dates as DD/MM/YYYY when given.
- premium = the instalment amount actually payable per payment_mode (monthly / quarterly / half-yearly / yearly / single), total of basic plan and riders if a total is shown; annual_premium only if stated or the mode makes it exact (monthly x 12 etc.).
- life = death benefit sum assured; tpd = total & permanent disability (often equals life when stated as Death/TPD); ci = critical illness lump sum (late stage); early_ci = early / multi-stage CI cover; accident_death = extra accidental death benefit.
- Medical card: medical_card=true for hospital & surgical / medical rider; room_board = daily room & board; annual_limit; lifetime_limit or lifetime_unlimited=true if "no lifetime limit"; deductible; coinsurance_pct. Great Eastern codes like "SMART HEALTH PROTECTOR-200-500-3M" mean room 200, deductible 500, annual limit 3,000,000. Hospital cash per day is hospital_income_daily, not a medical card.
- waiver = premium waiver / payor benefit rider present. investment_linked = investment-linked plan (funds, units).
- riders: every rider with its benefit in a few words and amount (sum assured / limit) if stated. Great Eastern GCCR policies: life = sum assured and the "Top 5" critical illnesses pay the sum assured -> put it in ci. CIBAR / critical illness benefit rider -> ci; SMCC / multi-stage -> early_ci; SMARTPROTECT YOU includes RM20,000 accidental death only if the document shows it.
- notes (Simplified Chinese, short): anything uncertain, missing pages, illustration-only figures, or values you left empty and why.`;

// Telegram notice to the adviser (secrets TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID; skipped if not set).
// Names, insurer and plan only: no IC numbers or amounts.
async function telegram(text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
  } catch (e) {
    console.error("telegram", e);
  }
}

// deno-lint-ignore no-explicit-any
async function clientName(admin: any, userId: string) {
  const { data } = await admin.from("profiles").select("name, state").eq("id", userId).maybeSingle();
  return [data?.name || "（未填名字）", data?.state].filter(Boolean).join(" · ");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "not signed in" }, 401);

  const { upload_id, event } = await req.json().catch(() => ({}));
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (event === "signup") {   // a new client's first log-in: tell the adviser (only right after the profile is made)
    const { data: prof } = await admin.from("profiles").select("name, phone, state, created_at").eq("id", user.id).maybeSingle();
    const fresh = prof && Date.now() - new Date(prof.created_at).getTime() < 30 * 60 * 1000;
    // once per client: the first call creates a small marker file; a second call (the page can sign in twice) can't
    const claimed = fresh && !(await admin.storage.from("policies")
      .upload(`_notified/${user.id}`, new Blob(["1"]), { upsert: false })).error;
    if (claimed) {
      await telegram(`🦁 新保客注册：${prof.name || "（未填名字）"}${prof.state ? " · " + prof.state : ""}${prof.phone ? "\n📞 " + prof.phone : ""}\n在 Lio 按「同步网站」查看`);
    }
    return json({ ok: true });
  }

  // the row is only visible to its owner (or the agent) under the database rules, so this also checks permission
  const { data: up } = await asUser.from("policy_uploads").select("*").eq("id", upload_id).maybeSingle();
  if (!up) return json({ error: "upload not found" }, 404);

  // one read per upload: a second call while it's reading (or once it's done) does nothing; a failed read may be retried
  const row = { upload_id: up.id, user_id: up.user_id, status: "reading", data: null, error: null, model: MODEL,
    updated_at: new Date().toISOString() };
  const { error: dup } = await admin.from("policy_extracts").insert(row);
  if (dup) {
    const { data: old } = await admin.from("policy_extracts").select("status, updated_at").eq("upload_id", up.id).maybeSingle();
    const stale = old && Date.now() - new Date(old.updated_at).getTime() > 10 * 60 * 1000;
    if (!old || old.status === "done" || (old.status === "reading" && !stale)) return json({ status: old?.status ?? "reading" }, 202);
    const { data: took } = await admin.from("policy_extracts").update(row).eq("upload_id", up.id)
      .eq("updated_at", old.updated_at).select("upload_id");
    if (!took?.length) return json({ status: "reading" }, 202);   // another call got there first
  }
  // keep working after answering, so the page doesn't wait for the whole read
  EdgeRuntime.waitUntil(read(admin, up).catch(async (e) => {
    console.error("read-policy", up.id, e);
    await admin.from("policy_extracts").update({ status: "failed", error: String(e?.message ?? e).slice(0, 500),
      updated_at: new Date().toISOString() }).eq("upload_id", up.id);
    await telegram(`⚠ ${await clientName(admin, up.user_id)} 上传了「${up.file_name}」，狮爷读不到，请人工查看。`);
  }));
  return json({ status: "reading" }, 202);
});

// deno-lint-ignore no-explicit-any
async function read(admin: any, up: { id: string; user_id: string; file_path: string; file_name: string }) {
  const { data: blob, error } = await admin.storage.from("policies").download(up.file_path);
  if (error || !blob) throw new Error("could not open the file: " + (error?.message ?? "missing"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const name = up.file_name.toLowerCase();
  const isPdf = name.endsWith(".pdf") || blob.type === "application/pdf";
  const head = new TextDecoder().decode(bytes.slice(0, 2048)) + new TextDecoder().decode(bytes.slice(-4096));
  if (isPdf && head.includes("/Encrypt")) throw new Error("PDF 有密码，无法读取");
  const media = isPdf ? "application/pdf" : (blob.type || (name.endsWith(".png") ? "image/png" : "image/jpeg"));
  const doc = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: encodeBase64(bytes) } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: media as "image/jpeg" | "image/png", data: encodeBase64(bytes) } };

  const client = new Anthropic();   // ANTHROPIC_API_KEY from the function's secrets
  const msg = await client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                       // if a safety check declines, another model retries server-side
    system: SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: [doc, { type: "text", text: `File name: ${up.file_name}\nRead this document.` }] }],
  }).finalMessage();

  if (msg.stop_reason === "refusal") throw new Error("the model declined to read this file");
  if (msg.stop_reason === "max_tokens") throw new Error("the document was too long to finish reading");
  const text = msg.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no answer");
  const data = JSON.parse(text.text);
  for (const p of data.policies ?? []) for (const k of Object.keys(p)) if (p[k] === "") p[k] = null;   // "" -> not stated
  await admin.from("policy_extracts").update({ status: "done", data, error: null, model: msg.model,
    updated_at: new Date().toISOString() }).eq("upload_id", up.id);
  const what = (data.policies ?? []).map((p: { insurer?: string; plan?: string }) => [p.insurer, p.plan].filter(Boolean).join(" ")).filter(Boolean);
  await telegram(`🦁 新保单：${await clientName(admin, up.user_id)} 上传了「${up.file_name}」\n`
    + (what.length ? `狮爷已读取：${what.join("、")}` : "狮爷没读到保单资料，请人工查看")
    + "\n在 Lio 按「同步网站」确认加入");
}
