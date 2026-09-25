/**
 * Browser end-to-end check: a scripted "human" plays a real match in headless Chromium through the actual UI —
 * keyboard movement, the E/R/Q/V/F/M hotkeys, the task panel, the meeting panel — against heuristic bots on a
 * running server. It reads the page's client store (only what the server sent this seat) to decide what to do,
 * the same information a person sees on screen.
 *
 *   pnpm build && pnpm server            # in one terminal (serves the built client on :8787)
 *   pnpm e2e -- --seed 1                 # crew seat (6 players, 1 infiltrator: red is crew on seed 1)
 *   pnpm e2e -- --seed 18                # infiltrator seat (red is the infiltrator on seed 18)
 *
 * Options: --url, --seed, --seat, --players, --infiltrators, --tasks, --max-seconds, --screens DIR, --headed.
 * CHROMIUM_PATH overrides the browser binary. Exits non-zero on page errors or if the match does not finish.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { dist, type PlayerObservation, type TaskView, type Vec2 } from "@deduction/shared";
import { findPath, getMap, type GameMap } from "@deduction/maps";
import { solveFromViews } from "@deduction/tasks";

/** The page exposes its client store for automation (see apps/client/src/App.tsx). */
declare const window: {
  __deduction?: { store: { get(): { obs: PlayerObservation | null } } };
  dispatchEvent(e: unknown): boolean;
};
declare const KeyboardEvent: new (type: string, init: { code: string; key: string }) => unknown;

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:8787/" },
    seed: { type: "string", default: "1" },
    seat: { type: "string", default: "red" },
    players: { type: "string", default: "6" },
    infiltrators: { type: "string", default: "1" },
    tasks: { type: "string", default: "2" },
    "max-seconds": { type: "string", default: "420" },
    screens: { type: "string", default: "e2e-screens" },
    headed: { type: "boolean", default: false },
  },
});

const screens = resolve(args.screens!);
mkdirSync(screens, { recursive: true });
const shots = new Set<string>();
const log = (...m: unknown[]) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s]`, ...m);
const t0 = performance.now();

const browser = await chromium.launch({
  headless: !args.headed,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
// The match can end (or a meeting can start) while the driver is mid-click; don't hang on a vanished panel.
page.setDefaultTimeout(5000);
const problems: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

// Lobby choices are read from localStorage; set them before the app loads.
await page.addInitScript((c) => localStorage.setItem("deduction.lobby.v1", JSON.stringify(c)), {
  seat: args.seat,
  players: Number(args.players),
  infiltrators: Number(args.infiltrators),
  tasksPerPlayer: Number(args.tasks),
  taskDifficulty: 2,
  botDifficulty: "normal",
  bots: "heuristic",
  seed: args.seed,
});
await page.goto(args.url!);
await page.getByRole("button", { name: "Start match" }).click();
await page.waitForSelector(".top-bar", { timeout: 15_000 });
await shot("game-start");

const map: GameMap = getMap("outpost-kappa");
const held = new Set<string>();
const counts = { tasksDone: 0, taskAttempts: 0, meetings: 0, votes: 0, kills: 0, sabotages: 0, vents: 0, reports: 0, emergencies: 0 };
let views: TaskView[] = [];
let viewsKey = "";
let answered = "";
let meetingSpoken = "";
let meetingVoted = "";
let route: Vec2[] = [];
let routeTarget: Vec2 | null = null;
let lastPos: Vec2 | null = null;
let stuck = 0;
let ventedAt = -1;
let calledEmergency = false;
let lastTrace = 0;
const seenMeetings = new Set<string>();

const deadline = t0 + Number(args["max-seconds"]) * 1000;
let obs: PlayerObservation | null = null;
while (performance.now() < deadline) {
  obs = await page.evaluate(() => window.__deduction?.store.get().obs ?? null);
  if (!obs) {
    await page.waitForTimeout(100);
    continue;
  }
  if (obs.phase === "ended") break;
  if (process.env.E2E_TRACE && performance.now() - lastTrace > 1000) {
    lastTrace = performance.now();
    log("trace", obs.phase, obs.self.pos, obs.self.activity, [...held].join("+"), "next", route[0], "target", routeTarget, "start", obs.legal.startTask);
  }
  try {
    await step(obs);
  } catch (err) {
    log("step error (continuing):", err instanceof Error ? err.message : err);
  }
  await page.waitForTimeout(60);
}

await release();
const ended = obs?.phase === "ended";
if (ended) {
  await page.waitForSelector(".end", { timeout: 5000 });
  await page.waitForTimeout(300);
  await shot("end-screen");
  const roles = await page.locator(".end .roles li").count();
  const title = await page.locator(".end h1").textContent();
  log(`match ended: ${title}; ${roles} roles revealed`);
}
log("counts", counts);
if (problems.length) log("page problems:", problems.slice(0, 10));
await browser.close();
if (!ended || problems.length > 0) {
  console.error(ended ? "FAIL: page errors" : "FAIL: match did not finish in time");
  process.exit(1);
}
log("OK");

// ---------------------------------------------------------------------------------------------------------------

async function step(o: PlayerObservation): Promise<void> {
  if (o.phase === "meeting") return meeting(o);
  if (o.activeTask) return task(o);
  const legal = o.legal;
  const me = o.self;

  if (legal.report.length > 0) {
    await release();
    await shot("body-found");
    counts.reports++;
    return press("r");
  }
  if (me.role === "infiltrator" && me.alive) {
    if (me.inVentId) {
      if (ventedAt < 0) ventedAt = performance.now();
      await release();
      await shot("in-vent");
      if (legal.ventMove.length > 0 && performance.now() - ventedAt < 1500) return press("1");
      if (legal.ventExit && performance.now() - ventedAt > 2500) {
        ventedAt = -1;
        return press("v");
      }
      return;
    }
    if (legal.kill.length > 0) {
      await release();
      counts.kills++;
      log("kill");
      return press("q");
    }
    if (legal.sabotage.includes("lights") && counts.sabotages < 2) {
      counts.sabotages++;
      await press("f");
      await shot("sabotage-menu");
      const idx = legal.sabotage.indexOf("lights");
      log("sabotage lights");
      return press(String(idx + 1));
    }
    if (legal.ventEnter && counts.vents < 2 && o.visiblePlayers.every((p) => p.ghost)) {
      await release();
      counts.vents++;
      log("vent");
      return press("v");
    }
  }
  if (me.repairingStationId) return release();
  if (legal.repair.length > 0 && me.role === "crew" && me.alive) {
    await release();
    log("repair");
    return press("e");
  }
  if (legal.startTask.length > 0) {
    await release();
    counts.taskAttempts++;
    return press("e");
  }
  const todo = o.tasks.filter((t) => !t.done);
  if (todo.length === 0 && me.alive && !calledEmergency) {
    if (legal.emergency) {
      await release();
      calledEmergency = true;
      counts.emergencies++;
      log("emergency meeting");
      return press("m");
    }
    return walkTo(me.pos, map.def.emergencyButton.pos);
  }
  const target = pickTarget(o);
  if (target) return walkTo(me.pos, target);
  return release();
}

function pickTarget(o: PlayerObservation): Vec2 | null {
  const me = o.self.pos;
  if (o.sabotage && o.self.role === "crew" && o.self.alive) {
    const open = o.sabotage.stations.filter((s) => !s.fixed).sort((a, b) => dist(me, a.pos) - dist(me, b.pos));
    if (open[0]) return open[0].pos;
  }
  if (o.self.role === "infiltrator" && o.self.alive && (o.self.killCooldownTicks ?? 1) === 0) {
    const prey = o.visiblePlayers.filter((p) => !p.ghost && !o.teammates.includes(p.id)).sort((a, b) => dist(me, a.pos) - dist(me, b.pos));
    if (prey[0]) return prey[0].pos;
  }
  const todo = o.tasks.filter((t) => !t.done).sort((a, b) => dist(me, a.pos) - dist(me, b.pos));
  return todo[0]?.pos ?? map.def.emergencyButton.pos;
}

/** Steer with WASD toward the next waypoint of a path computed from public geometry. */
async function walkTo(from: Vec2, target: Vec2): Promise<void> {
  stuck = lastPos && dist(lastPos, from) < 0.05 ? stuck + 1 : 0;
  lastPos = from;
  if (!routeTarget || dist(routeTarget, target) > 0.6 || route.length === 0 || stuck > 6) {
    route = findPath(map, from, target) ?? [];
    routeTarget = target;
    if (stuck > 6) route.unshift({ x: from.x + (Math.random() - 0.5) * 2, y: from.y + (Math.random() - 0.5) * 2 });
    stuck = 0;
  }
  while (route.length > 0 && dist(route[0]!, from) < (route.length === 1 ? 0.9 : 0.5)) route.shift();
  const next = route[0];
  if (!next) return release();
  const dx = next.x - from.x;
  const dy = next.y - from.y;
  const len = Math.hypot(dx, dy);
  const want = new Set<string>();
  if (dx > 0.38 * len) want.add("KeyD");
  if (dx < -0.38 * len) want.add("KeyA");
  if (dy > 0.38 * len) want.add("KeyS");
  if (dy < -0.38 * len) want.add("KeyW");
  for (const k of [...held]) if (!want.has(k)) await keyUp(k);
  for (const k of want) if (!held.has(k)) await keyDown(k);
}

async function task(o: PlayerObservation): Promise<void> {
  await release();
  const t = o.activeTask!;
  const key = `${t.taskId}#${t.attempt}`;
  if (key !== viewsKey) {
    viewsKey = key;
    views = [];
  }
  if (views.at(-1)?.phase !== t.view.phase) {
    views.push(t.view);
    await page.waitForSelector(".task-panel", { timeout: 3000 });
    await shot(`task-${t.kind}-${t.view.phase}`);
  }
  if (t.phase !== "answer" || o.legal.submitAnswer !== t.taskId || answered === key) return;
  answered = key;
  const answer = solveFromViews(t.kind, views);
  const format = t.view.answerFormat!;
  const panel = page.locator(".task-panel");
  log(`answering ${t.kind} with ${JSON.stringify(answer)}`);
  switch (format.type) {
    case "number":
    case "text":
      await panel.locator("form.answer input").fill(String(answer));
      await panel.locator("form.answer input").press("Enter");
      break;
    case "choice": {
      const i = format.options.findIndex((opt) => opt.id === answer);
      await press(String(i + 1));
      break;
    }
    case "multi_choice": {
      const ids = answer as string[];
      const grid = (await panel.locator(".cell-grid.pick").count()) > 0;
      for (const id of ids) {
        if (grid) await panel.getByRole("button", { name: id, exact: true }).click();
        else await panel.locator("button.option.toggle", { hasText: new RegExp(`^${escape(format.options.find((opt) => opt.id === id)!.label)} `) }).click();
      }
      await shot(`task-${t.kind}-filled`);
      await panel.getByRole("button", { name: "Submit" }).click();
      break;
    }
    case "sequence":
      for (const s of answer as string[]) await page.keyboard.press(s.length === 1 ? s : s[0]!);
      await shot(`task-${t.kind}-filled`);
      await panel.getByRole("button", { name: "Submit" }).click();
      break;
    case "ordering":
      for (const id of answer as string[]) {
        const label = format.items.find((it) => it.id === id)!.label;
        await panel.locator(".options button.option", { hasText: label }).first().click();
      }
      await shot(`task-${t.kind}-filled`);
      await panel.getByRole("button", { name: "Submit" }).click();
      break;
    case "path": {
      const path = answer as string[];
      const graph = (await panel.locator("svg.route-graph").count()) > 0;
      const start = (t.view.content as { start?: string }).start;
      for (const [i, n] of path.entries()) {
        if (i === 0 && n === start) continue;
        if (graph) await panel.locator("svg.route-graph g.node", { hasText: n }).first().click();
        else await panel.locator(".options button.option", { hasText: n }).first().click();
      }
      await shot(`task-${t.kind}-filled`);
      await panel.getByRole("button", { name: "Submit" }).click();
      break;
    }
  }
  // Wait until the task panel closes, then see whether the task is marked done.
  const result = await page.waitForFunction(
    (id) => {
      const s = window.__deduction?.store.get();
      if (!s?.obs || s.obs.activeTask?.taskId === id) return null;
      return { done: s.obs.tasks.find((x) => x.taskId === id)?.done ?? false };
    },
    t.taskId,
    { timeout: 5000 },
  );
  const ok = ((await result.jsonValue()) as { done: boolean }).done;
  if (ok) counts.tasksDone++;
  log(`task ${t.kind}: ${ok ? "done" : "failed"}`);
}

async function meeting(o: PlayerObservation): Promise<void> {
  await release();
  const m = o.meeting;
  if (!m) return;
  await page.waitForSelector(".meeting", { timeout: 3000 });
  if (!seenMeetings.has(m.meetingId)) {
    seenMeetings.add(m.meetingId);
    counts.meetings++;
  }
  await shot(`meeting-${m.phase}`);
  if (o.legal.speak && meetingSpoken !== m.meetingId && m.phase !== "reveal") {
    meetingSpoken = m.meetingId;
    const input = page.locator(".meeting form.say input");
    await input.fill(o.self.role === "crew" ? "I was doing my tasks and saw nothing odd. Who was near the body?" : "I was in the Commons the whole time. Blue, where were you?");
    await input.press("Enter");
    log("meeting: spoke");
  }
  if (o.legal.vote.includes("skip") && meetingVoted !== m.meetingId) {
    meetingVoted = m.meetingId;
    await page.locator(".meeting button.skip").click();
    await page.getByRole("button", { name: "Confirm skip" }).click();
    counts.votes++;
    log("meeting: voted skip");
  }
}

async function press(key: string): Promise<void> {
  await page.keyboard.press(key);
}

/**
 * Movement keys are dispatched as DOM keyboard events inside the page: the app's own key handlers run exactly as for
 * real key presses, but the driver doesn't wait for a rendered frame per key (slow under software WebGL).
 */
async function keyDown(code: string): Promise<void> {
  held.add(code);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keydown", { code: c, key: c.replace("Key", "").toLowerCase() })), code);
}

async function keyUp(code: string): Promise<void> {
  held.delete(code);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent("keyup", { code: c, key: c.replace("Key", "").toLowerCase() })), code);
}

async function release(): Promise<void> {
  for (const k of [...held]) await keyUp(k);
}

async function shot(name: string): Promise<void> {
  if (shots.has(name)) return;
  shots.add(name);
  await page.screenshot({ path: join(screens, `${String(shots.size).padStart(2, "0")}-${name}.png`) });
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
