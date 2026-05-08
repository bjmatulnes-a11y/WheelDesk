"use client";

import { useEffect, useState } from "react";

type SavedPost = { id: string; title: string; date: string; slug: string; excerpt: string; markdown: string; html: string; createdAt: string };
const POST_KEY = "wheeldesk_newsletter_posts_v1";

function readPosts(): SavedPost[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(POST_KEY) || "[]") as SavedPost[]; } catch { return []; }
}

export default function BlogPage() {
  const [posts, setPosts] = useState<SavedPost[]>([]);
  useEffect(() => setPosts(readPosts()), []);
  return (
    <main style={{ padding: 32, fontFamily: "Arial, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1>WheelDesk Blog</h1>
      <p style={{ color: "#4b5563" }}>Weekly premium-map advisories and market-structure notes.</p>
      {posts.length === 0 ? (
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 18 }}>
          <h2>WheelDesk Weekly Premium Map</h2>
          <p>No newsletter has been published locally yet. Generate one from the hidden newsletter page, then save it to blog.</p>
          <a href="/dashboard/newsletter">Open internal newsletter generator</a>
        </section>
      ) : posts.map((post) => (
        <article key={post.id} style={{ borderBottom: "1px solid #e5e7eb", padding: "18px 0" }}>
          <h2><a href="/blog/wheeldesk-weekly">{post.title}</a></h2>
          <p style={{ color: "#6b7280" }}>{post.date}</p>
          <p>{post.excerpt}</p>
        </article>
      ))}
    </main>
  );
}
