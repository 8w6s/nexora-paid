import { checkCompat } from "./compat.ts";

let _pass = 0,
  fail = 0;
function ok(_name: string, cond: boolean, _extra = "") {
  if (cond) {
    _pass++;
  } else {
    fail++;
  }
}

ok("match: caret", checkCompat("0.2.5", "^0.2.0").ok === true);
ok("match: range", checkCompat("0.2.5", ">=0.2 <0.3").ok === true);
ok("mismatch: too new", checkCompat("0.3.0", "^0.2.0").ok === false);
ok("mismatch: too old", checkCompat("0.1.9", "^0.2.0").ok === false);
ok("invalid range surfaces", checkCompat("0.2.0", "not a range").ok === false);
if (fail > 0) process.exit(1);
