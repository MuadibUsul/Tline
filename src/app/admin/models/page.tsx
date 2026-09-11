import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BarList, StatCard, TimeSeries } from "@/app/_components/charts";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, tr, type Locale } from "@/lib/i18n";
import { budgetStatuses, GLOBAL_SCOPE } from "@/lib/llm/budget";
import { apiKeyFor, isLlmDisabled, type ProviderRow } from "@/lib/llm/config";
import { llmUsageReport, recentLlmFailures } from "@/lib/llm/report";
import { envApiKey } from "@/lib/llm/provider";
import { LLM_TASKS, PROVIDER_NAMES, type LlmTask, type ProviderName } from "@/lib/llm/types";
import { can } from "@/lib/permissions";
import { hasSecretKey } from "@/lib/secrets";
import { compact, when } from "../_components/format";
import { deletePrice } from "./actions";
import BudgetRow from "./_components/BudgetRow";
import PriceForm from "./_components/PriceForm";
import ProviderCard from "./_components/ProviderCard";
import RouteRow from "./_components/RouteRow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "模型接入" };

const TASK_COPY: Record<LlmTask, { en: [string, string]; zh: [string, string] }> = {
  translation: {
    en: ["Translation", "The bulk of the spend: every article body, in chunks."],
    zh: ["正文翻译", "花费的大头：每篇正文分片翻译。"],
  },
  translation_review: {
    en: ["Translation review", "Second opinion on a finished translation. Sampled, not every article."],
    zh: ["翻译复核", "对成品译文的独立复核。抽样执行，并非每篇都跑。"],
  },
  analysis: {
    en: ["Article analysis", "Summary, key figures and atomic views from the source text."],
    zh: ["文章解析", "从原文提取摘要、关键数字与原子观点。"],
  },
  forecast: {
    en: ["Forecast extraction", "Mines institution forecasts for upcoming releases."],
    zh: ["预测抽取", "从研报中挖掘机构对未来数据的预测。"],
  },
  release_analysis: {
    en: ["Release read-out", "Bilingual commentary once an economic print lands."],
    zh: ["数据解读", "宏观数据公布后生成的中英文解读。"],
  },
  policy: { en: ["Policy documents", "FOMC statements and minutes."], zh: ["政策文件", "FOMC 声明与会议纪要。"] },
  retitle: { en: ["Title repair", "Run by hand, not by the scheduler."], zh: ["标题修复", "人工执行，调度器不跑。"] },
};

function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function money(cost: number | null, currency: string, locale: Locale): string {
  if (cost === null) return tr(locale, "not priced", "未定价");
  return `${currency} ${cost < 1 ? cost.toFixed(4) : cost.toFixed(2)}`;
}

/** Display name for a budget scope: the global sentinel, else the task's own copy. */
function scopeTitle(scope: string, locale: Locale): string {
  if (scope === GLOBAL_SCOPE) return tr(locale, "All tasks", "全部任务");
  const copy = TASK_COPY[scope as LlmTask];
  return copy ? tr(locale, copy.en[0], copy.zh[0]) : scope;
}

export default async function ModelsPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.models")) notFound();
  const locale = await getAdminLocale();

  const [providerRows, routeRows, prices, usage, failures, budgets] = await Promise.all([
    prisma.llmProvider.findMany(),
    prisma.llmTaskRoute.findMany(),
    prisma.llmModelPrice.findMany({ orderBy: [{ provider: "asc" }, { model: "asc" }] }),
    llmUsageReport(30),
    recentLlmFailures(8),
    budgetStatuses(),
  ]);
  const pausedByBudget = budgets.filter((row) => row.over);

  const byProvider = new Map(providerRows.map((row) => [row.provider, row]));
  const byTask = new Map(routeRows.map((row) => [row.task, row]));
  const failureRate = usage.totals.calls === 0 ? null : (usage.totals.failed / usage.totals.calls) * 100;
  const priced = new Set(prices.map((row) => `${row.provider} · ${row.model}`));
  const suggestions = usage.byModel
    .filter((row) => !priced.has(row.label))
    .map((row) => { const [provider, model] = row.label.split(" · "); return { provider, model }; });

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "Model providers", "模型接入")}</h1>
          <p className="sub">
            {tr(
              locale,
              "Credentials, per-task routing and what each pipeline stage actually spends. Keys are encrypted before storage and are never sent back to this page — only their last four characters are shown.",
              "模型密钥、按任务的模型路由，以及各环节的真实消耗。密钥加密后存储，永不回传本页面，只显示末四位。",
            )}
          </p>
        </div>
        <div className="tag-row">
          <span className="chip acc">{tr(locale, `${usage.days}d`, `近 ${usage.days} 天`)}</span>
        </div>
      </header>

      {isLlmDisabled() && (
        <p className="notice bad" role="alert">
          {tr(
            locale,
            "Every model call is switched off by LLM_DISABLED in the environment. Task routing below is ignored while it is set.",
            "环境变量 LLM_DISABLED 已开启，所有模型调用已停用。开启期间下方的任务路由不生效。",
          )}
        </p>
      )}

      {usage.totals.truncated > 0 && (
        <p className="notice bad" role="alert">
          {tr(
            locale,
            `${usage.totals.truncated} call(s) were cut off at the output ceiling. A truncated reply is billed in full and its caller usually retries, so raising the limit for that task can cost less than leaving it.`,
            `有 ${usage.totals.truncated} 次调用在输出上限处被截断。被截断的回复照样全额计费，且调用方通常会重跑一次——把该任务的上限调高，往往比维持现状更省。`,
          )}
        </p>
      )}

      {pausedByBudget.length > 0 && (
        <p className="notice bad" role="alert">
          {tr(
            locale,
            `Paused by budget: ${pausedByBudget.map((row) => scopeTitle(row.scope, locale)).join(", ")}. These calls are stopped until spend rolls into the next period or you raise the ceiling below.`,
            `已触及预算而暂停：${pausedByBudget.map((row) => scopeTitle(row.scope, locale)).join("、")}。相关调用已停止，直到进入下一周期或你在下方调高上限。`,
          )}
        </p>
      )}

      {!hasSecretKey() && (
        <p className="notice bad" role="alert">
          {tr(
            locale,
            "No CONFIG_ENCRYPTION_KEY or AUTH_SECRET is set, so keys cannot be stored here yet. Environment variables still work.",
            "环境中没有 CONFIG_ENCRYPTION_KEY 或 AUTH_SECRET，因此暂时无法在此保存密钥。环境变量方式仍然有效。",
          )}
        </p>
      )}

      <section className="admin-stats admin-stats-6" aria-label={tr(locale, "Model usage", "模型消耗")}>
        <StatCard label={tr(locale, "Calls", "调用次数")} value={compact(usage.totals.calls)} note={tr(locale, "recorded from the provider response", "来自服务商响应")} />
        <StatCard label={tr(locale, "Input tokens", "输入 token")} value={tokens(usage.totals.inputTokens)} note={tr(locale, "measured, not estimated", "实测值，非估算")} />
        <StatCard label={tr(locale, "Output tokens", "输出 token")} value={tokens(usage.totals.outputTokens)} note={tr(locale, "billed even when truncated", "被截断也照样计费")} />
        <StatCard
          label={tr(locale, "Estimated cost", "估算成本")}
          value={money(usage.totals.cost, usage.totals.currency, locale)}
          note={usage.unpricedModels.length
            ? tr(locale, `${usage.unpricedModels.length} model(s) unpriced`, `${usage.unpricedModels.length} 个模型未定价`)
            : tr(locale, "from the prices below", "按下方价目表")}
        />
        <StatCard
          label={tr(locale, "Failure rate", "失败率")}
          value={failureRate === null ? "—" : `${failureRate.toFixed(1)}%`}
          note={tr(locale, "a failed call still costs tokens", "失败调用同样消耗 token")}
        />
        <StatCard
          label={tr(locale, "Truncated", "被截断")}
          value={compact(usage.totals.truncated)}
          note={tr(locale, "hit the output ceiling; usually forces a retry", "触顶输出上限，通常会引发重跑")}
        />
      </section>

      {usage.totals.calls > 0 && (
        <section className="blk">
          <div className="section-t">
            <span>{tr(locale, "Tokens per day", "每日 token")}</span>
            <span className="chip gray">{usage.days}d · UTC</span>
          </div>
          <TimeSeries points={usage.series} primaryLabel={tr(locale, "Tokens", "Token")} secondaryLabel={tr(locale, "Calls", "调用次数")} />
        </section>
      )}

      <div className="analytics-grid">
        <section className="blk">
          <div className="section-t">{tr(locale, "By task", "按任务")}</div>
          <BarList
            empty={tr(locale, "No model call recorded yet.", "尚无模型调用记录。")}
            rows={usage.byTask.map((row) => ({
              label: TASK_COPY[row.label as LlmTask] ? tr(locale, TASK_COPY[row.label as LlmTask].en[0], TASK_COPY[row.label as LlmTask].zh[0]) : row.label,
              value: row.inputTokens + row.outputTokens,
              hint: `${compact(row.calls)} ${tr(locale, "calls", "次")} · ${money(row.cost, row.currency, locale)}`,
            }))}
          />
        </section>
        <section className="blk">
          <div className="section-t">{tr(locale, "By model", "按模型")}</div>
          <BarList
            empty={tr(locale, "No model call recorded yet.", "尚无模型调用记录。")}
            rows={usage.byModel.map((row) => ({
              label: row.label,
              value: row.inputTokens + row.outputTokens,
              hint: `${compact(row.calls)} ${tr(locale, "calls", "次")} · ${money(row.cost, row.currency, locale)}`,
            }))}
          />
        </section>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Task routing", "任务路由")}</div>
        <p className="sub">
          {tr(
            locale,
            "Leave a provider on Auto to use the configured default order. An empty model uses the provider's default. Switching a task off stops those calls entirely.",
            "服务商留空表示按默认顺序自动选择；模型留空表示用该服务商的默认模型。关闭某个任务将完全停止该类调用。",
          )}
        </p>
        <div className="llm-routes">
          {LLM_TASKS.map((task) => {
            const row = byTask.get(task);
            const copy = TASK_COPY[task];
            return (
              <RouteRow
                key={task}
                task={task}
                title={tr(locale, copy.en[0], copy.zh[0])}
                hint={tr(locale, copy.en[1], copy.zh[1])}
                provider={row?.provider ?? null}
                model={row?.model ?? null}
                enabled={row?.enabled ?? true}
                providers={[...PROVIDER_NAMES]}
                labels={{
                  auto: tr(locale, "Auto", "自动"),
                  providerDefault: tr(locale, "provider default", "服务商默认"),
                  enabled: tr(locale, "On", "启用"),
                  save: tr(locale, "Save", "保存"),
                  saving: tr(locale, "Saving…", "保存中…"),
                }}
              />
            );
          })}
        </div>
      </section>

      <section className="blk">
        <div className="section-t">{tr(locale, "Budgets", "预算额度")}</div>
        <p className="sub">
          {tr(
            locale,
            "A spending ceiling per task, plus one across all of them. When a scope reaches its cap for the period it stops on its own — the same effect as switching the task off, but automatic. Set a token cap, a cost cap (needs prices below), or both; leave both blank for no limit. Enforcement is checked within a few seconds and fails open, so LLM_DISABLED stays the instant hard stop.",
            "为每个任务设定支出上限，并可对全部任务设一个总额。某个范围在本周期内触及上限后会自动停止——效果等同于关闭该任务，但无需人工干预。可设 token 上限、费用上限（需下方已定价），或两者皆设；两项都留空即不限制。判定有几秒缓存且失败时放行，因此环境变量 LLM_DISABLED 仍是即时的硬性开关。",
          )}
        </p>
        <div className="llm-budgets">
          {budgets.map((row) => (
            <BudgetRow
              key={row.scope}
              scope={row.scope}
              title={scopeTitle(row.scope, locale)}
              hint={row.scope === GLOBAL_SCOPE
                ? tr(locale, "Every task, summed. Reaching this pauses them all.", "所有任务合计。触及后全部暂停。")
                : tr(locale, TASK_COPY[row.scope as LlmTask].en[1], TASK_COPY[row.scope as LlmTask].zh[1])}
              period={row.period}
              limitTokens={row.limitTokens}
              limitCost={row.limitCost}
              enabled={row.enabled}
              spentTokens={row.spentTokens}
              spentCost={row.spentCost}
              currency={row.currency}
              fraction={row.fraction}
              over={row.over}
              labels={{
                day: tr(locale, "per day", "按天"),
                month: tr(locale, "per month", "按月"),
                tokenCap: tr(locale, "token cap", "token 上限"),
                costCap: tr(locale, "cost cap", "费用上限"),
                noCap: tr(locale, "no cap", "不限"),
                enabled: tr(locale, "On", "启用"),
                save: tr(locale, "Save", "保存"),
                saving: tr(locale, "Saving…", "保存中…"),
                spent: tr(locale, "Spent", "已用"),
                paused: tr(locale, "paused", "已暂停"),
              }}
            />
          ))}
        </div>
      </section>

      <div className="llm-providers">
        {PROVIDER_NAMES.map((name: ProviderName) => {
          const row = byProvider.get(name);
          const stored = Boolean(row?.apiKeyCipher);
          const inForce = apiKeyFor(name, row as ProviderRow | undefined);
          return (
            <ProviderCard
              key={name}
              provider={name}
              title={name}
              hint={row?.apiKeyHint ?? null}
              keySource={stored ? "console" : inForce || envApiKey(name) ? "environment" : "none"}
              baseUrl={row?.baseUrl ?? null}
              defaultModel={row?.defaultModel ?? null}
              enabled={row?.enabled ?? true}
              lastCheck={row?.lastCheckedAt
                ? `${when(row.lastCheckedAt, locale)} · ${row.lastCheckOk ? tr(locale, "ok", "正常") : (row.lastCheckError ?? tr(locale, "failed", "失败")).slice(0, 120)}`
                : null}
              labels={{
                apiKey: tr(locale, "API key", "API 密钥"),
                apiKeyPlaceholder: tr(locale, "paste a key to store it", "粘贴密钥以保存"),
                keyInForce: tr(locale, "stored:", "已存："),
                fromConsole: tr(locale, "console key", "后台密钥"),
                fromEnvironment: tr(locale, "environment key", "环境变量密钥"),
                noKey: tr(locale, "no key", "未配置"),
                clearKey: tr(locale, "Remove the stored key", "删除已存密钥"),
                baseUrl: tr(locale, "Base URL", "接口地址"),
                baseUrlHint: tr(locale, "leave empty for the vendor default", "留空使用官方默认地址"),
                defaultModel: tr(locale, "Default model", "默认模型"),
                defaultModelHint: tr(locale, "used when a task names no model", "任务未指定模型时使用"),
                enabled: tr(locale, "Enabled", "启用"),
                save: tr(locale, "Save", "保存"),
                saving: tr(locale, "Saving…", "保存中…"),
                test: tr(locale, "Test connection", "测试连接"),
                testing: tr(locale, "Testing…", "测试中…"),
                lastCheck: tr(locale, "Last checked", "上次检查"),
              }}
            />
          );
        })}
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Model prices", "模型价目")}</div>
        <p className="sub">
          {tr(
            locale,
            "Price per million tokens, as billed by your account. Nothing is filled in for you: published rates change and vary by contract, and a guessed number would be reported above as if it were fact.",
            "按你的账户实际计费填写每百万 token 的价格。系统不预填任何数字：公开价格会变、且因合同而异，凭空填的数字会被上方当作事实展示。",
          )}
        </p>
        <PriceForm
          providers={[...PROVIDER_NAMES]}
          suggestions={suggestions}
          labels={{
            provider: tr(locale, "Provider", "服务商"),
            model: tr(locale, "Model", "模型"),
            modelPlaceholder: tr(locale, "exact model id", "完整模型名"),
            inputPrice: tr(locale, "Input / 1M", "输入 / 百万"),
            outputPrice: tr(locale, "Output / 1M", "输出 / 百万"),
            currency: tr(locale, "Currency", "币种"),
            save: tr(locale, "Save price", "保存价格"),
            saving: tr(locale, "Saving…", "保存中…"),
          }}
        />
        {prices.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr(locale, "Model", "模型")}</th>
                <th>{tr(locale, "Input / 1M", "输入 / 百万")}</th>
                <th>{tr(locale, "Output / 1M", "输出 / 百万")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.map((row) => (
                <tr key={row.id}>
                  <td><code>{row.provider} · {row.model}</code></td>
                  <td>{row.currency} {row.inputPerMTok}</td>
                  <td>{row.currency} {row.outputPerMTok}</td>
                  <td>
                    <form action={deletePrice}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="minibtn" type="submit">{tr(locale, "Remove", "删除")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {usage.unpricedModels.length > 0 && (
          <p className="sub">
            {tr(locale, "Seen but unpriced: ", "有调用但未定价：")}
            {usage.unpricedModels.map((model) => <code key={model}>{model}</code>)}
          </p>
        )}
      </section>

      {failures.length > 0 && (
        <section className="blk">
          <div className="section-t">{tr(locale, "Recent failures", "最近失败")}</div>
          <p className="sub">
            {tr(
              locale,
              "A failed call is not a free call: a completion cut off at the token limit is billed for everything it generated before being cut.",
              "失败的调用并不免费：被 token 上限截断的回复，截断前生成的内容照样计费。",
            )}
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr(locale, "When", "时间")}</th>
                <th>{tr(locale, "Task", "任务")}</th>
                <th>{tr(locale, "Model", "模型")}</th>
                <th>{tr(locale, "Output", "输出")}</th>
                <th>{tr(locale, "Error", "错误")}</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((row) => (
                <tr key={row.id}>
                  <td>{when(row.createdAt, locale)}</td>
                  <td>{row.task}</td>
                  <td><code>{row.provider} · {row.model}</code></td>
                  <td>{row.outputTokens || "—"}</td>
                  <td className="llm-error">{row.error?.slice(0, 160) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
