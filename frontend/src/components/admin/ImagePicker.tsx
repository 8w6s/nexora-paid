/**
 * Drag-and-drop / click-to-upload image picker for admin panels.
 *
 * - Click anywhere on the dropzone OR drag a file onto it to upload.
 * - POSTs multipart/form-data to /api/admin/upload-image, which stores the
 *   file on the data volume and returns a /uploads/<sha256>.<ext> URL.
 * - Caller wires `value` + `onChange` (the URL string).
 */
import type React from "react";
import { useRef, useState } from "react";
import { Icon } from "../Icon";
import { API_ORIGIN } from "../../lib/api";

export const ImagePicker: React.FC<{
  value: string;
  onChange: (url: string) => void;
  label?: string;
  className?: string;
  /** Accept additional formats. Defaults match the backend allow-list. */
  accept?: string;
}> = ({ value, onChange, label, className, accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml" }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API_ORIGIN}/api/admin/upload-image`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `upload failed (${r.status})`);
      }
      const j = (await r.json()) as { url: string };
      onChange(j.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void upload(f);
    e.target.value = ""; // allow re-picking the same file
  }

  function onDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void upload(f);
  }

  return (
    <div className={`img-picker ${className ?? ""}`}>
      <button
        type="button"
        className={`zone ${drag ? "drag" : ""} ${value ? "has" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        aria-label={label ?? "Upload image"}
      >
        {value ? (
          <img src={value} alt="Preview" />
        ) : (
          <>
            <Icon name="package" size={32} />
            <span>{busy ? "Uploading…" : label ?? "Click or drop an image"}</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onPick}
        style={{ display: "none" }}
        disabled={busy}
      />
      <input
        type="text"
        className="url-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or paste image URL"
      />
      {err && <div className="err">{err}</div>}
      {value && (
        <button
          type="button"
          className="clear"
          onClick={() => onChange("")}
          aria-label="Remove image"
        >
          Remove
        </button>
      )}
      <style>{`
        .img-picker { display: flex; flex-direction: column; gap: 8px; }
        .zone { border: 2px dashed var(--border, #ddd); border-radius: 12px; padding: 16px; min-height: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: var(--surface-2, #fafafa); cursor: pointer; color: var(--ink-muted, #666); font-size: .9rem; text-align: center; }
        .zone:hover { border-color: var(--brand, #4f46e5); color: var(--ink); }
        .zone.drag { border-color: var(--brand, #4f46e5); background: rgba(99, 102, 241, .08); }
        .zone.has { padding: 0; overflow: hidden; }
        .zone img { width: 100%; max-height: 280px; object-fit: contain; display: block; }
        .url-input { width: 100%; padding: 8px 12px; border: 1px solid var(--border, #ddd); border-radius: 8px; font-size: .85rem; background: var(--surface, #fff); color: var(--ink); }
        .clear { align-self: flex-start; font-size: .75rem; background: none; border: none; color: var(--ink-muted, #888); cursor: pointer; text-decoration: underline; }
        .err { color: #dc2626; font-size: .8rem; }
      `}</style>
    </div>
  );
};