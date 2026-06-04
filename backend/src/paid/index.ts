import type { Plugin } from "../lib/plugin/types.ts";
import { searchPlugin } from "./search.ts";
import { adminBulkPlugin } from "./admin-bulk.ts";
import { adminExportPlugin } from "./admin-export.ts";
import { adminCustomersCsvPlugin } from "./admin-customers-csv.ts";

export const paidModules: Plugin[] = [
  searchPlugin,
  adminBulkPlugin,
  adminExportPlugin,
  adminCustomersCsvPlugin,
];
