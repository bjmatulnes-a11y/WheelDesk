"use client";

import { useEffect, useState } from "react";

type SavedPost = { id: string; title: string; date: string; slug: string; excerpt: string; markdown: string; html: string; createdAt: string };
const POST_KEY = "wheeldesk_newsletter_posts_v1";

function readLatest(): SavedPost | null {
  if (typeof window === "undefined") return null;
  try { return (JSON.parse(window.localStorage.getItem(POST_KEY) || "[]") as SavedPost[])[0] ?? null; } catch { return null; }
}

export default function WeeklyBlogPostPage() {
  const [post, setPost] = useState<SavedPost | null>(null);
  useEffect(() => setPost(readLatest()), []);
  return (
    <main style={{ padding: 32, fontFamily: "Arial, sans-serif", maxWidth: 860, margin: "0 auto" }}>
      <style>{`article h1{font-size:34px} article h2{border-top:1px solid #e5e7eb;padding-top:18px;margin-top:24px} article p{line-height:1.55}.bullet{margin-left:12px}`}</style>
      <p><a href="/blog">← Blog</a></p>
      {!post ? (
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 18 }}>
          <h1>WheelDesk Weekly Premium Map</h1>
          <p>No local newsletter post exists yet.</p>
          <a href="/dashboard/newsletter">Generate one internally</a>
        </section>
      ) : (
        <article dangerouslySetInnerHTML={{ __html: post.html }} />
      )}
    </main>
  );
}
