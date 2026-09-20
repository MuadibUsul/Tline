"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import type { DashboardWidget, DashboardWidgetType } from "@/lib/dashboards";
import { DASHBOARD_WALLPAPERS } from "@/lib/dashboards";
import type { DashboardWidgetData } from "@/lib/dashboardData";
import { createDashboardAlert, deleteDashboardAlert, saveDashboard, toggleDashboardAlert } from "../actions";

type Choice = { key: string; label: string };
type Rule = { id: string; name: string; active: boolean; lastFiredAt: string | null };
type Drag = { mode: "move" | "resize" | "pan"; id?: string; startX: number; startY: number; x: number; y: number; w?: number; h?: number } | null;

const labels = {
  en: { save: "Save", saved: "Saved", add: "Add card", market: "Market", macro: "Macro", research: "Research", note: "Note", source: "Source", settings: "Inspector", background: "Background", customImage: "Custom image URL", title: "Title", dataSource: "Data source", remove: "Remove card", alert: "Alert", createAlert: "Create alert", alerts: "Dashboard alerts", inactive: "Paused", empty: "No data yet", zoomReset: "Reset view", loading: "Saving…", live: "LIVE", open: "Open source", latest: "Latest", previous: "Previous", threshold: "Threshold", scope: "Research scope", text: "Content", active: "Active" },
  zh: { save: "保存", saved: "已保存", add: "添加卡片", market: "行情", macro: "宏观指标", research: "研报", note: "笔记", source: "外部来源", settings: "卡片设置", background: "背景", customImage: "自定义图片 URL", title: "标题", dataSource: "数据源", remove: "删除卡片", alert: "提醒", createAlert: "创建提醒", alerts: "看板提醒", inactive: "已暂停", empty: "暂无数据", zoomReset: "复位画布", loading: "保存中…", live: "实时", open: "打开来源", latest: "最新", previous: "前值", threshold: "阈值", scope: "研报范围", text: "内容", active: "启用中" },
} as const;

function Sparkline({ points }: { points?: Array<{ label: string; value: number }> }) {
  const values = points?.filter((point) => Number.isFinite(point.value)).slice(-40) ?? [];
  if (values.length < 2) return <div className="dashboard-spark-empty">—</div>;
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const range = max - min || 1;
  const line = values.map((point, index) => `${(index / (values.length - 1)) * 100},${38 - ((point.value - min) / range) * 34}`).join(" ");
  return <svg className="dashboard-spark" viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label={`${values[0].label} – ${values.at(-1)!.label}`}><polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

function WidgetBody({ widget, data, l }: { widget: DashboardWidget; data?: DashboardWidgetData; l: typeof labels.en | typeof labels.zh }) {
  if (widget.type === "note") return <p className="dashboard-note-copy">{widget.text || "—"}</p>;
  if (widget.type === "source") return <div className="dashboard-source-card"><p>{widget.text || widget.url}</p>{widget.url && <a href={widget.url} target="_blank" rel="noopener noreferrer">{l.open} ↗</a>}</div>;
  if (!data || data.kind === "static") return <div className="dashboard-card-empty">{l.empty}</div>;
  if (data.kind === "research") return data.items.length ? <div className="dashboard-research-list">{data.items.map((item) => <a href={item.href} key={item.href}><b>{item.title}</b><small>{item.meta}</small></a>)}</div> : <div className="dashboard-card-empty">{l.empty}</div>;
  if (!data.available) return <div className="dashboard-card-empty">{l.empty}</div>;
  if (data.kind === "market") return <><div className="dashboard-number-row"><strong>{data.latest}</strong>{data.changePct !== undefined && <span className={data.changePct >= 0 ? "positive" : "negative"}>{data.changePct >= 0 ? "+" : ""}{data.changePct.toFixed(2)}%</span>}</div><Sparkline points={data.points} /><small className="dashboard-data-foot">30D · {data.asOf?.slice(0, 16).replace("T", " ")} UTC</small></>;
  return <><div className="dashboard-number-row"><strong>{data.latest}</strong><span>{data.unit}</span></div><Sparkline points={data.points} /><div className="dashboard-data-foot"><span>{data.period}</span><span>{l.previous} {data.previous ?? "—"}</span>{data.sourceUrl && <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">↗</a>}</div></>;
}

export default function DashboardCanvas(props: {
  dashboard: { id: string; name: string; wallpaper: string; wallpaperUrl: string; accent: string };
  initialWidgets: DashboardWidget[];
  data: Record<string, DashboardWidgetData>;
  assets: Array<{ ticker: string; name: string }>;
  indicators: Choice[];
  institutions: Choice[];
  topics: Choice[];
  rules: Rule[];
  locale: "en" | "zh-CN";
}) {
  const zh = props.locale === "zh-CN";
  const l = zh ? labels.zh : labels.en;
  const router = useRouter();
  const [widgets, setWidgets] = useState(props.initialWidgets);
  const [name, setName] = useState(props.dashboard.name);
  const [wallpaper, setWallpaper] = useState(props.dashboard.wallpaper);
  const [wallpaperUrl, setWallpaperUrl] = useState(props.dashboard.wallpaperUrl);
  const [accent, setAccent] = useState(props.dashboard.accent);
  const [selectedId, setSelectedId] = useState<string | null>(props.initialWidgets[0]?.id ?? null);
  const [addType, setAddType] = useState<DashboardWidgetType>("market");
  const [zoom, setZoom] = useState(0.9);
  const [offset, setOffset] = useState({ x: 24, y: 24 });
  const [message, setMessage] = useState("");
  const [alertType, setAlertType] = useState("NEW_RESEARCH");
  const [threshold, setThreshold] = useState("0");
  const [pending, startTransition] = useTransition();
  const drag = useRef<Drag>(null);
  const selected = widgets.find((item) => item.id === selectedId) ?? null;

  useEffect(() => { setWidgets(props.initialWidgets); }, [props.initialWidgets]);
  useEffect(() => {
    if (selected?.type === "macro") setAlertType("MACRO_RELEASE");
    else setAlertType("NEW_RESEARCH");
  }, [selected?.id, selected?.type]);

  const sourceChoices = useMemo(() => {
    if (!selected) return [];
    if (selected.type === "market") return props.assets.map((asset) => ({ key: asset.ticker, label: `${asset.ticker} · ${asset.name}` }));
    if (selected.type === "macro") return props.indicators;
    if (selected.type === "research") return selected.scopeKind === "institution" ? props.institutions : selected.scopeKind === "topic" ? props.topics : props.assets.map((asset) => ({ key: asset.ticker, label: `${asset.ticker} · ${asset.name}` }));
    return [];
  }, [selected, props.assets, props.indicators, props.institutions, props.topics]);

  const update = (id: string, patch: Partial<DashboardWidget>) => setWidgets((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addWidget = () => {
    const index = widgets.length + 1;
    const id = globalThis.crypto?.randomUUID?.() ?? `widget-${Date.now()}`;
    const base: DashboardWidget = { id, type: addType, title: l[addType], x: Math.round((120 - offset.x) / zoom), y: Math.round((100 - offset.y) / zoom), w: 360, h: 235 };
    if (addType === "market") base.ref = props.assets[0]?.ticker;
    if (addType === "macro") base.ref = props.indicators[0]?.key;
    if (addType === "research") { base.scopeKind = "asset"; base.ref = props.assets[0]?.ticker; base.h = 310; }
    if (addType === "note") base.text = zh ? `笔记 ${index}` : `Note ${index}`;
    if (addType === "source") { base.text = zh ? "可信外部数据来源" : "Trusted external data source"; base.url = "https://"; }
    setWidgets((current) => [...current, base]);
    setSelectedId(id);
  };

  const move = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / (current.mode === "pan" ? 1 : zoom);
    const dy = (event.clientY - current.startY) / (current.mode === "pan" ? 1 : zoom);
    if (current.mode === "pan") setOffset({ x: current.x + dx, y: current.y + dy });
    else if (current.id && current.mode === "move") update(current.id, { x: Math.round(current.x + dx), y: Math.round(current.y + dy) });
    else if (current.id) update(current.id, { w: Math.max(280, Math.round((current.w ?? 360) + dx)), h: Math.max(180, Math.round((current.h ?? 235) + dy)) });
  };
  const endDrag = (event: ReactPointerEvent) => { drag.current = null; try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {} };

  const save = () => startTransition(async () => {
    setMessage("");
    const result = await saveDashboard({ id: props.dashboard.id, name, layoutJson: JSON.stringify(widgets), wallpaper, wallpaperUrl, accent });
    setMessage("ok" in result ? l.saved : String(result.error));
    if ("ok" in result) router.refresh();
  });

  const createAlert = () => selected && startTransition(async () => {
    const result = await createDashboardAlert({ dashboardId: props.dashboard.id, layoutJson: JSON.stringify(widgets), widgetId: selected.id, type: alertType, threshold: Number(threshold) });
    setMessage("ok" in result ? l.saved : String(result.error));
    if ("ok" in result) router.refresh();
  });

  const customBackground = wallpaperUrl.startsWith("https://") ? { backgroundImage: `linear-gradient(rgba(6,9,14,.72),rgba(6,9,14,.82)),url("${wallpaperUrl.replace(/["\\]/g, "")}")` } : {};

  const startPan = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode: "pan", startX: event.clientX, startY: event.clientY, x: offset.x, y: offset.y };
    setSelectedId(null);
  };

  return <div className="dashboard-shell" style={{ "--dashboard-accent": accent } as CSSProperties}>
    <header className="dashboard-toolbar">
      <input className="dashboard-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label={l.title} />
      <div className="dashboard-toolbar-group"><select value={addType} onChange={(event) => setAddType(event.target.value as DashboardWidgetType)} aria-label={l.add}>{(["market", "macro", "research", "note", "source"] as DashboardWidgetType[]).map((type) => <option value={type} key={type}>{l[type]}</option>)}</select><button type="button" className="minibtn" onClick={addWidget}>＋ {l.add}</button></div>
      <div className="dashboard-toolbar-group dashboard-zoom"><button type="button" onClick={() => setZoom((value) => Math.max(.45, value - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(1.5, value + .1))}>＋</button><button type="button" onClick={() => { setOffset({ x: 24, y: 24 }); setZoom(.9); }}>{l.zoomReset}</button></div>
      <button type="button" className="minibtn p dashboard-save" onClick={save} disabled={pending}>{pending ? l.loading : l.save}</button>{message && <span className="dashboard-save-state" role="status">{message}</span>}
    </header>

    <div className="dashboard-workspace">
      <div className={`dashboard-viewport wallpaper-${wallpaper}`} style={customBackground} onPointerDown={startPan} onPointerMove={move} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="dashboard-stage" style={{ transform: `translate3d(${offset.x}px,${offset.y}px,0) scale(${zoom})` }} onPointerDown={startPan}>
          {widgets.map((widget) => <article className={`dashboard-card ${selectedId === widget.id ? "selected" : ""}`} key={widget.id} style={{ transform: `translate3d(${widget.x}px,${widget.y}px,0)`, width: widget.w, height: widget.h }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest("a,button,input,select,textarea,.dashboard-resize")) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { mode: "move", id: widget.id, startX: event.clientX, startY: event.clientY, x: widget.x, y: widget.y }; setSelectedId(widget.id); }} onPointerMove={move} onPointerUp={endDrag} onPointerCancel={endDrag} onClick={() => setSelectedId(widget.id)}>
            <div className="dashboard-card-head"><div><span>{widget.type}</span><h2>{widget.title}</h2></div><i title={l.live}>{widget.type === "note" || widget.type === "source" ? "" : l.live}</i></div>
            <div className="dashboard-card-body"><WidgetBody widget={widget} data={props.data[widget.id]} l={l} /></div>
            <button className="dashboard-resize" type="button" aria-label="Resize" onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { mode: "resize", id: widget.id, startX: event.clientX, startY: event.clientY, x: widget.x, y: widget.y, w: widget.w, h: widget.h }; setSelectedId(widget.id); }} onPointerMove={move} onPointerUp={endDrag}>⌟</button>
          </article>)}
        </div>
      </div>

      <aside className="dashboard-inspector">
        <section><h2>{l.settings}</h2>{selected ? <>
          <label><span>{l.title}</span><input value={selected.title} maxLength={100} onChange={(event) => update(selected.id, { title: event.target.value })} /></label>
          {selected.type === "research" && <label><span>{l.scope}</span><select value={selected.scopeKind ?? "asset"} onChange={(event) => { const scopeKind = event.target.value as "asset" | "institution" | "topic"; const choices = scopeKind === "institution" ? props.institutions : scopeKind === "topic" ? props.topics : props.assets.map((asset) => ({ key: asset.ticker, label: asset.name })); update(selected.id, { scopeKind, ref: choices[0]?.key }); }}><option value="asset">{zh ? "资产" : "Asset"}</option><option value="institution">{zh ? "机构" : "Institution"}</option><option value="topic">{zh ? "主题" : "Topic"}</option></select></label>}
          {["market", "macro", "research"].includes(selected.type) && <label><span>{l.dataSource}</span><select value={selected.ref ?? ""} onChange={(event) => update(selected.id, { ref: event.target.value })}>{sourceChoices.map((choice) => <option value={choice.key} key={choice.key}>{choice.label}</option>)}</select></label>}
          {selected.type === "note" && <label><span>{l.text}</span><textarea value={selected.text ?? ""} maxLength={1000} onChange={(event) => update(selected.id, { text: event.target.value })} /></label>}
          {selected.type === "source" && <><label><span>URL</span><input value={selected.url ?? ""} onChange={(event) => update(selected.id, { url: event.target.value })} /></label><label><span>{l.text}</span><textarea value={selected.text ?? ""} onChange={(event) => update(selected.id, { text: event.target.value })} /></label></>}
          <button type="button" className="dashboard-remove" onClick={() => { setWidgets((current) => current.filter((item) => item.id !== selected.id)); setSelectedId(null); }}>{l.remove}</button>
          {["market", "macro", "research"].includes(selected.type) && <div className="dashboard-alert-builder"><h3>{l.alert}</h3><select value={alertType} onChange={(event) => setAlertType(event.target.value)}>{selected.type === "market" && <><option value="NEW_RESEARCH">{zh ? "出现新研报" : "New research"}</option><option value="CONSENSUS_ABOVE">{zh ? "共识高于阈值" : "Consensus above"}</option><option value="CONSENSUS_BELOW">{zh ? "共识低于阈值" : "Consensus below"}</option></>}{selected.type === "macro" && <><option value="MACRO_RELEASE">{zh ? "数据发布" : "Data release"}</option><option value="MACRO_SURPRISE_ABOVE">{zh ? "高于预期" : "Positive surprise"}</option><option value="MACRO_SURPRISE_BELOW">{zh ? "低于预期" : "Negative surprise"}</option></>}{selected.type === "research" && <option value="NEW_RESEARCH">{zh ? "出现新研报" : "New research"}</option>}</select>{!["NEW_RESEARCH", "MACRO_RELEASE"].includes(alertType) && <label><span>{l.threshold}</span><input type="number" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>}<button type="button" className="minibtn" onClick={createAlert} disabled={pending}>{l.createAlert}</button></div>}
        </> : <p className="dashboard-inspector-empty">{zh ? "选择一张卡片进行编辑，拖动画布空白区域可平移。" : "Select a card to edit it. Drag empty canvas space to pan."}</p>}</section>

        <section><h2>{l.background}</h2><label><span>{zh ? "预设" : "Preset"}</span><select value={wallpaper} onChange={(event) => setWallpaper(event.target.value)}>{DASHBOARD_WALLPAPERS.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label><span>{l.customImage}</span><input type="url" value={wallpaperUrl} placeholder="https://…" onChange={(event) => setWallpaperUrl(event.target.value)} /></label><label><span>{zh ? "强调色" : "Accent"}</span><input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label></section>

        <section><h2>{l.alerts} <small>{props.rules.length}</small></h2><div className="dashboard-rule-list">{props.rules.map((rule) => <div key={rule.id}><button type="button" className={rule.active ? "active" : ""} onClick={() => startTransition(async () => { await toggleDashboardAlert(props.dashboard.id, rule.id); router.refresh(); })}>{rule.active ? "●" : "○"}</button><p><b>{rule.name}</b><small>{rule.active ? l.active : l.inactive}{rule.lastFiredAt ? ` · ${rule.lastFiredAt.slice(0, 10)}` : ""}</small></p><button type="button" onClick={() => startTransition(async () => { await deleteDashboardAlert(props.dashboard.id, rule.id); router.refresh(); })}>×</button></div>)}</div></section>
      </aside>
    </div>
  </div>;
}
