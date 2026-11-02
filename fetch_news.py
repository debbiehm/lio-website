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
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PER_LANG = 15          # stories per category per language
MAX_AGE = timedelta(days=10)
SUMMARY = 220          # characters of the publisher's summary to keep

# category -> lang -> (Bing queries, Google query, what a story must mention: a pattern, a list of patterns that must
# all match, or None). Readers are Malaysian business people: companies, IPOs, markets, Elon Musk, and policy / health
# news that touches their business, costs or staff.
SOURCES = {
    # 马股IPO·企业, 财经市场 and 马来西亚政策 come only from Debbie's chosen sources (TABLE below)
    "ipo": {"zh": ([], None, None), "en": ([], None, None)},
    "musk": {   # Elon Musk and his companies: shown in 科技能源 (no tab of its own)
        "zh": (["马斯克", "特斯拉 马斯克", "SpaceX 星舰", "马斯克 xAI", "星链 Starlink"], "马斯克 OR 特斯拉 OR SpaceX",
               r"马斯克|特斯拉|SpaceX|星舰|星链|xAI|Grok|Neuralink|Tesla"),
        "en": (["Elon Musk", "Tesla Musk", "SpaceX Starship", "xAI Grok", "Starlink"], "Elon Musk OR Tesla OR SpaceX",
               r"(?i)musk|tesla|spacex|starship|starlink|xai|grok|neuralink"),
    },
    "finance": {"zh": ([], None, None), "en": ([], None, None)},
    "policy": {"zh": ([], None, None), "en": ([], None, None)},
    "insurance": {
        "zh": (["大马 保险", "马来西亚 保险", "大马 伊斯兰保险", "大马 医药卡"], "大马 保险 OR 马来西亚 保险",
               r"保险|保单|保费|医药卡|理赔|寿险|保诚|大东方|友邦|安联|伊斯兰保险|Takaful|Great Eastern"),
        "en": (["Malaysia insurance", "takaful Malaysia", "Malaysia medical insurance"],
               "Malaysia insurance OR takaful OR LIAM", r"(?i)insur|takaful|medical|life"),
    },
    "health": {   # health news that matters to a business owner: medical costs, staff cover, healthcare companies
        "zh": (["大马 医疗通胀", "大马 医药卡 保费", "大马 私立医院 收费", "IHH 医院", "KPJ 医院", "大马 雇主 医疗 员工", "大马 社险 PERKESO",
                "大马 医疗 费用", "大马 私人诊所", "MediAsas 医疗", "大马 医疗 政策"],
               "大马 医疗通胀 OR 大马 医药卡 保费", [r"医疗|医院|医药|保费|社险|PERKESO|医疗费|医药卡|医生|健康", r"成本|保费|通胀|收费|费用|价格|门诊费|雇主|员工|企业|公司|股|营收|盈利|上市|投资|医疗费|医药卡|集团|收购|业者|商家|中小企|私立|私人|保险|健保|MediAsas|政策|预算|拨款"]),
        "en": (["Malaysia medical inflation", "Malaysia private hospital charges", "IHH Healthcare", "KPJ Healthcare",
                "Malaysia medical insurance premiums", "Malaysia employer healthcare costs"],
               "Malaysia medical inflation OR hospital charges", [r"(?i)medical|health|hospital|clinic|doctor|PERKESO|SOCSO", r"(?i)cost|premium|inflation|charge|employer|business|compan|IHH|KPJ|earnings|profit|invest|listing|price|SME|group"]),
    },
    "energy": {   # big energy / technology projects, worldwide (e.g. a new solar-thermal plant connected to the grid)
        "zh": (["光热 储能 项目", "光伏 并网", "新能源 项目 投产", "风电 项目", "储能电站", "大马 再生能源"],
               "新能源 并网 OR 光伏 OR 储能 OR 风电", r"能源|光伏|光热|储能|风电|电网|核电|氢能|发电|电站|电池|太阳能|绿电"),
        "en": (["solar power plant", "energy storage project", "renewable energy Malaysia", "wind farm", "green hydrogen"],
               "solar plant OR energy storage OR wind farm OR renewable energy", r"(?i)solar|wind|energy|power|battery|grid|nuclear|hydrogen|renewable"),
    },
}
# Debbie's sources: (id, name, Bing queries, what a story must mention or None, tab, what 狮爷摘要 should turn it into).
# A query starting with "site:" only keeps stories from that site. Official sites (BNM, KWSP, SC) block robots and BFM
# has no news feed, so for those the queries find news coverage of their announcements; LHDN also has its own feed.
TABLE = [
    ("edge", "The Edge", ["site:theedgemalaysia.com", "site:theedgemalaysia.com IPO OR listing OR earnings",
                          "site:theedgemalaysia.com fund OR unit trust"], None, "biz", "深度解读、财富规划"),
    ("star", "The Star Business", ["site:thestar.com.my/business", "site:thestar.com.my/business Bursa OR ringgit",
                                   "site:thestar.com.my/business IPO OR listing"], None, "biz", "新闻白话解说"),
    ("nanyang", "南洋商报", ["site:enanyang.my 财经", "site:enanyang.my 企业 OR 上市", "site:enanyang.my 马股",
                          "site:enanyang.my 招股 OR IPO"],
     r"股|令吉|经济|财经|企业|公司|营收|盈利|净利|投资|基金|银行|利率|通胀|市场|上市|招股|收购|油价|金价|汇率|债券|财报|业务|集团",
     "biz", "华语读者容易理解的话题"),
    ("bfm", "BFM 89.9", ["site:bfm.my", "BFM 89.9 business"], r"(?i)\bBFM\b", "finance", "专业知识、观点分析"),
    ("reuters", "Reuters Markets", ["site:reuters.com/markets", "site:reuters.com/markets Fed OR rates OR stocks"],
     r"(?i)stock|share|market|rate|Fed|bond|yield|dollar|oil|gold|econom|inflation|profit|earnings|fund|invest|"
     r"currenc|bank|price|trade|tariff|IPO|deal|growth|GDP|index|Wall St", "finance", "基金及全球投资教育"),
    ("kwsp", "KWSP / EPF", ["EPF KWSP Malaysia", "大马 公积金 KWSP"], r"(?i)\bEPF\b|KWSP|公积金", "policy", "退休规划"),
    ("bnm", "BNM", ["Bank Negara Malaysia", "Bank Negara insurance OR takaful", "大马 国家银行"],
     r"(?i)Bank Negara|\bBNM\b|国家银行|国行", "policy", "家庭财务与医疗保障"),
    ("sc", "SC Malaysia", ["Securities Commission Malaysia", "大马 证监会"], r"(?i)Securities Commission|证监会",
     "policy", "基金知识、投资者教育"),
    ("lhdn", "LHDN", ["LHDN income tax Malaysia", "Malaysia tax relief", "大马 所得税 减免"],
     r"(?i)LHDN|Inland Revenue|\bIRB\b|tax relief|income tax|所得税|税务局|内陆税收", "policy", "合法节税与退休储蓄"),
]
ANGLE = {src: angle for src, _, _, _, _, angle in TABLE}
PER_SOURCE = 6   # stories per source per tab and language, so every source in the table gets a place
IPO_WORDS = r"(?i)\bIPOs?\b|listing|debut|prospectus|merger|acquisition|takeover|earnings|quarterly|net profit|上市|招股|挂牌|收购|并购|财报|季报|净利"
INSURANCE_WORDS = r"(?i)insur|takaful|保险"
GLOBAL = ("finance", "energy", "musk")   # these may be about anywhere; the rest must be about Malaysia
BING = {"zh": "&setlang=zh-hans&cc=MY", "en": "&setlang=en&cc=MY"}
GOOGLE = {"zh": "hl=zh-CN&gl=CN&ceid=CN:zh-Hans", "en": "hl=en-MY&gl=MY&ceid=MY:en"}
NOW = datetime.now(timezone.utc)
# insurance / policy / health stories must be about Malaysia (finance is global)
LOCAL = (r"(?i)大马|马来西亚|马国|我国|首相|国行|国家银行|令吉|公积金|卫生部|吉隆坡|槟城|雪兰莪|柔佛|霹雳|吉打|彭亨|沙巴|砂拉越|马六甲|森美兰|"
         r"malaysia|bank negara|ringgit|epf|kwsp|putrajaya|kuala lumpur|penang|selangor|johor|sabah|sarawak|anwar|moh|liam")
JUNK = r"郑重声明|免责声明|Disclaimer"
# words that contain 保险 / "insurance-like" text but are not about insurance (a condom is 保险套, a fuse 保险丝, ...)
NOT_ABOUT = {"insurance": r"(?i)保险套|避孕套|安全套|保险丝|保险箱|保险柜|保险杠|保险栓|condom",
             # China A-share broker ratings and chatter: not for Malaysian business readers
             "finance": r"评级|A股|沪指|深成指|创业板指|沪深|北向资金|中证|券商|涨停|跌停|龙虎榜",
             # sports and gossip that only name-drop Musk
             "health": r"喂马|马匹|赛马|宠物",
             "musk": r"(?i)NBA|篮球|足球|球员|球队|直播吧|体育|nba|football|soccer"}


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


def resolve(x):
    """A Google News story has only a redirect link and no summary, so it can't be summarised. Look the headline up on
    Bing to get the real article link and the publisher's summary. -> True if found (x is updated in place)."""
    want = re.sub(r"\W+", "", x["title"].lower())
    try:
        hits = bing(f'"{x["title"][:60]}"', x["lang"]) + bing(x["title"][:60], x["lang"])
    except Exception:
        return False
    for h in hits:
        got = re.sub(r"\W+", "", h["title"].lower())
        if h["summary"] and "news.google.com" not in h["link"] and SequenceMatcher(None, want, got).ratio() >= 0.6:
            x.update(link=h["link"], id=h["id"], site=h["site"], summary=h["summary"])
            return True
    return False


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
    if cat in NOT_ABOUT and re.search(NOT_ABOUT[cat], x["title"] + " " + x["summary"]):
        return False
    musts = must if isinstance(must, list) else [must] if must else []
    return all(re.search(m, text) for m in musts) and (cat in GLOBAL or x.get("src") or re.search(LOCAL, text))


def lhdn_feed():
    """LHDN's own announcements (RSS)."""
    out = []
    for it in _get("https://www.hasil.gov.my/rss").iter("item"):
        out.append(_item(_clean(it.findtext("title")), (it.findtext("link") or "").strip(), "LHDN", _date(it.findtext("pubDate")),
                         "en", _clean(it.findtext("description"), SUMMARY)))
    return out


def table_news():
    """Stories from Debbie's sources -> {(tab, lang): [story]}, each marked with its source id."""
    out = {}
    for src, name, queries, must, tab, _ in TABLE:
        got = []
        for q in queries:
            lang = "zh" if re.search(r"[\u4e00-\u9fff]", q) else "en"
            try:
                found = bing(q, lang)
            except Exception as e:
                print(f"table {src}/{q}: {e}")
                continue
            site = re.match(r"site:(\S+)", q)
            for x in found:
                if site and site.group(1).replace("www.", "") not in x["link"]:
                    continue                                # site: searches slip in other sites and other sections
                # site sources: judge by the headline (summaries mention 公司 / 集团 in passing); others: headline + summary
                text = x["title"] if site else x["title"] + " " + x["summary"] + " " + x["source"]
                if must and not re.search(must, text):
                    continue
                x["lang"] = "zh" if re.search(r"[\u4e00-\u9fff]", x["title"]) else "en"
                got.append(x)
        if src == "lhdn":
            try:
                got += lhdn_feed()
            except Exception as e:
                print("lhdn feed:", e)
        for x in got:
            x["src"], x["src_name"] = src, name
            text = x["title"]
            cat = tab
            if tab == "biz":
                cat = "ipo" if re.search(IPO_WORDS, text) else "finance"
            elif tab == "policy" and re.search(INSURANCE_WORDS, text):
                cat = "insurance"
            out.setdefault((cat, x["lang"]), []).append(x)
        print(f"table {src}: {len(got)}")
    return out


def main():
    path = os.path.join(HERE, "news.json")
    try:
        with open(path, encoding="utf-8") as f:
            saved = json.load(f)
    except (OSError, ValueError):
        saved = {}
    old = saved.get("categories", {})
    table = table_news()
    cats = {}
    for cat, langs in SOURCES.items():
        items, seen = [], set()
        for lang, (queries, gq, must) in langs.items():
            found = list(table.get((cat, lang), []))
            for q in queries:
                try:
                    found += bing(q, lang)
                except Exception as e:                  # one bad feed shouldn't empty the page
                    print(f"bing {cat}/{lang}/{q}: {e}")
            summarised = sum(1 for x in found if ok(x, lang, must, cat))
            if gq and summarised < PER_LANG:
                try:
                    found += google(gq, lang)
                except Exception as e:
                    print(f"google {cat}/{lang}: {e}")
            found = [x for x in found if ok(x, lang, must, cat)]
            if not found:
                found = [x for x in old.get(cat, []) if x.get("lang") == lang]
            local_first = cat == "finance"   # Malaysian market news (马股, 令吉, 国行) before the rest of the world
            found.sort(key=lambda x: (local_first and bool(re.search(LOCAL, x["title"] + " " + x["summary"] + " " + x["source"])),
                                      bool(x["summary"]), x["date"]), reverse=True)  # then stories with a summary
            mine, per_src = [], {}
            for x in found:
                k = key(x["title"])
                if k in seen or len(mine) >= PER_LANG or per_src.get(x.get("src"), 0) >= PER_SOURCE:
                    continue
                if "news.google.com" in x["link"] and not resolve(x):   # no real article to summarise: leave it out
                    continue
                seen.add(k)
                mine.append(x)
                if x.get("src"):
                    per_src[x["src"]] = per_src.get(x["src"], 0) + 1
            items += sorted(mine, key=lambda x: x["date"], reverse=True)
        cats[cat] = items
        print(cat, len(items), "with summary:", sum(1 for x in items if x["summary"]))
    import summarize
    summarize.ANGLE = ANGLE
    print("plain-language summaries written:", summarize.add_summaries([x for items in cats.values() for x in items]))
    if "musk" in cats:   # Musk stories join 科技能源
        seen, merged = set(), []
        for x in cats.pop("musk") + cats.get("energy", []):
            if key(x["title"]) not in seen:
                seen.add(key(x["title"]))
                merged.append(x)
        cats["energy"] = merged
    data = {"updated": NOW.isoformat(timespec="seconds"), "categories": cats}
    import fetch_markets
    data["markets"] = fetch_markets.collect(saved.get("markets"), cats)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(path + ".tmp", path)


if __name__ == "__main__":
    main()
