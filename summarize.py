"""Plain-language summaries ("白话总结") of the news stories, written by Claude.

fetch_news.py calls add_summaries(items). For each story not summarised before, the article page is read (only to
understand it; nothing from it is published) and Claude writes a short summary in its own words, in the story's
language. Results are cached in summaries.json by story id, so each story is summarised once.

Needs an Anthropic API key in the ANTHROPIC_API_KEY environment variable (a GitHub Actions secret). Without one the
site simply shows the publisher's own short summary, as before.
"""
import html
import json
import os
import re
import urllib.request
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "summaries.json")
MODEL = os.environ.get("LIO_SUMMARY_MODEL") or "claude-haiku-5-5"
MAX_NEW = int(os.environ.get("LIO_SUMMARY_MAX") or 60)   # new stories per run: keeps the cost predictable
ARTICLE_CHARS = 12000

SCHEMA = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean"},
        "summary": {"type": "string"},
        "points": {"type": "array", "items": {"type": "string"}},
        "why": {"type": "string"},
    },
    "required": ["ok", "summary", "points", "why"],
    "additionalProperties": False,
}

SYSTEM = """You write plain-language news summaries for 狮爷谈金融 Lio Talk, a Malaysian website about insurance, government policy, global finance and health. Readers are ordinary Malaysian families, many reading in Chinese.

For the story you are given, write in the language requested:
- summary: 2 to 4 short sentences explaining what happened, in everyday words. Explain jargon (e.g. OPR, EPF, takaful, co-payment) briefly the first time. Chinese: at most about 150 characters, Malaysian Chinese usage (令吉, 公积金, 国行).
- points: 2 or 3 key facts (numbers, dates, who), each one short line.
- why: one sentence on what it may mean for an ordinary family in Malaysia. Keep it factual and calm: no selling, no fear, no financial or investment advice, no recommendation to buy any product. Empty string if there is no clear link.

Write everything in your own words. Do not copy sentences from the article and do not quote more than a few words. Use only facts stated in the article text or the headline and summary given; never add numbers or claims of your own.
If the article text is missing, cut off, or doesn't match the headline, work from the headline and publisher summary only; if they are too thin to say anything reliable, set ok to false and leave the other fields empty."""


class _Text(HTMLParser):
    """Paragraph text of an article page (scripts, menus and footers skipped)."""

    SKIP = {"script", "style", "nav", "footer", "header", "aside", "form", "noscript", "figure"}

    def __init__(self):
        super().__init__()
        self.depth, self.in_p, self.parts, self.cur = 0, 0, [], []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth += 1
        elif tag == "p" and not self.depth:
            self.in_p, self.cur = 1, []

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth:
            self.depth -= 1
        elif tag == "p" and self.in_p:
            text = re.sub(r"\s+", " ", "".join(self.cur)).strip()
            if len(text) > 25:
                self.parts.append(text)
            self.in_p = 0

    def handle_data(self, data):
        if self.in_p and not self.depth:
            self.cur.append(data)


def article_text(url):
    if "news.google.com" in url:          # a redirect page, not the article
        return ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (LioNews)", "Accept-Language": "zh,en;q=0.8"})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read(2_000_000)
            charset = r.headers.get_content_charset() or "utf-8"
        p = _Text()
        p.feed(raw.decode(charset, "replace"))
        return html.unescape("\n".join(p.parts))[:ARTICLE_CHARS]
    except Exception:
        return ""


def summarise(client, item):
    import anthropic
    text = article_text(item["link"])
    lang = "Simplified Chinese" if item["lang"] == "zh" else "English"
    prompt = (f"Write in {lang}.\n\nHeadline: {item['title']}\nSource: {item['source']}\n"
              f"Publisher summary: {item.get('summary') or '(none)'}\n\n"
              f"<article>\n{text or '(could not be read)'}\n</article>")
    try:
        req = dict(model=MODEL, max_tokens=4000, system=SYSTEM, messages=[{"role": "user", "content": prompt}],
                   output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}})
        if MODEL.startswith("claude-haiku"):  # Haiku has no server-side fallback; a declined story just gets no summary
            resp = client.messages.create(**req)
        else:                                 # if a safety check declines, another model retries server-side
            resp = client.beta.messages.create(**req, betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    except (anthropic.BadRequestError, anthropic.NotFoundError) as e:
        if "credit balance" in str(e.message).lower():
            raise                            # the account needs topping up: not this story's fault, try it again later
        print("  summary refused by the API:", e.message)
        return SKIP
    if resp.stop_reason in ("refusal", "max_tokens"):
        return SKIP
    data = json.loads(next(b.text for b in resp.content if b.type == "text"))
    if not data["ok"] or not data["summary"].strip():
        return SKIP
    return {"summary": data["summary"].strip(), "points": [p.strip() for p in data["points"] if p.strip()][:3],
            "why": data["why"].strip()}


SKIP = {"skip": True}   # cached for a story that can't be summarised, so it isn't paid for again


def key_shape():
    """What the key looks like, never the key: its type prefix, length and stray characters (for fixing a bad paste)."""
    k = os.environ.get("ANTHROPIC_API_KEY") or ""
    kind = next((p for p in ("sk-ant-api", "sk-ant-oat", "sk-ant-admin", "sk-ant-") if k.strip().startswith(p)), "unknown prefix")
    spaces = any(c.isspace() for c in k)
    quoted = k.strip()[:1] in ("'", '"') and bool(k.strip())
    return f"type={kind} length={len(k)} spaces_or_newlines={spaces} quotes={quoted}"


def add_summaries(items, client=None):
    """Put item["ai"] on every story that has (or now gets) a summary. Returns how many were written this run."""
    try:
        with open(CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    import anthropic
    if client is None and os.environ.get("ANTHROPIC_API_KEY"):
        client = anthropic.Anthropic()
    made = 0
    for it in items:
        if cache.get(it["id"]) is None and client is not None and made < MAX_NEW:   # None = left over from a failed run
            try:
                cache[it["id"]] = summarise(client, it)
            except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
                print("  API key not accepted, no summaries this run:", type(e).__name__, "|", key_shape())
                client = None                # the key is wrong: no point trying every story
                continue
            except anthropic.BadRequestError as e:
                print("  Anthropic credit balance too low, no summaries this run:", str(e.message)[:80])
                client = None
                continue
            except Exception as e:          # network / rate limit: try again next run
                print("  summary failed:", type(e).__name__, str(e)[:120])
                continue
            made += 1
        if (cache.get(it["id"]) or {}).get("summary"):
            it["ai"] = cache[it["id"]]
    live = {it["id"] for it in items}
    cache = {k: v for k, v in cache.items() if k in live}     # forget stories no longer on the site
    with open(CACHE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    os.replace(CACHE + ".tmp", CACHE)
    return made
