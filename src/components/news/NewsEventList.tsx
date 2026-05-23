import type { NormalizedNewsEvent } from "../../lib/news/news-types";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function NewsEventList({ events }: { events: NormalizedNewsEvent[] }) {
  if (!events.length) {
    return (
      <div style={{ color: "#94a3b8", padding: 18, border: "1px dashed rgba(148,163,184,0.28)", borderRadius: 16 }}>
        No cached news events yet. Run a news harvest or enable refresh with a provider key.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {events.map((event) => (
        <article
          key={`${event.provider}-${event.providerEventId}`}
          style={{
            border: "1px solid rgba(148,163,184,0.18)",
            borderRadius: 16,
            background: "rgba(15,23,42,0.62)",
            padding: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
            <div style={{ color: "#e0f2fe", fontWeight: 900 }}>{event.headline}</div>
            <div style={{ color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap" }}>{formatDate(event.publishedAt)}</div>
          </div>
          {event.summary && <p style={{ color: "#cbd5e1", margin: "8px 0 0", lineHeight: 1.45 }}>{event.summary}</p>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, color: "#94a3b8", fontSize: 12 }}>
            <span>{event.sourceName ?? event.provider}</span>
            <span>Materiality {event.materialityScore}</span>
            {typeof event.sentimentScore === "number" && <span>Sentiment {event.sentimentScore}</span>}
            {event.url && (
              <a href={event.url} target="_blank" rel="noreferrer" style={{ color: "#67e8f9" }}>
                Open source
              </a>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
