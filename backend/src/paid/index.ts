/**
 * Paid module registry.
 *
 * Each entry is a {@link PaidModule} that the boot loader will register on
 * the app — but ONLY after `verifyLicense()` returns valid. Modules listed
 * here are gated by license signature; they do not ship in Free builds.
 *
 * To add a new Paid module:
 *  1. Create `backend/src/paid/<feature>.ts` exporting `{ id, description, register }`.
 *  2. Import + push it into the array below.
 *  3. Frontend components for the same feature live under
 *     `frontend/src/components/paid/` and gate on `config.features.<id>` or
 *     a similar runtime flag.
 *
 * Free build = this file should not exist (the loader catches the missing
 * import and treats it as an empty registry). The Free clone removes this
 * directory entirely during the clone step.
 */
import type { PaidModule } from "../lib/paid-modules.ts";
import { searchModule } from "./search.ts";
import { adminBulkModule } from "./admin-bulk.ts";

export const paidModules: PaidModule[] = [
  searchModule,
  adminBulkModule,
];
