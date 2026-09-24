/** Stable string identifiers. Kept as plain strings so they serialize cleanly for replays, the wire and LLM prompts. */
export type PlayerId = string;
/** A walkable area of the map: either a named room or a corridor. */
export type AreaId = string;
export type TaskId = string;
export type StationId = string;
export type VentId = string;
export type BodyId = string;
export type MeetingId = string;
export type MatchId = string;

/** Simulation tick counter (integer). All authoritative timing is expressed in ticks. */
export type Tick = number;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
