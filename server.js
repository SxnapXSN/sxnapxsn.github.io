import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
const mediaStoreDir = path.join(__dirname, "data", "media");
const port = Number(process.env.PORT || 5299);
const execFileAsync = promisify(execFile);
const managerDir = "C:\\Users\\banza\\AegisHostManager";
const hostConfigPath = path.join(managerDir, "hosts.json");
const hostLogDir = path.join(managerDir, "logs");
const hostPidDir = path.join(managerDir, "pids");
const stableRoot = "D:\\T\\Aegis Stable\\TEST1";
const stableStorage = path.join(stableRoot, "storage");
const stableProcessCache = { at: 0, value: [] };
const stableStatusCache = { at: 0, value: null };
const portOwnerCache = new Map();
const discoveredHostCache = { at: 0, value: [] };
const stableProcessCacheMs = 30000;
const stableStatusCacheMs = 5000;
const portOwnerCacheMs = 15000;
const discoveredHostCacheMs = 20000;

const defaultDuckHosts = [
  {
    id: "xsn-showcase",
    name: "XSN Showcase",
    projectPath: "D:\\Us",
    command: "node server.js",
    port: 5299,
    url: "http://127.0.0.1:5299/",
    autoStart: true
  },
  {
    id: "antigravity-backend",
    name: "Antigravity Backend",
    projectPath: "C:\\Users\\banza\\antigravity\\server",
    command: "npm run start",
    port: 3000,
    url: "http://127.0.0.1:3000/api/status",
    autoStart: true
  },
  {
    id: "antigravity-ui",
    name: "Antigravity UI",
    projectPath: "C:\\Users\\banza\\antigravity",
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    port: 5173,
    url: "http://127.0.0.1:5173/?chat=1#chat",
    autoStart: true
  }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4"
};

async function ensureHostStore() {
  await mkdir(managerDir, { recursive: true });
  await mkdir(hostLogDir, { recursive: true });
  await mkdir(hostPidDir, { recursive: true });
  if (!existsSync(hostConfigPath)) {
    await writeFile(hostConfigPath, JSON.stringify({ hosts: defaultDuckHosts }, null, 2), "utf8");
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function mediaKeyToFile(key) {
  const safe = Buffer.from(String(key || ""), "utf8").toString("base64url");
  return path.join(mediaStoreDir, `${safe}.json`);
}

async function saveMediaAsset(key, url) {
  if (!key || !url) return false;
  await mkdir(mediaStoreDir, { recursive: true });
  await writeFile(mediaKeyToFile(key), JSON.stringify({ key, url, savedAt: Date.now() }), "utf8");
  return true;
}

async function loadMediaAsset(key) {
  if (!key) return null;
  try {
    return JSON.parse(await readFile(mediaKeyToFile(key), "utf8"));
  } catch {
    return null;
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function slugify(value) {
  return String(value || "host")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `host-${Date.now()}`;
}

async function loadHosts() {
  await ensureHostStore();
  try {
    const parsed = JSON.parse(await readFile(hostConfigPath, "utf8"));
    return Array.isArray(parsed.hosts) ? parsed.hosts : defaultDuckHosts;
  } catch {
    return defaultDuckHosts;
  }
}

async function saveHosts(hosts) {
  await ensureHostStore();
  await writeFile(hostConfigPath, JSON.stringify({ hosts }, null, 2), "utf8");
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fileInfo(targetPath) {
  try {
    const info = await stat(targetPath);
    return { path: targetPath, mtimeMs: info.mtimeMs, mtime: info.mtime.toISOString(), size: info.size };
  } catch {
    return null;
  }
}

async function latestMatchingFile(dir, pattern) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter(entry => entry.isFile() && pattern.test(entry.name))
        .map(async entry => fileInfo(path.join(dir, entry.name)))
    );
    return files.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null;
  } catch {
    return null;
  }
}

function tailLines(text, count = 12) {
  return String(text || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count);
}

async function findPortOwner(portNumber) {
  if (!portNumber) return null;
  const cached = portOwnerCache.get(Number(portNumber));
  const now = Date.now();
  if (cached && now - cached.at < portOwnerCacheMs) return cached.value;

  try {
    const command = [
      "$conn = Get-NetTCPConnection -LocalPort",
      Number(portNumber),
      "-State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;",
      "if($conn){",
      "$p=Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue;",
      "[pscustomobject]@{pid=$conn.OwningProcess;process=$p.ProcessName;address=$conn.LocalAddress;port=$conn.LocalPort}|ConvertTo-Json -Compress",
      "}"
    ].join(" ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], { windowsHide: true, timeout: 2200 });
    const value = stdout.trim() ? JSON.parse(stdout.trim()) : null;
    portOwnerCache.set(Number(portNumber), { at: now, value });
    return value;
  } catch {
    portOwnerCache.set(Number(portNumber), { at: now, value: null });
    return null;
  }
}

async function findStableProcesses() {
  const now = Date.now();
  if (now - stableProcessCache.at < stableProcessCacheMs) return stableProcessCache.value;

  try {
    const command = [
      "$items = Get-CimInstance Win32_Process |",
      "Where-Object { $_.CommandLine -like '*Aegis Stable*' -or $_.CommandLine -like '*TEST1*' -or $_.CommandLine -like '*aegis_core*' } |",
      "Select-Object ProcessId,Name,CommandLine;",
      "$items | ConvertTo-Json -Compress"
    ].join(" ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], { windowsHide: true });
    const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
    const processes = (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({
      pid: item.ProcessId,
      name: item.Name,
      command: String(item.CommandLine || "").slice(0, 240)
    }));
    stableProcessCache.at = now;
    stableProcessCache.value = processes;
    return processes;
  } catch {
    stableProcessCache.at = now;
    stableProcessCache.value = [];
    return stableProcessCache.value;
  }
}

function parseStableLogLine(line) {
  const match = String(line || "").match(/^\[(.*?)\]\s+\[(.*?)\]\s+\[(.*?)\]\s+(.*)$/);
  if (!match) return { raw: line };
  return {
    timestamp: match[1],
    level: match[2].trim(),
    actor: match[3].trim(),
    message: match[4].trim()
  };
}

function stableActivityLabel(activity) {
  const message = activity?.message || activity?.raw || "";
  if (/Run completed/i.test(message)) return "Run completed. Reports and fix plan are ready.";
  if (/is working/i.test(message)) return `${activity.actor} is working.`;
  if (/runtime route/i.test(message)) return message.replace(/^Task\s+/i, "Routing ");
  if (/context pack/i.test(message)) return message.replace(/^Task\s+/i, "Packing context for ");
  if (/Run accepted/i.test(message)) return "Run accepted and queued.";
  if (/Workload review loop starting/i.test(message)) return "Review loop started.";
  return message || "Stable activity updated.";
}

function stableActivityKind(activity) {
  const message = `${activity?.message || ""} ${activity?.raw || ""}`;
  if (/Run completed|completed|ready|updated|generated|prepared|mapped|produced/i.test(message)) return "done";
  if (/is working|starting|started|accepted|route|context pack|Layer \d+/i.test(message)) return "active";
  if (/WARN|risk|finding|error|failed/i.test(`${activity?.level || ""} ${message}`)) return "attention";
  return "info";
}

async function readStableRuntimeStatus() {
  const rootOk = await pathExists(stableRoot);
  if (!rootOk) {
    return {
      state: "OFFLINE",
      title: "Aegis Stable path missing",
      description: "D:\\T\\Aegis Stable\\TEST1 was not found.",
      root: stableRoot,
      activities: [],
      processes: []
    };
  }

  const processes = await findStableProcesses();
  const latestLog = await latestMatchingFile(path.join(stableStorage, "logs"), /^run-.+\.log$/i);
  const latestEvents = await latestMatchingFile(path.join(stableStorage, "logs"), /^run-.+\.events\.jsonl$/i);
  const runtimeInfo = await fileInfo(path.join(stableStorage, "runtime", "runtime_state.json"));
  const trustInfo = await fileInfo(path.join(stableStorage, "evaluation", "trust_scores.json"));
  const evalPath = path.join(stableStorage, "evaluation", "evaluation_history.json");
  const archiveIndexInfo = await fileInfo(path.join(stableStorage, "summary", "artifact_archive_index.json"));
  const now = Date.now();
  const newestMtime = Math.max(latestLog?.mtimeMs || 0, latestEvents?.mtimeMs || 0, runtimeInfo?.mtimeMs || 0);
  const freshnessSec = newestMtime ? Math.round((now - newestMtime) / 1000) : null;

  let activities = [];
  if (latestLog) {
    const lines = tailLines(await readFile(latestLog.path, "utf8"), 10);
    activities = lines.map(parseStableLogLine).map(item => {
      const label = stableActivityLabel(item);
      return { ...item, label, kind: stableActivityKind({ ...item, label }) };
    });
  }

  let latestEvaluation = null;
  try {
    const history = JSON.parse(await readFile(evalPath, "utf8"));
    latestEvaluation = Array.isArray(history) ? history[history.length - 1] : null;
  } catch {
    latestEvaluation = null;
  }

  let watchState = null;
  try {
    if (runtimeInfo && runtimeInfo.size < 1200000) {
      const runtime = JSON.parse(await readFile(path.join(stableStorage, "runtime", "runtime_state.json"), "utf8"));
      watchState = runtime.watch_state || null;
    } else {
      watchState = {
        status: "not-loaded",
        last_change_summary: "Runtime state is large; using file heartbeat to keep live status lightweight."
      };
    }
  } catch {
    watchState = null;
  }

  const lastActivity = activities[activities.length - 1];
  const runRecentlyTouched = freshnessSec !== null && freshnessSec < 120;
  const runLooksActive = runRecentlyTouched && !/Run completed/i.test(lastActivity?.message || "");
  const state = runLooksActive ? "LIVE" : processes.length ? "READY" : "IDLE";
  const runId = latestEvaluation?.run_id || path.basename(latestLog?.path || "", ".log") || null;
  const completedActions = activities
    .filter(item => item.kind === "done")
    .slice(-4)
    .map(item => ({
      actor: item.actor || item.level || "Stable",
      label: item.label,
      timestamp: item.timestamp || null
    }));
  const currentAction = runLooksActive && lastActivity
    ? {
        state: "working",
        actor: lastActivity.actor || lastActivity.level || "Stable",
        label: lastActivity.label,
        timestamp: lastActivity.timestamp || null
      }
    : lastActivity && /Run completed/i.test(lastActivity.message || "")
      ? {
          state: "done",
          actor: lastActivity.actor || "Orchestrator",
          label: "Run completed. Waiting for the next Aegis Stable task.",
          timestamp: lastActivity.timestamp || null
        }
      : {
          state: "idle",
          actor: "Aegis Stable",
          label: latestEvaluation
            ? `Idle. Last run ${latestEvaluation.run_id} completed with ${latestEvaluation.findings_total ?? 0} finding(s).`
            : "Idle. No active Stable task detected.",
          timestamp: null
        };

  return {
    state,
    title: state === "LIVE" ? "Aegis Stable is actively writing runtime artifacts." : state === "READY" ? "Aegis Stable runtime is available." : "Aegis Stable is idle.",
    description: state === "LIVE"
      ? stableActivityLabel(lastActivity)
      : latestEvaluation
        ? `Last run ${latestEvaluation.run_id} finished as ${latestEvaluation.status} with ${latestEvaluation.findings_total ?? 0} finding(s).`
        : "No recent evaluation history was found.",
    root: stableRoot,
    runId,
    mode: latestEvaluation?.mode || null,
    runHealth: latestEvaluation?.run_health || null,
    qualityScore: latestEvaluation?.quality_score ?? null,
    executionScore: latestEvaluation?.execution_score ?? null,
    findingsTotal: latestEvaluation?.findings_total ?? null,
    artifactsTotal: latestEvaluation?.artifacts_total ?? null,
    supportTier: latestEvaluation?.route_feedback?.support_tier || null,
    dominantRoute: latestEvaluation?.route_feedback?.dominant_route_mode || null,
    freshnessSec,
    currentAction,
    completedActions,
    updatedAt: new Date().toISOString(),
    watchState,
    files: {
      latestLog,
      latestEvents,
      runtime: runtimeInfo,
      trust: trustInfo,
      archiveIndex: archiveIndexInfo
    },
    processes,
    activities: activities.slice(-6)
  };
}

async function readStableRuntimeStatusCached() {
  const now = Date.now();
  if (stableStatusCache.value && now - stableStatusCache.at < stableStatusCacheMs) {
    return { ...stableStatusCache.value, cached: true, cacheAgeMs: now - stableStatusCache.at };
  }
  const value = await readStableRuntimeStatus();
  stableStatusCache.at = now;
  stableStatusCache.value = value;
  return value;
}

async function discoverListeningHosts(managedPorts = new Set()) {
  const now = Date.now();
  if (discoveredHostCache.value.length && now - discoveredHostCache.at < discoveredHostCacheMs) {
    return discoveredHostCache.value;
  }

  try {
    const command = [
      "$items = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
      "Where-Object { $_.LocalPort -in 3000,5055,5173,5180,5199,5299,11434 -or ($_.LocalPort -ge 8000 -and $_.LocalPort -le 9999) } |",
      "Sort-Object LocalPort, OwningProcess |",
      "ForEach-Object {",
      "$p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue;",
      "[pscustomobject]@{port=$_.LocalPort; address=$_.LocalAddress; pid=$_.OwningProcess; process=$p.ProcessName}",
      "};",
      "$items | ConvertTo-Json -Compress"
    ].join(" ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", command], { windowsHide: true, timeout: 2500 });
    const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const seen = new Set();
    const discovered = rows
      .filter(row => row?.port && !managedPorts.has(Number(row.port)))
      .filter(row => {
        const key = `${row.port}:${row.pid}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(row => {
        const address = row.address === "::" || row.address === "0.0.0.0" ? "127.0.0.1" : row.address;
        const isLocalUrl = address === "127.0.0.1" || address === "::1" || address === "localhost";
        return {
          id: `external-${row.pid}-${row.port}`,
          name: `${row.process || "process"}:${row.port}`,
          port: Number(row.port),
          address,
          pid: Number(row.pid),
          process: row.process || "unknown",
          url: isLocalUrl ? `http://127.0.0.1:${row.port}/` : `http://${address}:${row.port}/`,
          state: "RUNNING",
          managed: false,
          suggestion: `Aegis: detected an unmanaged listener on port ${row.port}. Add it to Duck if you want auto-start/status tracking.`
        };
      })
      .slice(0, 8);
    discoveredHostCache.at = now;
    discoveredHostCache.value = discovered;
    return discovered;
  } catch {
    return discoveredHostCache.value || [];
  }
}

async function inferHost(inputPath) {
  const projectPath = path.resolve(inputPath || "");
  const exists = await pathExists(projectPath);
  const name = path.basename(projectPath) || "Duck Host";
  const result = {
    id: slugify(name),
    name,
    projectPath,
    command: "",
    port: 0,
    url: "",
    autoStart: true,
    pathExists: exists,
    recommendation: exists ? "Path found. Aegis can infer the start command." : "Path not found. Check drive letter or folder spelling."
  };

  if (!exists) return result;

  const packagePath = path.join(projectPath, "package.json");
  const serverPath = path.join(projectPath, "server.js");
  const vitePath = path.join(projectPath, "vite.config.js");

  if (existsSync(packagePath)) {
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    const scripts = pkg.scripts || {};
    const scriptName = scripts.serve ? "serve" : scripts.host ? "host" : scripts.start ? "start" : scripts.dev ? "dev" : null;
    if (scriptName) result.command = `npm run ${scriptName}`;

    const scriptText = Object.values(scripts).join(" ");
    const portMatch = scriptText.match(/--port\s+(\d+)|PORT=(\d+)|localhost:(\d+)|127\.0\.0\.1:(\d+)/i);
    const guessedPort = portMatch ? Number(portMatch.slice(1).find(Boolean)) : 0;
    result.port = guessedPort || (name.toLowerCase().includes("antigravity") ? 5173 : 0);
  }

  if (!result.command && existsSync(serverPath)) result.command = "node server.js";
  if (!result.port && existsSync(vitePath)) {
    const viteConfig = await readFile(vitePath, "utf8");
    const portMatch = viteConfig.match(/port:\s*(\d+)/);
    if (portMatch) result.port = Number(portMatch[1]);
  }
  if (!result.port && result.command.includes("server.js")) result.port = 3000;
  if (!result.url && result.port) result.url = `http://127.0.0.1:${result.port}/`;
  if (!result.command) result.recommendation = "Path exists, but no package.json script or server.js was found. Enter a start command manually.";
  else result.recommendation = `Suggested: ${result.command}${result.port ? ` on port ${result.port}` : ""}`;
  return result;
}

async function hostStatus(host) {
  const projectOk = await pathExists(host.projectPath);
  const owner = await findPortOwner(host.port);
  const commandOk = Boolean(host.command?.trim());
  let state = "DOWN";
  if (!projectOk) state = "PATH MISSING";
  else if (!commandOk) state = "COMMAND MISSING";
  else if (owner) state = "RUNNING";

  const suggestion = !projectOk
    ? "Aegis: folder not found. Recheck the path or choose the project root."
    : !commandOk
      ? "Aegis: command is empty. Use Detect or enter npm/node command."
      : owner
        ? `Aegis: port ${host.port} is active via ${owner.process || "process"}#${owner.pid}.`
        : "Aegis: ready to start. No port conflict detected.";

  return { ...host, pathExists: projectOk, commandOk, portOwner: owner, state, suggestion };
}

async function startDuckHost(host) {
  const status = await hostStatus(host);
  if (status.state === "RUNNING") return { ok: true, message: "Already running", status };
  if (!status.pathExists) return { ok: false, message: "Path missing", status };
  if (!status.commandOk) return { ok: false, message: "Command missing", status };

  await mkdir(hostLogDir, { recursive: true });
  await mkdir(hostPidDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(hostLogDir, `${host.id}-${stamp}.log`);
  const out = await import("node:fs").then(fs => fs.openSync(logPath, "a"));
  const child = spawn("cmd.exe", ["/d", "/s", "/c", host.command], {
    cwd: host.projectPath,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, AEGIS_HOST_MANAGER: "duck-setting" }
  });
  child.unref();
  await writeFile(path.join(hostPidDir, `${host.id}.pid`), String(child.pid), "utf8");
  return { ok: true, message: `Started ${host.name}`, pid: child.pid, logPath, status: await hostStatus(host) };
}

async function stopDuckHost(host) {
  const pidPath = path.join(hostPidDir, `${host.id}.pid`);
  if (existsSync(pidPath)) {
    const pid = Number((await readFile(pidPath, "utf8")).trim());
    if (pid) {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => null);
    }
  }
  return { ok: true, message: `Stop requested for ${host.name}`, status: await hostStatus(host) };
}

async function handleDuckApi(request, response, url) {
  const hosts = await loadHosts();

  if (request.method === "GET" && url.pathname === "/api/duck/hosts") {
    const hostStatuses = await Promise.all(hosts.map(hostStatus));
    const managedPorts = new Set(hostStatuses.map(host => Number(host.port)).filter(Boolean));
    sendJson(response, 200, {
      hosts: hostStatuses,
      discoveredHosts: await discoverListeningHosts(managedPorts),
      configPath: hostConfigPath
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/duck/stable") {
    sendJson(response, 200, await readStableRuntimeStatusCached());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/duck/detect") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await inferHost(body.projectPath || body.path));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/duck/hosts") {
    const body = await readJsonBody(request);
    const host = {
      id: body.id || slugify(body.name || body.projectPath),
      name: body.name || path.basename(body.projectPath || "") || "Duck Host",
      projectPath: body.projectPath || "",
      command: body.command || "",
      port: Number(body.port || 0),
      url: body.url || (body.port ? `http://127.0.0.1:${body.port}/` : ""),
      autoStart: body.autoStart !== false
    };
    const nextHosts = hosts.filter(item => item.id !== host.id).concat(host);
    await saveHosts(nextHosts);
    sendJson(response, 200, { ok: true, host: await hostStatus(host), hosts: await Promise.all(nextHosts.map(hostStatus)) });
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/duck\/hosts\/([^/]+)\/(start|stop|delete)$/);
  if (request.method === "POST" && actionMatch) {
    const [, id, action] = actionMatch;
    const host = hosts.find(item => item.id === id);
    if (!host) {
      sendJson(response, 404, { ok: false, error: "Host not found" });
      return true;
    }
    if (action === "start") sendJson(response, 200, await startDuckHost(host));
    else if (action === "stop") sendJson(response, 200, await stopDuckHost(host));
    else {
      const nextHosts = hosts.filter(item => item.id !== id);
      await saveHosts(nextHosts);
      sendJson(response, 200, { ok: true, hosts: await Promise.all(nextHosts.map(hostStatus)) });
    }
    return true;
  }

  return false;
}

async function handleMediaApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/media") {
    const body = await readJsonBody(request);
    const ok = await saveMediaAsset(body.key, body.url);
    sendJson(response, ok ? 200 : 400, ok ? { ok: true, key: body.key } : { ok: false, error: "Missing media key or data" });
    return true;
  }

  const match = url.pathname.match(/^\/api\/media\/(.+)$/);
  if (request.method === "GET" && match) {
    const item = await loadMediaAsset(decodeURIComponent(match[1]));
    if (!item) {
      sendJson(response, 404, { ok: false, error: "Media not found" });
      return true;
    }
    sendJson(response, 200, { ok: true, key: item.key, url: item.url, savedAt: item.savedAt });
    return true;
  }

  return false;
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const candidate = raw?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
  return candidate.replace(/^::ffff:/, "");
}

function isPrivateIp(ip) {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "localhost" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

async function lookupIp(ip) {
  if (isPrivateIp(ip) || ip === "unknown") {
    return {
      ip,
      city: "Local device",
      region: "Private network",
      country: "Local",
      latitude: null,
      longitude: null,
      source: "server-local"
    };
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
    const data = await response.json();
    return {
      ip,
      city: data.city || "Unknown city",
      region: data.region || "Unknown region",
      country: data.country || "Unknown country",
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      source: "server-ipwhois"
    };
  } catch {
    return {
      ip,
      city: "Unknown city",
      region: "Unknown region",
      country: "Unknown country",
      latitude: null,
      longitude: null,
      source: "server-fallback"
    };
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.join(distDir, safePath);

  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    filePath = path.join(distDir, "index.html");
  }

  const ext = path.extname(filePath);
  const content = await readFile(filePath);
  response.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600"
  });
  response.end(content);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.url?.startsWith("/api/duck/")) {
      const handled = await handleDuckApi(request, response, url);
      if (handled) return;
    }

    if (request.url?.startsWith("/api/media")) {
      const handled = await handleMediaApi(request, response, url);
      if (handled) return;
    }

    if (request.url?.startsWith("/api/visit")) {
      const ip = getClientIp(request);
      const geo = await lookupIp(ip);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        ...geo,
        enteredAt: Date.now(),
        userAgent: request.headers["user-agent"] || "Unknown browser"
      }));
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`XSN showcase server running at http://127.0.0.1:${port}`);
});
