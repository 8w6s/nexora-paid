# nexora-releases

Public source-of-truth for Nexora's update + license-revocation system.

**Read by:** `nexora-fileserver` (one image per customer fleet) at
`https://raw.githubusercontent.com/<owner>/nexora-releases/main/...`.

**Written by:** the `release.yml` workflow in `nexora-paid` on every `v*`
tag, plus you (manually) for the revocation list.

## Layout

```
versions/
  stable.json         # rewritten by CI on every release
  beta.json           # optional; only if you publish a beta channel
changelog/
  1.0.0.md            # rewritten by CI from the GitHub Release body
  1.0.1.md
revoked.json          # hand-edited; append licenseId to revoke
```

## File schemas

### `versions/stable.json`
```json
{
  "latest": "1.2.3",
  "min": "1.0.0",
  "channel": "stable",
  "imageRepo": "ghcr.io/8w6s/nexora-backend",
  "imageTag": "1.2.3",
  "sha256": "sha256:...",
  "publishedAt": "2026-06-25T10:00:00Z",
  "changelogUrl": "https://github.com/8w6s/nexora-paid/releases/tag/v1.2.3"
}
```
- `min` — oldest version still accepted by FileServer. Customers older than
  this see "blocked, please upgrade manually".
- `sha256` — digest from the GHCR push. Updater verifies before swap.

### `revoked.json`
```json
{
  "revoked": [
    "lic-2025-0042",
    "lic-2026-0007"
  ]
}
```
- Hand-edit when you need to kill a leaked license.
- FileServer caches 5 minutes; new revocations propagate within that
  window. Customer instances re-check at boot + every 24h.

### `changelog/<version>.md`
- Markdown. Surfaced in the admin's "Updates" card via
  `GET /v1/changelog/<version>`.
- Written by CI from the GitHub Release body; you can edit by hand
  afterwards if needed.

## How CI writes here

The `release.yml` workflow in `nexora-paid` clones this repo with a PAT
(`RELEASES_REPO_TOKEN` secret), rewrites `versions/stable.json` +
`changelog/<ver>.md`, then commits + pushes. The PAT needs only
`contents:write` on this repo.

## How to revoke a license manually

```bash
git clone https://github.com/<owner>/nexora-releases
cd nexora-releases
# edit revoked.json — append the licenseId
git commit -am "revoke lic-2026-0042 (leak via twitter)"
git push
```
Within 5 minutes FileServer serves the updated list; customer instances
disable paid features at their next boot or 24h refresh.