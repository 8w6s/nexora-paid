# Nexora Paid — Security & Guard Architecture

> **Đối tượng**: maintainer Nexora.
> **Mục đích**: đánh giá thiết kế "Local-Only Guard" do ChatGPT đề xuất, đối chiếu với code đã ship, chốt phased roadmap để bản Paid đạt mức "khó crack casual" mà vẫn an toàn cho dữ liệu khách + dễ support.
> **Nguyên tắc**: minh bạch > obfuscation, dữ liệu khách bất khả xâm phạm, không bao giờ self-destruct.

Document này là **bản đánh giá kiến trúc**, KHÔNG phải spec implementation. Code thực tế theo phased roadmap ở §10.

---

## 1. Threat model (đồng thuận với ChatGPT)

Khách self-host trên VPS của họ → có quyền root. Không thể chống crack tuyệt đối nếu attacker có thời gian + skill reverse-engineering.

**Mục tiêu thực tế:**
- ✅ Chống sửa nhầm (drift do dev tool, hot reload, hỗn loạn file).
- ✅ Chống patch casual (`if (paid) → if (true)` trong source/bundled JS).
- ✅ Chống "license=true" trên file local.
- ✅ Làm chi phí crack > giá license.
- ✅ Giữ data khách an toàn ngay cả khi tamper phát hiện.

**Không mục tiêu** (và đừng cố):
- ❌ Chống dump memory.
- ❌ Chống reverse-engineer binary đã ship.
- ❌ Chống user có root tự sửa code rồi tự build lại.
- ❌ Self-destruct data.

→ Phạm vi support: **chỉ image gốc + manifest verify pass**. Image đã patch = ngoài support.

---

## 2. Current state — đã ship gì rồi

Trước khi đánh giá kiến trúc mới, đây là những thứ ĐÃ trong codebase:

| Cấp | Component | Đã ship | File |
|-----|-----------|---------|------|
| Auth | argon2id password hash | ✅ | `backend/src/lib/auth.ts` |
| Auth | Per-email lockout (5/15min) + per-IP rate-limit | ✅ | `auth.ts`, `lib/rate-limit.ts` |
| Auth | TOTP 2FA + replay-resistant counter | ✅ | `auth.ts:162-181`, `lib/totp.ts` |
| Auth | Password reset: sha256(token) + atomic redeem + revoke sessions | ✅ | `routes/auth.ts:336-444` |
| Auth | Session sweep on credential rotation | ✅ | `auth.ts:revokeOtherSessions` |
| Auth | GDPR self-delete (anonymize, preserve orders) | ✅ | `auth.ts:828-894` |
| Admin | `requireAdmin` macro + role gate `.onBeforeHandle` | ✅ | `routes/admin.ts:144-176` |
| Admin | Mutation rate-limit 60/min/admin | ✅ | `admin.ts:160-173` |
| Admin | Secret-key mask trong GET /settings | ✅ | `admin.ts:60-72` |
| Admin | Audit log mọi action | ✅ | `lib/audit.ts`, `admin_actions` table |
| License | **Ed25519 offline signature verify** | ✅ | `backend/src/lib/license.ts` |
| License | Payload có `customerId`, `expiresAt`, `features[]` | ✅ | `license.ts:LicensePayload` |
| License | Pubkey embedded build-time, privkey trên dev machine only | ✅ | `LICENSE_PUBKEY_HEX` + `.keys/` |
| License | Feature gate (paid plugins) đọc `features[]` | ✅ | `paid/index.ts` |
| License | Ops runbook: issue/inspect/revoke | ✅ | `docs/LICENSE_OPS.md` |
| Boot | Admin bootstrap force flow có audit + 2FA acknowledgement | ✅ | `auth.ts:899-998` |
| Net | Docker compose có internal network | partial | `docker-compose.yml` |

→ **§17 của đề xuất (offline signed license) đã DONE từ lâu**.

→ **§§4, 7, 9, 10, 11, 12, 13, 14 chưa có gì** — đây là phần lớn của doc này.

---

## 3. Đánh giá từng phần đề xuất ChatGPT

Format: **Đề xuất → đánh giá → quyết định**.

### §4 — Architecture overview (Shop + ephemeral Guard sidecar)

**Đánh giá**: Ý tưởng tách Guard ra process riêng là tốt vì cô lập key + protocol surface. Nhưng "Shop tự sinh guard image local mỗi boot" có vấn đề:

1. **Cần Docker socket** → privilege escalation footgun (mount `/var/run/docker.sock` = container escape).
2. **Build image runtime** → +30-60s boot, dễ fail khi disk đầy.
3. **Không thực sự an toàn hơn**: attacker có root vẫn read được template + private key generation logic.
4. **Khó debug**: image build log scattered, customer-support thêm 1 layer phải đọc.

**Quyết định**: **CHỐI BỎ runtime image build**. Thay bằng 1 trong 2:

- **Option G1 (Recommended for MVP)**: Guard là **same-process module** trong Shop container, chạy worker thread riêng. Pair-lock + session token vẫn implement đầy đủ; tách process là cosmetic, không thêm bảo mật khi cùng host.
- **Option G2 (v2+)**: Guard là **pre-built sidecar image** ship cùng Paid bundle, hai container trong cùng compose. Network `internal: true`, không Docker socket.

→ Lợi: đơn giản hơn nhiều, cùng mức bảo mật casual.

### §6 — Per-customer image với metadata public

**Đánh giá**: Đúng, đã ship một phần qua license payload (`customerId`, `email`).

**Bổ sung**: Để watermark thực sự hữu ích, embed thêm vào **build artifact**:
- `build_id` (timestamp + git short SHA + customer hash)
- `customer_id` echo trong console banner mỗi boot
- `customer_id` trong response header (vd. `X-Nexora-Build`) — nhưng chỉ trên admin routes, không storefront (tránh leak)

**Quyết định**: ✅ ADOPT. Thêm `scripts/build-paid.ts` để generate build artifact với metadata embedded.

### §7 + §13 — Signed manifest + binary integrity check

**Đánh giá**: ĐÂY LÀ ƯU TIÊN SỐ 1. Chống đúng "patch nhẹ" mà threat model nhắm tới. Lợi ích cao, effort low.

**Spec**:
```json
{
  "build_id": "build_2026-06-22_abc1234_cus001",
  "customer_id": "cus_001",
  "version": "1.0.0",
  "issued_at": "2026-06-22T10:00:00Z",
  "files": {
    "backend/dist/index.js": "sha256:...",
    "backend/src/lib/license.ts": "sha256:...",
    "backend/src/lib/auth.ts": "sha256:...",
    "backend/src/routes/admin.ts": "sha256:...",
    "backend/src/paid/index.ts": "sha256:.."
  },
  "signature": "ed25519:..."
}
```

**Files KHÔNG check** (data + runtime):
- `data/`, `uploads/`, `logs/`, `tmp/`, `.env`, `*.db`, `node_modules/` (pinned by lockfile thay vì hash)

**Files PHẢI check**:
- License verifier (`license.ts`, `paid/index.ts`)
- Auth + admin gate (`auth.ts`, `routes/admin.ts`, `routes/auth.ts`)
- Payment handler (`routes/checkout.ts`, `lib/hd.ts`, `lib/payments.ts`)
- Manifest verifier chính nó (self-reference paradox: manifest hash của file `verify-manifest.ts` không include `verify-manifest.ts` — verify code chạy trước khi check)

**Verify trên boot**:
- Pass → log `[integrity] OK build_id=...`, paid features bật.
- Fail → log `[integrity] FAIL <file> hash mismatch`, vào **degraded mode** (§14).

**Quyết định**: ✅ **PRIORITY 1** — implement `scripts/build-manifest.ts` + `backend/src/lib/integrity.ts` ở v1.1.

### §9 — Pair-Locked Guard (1:1 binding)

**Đánh giá**: Đúng nhưng cách formulation của ChatGPT (Guard image riêng + pair_id phức tạp) là overkill cho threat model "chống casual crack".

**Simplification cho MVP**: Pair-lock thực hiện trong **single-process Guard module** (Option G1):
- First boot sinh `guard_runtime_priv` + `shop_runtime_priv` (Ed25519 keypair), lưu vào `data/.guard/pair.lock` (filesystem-only, không trong DB vì DB có thể swap).
- `pair.lock` chứa: shop_pub, guard_pub, customer_id từ license, image_hash từ manifest.
- Nếu `pair.lock` không tồn tại + license valid → init mới.
- Nếu `pair.lock` tồn tại + customer_id/image_hash khác → **degraded mode** (không tự ghi đè, để admin investigate).

**Quyết định**: ✅ ADOPT đơn giản hóa. Implement ở v1.2.

### §10 — Mutual authentication

**Đánh giá**: Trong Option G1 (same-process), mutual auth giữa shop và guard module **là theater** — cùng memory space, cùng OS user, cùng disk. Attacker đã có root thì có cả 2 keypair.

Mutual auth chỉ có giá trị khi Guard là **process riêng với quyền OS riêng**, vd. Linux user khác, seccomp profile, etc. Nexora MVP không có infra này.

**Quyết định**: **DEFER cho Option G2 (v2+)**. Ở v1, dùng:
- Pair-lock file (§9) làm "anchor of trust" cho 1 instance.
- HMAC-SHA256 với key sinh từ `pair.lock` cho mọi internal call shop↔guard, đủ chống tampering memory dump hoặc swap binary mà không cần keypair phức tạp.

### §11 — Secure channel (Ed25519 vs mTLS vs HMAC)

**Đánh giá**: Phụ thuộc Option G1 hay G2.

- **G1 (same-process, v1)**: Không cần "channel" — function call trong cùng process. Vẫn dùng HMAC để check stack tampering nếu attacker patch vào giữa.
- **G2 (sidecar, v2+)**: Ed25519 hợp lý hơn mTLS vì:
  - mTLS = phải có CA infra + cert rotation logic + Bun TLS plumbing.
  - Ed25519 = 64-byte signature, verify trong <1ms, zero infra.
  - Loss surface: cả 2 đều giả định Docker internal network không expose. Bằng nhau.

**Quyết định**: HMAC ở v1, Ed2519 ở v2+. Không mTLS cho đến khi có lý do cụ thể (vd. cross-host federation).

### §12 — Session token TL 4h

**Đánh giá**: 4h là sweet spot cho daily-usage admin. Nhưng:

1. Token phải bind với:
   - `image_hash` (chống swap binary mà giữ token)
   - `pair_id` (chống detach guard từ shop khác)
   - `scope` (paid/admin/delivery/plugin) — đã có trong license `features[]`

2. **Refresh window 15 phút trước expiry** là chuẩn, không có shock cho admin đang giữa flow.

3. **Khi token fail**:
   - Paid plugins (search-suggest, admin-bulk, admin-export) → tắt
   - Storefront read-only → giữ
   - Customer mua mới → **KHÔNG cho** (delivery uncertain)
   - Admin login → vẫn cho (cần để fix issue), nhưng mutation routes 503 + banner đỏ

**Quyết định**: ✅ ADOPT. Implement cùng v1.2 (Pair-Lock + Token).

### §14 — Self-reset Guard, NOT self-destruct data

**Đánh giá**: **TUYỆT ĐỐI ĐÚNG**. Đây là điểm phải gắn đậm vào CONTRIBUTING / CLAUDE.md.

**Recovery flow khi tamper detected**:
1. Xóa `data/.guard/runtime.state` (session, nonce cache, ephemeral keys)
2. Giữ nguyên: `data/shop.db`, `data/uploads/`, `data/orders/`, `data/.guard/pair.lock` (lock vẫn giữ làm forensics)
3. Set `data/.guard/tamper.flag` với JSON `{detectedAt, file, expected, actual}`
4. Storefront serve normal (read-only customer-facing)
5. `/admin` hiện banner đỏ "Integrity check failed — contact support" + link export data
6. Block paid plugins, block payment delivery
7. Audit log `integrity.fail` với toàn bộ detail

**Quyết định**: ✅ ADOPT, làm cùng §7/§13.

### §15 — SnakePath / yaw-pitch attestation

**Đánh giá**: Sáng tạo nhưng **không thêm bảo mật thực**. Lý do:

1. Crypto strength không tăng so với Ed25519 + HMAC.
2. Attacker reverse-engineer được path generation function vì nó phải nằm trong binary.
3. Tăng complexity dramatic, debug khó.
4. False-positive risk cao (floating point drift, segment_hash khác chip ARM vs x86).
5. ChatGPT đã tự note "không phải khóa chính, mà là puzzle/obfuscation phụ" — tức là **chỉ là obfuscation**, không phải security primitive.

**Quyết định**: ❌ **REJECT**. Nếu cần obfuscation phụ trong tương lai (v3+), dùng standard techniques (control-flow flattening, opaque predicates) qua tooling có sẵn, không tự design.

### §16 — Lane-Gated / Traffic Light state machine

**Đánh giá**: Cùng category với SnakePath — protocol theater.

**Phần ĐÁNG giữ**: state machine đơn giản:
```
INIT → VERIFY_INTEGRITY → VERIFY_LICENSE → PAIR_LOCK → ACTIVE
                ↓ fail              ↓ fail        ↓ fail
              DEGRADED         DEGRADED       DEGRADED
```

**Phần VỨT BỎ**: "lane", "yellow_commit", "horizontal/vertical green", "turn_id". Đây là novelty không cần thiết.

**Quyết định**: ❌ **REJECT** Lane-Gated framework. ✅ **ADOPT** simple FSM với 5 states.

### §17 — Offline license key

**Đánh giá**: Đã ship. Code hiện ở `backend/src/lib/license.ts`.

**Đề xuất nâng cấp v1.1**:
- ✅ Đã có: `customerId`, `expiresAt`, `features[]`
- ➕ Thêm vào payload: `buildId` (must match build manifest), `imageHash` (must match running binary hash)
- ➕ Verify hook: ngoài signature, check `buildId` match `manifest.build_id`. Nếu license issued cho buildA nhưng đang chạy buildB → reject.

**Quyết định**: ✅ ADOPT extension ở v1.1.

### §19 — Docker hardening

**Đánh giá**: Đúng và đơn giản. Hiện trạng `docker-compose.yml` chưa có hết.

**Action items**:
```yaml
services:
  app:
    read_only: true
    tmpfs:
      - /tmp
      - /var/cache
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE   # nếu bind 80/443
    security_opt:
      - no-new-privileges:true
    volumes:
      - nexora-data:/app/data:rw   # writable explicit
      - nexora-guard:/app/data/.guard:rw

networks:
  default:
    internal: false   # storefront public
  nexora_internal:
    internal: true    # guard module future-proof
```

**Quyết định**: ✅ ADOPT. Update `docker-compose.yml` ở v1.1.

**Status (v1.1 partial)**: `cap_drop: [ALL]` + `security_opt: ["no-new-privileges:true"]` + `tmpfs: /tmp` đã wire cho `caddy`, `backend`, `frontend`, `cloudflared`. Caddy giữ `cap_add: [NET_BIND_SERVICE]` để bind :80/:443 non-root. `read_only: true` defer sang v1.2 vì SQLite WAL/SHM cần ghi `/app/data`, Caddy cần ghi ACME state, Astro SSR cần `node_modules/.cache`. `networks.internal: true` defer cho v2 guard sidecar.

### §20 — File locations minh bạch

**Đánh giá**: Đúng. KHÔNG giấu file.

**Quyết định**: Doc hóa locations trong `docs/DEPLOYMENT.md` (đã có). Bổ sung guard paths khi implement.

---

## 4. Trả lời 12 câu hỏi ChatGPT

### Q1. Local-only Shop + Ephemeral Guard Server có khả thi?
**Khả thi** nhưng overkill cho threat model "casual crack". Khuyến nghị: same-process Guard module (G1) ở v1, sidecar (G2) ở v2+. Bỏ "ephemeral image build at runtime".

### Q2. Shop image tự sinh Guard image local mỗi boot?
**KHÔNG**. Đòi Docker socket (privilege escalation), tăng boot time, không thêm bảo mật. Pre-built sidecar HOẶC same-process là đủ.

### Q3. Xóa Guard image mỗi `docker compose down`?
**KHÔNG**. Chỉ reset `data/.guard/runtime.state`, giữ `pair.lock` cho forensics. Image stay (re-deploy không cần build lại). `down -v` cũng KHÔNG xóa `pair.lock` (volume riêng).

### Q4. Pair-Locked Guard 1:1 nên làm sao?
File-based pair lock ở `data/.guard/pair.lock`:
```json
{
  "shop_pub": "ed25519:...",
  "guard_pub": "ed25519:...",
  "customer_id": "cus_001",
  "image_hash": "sha256:...",
  "build_id": "build_...",
  "paired_at": "2026-06-22T10:00:00Z"
}
```
First boot sinh + ghi. Subsequent boot: verify pair_id match. Mismatch → degraded mode (KHÔNG auto-rotate).

### Q5. Ed25519 vs mTLS cho Docker local?
**Ed25519**. mTLS overkill cho same-host, Bun TLS plumbing thêm complexity, CA rotation là gánh nặng ops.

### Q6. Offline license Ed25519 format?
**Đã ship**. Xem `backend/src/lib/license.ts`. Format:
```
{
  "payload": {
    "email": "...",
    "productId": "nexora-paid",
    "customerId": "cus_001",
    "issuedAt": "...",
    "expiresAt": "..." | null,
    "features": [...] | null,
    "buildId": ".." | null      // <-- v1.1 extension
  },
  "signature": "ed25519-hex"
}
```

### Q7. Signed manifest check những file nào?
**Phải check** (security-critical code path):
- `backend/dist/index.js` (bundled entry, nếu có pre-built)
- `backend/src/lib/license.ts`, `auth.ts`, `integrity.ts`, `hd.ts`
- `backend/src/routes/admin.ts`, `auth.ts`, `checkout.ts`
- `backend/src/paid/index.ts` + tất cả paid plugin entries
- `frontend/dist/server/entry.mjs` (SSR bundle)
- `package.json`, `bun.lock`

**KHÔNG check** (runtime data):
- `data/`, `uploads/`, `*.db`, `.env`, `logs/`, `tmp/`, `node_modules/` (pin bằng `bun.lock` hash thay vì recursive hash)

### Q8. Recovery/degraded mode khóa feature nào?
| Feature | Khóa? | Lý do |
|---------|-------|-------|
| Storefront (read-only) | ❌ | Customer browse vẫn ok |
| Customer login | ❌ | Cần để xem orders cũ |
| Customer mua mới | ✅ | Delivery uncertain, có risk |
| Payment webhook | ✅ | LTC inflow vẫn record được, delivery hold |
| Admin login | ❌ | Cần fix issue |
| Admin mutations (POST/PUT/DELETE) | ✅ | Tránh drift thêm |
| Paid plugins (search-suggest, bulk, export) | ✅ | Là licensed surface |
| Data export | ❌ | **Phải cho phép** — customer right |
| Audit log read | ❌ | Forensics |

### Q9. Lane-Gated Attestation có đáng làm MVP?
**KHÔNG**. State machine đơn giản (INIT → VERIFY_INTEGRITY → VERIFY_LICENSE → PAIR_LOCK → ACTIVE / DEGRADED) là đủ. Lane semantics không thêm bảo mật.

### Q10. SnakePath/yaw-pitch attestation?
**KHÔNG**. Cryptographic strength không tăng so với Ed25519. False-positive risk cao (floating-point drift cross-CPU). Nếu cần obfuscation phụ ở v3+, dùng standard tools, không tự design.

### Q11. Triển khai trong Bun/Elysia + Docker không quá phức tạp?
**Có**, theo phased roadmap §10. Mỗi phase chỉ thêm 1 layer, có thể ship + rollback độc lập.

### Q12. Rủi ro UX / false positive cần tránh?
| Risk | Mitigation |
|-----------|
| Manifest hash mismatch vì line ending CRLF/LF | Build artifact normalize trước hash; doc CONTRIBUTING ghi rõ |
| Pair-lock mismatch vì volume migrate | Pre-flight script kiểm pair.lock match trước up |
| Token expire khi admin đang giữa flow | Refresh window 15 phút + silent refresh |
| Integrity fail false-positive vì Docker layer cache stale | `docker compose build --no-cache` trong release script |
| Tamper flag persist sau khi fix → user kẹt | Admin có button "Re-verify integrity" trong /admin → System → Health |
| `node_modules` recursive hash chậm (10k+ files) | Pin bằng `bun.lock` content hash, không hash từng file |

---

## 5. Risks & non-goals

**Risks if shipped poorly**:
- False-positive integrity fail trên dev machine vì hot-reload → dev mode SKIP integrity (env `NEXORA_DEV_SKIP_INTEGRITY=true`, log warn loud).
- Customer fix tay (rebuild + custom manifest) — không support, doc rõ.
- Multi-instance horizontal scale: pair-lock per-instance → cluster mode cần shared pair-lock store (Redis/DB) — defer cho v3+ enterprise tier.

**Non-goals** (đừng cố):
- Chống binary reverse-engineer (đã có root, infeasible).
- Chống memory dump.
- Chống user fork repo Community + tự gắn "paid_features = true" (đó là OSS license issue, không phải security issue).

---

## 6. So sánh với industry baselines

| Mức | Tương đương | Nexora hiện tại | Nexora v1.2 (sau roadmap) |
|-----|-------------|-----------------|-----|
| **Hobby** | SellAuth Community, ZeroBlur free | ✅ | ✅ |
| **Casual-crack-resistant** | Sketch (offline activation), JetBrains pre-2022 | ❌ | ✅ |
| **Enterprise SaaS-grade** | Stripe, Auth0, Sentry self-hosted | ❌ | partial |
| **Hardware-backed** | Knox, TPM, Secure Enclave | N/A (Docker) | N/A |

Mục tiêu **v1.2 = "casual-crack-resistant"**. Đây là sweet spot cho indie SaaS pricing $50-500/license.

---

## 7. Build & deployment per-customer

**Build pipeline cho 1 customer mới**:
```
1. scripts/issue-license.ts --email=cus@x.com --customer=cus_007 --features=...
   → outputs nexora-cus_007.license
   → signed with .keys/license-signer.private (NEVER commit)

2. scripts/build-paid.ts --customer=cus_007 --license=nexora-cus_007.license
   → embeds customer_id + build_id + license email watermark
   → generates manifest.signed.json (signed with build-signer key)
   → outputs nexora-paid-cus_007.tar.gz

3. Customer receives:
   - nexora-paid-cus_007.tar.gz (the build)
   - nexora-cus_007.license     (the license file)
   - docs/DEPLOYMENT.md         (install guide)

4. Customer runs:
   docker compose -f docker-compose.yml up -d
   (no extra activation, no internet needed)
```

**Khóa quản lý**:
- `.keys/license-signer.private` — sign license. Trên dev machine, **NEVER ship**.
- `.keys/build-signer.private` — sign manifest. Trên dev machine, **NEVER ship**.
- `LICENSE_PUBKEY_HEX` — embed in `license.ts`, ship trong binary.
- `BUILD_PUBKEY_HEX` — embed in `integrity.ts`, ship trong binary.

Có thể dùng cùng 1 key cho license + manifest (đơn giản hơn) hoặc tách (defense-in-depth nếu một bị compromise).

---

## 8. Acceptance criteria (cho từng phase)

### v1.1 — Manifest + Integrity (Sprint 1, ~3 ngày dev)
- [x] **`scripts/build-manifest.ts`** generate signed manifest. _(ship-ready iter 2-3, 62 files hashed)_
- [x] **`backend/src/lib/integrity.ts`** pure verify module + `IntegrityResult` discriminated union. _(ship-ready iter 3, e2e round-trip OK)_
- [x] **`scripts/verify-manifest.ts`** CI/dev round-trip smoke test. _(ship-ready iter 3)_
- [x] **`.gitattributes`** pin LF endings for hash stability cross-platform. _(ship-ready iter 2)_
- [x] `docs/SECURITY_ARCHITECTURE.md` cross-link. _(this doc, iter 1)_
- [x] **Banner row hiển thị integrity status** (green OK / yellow skipped / yellow dev-tolerated / red DEGRADED). _(ship-ready iter 4)_
- [x] **`backend/src/lib/integrity-state.ts`** singleton + dev-vs-prod policy + `toBannerInfo()` adapter. _(ship-ready iter 4)_
- [x] **Bot hook** `await initIntegrity()` slot after `primeOrderTokenSecret()`, runs before `app.listen()`. _(ship-ready iter 4)_
- [x] Dev mode skip via `NEXORA_DEV_SKIP_INTEGRITY=true` honored by verifier + banner row. _(ship-ready iter 4)_
- [x] Smoke test: `bun -e "import('./backend/src/lib/integrity-state.ts').then(m => m.initIntegrity())"` confirms loads + returns proper `manifest_not_found / degraded=no` in dev. _(verified iter 4)_
- [x] **Mutation gate** — block POST/PUT/PATCH/DELETE on `/api/admin/*` when `isDegraded()`. _(routes/admin.ts onBeforeHandle)_
- [x] **Paid plugin gate** — skip loading paid plugins when degraded, surface reason in `globalThis.__nexora_plugins`. _(lib/plugin/loader.ts step 1a; requires `initIntegrity()` before `loadPlugins()` — wired in `backend/src/index.ts`)_
- [x] Admin `/api/admin/system/health` endpoint exposing integrity state for UI. _(routes/admin.ts)_
- [ ] `docker-compose.yml` hardening (read_only, cap_drop, tmpfs). _(next)_
- [x] CI smoke test: tamper file → integrity fail; tamper manifest → signature_invalid; restore → OK. _(scripts/test-integrity.ts, `bun run test:integrity`)_
- [ ] Wire `test:integrity` into release pipeline alongside `verify-manifest.ts`. _(next)_

### v1.2 — Pair-Lock + Session Token (Sprint 2, ~4 ngày dev)
- [ ] First boot init `data/.guard/pair.lock`.
- [ ] Token issuance + 4h TTL + 15min refresh.
- [ ] Token bound to `image_hash`, `customer_id`, `pair_id`.
- [ ] License `buildId` field + match check.
- [ ] CI test: swap pair.lock → degraded mode.

### v2.0 — Guard sidecar (defer, only if v1.x crack rate > threshold)
- [ ] Pre-built guard image, internal network only.
- [ ] Ed25519 mutual auth.
- [ ] State machine FSM in shop side.

### v3.0 — Enterprise tier (defer)
- [ ] Cluster mode shared pair-lock store.
- [ ] HSM / KMS integration cho signing keys.
- [ ] SOC2 audit trail export.

---

## 9. Tham chiếu chéo

- `docs/LICENSE_OPS.md` — runbook issue / revoke license.
- `docs/LICENSE_ROTATION.md` — key rotation procedure.
- `docs/DEPLOYMENT.md` — customer-facing install.
- `docs/PRODUCTION.md` — production checklist.
- `docs/UPGRADE_PLAN_V2.md` — feature roadmap (orthogonal axis).
- `backend/src/lib/license.ts` — current license verifier.
- `backend/src/lib/auth.ts` — current auth gate.
- `backend/src/routes/admin.ts:144` — current admin role gate.

---

## 10. Phased roadmap

```
v1.0 (DONE)         ──→ Ed25519 license, audit log, rate-limit, TOTP, GDPR-delete
v1.1 (NEXT)         ──→ Signed manifest + integrity boot check + degraded mode
                       + Docker hardening (read_only, cap_drop)
                       + per-customer build script
v1.2                ──→ Pair-lock + 4h session token + buildId license extension
                       + admin /system/health page (re-verify, view tamper flag)
v2.0 (defer)        ──→ Guard sidecar (Option G2) + Ed25519 mutual auth
                       (only if v1.x crack rate observed > X%)
v3.0 (enterprise)   ──→ Cluster mode + HSM + SOC2 export
```

**Stop conditions** ở mỗi phase:
- v1.1 không ship được trong 1 tuần → revert, ship v1.0 thẳng.
- v1.2 không có khách hỏi → defer indefinitely.
- v2.0/v3.0 implement chỉ khi có **paying customer concrete demand**, không speculative.

---

## 11. Nguyên tắc cuối — luôn nhắc lại

1. **Minh bạch > obfuscation**. File ở `/opt/nexora`, không giấu.
2. **Data khách bất khả xâm phạm**. Tamper detected → reset Guard, KHÔNG xóa data.
3. **Recovery first**. Mọi failure path đều có "export data + contact support".
4. **No anti-feature**. Đừng cố chống user có root tự build lại — đó là quyền của họ.
5. **Crypto chuẩn, không tự design**. Ed25519 + SHA256 + HMAC. Đừng tự nghĩ thuật toán mới.

> Nếu một feature an toàn vi phạm 1 trong 5 nguyên tắc trên → REJECT.

---

*Last updated*: iteration 1 of `/loop 20m` security review.
*Next review*: sau khi v1.1 manifest implementation hoàn tất.