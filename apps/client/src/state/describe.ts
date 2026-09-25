import type { ActionRejectReason, AreaId, PerceivedEvent, PlayerActionType, PlayerId, PlayerObservation, SabotageKind, WinReason } from "@deduction/shared";
import { areaName, type GameMap } from "@deduction/maps";
import type { LogTone } from "./store";

export interface Describer {
  readonly selfId: PlayerId;
  readonly map: GameMap;
  readonly obs: PlayerObservation | null;
}

export const nameOf = (ctx: { obs: PlayerObservation | null; selfId?: PlayerId }, id: PlayerId): string =>
  id === ctx.selfId ? "you" : (ctx.obs?.roster.find((r) => r.id === id)?.name ?? id);

export const SABOTAGE_LABEL: Record<SabotageKind, string> = {
  lights: "Lights out",
  comms: "Comms down",
  oxygen: "Oxygen depletion",
  reactor: "Reactor meltdown",
};

export const WIN_REASON_TEXT: Record<WinReason, string> = {
  all_infiltrators_ejected: "Every infiltrator was eliminated.",
  tasks_completed: "The crew completed every task.",
  infiltrator_parity: "The infiltrators reached parity with the crew.",
  critical_sabotage: "A critical sabotage ran out.",
  time_limit: "The match hit its time limit.",
};

function where(map: GameMap, roomId: AreaId | null): string {
  return roomId ? ` in ${areaName(map, roomId)}` : "";
}

/** Human-readable log line for a perceived event, or null for the noisy ones (visibility diffs, room changes). */
export function describeEvent(ctx: Describer, e: PerceivedEvent): { text: string; tone: LogTone; toast?: boolean } | null {
  const n = (id: PlayerId) => nameOf({ obs: ctx.obs, selfId: ctx.selfId }, id);
  const N = (id: PlayerId) => capitalize(n(id));
  switch (e.type) {
    case "SAW_KILL":
      return { text: `You saw ${n(e.killerId)} kill ${n(e.victimId)}${where(ctx.map, e.roomId)}!`, tone: "alert", toast: true };
    case "SAW_BODY":
      return { text: `You found ${n(e.victimId)}'s body${where(ctx.map, e.roomId)}.`, tone: "alert", toast: true };
    case "SAW_VENT":
      return { text: `You saw ${n(e.playerId)} ${e.action === "enter" ? "jump into" : "climb out of"} a vent${where(ctx.map, e.roomId)}!`, tone: "alert", toast: true };
    case "HEARD_SPEECH":
      return { text: `${N(e.speakerId)}: “${e.text}”`, tone: "speech" };
    case "OWN_TASK_RESULT":
      if (e.result === "completed") return { text: "Task complete.", tone: "good", toast: true };
      if (e.result === "timeout") return { text: "Task timed out. Try again.", tone: "bad", toast: true };
      return { text: "Wrong answer. The task restarts from the beginning.", tone: "bad", toast: true };
    case "OWN_VENT_MOVE":
      return { text: `You crawled to the ${ventRoom(ctx.map, e.toVentId)} vent.`, tone: "info" };
    case "WAS_KILLED":
      return { text: `${N(e.killerId)} killed you. You are now a ghost: finish your tasks.`, tone: "alert", toast: true };
    case "SABOTAGE_STARTED":
      return { text: `${SABOTAGE_LABEL[e.kind]}!${e.deadlineTick !== null ? " Fix it before the timer runs out." : ""}`, tone: "alert", toast: true };
    case "SABOTAGE_FIXED":
      return { text: `${SABOTAGE_LABEL[e.kind]} fixed.`, tone: "good", toast: true };
    case "BODY_REPORTED":
      return { text: `${N(e.reporterId)} reported ${n(e.victimId)}'s body${where(ctx.map, e.roomId)}.`, tone: "alert" };
    case "EMERGENCY_CALLED":
      return { text: `${N(e.callerId)} called an emergency meeting.`, tone: "alert" };
    case "MEETING_STARTED": {
      const dead = e.deadSinceLastMeeting.map(n);
      return { text: `Meeting.${dead.length ? ` Dead since the last meeting: ${dead.join(", ")}.` : " Nobody died."}`, tone: "info" };
    }
    case "MEETING_MESSAGE":
      return null; // shown in the meeting transcript
    case "VOTES_REVEALED":
      return null;
    case "PLAYER_EJECTED":
      return {
        text: `${N(e.playerId)} ${e.playerId === ctx.selfId ? "were" : "was"} ejected.${e.role ? ` ${e.playerId === ctx.selfId ? "You were" : "They were"} ${e.role === "infiltrator" ? "an infiltrator" : "crew"}.` : ""}`,
        tone: "info",
        toast: true,
      };
    case "MATCH_ENDED":
      return { text: `${e.winner === "crew" ? "Crew" : "Infiltrators"} win. ${WIN_REASON_TEXT[e.reason]}`, tone: "info" };
    default:
      return null;
  }
}

function ventRoom(map: GameMap, ventId: string): string {
  const v = map.ventById.get(ventId);
  return v ? areaName(map, v.roomId) : ventId;
}

const REJECT_TEXT: Record<ActionRejectReason, string> = {
  not_playing: "Not now.",
  dead: "Ghosts can't do that.",
  wrong_role: "Your role can't do that.",
  out_of_range: "Too far away.",
  no_line_of_sight: "You can't see it from here.",
  cooldown: "Not ready yet (cooldown).",
  invalid_target: "Nothing to do that on.",
  busy: "You're busy.",
  in_vent: "Not while in a vent.",
  not_in_vent: "You're not in a vent.",
  unknown_task: "That isn't one of your tasks.",
  task_done: "Task already done.",
  wrong_phase: "Not in this phase.",
  already_reported: "Already reported.",
  no_meetings_left: "You have no emergency meetings left.",
  sabotage_active: "Not during a critical sabotage.",
  already_voted: "You already voted.",
  malformed: "That answer doesn't fit the format.",
  rate_limited: "Slow down.",
};

export function describeRejection(action: PlayerActionType, reason: ActionRejectReason): string {
  return `${actionLabel(action)}: ${REJECT_TEXT[reason]}`;
}

function actionLabel(a: PlayerActionType): string {
  return capitalize(a.toLowerCase().replaceAll("_", " "));
}

export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
