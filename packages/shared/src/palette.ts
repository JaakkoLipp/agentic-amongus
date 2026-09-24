import type { PlayerId } from "./ids";

export interface PlayerIdentity {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
}

/** Players are identified by color names: short, unambiguous in speech, and easy for LLMs to reference. */
export const PLAYER_IDENTITIES: readonly PlayerIdentity[] = [
  { id: "red", name: "Red", color: "#e5484d" },
  { id: "blue", name: "Blue", color: "#3e63dd" },
  { id: "green", name: "Green", color: "#30a46c" },
  { id: "yellow", name: "Yellow", color: "#f5d90a" },
  { id: "orange", name: "Orange", color: "#f76b15" },
  { id: "purple", name: "Purple", color: "#8e4ec6" },
  { id: "white", name: "White", color: "#eceef0" },
  { id: "black", name: "Black", color: "#3a3f45" },
  { id: "pink", name: "Pink", color: "#e93d82" },
  { id: "cyan", name: "Cyan", color: "#05a2c2" },
  { id: "brown", name: "Brown", color: "#a07553" },
  { id: "lime", name: "Lime", color: "#99d52a" },
];

export const MAX_PLAYERS = PLAYER_IDENTITIES.length;
