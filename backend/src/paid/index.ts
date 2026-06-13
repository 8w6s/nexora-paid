import type { Plugin } from "../lib/plugin/types.ts";
import { adminBulkPlugin } from "./admin-bulk.ts";
import { adminCustomersCsvPlugin } from "./admin-customers-csv.ts";
import { adminExportPlugin } from "./admin-export.ts";
import { searchPlugin } from "./search.ts";

export const paidModules: Plugin[] = [
  searchPlugin,
  adminBulkPlugin,
  adminExportPlugin,
  adminCustomersCsvPlugin,
];
