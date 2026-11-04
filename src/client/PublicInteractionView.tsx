import type { InteractionSnapshot } from "./interactions";

type PublicInteractionViewProps = {
  state: InteractionSnapshot;
};

const feedbackLabels: Record<string, string> = {
  like: "👍 讚",
  "want-listen": "👂 我想聽",
  useful: "💡 這個實用",
};

export function PublicInteractionView({ state }: PublicInteractionViewProps) {
  const publicQueue = state.publicQueue.filter((event) => event.kind === "danmaku");
  return (
    <section className="panel-card display-interactions" aria-labelledby="display-interaction-title" data-testid="display-interactions">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PUBLIC ROOM RESPONSE</p>
          <h2 id="display-interaction-title">房內回應</h2>
        </div>
        <span className="live-label"><span /> {state.presentation.paused ? "展示暫停" : "同步中"}</span>
      </div>
      <div className="display-feedback-grid" data-testid="display-feedback-stats">
        {Object.entries(feedbackLabels).map(([key, label]) => {
          const value = state.feedbackStats[key as keyof typeof state.feedbackStats];
          return <div className="display-feedback-stat" key={key} data-testid={`display-feedback-${key}`}><strong>{label}</strong><span>{value.count} 次 · {value.uniqueParticipants} 人</span></div>;
        })}
      </div>
      <section aria-label="公開彈幕" className="display-public-queue" data-testid="display-public-queue">
        <h3>公開彈幕</h3>
        {publicQueue.length ? publicQueue.map((event) => (
          <article key={event.id} className="display-public-message" data-testid="display-public-message" data-kind={event.kind}>
            <strong>{event.displayName}</strong><span>{event.text}</span>
          </article>
        )) : <p className="empty-state">目前沒有待展示的公開彈幕。</p>}
      </section>
      <p className="display-privacy-note">此頁只接收公開彈幕與回饋統計，不接收聊天或貼圖歷史。</p>
    </section>
  );
}
