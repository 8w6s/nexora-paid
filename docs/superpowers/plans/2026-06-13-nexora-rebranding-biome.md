# Nexora Re-branding & Biome Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the project identity under the name "Nexora" and establish Biome as the fast, strict toolchain for linting and formatting.

**Architecture:** Root-level Biome configuration for project-wide consistency. Surgical string replacement for re-branding.

**Tech Stack:** Biome, Bun, Astro, React.

---

### Task 1: Initialize Biome

**Files:**
- Create: `biome.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Install Biome at root**

Run: `bun add --dev --save-exact @biomejs/biome`

- [ ] **Step 2: Create root `biome.json` configuration**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error"
      },
      "suspicious": {
        "noConsoleLog": "error",
        "noExplicitAny": "warn"
      },
      "style": {
        "noShadowRestrictedNames": "error",
        "useConst": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "formatWithErrors": false,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "quoteStyle": "double"
  },
  "overrides": [
    {
      "include": ["backend/src/db/seed.ts", "backend/src/index.ts"],
      "linter": {
        "rules": {
          "suspicious": {
            "noConsoleLog": "off"
          }
        }
      }
    },
    {
      "include": ["*.astro"],
      "linter": {
        "rules": {
          "correctness": {
            "noUnusedVariables": "off"
          }
        }
      }
    }
  ]
}
```

- [ ] **Step 3: Add Biome scripts to root `package.json`**

Modify: `package.json`
```json
"scripts": {
  ...
  "format": "biome format --write .",
  "lint": "biome lint .",
  "check": "biome check --write ."
}
```

- [ ] **Step 4: Verify Biome installation**

Run: `bun run lint` (Expected: List of lint warnings/errors)

- [ ] **Step 5: Commit**

```bash
git add package.json biome.json bun.lock
git commit -m "chore: initialize biome toolchain"
```

---

### Task 2: Core Re-branding (Nexora)

**Files:**
- Modify: `package.json` (root, backend, frontend)
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update package names**

Replace `"name": "nexora-paid"` with `"name": "nexora"` in all `package.json` files.

- [ ] **Step 2: Update README and Docs**

Global search and replace `nexora-paid` -> `nexora` and `nexora-free` -> `nexora` in `README.md` and `.env.example`.

- [ ] **Step 3: Update Docker configuration**

Replace any `nexora-paid` image tags or service names in `docker-compose.yml` with `nexora`.

- [ ] **Step 4: Commit**

```bash
git add package.json backend/package.json frontend/package.json README.md .env.example docker-compose.yml
git commit -m "feat: unify project name to nexora"
```

---

### Task 3: Backend Logic Re-branding

**Files:**
- Modify: `backend/src/lib/license.ts`
- Modify: `backend/src/lib/version.ts`
- Modify: `backend/src/db/seed.ts`

- [ ] **Step 1: Update ProductID in license logic**

File: `backend/src/lib/license.ts`
Replace: `productId === "nexora-paid"` with `productId === "nexora"`.
Update license file search paths if they use the old name.

- [ ] **Step 2: Update store name in Seed**

File: `backend/src/db/seed.ts`
Ensure `store_name` and `email_from` reflect "Nexora".

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/license.ts backend/src/lib/version.ts backend/src/db/seed.ts
git commit -m "feat(backend): update internal product identifiers to nexora"
```

---

### Task 4: Frontend UI Re-branding

**Files:**
- Modify: `frontend/src/pages/index.astro`

- [ ] **Step 1: Update Page Titles and Metadata**

File: `frontend/src/pages/index.astro`
Replace "Nexora — Digital goods" strings if they contain any old branding.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/index.astro
git commit -m "feat(frontend): update storefront branding"
```

---

### Task 5: Final Check and Cleanup

- [ ] **Step 1: Run full project check**

Run: `bun run check`
Fix any remaining lint/format issues detected by Biome.

- [ ] **Step 2: Verify project boots**

Run: `bun run dev`
Check logs for any "Nexora" branding and ensure no errors.

- [ ] **Step 3: Final Commit**

```bash
git commit -am "chore: final biome check and cleanup"
```
