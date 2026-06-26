# SQLite → PostgreSQL Migration Guide

> ⚠️ **EXPERIMENTAL / DEVELOPER-ONLY.**
> PostgreSQL is **not** a supported production target for Nexora as of v1.x.
> The runtime ships with SQLite-only `connection.ts` and `sqliteTable` schemas;
> the steps below require editing source files, regenerating migrations, and
> running an offline data copy. There is **no compose profile**, no
> runtime `DATABASE_URL` switch, and no automated rollback. Customers on a
> supported plan should stay on SQLite — it comfortably handles single-shop
> workloads up to ~500 concurrent customers on a 2-vCPU/4 GB VPS. Use this
> guide only if you are forking Nexora and willing to own the maintenance
> tax of a custom Postgres build going forward.

Nexora ships with SQLite for simplicity (single file, zero config). The
sections below describe what a PostgreSQL fork would look like; nothing in
this document is exercised by the test suite or release smoke.

---

## Why Migrate?

| Metric | SQLite | PostgreSQL |
|--------|--------|------------|
| Concurrent writes | 1 at a time | Unlimited |
| Max DB size | ~281 TB (theoretical) | Unlimited |
| Full-text search | Basic FTS5 | Advanced (trigrams, ranking) |
| Replication | None | Streaming, logical |
| JSON queries | Limited | Full JSONB support |
| Extensions | Limited | Rich ecosystem (pg_trgm, PostGIS) |

**When to migrate**:
- More than 500-1000 concurrent users
- Need multi-server deployment
- Require point-in-time recovery
- Want to use PostgreSQL-specific features

---

## Prerequisites

1. **PostgreSQL 14+** installed (15+ recommended for performance)
2. **pgloader** (optional, for data migration) or manual SQL export/import
3. Update Drizzle ORM driver

---

## Step 1: Install PostgreSQL Driver

```bash
cd backend
bun remove bun:sqlite
bun add postgres
bun add -D @types/pg
```

---

## Step 2: Update Environment Variables

Add to `backend/.env`:

```env
# PostgreSQL connection (REQUIRED)
DATABASE_URL=postgresql://user:password@localhost:5432/nexora

# Or separate params:
PGHOST=localhost
PGPORT=5432
PGUSER=nexora
PGPASSWORD=your_secure_password
PGDATABASE=nexora

# SSL mode (production)
PGSSLMODE=require
```

---

## Step 3: Update Drizzle Config

Create `backend/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## Step 4: Update Connection Code

Replace `backend/src/db/connection.ts`:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const connectionString = process.env.DATABASE_URL!;

// For migrations: { max: 1 }
// For query-heavy: { max: 10 }
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });
```

---

## Step 5: Schema Changes

Some SQLite-specific features need adjustment:

### 1. Remove `sqliteTable` → use `pgTable`

```typescript
// Before (SQLite)
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
export const users = sqliteTable("users", { ... });

// After (PostgreSQL)
import { pgTable, integer, text } from "drizzle-orm/pg-core";
export const users = pgTable("users", { ... });
```

### 2. Replace `sql\`(unixepoch() * 1000)\``

PostgreSQL uses `EXTRACT(EPOCH FROM NOW()) * 1000`:

```typescript
// Before
createdAt: integer("created_at").default(sql`(unixepoch() * 1000)`)

// After
createdAt: integer("created_at").default(sql`EXTRACT(EPOCH FROM NOW()) * 1000`)
```

### 3. Custom types

Update `encryptedText` for PostgreSQL:

```typescript
import { customType } from "drizzle-orm/pg-core";

const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: string): string {
    return encrypt(value);
  },
  fromDriver(value: string): string {
    return decrypt(value);
  },
});
```

---

## Step 6: Migrate Data

### Option A: pgloader (Recommended)

```bash
# Install pgloader
brew install pgloader  # macOS
sudo apt install pgloader  # Ubuntu/Debian

# Run migration
pgloader ./sqlite.db postgresql://user:pass@localhost:5432/nexora
```

### Option B: Manual Export/Import

```bash
# 1. Export SQLite to SQL
sqlite3 sqlite.db .dump > dump.sql

# 2. Convert SQLite syntax to PostgreSQL
sed -i 's/AUTOINCREMENT/SERIAL/g' dump.sql
sed -i 's/unixepoch()/EXTRACT(EPOCH FROM NOW())/g' dump.sql

# 3. Import to PostgreSQL
psql -d nexora -f dump.sql
```

### Option C: Drizzle Introspect + Push

```bash
# Generate PostgreSQL schema from existing SQLite
bunx drizzle-kit introspect
bunx drizzle-kit push
```

---

## Step 7: Run Migrations

```bash
cd backend
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

---

## Performance Tuning

After migration, tune PostgreSQL for your workload:

```sql
-- postgresql.conf (adjust based on your server)
shared_buffers = 256MB
effective_cache_size = 768MB
maintenance_work_mem = 64MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 2621kB
min_wal_size = 1GB
max_wal_size = 4GB
```

### Indexes for Common Queries

```sql
-- Orders by status (already in schema, verify)
CREATE INDEX idx_orders_status ON orders(status);

-- Product keys by product + status
CREATE INDEX idx_product_keys_product_status ON product_keys(product_id, status);

-- Full-text search on products (PostgreSQL feature)
CREATE INDEX idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
-- Requires: CREATE EXTENSION pg_trgm;
```

---

## Monitoring & Maintenance

### Health Check Query

```sql
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

### Backup Strategy

```bash
# Daily full backup
pg_dump -Fc nexora > backup_$(date +%Y%m%d).dump

# Point-in-time recovery (requires WAL archiving)
# postgresql.conf:
archive_mode = on
archive_command = 'cp %p /backup/wal/%f'
```

---

## Rollback Plan

If migration fails:

1. **Keep SQLite file** as backup (`sqlite.db.bak`)
2. **Revert code changes**:
   ```bash
   git revert HEAD~N  # N = commits made for migration
   ```
3. **Switch back to SQLite driver**:
   ```bash
   bun remove postgres
   bun add bun:sqlite
   ```
4. **Restart backend**

---

## Checklist

- [ ] PostgreSQL server running and accessible
- [ ] `DATABASE_URL` environment variable set
- [ ] Schema updated to `pgTable` syntax
- [ ] Data migrated (pgloader or manual)
- [ ] Migrations run successfully
- [ ] Application starts without errors
- [ ] Performance benchmarks pass
- [ ] Backup strategy in place

---

## Estimated Timeline

| Task | Duration |
|------|----------|
| Install & config PostgreSQL | 30 min |
| Update schema & code | 1-2 hours |
| Migrate data | 1-4 hours (depends on size) |
| Test & verify | 1-2 hours |
| **Total** | **4-8 hours** |

---

## Support

For issues:
1. Check PostgreSQL logs: `tail -f /var/log/postgresql/*.log`
2. Verify connection: `psql -d nexora -c "SELECT 1"`
3. Check Drizzle docs: https://orm.drizzle.team/docs/get-started-postgresql
