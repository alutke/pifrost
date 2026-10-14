/** Opt-in Linux systemd user service for the standalone Pifrost route watcher.
 * No credentials are embedded into unit files or command arguments.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { watchPaths, validateWatchInterval, readWatchStatus } from "./route-watch.mjs";

const UNIT = "pifrost-route-watch.service";
const MARKER = "# Managed by Pifrost route watcher v1";
function unitPath(env = process.env) {
  return join(env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"), "systemd", "user", UNIT);
}
function quote(value) {
  // systemd quoted argument escape, not a shell argument.
  return '"' + String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("\n", "") + '"';
}
function systemctl(args) {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 20_000 });
  if (result.error || result.status !== 0) {
    throw new Error("systemd --user is unavailable or rejected " + args[0] + "; inspect systemctl --user status " + UNIT);
  }
}
export function unitSource({ node = process.execPath, cli = resolve(process.argv[1]),
  path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", intervalMs } = {}) {
  const seconds = validateWatchInterval(intervalMs === undefined ? undefined : intervalMs / 1000) / 1000;
  return `${MARKER}
[Unit]
Description=Pifrost automatic Bifrost route synchronisation
Documentation=https://github.com/alutke/pifrost
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=${quote("PATH=" + path)}
ExecStart=${quote(node)} ${quote(cli)} routes watch --interval ${seconds}
Restart=on-failure
RestartSec=10
TimeoutStopSec=20
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}
export function routeWatchServiceStatus(env = process.env) {
  const path = unitPath(env);
  const installed = existsSync(path) && readFileSync(path, "utf8").startsWith(MARKER);
  const state = readWatchStatus(env);
  let active = "unknown";
  if (installed) {
    const result = spawnSync("systemctl", ["--user", "is-active", UNIT], { encoding: "utf8", timeout: 8_000 });
    active = result.status === 0 ? "active" : "inactive";
  }
  return { installed, active, unit: path, watcher: state,
    restartNotice: "Active OMP sessions may require restart after a changed routing policy." };
}
export function enableRouteWatchService({ intervalMs, env = process.env, cli = resolve(process.argv[1]),
  node = process.execPath, start = true } = {}) {
  const ms = validateWatchInterval(intervalMs === undefined ? undefined : intervalMs / 1000);
  if (!cli || !existsSync(cli)) throw new Error("Cannot resolve installed Pifrost CLI for service");
  // Fail before creating a unit if this machine has no usable user systemd.
  systemctl(["show-environment"]);
  const path = unitPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && !readFileSync(path, "utf8").startsWith(MARKER)) {
    throw new Error("Refusing to overwrite an unmanaged systemd unit at " + path);
  }
  const old = existsSync(path) ? readFileSync(path, "utf8") : null;
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, unitSource({ node, cli, path: env.PATH, intervalMs: ms }), { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
    systemctl(["daemon-reload"]);
    if (start) {
      systemctl(["enable", UNIT]);
      // enable --now doesn't restart an already-running unit. Apply changed
      // intervals and upgraded CLI paths immediately on re-enable.
      systemctl(["restart", UNIT]);
    }
    return { path, intervalSeconds: ms / 1000, started: start };
  } catch (error) {
    if (existsSync(temp)) rmSync(temp);
    if (old === null) rmSync(path, { force: true });
    else writeFileSync(path, old, { mode: 0o600 });
    try { systemctl(["daemon-reload"]); } catch {}
    throw error;
  }
}
export function disableRouteWatchService(env = process.env) {
  const path = unitPath(env);
  if (!existsSync(path)) return { removed: false };
  if (!readFileSync(path, "utf8").startsWith(MARKER)) {
    throw new Error("Refusing to remove an unmanaged systemd unit at " + path);
  }
  systemctl(["disable", "--now", UNIT]);
  rmSync(path);
  systemctl(["daemon-reload"]);
  return { removed: true };
}
