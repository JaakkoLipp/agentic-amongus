import { getMap, renderAscii } from "../index";

const id = process.argv[2] ?? "outpost-kappa";
const map = getMap(id);
console.log(`${map.def.name} (${map.id} v${map.version}) ${map.width}x${map.height}`);
console.log(renderAscii(map));
console.log("\nRoom graph:");
for (const [area, neighbours] of map.adjacency) console.log(`  ${area} -> ${neighbours.join(", ")}`);
