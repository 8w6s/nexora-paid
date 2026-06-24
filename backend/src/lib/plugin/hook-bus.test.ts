import { HookBus } from "./hook-bus.ts";

let _pass = 0,
  fail = 0;
function ok(_name: string, cond: boolean, _extra = "") {
  if (cond) {
    _pass++;
  } else {
    fail++;
  }
}

const bus = new HookBus();
const log: string[] = [];

bus.subscribe("plug-a", "order.created", async (p) => {
  log.push(`a:${p.orderId}`);
});
bus.subscribe("plug-b", "order.created", async (_p) => {
  throw new Error("boom");
});
bus.subscribe("plug-c", "order.created", async (p) => {
  log.push(`c:${p.orderId}`);
});

await bus.emit("order.created", { orderId: "O1", userId: "U1" });

ok("a runs", log.includes("a:O1"));
ok("c runs after b throws", log.includes("c:O1"));
ok("ordered", log[0] === "a:O1" && log[1] === "c:O1");
if (fail > 0) process.exit(1);
