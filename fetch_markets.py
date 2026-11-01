"""Market numbers for the website's 市场速览 panel, saved inside news.json as "markets".

fetch_news.py calls collect() on every run (GitHub Actions, every 3 hours). By hand:  python fetch_markets.py
Sources (free, no key): Yahoo Finance (indices, currency, oil, US 10-year yield), FRED of the US Federal Reserve
(Fed rate, CPI, PCE), Bank Negara Malaysia's API (OPR). A source that fails keeps its last known value.
With ANTHROPIC_API_KEY set, Claude also writes a one-paragraph 今日重点 once a day from the numbers and the top headlines.
"""
import csv
import io
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
MYT = timezone(timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (LioMarkets)"}

# key -> Yahoo symbol, decimals
YAHOO = {"klci": ("^KLSE", 2), "usdmyr": ("MYR=X", 4), "brent": ("BZ=F", 2), "spx": ("^GSPC", 2), "ndx": ("^IXIC", 2),
         "dji": ("^DJI", 2), "us10y": ("^TNX", 2), "dxy": ("DX-Y.NYB", 2), "vix": ("^VIX", 2)}


def _get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def yahoo(symbol, dp):
    d = json.loads(_get("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol)
                        + "?range=10d&interval=1d"))["chart"]["result"][0]
    closes = [c for c in d["indicators"]["quote"][0]["close"] if c is not None]
    cur = d["meta"].get("regularMarketPrice") or closes[-1]
    prev = closes[-2] if len(closes) > 1 else None
    out = {"value": round(cur, dp), "asof": datetime.fromtimestamp(d["meta"]["regularMarketTime"], MYT).isoformat()}
    if prev:
        out["change"] = round(cur - prev, dp)
        out["pct"] = round((cur / prev - 1) * 100, 2)
    return out


def fred(series):
    # only the last 3 years: the full history is large and FRED is slow to answer cloud servers
    since = (datetime.now(MYT) - timedelta(days=3 * 366)).date().isoformat()
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}&cosd={since}"
    raw = _get(url, timeout=20)   # FRED often refuses cloud servers (GitHub): fail fast, CPI and the Fed rate come from elsewhere
    rows = [r for r in csv.reader(io.StringIO(raw.decode()))][1:]
    return [(d, float(v)) for d, v in rows if v not in ("", ".")]


def yoy(series):
    """Year-on-year % change of a monthly index (CPI, PCE) and the month it is for."""
    rows = fred(series)
    (d, v), (_, v12) = rows[-1], rows[-13]
    return {"value": round((v / v12 - 1) * 100, 1), "month": d[:7], "prev": round((rows[-2][1] / rows[-14][1] - 1) * 100, 1)}


def fed_rate():
    """Fed funds target range, from the New York Fed's public API."""
    r = json.loads(_get("https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json"))["refRates"][0]
    return {"low": r["targetRateFrom"], "high": r["targetRateTo"], "asof": r["effectiveDate"]}


def cpi():
    """US CPI, all items, year on year (the headline figure), from the Bureau of Labor Statistics' public API."""
    data = json.loads(_get("https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0"))["Results"]["series"][0]["data"]
    val = {(int(x["year"]), int(x["period"][1:])): float(x["value"]) for x in data
           if x["period"].startswith("M") and x["period"] != "M13" and x["value"].replace(".", "", 1).isdigit()}   # "-" = month not published
    (y, m), *_ = sorted(val, reverse=True)
    prev_m = (y, m - 1) if m > 1 else (y - 1, 12)
    pct = lambda k: round((val[k] / val[(k[0] - 1, k[1])] - 1) * 100, 1) if k in val and (k[0] - 1, k[1]) in val else None
    return {"value": pct((y, m)), "month": f"{y}-{m:02d}", "prev": pct(prev_m)}


def opr():
    d = json.loads(_get("https://api.bnm.gov.my/public/opr", {"Accept": "application/vnd.BNM.API.v1+json"}))["data"]
    return {"value": d["new_opr_level"], "change": d["change_in_opr"], "asof": d["date"]}


def highlight(items, old, cats):
    """今日重点: one short paragraph per Malaysian day, written by Claude from the numbers and top headlines."""
    today = datetime.now(MYT).date().isoformat()
    if (old.get("highlight") or {}).get("date") == today or not os.environ.get("ANTHROPIC_API_KEY"):
        return old.get("highlight")
    try:
        import anthropic
        heads = [x["title"] for c in ("insurance", "policy", "finance", "health") for x in cats.get(c, []) if x["lang"] == "zh"][:24]
        prompt = ("Today's market numbers (JSON):\n" + json.dumps(items, ensure_ascii=False)
                  + "\n\nToday's headlines:\n" + "\n".join("- " + h for h in heads))
        client = anthropic.Anthropic()
        model = os.environ.get("LIO_SUMMARY_MODEL") or "claude-haiku-5-5"
        req = dict(model=model, max_tokens=2000, output_config={"effort": "low"},
                   system=("You write the daily 今日重点 line for 狮爷谈金融 Lio Talk, a Malaysian site about insurance, policy and "
                           "money for ordinary families. In Simplified Chinese (Malaysian usage: 令吉, 国行, 公积金), write ONE short "
                           "paragraph of at most 90 characters naming the 2-3 things that matter most today, picked from the numbers "
                           "and headlines given. Facts only, in your own words, no advice, no predictions, no markdown. "
                           "Then a blank line, then the same in English in at most 45 words."),
                   messages=[{"role": "user", "content": prompt}])
        resp = client.messages.create(**req)
        if resp.stop_reason in ("refusal", "max_tokens"):
            return old.get("highlight")
        text = next(b.text for b in resp.content if b.type == "text").strip()
        zh, _, en = text.partition("\n\n")
        strip = lambda x, label: re.sub(rf"^\s*{label}\s*[:：]\s*", "", x.strip(), flags=re.I)   # the page adds its own label
        return {"date": today, "zh": strip(zh, "今日重点"), "en": strip(en, "Today")}
    except Exception as e:   # no highlight today is fine
        print("highlight:", type(e).__name__, str(e)[:120])
        return old.get("highlight")


def collect(old, cats):
    """-> {"updated", "items", "highlight"}; old = the previous run's result (its numbers fill in for a failed source)."""
    old = old or {}
    items = dict(old.get("items", {}))
    jobs = {k: (lambda s=s, dp=dp: yahoo(s, dp)) for k, (s, dp) in YAHOO.items()}
    jobs.update(fed=fed_rate, cpi=cpi, pce=lambda: yoy("PCEPI"), opr=opr)
    for key, job in jobs.items():
        try:
            items[key] = job()
        except Exception as e:   # keep yesterday's number rather than an empty tile
            print(f"{key}: {type(e).__name__} {str(e)[:80]}")
    print("markets:", ", ".join(f"{k}={v.get('value', v.get('high'))}" for k, v in items.items()))
    return {"updated": datetime.now(MYT).isoformat(timespec="minutes"), "items": items, "highlight": highlight(items, old, cats)}


if __name__ == "__main__":
    print(json.dumps(collect({}, {}), ensure_ascii=False, indent=1))
