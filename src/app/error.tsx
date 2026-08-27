"use client";

export default function ErrorState({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wrap system-state" role="alert">
      <div className="eyebrow"><span className="lang-en">Error</span><span className="lang-zh">错误</span></div>
      <h1><span className="lang-en">That view could not be loaded.</span><span className="lang-zh">无法加载此页面。</span></h1>
      <p><span className="lang-en">The stored data is unchanged. Retry the request or return later.</span><span className="lang-zh">已存储数据未受影响，请重试或稍后返回。</span></p>
      <button className="minibtn p" type="button" onClick={reset}><span className="lang-en">Retry</span><span className="lang-zh">重试</span></button>
    </main>
  );
}
