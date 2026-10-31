"""Collect the latest headlines for the website into news.json (Chinese + English).

Run by GitHub Actions every few hours (.github/workflows/news.yml), or by hand:  python fetch_news.py
Sources: Bing News RSS (headline, the publisher's short summary and the real article link), topped up with
Google News RSS headlines. Only the headline and that short summary are kept; the article itself stays on the
publisher's site and the website links to it.
"""
import hashlib
import html
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PER_LANG = 15          # stories per category per language
MAX_AGE = timedelta(days=10)
SUMMARY = 220          # characters of the publisher's summary to keep

# category -> lang -> (Bing queries, Google query, words a story must mention, or None)
SOURCES = {
    "insurance": {
        "zh": (["大马 保险", "马来西亚 保险", "大马 伊斯兰保险", "大马 医药卡"], "大马 保险 OR 马来西亚 保险",
               r"保险|保单|保费|医药卡|理赔|寿险|保诚|大东方|友邦|安联|伊斯兰保险|Takaful|Great Eastern"),
        "en": (["Malaysia insurance", "takaful Malaysia", "Malaysia medical insurance"],
               "Malaysia insurance OR takaful OR LIAM", r"(?i)insur|takaful|medical|life"),
    },
    "policy": {
        "zh": (["大马 政府 政策", "大马 财政预算", "大马 国行", "大马 公积金"], "大马 政府 政策 OR 大马 公积金", None),
        "en": (["Bank Negara Malaysia", "Malaysia budget", "EPF Malaysia", "Malaysia government policy"],
               "Malaysia Bank Negara OR budget OR EPF", None),
    },
    "finance": {
        "zh": (["美联储", "全球股市", "马股 OR 令吉", "国际油价"], "美联储 OR 华尔街 OR 全球股市", None),
        "en": (["Federal Reserve", "global stock markets", "ringgit", "oil prices"], "global markets OR Federal Reserve", None),
    },
    "health": {
        "zh": (["大马 医疗", "大马 卫生部", "马来西亚 医院", "大马 健康"], "大马 医疗 OR 大马 卫生部", r"医疗|医院|医生|疾病|健康|卫生部|药物|病患|癌|疫苗|诊所"),
        "en": (["Malaysia health ministry", "Malaysia hospital", "Malaysia healthcare"],
               "Malaysia health OR hospital OR Ministry of Health", None),
    },
}
BING = {"zh": "&setlang=zh-hans&cc=MY", "en": "&setlang=en&cc=MY"}
GOOGLE = {"zh": "hl=zh-CN&gl=CN&ceid=CN:zh-Hans", "en": "hl=en-MY&gl=MY&ceid=MY:en"}
NOW = datetime.now(timezone.utc)
# insurance / policy / health stories must be about Malaysia (finance is global)
LOCAL = (r"(?i)大马|马来西亚|马国|我国|首相|国行|国家银行|令吉|公积金|卫生部|吉隆坡|槟城|雪兰莪|柔佛|霹雳|吉打|彭亨|沙巴|砂拉越|马六甲|森美兰|"
         r"malaysia|bank negara|ringgit|epf|kwsp|putrajaya|kuala lumpur|penang|selangor|johor|sabah|sarawak|anwar|moh|liam")
JUNK = r"郑重声明|免责声明|Disclaimer"


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (LioNews)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return ET.fromstring(r.read())


def _date(text):
    try:
        return parsedate_to_datetime(text).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _clean(text, n=None):
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(text or ""))).strip()
    t = re.split(r"Notice: The content above|本文来源|责任编辑", t)[0].strip()  # publishers' boilerplate tails
    if n and len(t) > n:
        t = t[:n].rsplit(" ", 1)[0] if " " in t[n - 40:n] else t[:n]
        t = t.rstrip(" ,.;，。；…") + "…"
    return t


def _item(title, link, source, date, lang, summary=""):
    return {"id": hashlib.sha1(link.encode()).hexdigest()[:10], "title": title, "link": link, "source": source,
            "site": urllib.parse.urlparse(link).netloc, "date": date.isoformat() if date else "", "lang": lang,
            "summary": summary}


def bing(query, lang):
    url = ("https://www.bing.com/news/search?format=rss&q=" + urllib.parse.quote(query) + BING[lang]
           + "&qft=" + urllib.parse.quote('sortbydate="1"'))
    out = []
    for it in _get(url).iter("item"):
        link = it.findtext("link") or ""
        link = urllib.parse.parse_qs(urllib.parse.urlparse(link).query).get("url", [link])[0]  # Bing click-through -> article
        source = next((c.text for c in it if c.tag.endswith("Source")), "") or ""
        out.append(_item(_clean(it.findtext("title")), link, source.replace(" on MSN", ""), _date(it.findtext("pubDate")),
                         lang, _clean(it.findtext("description"), SUMMARY)))
    return out


def google(query, lang):
    url = "https://news.google.com/rss/search?q=" + urllib.parse.quote(query + " when:7d") + "&" + GOOGLE[lang]
    out = []
    for it in _get(url).iter("item"):
        title = _clean(it.findtext("title"))
        source = (it.findtext("source") or "").strip()
        if source and title.endswith(" - " + source):        # Google appends " - Source" to the title
            title = title[: -len(source) - 3].strip()
        item = _item(title, (it.findtext("link") or "").strip(), source, _date(it.findtext("pubDate")), lang)
        src = it.find("source")
        item["site"] = urllib.parse.urlparse(src.get("url") or "").netloc if src is not None else ""
        out.append(item)
    return out


def key(title):
    return re.sub(r"\W+", "", title.lower())[:30]


def ok(x, lang, must, cat):
    if not x["title"] or not x["link"]:
        return False
    if x["date"] and NOW - datetime.fromisoformat(x["date"]) > MAX_AGE:
        return False
    if lang == "zh" and (not re.search(r"[一-鿿]", x["title"]) or re.search(r"[぀-ヿ]", x["title"])):
        return False                                           # not Chinese, or Japanese
    if re.search(JUNK, x["summary"]):
        x["summary"] = ""
    text = x["title"] + " " + x["summary"] + " " + x["source"]
    return (not must or re.search(must, text)) and (cat == "finance" or re.search(LOCAL, text))


def main():
    path = os.path.join(HERE, "news.json")
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f).get("categories", {})
    except (OSError, ValueError):
        old = {}
    cats = {}
    for cat, langs in SOURCES.items():
        items, seen = [], set()
        for lang, (queries, gq, must) in langs.items():
            found = []
            for q in queries:
                try:
                    found += bing(q, lang)
                except Exception as e:                  # one bad feed shouldn't empty the page
                    print(f"bing {cat}/{lang}/{q}: {e}")
            summarised = sum(1 for x in found if ok(x, lang, must, cat))
            if summarised < PER_LANG:
                try:
                    found += google(gq, lang)
                except Exception as e:
                    print(f"google {cat}/{lang}: {e}")
            found = [x for x in found if ok(x, lang, must, cat)]
            if not found:
                found = [x for x in old.get(cat, []) if x.get("lang") == lang]
            found.sort(key=lambda x: (bool(x["summary"]), x["date"]), reverse=True)  # stories with a summary first
            mine = []
            for x in found:
                k = key(x["title"])
                if k not in seen and len(mine) < PER_LANG:
                    seen.add(k)
                    mine.append(x)
            items += sorted(mine, key=lambda x: x["date"], reverse=True)
        cats[cat] = items
        print(cat, len(items), "with summary:", sum(1 for x in items if x["summary"]))
    import summarize
    print("plain-language summaries written:", summarize.add_summaries([x for items in cats.values() for x in items]))
    data = {"updated": NOW.isoformat(timespec="seconds"), "categories": cats}
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(path + ".tmp", path)


if __name__ == "__main__":
    main()
