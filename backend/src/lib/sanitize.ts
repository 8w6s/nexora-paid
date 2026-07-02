/**
 * Minimal HTML sanitizer for admin-authored rich text (product/category
 * descriptions, ticket bodies, footer HTML).
 *
 * Defense-in-depth: even though admin is trusted, a stolen admin cookie or
 * compromised admin device would otherwise turn dangerouslySetInnerHTML on
 * the storefront into a public XSS. We allow a small, deliberate set of
 * presentational tags and strip everything else — including event handlers,
 * javascript: URLs, and script/iframe/object/svg payloads.
 *
 * No external dependency. Regex-based stripper keps the surface tiny. The
 * output is rendered by trusted storefront code only.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "code",
  "pre",
  "a",
  "img",
  "hr",
  "span",
  "div",
]);

const ALLOWED_ATTRS_BY_TAG: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
};

const URL_SAFE_PROTO = new RegExp(
  "^(https?:|mailto:|/|#|data:image/(png|jpe?g|gif|webp|svg\\+xml);)",
  "i",
);

const AMP = String.fromCharCode(38);
const HASH = String.fromCharCode(35);
const ENT_AMP = AMP + "amp;";
const ENT_QUOT = AMP + HASH + "34;";
const ENT_LT = AMP + "lt;";
const ENT_GT = AMP + "gt;";

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, ENT_AMP)
    .replace(/"/g, ENT_QUOT)
    .replace(/</g, ENT_LT)
    .replace(/>/g, ENT_GT);
}

function sanitizeAttr(tag: string, name: string, value: string): string | null {
  const allowed = ALLOWED_ATTRS_BY_TAG[tag];
  const lname = name.toLowerCase();
  if (!allowed || !allowed.has(lname)) return null;
  if (lname === "href" || lname === "src") {
    if (!URL_SAFE_PROTO.test(value.trim())) return null;
  }
  if (/javascript\s*:/i.test(value)) return null;
  const escaped = escapeAttrValue(value);
  return `${lname}="${escaped}"`;
}

/**
 * Strips disallowed tags and attributes; preserves text content.
 * Empty / non-string inputs return as empty string.
 */
export function sanitizeHtml(input: unknown): string {
  if (typeof input !== "string" || !input) return "";

  const DANGEROUS = "script|style|iframe|object|embed|svg|math|template|xml";
  const dangerousFull = new RegExp(
    "<(" + DANGEROUS + ")\\b[\\s\\S]*?</\\1>",
    "gi",
  );
  const dangerousSelfClose = new RegExp(
    "<(" + DANGEROUS + ")\\b[^>]*/?>",
    "gi",
  );
  const commentRe = new RegExp("<!--[\\s\\S]*?-->", "g");
  const tagRe = new RegExp("<(/?)([a-zA-Z][a-zA-Z0-9]*)\\b([^>]*)>", "g");

  let out = input.replace(dangerousFull, "");
  out = out.replace(dangerousSelfClose, "");
  out = out.replace(commentRe, "");

  // Encode any remaining "<" that doesn't start a valid tag as <
  // Otherwise strings like "< script>text" render as literal "< script>"
  // in the description, leaking noise (and confusing tolerant parsers
  // that might later try to reconstruct a tag). tagRe below still
  // handles well-formed tags; this handles the leftover angle brackets.
  out = out.replace(new RegExp("<(?!/?[a-zA-Z])", "g"), ENT_LT);

  out = out.replace(
    tagRe,
    (_match, slash, rawTag, rawAttrs) => {
      const tag = String(rawTag).toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";

      if (slash === "/") return `</${tag}>`;

      const attrs: string[] = [];
      const attrRe =
        /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*'([^']*)'/g;
      let m: RegExpExecArray | null = attrRe.exec(rawAttrs);
      while (m) {
        const name = (m[1] ?? m[3] ?? "").toLowerCase();
        const value = m[2] ?? m[4] ?? "";
        if (name.startsWith("on")) {
          m = attrRe.exec(rawAttrs);
          continue;
        }
        const piece = sanitizeAttr(tag, name, value);
        if (piece) attrs.push(piece);
        m = attrRe.exec(rawAttrs);
      }

      if (tag === "a") {
        const hasTargetBlank = attrs.some((a) => /^target=.{1,2}_blank/i.test(a));
        const hasRel = attrs.some((a) => /^rel=/i.test(a));
        if (hasTargetBlank && !hasRel) attrs.push(`rel="noopener noreferrer nofollow"`);
      }

      return attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`;
    },
  );

  return out;
}

/**
 * Pass-through wrapper for optional fields — returns sanitized string when
 * input is a non-empty string, otherwise returns the original value so
 * PATCH semantics (omit = leave unchanged) are preserved by the caller.
 */
export function sanitizeHtmlOptional<T>(input: T): T | string {
  if (typeof input === "string") return sanitizeHtml(input);
  return input;
}