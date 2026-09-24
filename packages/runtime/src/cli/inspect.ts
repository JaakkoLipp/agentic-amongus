import { parseArgs } from "node:util";
import { formatClock, PLAYER_IDENTITIES, type ControllerKind } from "@deduction/shared";
import { renderAscii } from "@deduction/maps";
import { MatchRunner } from "../matchRunner";

/**
 * Debug one headless match:  pnpm inspect-match --seed 59 [--controllers heuristic|random|mixed] [--events 40]
 * Prints the outcome, per-player end state, each agent's recent goals and the tail of the event log.
 */
const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    controllers: { type: "string", default: "heuristic" },
    players: { type: "string", default: "10" },
    infiltrators: { type: "string", default: "2" },
    events: { type: "string", default: "40" },
    map: { type: "boolean", default: false },
  },
});

const seed = Number(values.seed);
const players = Number(values.players);
const seats: Record<string, ControllerKind> = {};
PLAYER_IDENTITIES.slice(0, players).forEach((p, i) => {
  seats[p.id] = values.controllers === "mixed" ? ((i + seed) % 3 === 0 ? "random" : "heuristic") : (values.controllers as ControllerKind);
});
const runner = new MatchRunner({ settings: { seed, playerCount: players, infiltratorCount: Number(values.infiltrators) }, seats, recordEvents: true, checkInvariants: true });
const summary = await runner.runToEnd();
const state = runner.match.state;

console.log(`seed ${seed}: ${summary.winner ?? "none"} (${summary.reason ?? "unfinished"}) after ${formatClock(summary.durationTicks)}`);
console.log(`progress ${state.taskProgress.completed}/${state.taskProgress.total}, meetings ${state.meetingCount}, sabotage ${state.sabotage?.kind ?? "none"}`);
for (const p of state.players) {
  const tasks = p.taskIds.map((id) => (state.tasks[id]!.done ? "x" : ".")).join("");
  const host = runner.hosts.get(p.id);
  const goals = host?.goalHistory.slice(-3).map((g) => `${formatClock(g.tick)} ${g.goal}${g.ended ? ` [${g.ended.status}${g.ended.note ? `: ${g.ended.note}` : ""}]` : ""}`) ?? [];
  console.log(`  ${p.id.padEnd(7)} ${p.role.padEnd(11)} ${(p.alive ? "alive" : (p.deathCause ?? "dead")).padEnd(8)} ${String(p.roomId).padEnd(13)} tasks ${tasks} ${summary.controllers[p.id]}`);
  for (const g of goals) console.log(`      ${g}`);
}
if (summary.metrics.invariantViolations.length > 0) console.log("VIOLATIONS", summary.metrics.invariantViolations);
console.log("\nlast events:");
for (const e of runner.match.log.slice(-Number(values.events))) {
  const { seq: _seq, tick, type, ...rest } = e;
  console.log(`  ${formatClock(tick)} ${type} ${JSON.stringify(rest).slice(0, 160)}`);
}
if (values.map) console.log(renderAscii(runner.match.map, state.players.map((p) => ({ pos: p.pos, char: p.id[0]!.toUpperCase() }))));
