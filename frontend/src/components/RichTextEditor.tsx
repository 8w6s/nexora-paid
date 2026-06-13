import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minRows?: number;
  label?: string;
  hint?: string;
}

type Align = "left" | "center" | "right" | "justify";
type Heading = "p" | "h1" | "h2" | "h3";

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = "Start typing...",
  minRows = 5,
  label,
  hint,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const [align, setAlign] = useState<Align>("left");
  const [heading, setHeading] = useState<Heading>("p");
  const [formats, setFormats] = useState({ bold: false, italic: false, underline: false, strikeThrough: false });
  const [focused, setFocused] = useState(false);

  // Sync value → DOM only when not focused (external change)
  useEffect(() => {
    const el = editorRef.current;
    if (!el || focused) return;
    if (el.innerHTML !== value) {
      isSyncing.current = true;
      el.innerHTML = value;
      isSyncing.current = false;
    }
  }, [value, focused]);

  const exec = useCallback((cmd: string, val?: string) => {
    editorRef.current?.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(cmd, false, val ?? undefined);
    editorRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
    refreshState();
  }, []);

  const refreshState = () => {
    try {
      setFormats({
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        bold: document.queryCommandState("bold"),
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        italic: document.queryCommandState("italic"),
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        underline: document.queryCommandState("underline"),
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        strikeThrough: document.queryCommandState("strikeThrough"),
      });
    } catch {}
  };

  const handleInput = () => {
    if (isSyncing.current) return;
    const el = editorRef.current;
    if (el) onChange(el.innerHTML);
    refreshState();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      exec("insertHTML", "&nbsp;&nbsp;&nbsp;&nbsp;");
    }
  };

  const insertLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) exec("createLink", url);
  };

  const applyHeading = (h: Heading) => {
    setHeading(h);
    exec("formatBlock", h === "p" ? "p" : h.toUpperCase());
  };

  const applyAlign = (a: Align) => {
    setAlign(a);
    const cmd = { left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" }[a];
    exec(cmd);
  };

  const isEmpty = !value || value === "<br>" || value === "<div><br></div>";

  const minH = `${minRows * 1.7}rem`;

  return (
    <div className={`rte-wrap ${focused ? "focused" : ""}`}>
      {label && <div className="rte-label">{label}</div>}
      {hint && <div className="rte-hint">{hint}</div>}

      <div className="rte-toolbar">
        {/* Heading dropdown */}
        <select
          className="rte-select"
          value={heading}
          onChange={(e) => applyHeading(e.target.value as Heading)}
          title="Paragraph style"
        >
          <option value="p">Normal</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <div className="rte-divider" />

        {/* Inline formatting */}
        <button type="button" className={`rte-btn ${formats.bold ? "on" : ""}`} onClick={() => exec("bold")} title="Bold (Ctrl+B)">
          <strong>B</strong>
        </button>
        <button type="button" className={`rte-btn ${formats.italic ? "on" : ""}`} onClick={() => exec("italic")} title="Italic (Ctrl+I)">
          <em>I</em>
        </button>
        <button type="button" className={`rte-btn ${formats.underline ? "on" : ""}`} onClick={() => exec("underline")} title="Underline (Ctrl+U)">
          <u>U</u>
        </button>
        <button type="button" className={`rte-btn ${formats.strikeThrough ? "on" : ""}`} onClick={() => exec("strikeThrough")} title="Strikethrough">
          <s>S</s>
        </button>

        <div className="rte-divider" />

        {/* Lists */}
        <button type="button" className="rte-btn" onClick={() => exec("insertUnorderedList")} title="Bullet list">
          <Icon name="menu" size={13} />
        </button>
        <button type="button" className="rte-btn" onClick={() => exec("insertOrderedList")} title="Numbered list">
          <span className="rte-ol-icon">1.</span>
        </button>

        <div className="rte-divider" />

        {/* Alignment */}
        <button type="button" className={`rte-btn ${align === "left" ? "on" : ""}`} onClick={() => applyAlign("left")} title="Align left">
          <Icon name="arrow-left" size={12} />
        </button>
        <button type="button" className={`rte-btn ${align === "center" ? "on" : ""}`} onClick={() => applyAlign("center")} title="Align center">
          <span className="rte-center-icon">≡</span>
        </button>
        <button type="button" className={`rte-btn ${align === "right" ? "on" : ""}`} onClick={() => applyAlign("right")} title="Align right">
          <Icon name="arrow-right" size={12} />
        </button>

        <div className="rte-divider" />

        {/* Link & code */}
        <button type="button" className="rte-btn" onClick={insertLink} title="Insert link">
          <Icon name="copy" size={12} />
        </button>
        <button type="button" className="rte-btn" onClick={() => exec("insertHTML", "<code></code>")} title="Inline code">
          <code style={{ fontSize: "10px" }}>{"</>"}</code>
        </button>

        <div className="rte-divider" />

        {/* Undo/Redo */}
        <button type="button" className="rte-btn" onClick={() => exec("undo")} title="Undo">
          <Icon name="arrow-right" size={12} className="rte-flip" />
        </button>
        <button type="button" className="rte-btn" onClick={() => exec("redo")} title="Redo">
          <Icon name="arrow-right" size={12} />
        </button>
      </div>

      <div className="rte-editor-wrap">
        <div
          ref={editorRef}
          className="rte-editor"
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); refreshState(); }}
          onMouseUp={refreshState}
          onKeyUp={refreshState}
          style={{ minHeight: minH }}
          data-placeholder={isEmpty ? placeholder : ""}
        />
      </div>

      <style>{`
        .rte-wrap { display: flex; flex-direction: column; border: 1.5px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; background: var(--surface); transition: border-color .15s; }
        .rte-wrap.focused { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(79,70,229,.12); }
        .rte-label { font-size: .88rem; font-weight: 600; color: var(--ink); padding: 10px 14px 0; }
        .rte-hint { font-size: .78rem; color: var(--ink-soft); padding: 2px 14px 0; }
        .rte-toolbar { display: flex; align-items: center; gap: 2px; padding: 6px 10px; background: var(--surface-2); border-bottom: 1px solid var(--line); flex-wrap: wrap; min-height: 42px; }
        .rte-select { background: var(--surface); border: 1px solid var(--line-strong); border-radius: 4px; padding: 4px 8px; font-size: .82rem; color: var(--ink); font-family: var(--font-sans); outline: none; cursor: pointer; }
        .rte-divider { width: 1px; height: 18px; background: var(--line-strong); margin: 0 4px; flex-shrink: 0; }
        .rte-btn { background: none; border: none; color: var(--ink-soft); padding: 5px 9px; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: .85rem; font-family: var(--font-sans); min-width: 28px; min-height: 28px; transition: background .12s, color .12s; }
        .rte-btn:hover { background: var(--line-strong); color: var(--ink); }
        .rte-btn.on { background: var(--brand-soft); color: var(--brand); font-weight: 700; }
        .rte-flip { transform: rotate(180deg); }
        .rte-ol-icon { font-size: .78rem; font-weight: 700; font-family: var(--font-sans); }
        .rte-center-icon { font-size: 1.1rem; line-height: 1; }
        .rte-editor-wrap { position: relative; }
        .rte-editor { padding: 14px 16px; min-height: 120px; outline: none; font-family: var(--font-sans); font-size: .92rem; color: var(--ink); line-height: 1.65; background: var(--surface); }
        .rte-editor:empty:before, .rte-editor[data-placeholder]:not([data-placeholder=""]):before {
          content: attr(data-placeholder);
          color: var(--ink-faint);
          pointer-events: none;
          position: absolute;
        }
        .rte-editor h1 { font-size: 1.6rem; font-weight: 700; margin: 8px 0; }
        .rte-editor h2 { font-size: 1.3rem; font-weight: 700; margin: 8px 0; }
        .rte-editor h3 { font-size: 1.1rem; font-weight: 700; margin: 6px 0; }
        .rte-editor ul, .rte-editor ol { padding-left: 24px; margin: 6px 0; }
        .rte-editor li { margin: 3px 0; }
        .rte-editor a { color: var(--brand); text-decoration: underline; }
        .rte-editor code { background: var(--surface-2); border: 1px solid var(--line); border-radius: 3px; padding: 1px 5px; font-family: monospace; font-size: .87em; }
        .rte-editor blockquote { border-left: 3px solid var(--brand); padding: 6px 14px; color: var(--ink-soft); margin: 8px 0; background: var(--surface-2); border-radius: 0 4px 4px 0; }
      `}</style>
    </div>
  );
};
