# Design Spec: Nexora Re-branding & Biome Integration

This document specifies the transition of the project identity to a unified "Nexora" brand and the implementation of Biome as the primary toolchain for linting and formatting.

## 1. Project Identity (Re-branding)

The project will be unified under the single name **Nexora**. This involves removing all suffixes like `-paid` or `-free` and consolidating branding across all files.

### 1.1 String Replacements
- **Pattern:** `nexora-paid` -> `nexora`
- **Pattern:** `nexora-free` -> `nexora` (mostly in documentation/comments)
- **Target Files:**
    - `package.json` (root, backend, frontend)
    - `README.md`, `CLAUDE.md`, `CONTEXT.md` (if existing)
    - `backend/src/lib/license.ts` (productId, license file search paths)
    - `backend/src/lib/version.ts` (comments/docs)
    - `frontend/src/pages/index.astro` (Page titles/SEO)
    - `.env.example` (Comments/Header)
    - `docker-compose.yml` (Image names, service labels)

### 1.2 UI & UX
- Ensure the Admin Dashboard and Storefront only display "Nexora".
- Remove references to "Free tier" or "Paid module" where it's no longer relevant to the unified identity.

## 2. Biome Integration

Biome will replace all (implied) linting and formatting needs with a Rust-powered toolchain.

### 2.1 Configuration (`/biome.json`)
A single configuration file at the root will govern the entire project.

**Global Settings:**
- `organizeImports: { "enabled": true }`
- `linter: { "enabled": true, "recommended": true }`
- `formatter: { "enabled": true, "indentStyle": "space", "lineWidth": 100, "quoteStyle": "double" }`

**Strict Rules (Safety First):**
- `noUnusedVariables`: Error (cleaner code).
- `noConsoleLog`: Error (except in `backend/src/db/seed.ts` and `backend/src/index.ts` boot sequence).
- `noExplicitAny`: Warn (encourage proper typing for financial logic).
- `noShadowRestrictedNames`: Error.
- `useConst`: Error.

**Overrides (Astro Support):**
- Apply specific rules or ignore patterns for `.astro` files to ensure stability while formatting the `<script>` sections.

### 2.2 Scripts (Root `package.json`)
- `"format": "biome format --write ."`
- `"lint": "biome lint ."`
- `"check": "biome check --write ."` (Formats, lints, and organizes imports in one go).

## 3. Success Criteria
- All occurrences of `nexora-paid` and `nexora-free` are replaced with `nexora`.
- `biome check` passes across the entire project.
- Project boots successfully via `bun run dev`.
- Admin dashboard reflects the new unified branding.
