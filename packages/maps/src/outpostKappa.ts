import type { MapDefinition } from "./types";

/**
 * "Outpost Kappa" — the original launch map. Eleven rooms arranged in three bands around a central Commons,
 * joined by two long halls (north/south), two passages and a narrow maintenance tunnel.
 *
 *   Reactor   Security   Comms Array                 Navigation
 *   ================ North Hall ============================
 *   Engine Room ==West Passage== Commons ==East Passage== Life Support
 *   ================ South Hall ============================
 *   Electrical ~~tunnel~~ Cargo Bay     Hydroponics  Infirmary
 */
export const OUTPOST_KAPPA: MapDefinition = {
  id: "outpost-kappa",
  version: "1.0.0",
  name: "Outpost Kappa",
  width: 100,
  height: 72,
  areas: [
    { id: "reactor", name: "Reactor", kind: "room", rects: [{ x: 4, y: 4, w: 18, h: 16 }] },
    { id: "security", name: "Security", kind: "room", rects: [{ x: 28, y: 7, w: 12, h: 10 }] },
    { id: "comms", name: "Comms Array", kind: "room", rects: [{ x: 46, y: 4, w: 16, h: 12 }] },
    { id: "navigation", name: "Navigation", kind: "room", rects: [{ x: 78, y: 4, w: 18, h: 16 }] },
    { id: "engines", name: "Engine Room", kind: "room", rects: [{ x: 4, y: 26, w: 18, h: 18 }] },
    { id: "commons", name: "Commons", kind: "room", rects: [{ x: 38, y: 26, w: 24, h: 18 }] },
    { id: "life_support", name: "Life Support", kind: "room", rects: [{ x: 78, y: 26, w: 18, h: 18 }] },
    { id: "electrical", name: "Electrical", kind: "room", rects: [{ x: 4, y: 52, w: 18, h: 16 }] },
    { id: "cargo", name: "Cargo Bay", kind: "room", rects: [{ x: 36, y: 52, w: 22, h: 16 }] },
    { id: "hydroponics", name: "Hydroponics", kind: "room", rects: [{ x: 62, y: 54, w: 12, h: 12 }] },
    { id: "infirmary", name: "Infirmary", kind: "room", rects: [{ x: 78, y: 52, w: 18, h: 16 }] },
    {
      id: "north_hall",
      name: "North Hall",
      kind: "corridor",
      rects: [
        { x: 10, y: 21, w: 80, h: 3 },
        { x: 12, y: 20, w: 3, h: 1 }, // reactor door
        { x: 33, y: 17, w: 3, h: 4 }, // security door
        { x: 52, y: 16, w: 3, h: 5 }, // comms door
        { x: 85, y: 20, w: 3, h: 1 }, // navigation door
        { x: 12, y: 24, w: 3, h: 2 }, // engine room door
        { x: 48, y: 24, w: 4, h: 2 }, // commons north door
        { x: 85, y: 24, w: 3, h: 2 }, // life support door
      ],
    },
    {
      id: "south_hall",
      name: "South Hall",
      kind: "corridor",
      rects: [
        { x: 10, y: 47, w: 80, h: 3 },
        { x: 12, y: 44, w: 3, h: 3 }, // engine room south door
        { x: 48, y: 44, w: 4, h: 3 }, // commons south door
        { x: 85, y: 44, w: 3, h: 3 }, // life support south door
        { x: 12, y: 50, w: 3, h: 2 }, // electrical door
        { x: 45, y: 50, w: 4, h: 2 }, // cargo door
        { x: 66, y: 50, w: 3, h: 4 }, // hydroponics door
        { x: 85, y: 50, w: 3, h: 2 }, // infirmary door
      ],
    },
    { id: "west_passage", name: "West Passage", kind: "corridor", rects: [{ x: 22, y: 33, w: 16, h: 3 }] },
    { id: "east_passage", name: "East Passage", kind: "corridor", rects: [{ x: 62, y: 33, w: 16, h: 3 }] },
    { id: "maintenance", name: "Maintenance Tunnel", kind: "corridor", rects: [{ x: 22, y: 60, w: 14, h: 2 }] },
  ],
  obstacles: [
    { x: 11, y: 10, w: 4, h: 4 }, // reactor core
    { x: 42, y: 29, w: 4, h: 2 }, // commons tables
    { x: 54, y: 29, w: 4, h: 2 },
    { x: 42, y: 40, w: 4, h: 2 },
    { x: 54, y: 40, w: 4, h: 2 },
    { x: 41, y: 57, w: 3, h: 3 }, // cargo crates
    { x: 50, y: 61, w: 3, h: 3 },
    { x: 84, y: 8, w: 6, h: 2 }, // navigation chart table
    { x: 66, y: 58, w: 4, h: 4 }, // hydroponics planter
  ],
  taskStations: [
    { id: "reactor_pattern", roomId: "reactor", pos: { x: 6.5, y: 6.5 }, taskKind: "working_memory", label: "Core Pattern Array" },
    { id: "reactor_calibration", roomId: "reactor", pos: { x: 19.5, y: 17.5 }, taskKind: "arithmetic", label: "Power Calibration" },
    { id: "security_logs", roomId: "security", pos: { x: 30.5, y: 9.5 }, taskKind: "anomaly_detection", label: "Log Audit Terminal" },
    { id: "security_schedule", roomId: "security", pos: { x: 37.5, y: 14.5 }, taskKind: "temporal_reasoning", label: "Shift Scheduler" },
    { id: "comms_checksum", roomId: "comms", pos: { x: 48.5, y: 6.5 }, taskKind: "checksum", label: "Packet Verifier" },
    { id: "comms_relay", roomId: "comms", pos: { x: 59.5, y: 13.5 }, taskKind: "sequence_recall", label: "Relay Sequencer" },
    { id: "nav_plot", roomId: "navigation", pos: { x: 93.5, y: 8.5 }, taskKind: "route_planning", label: "Route Plotter" },
    { id: "nav_pilot", roomId: "navigation", pos: { x: 80.5, y: 17.5 }, taskKind: "spatial_reasoning", label: "Drone Pilot Console" },
    { id: "engines_procedure", roomId: "engines", pos: { x: 6.5, y: 30.5 }, taskKind: "instruction_following", label: "Coolant Procedure" },
    { id: "engines_signal", roomId: "engines", pos: { x: 19.5, y: 41.5 }, taskKind: "pattern_match", label: "Signal Matcher" },
    { id: "commons_glyphs", roomId: "commons", pos: { x: 39.5, y: 42.5 }, taskKind: "symbol_match", label: "Notice Board" },
    { id: "life_beacon", roomId: "life_support", pos: { x: 93.5, y: 30.5 }, taskKind: "rule_composition", label: "Beacon Aligner" },
    { id: "life_logic", roomId: "life_support", pos: { x: 80.5, y: 41.5 }, taskKind: "short_logic", label: "Scrubber Breakers" },
    { id: "elec_sequence", roomId: "electrical", pos: { x: 6.5, y: 54.5 }, taskKind: "sequence_recall", label: "Junction Sequencer" },
    { id: "elec_breakers", roomId: "electrical", pos: { x: 19.5, y: 65.5 }, taskKind: "short_logic", label: "Breaker Board" },
    { id: "cargo_routing", roomId: "cargo", pos: { x: 38.5, y: 54.5 }, taskKind: "classification", label: "Cargo Router" },
    { id: "cargo_stacking", roomId: "cargo", pos: { x: 55.5, y: 65.5 }, taskKind: "sorting", label: "Crate Stacker" },
    { id: "hydro_pattern", roomId: "hydroponics", pos: { x: 72.5, y: 64.5 }, taskKind: "pattern_match", label: "Growth Monitor" },
    { id: "hydro_mix", roomId: "hydroponics", pos: { x: 63.5, y: 55.5 }, taskKind: "arithmetic", label: "Nutrient Mixer" },
    { id: "infirmary_glyphs", roomId: "infirmary", pos: { x: 80.5, y: 55.5 }, taskKind: "symbol_match", label: "Sample Labeler" },
    { id: "infirmary_dose", roomId: "infirmary", pos: { x: 93.5, y: 64.5 }, taskKind: "instruction_following", label: "Dosage Calculator" },
    { id: "infirmary_memory", roomId: "infirmary", pos: { x: 93.5, y: 54.5 }, taskKind: "working_memory", label: "Scan Recall" },
  ],
  sabotageStations: [
    { id: "lights_panel", kind: "lights", roomId: "electrical", pos: { x: 12.5, y: 66.5 }, label: "Lighting Breaker" },
    { id: "reactor_left", kind: "reactor", roomId: "reactor", pos: { x: 5.5, y: 12.5 }, label: "Reactor Stabilizer (Left)" },
    { id: "reactor_right", kind: "reactor", roomId: "reactor", pos: { x: 20.5, y: 12.5 }, label: "Reactor Stabilizer (Right)" },
    { id: "oxygen_life", kind: "oxygen", roomId: "life_support", pos: { x: 87.5, y: 27.5 }, label: "Oxygen Regulator" },
    { id: "oxygen_hydro", kind: "oxygen", roomId: "hydroponics", pos: { x: 72.5, y: 55.5 }, label: "Oxygen Filter" },
    { id: "comms_dish", kind: "comms", roomId: "comms", pos: { x: 53.5, y: 4.5 }, label: "Dish Realigner" },
  ],
  vents: [
    { id: "vent_reactor", roomId: "reactor", pos: { x: 8.5, y: 17.5 }, links: ["vent_engines"] },
    { id: "vent_engines", roomId: "engines", pos: { x: 8.5, y: 38.5 }, links: ["vent_reactor", "vent_electrical"] },
    { id: "vent_electrical", roomId: "electrical", pos: { x: 8.5, y: 62.5 }, links: ["vent_engines"] },
    { id: "vent_navigation", roomId: "navigation", pos: { x: 90.5, y: 17.5 }, links: ["vent_life_support"] },
    { id: "vent_life_support", roomId: "life_support", pos: { x: 90.5, y: 38.5 }, links: ["vent_navigation", "vent_infirmary"] },
    { id: "vent_infirmary", roomId: "infirmary", pos: { x: 88.5, y: 60.5 }, links: ["vent_life_support"] },
    { id: "vent_security", roomId: "security", pos: { x: 29.5, y: 15.5 }, links: ["vent_comms"] },
    { id: "vent_comms", roomId: "comms", pos: { x: 47.5, y: 13.5 }, links: ["vent_security"] },
    { id: "vent_commons", roomId: "commons", pos: { x: 59.5, y: 27.5 }, links: ["vent_cargo"] },
    { id: "vent_cargo", roomId: "cargo", pos: { x: 56.5, y: 53.5 }, links: ["vent_commons", "vent_hydroponics"] },
    { id: "vent_hydroponics", roomId: "hydroponics", pos: { x: 63.5, y: 64.5 }, links: ["vent_cargo"] },
  ],
  emergencyButton: { roomId: "commons", pos: { x: 50, y: 35 } },
  spawn: { center: { x: 50, y: 35 }, radius: 3 },
};
