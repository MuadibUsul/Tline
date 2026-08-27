"use client";

import { useState } from "react";
import { createRule } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

type Option = { value: string; label: string };
type Mode = "consensus" | "asset" | "institution" | "theme";

export default function MonitoringRuleForm({ assets, institutions, themes, locale }: {
  assets: Option[];
  institutions: Option[];
  themes: string[];
  locale: Locale;
}) {
  const zh = locale === "zh-CN";
  const [mode, setMode] = useState<Mode>("consensus");
  const [consensusTarget, setConsensusTarget] = useState("market");
  const isConsensus = mode === "consensus";
  const scopeKind = isConsensus ? (consensusTarget === "market" ? "market" : "asset") : mode;
  const scopeRef = isConsensus ? (consensusTarget === "market" ? "" : consensusTarget) : undefined;

  return (
    <form action={createRule} className="monitor-rule-form">
      <input type="hidden" name="scopeKind" value={scopeKind} />
      {scopeRef !== undefined && <input type="hidden" name="scopeRef" value={scopeRef} />}

      <label className="field"><span>{zh ? "监控类型" : "Monitor"}</span>
        <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
          <option value="consensus">{zh ? "共识评分" : "Consensus score"}</option>
          <option value="asset">{zh ? "资产新研报" : "Asset research"}</option>
          <option value="institution">{zh ? "机构新研报" : "Institution research"}</option>
          <option value="theme">{zh ? "交易主线" : "Trading theme"}</option>
        </select>
      </label>

      {isConsensus ? <>
        <label className="field"><span>{zh ? "触发条件" : "Trigger"}</span>
          <select name="type" defaultValue="CONSENSUS_ABOVE">
            <option value="CONSENSUS_ABOVE">{zh ? "共识达到或超过" : "Consensus reaches or exceeds"}</option>
            <option value="CONSENSUS_BELOW">{zh ? "共识降至或低于" : "Consensus falls to or below"}</option>
            <option value="CONSENSUS_DROP_24H">{zh ? "24小时下降至少" : "24h drop of at least"}</option>
            <option value="CONSENSUS_RISE_24H">{zh ? "24小时上升至少" : "24h rise of at least"}</option>
          </select>
        </label>
        <label className="field"><span>{zh ? "对象" : "Target"}</span>
          <select value={consensusTarget} onChange={(event) => setConsensusTarget(event.target.value)}>
            <option value="market">{zh ? "任一精选资产" : "Any featured asset"}</option>
            {assets.map((asset) => <option key={asset.value} value={asset.value}>{asset.label}</option>)}
          </select>
        </label>
        <label className="field"><span>{zh ? "阈值" : "Value"}</span><input name="threshold" type="number" defaultValue={80} min={0} max={100} required /></label>
      </> : <>
        <input type="hidden" name="type" value="NEW_RESEARCH" />
        <input type="hidden" name="threshold" value="0" />
        {mode === "asset" && <label className="field"><span>{zh ? "资产" : "Asset"}</span><select name="scopeRef" required>{assets.map((asset) => <option key={asset.value} value={asset.value}>{asset.label}</option>)}</select></label>}
        {mode === "institution" && <label className="field"><span>{zh ? "机构" : "Institution"}</span><select name="scopeRef" required>{institutions.map((institution) => <option key={institution.value} value={institution.value}>{institution.label}</option>)}</select></label>}
        {mode === "theme" && <label className="field"><span>{zh ? "主题关键词" : "Theme keyword"}</span><input name="scopeRef" list="monitored-themes" maxLength={80} placeholder={zh ? "例如：AI资本开支" : "e.g. AI capex"} required /><datalist id="monitored-themes">{themes.map((theme) => <option key={theme} value={theme} />)}</datalist></label>}
      </>}

      <button type="submit" className="minibtn p">{zh ? "创建监控" : "Create monitor"}</button>
    </form>
  );
}
