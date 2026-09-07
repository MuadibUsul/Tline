import "dotenv/config";
import { prisma } from "../src/lib/db";
import { providerByName } from "../src/lib/llm/config";
import { isProviderName } from "../src/lib/llm/types";
import type { CompletionInput, CompletionResult, LLMProvider } from "../src/lib/llm/types";
import { translateArticle } from "../src/lib/translation/translate";

// Compare translation providers on the same articles: call count, latency, deterministic
// quality, and sample output for eyeballing. Costs a few real API calls per provider.
//   npm run translate:eval -- --limit=2                 (auto: every provider with a key)
//   npm run translate:eval -- --ids=<id1>,<id2> --providers=deepseek,gemini --review
function arg(name: string) { return process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3); }
const flag = (name: string) => process.argv.includes(`--${name}`);

// Wrap a provider to count calls and sum the characters sent/received (a cost proxy).
class Metered implements LLMProvider {
  calls = 0; inChars = 0; outChars = 0;
  constructor(private readonly inner: LLMProvider, readonly name = inner.name, readonly model = inner.model) {}
  async complete(input: CompletionInput): Promise<CompletionResult> {
    this.calls++; this.inChars += input.system.length + input.user.length;
    const result = await this.inner.complete(input);
    this.outChars += result.text.length;
    return result;
  }
}

async function main() {
  const ids = (arg("ids") || "").split(",").filter(Boolean);
  const limit = Math.max(1, Number(arg("limit") || 2));
  const enableReview = flag("review");
  const wanted = (arg("providers") || "deepseek,gemini,openai,anthropic").split(",").map((p) => p.trim());
  // Each named provider is resolved on its own rather than through task routing: the whole
  // point here is to compare vendors, not to use whichever one the pipeline currently prefers.
  const resolved = await Promise.all(wanted.map(async (name) => ({
    name,
    provider: isProviderName(name) ? await providerByName(name) : null,
  })));
  const providers = resolved.filter((entry): entry is { name: string; provider: LLMProvider } => entry.provider !== null);
  if (!providers.length) { console.log("None of the requested providers has a key, in the console or the environment."); return; }
  console.log(`Providers: ${providers.map((p) => `${p.name}(${p.provider.model})`).join(", ")} · review=${enableReview}\n`);

  const articles = await prisma.article.findMany({
    where: ids.length ? { id: { in: ids } } : { rawText: { not: null }, segments: { some: {} } },
    include: { institution: { select: { name: true } }, segments: { orderBy: { position: "asc" } } },
    orderBy: { publishedAt: "desc" },
    take: ids.length ? undefined : limit,
  });

  for (const article of articles) {
    console.log(`\n=== ${article.title}`);
    console.log(`    EN: ${article.segments[0]?.text.slice(0, 160)}…\n`);
    for (const { name, provider } of providers) {
      const metered = new Metered(provider);
      const startedAt = Date.now();
      try {
        // Sample rate 1: comparing providers means every candidate must be scored the
        // same way. Production's sampling would review some providers and not others.
        const result = await translateArticle(article.institution.name, article.title, article.segments, metered, metered, enableReview, 1);
        const ms = Date.now() - startedAt;
        console.log(`  [${name}] calls=${metered.calls} ${ms}ms · quality=${result.quality.score.toFixed(2)} status=${result.status} · in≈${(metered.inChars / 1000).toFixed(1)}k out≈${(metered.outChars / 1000).toFixed(1)}k chars`);
        console.log(`     标题: ${result.title}`);
        console.log(`     正文: ${result.segments[0]?.text.slice(0, 160)}…`);
      } catch (error) {
        console.log(`  [${name}] FAILED · ${String(error).slice(0, 200)}`);
      }
    }
  }
  console.log("\nNote: DeepSeek bills cache-hit input tokens at a fraction of cache-miss; the glossary now lives in the constant system prefix so repeat calls hit the cache.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
