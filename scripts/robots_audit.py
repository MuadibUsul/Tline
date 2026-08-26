# -*- coding: utf-8 -*-
"""Fetch and evaluate robots.txt for all 64 institutions, output an Excel review sheet."""
import json, socket, sys, ssl
import urllib.request, urllib.error
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8")

# SSL context: prefer certifi's CA bundle; fall back to an unverified context
# (we are only READING robots.txt, which carries no security implication).
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = ssl._create_unverified_context()
SSL_NOVERIFY = ssl._create_unverified_context()

# Read robots as a normal browser (reading robots.txt is always permitted),
# then evaluate the rules for BOTH the wildcard group and our named bot.
READ_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
OUR_BOT = "InstitutionalIntelligenceBot"
TIMEOUT = 15

data = json.load(open("data/institutions.json", encoding="utf-8"))


def _get(robots_url, ctx):
    req = urllib.request.Request(robots_url, headers={"User-Agent": READ_UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
        return r.status, r.read().decode("utf-8", "ignore")


def fetch_robots(host_url):
    p = urlparse(host_url)
    # Try both the exact host and its www/non-www variant.
    hosts = [p.netloc]
    if p.netloc.startswith("www."):
        hosts.append(p.netloc[4:])
    else:
        hosts.append("www." + p.netloc)

    last = None
    for host in hosts:
        robots_url = f"{p.scheme}://{host}/robots.txt"
        for ctx in (SSL_CTX, SSL_NOVERIFY):
            try:
                return _get(robots_url, ctx)
            except urllib.error.HTTPError as e:
                return (e.code, "")  # a real HTTP response is definitive for this host
            except (urllib.error.URLError, socket.timeout, ConnectionError, Exception) as e:
                last = (None, str(e)[:60])
                continue  # connection-level failure: try other ctx / host variant
    return last


def evaluate(inst):
    url = inst["researchUrl"]
    host = urlparse(url).netloc
    status, body = fetch_robots(url)

    row = {
        "slug": inst["slug"], "name": inst["name"], "host": host, "url": url,
        "robots_status": "", "allow_star": "", "allow_bot": "",
        "crawl_delay": "", "sitemaps": "", "hit_rule": "", "verdict": "", "note": "",
        "source": "自动 · robots.txt",
    }

    if status is None:
        row.update(robots_status=f"取不到 ({body})", allow_star="未知", allow_bot="未知",
                   verdict="无法确认 · 需人工复核",
                   note="robots.txt 无法访问（超时/被拦/DNS）。采集前须人工确认 ToS 与 robots。")
        return row
    if status == 404 or (status == 200 and not body.strip()):
        row.update(robots_status=f"{status}·无规则", allow_star="是", allow_bot="是",
                   verdict="可采集（无 robots 限制）",
                   note="无 robots.txt 或为空 = 默认允许；仍应控频、只取公开内容。")
        return row
    if status != 200:
        row.update(robots_status=f"HTTP {status}", allow_star="未知", allow_bot="未知",
                   verdict="无法确认 · 需人工复核", note=f"robots.txt 返回 {status}。")
        return row

    rp = RobotFileParser()
    rp.parse(body.splitlines())

    allow_star = rp.can_fetch("*", url)
    allow_bot = rp.can_fetch(OUR_BOT, url)
    try:
        cd = rp.crawl_delay("*") or rp.crawl_delay(OUR_BOT)
    except Exception:
        cd = None
    try:
        sm = rp.site_maps() or []
    except Exception:
        sm = []

    row["robots_status"] = "200·有规则"
    row["allow_star"] = "是" if allow_star else "否"
    row["allow_bot"] = "是" if allow_bot else "否"
    row["crawl_delay"] = f"{cd}s" if cd else "—"
    row["sitemaps"] = f"有 ({len(sm)})" if sm else "无"

    if not allow_star:
        # Find the disallow rule that likely blocks the path (best-effort, from raw text).
        path = urlparse(url).path or "/"
        blockers = [ln.split(":", 1)[1].strip() for ln in body.splitlines()
                    if ln.lower().startswith("disallow:") and ln.split(":", 1)[1].strip()
                    and path.startswith(ln.split(":", 1)[1].strip())]
        row["hit_rule"] = blockers[0] if blockers else "(见 robots.txt)"
        row["verdict"] = "禁止采集该路径（robots）"
        row["note"] = "robots 禁止该研究路径。不得采集；可考虑改用官方 RSS/API 或申请授权。"
    else:
        if cd:
            row["verdict"] = f"可采集 · 遵守 Crawl-delay {cd}s"
            row["note"] = "允许采集该路径；须遵守 Crawl-delay 限频。"
        else:
            row["verdict"] = "可采集"
            row["note"] = "允许采集该研究路径；礼貌控频（≥1 请求/秒），仅公开内容。"
        if sm:
            row["note"] += f" 有 Sitemap（{len(sm)}），优先走 Sitemap。"
    return row


with ThreadPoolExecutor(max_workers=12) as ex:
    rows = list(ex.map(evaluate, data))

# Manual overrides: hosts whose robots.txt blocked the automated Python fetch,
# re-checked live via headless browser / WebFetch on 2026-08-27.
OVERRIDES = {
    "ubs": dict(robots_status="200 · 有规则", allow_star="是", allow_bot="是", crawl_delay="—",
                sitemaps="有 (1)", hit_rule="", verdict="可采集",
                note="WebFetch 核实：User-agent:* 未禁止 insights/house-view 路径；有 Sitemap。仅礼貌控频。",
                source="WebFetch 核实"),
    "bmo": dict(robots_status="200 · 有规则", allow_star="是", allow_bot="是", crawl_delay="—",
                sitemaps="有 (1)", hit_rule="", verdict="可采集",
                note="浏览器核实：Allow:/；仅禁 /api /search /preprod /preview /admin /cms。/en/insights/ 允许。",
                source="浏览器核实"),
    "rabobank": dict(robots_status="无 robots (soft-404)", allow_star="是", allow_bot="是", crawl_delay="None",
                     sitemaps="无", hit_rule="", verdict="可采集（无 robots 限制）",
                     note="浏览器核实：/robots.txt 软 404、无有效规则=默认允许；仍须遵守 ToS，仅公开内容。",
                     source="浏览器核实"),
    "fidelity": dict(robots_status="200 · 有规则", allow_star="是", allow_bot="是", crawl_delay="—",
                     sitemaps="无", hit_rule="", verdict="可采集",
                     note="浏览器核实：User-agent:* 仅 Disallow:/filq$；/editorial/ 允许。",
                     source="浏览器核实"),
    "blackrock": dict(robots_status="403 · Akamai", allow_star="未知", allow_bot="未知", crawl_delay="None",
                      sitemaps="—", hit_rule="", verdict="无法确认 · 需人工复核",
                      note="Akamai 边缘对 robots.txt 亦返回 Access Denied（真机浏览器同样被拒）。站点封锁自动访问；采集前须获授权并人工确认 ToS。",
                      source="浏览器(被拒)"),
    "neuberger-berman": dict(robots_status="Vercel 人机验证", allow_star="未知", allow_bot="未知", crawl_delay="None",
                             sitemaps="—", hit_rule="", verdict="无法确认 · 需人工复核",
                             note="站点(nb.com)启用 Vercel 人机验证挑战；不得绕过 bot 检测。视为默认不采，须人工确认后再定。",
                             source="浏览器(挑战)"),
    "mizuho": dict(robots_status="连接被重置", allow_star="未知", allow_bot="未知", crawl_delay="None",
                   sitemaps="—", hit_rule="", verdict="无法确认 · 需人工复核",
                   note="服务器对自动客户端重置 TLS 连接，robots 无法读取；需人工浏览器确认。",
                   source="不可达"),
    "of-america": dict(robots_status="连接被重置", allow_star="未知", allow_bot="未知", crawl_delay="None",
                       sitemaps="—", hit_rule="", verdict="无法确认 · 需人工复核",
                       note="bofainstitute.com 对自动客户端重置连接，robots 无法读取；需人工确认。",
                       source="不可达"),
    "citi": dict(robots_status="200 · 有规则 (间歇403)", allow_star="是", allow_bot="是", crawl_delay="—",
                 sitemaps="—", hit_rule="", verdict="可采集 · WAF 限流(需控频)",
                 note="首读 200 且 /global/insights 允许；该 host 受 WAF 保护、间歇对自动请求返回 403。须重度控频/降并发，必要时人工确认。",
                 source="自动+浏览器核实"),
}
for r in rows:
    ov = OVERRIDES.get(r["slug"])
    if ov:
        r.update(ov)

# keep original order
order = {d["slug"]: i for i, d in enumerate(data)}
rows.sort(key=lambda r: order[r["slug"]])

# ---- write Excel ----
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "爬虫合规评估"

headers = ["#", "机构 Institution", "Host", "研究入口 Research URL",
           "robots.txt", "允许(UA:*)", "允许(本Bot)", "Crawl-delay",
           "Sitemap", "命中Disallow", "结论 Verdict", "核实 Source", "备注 Note"]
ws.append(headers)

hfill = PatternFill("solid", fgColor="14161B")
hfont = Font(bold=True, color="FFFFFF", size=10)
thin = Side(style="thin", color="D0D5DD")
border = Border(left=thin, right=thin, top=thin, bottom=thin)
green = PatternFill("solid", fgColor="E6F4EE")
red = PatternFill("solid", fgColor="FBEAEA")
amber = PatternFill("solid", fgColor="F7EFE0")

for c in ws[1]:
    c.fill = hfill; c.font = hfont; c.alignment = Alignment(vertical="center", wrap_text=True); c.border = border

counts = {"ok": 0, "delay": 0, "blocked": 0, "unknown": 0}
for i, r in enumerate(rows, 1):
    ws.append([i, r["name"], r["host"], r["url"], r["robots_status"], r["allow_star"],
               r["allow_bot"], r["crawl_delay"], r["sitemaps"], r["hit_rule"], r["verdict"], r["source"], r["note"]])
    v = r["verdict"]
    fill = None
    if v.startswith("禁止"):
        fill = red; counts["blocked"] += 1
    elif v.startswith("无法确认"):
        fill = amber; counts["unknown"] += 1
    elif "Crawl-delay" in v:
        fill = green; counts["delay"] += 1; counts["ok"] += 1
    else:
        fill = green; counts["ok"] += 1
    for c in ws[ws.max_row]:
        c.border = border; c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.cell(ws.max_row, 11).fill = fill

widths = [4, 26, 26, 46, 15, 11, 12, 12, 11, 18, 24, 14, 50]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w
ws.freeze_panes = "A2"

# summary sheet
ws2 = wb.create_sheet("说明 Summary")
summary = [
    ["评估时间 Generated", __import__("datetime").date.today().isoformat()],
    ["机构总数 Total", len(rows)],
    ["可采集 Allowed", counts["ok"]],
    ["  其中需遵守 Crawl-delay", counts["delay"]],
    ["禁止该路径 Blocked by robots", counts["blocked"]],
    ["无法确认（需人工）Unknown", counts["unknown"]],
    ["", ""],
    ["方法 Method", "抓取各机构 host 的 /robots.txt，用标准 robots 匹配评估研究入口路径对 UA:* 及本项目 Bot 是否允许，并读取 Crawl-delay 与 Sitemap。"],
    ["读取 UA", READ_UA],
    ["本项目 Bot", OUR_BOT],
    ["重要声明", "本表仅基于 robots.txt。robots 允许≠授权采集全文：仍须遵守各站 使用条款(ToS)、版权、以及不采集付费墙/登录墙/客户专属内容。前端只展示标题+摘要+链接，正文回链官网。"],
    ["二次人工核实", "首轮 Python 取不到 robots 的 8 家，已于 2026-08-27 用无头浏览器/WebFetch 现场复核：UBS/BMO/Rabobank/Fidelity 确认可采集；BlackRock(Akamai 拒)、Neuberger(Vercel 人机验证)、Mizuho、Bank of America(连接重置) 仍无法读取。"],
    ["无法确认者", "站点主动封锁自动访问/启用人机验证，本身即『勿自动采集』信号。不得绕过 bot 检测；采集前须人工确认 robots 与 ToS，或改用官方 RSS/API/授权。"],
]
for r in summary:
    ws2.append(r)
ws2.column_dimensions["A"].width = 34
ws2.column_dimensions["B"].width = 90
for row in ws2.iter_rows():
    row[0].font = Font(bold=True)
    for c in row:
        c.alignment = Alignment(vertical="top", wrap_text=True)

out = "64机构爬虫合规评估.xlsx"
wb.save(out)

# Machine-readable policy map for the crawler (same source of truth as the sheet).
import re as _re
policy_map = {}
for r in rows:
    v = r["verdict"]
    delay = None
    m = _re.match(r"(\d+)s", str(r["crawl_delay"]))
    if m:
        delay = int(m.group(1))
    if "限流" in v or "WAF" in v:
        delay = max(delay or 0, 5)
    if v.startswith("禁止"):
        pol = "blocked"
    elif v.startswith("无法确认"):
        pol = "manual"
    else:
        pol = "delayed" if delay else "allowed"
    policy_map[r["slug"]] = {"name": r["name"], "policy": pol, "crawlDelay": delay, "verdict": v}

json.dump(policy_map, open("data/crawl_policy.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("counts:", counts)
print("saved:", out, "+ data/crawl_policy.json")
