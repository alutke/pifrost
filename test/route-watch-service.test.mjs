import assert from "node:assert/strict";
import test from "node:test";
import { unitSource } from "../route-watch-service.mjs";

test("systemd unit is opt-in, credentials-free and quotes paths safely", () => {
  const unit = unitSource({
    node: "/home/pi/Node Runtime/bin/node",
    cli: "/home/pi/tools/pifrost/cli.mjs",
    path: "/home/pi/.bun/bin:/usr/local/bin:/usr/bin",
    intervalMs: 60_000,
  });
  assert.match(unit, /^# Managed by Pifrost route watcher v1/u);
  assert.match(unit, /ExecStart="\/home\/pi\/Node Runtime\/bin\/node" "\/home\/pi\/tools\/pifrost\/cli.mjs" routes watch --interval 60/u);
  assert.match(unit, /NoNewPrivileges=true/u);
  assert.match(unit, /WantedBy=default.target/u);
  assert.doesNotMatch(unit, /BIFROST_ADMIN_PASSWORD|BIFROST_MANAGEMENT_API_KEY|BIFROST_VIRTUAL_KEY|sk-bf-/u);
  assert.throws(() => unitSource({node:"/usr/bin/node",cli:"/pifrost/cli.mjs",intervalMs: 10_000}),/15 and 3600/u);
});

test("percent signs and quote characters in systemd arguments are escaped", () => {
  const unit = unitSource({
    node:"/usr/bin/node", cli:'/home/pi/has"quote/cli.mjs',
    path:"/home/pi/100%/bin", intervalMs:120_000,
  });
  assert.match(unit,/has\\"quote/u);
  assert.match(unit,/100%%/u);
  assert.match(unit,/--interval 120/u);
});
