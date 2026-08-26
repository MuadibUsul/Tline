import { latestFeed } from "@/lib/queries";
import { FeedCard } from "@/app/_components/ui";

export const dynamic = "force-dynamic";

export default async function ResearchIndex() {
  const feed = await latestFeed(30);
  return (
    <main className="wrap">
      <div className="page-head"><div className="eyebrow">Feed</div><h1>Latest Research</h1></div>
      <section style={{ paddingTop: 22, maxWidth: 720 }}>
        <div className="feed">{feed.map((a) => <FeedCard key={a.id} a={a} />)}</div>
      </section>
    </main>
  );
}
