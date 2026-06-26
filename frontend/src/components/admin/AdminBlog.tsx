
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ConfirmModal } from "../ConfirmModal";
import { EmptyState } from "../EmptyState";
import { Icon } from "../Icon";
import { RichTextEditor } from "../RichTextEditor";
import { useToast } from "../Toast";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  image: string;
  published: boolean;
  createdAt: string;
  metaTitle?: string;
  metaDescription?: string;
}

type EditorTab = "general" | "seo";

const EMPTY: Omit<BlogPost, "id" | "createdAt"> = {
  title: "",
  slug: "",
  summary: "",
  content: "",
  image: "",
  published: false,
  metaTitle: "",
  metaDescription: "",
};

export const AdminBlog: React.FC = () => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BlogPost | null>(null);
  const [form, setForm] = useState<Omit<BlogPost, "id" | "createdAt">>(EMPTY);
  const [editorTab, setEditorTab] = useState<EditorTab>("general");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingPost, setDeletingPost] = useState<BlogPost | null>(null);
  const toast = useToast();

  const load = () => {
    setLoading(true);
    api
      .get<BlogPost[]>("/api/admin/blog")
      .then(setPosts)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load posts"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm(EMPTY);
    setEditing(null);
    setCreating(true);
    setEditorTab("general");
    setErr(null);
  };
  const openEdit = (p: BlogPost) => {
    setForm({
      title: p.title,
      slug: p.slug,
      summary: p.summary,
      content: p.content,
      image: p.image,
      published: p.published,
      metaTitle: p.metaTitle ?? "",
      metaDescription: p.metaDescription ?? "",
    });
    setEditing(p);
    setCreating(true);
    setEditorTab("general");
    setErr(null);
  };
  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = async () => {
    if (!form.title.trim()) return setErr("Title is required");
    setBusy(true);
    setErr(null);
    try {
      if (editing) await api.patch(`/api/admin/blog/${editing.id}`, form);
      else await api.post("/api/admin/blog", form);
      closeForm();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = (p: BlogPost) => setDeletingPost(p);
  const confirmRemove = async () => {
    if (!deletingPost) return;
    try {
      await api.del(`/api/admin/blog/${deletingPost.id}`);
      toast.success("Post deleted.");
      setDeletingPost(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const autoSlug = (title: string) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  if (creating)
    return (
      <div className="adm-section">
        <div className="adm-sec-head">
          <div>
            <h2>{editing ? "Edit Blog Post" : "Create Blog Post"}</h2>
            <p className="muted">Create a new blog post for your storefront.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={closeForm}>
              <Icon name="close" size={14} /> Cancel
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setForm((f) => ({ ...f, published: false }));
                save();
              }}
              disabled={busy}
              type="button"
            >
              Save Draft
            </button>
            <button
              className="btn"
              onClick={() => {
                setForm((f) => ({ ...f, published: true }));
                save();
              }}
              disabled={busy}
              type="button"
            >
              {busy ? (
                <>
                  <Icon name="spinner" size={14} className="is-spinning" /> Saving…
                </>
              ) : (
                <>
                  <Icon name="check" size={14} /> {editing ? "Save" : "Publish"}
                </>
              )}
            </button>
          </div>
        </div>

        {err && <div className="pe-err">{err}</div>}

        <div className="pe-tabs" style={{ marginBottom: 0 }}>
          {(["general", "seo"] as EditorTab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`pe-tab ${editorTab === t ? "on" : ""}`}
              onClick={() => setEditorTab(t)}
            >
              {t === "general" ? "General" : "SEO"}
            </button>
          ))}
        </div>

        <div
          className="card"
          style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}
        >
          {editorTab === "general" && (
            <>
              <label className="pe-field-label">
                Title
                <input
                  className="input input-lg"
                  value={form.title}
                  onChange={(e) => {
                    setForm((f) => ({
                      ...f,
                      title: e.target.value,
                      slug: autoSlug(e.target.value),
                    }));
                  }}
                  placeholder="Blog post title"
                />
              </label>

              <label className="pe-field-label">
                URL Path <em>(optional)</em>
                <input
                  className="input"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder={autoSlug(form.title) || "blog-post-url-path"}
                />
              </label>

              <label className="pe-field-label">
                Summary
                <textarea
                  className="input"
                  rows={2}
                  value={form.summary}
                  onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                  placeholder="A short summary of the post..."
                />
              </label>

              <label className="pe-field-label">Content</label>
              <RichTextEditor
                value={form.content}
                onChange={(v) => setForm((f) => ({ ...f, content: v }))}
                placeholder="Write your blog post content here..."
                minRows={10}
              />

              <label className="pe-field-label">
                Image
                <div
                  className="gallery-picker"
                  onClick={() => {
                    const u = prompt("Image URL:");
                    if (u) setForm((f) => ({ ...f, image: u }));
                  }}
                >
                  {form.image ? (
                    <img src={form.image} alt="" style={{ maxHeight: 140, borderRadius: 8 }} />
                  ) : (
                    <>
                      <Icon name="package" size={28} />
                      <span>Tap to select an image</span>
                    </>
                  )}
                </div>
              </label>
            </>
          )}

          {editorTab === "seo" && (
            <>
              <label className="pe-field-label">
                Meta Title
                <span className="pe-field-sub">
                  Appears in search engines. If empty, post title is used.
                </span>
                <input
                  className="input"
                  value={form.metaTitle ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, metaTitle: e.target.value }))}
                  placeholder={form.title || "Meta title..."}
                />
              </label>
              <label className="pe-field-label">
                Meta Description
                <span className="pe-field-sub">
                  Appears in search engine results. If empty, summary is used.
                </span>
                <textarea
                  className="input"
                  rows={3}
                  value={form.metaDescription ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, metaDescription: e.target.value }))}
                  placeholder={form.summary || "Meta description..."}
                />
              </label>
            </>
          )}
        </div>
      </div>
    );

  return (
    <div className="adm-section">
      <div className="adm-sec-head">
        <div>
          <h2>Blog</h2>
          <p className="muted">Manage your blog posts.</p>
        </div>
        <button className="btn" onClick={openCreate}>
          <Icon name="plus" size={14} /> Create Post
        </button>
      </div>

      {loading ? (
        <div className="adm-loading">
          <Icon name="spinner" size={24} className="is-spinning" />
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="No Blog Posts"
          message="Create your first blog post to engage your customers."
          action={{ label: "Create Post", onClick: openCreate }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {posts.map((p) => (
            <div key={p.id} className="blog-row card">
              {p.image && <img src={p.image} alt={p.title} className="blog-img" />}
              <div className="blog-info">
                <strong>{p.title}</strong>
                <span className="muted" style={{ fontSize: ".82rem" }}>
                  {p.summary}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <span className={`badge ${p.published ? "badge-green" : "badge-gray"}`}>
                    {p.published ? "Published" : "Draft"}
                  </span>
                  <span className="muted" style={{ fontSize: ".78rem" }}>
                    {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>
                  <Icon name="settings" size={14} /> Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-danger-icon"
                  onClick={() => remove(p)}
                  aria-label="Delete blog post"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!deletingPost}
        onClose={() => setDeletingPost(null)}
        onConfirm={confirmRemove}
        title="Delete Blog Post"
        message={`Are you sure you want to delete "${deletingPost?.title}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />

      <style>{`
        .blog-row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
        .blog-img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
        .blog-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
      `}</style>
    </div>
  );
};
