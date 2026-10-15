// Offline browser acceptance for editable case models, shared ArchiveScene rendering and the editor.
// The fixture serves only the four local GLBs explicitly used by this system.
import assert from "node:assert/strict";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(project, ".tools", "case-system-check");
const isReference = process.argv.includes("--reference");
// Retain the old command as an explicit alias of the current common renderer audit.
const isUnifiedRender = process.argv.includes("--unified-render") || process.argv.includes("--punk-view");
const unifiedOutput = path.join(project, ".tools", "array-surface-refinement");
const referenceOutput = path.join(output, process.argv.includes("--reference-before") ? "punk-reference-before" : "punk-reference");
const referencePresetIds = ["marble", "hazard", "white", "glass", "frost", "red", "blue", "coral", "tide", "aurora"];
const referenceAnglePresetIds = ["white", "glass", "frost", "red", "blue", "aurora"];
const referenceAngleFrameIds = [0, 23, 45, 59];
const referenceRegions = {
  frame: { x: [-1.97, -1.89], z: [0.8, 2.5] },
  top: { x: [-1.3, 0.7], z: [3.405, 3.455] },
  spine: { x: [1.40, 1.66], z: [0.95, 1.45] },
  clip: { x: [1.32, 1.56], z: [3.51, 3.55] },
  label: { x: [1.30, 1.60], z: [1.82, 1.94] },
};
// Frozen full-surface tuples extracted from 4bafd77; the fixture stays independent of Git at runtime.
const legacyPunkPresetFixture = {"fields":["finish","color","roughness","transmission","ior","emission","pattern","secondaryColor","metalness","clearcoat","iridescence","thickness","attenuationDistance"],"presets":{"marble":{"accent":["metal","#db8a48",0.26,0,1.46,0,"none","#f0bc7e",0.68,0.36,0,0.22,2.5],"amber":["glass","#e3a264",0.24,0.38,1.46,0,"none","#db8a48",0,0.58,0,0.1152,2.52],"back":["paint","#f1efe9",0.58,0,1.46,0,"marble","#aaa9a1",0,0.12,0,0.22,2.5],"ceramic":["paint","#f1efe9",0.42,0,1.46,0,"none","#fbfaf6",0,0.28,0,0.22,2.5],"clip":["metal","#fbfaf6",0.28,0,1.46,0,"none","#db8a48",0.72,0.34,0,0.22,2.5],"cover":["glass","#f8f8f4",0.14,0.94,1.46,0,"none","#fbfaf6",0,0.72,0.032,0.16,3.5],"emblem":["metal","#e7e1d4",0.24,0,1.46,0,"none","#db8a48",0.7,0.48,0,0.22,2.5],"fasteners":["metal","#fbfaf6",0.28,0,1.46,0,"none","#db8a48",0.72,0.34,0,0.22,2.5],"film":["glass","#f8f8f4",0.14,0.82,1.46,0,"none","#fbfaf6",0,0.64,0,0.08,3.5],"filmEdge":["metal","#db8a48",0.28,0,1.46,0,"none","#db8a48",0.72,0.34,0,0.22,2.5],"frame":["paint","#e8e6df",0.3,0,1.46,0,"marble","#9c9c96",0.12,0.5,0.08,0.16,3.5],"ink":["paint","#454540",0.74,0,1.46,0,"none","#db8a48",0,0.12,0,0.22,2.5],"label":["paint","#f1efe9",0.58,0,1.46,0,"none","#fbfaf6",0,0.12,0,0.22,2.5],"lettering":["paint","#454540",0.72,0,1.46,0,"none","#fbfaf6",0,0.12,0,0.22,2.5],"optics":["glass","#f8f8f4",0.12,0.86,1.46,0,"none","#fbfaf6",0,0.8,0.08,0.16,3.5],"rim":["metal","#9c9c96",0.28,0,1.46,0,"none","#db8a48",0.72,0.34,0,0.22,2.5],"ruler":["paint","#db8a48",0.4,0,1.46,0,"none","#fbfaf6",0,0.12,0,0.22,2.5],"spine":["paint","#e8e6df",0.3,0,1.46,0,"marble","#9c9c96",0.12,0.5,0.08,0.16,3.5],"trim":["metal","#db8a48",0.26,0,1.46,0,"none","#fbfaf6",0.66,0.3,0,0.22,2.5],"trimHighlight":["metal","#fbfaf6",0.28,0,1.46,0,"none","#db8a48",0.72,0.34,0,0.22,2.5],"vents":["metal","#e8e6df",0.28,0,1.46,0,"none","#db8a48",0.72,0.34,0,0.22,2.5]},"hazard":{"accent":["metal","#f1b92e",0.26,0,1.46,0,"none","#ffe18b",0.68,0.36,0,0.22,2.5],"amber":["glass","#f0ae28",0.24,0.38,1.46,0,"none","#f1b92e",0,0.58,0,0.1296,2.304],"back":["paint","#292d30",0.58,0,1.46,0,"carbon","#55595c",0,0.12,0,0.22,2.5],"ceramic":["paint","#292d30",0.42,0,1.46,0,"none","#e8e8e2",0,0.28,0,0.22,2.5],"clip":["metal","#e8e8e2",0.28,0,1.46,0,"none","#f1b92e",0.72,0.34,0,0.22,2.5],"cover":["glass","#dfe4e4",0.18,0.93,1.46,0,"none","#e8e8e2",0,0.72,0.016,0.18,3.2],"emblem":["metal","#f1bd35",0.24,0,1.46,0,"none","#f1b92e",0.7,0.48,0,0.22,2.5],"fasteners":["metal","#e8e8e2",0.28,0,1.46,0,"none","#f1b92e",0.72,0.34,0,0.22,2.5],"film":["glass","#dfe4e4",0.18,0.8,1.46,0,"none","#e8e8e2",0,0.64,0,0.09,3.2],"filmEdge":["metal","#f1b92e",0.28,0,1.46,0,"none","#f1b92e",0.72,0.34,0,0.22,2.5],"frame":["metal","#27292b",0.34,0,1.46,0,"carbon","#515357",0.76,0.4,0.04,0.18,3.2],"ink":["paint","#202326",0.74,0,1.46,0,"none","#f1b92e",0,0.12,0,0.22,2.5],"label":["paint","#292d30",0.58,0,1.46,0,"none","#e8e8e2",0,0.12,0,0.22,2.5],"lettering":["paint","#202326",0.72,0,1.46,0,"none","#e8e8e2",0,0.12,0,0.22,2.5],"optics":["glass","#dfe4e4",0.12,0.88,1.46,0,"none","#e8e8e2",0,0.8,0.04,0.18,3.2],"rim":["metal","#515357",0.28,0,1.46,0,"none","#f1b92e",0.72,0.34,0,0.22,2.5],"ruler":["paint","#f1b92e",0.4,0,1.46,0,"none","#e8e8e2",0,0.12,0,0.22,2.5],"spine":["metal","#27292b",0.34,0,1.46,0,"carbon","#515357",0.76,0.4,0.04,0.18,3.2],"trim":["metal","#f1b92e",0.26,0,1.46,0,"none","#e8e8e2",0.66,0.3,0,0.22,2.5],"trimHighlight":["metal","#e8e8e2",0.28,0,1.46,0,"none","#f1b92e",0.72,0.34,0,0.22,2.5],"vents":["metal","#27292b",0.28,0,1.46,0,"none","#f1b92e",0.72,0.34,0,0.22,2.5]},"white":{"accent":["metal","#d7a15a",0.26,0,1.46,0,"none","#f0d39a",0.68,0.36,0,0.22,2.5],"amber":["glass","#e9b35c",0.24,0.38,1.46,0,"none","#d7a15a",0,0.58,0,0.1008,3.2399999999999998],"back":["paint","#eeeeea",0.58,0,1.46,0,"none","#d9dad6",0,0.12,0,0.22,2.5],"ceramic":["paint","#eeeeea",0.42,0,1.46,0,"none","#ffffff",0,0.28,0,0.22,2.5],"clip":["metal","#ffffff",0.28,0,1.46,0,"none","#d7a15a",0.72,0.34,0,0.22,2.5],"cover":["glass","#fbfaf5",0.14,0.95,1.46,0,"none","#ffffff",0,0.72,0.032,0.14,4.5],"emblem":["metal","#e9e6dd",0.24,0,1.46,0,"none","#d7a15a",0.7,0.48,0,0.22,2.5],"fasteners":["metal","#ffffff",0.28,0,1.46,0,"none","#d7a15a",0.72,0.34,0,0.22,2.5],"film":["glass","#fbfaf5",0.14,0.84,1.46,0,"none","#ffffff",0,0.64,0,0.07,4.5],"filmEdge":["metal","#d7a15a",0.28,0,1.46,0,"none","#d7a15a",0.72,0.34,0,0.22,2.5],"frame":["paint","#e7e8e3",0.36,0.06,1.46,0,"none","#c4c7c4",0.08,0.4,0.08,0.14,4.5],"ink":["paint","#585954",0.74,0,1.46,0,"none","#d7a15a",0,0.12,0,0.22,2.5],"label":["paint","#eeeeea",0.58,0,1.46,0,"none","#ffffff",0,0.12,0,0.22,2.5],"lettering":["paint","#585954",0.72,0,1.46,0,"none","#ffffff",0,0.12,0,0.22,2.5],"optics":["glass","#fbfaf5",0.12,0.9,1.46,0,"none","#ffffff",0,0.8,0.08,0.14,4.5],"rim":["metal","#c4c7c4",0.28,0,1.46,0,"none","#d7a15a",0.72,0.34,0,0.22,2.5],"ruler":["paint","#d7a15a",0.4,0,1.46,0,"none","#ffffff",0,0.12,0,0.22,2.5],"spine":["paint","#e7e8e3",0.36,0.06,1.46,0,"none","#c4c7c4",0.08,0.4,0.08,0.14,4.5],"trim":["metal","#d7a15a",0.26,0,1.46,0,"none","#ffffff",0.66,0.3,0,0.22,2.5],"trimHighlight":["metal","#ffffff",0.28,0,1.46,0,"none","#d7a15a",0.72,0.34,0,0.22,2.5],"vents":["metal","#e7e8e3",0.28,0,1.46,0,"none","#d7a15a",0.72,0.34,0,0.22,2.5]},"glass":{"accent":["glass","#46aa98",0.3,0.34,1.46,0,"none","#9de2d0",0.04,0.36,0,0.22,2.5],"amber":["glass","#e8a765",0.24,0.38,1.46,0,"none","#46aa98",0,0.58,0,0.17279999999999998,1.296],"back":["paint","#d4dcd7",0.58,0,1.46,0,"none","#b7cbc3",0,0.12,0,0.22,2.5],"ceramic":["paint","#d4dcd7",0.42,0,1.46,0,"none","#f7fbf9",0,0.28,0,0.22,2.5],"clip":["metal","#f7fbf9",0.28,0,1.46,0,"none","#46aa98",0.72,0.34,0,0.22,2.5],"cover":["glass","#f2faf6",0.1,0.96,1.46,0,"none","#f7fbf9",0,0.72,0.072,0.24,1.8],"emblem":["glass","#eaf4f0",0.24,0.36,1.46,0,"none","#46aa98",0.04,0.48,0,0.22,2.5],"fasteners":["metal","#f7fbf9",0.28,0,1.46,0,"none","#46aa98",0.72,0.34,0,0.22,2.5],"film":["glass","#f2faf6",0.1,0.84,1.46,0,"none","#f7fbf9",0,0.64,0,0.12,1.8],"filmEdge":["metal","#46aa98",0.28,0,1.46,0,"none","#46aa98",0.72,0.34,0,0.22,2.5],"frame":["glass","#c0d9ce",0.16,0.58,1.46,0,"none","#78b5a4",0,0.74,0.18,0.24,1.8],"ink":["paint","#46544f",0.74,0,1.46,0,"none","#46aa98",0,0.12,0,0.22,2.5],"label":["paint","#d4dcd7",0.58,0,1.46,0,"none","#f7fbf9",0,0.12,0,0.22,2.5],"lettering":["paint","#46544f",0.72,0,1.46,0,"none","#f7fbf9",0,0.12,0,0.22,2.5],"optics":["glass","#f2faf6",0.12,0.9,1.46,0,"none","#f7fbf9",0,0.8,0.18,0.24,1.8],"rim":["metal","#78b5a4",0.28,0,1.46,0,"none","#46aa98",0.72,0.34,0,0.22,2.5],"ruler":["paint","#46aa98",0.4,0,1.46,0,"none","#f7fbf9",0,0.12,0,0.22,2.5],"spine":["glass","#c0d9ce",0.16,0.58,1.46,0,"none","#78b5a4",0,0.74,0.18,0.24,1.8],"trim":["paint","#46aa98",0.26,0,1.46,0,"none","#f7fbf9",0.04,0.3,0,0.22,2.5],"trimHighlight":["metal","#f7fbf9",0.28,0,1.46,0,"none","#46aa98",0.72,0.34,0,0.22,2.5],"vents":["metal","#c0d9ce",0.28,0,1.46,0,"none","#46aa98",0.72,0.34,0,0.22,2.5]},"frost":{"accent":["metal","#776b96",0.26,0,1.46,0,"none","#b1a0cf",0.68,0.36,0,0.22,2.5],"amber":["glass","#d99160",0.24,0.38,1.46,0,"none","#776b96",0,0.58,0,0.2016,0.5184],"back":["paint","#e8c0a5",0.58,0,1.46,0,"none","#d99771",0,0.12,0,0.22,2.5],"ceramic":["paint","#e8c0a5",0.42,0,1.46,0,"none","#f7f4ef",0,0.28,0,0.22,2.5],"clip":["metal","#f7f4ef",0.28,0,1.46,0,"none","#776b96",0.72,0.34,0,0.22,2.5],"cover":["frost","#f1eef2",0.58,0.76,1.46,0,"none","#f7f4ef",0,0.72,0.024,0.28,0.72],"emblem":["metal","#f4efe9",0.24,0,1.46,0,"none","#776b96",0.7,0.48,0,0.22,2.5],"fasteners":["metal","#f7f4ef",0.28,0,1.46,0,"none","#776b96",0.72,0.34,0,0.22,2.5],"film":["frost","#f1eef2",0.58,0.34,1.46,0,"none","#f7f4ef",0,0.64,0,0.14,0.72],"filmEdge":["metal","#776b96",0.28,0,1.46,0,"none","#776b96",0.72,0.34,0,0.22,2.5],"frame":["frost","#d1d0d7",0.52,0.28,1.46,0,"none","#bbb9c1",0,0.26,0.06,0.28,0.72],"ink":["paint","#55535d",0.74,0,1.46,0,"none","#776b96",0,0.12,0,0.22,2.5],"label":["paint","#e8c0a5",0.58,0,1.46,0,"none","#f7f4ef",0,0.12,0,0.22,2.5],"lettering":["paint","#55535d",0.72,0,1.46,0,"none","#f7f4ef",0,0.12,0,0.22,2.5],"optics":["glass","#f1eef2",0.12,0.42,1.46,0,"none","#f7f4ef",0,0.8,0.06,0.28,0.72],"rim":["metal","#bbb9c1",0.28,0,1.46,0,"none","#776b96",0.72,0.34,0,0.22,2.5],"ruler":["paint","#776b96",0.4,0,1.46,0,"none","#f7f4ef",0,0.12,0,0.22,2.5],"spine":["frost","#d1d0d7",0.52,0.28,1.46,0,"none","#bbb9c1",0,0.26,0.06,0.28,0.72],"trim":["metal","#776b96",0.26,0,1.46,0,"none","#f7f4ef",0.66,0.3,0,0.22,2.5],"trimHighlight":["metal","#f7f4ef",0.28,0,1.46,0,"none","#776b96",0.72,0.34,0,0.22,2.5],"vents":["metal","#d1d0d7",0.28,0,1.46,0,"none","#776b96",0.72,0.34,0,0.22,2.5]},"red":{"accent":["metal","#db120c",0.26,0,1.46,0,"none","#ff7567",0.68,0.36,0,0.22,2.5],"amber":["glass","#df9a54",0.24,0.38,1.46,0,"none","#db120c",0,0.58,0,0.1152,2.664],"back":["paint","#e4e7e8",0.58,0,1.46,0,"none","#c9ced0",0,0.12,0,0.22,2.5],"ceramic":["paint","#e4e7e8",0.42,0,1.46,0,"none","#fafafa",0,0.28,0,0.22,2.5],"clip":["metal","#fafafa",0.28,0,1.46,0,"none","#db120c",0.72,0.34,0,0.22,2.5],"cover":["glass","#f4f7f8",0.13,0.95,1.46,0,"none","#fafafa",0,0.72,0.020000000000000004,0.16,3.7],"emblem":["metal","#ececeb",0.24,0,1.46,0,"none","#db120c",0.7,0.48,0,0.22,2.5],"fasteners":["metal","#fafafa",0.28,0,1.46,0,"none","#db120c",0.72,0.34,0,0.22,2.5],"film":["glass","#f4f7f8",0.13,0.86,1.46,0,"none","#fafafa",0,0.64,0,0.08,3.7],"filmEdge":["metal","#db120c",0.28,0,1.46,0,"none","#db120c",0.72,0.34,0,0.22,2.5],"frame":["metal","#d20b08",0.2,0.02,1.46,0,"none","#720a08",0.62,0.82,0.05,0.16,3.7],"ink":["paint","#393b3d",0.74,0,1.46,0,"none","#db120c",0,0.12,0,0.22,2.5],"label":["paint","#e4e7e8",0.58,0,1.46,0,"none","#fafafa",0,0.12,0,0.22,2.5],"lettering":["paint","#393b3d",0.72,0,1.46,0,"none","#fafafa",0,0.12,0,0.22,2.5],"optics":["glass","#f4f7f8",0.12,0.9,1.46,0,"none","#fafafa",0,0.8,0.05,0.16,3.7],"rim":["metal","#720a08",0.28,0,1.46,0,"none","#db120c",0.72,0.34,0,0.22,2.5],"ruler":["paint","#db120c",0.4,0,1.46,0,"none","#fafafa",0,0.12,0,0.22,2.5],"spine":["metal","#d20b08",0.2,0.02,1.46,0,"none","#720a08",0.62,0.82,0.05,0.16,3.7],"trim":["metal","#db120c",0.26,0,1.46,0,"none","#fafafa",0.66,0.3,0,0.22,2.5],"trimHighlight":["metal","#fafafa",0.28,0,1.46,0,"none","#db120c",0.72,0.34,0,0.22,2.5],"vents":["metal","#d20b08",0.28,0,1.46,0,"none","#db120c",0.72,0.34,0,0.22,2.5]},"blue":{"accent":["metal","#4e9be7",0.26,0,1.46,0,"none","#c0d6f5",0.68,0.36,0,0.22,2.5],"amber":["glass","#e7a65b",0.24,0.38,1.46,0,"none","#4e9be7",0,0.58,0,0.1296,2.2319999999999998],"back":["paint","#dbe4ee",0.58,0,1.46,0,"none","#a9c3e6",0,0.12,0,0.22,2.5],"ceramic":["paint","#dbe4ee",0.42,0,1.46,0,"none","#f7f8fb",0,0.28,0,0.22,2.5],"clip":["metal","#f7f8fb",0.28,0,1.46,0,"none","#4e9be7",0.72,0.34,0,0.22,2.5],"cover":["glass","#eef6ff",0.15,0.94,1.46,0,"none","#f7f8fb",0,0.72,0.048,0.18,3.1],"emblem":["metal","#edf3fb",0.24,0,1.46,0,"none","#4e9be7",0.7,0.48,0,0.22,2.5],"fasteners":["metal","#f7f8fb",0.28,0,1.46,0,"none","#4e9be7",0.72,0.34,0,0.22,2.5],"film":["glass","#eef6ff",0.15,0.82,1.46,0,"none","#f7f8fb",0,0.64,0,0.09,3.1],"filmEdge":["metal","#4e9be7",0.28,0,1.46,0,"none","#4e9be7",0.72,0.34,0,0.22,2.5],"frame":["metal","#438cde",0.24,0.04,1.46,0,"brushed","#8eb7ef",0.64,0.66,0.12,0.18,3.1],"ink":["paint","#465464",0.74,0,1.46,0,"none","#4e9be7",0,0.12,0,0.22,2.5],"label":["paint","#dbe4ee",0.58,0,1.46,0,"none","#f7f8fb",0,0.12,0,0.22,2.5],"lettering":["paint","#465464",0.72,0,1.46,0,"none","#f7f8fb",0,0.12,0,0.22,2.5],"optics":["glass","#eef6ff",0.12,0.86,1.46,0,"none","#f7f8fb",0,0.8,0.12,0.18,3.1],"rim":["metal","#8eb7ef",0.28,0,1.46,0,"none","#4e9be7",0.72,0.34,0,0.22,2.5],"ruler":["paint","#4e9be7",0.4,0,1.46,0,"none","#f7f8fb",0,0.12,0,0.22,2.5],"spine":["metal","#438cde",0.24,0.04,1.46,0,"brushed","#8eb7ef",0.64,0.66,0.12,0.18,3.1],"trim":["metal","#4e9be7",0.26,0,1.46,0,"none","#f7f8fb",0.66,0.3,0,0.22,2.5],"trimHighlight":["metal","#f7f8fb",0.28,0,1.46,0,"none","#4e9be7",0.72,0.34,0,0.22,2.5],"vents":["metal","#438cde",0.28,0,1.46,0,"none","#4e9be7",0.72,0.34,0,0.22,2.5]},"coral":{"accent":["paint","#e58b77",0.3,0,1.46,0,"none","#f8c4b1",0.04,0.36,0,0.22,2.5],"amber":["glass","#e8a36c",0.24,0.38,1.46,0,"none","#e58b77",0,0.58,0,0.1152,2.52],"back":["paint","#e9e5e0",0.58,0,1.46,0,"none","#e5d1c6",0,0.12,0,0.22,2.5],"ceramic":["paint","#e9e5e0",0.42,0,1.46,0,"none","#fff9f5",0,0.28,0,0.22,2.5],"clip":["metal","#fff9f5",0.28,0,1.46,0,"none","#e58b77",0.72,0.34,0,0.22,2.5],"cover":["glass","#fff5f0",0.13,0.95,1.46,0,"none","#fff9f5",0,0.72,0.032,0.16,3.5],"emblem":["paint","#f7eee8",0.24,0,1.46,0,"none","#e58b77",0.04,0.48,0,0.22,2.5],"fasteners":["metal","#fff9f5",0.28,0,1.46,0,"none","#e58b77",0.72,0.34,0,0.22,2.5],"film":["glass","#fff5f0",0.13,0.84,1.46,0,"none","#fff9f5",0,0.64,0,0.08,3.5],"filmEdge":["metal","#e58b77",0.28,0,1.46,0,"none","#e58b77",0.72,0.34,0,0.22,2.5],"frame":["paint","#f2a894",0.3,0.08,1.46,0,"none","#e98e7e",0.04,0.38,0.08,0.16,3.5],"ink":["paint","#5d5652",0.74,0,1.46,0,"none","#e58b77",0,0.12,0,0.22,2.5],"label":["paint","#e9e5e0",0.58,0,1.46,0,"none","#fff9f5",0,0.12,0,0.22,2.5],"lettering":["paint","#5d5652",0.72,0,1.46,0,"none","#fff9f5",0,0.12,0,0.22,2.5],"optics":["glass","#fff5f0",0.12,0.88,1.46,0,"none","#fff9f5",0,0.8,0.08,0.16,3.5],"rim":["metal","#e98e7e",0.28,0,1.46,0,"none","#e58b77",0.72,0.34,0,0.22,2.5],"ruler":["paint","#e58b77",0.4,0,1.46,0,"none","#fff9f5",0,0.12,0,0.22,2.5],"spine":["paint","#f2a894",0.3,0.08,1.46,0,"none","#e98e7e",0.04,0.38,0.08,0.16,3.5],"trim":["paint","#e58b77",0.26,0,1.46,0,"none","#fff9f5",0.04,0.3,0,0.22,2.5],"trimHighlight":["metal","#fff9f5",0.28,0,1.46,0,"none","#e58b77",0.72,0.34,0,0.22,2.5],"vents":["metal","#f2a894",0.28,0,1.46,0,"none","#e58b77",0.72,0.34,0,0.22,2.5]},"tide":{"accent":["metal","#45b6cb",0.26,0,1.46,0,"none","#b3e2e7",0.68,0.36,0,0.22,2.5],"amber":["glass","#e9a967",0.24,0.38,1.46,0,"none","#45b6cb",0,0.58,0,0.1296,2.016],"back":["paint","#cee2ec",0.58,0,1.46,0,"gradient","#83c9d4",0,0.12,0,0.22,2.5],"ceramic":["paint","#cee2ec",0.42,0,1.46,0,"none","#f2fbfc",0,0.28,0,0.22,2.5],"clip":["metal","#f2fbfc",0.28,0,1.46,0,"none","#45b6cb",0.72,0.34,0,0.22,2.5],"cover":["glass","#eaf7fb",0.14,0.93,1.46,0,"none","#f2fbfc",0,0.72,0.12,0.18,2.8],"emblem":["metal","#f2f8f8",0.24,0,1.46,0,"none","#45b6cb",0.7,0.48,0,0.22,2.5],"fasteners":["metal","#f2fbfc",0.28,0,1.46,0,"none","#45b6cb",0.72,0.34,0,0.22,2.5],"film":["glass","#eaf7fb",0.14,0.82,1.46,0,"none","#f2fbfc",0,0.64,0,0.09,2.8],"filmEdge":["metal","#45b6cb",0.28,0,1.46,0,"none","#45b6cb",0.72,0.34,0,0.22,2.5],"frame":["metal","#176fd0",0.24,0.06,1.46,0,"gradient","#7dc9d6",0.56,0.68,0.3,0.18,2.8],"ink":["paint","#3f5660",0.74,0,1.46,0,"none","#45b6cb",0,0.12,0,0.22,2.5],"label":["paint","#cee2ec",0.58,0,1.46,0,"none","#f2fbfc",0,0.12,0,0.22,2.5],"lettering":["paint","#3f5660",0.72,0,1.46,0,"none","#f2fbfc",0,0.12,0,0.22,2.5],"optics":["glass","#eaf7fb",0.12,0.86,1.46,0,"none","#f2fbfc",0,0.8,0.3,0.18,2.8],"rim":["metal","#7dc9d6",0.28,0,1.46,0,"none","#45b6cb",0.72,0.34,0,0.22,2.5],"ruler":["paint","#45b6cb",0.4,0,1.46,0,"none","#f2fbfc",0,0.12,0,0.22,2.5],"spine":["metal","#176fd0",0.24,0.06,1.46,0,"gradient","#7dc9d6",0.56,0.68,0.3,0.18,2.8],"trim":["metal","#45b6cb",0.26,0,1.46,0,"none","#f2fbfc",0.66,0.3,0,0.22,2.5],"trimHighlight":["metal","#f2fbfc",0.28,0,1.46,0,"none","#45b6cb",0.72,0.34,0,0.22,2.5],"vents":["metal","#176fd0",0.28,0,1.46,0,"none","#45b6cb",0.72,0.34,0,0.22,2.5]},"aurora":{"accent":["glass","#7ac8d4",0.3,0.34,1.46,0,"none","#d8bff3",0.04,0.36,0,0.22,2.5],"amber":["glass","#e8a86a",0.24,0.38,1.46,0,"none","#7ac8d4",0,0.58,0,0.144,1.656],"back":["paint","#e3e8ed",0.58,0,1.46,0,"gradient","#b6d0e6",0,0.12,0,0.22,2.5],"ceramic":["paint","#e3e8ed",0.42,0,1.46,0,"none","#fbfbff",0,0.28,0,0.22,2.5],"clip":["metal","#fbfbff",0.28,0,1.46,0,"none","#7ac8d4",0.72,0.34,0,0.22,2.5],"cover":["glass","#f2f7fc",0.1,0.96,1.46,0,"none","#fbfbff",0,0.72,0.21600000000000003,0.2,2.3],"emblem":["glass","#f4f4f8",0.24,0.36,1.46,0,"none","#7ac8d4",0.04,0.48,0,0.22,2.5],"fasteners":["metal","#fbfbff",0.28,0,1.46,0,"none","#7ac8d4",0.72,0.34,0,0.22,2.5],"film":["glass","#f2f7fc",0.1,0.88,1.46,0,"none","#fbfbff",0,0.64,0,0.1,2.3],"filmEdge":["metal","#7ac8d4",0.28,0,1.46,0,"none","#7ac8d4",0.72,0.34,0,0.22,2.5],"frame":["glass","#a8c5ef",0.2,0.36,1.46,0,"gradient","#d9d7f4",0.08,0.72,0.54,0.2,2.3],"ink":["paint","#51576a",0.74,0,1.46,0,"none","#7ac8d4",0,0.12,0,0.22,2.5],"label":["paint","#e3e8ed",0.58,0,1.46,0,"none","#fbfbff",0,0.12,0,0.22,2.5],"lettering":["paint","#51576a",0.72,0,1.46,0,"none","#fbfbff",0,0.12,0,0.22,2.5],"optics":["glass","#f2f7fc",0.12,0.92,1.46,0,"none","#fbfbff",0,0.8,0.54,0.2,2.3],"rim":["metal","#d9d7f4",0.28,0,1.46,0,"none","#7ac8d4",0.72,0.34,0,0.22,2.5],"ruler":["paint","#7ac8d4",0.4,0,1.46,0,"none","#fbfbff",0,0.12,0,0.22,2.5],"spine":["glass","#a8c5ef",0.2,0.36,1.46,0,"gradient","#d9d7f4",0.08,0.72,0.54,0.2,2.3],"trim":["paint","#7ac8d4",0.26,0,1.46,0,"none","#fbfbff",0.04,0.3,0,0.22,2.5],"trimHighlight":["metal","#fbfbff",0.28,0,1.46,0,"none","#7ac8d4",0.72,0.34,0,0.22,2.5],"vents":["metal","#a8c5ef",0.28,0,1.46,0,"none","#7ac8d4",0.72,0.34,0,0.22,2.5]}}};
const revisionTwoAuroraFixture = { fields: ["finish", "color", "roughness", "transmission", "ior", "emission", "pattern", "secondaryColor", "metalness", "clearcoat", "iridescence", "thickness", "attenuationDistance", "gradientAngle"], surfaces: {
  frame: ["glass", "#9aacfb", 0.2, 0.28, 1.46, 0, "gradient", "#566cff", 0.04, 0.4, 0.1, 0.2, 2.3, -45],
  cover: ["glass", "#ffffff", 0.06, 0.985, 1.46, 0, "none", "#ffffff", 0, 0.16, 0, 0.018, 12, 90],
  back: ["paint", "#dfe5f1", 0.58, 0, 1.46, 0, "gradient", "#b6d0e6", 0, 0.12, 0, 0.22, 2.5, 90],
  accent: ["paint", "#d88c4e", 0.42, 0, 1.46, 0, "none", "#d88c4e", 0.04, 0.12, 0, 0.22, 2.5, 90],
  spine: ["paint", "#9b9b9b", 0.42, 0, 1.46, 0, "gradient", "#9b9b9b", 0.06, 0.12, 0, 0.025, 2.5, 90],
  clip: ["paint", "#28507a", 0.28, 0, 1.46, 0, "none", "#28507a", 0.02, 0.24, 0, 0.16, 2, 90],
  fasteners: ["metal", "#fbfbff", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90],
  emblem: ["paint", "#e4e4e2", 0.36, 0, 1.46, 0, "none", "#e4e4e2", 0.04, 0.16, 0, 0.22, 2.5, 90],
  label: ["paint", "#afadac", 0.48, 0, 1.46, 0, "none", "#fbfbff", 0, 0.12, 0, 0.22, 2.5, 90],
  ink: ["paint", "#30312f", 0.72, 0, 1.46, 0, "none", "#30312f", 0, 0.12, 0, 0.22, 2.5, 90],
  trim: ["paint", "#d0d0cd", 0.55, 0, 1.46, 0, "none", "#d0d0cd", 0, 0.06, 0, 0.22, 2.5, 90],
  ruler: ["paint", "#d4d4d1", 0.55, 0, 1.46, 0, "none", "#d4d4d1", 0, 0.06, 0, 0.22, 2.5, 90],
  vents: ["paint", "#515250", 0.65, 0, 1.46, 0, "none", "#515250", 0.05, 0.12, 0, 0.22, 2.5, 90],
  lettering: ["paint", "#c2c2bf", 0.65, 0, 1.46, 0, "none", "#c2c2bf", 0, 0.12, 0, 0.22, 2.5, 90],
  optics: ["glass", "#f2f7fc", 0.12, 0.92, 1.46, 0, "none", "#fbfbff", 0, 0.8, 0.54, 0.2, 2.3, 90],
  film: ["glass", "#f2f7fc", 0.1, 0.88, 1.46, 0, "none", "#fbfbff", 0, 0.64, 0, 0.1, 2.3, 90],
  filmEdge: ["metal", "#7ac8d4", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90],
  amber: ["glass", "#e8a86a", 0.24, 0.38, 1.46, 0, "none", "#7ac8d4", 0, 0.58, 0, 0.144, 1.656, 90],
  ceramic: ["paint", "#e3e8ed", 0.42, 0, 1.46, 0, "none", "#fbfbff", 0, 0.28, 0, 0.22, 2.5, 90],
  rim: ["metal", "#566cff", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90],
  trimHighlight: ["metal", "#fbfbff", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90],
} };

// Frozen V3 Aurora material tuples and fingerprint input from the pre-optics settings source.
const revisionThreeAuroraFixture = { fields: ["finish", "color", "roughness", "transmission", "ior", "emission", "pattern", "secondaryColor", "metalness", "clearcoat", "iridescence", "thickness", "attenuationDistance", "gradientAngle", "clearcoatRoughness", "preserveSource"], surfaces: {
  accent: ["paint", "#d88c4e", 0.42, 0, 1.46, 0, "none", "#d88c4e", 0.04, 0.12, 0, 0.22, 2.5, 90, 0.42, false],
  amber: ["glass", "#e8a86a", 0.24, 0.38, 1.46, 0, "none", "#7ac8d4", 0, 0.58, 0, 0.144, 1.656, 90, 0.24, false],
  back: ["paint", "#dfe5f1", 0.58, 0, 1.46, 0, "gradient", "#b6d0e6", 0, 0.12, 0, 0.22, 2.5, 90, 0.58, false],
  ceramic: ["paint", "#e3e8ed", 0.42, 0, 1.46, 0, "none", "#fbfbff", 0, 0.28, 0, 0.22, 2.5, 90, 0.42, false],
  clip: ["paint", "#28507a", 0.28, 0, 1.46, 0, "none", "#28507a", 0.02, 0.24, 0, 0.16, 2, 90, 0.28, false],
  cover: ["glass", "#ffffff", 0.06, 0.985, 1.46, 0, "none", "#ffffff", 0, 0.16, 0, 0.018, 12, 90, 0.06, false],
  emblem: ["paint", "#e4e4e2", 0.36, 0, 1.46, 0, "none", "#e4e4e2", 0.04, 0.16, 0, 0.22, 2.5, 90, 0.36, false],
  fasteners: ["metal", "#fbfbff", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90, 0.28, false],
  film: ["glass", "#f2f7fc", 0.1, 0.88, 1.46, 0, "none", "#fbfbff", 0, 0.64, 0, 0.1, 2.3, 90, 0.1, false],
  filmEdge: ["metal", "#7ac8d4", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90, 0.28, false],
  frame: ["glass", "#c9cabe", 0.2, 0.28, 1.46, 0, "gradient", "#566cff", 0.04, 0.5, 0.54, 0.2, 2.3, -12, 0.085, false],
  ink: ["paint", "#30312f", 0.72, 0, 1.46, 0, "none", "#30312f", 0, 0.12, 0, 0.22, 2.5, 90, 0.72, false],
  label: ["paint", "#afadac", 0.48, 0, 1.46, 0, "none", "#fbfbff", 0, 0.12, 0, 0.22, 2.5, 90, 0.48, false],
  lettering: ["paint", "#c2c2bf", 0.65, 0, 1.46, 0, "none", "#c2c2bf", 0, 0.12, 0, 0.22, 2.5, 90, 0.65, false],
  optics: ["glass", "#f2f7fc", 0.12, 0.92, 1.46, 0, "none", "#fbfbff", 0, 0.8, 0.54, 0.2, 2.3, 90, 0.12, false],
  rim: ["metal", "#566cff", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90, 0.28, false],
  ruler: ["paint", "#d4d4d1", 0.55, 0, 1.46, 0, "none", "#d4d4d1", 0, 0.06, 0, 0.22, 2.5, 90, 0.55, false],
  spine: ["paint", "#9b9b9b", 0.42, 0, 1.46, 0, "gradient", "#9b9b9b", 0.06, 0.12, 0, 0.025, 2.5, 90, 0.42, false],
  trim: ["paint", "#d0d0cd", 0.55, 0, 1.46, 0, "none", "#d0d0cd", 0, 0.06, 0, 0.22, 2.5, 90, 0.55, false],
  trimHighlight: ["metal", "#fbfbff", 0.28, 0, 1.46, 0, "none", "#7ac8d4", 0.72, 0.34, 0, 0.22, 2.5, 90, 0.28, false],
  vents: ["paint", "#515250", 0.65, 0, 1.46, 0, "none", "#515250", 0.05, 0.12, 0, 0.22, 2.5, 90, 0.65, false],
} };

await mkdir(output, { recursive: true });
if (!isReference) assert.ok(await access(path.join(project, "src/case-editor.ts")).then(() => true, () => false),
  "case-editor.ts must exist and be readable before this acceptance run.");

function glbTriangleCounts(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF", "The source model must be a binary glTF file.");
  assert.equal(bytes.readUInt32LE(4), 2, "The source model must use GLB version 2.");
  let offset = 12;
  let document;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > bytes.length) throw new Error("Invalid GLB chunk length.");
    if (type === 0x4e4f534a) {
      document = JSON.parse(bytes.toString("utf8", offset, offset + length).replace(/\0+$/u, "").trim());
      break;
    }
    offset += length;
  }
  if (!document) throw new Error("The GLB has no JSON chunk.");
  const scene = document.scenes?.[document.scene ?? 0];
  if (!scene?.nodes) throw new Error("The GLB default scene has no root nodes.");
  let triangles = 0;
  const byMaterial = {};
  const visited = new Set();
  const visit = index => {
    if (visited.has(index)) return;
    visited.add(index);
    const node = document.nodes?.[index];
    if (!node) throw new Error(`GLB scene references missing node ${index}.`);
    if (Number.isInteger(node.mesh)) {
      const mesh = document.meshes?.[node.mesh];
      if (!mesh) throw new Error(`GLB node references missing mesh ${node.mesh}.`);
      for (const primitive of mesh.primitives ?? []) {
        const mode = primitive.mode ?? 4;
        const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
        const count = document.accessors?.[accessorIndex]?.count ?? 0;
        const primitiveTriangles = mode === 4 ? count / 3
          : mode === 5 || mode === 6 ? Math.max(0, count - 2)
            : 0;
        triangles += primitiveTriangles;
        const materialName = document.materials?.[primitive.material]?.name ?? "unassigned";
        const surface = materialName.split("__").pop().replace(/\.\d+$/u, "");
        byMaterial[surface] = (byMaterial[surface] ?? 0) + primitiveTriangles;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const index of scene.nodes) visit(index);
  return { total: Math.round(triangles), byMaterial };
}

function stubImportMetaGlobCalls(source, fileName, replacements = []) {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  let replacementIndex = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "import.meta.glob") {
      edits.push([node.getStart(parsed), node.end, replacements[replacementIndex] ?? "{}"]);
      replacementIndex++;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  for (const [start, end, replacement] of edits.reverse()) source = source.slice(0, start) + "(" + replacement + ")" + source.slice(end);
  return source;
}

const fixtureEntry = `
import * as THREE from "three";
import { createCaseModel, applyCaseAppearance, disposeCaseModel } from "./src/case-model.ts";
import { setupCaseEditor } from "./src/case-editor.ts";
import {
  caseAppearancePresets,
  casePartsForStructure,
  casePreset,
  defaultCaseSettings,
  normalizeCaseSettings,
  normalizeCaseProfiles,
} from "./src/case-settings.ts";
import { qualityPresets } from "./src/render-quality.ts";
import { getCaseLayout } from "./src/case-layout.ts";
import { ArchiveScene } from "./src/scene.ts";
import { records, setMusicAlbums } from "./src/data.ts";
import { archiveMusicStyle, defaultMusicStyle, musicStyleMarkup, stylePalette } from "./src/music-style.ts";
import { configureMusicCatalog, focusMusicEntry, getMusicDisplayEntries } from "./src/music-catalog.ts";
import { getMusicCatalogShelves } from "./src/music-catalog-shelves.ts";
import { musicSpatialEntry } from "./src/music-spatial-layout.ts";
import { ARRAY_SELECTED_EXTRA_LIFT, ARRAY_SELECTED_BELL_LIFT, ARRAY_HOVER_LIFT, arrayNeighborLift } from "./src/music-array-motion.ts";
import { ViewerAlbumCover } from "./src/viewer-album-cover.ts";
import { normalizeCaseUserPresets } from "./src/case-user-presets.ts";
import { createAlbumInsert } from "./src/album-insert.ts";
import { createAlbumPrintMaterial } from "./src/music-model.ts";
import { CardAppearance } from "./src/appearance.ts";
import { createCaseStudioLighting } from "./src/case-studio-lighting.ts";
import { setCaseGlassFrost, setCaseAlbumOcclusion } from "./src/case-materials.ts";
import { CaseAlbumInfo, RhineAlbumInfo } from "./src/rhine-album-info.ts";

const LEGACY_PUNK_PRESET_FIXTURE = ${JSON.stringify(legacyPunkPresetFixture)};
const REVISION_TWO_AURORA_FIXTURE = ${JSON.stringify(revisionTwoAuroraFixture)};
const REVISION_THREE_AURORA_FIXTURE = ${JSON.stringify(revisionThreeAuroraFixture)};
const quality = { ...qualityPresets.high, scale: 100, pixelRatio: 1, antialias: "off", shadows: 2048, aoSamples: 0, depthOfField: 0 };
let editorDesign = "rhine";
let settings = defaultCaseSettings("archive");
const settingsByDesign = {
  rhine: structuredClone(settings),
  archive: defaultCaseSettings("archive"),
};
let userPresetPreferences = { futurePunkPresets: [], archivePunkPresets: [] };
const userPresetChangeCounts = { rhine: 0, archive: 0 };
const presetPreferenceKey = design => design === "archive" ? "archivePunkPresets" : "futurePunkPresets";
let theme = "day";
let cover = { url: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d94343"/></svg>'), title: "Local fixture" };
let archiveScene;
let archiveHost;
let archiveTime = 0;
let retainedCoverAtlas;
let retainedPositions;
let archiveStyleError = "";
let archiveSceneCapture;
let archiveSceneCaptureStats;
const changes = [];
const observations = [];
const rendererCalls = [];
const editorInsertObservations = [];
let editorRendererCreations = 0;
function observeEditorRender(scene, webglRenderer) {
  const model = scene.children.find(child => child.userData?.caseStructure);
  const independentCover = scene.getObjectByName("IndependentAlbumCover");
  const insert = scene.children.find(child => child.userData?.albumInsert);
  if (insert && editorInsertObservations.length < 200) {
    const material = Array.isArray(insert.material) ? insert.material[0] : insert.material;
    insert.geometry.computeBoundingBox();
    const observation = {
      structure: model?.userData.caseStructure ?? "",
      lighting: quality.lighting,
      visible: insert.visible,
      materialType: material.type,
      lambert: material instanceof THREE.MeshLambertMaterial,
      color: material.color?.getHexString?.() ?? "",
      emissive: material.emissive?.getHexString?.() ?? "",
      transparent: material.transparent,
      opacity: material.opacity,
      depthWrite: material.depthWrite,
      colorWrite: material.colorWrite,
      castsShadow: insert.castShadow,
      receivesShadow: insert.receiveShadow,
      printReceivesShadow: independentCover?.receiveShadow ?? false,
      thickness: insert.geometry.boundingBox?.getSize(new THREE.Vector3()).z ?? 0,
      albumOcclusionMeshCount: model ? (() => { let count = 0; model.traverse(child => { if (child.userData?.caseAlbumWindow) count++; }); return count; })() : 0,
      albumOcclusionFlags: model ? (() => { const flags = []; model.traverse(child => { if (child.userData?.caseAlbumWindow) flags.push(child.userData.caseAlbumPresent === true); }); return [...new Set(flags)]; })() : [],
    };
    const previous = editorInsertObservations.at(-1);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(observation)) editorInsertObservations.push(observation);
  }
  if (rendererCalls.length < 60) {
    const shadowKey = scene.children.find(child => child instanceof THREE.DirectionalLight && child.castShadow);
    rendererCalls.push({
      children: scene.children.map(child => ({ name: child.name, structure: child.userData?.caseStructure, type: child.type })),
      cover: !!independentCover,
      coverVisible: independentCover?.visible ?? false,
      shadowMapEnabled: webglRenderer.shadowMap.enabled,
      pcfShadowMap: webglRenderer.shadowMap.type === THREE.PCFShadowMap,
      forwardShadowKey: !!shadowKey && shadowKey.position.z > 0 && shadowKey.intensity > 0,
      shadowKeyPosition: shadowKey?.position.toArray() ?? null,
    });
  }
  if (model && independentCover) {
    const surfaces = [];
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = Array.isArray(child.material) ? child.material[0] : child.material;
      if (material instanceof THREE.MeshPhysicalMaterial) {
        const configured = settings.appearances[settings.structure].surfaces[child.userData.casePart];
        surfaces.push({
          part: child.userData.casePart,
          surface: child.userData.surface,
          pattern: configured?.pattern ?? "none",
          color: material.color.getHexString(),
          roughness: material.roughness,
          transmission: material.transmission,
          metalness: material.metalness,
          anisotropy: material.anisotropy,
          shaderKey: material.customProgramCacheKey(),
          programCount: webglRenderer.info.programs?.length ?? 0,
          ior: material.ior,
          native: material.userData.caseNative ? {
            color: material.userData.caseNative.color,
            roughness: material.userData.caseNative.roughness,
            metalness: material.userData.caseNative.metalness,
            transmission: material.userData.caseNative.transmission,
            ior: material.userData.caseNative.ior,
            thickness: material.userData.caseNative.thickness,
            attenuationDistance: material.userData.caseNative.attenuationDistance,
            clearcoat: material.userData.caseNative.clearcoat,
            iridescence: material.userData.caseNative.iridescence,
          } : null,
          map: !!material.map,
        });
      }
    });
    const material = independentCover.material;
    observations.push({
      structure: model.userData.caseStructure,
      modelDetail: model.userData.caseDetail,
      surfaces,
      coverMaterial: material.type,
      coverMap: material.map?.image?.src ?? "",
      coverMesh: independentCover.name,
      coverVisible: independentCover.visible,
    });
  }
}
window.__CaseCheckWebGLRenderer = function(...args) {
  editorRendererCreations++;
  const renderer = new THREE.WebGLRenderer(...args);
  const originalRender = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
      const result = originalRender(scene, camera);
      observeEditorRender(scene, renderer);
      return result;
  };
  return renderer;
};

const editorHost = document.querySelector("#editor-host");
const editor = setupCaseEditor(editorHost, {
  getSettings: () => settings,
  getQuality: () => quality,
  getTheme: () => theme,
  getDesign: () => editorDesign,
  getCover: () => cover,
  getUserPresets: () => userPresetPreferences[presetPreferenceKey(editorDesign)],
  onUserPresetsChange: next => {
    const key = presetPreferenceKey(editorDesign);
    userPresetPreferences = { ...userPresetPreferences, [key]: normalizeCaseUserPresets(next) };
    localStorage.setItem("fixture-punk-preferences", JSON.stringify(userPresetPreferences));
    userPresetChangeCounts[editorDesign]++;
  },
  onChange: next => {
    settings = structuredClone(next);
    settingsByDesign[editorDesign] = structuredClone(next);
    changes.push(structuredClone(next));
  },
});

function expect(condition, message) { if (!condition) throw new Error(message); }
function serializeSettings(value) { return JSON.parse(JSON.stringify(value)); }
function createSyntheticTestCover(size = 584) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for the synthetic album cover.");
  context.fillStyle = "#09111b";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#ee653e";
  context.beginPath();
  context.moveTo(0, 0); context.lineTo(size * 0.34, 0); context.lineTo(0, size * 0.34);
  context.closePath(); context.fill();
  context.fillStyle = "#22c9bf";
  context.beginPath();
  context.moveTo(size, size * 0.54); context.lineTo(size, size); context.lineTo(size * 0.54, size);
  context.closePath(); context.fill();
  context.strokeStyle = "#ee653e";
  context.lineWidth = Math.max(8, size * 0.022);
  context.beginPath(); context.moveTo(size * 0.12, size * 0.72); context.lineTo(size * 0.7, size * 0.14); context.stroke();
  context.fillStyle = "#0b1018";
  context.fillRect(size * 0.43, size * 0.43, size * 0.14, size * 0.14);
  context.fillStyle = "#f3eee1";
  context.textAlign = "left";
  context.font = "700 " + Math.round(size * 0.075) + "px sans-serif";
  context.fillText("FIELD NOTES", size * 0.1, size * 0.57);
  context.font = "600 " + Math.round(size * 0.037) + "px sans-serif";
  context.fillText("NIGHT DRIVE / TEST PRESSING 01", size * 0.1, size * 0.64);
  context.fillStyle = "#22c9bf";
  context.font = "700 " + Math.round(size * 0.045) + "px sans-serif";
  context.fillText("LOCAL AUDIO", size * 0.1, size * 0.85);
  return canvas;
}
function materialSnapshot(root) {
  const values = [];
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    if (material instanceof THREE.MeshPhysicalMaterial) values.push({
      part: child.userData.casePart,
      surface: child.userData.surface,
      color: material.color.getHexString(),
      roughness: material.roughness,
      transmission: material.transmission,
      metalness: material.metalness,
      ior: material.ior,
      thickness: material.thickness,
      clearcoat: material.clearcoat,
      clearcoatRoughness: material.clearcoatRoughness,
      iridescence: material.iridescence,
      iridescenceIOR: material.iridescenceIOR,
      iridescenceThicknessRange: [...material.iridescenceThicknessRange],
      anisotropy: material.anisotropy,
      attenuationDistance: material.attenuationDistance,
      attenuationColor: material.attenuationColor.getHexString(),
      emissive: material.emissive.getHexString(),
      emissiveIntensity: material.emissiveIntensity,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      transparent: material.transparent,
      side: material.side,
      visible: material.visible,
      native: material.userData.caseNative ? structuredClone(material.userData.caseNative) : null,
    });
  });
  return values;
}

function partGeometrySnapshot(root, part) {
  const samples = [];
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.userData.casePart !== part) return;
    child.geometry.computeBoundingBox();
    const position = child.geometry.getAttribute("position");
    const normal = child.geometry.getAttribute("normal");
    const tangent = child.geometry.getAttribute("tangent");
    samples.push({
      positions: Array.from(position.array),
      normals: normal ? Array.from(normal.array) : [],
      tangents: tangent ? Array.from(tangent.array) : [],
      bounds: child.geometry.boundingBox ? [
        child.geometry.boundingBox.min.x, child.geometry.boundingBox.min.y, child.geometry.boundingBox.min.z,
        child.geometry.boundingBox.max.x, child.geometry.boundingBox.max.y, child.geometry.boundingBox.max.z,
      ] : [],
    });
  });
  return samples;
}

function partTangentHealth(root, part) {
  const meshes = [];
  let tangentVertexCount = 0;
  let finiteVertexCount = 0;
  let nonzeroVertexCount = 0;
  let zeroTangentVertexCount = 0;
  let invalidNormalVertexCount = 0;
  let maxAbsNormalizedNormalDot = 0;
  let minTangentLength = Infinity;
  let maxTangentLength = 0;
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.userData.casePart !== part) return;
    const tangent = child.geometry.getAttribute("tangent");
    const normal = child.geometry.getAttribute("normal");
    const count = Math.min(tangent?.count ?? 0, normal?.count ?? 0);
    let meshFinite = 0;
    let meshNonzero = 0;
    let meshMaxAbsDot = 0;
    for (let index = 0; index < count; index++) {
      const tx = tangent.getX(index), ty = tangent.getY(index), tz = tangent.getZ(index);
      const tw = tangent.itemSize > 3 ? tangent.getW(index) : 1;
      const nx = normal.getX(index), ny = normal.getY(index), nz = normal.getZ(index);
      if (![tx, ty, tz, tw, nx, ny, nz].every(Number.isFinite)) continue;
      meshFinite++;
      const tangentLength = Math.hypot(tx, ty, tz);
      const normalLength = Math.hypot(nx, ny, nz);
      minTangentLength = Math.min(minTangentLength, tangentLength);
      maxTangentLength = Math.max(maxTangentLength, tangentLength);
      if (tangentLength <= 1e-6 || normalLength <= 1e-6) {
        if (tangentLength <= 1e-6) zeroTangentVertexCount++;
        if (normalLength <= 1e-6) invalidNormalVertexCount++;
        continue;
      }
      meshNonzero++;
      meshMaxAbsDot = Math.max(meshMaxAbsDot,
        Math.abs((tx * nx + ty * ny + tz * nz) / (tangentLength * normalLength)));
    }
    tangentVertexCount += count;
    finiteVertexCount += meshFinite;
    nonzeroVertexCount += meshNonzero;
    maxAbsNormalizedNormalDot = Math.max(maxAbsNormalizedNormalDot, meshMaxAbsDot);
    meshes.push({
      mesh: child.name || child.userData.surface || "frame mesh",
      tangentPresent: !!tangent,
      normalPresent: !!normal,
      tangentItemSize: tangent?.itemSize ?? 0,
      tangentCount: tangent?.count ?? 0,
      normalCount: normal?.count ?? 0,
      finiteVertexCount: meshFinite,
      nonzeroVertexCount: meshNonzero,
      maxAbsNormalizedNormalDot: Number(meshMaxAbsDot.toExponential(4)),
    });
  });
  const meshCount = meshes.length;
  const tangentMeshCount = meshes.filter(mesh => mesh.tangentPresent && mesh.normalPresent &&
    mesh.tangentCount === mesh.normalCount).length;
  return {
    part,
    meshCount,
    tangentMeshCount,
    missingTangentMeshes: meshCount - tangentMeshCount,
    tangentVertexCount,
    finiteVertexCount,
    nonFiniteVertexCount: tangentVertexCount - finiteVertexCount,
    nonzeroVertexCount,
    zeroTangentVertexCount,
    invalidNormalVertexCount,
    maxAbsNormalizedNormalDot: Number(maxAbsNormalizedNormalDot.toExponential(4)),
    minTangentLength: Number.isFinite(minTangentLength) ? Number(minTangentLength.toFixed(6)) : null,
    maxTangentLength: Number(maxTangentLength.toFixed(6)),
    meshes,
  };
}

function partBoundsSnapshot(root) {
  root.updateMatrixWorld(true);
  const bounds = new Map();
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh) || !child.userData.casePart) return;
    const box = new THREE.Box3().setFromObject(child);
    const aggregate = bounds.get(child.userData.casePart) ?? new THREE.Box3();
    aggregate.union(box);
    bounds.set(child.userData.casePart, aggregate);
  });
  return Object.fromEntries([...bounds].map(([part, box]) => [part, {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: box.getSize(new THREE.Vector3()).toArray(),
  }]));
}

function legacyPresetSurfaces(id) {
  const snapshot = LEGACY_PUNK_PRESET_FIXTURE.presets[id];
  if (!snapshot) throw new Error("Missing embedded legacy Punk preset: " + id);
  return Object.fromEntries(Object.entries(snapshot).map(([part, values]) => {
    const surface = Object.fromEntries(LEGACY_PUNK_PRESET_FIXTURE.fields.map((field, index) => [field, values[index]]));
    surface.preserveSource = false;
    return [part, surface];
  }));
}

function revisionTwoAuroraSurfaces() {
  return Object.fromEntries(Object.entries(REVISION_TWO_AURORA_FIXTURE.surfaces).map(([part, values]) => [
    part,
    Object.fromEntries(REVISION_TWO_AURORA_FIXTURE.fields.map((field, index) => [field, values[index]])),
  ]));
}

function hashRevisionTwoAurora(surfaces) {
  const fields = REVISION_TWO_AURORA_FIXTURE.fields;
  const serialized = JSON.stringify(Object.keys(surfaces).sort().map(part => [part,
    ...fields.map(field => typeof surfaces[part]?.[field] === "string" ? surfaces[part][field].toLowerCase() : surfaces[part]?.[field] ?? null),
  ]));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) { hash ^= serialized.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function revisionThreeAuroraSurfaces() {
  return Object.fromEntries(Object.entries(REVISION_THREE_AURORA_FIXTURE.surfaces).map(([part, values]) => [
    part,
    Object.fromEntries(REVISION_THREE_AURORA_FIXTURE.fields.map((field, index) => [field, values[index]])),
  ]));
}

function hashRevisionThreeAurora(surfaces) {
  const fields = REVISION_THREE_AURORA_FIXTURE.fields;
  const serialized = JSON.stringify(Object.keys(surfaces).sort().map(part => [part,
    ...fields.map(field => typeof surfaces[part]?.[field] === "string" ? surfaces[part][field].toLowerCase() : surfaces[part]?.[field] ?? null),
  ]));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) { hash ^= serialized.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function sameSurfaceFields(left, right, fields) {
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(part =>
    fields.every(field => {
      const a = left[part]?.[field], b = right[part]?.[field];
      return typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : Object.is(a, b);
    }));
}

function legacySurfaceFingerprint(surfaces) {
  const serialized = JSON.stringify(Object.keys(surfaces).sort().map(part => {
    const surface = surfaces[part] ?? {};
    return [part, ...LEGACY_PUNK_PRESET_FIXTURE.fields.map(field =>
      typeof surface[field] === "string" ? surface[field].toLowerCase() : surface[field] ?? null)];
  }));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function surfaceFingerprint(surfaces) {
  return JSON.stringify(Object.keys(surfaces).sort().map(part => [part,
    ...LEGACY_PUNK_PRESET_FIXTURE.fields.map(field => {
      const value = surfaces[part]?.[field];
      return typeof value === "string" ? value.toLowerCase() : value ?? null;
    })]));
}

function snapshotDelta(left, right, field) {
  if (left.length !== right.length) return Infinity;
  let maximum = 0;
  for (let mesh = 0; mesh < left.length; mesh++) {
    const a = left[mesh][field], b = right[mesh][field];
    if (a.length !== b.length) return Infinity;
    for (let index = 0; index < a.length; index++) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  }
  return maximum;
}

function nativeMaterialRestored(actual, before) {
  const equalNumber = (actualValue, nativeValue) => Object.is(actualValue, nativeValue) ||
    (Number.isFinite(actualValue) && Number.isFinite(nativeValue) && Math.abs(actualValue - nativeValue) < 1e-6);
  return actual.length === before.length && actual.every((surface, index) => {
    const native = before[index]?.native;
    if (!native) return false;
    const color = native.color?.replace(/^#/u, "").toLowerCase();
    const attenuationColor = native.attenuationColor?.replace(/^#/u, "").toLowerCase();
    const emissive = native.emissive?.replace(/^#/u, "").toLowerCase();
    const thicknessRange = native.iridescenceThicknessRange ?? [100, 400];
    return surface.color === color && surface.attenuationColor === attenuationColor && surface.emissive === emissive &&
      surface.transparent === (native.transparent === true) && surface.side === (native.side ?? surface.side) &&
      surface.iridescenceThicknessRange.length === 2 && surface.iridescenceThicknessRange.every((value, rangeIndex) => equalNumber(value, thicknessRange[rangeIndex])) &&
      ["roughness", "metalness", "transmission", "ior", "thickness", "attenuationDistance", "clearcoat", "clearcoatRoughness", "iridescence", "iridescenceIOR", "anisotropy", "emissiveIntensity", "opacity", "alphaTest"]
        .every(field => equalNumber(surface[field], native[field]));
  });
}

function sceneCaseSettings(structure) {
  const value = defaultCaseSettings("rhine");
  value.enabled = true;
  value.structure = structure;
  return value;
}

function sceneMaterialIds(root) {
  const values = [];
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if ((material instanceof THREE.MeshPhysicalMaterial && child.userData.casePart) || child.userData.albumInsert || child.userData.albumCover)
        values.push(material.uuid);
    }
  });
  return [...new Set(values)].sort();
}

function stepArchiveScene(frames = 4) {
  for (let index = 0; index < frames; index++) {
    archiveTime += 1 / 60;
    archiveScene.update(archiveTime);
  }
}

function archiveSceneSummary() {
  const scene = archiveScene;
  const covers = scene?.covers;
  const parts = scene?.model.children.filter(child => child.userData.casePart).map(child => child.userData.casePart).sort() ?? [];
  const instanceParts = scene?.instances.map(instance => instance.userData.casePart).filter(Boolean).sort() ?? [];
  const flagsFor = root => {
    const flags = [];
    root?.traverse(child => { if (child.userData?.caseAlbumWindow) flags.push(child.userData.caseAlbumPresent === true); });
    return flags;
  };
  const modelOcclusionFlags = scene ? flagsFor(scene.model) : [];
  const selectedInsertPresent = !!scene?.model.visible && covers?.selectedInsert.visible === true;
  const instanceOcclusion = scene?.instances.map(instance => ({
    part: instance.userData.casePart ?? "",
    visible: instance.visible,
    flags: flagsFor(instance),
    expectedPresent: covers?.arrayInsert.visible === true && instance.visible,
  })) ?? [];
  const occlusionInstances = instanceOcclusion.filter(item => item.flags.length > 0);
  return {
    loaded: !!scene?.loaded,
    count: scene?.positions.length ?? 0,
    caseGeometryKey: scene?.caseGeometryKey ?? "",
    caseStructure: scene?.caseSettings?.structure ?? "",
    modelParts: parts,
    instanceCount: scene?.instances.length ?? 0,
    instanceParts,
    coverAtlasVisible: !!covers?.array.visible,
    coverAtlasRetained: !!covers && covers === retainedCoverAtlas && covers.array === retainedCoverAtlas?.array && covers.selected === retainedCoverAtlas?.selected,
    positionsRetained: !!scene && scene.positions === retainedPositions,
    selectionLighting: !!scene?.selectionLighting,
    outgoingCount: scene?.outgoing.length ?? 0,
    drawCalls: scene?.renderer.info.render.calls ?? 0,
    selectedSlot: scene?.selectedSlot ?? -1,
    materialUuids: scene ? sceneMaterialIds(scene.model) : [],
    insertThickness: covers?.insertThickness ?? 0,
    arrayInsertVisible: covers?.arrayInsert.visible ?? false,
    selectedInsertVisible: covers?.selectedInsert.visible ?? false,
    modelOcclusionFlags: [...new Set(modelOcclusionFlags)],
    modelOcclusionMatchesSelectedInsert: modelOcclusionFlags.length > 0 && modelOcclusionFlags.every(flag => flag === selectedInsertPresent),
    instanceOcclusion,
    allInstanceOcclusionMatchesArrayInsert: occlusionInstances.length > 0 && occlusionInstances.every(item => item.flags.every(flag => flag === item.expectedPresent)),
    arrayInsertMaterialUuid: covers?.arrayInsert.material.uuid ?? "",
    selectedInsertMaterialUuid: covers?.selectedInsert.material.uuid ?? "",
    styleError: archiveStyleError,
  };
}

async function setupArchiveScene() {
  if (archiveScene) throw new Error("ArchiveScene fixture is already initialized.");
  const albums = Array.from({ length: 8 }, (_, index) => ({
    id: "offline-case-" + index,
    title: "Offline Case " + String(index + 1).padStart(2, "0"),
    artist: "Fixture Artist " + (index % 2 + 1),
    year: 2000 + index,
    genreId: index % 2 ? "fixture-b" : "fixture-a",
    rawGenres: ["Offline fixture"],
    folder: "offline-fixture/album-" + index,
    tracks: [],
    producers: [],
    offline: true,
  }));
  setMusicAlbums(albums, [
    { id: "fixture-a", name: "Fixture A" },
    { id: "fixture-b", name: "Fixture B" },
  ], "genre");
  archiveHost = document.createElement("div");
  archiveHost.id = "scene-host";
  archiveHost.className = "music-app";
  archiveHost.dataset.design = "rhine";
  archiveHost.dataset.page = "music";
  archiveHost.dataset.layout = "desktop";
  archiveHost.style.cssText = "position:relative;width:1450px;height:840px;background:#07111f;margin-top:28px";
  document.body.append(archiveHost);
  archiveScene = new ArchiveScene(archiveHost);
  archiveScene.onStyleError = message => { archiveStyleError = message; };
  archiveScene.setMusicStyle({ ...defaultMusicStyle, design: "rhine" });
  archiveScene.enableSelectionLighting();
  await archiveScene.load();
  archiveScene.setQuality({
    ...qualityPresets.original,
    wave: "full",
    modelDetail: "medium",
    lighting: "high",
    scale: 80,
    pixelRatio: 1,
    aoSamples: 0,
    depthOfField: 0,
  });
  await archiveScene.setCaseSettings(sceneCaseSettings("minimal"));
  archiveTime = performance.now() / 1000;
  archiveScene.showMusicArchiveImmediately(archiveTime);
  stepArchiveScene(5);
  retainedCoverAtlas = archiveScene.covers;
  retainedPositions = archiveScene.positions;
  return { ...archiveSceneSummary(), albumCount: albums.length, coverUrlMissing: albums.every(album => !album.coverUrl) };
}

async function changeArchiveStructure(structure) {
  await archiveScene.setCaseSettings(sceneCaseSettings(structure));
  stepArchiveScene(5);
  if (structure === "rhine") {
    const source = archiveScene.renderer.domElement;
    archiveSceneCapture = document.createElement("canvas");
    archiveSceneCapture.width = source.width;
    archiveSceneCapture.height = source.height;
    const context = archiveSceneCapture.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, archiveSceneCapture.width, archiveSceneCapture.height).data;
    const colors = new Set();
    let nonBackground = 0;
    for (let index = 0; index < pixels.length; index += 4 * 257) {
      const color = pixels[index] + "," + pixels[index + 1] + "," + pixels[index + 2];
      colors.add(color);
      if (pixels[index] > 35 || pixels[index + 1] > 35 || pixels[index + 2] > 35) nonBackground++;
    }
    archiveSceneCaptureStats = { width: archiveSceneCapture.width, height: archiveSceneCapture.height, sampledColors: colors.size, nonBackgroundSamples: nonBackground };
  }
  return archiveSceneSummary();
}

function archiveMaterialGroups() {
  const groups = [{ name: "selected", root: archiveScene.model }, ...archiveScene.outgoing.map((item, index) => ({ name: "outgoing-" + index, root: item.group }))];
  return groups.map(group => ({ name: group.name, ids: sceneMaterialIds(group.root) }));
}

function materialGroupsAreIndependent(groups) {
  for (let left = 0; left < groups.length; left++) {
    for (let right = left + 1; right < groups.length; right++) {
      if (groups[left].ids.some(id => groups[right].ids.includes(id))) return false;
    }
  }
  return true;
}

function exerciseArchiveSelection() {
  archiveTime = performance.now() / 1000;
  archiveScene.showMusicArchiveImmediately(archiveTime);
  archiveScene.select(1);
  stepArchiveScene(2);
  archiveScene.select(2);
  stepArchiveScene(2);
  archiveScene.select(3);
  stepArchiveScene(2);
  const beforeGroups = archiveMaterialGroups();
  const originalIds = sceneMaterialIds(archiveScene.model);
  const outgoingSlots = archiveScene.outgoing.map(item => item.slot);
  const returningTarget = archiveScene.outgoing[0];
  const targetSlot = returningTarget?.slot ?? -1;
  const targetCell = returningTarget ? { ...returningTarget.cell } : null;
  const targetIndex = targetCell ? musicSpatialEntry(targetCell, archiveScene.shelfView)?.recordIndex ?? -1 : -1;
  const beforeCount = archiveScene.outgoing.length;
  if (targetIndex >= 0 && targetCell) archiveScene.select(targetIndex, { cell: targetCell });
  stepArchiveScene(2);
  const afterGroups = archiveMaterialGroups();
  return {
    outgoingBeforeReturn: beforeCount,
    outgoingAfterReturn: archiveScene.outgoing.length,
    outgoingSlots,
    targetSlot,
    returningCopyRemoved: targetIndex >= 0 && !archiveScene.outgoing.some(item => item.cell.lane === targetCell?.lane && item.cell.row === targetCell?.row),
    materialGroupsIndependent: materialGroupsAreIndependent(beforeGroups) && materialGroupsAreIndependent(afterGroups),
    originalMaterialIdsRetained: JSON.stringify(originalIds) === JSON.stringify(sceneMaterialIds(archiveScene.model)),
    beforeGroups,
    afterGroups,
    summary: archiveSceneSummary(),
  };
}

async function exerciseCardLifecycle() {
  const atlas = archiveScene?.covers;
  if (!atlas?.selectedInsert || !atlas?.arrayInsert) throw new Error("ArchiveScene must expose its paper insert atlas for lifecycle checks.");
  const fixtureAlbums = records.flatMap(record => record.album ? [record.album] : []);
  const fixtureGenres = [{ id: "fixture-a", name: "Fixture A" }, { id: "fixture-b", name: "Fixture B" }];
  if (fixtureAlbums.length !== 8) throw new Error("Scene lifecycle requires all eight synthetic offline albums before toggling the real library state.");
  const previousArrayVisible = atlas.array.visible;
  const previousSelectedVisible = atlas.selected.visible;
  atlas.setVisibility(true, true);
  const insertThickness = atlas.insertThickness;
  const insertsVisibleWithCovers = atlas.arrayInsert.visible && atlas.selectedInsert.visible;
  atlas.setVisibility(false, false);
  const insertsHiddenWithCovers = !atlas.arrayInsert.visible && !atlas.selectedInsert.visible;
  atlas.setVisibility(previousArrayVisible, previousSelectedVisible);

  setMusicAlbums([], fixtureGenres, "genre");
  await archiveScene.refreshLibrary(0);
  stepArchiveScene(2);
  const sceneWithoutAlbums = archiveSceneSummary();
  setMusicAlbums(fixtureAlbums, fixtureGenres, "genre");
  await archiveScene.refreshLibrary(0);
  stepArchiveScene(2);
  const sceneWithAlbums = archiveSceneSummary();

  const layout = { ...atlas.layout };
  if (!(insertThickness > 0)) throw new Error("Punk ArchiveScene must supply a positive paper insert thickness.");
  const album = {
    id: "offline-viewer-insert-lifecycle",
    title: "Offline Viewer Insert",
    artist: "Fixture Artist",
    year: 2026,
    genreId: "fixture-a",
    rawGenres: ["Offline fixture"],
    folder: "offline-fixture/viewer-insert",
    tracks: [],
    producers: [],
    offline: true,
  };
  const viewer = new ViewerAlbumCover(album, 1, layout, insertThickness);
  const viewerInsert = viewer.insert;
  if (!viewerInsert) throw new Error("ViewerAlbumCover must create its opaque paper insert for Punk.");
  const selectedMaterial = atlas.selectedInsert.material;
  const arrayMaterial = atlas.arrayInsert.material;
  const viewerMaterial = viewerInsert.material;
  const templateDisposeCount = { selected: 0, array: 0, viewer: 0 };
  selectedMaterial.addEventListener("dispose", () => templateDisposeCount.selected++);
  arrayMaterial.addEventListener("dispose", () => templateDisposeCount.array++);
  viewerMaterial.addEventListener("dispose", () => templateDisposeCount.viewer++);
  const parent = new THREE.Group();
  parent.add(viewer.mesh, viewerInsert);
  await viewer.ready;
  const independentMaterials = viewerMaterial.uuid !== selectedMaterial.uuid && viewerMaterial.uuid !== arrayMaterial.uuid;
  viewer.dispose();
  return {
    insertThickness,
    insertsVisibleWithCovers,
    insertsHiddenWithCovers,
    actualSceneOcclusionSync: {
      noAlbums: sceneWithoutAlbums,
      restoredAlbums: sceneWithAlbums,
    },
    selectedArrayMaterialsIndependent: selectedMaterial.uuid !== arrayMaterial.uuid,
    viewerMaterialIndependent: independentMaterials,
    viewerDetachedAfterDispose: viewer.mesh.parent === null && viewerInsert.parent === null,
    viewerMarkedDisposed: viewer.mesh.userData.coverDisposed === true,
    viewerMaterialDisposed: templateDisposeCount.viewer === 1,
    atlasMaterialsNotDisposed: templateDisposeCount.selected === 0 && templateDisposeCount.array === 0,
    atlasMaterialDisposals: templateDisposeCount,
  };
}

async function raceArchiveStructures() {
  const requests = [
    archiveScene.setCaseSettings(sceneCaseSettings("minimal")),
    archiveScene.setCaseSettings(sceneCaseSettings("rhine")),
    archiveScene.setCaseSettings(sceneCaseSettings("punk")),
  ];
  await Promise.all(requests);
  stepArchiveScene(5);
  return archiveSceneSummary();
}

/** Test the live paper/print and shell shaders, without the retired sprite provider. */
async function captureScenePaperProtection() {
  const saved = structuredClone(archiveScene.caseSettings);
  const record = records.find(item => item.album?.id === archiveScene.getStats().selectedAlbumId);
  expect(!!record, "Paper protection requires the selected canonical synthetic album.");
  const artwork = createSyntheticTestCover(512).toDataURL("image/png");
  await archiveScene.covers.select({ ...record, album: { ...record.album, coverUrl: artwork } });
  archiveScene.setReduced(true);
  archiveScene.setMode("detail");
  for (let frame = 0; frame < 120 && !archiveScene.musicPresentationReady; frame++) stepArchiveScene(1);
  expect(archiveScene.musicPresentationReady, "Paper protection must capture a settled real detail pose.");
  const capture = () => {
    stepArchiveScene(2);
    const canvas = document.createElement("canvas"), source = archiveScene.renderer.domElement;
    canvas.width = source.width; canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    return canvas;
  };
  const sample = canvas => {
    const cover = archiveScene.caseLayout.cover;
    const point = archiveScene.model.localToWorld(new THREE.Vector3(cover.x, cover.y, cover.z)).project(archiveScene.camera);
    return Array.from(canvas.getContext("2d").getImageData(Math.round((point.x + 1) * canvas.width / 2),
      Math.round((1 - point.y) * canvas.height / 2), 1, 1).data);
  };
  const flags = () => {
    const values = [];
    archiveScene.model.traverse(child => { if (child.userData.caseAlbumWindow) values.push(child.userData.caseAlbumPresent === true); });
    return [...new Set(values)];
  };
  try {
    const withBack = color => {
      const value = structuredClone(saved);
      const appearance = value.appearances.punk;
      appearance.preset = "custom";
      appearance.surfaces.back = { ...appearance.surfaces.back, finish: "paint", color, secondaryColor: color,
        pattern: "none", transmission: 0, metalness: 0, emission: 0, preserveSource: false };
      return value;
    };
    await archiveScene.setCaseSettings(withBack("#ff0000"));
    const red = capture(), redPixel = sample(red);
    const presentFlags = flags();
    await archiveScene.setCaseSettings(withBack("#00ff00"));
    const green = capture(), greenPixel = sample(green);
    const coverDelta = Math.hypot(...redPixel.slice(0, 3).map((value, channel) => value - greenPixel[channel]));
    expect(coverDelta <= 8, "The real opaque paper/print must prevent saturated backing colors leaking into artwork: " + coverDelta);
    setCaseAlbumOcclusion(archiveScene.model, false);
    const offFlags = flags(), off = capture();
    const a = green.getContext("2d").getImageData(0, 0, green.width, green.height).data;
    const b = off.getContext("2d").getImageData(0, 0, off.width, off.height).data;
    let changedPixels = 0, darkenedPixels = 0;
    for (let index = 0; index < a.length; index += 4) {
      const delta = Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]);
      if (delta > 3) changedPixels++;
      if (b[index] + b[index + 1] + b[index + 2] - a[index] - a[index + 1] - a[index + 2] > 3) darkenedPixels++;
    }
    expect(presentFlags.length === 1 && presentFlags[0] && offFlags.length === 1 && !offFlags[0] &&
      archiveScene.covers.selectedInsert.visible && archiveScene.covers.selected.visible,
      "The API-only occlusion A/B must retain the actual physical paper and textured print in both captures.");
    expect(changedPixels > 0 && darkenedPixels > 0, "Real shell pixels must respond to the production album-occlusion API.");
    const contact = document.createElement("canvas"); contact.width = red.width * 3; contact.height = red.height;
    const context = contact.getContext("2d"); context.drawImage(red, 0, 0); context.drawImage(green, red.width, 0); context.drawImage(off, red.width * 2, 0);
    return { renderer: "ArchiveScene WebGL", coverDelta, redPixel, greenPixel, presentFlags, offFlags,
      changedPixels, darkenedPixels, realPaperRetained: true, image: contact.toDataURL("image/png") };
  } finally {
    await archiveScene.setCaseSettings(saved);
    await archiveScene.covers.select(record);
    archiveScene.setMode("archive");
    for (let frame = 0; frame < 120 && !archiveScene.musicArchiveReady; frame++) stepArchiveScene(1);
  }
}

const unifiedClicks = [], unifiedOpens = [];
let unifiedTrack;
let unifiedStyle;
function unifiedSnapshot() {
  const scene = archiveScene;
  const matrix = new THREE.Matrix4();
  const projectCell = cell => {
    const index = scene.cells.findIndex(value => value.lane === cell.lane && value.row === cell.row);
    let point;
    if (index >= 0 && scene.shelfView) {
      scene.caseHitProxy.getMatrixAt(index, matrix);
      point = new THREE.Vector3(matrix.elements[12], matrix.elements[13], matrix.elements[14]).project(scene.camera);
    } else point = scene.cellPosition(cell).add(new THREE.Vector3(-scene.columnCamera.value, 0, scene.rail.value)).project(scene.camera);
    return { x: (point.x + 1) * archiveHost.clientWidth / 2, y: (1 - point.y) * archiveHost.clientHeight / 2 };
  };
  const valid = scene.cells.flatMap((cell, index) => {
    const entry = musicSpatialEntry(cell, scene.shelfView);
    if (!entry) return [];
    scene.caseHitProxy.getMatrixAt(index, matrix);
    return [{ index, key: entry.key, recordIndex: entry.recordIndex, lane: cell.lane, row: cell.row,
      drawn: matrix.elements[0] !== 0 || matrix.elements[5] !== 0 || matrix.elements[10] !== 0 }];
  });
  scene.scene.updateMatrixWorld(true);
  const resources = scene.sceneResources?.group;
  const tray = resources?.getObjectByName("Record shelf tray");
  const corners = [];
  for (const x of [scene.caseLayout.bounds.min[0], scene.caseLayout.bounds.max[0]])
    for (const y of [scene.caseLayout.bounds.min[1], scene.caseLayout.bounds.max[1]])
      for (const z of [scene.caseLayout.bounds.min[2], scene.caseLayout.bounds.max[2]]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(scene.model.matrixWorld).project(scene.camera);
        corners.push({ x: (point.x + 1) * archiveHost.clientWidth / 2, y: (1 - point.y) * archiveHost.clientHeight / 2 });
      }
  const support = [];
  if (tray) {
    tray.geometry.computeBoundingBox(); scene.caseHitProxy.geometry.computeBoundingBox();
    for (const item of valid.filter(item => item.drawn)) {
      scene.caseHitProxy.getMatrixAt(item.index, matrix);
      const caseBox = scene.caseHitProxy.geometry.boundingBox.clone().applyMatrix4(matrix);
      tray.getMatrixAt(item.index, matrix);
      const trayBox = tray.geometry.boundingBox.clone().applyMatrix4(matrix).applyMatrix4(tray.matrixWorld);
      const caseCenter = caseBox.getCenter(new THREE.Vector3()), trayCenter = trayBox.getCenter(new THREE.Vector3());
      support.push({ key: item.key, caseBottom: caseBox.min.y, trayTop: trayBox.max.y, clearance: caseBox.min.y - trayBox.max.y,
        centerGapX: caseCenter.x - trayCenter.x, centerGapZ: caseCenter.z - trayCenter.z });
    }
  }
  return { stats: scene.getStats(), opacity: scene.renderer.domElement.style.opacity,
    clipPath: scene.renderer.domElement.style.clipPath, legacyRenderer: !!scene.foobarArchive,
    hostCanvasCount: archiveHost.querySelectorAll("canvas").length,
    labelNumber: scene.rhineInfo?.selectedLabel.userData.numberText,
    valid, modelVisible: scene.model.visible, coversVisible: scene.covers.array.visible,
    instancesVisible: scene.instances.some(instance => instance.visible),
    spacing: { ...scene.spatialSpacing }, caseLayout: structuredClone(scene.caseLayout),
    topTitles: { array: !!scene.caseTitles?.array.visible, selected: !!scene.caseTitles?.selected.visible,
      selectedText: scene.caseTitles?.selectedKey ?? "", count: scene.caseTitles?.array.count ?? 0 },
    projection: { origin: projectCell({ lane: 0, row: 12 }), lane: projectCell({ lane: 1, row: 12 }),
      row: projectCell({ lane: 0, row: 13 }) },
    resourceCapacity: scene.sceneResources?.capacity ?? 0, support,
    selectedScreenBounds: { minX: Math.min(...corners.map(point => point.x)), maxX: Math.max(...corners.map(point => point.x)),
      minY: Math.min(...corners.map(point => point.y)), maxY: Math.max(...corners.map(point => point.y)),
      availableWidth: scene.musicStyle.design === "archive" ? scene.displayViewportWidth : archiveHost.clientWidth },
    physicalTraysVisible: !!tray?.parent.visible,
    styleError: archiveStyleError };
}
function unifiedPointerTarget(selected = false, sameParent = false) {
  if (selected) {
    for (let frame = 0; frame < 90 && !archiveScene.musicArchiveReady; frame++) stepArchiveScene(1);
    expect(archiveScene.musicArchiveReady, "The real selection animation must settle before accepting album-open input.");
  }
  archiveScene.scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), point = new THREE.Vector3(), matrix = new THREE.Matrix4();
  if (selected) {
    point.copy(archiveScene.caseLayout.center).applyMatrix4(archiveScene.model.matrixWorld).project(archiveScene.camera);
    ray.setFromCamera(new THREE.Vector2(point.x, point.y), archiveScene.camera);
    const hit = ray.intersectObjects([archiveScene.caseHitProxy, archiveScene.model], true)[0];
    expect(hit && hit.instanceId === undefined, "The selected shelf case must remain a raycast target for double click.");
    return { x: (point.x + 1) * archiveHost.clientWidth / 2, y: (1 - point.y) * archiveHost.clientHeight / 2,
      index: unifiedClicks.at(-1)?.index ?? 0, key: archiveScene.selectedCell.foobarEntryKey };
  }
  for (let index = 0; index < archiveScene.cells.length; index++) {
    const entry = musicSpatialEntry(archiveScene.cells[index], true);
    if (!entry || entry.key === archiveScene.selectedCell.foobarEntryKey) continue;
    if (sameParent && entry.recordIndex !== musicSpatialEntry(archiveScene.selectedCell, true)?.recordIndex) continue;
    archiveScene.caseHitProxy.getMatrixAt(index, matrix);
    if (matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0) continue;
    point.copy(archiveScene.caseLayout.center).applyMatrix4(matrix).project(archiveScene.camera);
    const x = (point.x + 1) * archiveHost.clientWidth / 2, y = (1 - point.y) * archiveHost.clientHeight / 2;
    if (x < 35 || x > archiveScene.displayViewportWidth - 35 || y < 35 || y > archiveHost.clientHeight - 35) continue;
    ray.setFromCamera(new THREE.Vector2(point.x, point.y), archiveScene.camera);
    const hit = ray.intersectObjects([archiveScene.caseHitProxy, archiveScene.model], true)[0];
    if (hit?.instanceId !== index) continue;
    return { x, y, index: entry.recordIndex, key: entry.key };
  }
  // A lifted selection can cover case centers while a neighboring spine remains visible.
  for (let y = 35; y < archiveHost.clientHeight - 35; y += 12) for (let x = 35; x < archiveScene.displayViewportWidth - 35; x += 12) {
    ray.setFromCamera(new THREE.Vector2(x * 2 / archiveHost.clientWidth - 1, 1 - y * 2 / archiveHost.clientHeight), archiveScene.camera);
    const hit = ray.intersectObjects([archiveScene.caseHitProxy, archiveScene.model], true)[0];
    if (hit?.instanceId === undefined) continue;
    const entry = musicSpatialEntry(archiveScene.cells[hit.instanceId], true);
    if (!entry || entry.key === archiveScene.selectedCell.foobarEntryKey ||
      (sameParent && entry.recordIndex !== musicSpatialEntry(archiveScene.selectedCell, true)?.recordIndex)) continue;
    return { x, y, index: entry.recordIndex, key: entry.key, sample: "visible raycast spine" };
  }
  throw new Error("No unselected finite shelf case has a visible production raycast target.");
}
async function unifiedRenderVariant(design, mode, scheme = "archive") {
  unifiedStyle = { ...(design === "archive" ? archiveMusicStyle : defaultMusicStyle), shelf: design === "archive", floor: "deck",
    ...(design === "archive" ? { scheme } : {}) };
  archiveHost.dataset.design = design;
  archiveHost.dataset.foobarLayout = "array";
  archiveHost.style.background = design === "archive" ? stylePalette(unifiedStyle, mode).bg : mode === "night" ? "#07111f" : "#eae5e1";
  configureMusicCatalog({ layout: "shelf" });
  archiveScene.setMusicStyle(unifiedStyle);
  archiveScene.setTheme(mode);
  const value = sceneCaseSettings(design === "archive" ? "punk" : "rhine");
  if (design === "archive") { value.enabled = false; value.appearances.punk = casePreset("glass", "punk"); }
  await archiveScene.setCaseSettings(value);
  await archiveScene.rhineInfo?.ready;
  focusMusicEntry(unifiedTrack.key);
  archiveScene.select(unifiedTrack.recordIndex);
  stepArchiveScene(6);
  const result = unifiedSnapshot();
  expect(result.stats.displayLayout.effective === "shelf" && result.stats.displayLayout.canvas === "shelf",
    "Both themes must implement the requested physical shelf.");
  expect(result.opacity === "1" && !result.legacyRenderer && result.hostCanvasCount === 1,
    "A shelf must render through the sole ArchiveScene WebGL canvas without a legacy overlay.");
  expect(result.labelNumber === "NO.001", "A non-first TRACKS box keeps its canonical parent number.");
  expect(new Set(result.valid.map(item => item.key)).size === result.valid.length,
    "Finite shelf instances must not repeat display entries.");
  expect(result.valid.length === 29, "All twenty plus nine synthetic track entries have one finite cell.");
  expect(result.projection.lane.x < result.projection.origin.x && result.projection.lane.y < result.projection.origin.y &&
    result.projection.row.x > result.projection.origin.x && result.projection.row.y < result.projection.origin.y,
    "The native shelf axes keep the next lane left/up and the next slot right/up on screen.");
  expect(!result.styleError, "The unified scene must not report a style resource error.");
  expect(result.resourceCapacity >= archiveScene.positions.length && result.support.length > 0,
    "Physical shelf trays must cover the already allocated scene instance pool.");
  expect(result.physicalTraysVisible, "Future's default shelf:false appearance still provides its requested physical shelf layout.");
  expect(result.selectedScreenBounds.minX >= 10 && result.selectedScreenBounds.maxX <= result.selectedScreenBounds.availableWidth - 10,
    "The entire selected shelf case must remain inside its real visible width with a ten-pixel margin: " + JSON.stringify(result.selectedScreenBounds));
  expect(result.support.every(item => item.clearance >= -0.001),
    "Every actual case bound must clear its physical tray: " + JSON.stringify(result.support.filter(item => item.clearance < -0.001)));
  expect(result.topTitles.array === unifiedStyle.topTitles && result.topTitles.selected === unifiedStyle.topTitles,
    "The shelf title-strip visibility must follow the user's theme appearance setting.");
  if (unifiedStyle.topTitles) expect(result.topTitles.selectedText === unifiedTrack.record.title,
    "A shelf title strip uses the selected track title rather than its parent's album title.");
  if (design === "archive") expect(archiveScene.caseSettings.enabled && archiveScene.caseSettings.structure === "punk" &&
    !archiveScene.rhineInfo.selectedBadge.visible && !archiveScene.rhineInfo.arrayBadge.visible,
    "Legacy disabled Punk settings remain enabled with full parent labels and no format badge overlays.");
  return result;
}
async function exerciseUnifiedRender() {
  await setupArchiveScene();
  window.caseCheck.editor.destroy();
  document.body.replaceChildren(archiveHost);
  document.body.style.cssText = "margin:0;padding:0;overflow:hidden";
  archiveHost.style.margin = "0";
  archiveHost.dataset.mode = "archive";
  const pane = document.createElement("aside");
  pane.className = "album-callout";
  pane.style.cssText = "position:absolute;right:24px;top:24px;width:456px;height:300px;pointer-events:auto";
  archiveHost.append(pane);
  const artwork = createSyntheticTestCover(512).toDataURL("image/png");
  const albums = records.slice(0, 2).map((record, index) => ({ ...record.album, coverUrl: artwork,
    tracks: Array.from({ length: index ? 5 : 24 }, (_, slot) => ({
      id: record.id + "-track-" + (slot + 1), albumId: record.id, title: "Synthetic Track " + (slot + 1),
      trackNumber: slot + 1, artist: record.album.artist, format: "FLAC", codec: "FLAC",
      sampleRate: 96000, bitsPerSample: 24, lossless: true, browserPlayable: true,
      audioUrl: "", relativePath: "", duration: 120,
    })) }));
  setMusicAlbums(albums, [{ id: "fixture-a", name: "Fixture A" }, { id: "fixture-b", name: "Fixture B" }], "genre");
  configureMusicCatalog({ layout: "shelf", show: "tracks", group: "none", sort: "added" }, "");
  unifiedTrack = getMusicDisplayEntries().filter(entry => entry.recordIndex === 0)[1];
  expect(!!unifiedTrack, "The synthetic catalog must expose a non-first track.");
  focusMusicEntry(unifiedTrack.key);
  archiveScene.setReduced(true);
  await archiveScene.refreshLibrary(0);
  archiveScene.showMusicArchiveImmediately(archiveTime);
  const atlas = archiveScene.covers, positions = archiveScene.positions;
  const audit = { pages: getMusicCatalogShelves().map(shelf => shelf.entryKeys.length), variants: {}, details: [] };
  expect(JSON.stringify(audit.pages) === "[20,9]", "Twenty-nine tracks must form two finite shelf pages.");
  for (const design of ["rhine", "archive"]) {
    audit.variants[design] = await unifiedRenderVariant(design, "day", "front");
    configureMusicCatalog({}, "no-synthetic-track-can-match-this"); stepArchiveScene(6);
    const empty = unifiedSnapshot();
    expect(!empty.modelVisible && !empty.coversVisible && !empty.instancesVisible && empty.valid.length === 0,
      "An empty public query hides all shelf cases and covers.");
    configureMusicCatalog({}, ""); stepArchiveScene(6);
    expect(archiveScene.model.visible && archiveScene.covers.array.visible && archiveScene.selectedCell.foobarEntryKey === unifiedTrack.key,
      "Clearing a query restores the same non-first track.");
    archiveScene.setMode("detail"); stepArchiveScene(8);
    for (const layout of ["array", "grid", "shelf"]) {
      configureMusicCatalog({ layout }); archiveScene.setMusicStyle(unifiedStyle); stepArchiveScene(8);
      const stats = archiveScene.getStats();
      expect(stats.selectedCell.foobarEntryKey === unifiedTrack.key && stats.musicPresentationPhase === "presented",
        "A layout switch must retain the non-first track and open presentation.");
      expect(archiveScene.covers === atlas && archiveScene.positions === positions, "Layout switches reuse atlas and instance allocation.");
      if (layout !== "shelf") expect(!archiveScene.caseTitles.array.visible && !archiveScene.caseTitles.selected.visible,
        "Array/grid inspection must not acquire shelf title-strip overlays.");
      audit.details.push({ design, layout, entryKey: stats.selectedCell.foobarEntryKey, phase: stats.musicPresentationPhase });
    }
    archiveScene.setMode("archive"); stepArchiveScene(8);
  }
  // Exercise the production transformed bounds before checking support/spacing.
  const beforeTransform = unifiedSnapshot();
  const transformed = sceneCaseSettings("punk");
  transformed.appearances.punk = casePreset("glass", "punk");
  transformed.appearances.punk.transforms = { frame: { visible: true, offset: [.8, -.1, .65], rotation: [0, 0, 0], scale: [1.15, 1.1, 1.2] } };
  await archiveScene.setCaseSettings(transformed); stepArchiveScene(6);
  audit.transformed = unifiedSnapshot();
  expect(Math.abs(audit.transformed.spacing.column) >= audit.transformed.caseLayout.width + .3 &&
    Math.abs(audit.transformed.spacing.row) >= audit.transformed.caseLayout.depth + .15,
    "Shelf spacing must clear the actually transformed user case bounds.");
  expect(audit.transformed.support.length > 0 && audit.transformed.support.every(item => item.clearance >= -0.001),
    "User part transforms must not sink actual case bounds through physical trays.");
  expect(Math.abs(audit.transformed.caseLayout.center.x - beforeTransform.caseLayout.center.x) > .15 &&
    Math.abs(audit.transformed.caseLayout.center.z - beforeTransform.caseLayout.center.z) > .15,
    "The asymmetric fixture must move both actual bounds-center axes enough to detect an origin-centered tray.");
  expect(audit.transformed.support.every(item => Math.abs(item.centerGapX) < .001 && Math.abs(item.centerGapZ) < .04),
    "Physical trays must follow asymmetric case bounds centers, allowing only the existing slight wave tilt: " +
      JSON.stringify(audit.transformed.support.filter(item => Math.abs(item.centerGapX) >= .001 || Math.abs(item.centerGapZ) >= .04)));
  const bounds = audit.transformed.selectedScreenBounds;
  expect(bounds.minX >= 10 && bounds.maxX <= bounds.availableWidth - 10 && bounds.minY >= 10 && bounds.maxY <= archiveHost.clientHeight - 10,
    "The full asymmetric selected case must remain inside the camera's visible stage: " + JSON.stringify(bounds));
  expect(audit.transformed.stats.selectedCell.foobarEntryKey === beforeTransform.stats.selectedCell.foobarEntryKey &&
    audit.transformed.stats.selectedAlbumId === beforeTransform.stats.selectedAlbumId,
    "Moving physical bounds centers cannot change the public entry or canonical parent identity.");
  const transformedCanvas = document.createElement("canvas");
  transformedCanvas.width = archiveScene.renderer.domElement.width; transformedCanvas.height = archiveScene.renderer.domElement.height;
  transformedCanvas.getContext("2d").drawImage(archiveScene.renderer.domElement, 0, 0);
  const transformedImage = transformedCanvas.toDataURL("image/png");
  archiveScene.setMode("detail"); stepArchiveScene(8);
  for (let frame = 0; frame < 90 && !archiveScene.musicPresentationReady; frame++) stepArchiveScene(1);
  audit.transformedDetail = unifiedSnapshot();
  const detailBounds = audit.transformedDetail.selectedScreenBounds;
  expect(audit.transformedDetail.stats.musicPresentationPhase === "presented" &&
    audit.transformedDetail.stats.selectedCell.foobarEntryKey === beforeTransform.stats.selectedCell.foobarEntryKey,
    "Opening the asymmetric case must preserve its track identity and reach the common presented state.");
  expect(detailBounds.minX >= 10 && detailBounds.maxX <= detailBounds.availableWidth - 10 &&
    detailBounds.minY >= 10 && detailBounds.maxY <= archiveHost.clientHeight - 10,
    "The full asymmetric case must remain visible after the common detail camera move: " + JSON.stringify(detailBounds));
  archiveScene.setMode("archive"); stepArchiveScene(8);
  await unifiedRenderVariant("archive", "day", "front");
  const paperProtection = await captureScenePaperProtection();
  archiveScene.onSelect = (index, cell) => {
    unifiedClicks.push({ index, cell });
    if (cell?.foobarEntryKey) focusMusicEntry(cell.foobarEntryKey);
    archiveScene.select(index, cell ? { cell } : undefined); stepArchiveScene(6);
  };
  archiveScene.onOpenAlbum = index => { unifiedOpens.push({ index, key: archiveScene.selectedCell.foobarEntryKey }); };
  return { audit, transformedImage, paperProtection, pointerTarget: unifiedPointerTarget() };
}

// Motion acceptance uses actual submitted matrices, independently of the rail helper.
function punkArrayMotionSnapshot() {
  const scene = archiveScene, matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), euler = new THREE.Euler();
  scene.scene.updateMatrixWorld(true);
  const tray = scene.sceneResources?.group.getObjectByName("Record shelf tray");
  const values = [];
  for (let index = 0; index < scene.cells.length; index++) {
    const cell = scene.cells[index], entry = musicSpatialEntry(cell, scene.shelfView);
    if (!entry) continue;
    scene.caseHitProxy.getMatrixAt(index, matrix);
    matrix.decompose(position, quaternion, scale); euler.setFromQuaternion(quaternion);
    const item = { index, key: entry.key, lane: cell.lane, row: cell.row, x: position.x, y: position.y, z: position.z,
      rotX: scale.x ? euler.x : null, drawn: scale.x !== 0, selected: entry.key === scene.selectedCell.foobarEntryKey };
    scene.covers.array.getMatrixAt(index, matrix);
    item.coverZ = matrix.elements[14];
    scene.covers.arrayInsert.getMatrixAt(index, matrix);
    item.insertZ = matrix.elements[14];
    scene.instances[0].getMatrixAt(index, matrix);
    item.shellZ = matrix.elements[14];
    if (tray?.parent.visible) {
      tray.getMatrixAt(index, matrix); matrix.premultiply(tray.matrixWorld);
      item.trayZ = matrix.elements[14] - scene.caseLayout.center.z;
    }
    values.push(item);
  }
  return { time: archiveTime, design: scene.musicStyle.design, layout: scene.displayLayout.effective,
    quality: scene.quality.wave, reduced: scene.reduced, selected: { ...scene.selectedCell },
    selectedModel: { x: scene.model.position.x, y: scene.model.position.y, z: scene.model.position.z,
      coverZ: scene.covers.selected.getWorldPosition(new THREE.Vector3()).z,
      insertZ: scene.covers.selectedInsert.getWorldPosition(new THREE.Vector3()).z },
    presentation: scene.getStats().musicPresentationPhase, targetDetail: scene.targetDetail,
    returnY: scene.returnY, outgoing: scene.outgoing.length, values };
}

let arrayMotionPrepare;
let arrayMotionSelect;
function arrayHoverSnapshot() {
  stepArchiveScene(100);
  const scene = archiveScene;
  return { y: scene.model.position.y, selected: { ...scene.selectedCell }, phase: scene.musicPresentationPhase,
    catalog: getMusicCatalogShelves().map(value => value.entryKeys.length), clicks: unifiedClicks.length, opens: unifiedOpens.length,
    bounds: unifiedSnapshot().selectedScreenBounds };
}
async function prepareArrayPointer(design) {
  await arrayMotionPrepare(design, "shelf", "full");
  arrayMotionSelect(0, 12); archiveScene.setReduced(true); stepArchiveScene(1); archiveScene.setReduced(false);
  for (let frame = 0; frame < 300 && !archiveScene.musicArchiveReady; frame++) stepArchiveScene(1);
  const selected = unifiedPointerTarget(true);
  const baseline = arrayHoverSnapshot(), other = unifiedPointerTarget(false, true);
  expect(baseline.phase === "archive", "Capture the hover baseline only after the real archive return has settled.");
  expect(other.index === musicSpatialEntry(archiveScene.selectedCell, true).recordIndex && other.key !== selected.key,
    "The hover exclusion target must be another TRACKS entry from the same parent album.");
  return { baseline, selected, other };
}
const arraySurfaceDisposed = [];
const arraySurfaceWatched = new Set();
async function arraySurfaceVariant(design, floor) {
  const scene = archiveScene;
  scene.setMusicStyle({ ...(design === "archive" ? archiveMusicStyle : defaultMusicStyle), shelf: true, floor });
  stepArchiveScene(100);
  const material = scene.floor.material, resources = scene.sceneResources;
  for (const texture of [material.map, material.roughnessMap, material.normalMap]) if (texture && !arraySurfaceWatched.has(texture.uuid)) {
    arraySurfaceWatched.add(texture.uuid); texture.addEventListener("dispose", () => arraySurfaceDisposed.push(texture.uuid));
  }
  const effectiveFloor = scene.musicStyle.floor;
  const detail = { design, floor, effectiveFloor, map: !!material.map, roughnessMap: !!material.roughnessMap, normalMap: !!material.normalMap,
    normalScale: material.normalScale?.toArray(), roughness: material.roughness, metalness: material.metalness,
    recessedBed: !!resources.group.getObjectByName("Record shelf recessed bed"), guides: !!resources.group.getObjectByName("Record shelf guide grooves"),
    floorPanelsVisible: resources.floorPanels?.visible, textures: [material.map?.uuid, material.roughnessMap?.uuid, material.normalMap?.uuid] };
  if (design === "rhine") expect(effectiveFloor === "plain", "Future retains its established normalized plain floor.");
  if (effectiveFloor === "plain" || effectiveFloor === "deck") {
    expect(detail.map && detail.roughnessMap && detail.normalMap, "Plain/deck floor uses its local color, roughness and normal textures: " + JSON.stringify(detail));
    const expected = effectiveFloor === "plain" ? [.1, .94, .025] : [.12, .76, .12];
    expect(Math.abs(detail.normalScale[0] - expected[0]) < 1e-12 && Math.abs(detail.roughness - expected[1]) < 1e-12 &&
      Math.abs(detail.metalness - expected[2]) < 1e-12, "Physical floor finish retains restrained surface parameters: " + JSON.stringify(detail));
    expect(detail.recessedBed && detail.guides && detail.floorPanelsVisible === false,
      "Common finite trays include their bed/guides while plain/deck avoid duplicate local floor panels: " + JSON.stringify(detail));
  } else expect(detail.floorPanelsVisible === true && !detail.map && !detail.normalMap && !detail.roughnessMap,
    "The real floor retains its existing wood panel layer and original background.");
  expect(arraySurfaceDisposed.length === 0, "Changing surface styles cannot dispose shared floor textures still owned by this Scene.");
  const oldQuality = { ...scene.quality }, oldZoom = scene.camera.zoom;
  let standard, closeup;
  try {
    scene.setQuality({ ...qualityPresets.high, scale: 100, pixelRatio: 1, modelDetail: "medium" });
    stepArchiveScene(2);
    standard = scene.renderer.domElement.toDataURL("image/png");
    scene.camera.zoom = oldZoom * 1.8; scene.camera.updateProjectionMatrix();
    scene.composer.render();
    closeup = scene.renderer.domElement.toDataURL("image/png");
  } finally {
    scene.camera.zoom = oldZoom; scene.camera.updateProjectionMatrix(); scene.setQuality(oldQuality); stepArchiveScene(1);
  }
  return { detail, standard, closeup };
}

async function exercisePunkArrayMotion() {
  if (!archiveScene) {
    await setupArchiveScene(); window.caseCheck.editor.destroy(); document.body.replaceChildren(archiveHost);
    document.body.style.cssText = "margin:0;padding:0;overflow:hidden"; archiveHost.style.margin = "0";
    archiveHost.dataset.mode = "archive";
  }
  const scene = archiveScene;
  const albums = records.slice(0, 2).map((record, index) => ({ ...record.album,
    tracks: Array.from({ length: index === 0 ? 40 : 45 }, (_, slot) => ({ id: "motion-" + index + "-" + slot, albumId: record.id,
      title: "Motion Fixture " + index + " / " + slot, trackNumber: slot + 1, artist: record.album.artist,
      format: "FLAC", audioUrl: "", relativePath: "", duration: 120 })) }));
  setMusicAlbums(albums, [{ id: "fixture-a", name: "Fixture A" }, { id: "fixture-b", name: "Fixture B" }], "genre");
  configureMusicCatalog({ layout: "shelf", show: "tracks", group: "none", sort: "added" }, "");
  const entries = getMusicDisplayEntries();
  expect(entries.length === 85 && getMusicCatalogShelves().length === 5, "Motion acceptance requires four full lanes and a final five-entry lane.");
  await scene.refreshLibrary(0);
  const select = (lane, slot) => {
    const key = getMusicCatalogShelves()[lane].entryKeys[slot], entry = entries.find(value => value.key === key);
    focusMusicEntry(key); scene.select(entry.recordIndex, { cell: { lane, row: 12 + slot, foobarEntryKey: key } });
  };
  const prepare = async (design = "archive", layout = "shelf", wave = "full") => {
    configureMusicCatalog({ layout, show: "tracks", group: "none", sort: "added" }, "");
    scene.setMusicStyle({ ...(design === "archive" ? archiveMusicStyle : defaultMusicStyle), shelf: true, floor: "deck" });
    archiveHost.dataset.design = design;
    await scene.setCaseSettings(sceneCaseSettings("punk"));
    scene.setQuality({ ...qualityPresets.original, wave, modelDetail: "medium", lighting: "high", scale: 80,
      pixelRatio: 1, aoSamples: 0, depthOfField: 0 });
    scene.setReduced(true); select(0, 2); scene.showMusicArchiveImmediately(archiveTime); stepArchiveScene(100);
    scene.setReduced(false);
    scene.pulses = []; scene.scanBlend = 0; scene.idleGain = 0; scene.lastInteraction = archiveTime;
    const snapshot = punkArrayMotionSnapshot();
    expect(snapshot.presentation === "archive" && !snapshot.targetDetail && snapshot.returnY === null && snapshot.outgoing === 0,
      "Motion fixture must be settled archive browsing, without cinematic/detail/return ownership: " + JSON.stringify(snapshot));
    return snapshot;
  };
  arrayMotionPrepare = prepare; arrayMotionSelect = select;
  const compare = (before, after, lane, active) => {
    const byKey = new Map(before.values.map(value => [value.key, value]));
    const shared = after.values.filter(value => value.lane === lane && byKey.has(value.key));
    expect(shared.length >= 18, "Each measured lane must retain at least eighteen actual submitted cells.");
    const z = shared.map(value => Math.abs(value.z - byKey.get(value.key).z));
    const regular = shared.filter(value => value.drawn && byKey.get(value.key).drawn);
    const y = regular.map(value => Math.abs(value.y - byKey.get(value.key).y));
    const rotation = regular.map(value => Math.abs(value.rotX));
    const result = { lane, matched: shared.length, maxZDelta: Math.max(...z), maxYDelta: Math.max(0, ...y), maxAbsRotationX: Math.max(0, ...rotation) };
    expect(active ? result.maxZDelta > .01 : result.maxZDelta === 0,
      (active ? "Active" : "Inactive") + " lane Z ownership failed: " + JSON.stringify(result));
    if (!active) expect(result.maxYDelta < 2e-5 && result.maxAbsRotationX < 2e-5,
      "An inactive lane must have stable Y and zero X rotation: " + JSON.stringify(result));
    return result;
  };
  const aligned = snapshot => {
    const selected = snapshot.values.find(value => value.selected);
    expect(selected && Math.abs(selected.z - snapshot.selectedModel.z) < 2e-6 &&
      snapshot.selectedModel.z === snapshot.selectedModel.coverZ && snapshot.selectedModel.z === snapshot.selectedModel.insertZ,
      "The selected entity, artwork and physical paper must follow the selected lane's actual submitted Z.");
    for (const value of snapshot.values) {
      expect(value.z === value.coverZ && value.z === value.insertZ && value.z === value.shellZ,
        "Shell/hit-proxy/artwork/physical-paper must submit the same Z for " + value.key);
      if (value.trayZ !== undefined) expect(Math.abs(value.z - value.trayZ) < 2e-6,
        "The physical tray must follow its own lane Z: " + JSON.stringify(value));
    }
  };
  const before = await prepare();
  select(0, 12); stepArchiveScene(18);
  const during = punkArrayMotionSnapshot(); aligned(during);
  const laneChecks = [0, 1, 2, 3].map(lane => compare(before, during, lane, lane === 0));
  select(1, 9); stepArchiveScene(1);
  const switched = punkArrayMotionSnapshot(); stepArchiveScene(240);
  const afterSwitch = punkArrayMotionSnapshot(); aligned(afterSwitch);
  const switchedZ = switched.values.filter(value => value.lane === 0);
  expect(switchedZ.every(value => afterSwitch.values.find(next => next.key === value.key)?.z === value.z),
    "Former lane Z freezes immediately while its selection wave naturally lowers.");
  stepArchiveScene(60);
  const beforeReduced = punkArrayMotionSnapshot();
  const frozen = compare(afterSwitch, beforeReduced, 0, false);
  const nextLane = compare(switched, afterSwitch, 1, true);
  scene.setReduced(true); select(2, 14); stepArchiveScene(1);
  const reduced = punkArrayMotionSnapshot();
  const reducedSelected = reduced.values.find(value => value.selected);
  expect(Math.abs(reducedSelected.z + 2.17) < 2e-6, "Reduced motion places the new active lane on the inspection Z in one update.");
  for (const value of reduced.values.filter(value => value.lane !== 2)) {
    const previous = beforeReduced.values.find(old => old.key === value.key);
    expect(previous && previous.z === value.z, "Reduced selection cannot move another lane's rail.");
  }
  // Reduce motion preserves the same selected/neighbor shape, snapping former inactive cases to rest.
  stepArchiveScene(1); const reducedSettled = punkArrayMotionSnapshot();
  const reducedInactive = [0, 1, 3].map(lane => compare(reduced, reducedSettled, lane, false));
  // Selection keeps the original persistent bell, with quality changing only neighbors.
  const waveLevels = [];
  for (const wave of ["off", "basic", "reduced", "full"]) {
    const baseline = await prepare("archive", "shelf", wave);
    select(0, 12); scene.setReduced(true); stepArchiveScene(1); scene.setReduced(false);
    const samples = [];
    for (let frame = 1; frame <= 300; frame++) {
      stepArchiveScene(1);
      const snapshot = punkArrayMotionSnapshot(); aligned(snapshot);
      const neighbor = snapshot.values.find(value => value.lane === 0 && value.row === 25);
      const distanceTwo = snapshot.values.find(value => value.lane === 0 && value.row === 26);
      const distant = snapshot.values.find(value => value.lane === 0 && value.row === 31);
      const selectedHeight = snapshot.selectedModel.y - distant.y;
      expect(Math.abs(selectedHeight - 2.098) < 2e-5,
        "All wave qualities retain the original 2.098 selected lift: " + wave + "/" + selectedHeight);
      if (wave !== "off") expect(neighbor.y > distant.y && distanceTwo.y > distant.y,
        "Both first and second neighbors form a persistent raised shoulder: " + wave);
      const inactive = snapshot.values.filter(value => value.lane !== 0);
      expect(inactive.every(value => value.rotX === null || value.rotX === 0), "Every inactive submitted cell stays upright for " + wave);
      if ([1, 6, 18, 60, 200, 300].includes(frame)) samples.push({ frame, snapshot });
      samples.push({ frame, neighborY: neighbor.y, neighborRotationX: neighbor.rotX });
    }
    waveLevels.push({ wave, baseline, samples });
  }
  const off = waveLevels[0].samples.filter(value => value.neighborY !== undefined);
  const strengths = waveLevels.map(level => {
    const samples = level.samples.filter(value => value.neighborY !== undefined);
    return { wave: level.wave, maxNeighborYDeltaFromOff: Math.max(...samples.map((value, index) => Math.abs(value.neighborY - off[index].neighborY))) };
  });
  expect(strengths[0].maxNeighborYDeltaFromOff === 0 && strengths[1].maxNeighborYDeltaFromOff > 1e-5 &&
    strengths[1].maxNeighborYDeltaFromOff < strengths[2].maxNeighborYDeltaFromOff &&
    strengths[2].maxNeighborYDeltaFromOff < strengths[3].maxNeighborYDeltaFromOff,
    "Actual neighboring Scene matrices retain off/light/medium/strong selection amplitudes: " + JSON.stringify(strengths));
  await prepare("archive", "shelf", "full"); stepArchiveScene(240);
  const idleBefore = punkArrayMotionSnapshot(); stepArchiveScene(60);
  const idleAfter = punkArrayMotionSnapshot();
  const idleInactive = [1, 2, 3].map(lane => compare(idleBefore, idleAfter, lane, false));
  const idleOld = new Map(idleBefore.values.map(value => [value.key, value]));
  const idleActiveYDelta = Math.max(...idleAfter.values.filter(value => value.lane === 0 && value.drawn)
    .map(value => Math.abs(value.y - idleOld.get(value.key).y)));
  expect(idleActiveYDelta < 2e-5, "Persistent ARRAY shoulders stay at their target beyond the old pulse lifetime.");
  // Future shares common ARRAY rail/shape; both themes retain the existing MATRIX rail.
  const guards = [];
  for (const [design, layout] of [["rhine", "shelf"], ["archive", "array"], ["rhine", "array"]]) {
    const start = await prepare(design, layout, "full"); select(0, 12); stepArchiveScene(18);
    const finish = punkArrayMotionSnapshot();
    const old = start.values.find(value => value.lane === 1 && value.row === 16 && value.drawn);
    const next = finish.values.find(value => value.lane === old?.lane && value.row === old?.row);
    expect(old && next && (layout === "shelf" ? next.z === old.z : Math.abs(next.z - old.z) > .01),
      "Future ARRAY shares independent rails; both MATRIX themes retain the shared rail: " + JSON.stringify({ design, layout, old, next }));
    if (layout === "shelf") {
      scene.setReduced(true); stepArchiveScene(1); scene.setReduced(false);
      const shared = punkArrayMotionSnapshot(), far = shared.values.find(value => value.lane === 0 && value.row === 31);
      expect(Math.abs(shared.selectedModel.y - far.y - 2.098) < 2e-5, "Future ARRAY uses the same selected height.");
      expect(shared.values.find(value => value.lane === 0 && value.row === 25).y > far.y, "Future ARRAY has the same neighboring shoulder.");
    }
    guards.push({ design, layout, inactiveLaneZDelta: next.z - old.z, start, finish });
  }
  await prepare("archive", "shelf", "full"); select(4, 0); scene.setReduced(true); stepArchiveScene(1); scene.setReduced(false); stepArchiveScene(100);
  const tail = punkArrayMotionSnapshot(); aligned(tail);
  const tray = scene.sceneResources.group.getObjectByName("Record shelf tray"), trayMatrix = new THREE.Matrix4();
  const tailSlots = scene.cells.flatMap((cell, index) => {
    if (cell.lane !== 4) return [];
    tray.getMatrixAt(index, trayMatrix);
    return [{ row: cell.row, occupied: !!musicSpatialEntry(cell, true), drawn: trayMatrix.elements[0] !== 0,
      z: trayMatrix.elements[14] }];
  });
  expect(tailSlots.length === 20 && tailSlots.filter(value => value.occupied).length === 5 && tailSlots.every(value => value.drawn),
    "The final five entries retain the complete twenty-slot physical tray: " + JSON.stringify(tailSlots));
  expect(tailSlots.every((value, index) => index === 0 || Math.abs(value.z - tailSlots[index - 1].z) > .9),
    "Empty final tray slots retain their physical pitch.");
  const detailChecks = [];
  for (const design of ["archive", "rhine"]) {
    await prepare(design, "shelf", "full");
    scene.setMode("detail");
    for (let frame = 0; frame < 300 && !scene.musicPresentationReady; frame++) stepArchiveScene(1);
    const detail = unifiedSnapshot();
    expect(detail.stats.musicPresentationPhase === "presented", "Both shared ARRAY themes open normally: " + JSON.stringify({ design, stats: detail.stats }));
    expect(detail.selectedScreenBounds.minX >= 0 && detail.selectedScreenBounds.maxX <= detail.selectedScreenBounds.availableWidth &&
      detail.selectedScreenBounds.minY >= 0 && detail.selectedScreenBounds.maxY <= archiveHost.clientHeight,
      "The whole opened case remains within the stage: " + JSON.stringify({ design, bounds: detail.selectedScreenBounds }));
    scene.setMode("archive");
    for (let frame = 0; frame < 300 && !scene.musicArchiveReady; frame++) stepArchiveScene(1);
    const returned = unifiedSnapshot(), rest = punkArrayMotionSnapshot(); aligned(rest);
    expect(rest.presentation === "archive" && returned.selectedScreenBounds.minY >= 0 && returned.selectedScreenBounds.maxY <= archiveHost.clientHeight,
      "Returning restores the complete raised browsing case: " + JSON.stringify({ design, bounds: returned.selectedScreenBounds }));
    detailChecks.push({ design, detail, returned });
  }
  return { scope: "Actual ArchiveScene instance/cover/paper/tray matrices, four full synthetic lanes plus final five entries, deterministic 1/60 updates; no audio/player/real library.",
    before, during, switched, afterSwitch, laneChecks, frozen, nextLane, reduced, reducedInactive,
    strengths, waveLevels, idleBefore, idleAfter, idleInactive, idleActiveYDelta, guards, tail, tailSlots, detailChecks };
}

async function captureRhineInsetAlbum() {
  const model = await createCaseModel("rhine", "high");
  const layout = getCaseLayout(model);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eae5e1");
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(900, 700, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const studio = createCaseStudioLighting(renderer, scene); studio.setTheme("day"); studio.setQuality(qualityPresets.high);
  const art = document.createElement("canvas"); art.width = art.height = 320;
  const ctx = art.getContext("2d");
  for (let y=0; y<8; y++) for (let x=0; x<8; x++) { ctx.fillStyle = (x+y)%2 ? "#ffe04c" : "#c82442"; ctx.fillRect(x*40,y*40,40,40); }
  ctx.fillStyle = "#101d43"; ctx.fillRect(24,125,272,70); ctx.fillStyle = "#fff"; ctx.font = "bold 26px sans-serif"; ctx.textAlign = "center"; ctx.fillText("ALBUM / INSIDE",160,169);
  const texture = new THREE.CanvasTexture(art); texture.colorSpace = THREE.SRGBColorSpace;
  const paper = createAlbumInsert(layout.cover, layout.insertThickness);
  const print = new THREE.Mesh(new THREE.PlaneGeometry(layout.cover.width,layout.cover.height).translate(layout.cover.x,layout.cover.y,layout.cover.z),createAlbumPrintMaterial(texture));
  print.receiveShadow = true; scene.add(model,paper,print);
  model.traverse(child => { if (!(child instanceof THREE.Mesh)) return; const m=child.material; const previous=m.onBeforeCompile;
    m.onBeforeCompile=(shader,r)=>{previous(shader,r);m.userData.insetAuditUniforms=shader.uniforms;
      if(child.userData.caseRhineAlbumWindow){ shader.uniforms.caseInsetAuditMask={value:0}; shader.fragmentShader='uniform float caseInsetAuditMask;\\n'+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','#include <opaque_fragment>\\nif(caseInsetAuditMask>.5)gl_FragColor=vec4(vec3(caseWindowMask),1.0);'); }
    };m.needsUpdate=true; });
  applyCaseAppearance(model,casePreset("original","rhine")); setCaseAlbumOcclusion(model,true);
  const uniforms = () => model.children.map(child => ({surface:child.userData.surface,window:child.userData.caseRhineAlbumWindow===true,
    transmission:child.material.transmission,opacity:child.material.opacity,depthWrite:child.material.depthWrite,
    frost:child.material.userData.insetAuditUniforms?.caseWindowFrost?.value,
    inset:child.material.userData.insetAuditUniforms?.caseInsetWindow?.value,
    rect:child.material.userData.insetAuditUniforms?.caseArtworkWindow?.value?.toArray()}));
  const camera = new THREE.OrthographicCamera(-2.8,2.8,2.8*700/900,-2.8*700/900,.01,100);
  camera.position.set(0,1.85,12); camera.lookAt(0,1.85,0); camera.updateMatrixWorld(true);
  const capture = () => { renderer.render(scene,camera); const canvas=document.createElement("canvas"); canvas.width=900;canvas.height=700;canvas.getContext("2d").drawImage(renderer.domElement,0,0);return canvas; };
  try {
    capture(); const clear=capture(); const clearUniforms=uniforms();
    const debugMaskUniform=model.children.find(child=>child.userData.caseRhineAlbumWindow).material.userData.insetAuditUniforms.caseInsetAuditMask;
    debugMaskUniform.value=1; const mask=capture(); debugMaskUniform.value=0;
    setCaseGlassFrost(model,1); const frost=capture(); const frostUniforms=uniforms();
    setCaseGlassFrost(model,0); print.visible=paper.visible=false; setCaseAlbumOcclusion(model,false); const empty=capture();
    print.visible=paper.visible=true; setCaseAlbumOcclusion(model,true);
    const topLeft = new THREE.Vector3(layout.cover.x-layout.cover.width/2,layout.cover.y+layout.cover.height/2,layout.cover.z).project(camera);
    const bottomRight = new THREE.Vector3(layout.cover.x+layout.cover.width/2,layout.cover.y-layout.cover.height/2,layout.cover.z).project(camera);
    const rect={left:(topLeft.x+1)*450,top:(1-topLeft.y)*350,right:(bottomRight.x+1)*450,bottom:(1-bottomRight.y)*350};
    const a=clear.getContext("2d").getImageData(0,0,900,700).data,b=frost.getContext("2d").getImageData(0,0,900,700).data,c=empty.getContext("2d").getImageData(0,0,900,700).data;
    let clearFrostInside=0,clearEmptyInside=0,clearFrostOutside=0;
    for(let y=0;y<700;y++)for(let x=0;x<900;x++){
      const i=(y*900+x)*4,df=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]),de=Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2]);
      const inside=x>rect.left+6&&x<rect.right-6&&y>rect.top+6&&y<rect.bottom-6;
      const outside=x<rect.left-12||x>rect.right+12||y<rect.top-12||y>rect.bottom+12;
      if(inside&&df>8)clearFrostInside++; if(inside&&de>8)clearEmptyInside++; if(outside&&df>8)clearFrostOutside++;
    }
    const checkerContrast = canvas => {
      const image=canvas.getContext("2d").getImageData(0,0,900,700).data;
      const sample=u=>{const x=Math.round(rect.left+(rect.right-rect.left)*u),y=Math.round(rect.top+(rect.bottom-rect.top)*.1875),i=(y*900+x)*4;return [image[i],image[i+1],image[i+2]];};
      const left=sample(.1875),right=sample(.3125);return left.reduce((sum,value,index)=>sum+Math.abs(value-right[index]),0);
    };
    const legacy=casePreset("original","rhine"); Object.assign(legacy.surfaces.cover,{preserveSource:false,finish:"paint",color:"#263f7b",transmission:0,metalness:.7,roughness:.8});
    applyCaseAppearance(model,legacy);const legacyCoating=capture();
    const checkerContrastClear=checkerContrast(clear),checkerContrastFrost=checkerContrast(frost),checkerContrastLegacy=checkerContrast(legacyCoating);
    applyCaseAppearance(model,casePreset("original","rhine"));setCaseAlbumOcclusion(model,true);
    camera.position.set(7,4.6,12);camera.lookAt(0,1.85,0); const oblique=capture();
    return {images:{clear:clear.toDataURL(),frost:frost.toDataURL(),empty:empty.toDataURL(),oblique:oblique.toDataURL(),mask:mask.toDataURL(),legacy:legacyCoating.toDataURL()},rect,clearFrostInside,clearEmptyInside,clearFrostOutside,checkerContrastClear,checkerContrastFrost,checkerContrastLegacy,
      cardDepth:layout.cover.z,glassDepth:model.userData.caseGlassDepth,label:layout.label,triangleCount:model.userData.caseStats.triangleCount,clearUniforms,frostUniforms};
  } finally { print.geometry.dispose(); print.material.dispose(); texture.dispose();paper.geometry.dispose();paper.material.dispose();disposeCaseModel(model);studio.dispose();renderer.dispose();renderer.forceContextLoss(); }
}

async function captureRhineAlbumInfo() {
  const model = await createCaseModel("rhine", "high");
  const layout = getCaseLayout(model);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#eae5e1");
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(900, 700, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const studio = createCaseStudioLighting(renderer, scene);
  studio.setTheme("day");
  studio.setQuality(qualityPresets.high);
  applyCaseAppearance(model, casePreset("original", "rhine"));
  const art = document.createElement("canvas"); art.width = art.height = 320;
  const artContext = art.getContext("2d");
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    artContext.fillStyle = (x + y) % 2 ? "#ffe04c" : "#c82442";
    artContext.fillRect(x * 40, y * 40, 40, 40);
  }
  artContext.fillStyle = "#101d43"; artContext.fillRect(24, 125, 272, 70);
  artContext.fillStyle = "#fff"; artContext.font = "bold 26px sans-serif"; artContext.textAlign = "center";
  artContext.fillText("ALBUM / INSIDE", 160, 169);
  const coverTexture = new THREE.CanvasTexture(art); coverTexture.colorSpace = THREE.SRGBColorSpace;
  const paper = createAlbumInsert(layout.cover, layout.insertThickness);
  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(layout.cover.width, layout.cover.height).translate(layout.cover.x, layout.cover.y, layout.cover.z),
    createAlbumPrintMaterial(coverTexture),
  );
  print.receiveShadow = true;

  const makeTrack = (id, overrides = {}) => ({
    id,
    albumId: "fixture-album",
    title: "Synthetic source track",
    artist: "Offline fixture",
    duration: 180,
    format: "FLAC",
    browserPlayable: true,
    audioUrl: "",
    relativePath: "",
    ...overrides,
  });
  const record = (id, track) => ({ id, album: { tracks: track ? [track] : [] } });
  const hiResRecord = record("fixture-hires", makeTrack("hires", {
    format: "FLAC", codec: "FLAC", sampleRate: 96_000, bitsPerSample: 24, lossless: true,
  }));
  const dsdRecord = record("fixture-dsd", makeTrack("dsd", {
    format: "DSF", codec: "DSD", sampleRate: 2_822_400, bitsPerSample: 1, lossless: true,
  }));
  const standardRecord = record("fixture-standard", makeTrack("standard", {
    format: "FLAC", codec: "FLAC", sampleRate: 44_100, bitsPerSample: 16, lossless: true,
  }));
  const unknownRecord = record("fixture-unknown", makeTrack("unknown", {
    format: "FLAC", lossless: true,
  }));
  const info = new RhineAlbumInfo(16, layout, renderer.capabilities.maxTextureSize, renderer.capabilities.getMaxAnisotropy());
  const snapshotGroup = new THREE.Group();
  const renderCanvas = (targetScene = scene, targetCamera = camera) => {
    renderer.render(targetScene, targetCamera);
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = 700;
    canvas.getContext("2d").drawImage(renderer.domElement, 0, 0);
    return canvas;
  };
  const compareCanvasPixels = (left, right) => {
    const a = left.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, left.width, left.height).data;
    const b = right.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, right.width, right.height).data;
    let changedPixels = 0, maxChannelDifference = 0;
    for (let offset = 0; offset < a.length; offset += 4) {
      const difference = Math.max(Math.abs(a[offset] - b[offset]), Math.abs(a[offset + 1] - b[offset + 1]), Math.abs(a[offset + 2] - b[offset + 2]));
      if (difference > 0) changedPixels++;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
    }
    return { changedPixels, maxChannelDifference };
  };
  const compareCanvasRegionPixels = (left, right, rect, inset = 2) => {
    const a = left.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, left.width, left.height).data;
    const b = right.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, right.width, right.height).data;
    const x0 = Math.max(0, Math.ceil(rect.left + inset)), x1 = Math.min(left.width, Math.floor(rect.right - inset));
    const y0 = Math.max(0, Math.ceil(rect.top + inset)), y1 = Math.min(left.height, Math.floor(rect.bottom - inset));
    let changedPixels = 0, maxChannelDifference = 0, pixelsCompared = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * left.width + x) * 4;
      const difference = Math.max(Math.abs(a[offset] - b[offset]), Math.abs(a[offset + 1] - b[offset + 1]), Math.abs(a[offset + 2] - b[offset + 2]));
      if (difference > 0) changedPixels++;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      pixelsCompared++;
    }
    return { rect: { left: x0, top: y0, right: x1, bottom: y1 }, pixelsCompared, changedPixels, maxChannelDifference };
  };
  const photoCamera = new THREE.OrthographicCamera(-2.8, 2.8, 2.8 * 700 / 900, -2.8 * 700 / 900, 0.01, 100);
  photoCamera.position.set(0, 1.85, 12); photoCamera.lookAt(0, 1.85, 0); photoCamera.updateMatrixWorld(true);
  const camera = photoCamera;
  let badgeOnlyScene;
  let snapshotDisposed = false;
  let snapshotDisposal;
  try {
    await info.ready;
    info.setLayout(layout);
    info.setVisibility(true);
    info.setSlot(0, hiResRecord, 0);
    info.setSlot(1, dsdRecord, 9);
    info.setSlot(2, standardRecord, 2);
    info.setSlot(3, unknownRecord, undefined);

    const arrayLabel = info.arrayLabel.userData;
    const arrayBadge = info.arrayBadge.userData;
    const badgeAttribute = info.arrayBadge.geometry.getAttribute("rhineBadgeType");
    const assetStatus = info.selectedBadge.userData.rhineAlbumInfoResources;
    const slotAudit = {
      count: info.arrayLabel.count,
      numberText: arrayLabel.numberText.slice(0, 4),
      archiveIndex: arrayLabel.archiveIndex.slice(0, 4),
      sourceBadges: arrayBadge.formatBadge.slice(0, 4),
      instanceBadgeTypes: Array.from({ length: 4 }, (_, slot) => badgeAttribute.getX(slot)),
      assetStatus,
      textureColorSpaces: {
        arrayLabel: info.arrayLabel.material.map?.colorSpace,
        selectedLabel: info.selectedLabel.material.map?.colorSpace,
        badgeAtlas: info.selectedBadge.material.uniforms.uBadgeAtlas.value.colorSpace,
      },
    };
    info.select(dsdRecord, 9);
    const selectedDsd = { numberText: info.selectedLabel.userData.numberText, formatBadge: info.selectedBadge.userData.formatBadge };
    snapshotGroup.add(info.selectedLabel.clone(), info.selectedBadge.clone());
    info.snapshot(snapshotGroup);
    const snapshotLabel = snapshotGroup.children.find(child => child.userData.role === "label");
    const snapshotBadge = snapshotGroup.children.find(child => child.userData.role === "badge");
    const selectedLabelTexture = info.selectedLabel.material.map;
    const snapshotLabelTexture = snapshotLabel.material.map;
    const snapshotFacts = {
      numberText: snapshotLabel.userData.numberText,
      formatBadge: snapshotBadge.userData.formatBadge,
      labelDepthWrite: snapshotLabel.material.depthWrite,
      labelTextureOwned: snapshotLabel.userData.rhineInfoOwnedTexture,
      badgeTextureOwned: snapshotBadge.userData.rhineInfoOwnedTexture,
      labelTextureIndependent: snapshotLabelTexture !== selectedLabelTexture && snapshotLabelTexture.image !== selectedLabelTexture.image,
      badgeMaterialIndependent: snapshotBadge.material !== info.selectedBadge.material,
      badgeAtlasShared: snapshotBadge.material.uniforms.uBadgeAtlas.value === info.selectedBadge.material.uniforms.uBadgeAtlas.value,
    };
    const frozenSnapshotPixels = snapshotLabelTexture.image.toDataURL();
    info.select(hiResRecord, 0);
    const selectedAfterSnapshotChange = {
      numberText: info.selectedLabel.userData.numberText,
      labelPixelsChanged: info.selectedLabel.material.map.image.toDataURL() !== frozenSnapshotPixels,
      snapshotPixelsStable: snapshotLabelTexture.image.toDataURL() === frozenSnapshotPixels,
    };

    const mutableSelected = record("fixture-mutable-selected", makeTrack("mutable-selected", {
      format: "FLAC", codec: "FLAC", sampleRate: 96_000, bitsPerSample: 24, lossless: true,
    }));
    info.select(mutableSelected, 4);
    const selectedTypeBeforeMetadataEdit = info.selectedBadge.userData.formatBadge;
    mutableSelected.album.tracks[0].lossless = false;
    info.select(mutableSelected, 4);
    const selectedTypeAfterMetadataEdit = info.selectedBadge.userData.formatBadge ?? null;

    const mutableRecord = record("fixture-mutable", makeTrack("mutable-hires", {
      format: "FLAC", codec: "FLAC", sampleRate: 96_000, bitsPerSample: 24, lossless: true,
    }));
    info.setSlot(4, mutableRecord, 4);
    mutableRecord.album.tracks[0].lossless = false;
    info.setSlot(4, mutableRecord, 4);
    const sameReferenceBeforeRefresh = info.arrayBadge.geometry.getAttribute("rhineBadgeType").getX(4);
    info.refresh();
    const refreshedType = info.arrayBadge.geometry.getAttribute("rhineBadgeType").getX(4);

    model.add(info.selectedLabel, info.selectedBadge);
    scene.add(model, paper, print);
    info.select(hiResRecord, 0);
    info.setMotion(0.6, false);
    const hiResImage = renderCanvas();
    info.select(dsdRecord, 9);
    info.setMotion(0.6, false);
    const dsdImage = renderCanvas();

    const labelTextureCanvas = info.selectedLabel.material.map.image;
    const labelTexturePixels = labelTextureCanvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, labelTextureCanvas.width, labelTextureCanvas.height).data;
    const countDarkCanvasPixels = ({ x, y, width, height }) => {
      let darkPixels = 0;
      for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
        const offset = (row * labelTextureCanvas.width + column) * 4;
        if (Math.max(labelTexturePixels[offset], labelTexturePixels[offset + 1], labelTexturePixels[offset + 2]) < 135) darkPixels++;
      }
      return darkPixels;
    };
    const rawLabelCanvasAudit = {
      width: labelTextureCanvas.width,
      height: labelTextureCanvas.height,
      miSansCheck: document.fonts?.check("bold 81px MiSans") ?? null,
      topRuleDarkPixels: countDarkCanvasPixels({ x: 12, y: 12, width: 1000, height: 6 }),
      bottomRuleDarkPixels: countDarkCanvasPixels({ x: 12, y: 419, width: 1000, height: 3 }),
      infoBarDarkPixels: countDarkCanvasPixels({ x: 782, y: 32, width: 221, height: 39 }),
      infoTextDarkPixels: countDarkCanvasPixels({ x: 820, y: 75, width: 190, height: 85 }),
      numberDarkPixels: countDarkCanvasPixels({ x: 22, y: 220, width: 500, height: 180 }),
      brandMarkDarkPixels: countDarkCanvasPixels({ x: 790, y: 242, width: 210, height: 98 }),
    };

    model.updateMatrixWorld(true);
    const labelPlaneBounds = new THREE.Box3().setFromObject(info.selectedLabel);
    const badgePlaneBounds = new THREE.Box3().setFromObject(info.selectedBadge);
    const closeupBounds = labelPlaneBounds.clone().union(badgePlaneBounds);
    const closeupSize = closeupBounds.getSize(new THREE.Vector3());
    const closeupCenter = closeupBounds.getCenter(new THREE.Vector3());
    const closeupAspect = renderer.domElement.width / renderer.domElement.height;
    const closeupHalfHeight = Math.max(closeupSize.y * 0.72, closeupSize.x / closeupAspect * 0.72);
    const labelZoomCamera = new THREE.OrthographicCamera(
      -closeupHalfHeight * closeupAspect, closeupHalfHeight * closeupAspect,
      closeupHalfHeight, -closeupHalfHeight, 0.01, 100,
    );
    labelZoomCamera.position.set(closeupCenter.x, closeupCenter.y, closeupCenter.z + 12);
    labelZoomCamera.lookAt(closeupCenter);
    labelZoomCamera.updateMatrixWorld(true);
    const projectLabelPoint = (x, y, z) => {
      const projected = new THREE.Vector3(x, y, z).project(labelZoomCamera);
      return { x: (projected.x + 1) * renderer.domElement.width / 2, y: (1 - projected.y) * renderer.domElement.height / 2 };
    };
    const labelPlaneCorners = [
      projectLabelPoint(labelPlaneBounds.min.x, labelPlaneBounds.min.y, labelPlaneBounds.max.z),
      projectLabelPoint(labelPlaneBounds.min.x, labelPlaneBounds.max.y, labelPlaneBounds.max.z),
      projectLabelPoint(labelPlaneBounds.max.x, labelPlaneBounds.min.y, labelPlaneBounds.max.z),
      projectLabelPoint(labelPlaneBounds.max.x, labelPlaneBounds.max.y, labelPlaneBounds.max.z),
    ];
    const projectedLabelPixelRect = {
      left: Math.min(...labelPlaneCorners.map(point => point.x)),
      top: Math.min(...labelPlaneCorners.map(point => point.y)),
      right: Math.max(...labelPlaneCorners.map(point => point.x)),
      bottom: Math.max(...labelPlaneCorners.map(point => point.y)),
    };

    const depthMaterial = info.selectedLabel.material;
    const originalDepthWrite = depthMaterial.depthWrite;
    depthMaterial.depthWrite = false;
    const caseLabelDepthWriteOff = renderCanvas(scene, labelZoomCamera);
    depthMaterial.depthWrite = true;
    const caseLabelDepthWriteOn = renderCanvas(scene, labelZoomCamera);
    const depthWriteAblation = {
      productionDepthWrite: originalDepthWrite,
      onlyChangedMaterialProperty: "selectedLabel.material.depthWrite",
      depthWriteOff: false,
      depthWriteOn: true,
      changedPixels: compareCanvasPixels(caseLabelDepthWriteOff, caseLabelDepthWriteOn).changedPixels,
    };
    depthMaterial.depthWrite = originalDepthWrite;
    const shellForBounds = model.children.filter(child => child instanceof THREE.Mesh && child.userData.rhineAlbumInfo !== true);
    const shellBoundsAndOrder = shellForBounds.map(mesh => {
      mesh.geometry.computeBoundingBox();
      const bounds = new THREE.Box3().setFromObject(mesh);
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return {
        surface: mesh.userData.surface ?? mesh.name,
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        overlapsLabelXY: bounds.max.x >= labelPlaneBounds.min.x && bounds.min.x <= labelPlaneBounds.max.x &&
          bounds.max.y >= labelPlaneBounds.min.y && bounds.min.y <= labelPlaneBounds.max.y,
        maxZRelativeToLabelPlane: bounds.max.z - labelPlaneBounds.max.z,
        renderOrder: mesh.renderOrder,
        materialId: material.id,
        materialType: material.type,
        visible: mesh.visible,
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
      };
    }).sort((left, right) => left.renderOrder - right.renderOrder || left.materialId - right.materialId);
    const labelPlaneMaterial = info.selectedLabel.material;
    const labelDepthDiagnostic = {
      layoutLabel: layout.label,
      selectedLabelBounds: { min: labelPlaneBounds.min.toArray(), max: labelPlaneBounds.max.toArray() },
      selectedLabelMaterial: {
        renderOrder: info.selectedLabel.renderOrder,
        materialId: labelPlaneMaterial.id,
        materialType: labelPlaneMaterial.type,
        transparent: labelPlaneMaterial.transparent,
        opacity: labelPlaneMaterial.opacity,
        depthWriteBeforeAblation: originalDepthWrite,
      },
      arrayLabelMaterial: {
        materialId: info.arrayLabel.material.id,
        materialType: info.arrayLabel.material.type,
        transparent: info.arrayLabel.material.transparent,
        depthWrite: info.arrayLabel.material.depthWrite,
      },
      caseGlassDepth: model.userData.caseGlassDepth,
      shellSurfaces: shellBoundsAndOrder,
    };

    const labelOnlyScene = new THREE.Scene();
    labelOnlyScene.background = scene.background;
    model.remove(info.selectedLabel);
    labelOnlyScene.add(info.selectedLabel);
    const labelOnlyZoom = renderCanvas(labelOnlyScene, labelZoomCamera);
    model.add(info.selectedLabel);
    const assembledLabelRegionCompare = compareCanvasRegionPixels(
      caseLabelDepthWriteOn,
      labelOnlyZoom,
      projectedLabelPixelRect,
      2,
    );
    const labelTextureImage = labelTextureCanvas.toDataURL("image/png");

    const badge = info.selectedBadge;
    model.remove(badge);
    badgeOnlyScene = new THREE.Scene();
    badgeOnlyScene.background = new THREE.Color("#101923");
    badgeOnlyScene.environment = scene.environment;
    badgeOnlyScene.environmentIntensity = 0;
    const ambient = new THREE.HemisphereLight("#ffffff", "#020204", 0.01);
    const key = new THREE.DirectionalLight("#ffffff", 0.01);
    key.position.set(-3, 5, 6);
    badgeOnlyScene.add(ambient, key, badge);
    const badgeBounds = badge.geometry.boundingBox ?? (badge.geometry.computeBoundingBox(), badge.geometry.boundingBox);
    const badgeCenter = badgeBounds.getCenter(new THREE.Vector3());
    const badgeSize = badgeBounds.getSize(new THREE.Vector3());
    const aspect = renderer.domElement.width / renderer.domElement.height;
    const halfHeight = Math.max(badgeSize.y * 0.72, badgeSize.x / aspect * 0.72);
    const badgeCamera = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, 0.01, 100);
    badgeCamera.position.set(badgeCenter.x, badgeCenter.y, badgeCenter.z + 5);
    badgeCamera.lookAt(badgeCenter); badgeCamera.updateMatrixWorld(true);
    const renderBadgeOnly = () => {
      renderer.render(badgeOnlyScene, badgeCamera);
      const canvas = document.createElement("canvas");
      canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
      canvas.getContext("2d").drawImage(renderer.domElement, 0, 0);
      return canvas;
    };
    const measureBadgeInk = canvas => {
      const { width, height } = canvas;
      const pixels = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
      const background = [pixels[0], pixels[1], pixels[2]];
      const scan = (left, right) => {
        let minX = width, minY = height, maxX = -1, maxY = -1, inkPixels = 0, sumX = 0;
        for (let y = 0; y < height; y++) for (let x = left; x < right; x++) {
          const offset = (y * width + x) * 4;
          const delta = Math.max(Math.abs(pixels[offset] - background[0]), Math.abs(pixels[offset + 1] - background[1]), Math.abs(pixels[offset + 2] - background[2]));
          if (delta <= 18) continue;
          inkPixels++;
          sumX += x;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        return inkPixels
          ? { minX, minY, maxX, maxY, inkPixels, centroidX: sumX / inkPixels }
          : { minX: null, minY: null, maxX: null, maxY: null, inkPixels: 0, centroidX: null };
      };
      const middle = Math.floor(width / 2);
      const full = scan(0, width), left = scan(0, middle), right = scan(middle, width);
      const centerGap = scan(middle - 8, middle + 8);
      return {
        width, height, background,
        inkPixels: full.inkPixels,
        bounds: full,
        boundsCenterOffsetX: full.inkPixels ? (full.minX + full.maxX) / 2 - width / 2 : null,
        centroidOffsetX: full.inkPixels ? full.centroidX - width / 2 : null,
        left,
        right,
        centerGapInkPixels: centerGap.inkPixels,
        leftRightGapPixels: left.inkPixels && right.inkPixels ? right.minX - left.maxX - 1 : null,
      };
    };
    info.select(hiResRecord, 0);
    info.setMotion(1.2, true);
    const hiResOnlyLayout = measureBadgeInk(renderBadgeOnly());
    info.select(dsdRecord, 9);
    info.setMotion(1.2, true);
    const pairedLayout = measureBadgeInk(renderBadgeOnly());
    const pairedSourceBadgeBeforeDsdOnlyProbe = info.selectedBadge.userData.formatBadge;
    info.selectedBadge.material.uniforms.uBadgeKind.value = 2;
    info.selectedBadge.material.uniformsNeedUpdate = true;
    const dsdOnlySyntheticLayout = measureBadgeInk(renderBadgeOnly());
    const pairedSourceBadgeAfterDsdOnlyProbe = info.selectedBadge.userData.formatBadge;
    info.selectedBadge.material.uniforms.uBadgeKind.value = 3;
    info.selectedBadge.material.uniformsNeedUpdate = true;
    const inkSize = bounds => ({
      width: bounds.maxX - bounds.minX + 1,
      height: bounds.maxY - bounds.minY + 1,
    });
    const hiresSingleSize = inkSize(hiResOnlyLayout.bounds);
    const hiresPairedSize = inkSize(pairedLayout.left);
    const dsdSingleSize = inkSize(dsdOnlySyntheticLayout.bounds);
    const dsdPairedSize = inkSize(pairedLayout.right);
    const markSizeConsistency = {
      hiRes: {
        single: hiresSingleSize,
        paired: hiresPairedSize,
        difference: { width: Math.abs(hiresSingleSize.width - hiresPairedSize.width), height: Math.abs(hiresSingleSize.height - hiresPairedSize.height) },
      },
      dsd: {
        singleSynthetic: dsdSingleSize,
        paired: dsdPairedSize,
        difference: { width: Math.abs(dsdSingleSize.width - dsdPairedSize.width), height: Math.abs(dsdSingleSize.height - dsdPairedSize.height) },
      },
    };
    info.setMotion(0.17, false);
    const movingA = renderBadgeOnly();
    info.setMotion(1.93, false);
    const movingB = renderBadgeOnly();
    const comparePixels = (left, right) => {
      const a = left.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, left.width, left.height).data;
      const b = right.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, right.width, right.height).data;
      let changedPixels = 0, maxChannelDifference = 0;
      for (let offset = 0; offset < a.length; offset += 4) {
        const difference = Math.max(Math.abs(a[offset] - b[offset]), Math.abs(a[offset + 1] - b[offset + 1]), Math.abs(a[offset + 2] - b[offset + 2]));
        if (difference > 0) changedPixels++;
        maxChannelDifference = Math.max(maxChannelDifference, difference);
      }
      return { changedPixels, maxChannelDifference };
    };
    const animationDifference = comparePixels(movingA, movingB);
    info.setMotion(2.75, true);
    const reducedA = renderBadgeOnly();
    await new Promise(resolve => setTimeout(resolve, 80));
    const reducedB = renderBadgeOnly();
    const reducedDifference = comparePixels(reducedA, reducedB);
    const frozenBeforeLightChange = renderBadgeOnly();
    ambient.intensity = 20;
    ambient.color.set("#ff3110");
    ambient.groundColor.set("#102cff");
    key.intensity = 55;
    key.color.set("#35ff80");
    badgeOnlyScene.environmentIntensity = 32;
    const frozenAfterLightChange = renderBadgeOnly();
    const environmentDifference = comparePixels(frozenBeforeLightChange, frozenAfterLightChange);

    const snapshotAppearance = new CardAppearance();
    const snapshotBadgeAtlas = snapshotBadge.material.uniforms.uBadgeAtlas.value;
    const selectedTextureBeforeSnapshotDispose = info.selectedLabel.material.map;
    let snapshotLabelTextureDisposed = false;
    let snapshotBadgeMaterialDisposed = false;
    let selectedTextureDisposedBySnapshot = false;
    let badgeAtlasDisposedBySnapshot = false;
    snapshotLabelTexture.addEventListener("dispose", () => { snapshotLabelTextureDisposed = true; });
    snapshotBadge.material.addEventListener("dispose", () => { snapshotBadgeMaterialDisposed = true; });
    selectedTextureBeforeSnapshotDispose.addEventListener("dispose", () => { selectedTextureDisposedBySnapshot = true; });
    snapshotBadgeAtlas.addEventListener("dispose", () => { badgeAtlasDisposedBySnapshot = true; });
    snapshotAppearance.dispose(snapshotGroup);
    snapshotDisposed = true;
    snapshotDisposal = {
      ownedLabelTextureDisposed: snapshotLabelTextureDisposed,
      snapshotBadgeMaterialDisposed,
      selectedTextureDisposed: selectedTextureDisposedBySnapshot,
      sharedBadgeAtlasDisposed: badgeAtlasDisposedBySnapshot,
    };
    info.select(hiResRecord, 0);
    info.setMotion(0.6, false);
    const renderedHiResBadge = info.selectedBadge.userData.formatBadge;
    info.select(dsdRecord, 9);
    info.setMotion(0.6, false);
    const renderedDsdBadge = info.selectedBadge.userData.formatBadge;
    return {
      images: {
        "info-hi-res": hiResImage.toDataURL("image/png"),
        "info-dsd": dsdImage.toDataURL("image/png"),
        "label-canvas-raw": labelTextureImage,
        "label-case-zoom-depth-write-off": caseLabelDepthWriteOff.toDataURL("image/png"),
        "label-case-zoom-depth-write-on": caseLabelDepthWriteOn.toDataURL("image/png"),
        "label-case-zoom-production": caseLabelDepthWriteOn.toDataURL("image/png"),
        "label-only-zoom": labelOnlyZoom.toDataURL("image/png"),
      },
      rawLabelCanvasAudit,
      labelDepthDiagnostic,
      depthWriteAblation,
      assembledLabelRegionCompare,
      assetStatus,
      slotAudit,
      selectedDsd,
      selectedAfterSnapshotChange,
      snapshot: { ...snapshotFacts, labelPixelsStableAfterSelection: selectedAfterSnapshotChange.snapshotPixelsStable },
      snapshotDisposal,
      selectedMetadataRefresh: { before: selectedTypeBeforeMetadataEdit, after: selectedTypeAfterMetadataEdit },
      inPlaceRefresh: { cachedTypeBeforeRefresh: sameReferenceBeforeRefresh, refreshedType },
      badges: { hiRes: renderedHiResBadge, dsd: renderedDsdBadge },
      badgeLayouts: { hiResOnlyLayout, pairedLayout, dsdOnlySyntheticLayout,
        pairedSourceBadgeBeforeDsdOnlyProbe, pairedSourceBadgeAfterDsdOnlyProbe, markSizeConsistency },
      webgl: { animationDifference, reducedDifference, environmentDifference },
    };
  } finally {
    if (!snapshotDisposed) {
      for (const child of snapshotGroup.children) {
        if (child.material?.map && child.userData.rhineInfoOwnedTexture) child.material.map.dispose();
        child.material?.dispose();
      }
    }
    info.dispose();
    print.geometry.dispose(); print.material.dispose(); coverTexture.dispose();
    paper.geometry.dispose(); paper.material.dispose();
    disposeCaseModel(model);
    studio.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

async function capturePunkAlbumInfo() {
  const model = await createCaseModel("punk", "high");
  const layout = getCaseLayout(model);
  const appearance = casePreset("glass", "punk");
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#101923");
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(900, 700, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const studio = createCaseStudioLighting(renderer, scene);
  studio.setTheme("day");
  studio.setQuality(qualityPresets.high);

  const makeRecord = (id, track) => ({ id, album: { tracks: track ? [track] : [] } });
  const makeTrack = (id, overrides = {}) => ({
    id, albumId: "punk-fixture-album", title: "Synthetic punk label track", artist: "Offline fixture",
    duration: 180, format: "FLAC", codec: "FLAC", sampleRate: 96_000, bitsPerSample: 24,
    lossless: true, browserPlayable: true, audioUrl: "", relativePath: "", ...overrides,
  });
  const firstRecord = makeRecord("punk-fixture-0", makeTrack("punk-track-0"));
  const tenthRecord = makeRecord("punk-fixture-9", makeTrack("punk-track-9", {
    format: "DSF", codec: "DSD", sampleRate: 2_822_400, bitsPerSample: 1,
  }));
  const info = new CaseAlbumInfo(2, layout, renderer.capabilities.maxTextureSize,
    renderer.capabilities.getMaxAnisotropy(), "punk");
  const snapshotGroup = new THREE.Group();
  const renderCanvas = (targetScene, targetCamera) => {
    renderer.render(targetScene, targetCamera);
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = 700;
    canvas.getContext("2d").drawImage(renderer.domElement, 0, 0);
    return canvas;
  };
  const comparePixels = (left, right, rect, inset = 2) => {
    const a = left.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, left.width, left.height).data;
    const b = right.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, right.width, right.height).data;
    const x0 = Math.max(0, Math.ceil(rect.left + inset)), x1 = Math.min(left.width, Math.floor(rect.right - inset));
    const y0 = Math.max(0, Math.ceil(rect.top + inset)), y1 = Math.min(left.height, Math.floor(rect.bottom - inset));
    let changedPixels = 0, pixelsCompared = 0, maxChannelDifference = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * left.width + x) * 4;
      const difference = Math.max(Math.abs(a[offset] - b[offset]), Math.abs(a[offset + 1] - b[offset + 1]), Math.abs(a[offset + 2] - b[offset + 2]));
      if (difference) changedPixels++;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      pixelsCompared++;
    }
    return { rect: { left: x0, top: y0, right: x1, bottom: y1 }, pixelsCompared, changedPixels, maxChannelDifference };
  };
  const rectFromBounds = (bounds, camera) => {
    const points = [
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    ].map(point => {
      point.project(camera);
      return { x: (point.x + 1) * renderer.domElement.width / 2, y: (1 - point.y) * renderer.domElement.height / 2 };
    });
    return { left: Math.min(...points.map(point => point.x)), top: Math.min(...points.map(point => point.y)),
      right: Math.max(...points.map(point => point.x)), bottom: Math.max(...points.map(point => point.y)) };
  };
  let snapshotDisposed = false;
  try {
    applyCaseAppearance(model, appearance, qualityPresets.high);
    info.setVisibility(true);
    info.setSlot(0, firstRecord, 0);
    info.setSlot(1, tenthRecord, 9);
    info.select(firstRecord, 0);
    info.applyAppearance(appearance, model);
    model.add(info.selectedLabel);
    scene.add(model);
    await info.ready;

    model.updateMatrixWorld(true);
    const modelBounds = new THREE.Box3().setFromObject(model);
    const modelSize = modelBounds.getSize(new THREE.Vector3());
    const modelCenter = modelBounds.getCenter(new THREE.Vector3());
    const aspect = renderer.domElement.width / renderer.domElement.height;
    const modelHalfHeight = Math.max(modelSize.y * 0.62, modelSize.x / aspect * 0.62);
    const modelCamera = new THREE.OrthographicCamera(-modelHalfHeight * aspect, modelHalfHeight * aspect,
      modelHalfHeight, -modelHalfHeight, 0.01, 100);
    modelCamera.position.set(modelCenter.x, modelCenter.y, modelBounds.max.z + 12);
    modelCamera.lookAt(modelCenter);
    modelCamera.updateMatrixWorld(true);
    const fullBoxImage = renderCanvas(scene, modelCamera);

    const labelBounds = new THREE.Box3().setFromObject(info.selectedLabel);
    const labelSize = labelBounds.getSize(new THREE.Vector3());
    const labelCenter = labelBounds.getCenter(new THREE.Vector3());
    const labelHalfHeight = Math.max(labelSize.y * 0.72, labelSize.x / aspect * 0.72);
    const labelCamera = new THREE.OrthographicCamera(-labelHalfHeight * aspect, labelHalfHeight * aspect,
      labelHalfHeight, -labelHalfHeight, 0.01, 100);
    labelCamera.position.set(labelCenter.x, labelCenter.y, labelBounds.max.z + 12);
    labelCamera.lookAt(labelCenter);
    labelCamera.updateMatrixWorld(true);
    const labelRect = rectFromBounds(labelBounds, labelCamera);
    const selectedCloseup = renderCanvas(scene, labelCamera);
    const lights = [];
    scene.traverse(object => { if (object.isLight) lights.push(object); });
    for (const light of lights) {
      light.intensity = 80;
      if (light.color) light.color.set("#ff3210");
      if (light.groundColor) light.groundColor.set("#102cff");
    }
    scene.environmentIntensity = 40;
    const selectedAfterLighting = renderCanvas(scene, labelCamera);
    const unlitLabelCompare = comparePixels(selectedCloseup, selectedAfterLighting, labelRect, 2);

    const punkArrayScene = new THREE.Scene();
    punkArrayScene.background = new THREE.Color("#101923");
    const cloneShellWithoutLabel = () => {
      const clone = model.clone(true);
      for (const child of [...clone.children]) if (child.userData.rhineAlbumInfo) clone.remove(child);
      return clone;
    };
    const leftShell = cloneShellWithoutLabel();
    const rightShell = cloneShellWithoutLabel();
    const instanceMatrices = [-2.15, 2.15].map(x => {
      const dummy = new THREE.Object3D();
      dummy.position.set(x, 0, 0);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
    leftShell.position.x = -2.15;
    rightShell.position.x = 2.15;
    info.arrayLabel.setMatrixAt(0, instanceMatrices[0]);
    info.arrayLabel.setMatrixAt(1, instanceMatrices[1]);
    info.arrayLabel.instanceMatrix.needsUpdate = true;
    info.arrayLabel.visible = true;
    punkArrayScene.add(leftShell, rightShell, info.arrayLabel);
    const arrayCamera = new THREE.OrthographicCamera(-5.4, 5.4, 4.2, -4.2, 0.01, 100);
    arrayCamera.position.set(0, modelCenter.y, 16);
    arrayCamera.lookAt(0, modelCenter.y, 0);
    arrayCamera.updateMatrixWorld(true);
    const arrayImage = renderCanvas(punkArrayScene, arrayCamera);
    const arrayAudit = {
      count: info.arrayLabel.count,
      numbers: info.arrayLabel.userData.numberText.slice(0, 2),
      indices: info.arrayLabel.userData.archiveIndex.slice(0, 2),
      badgesHidden: !info.arrayBadge.visible && !info.selectedBadge.visible,
      badgeTypes: Array.from(info.arrayBadge.geometry.getAttribute("rhineBadgeType").array.slice(0, 2)),
      labelTextureSize: [info.arrayLabel.material.map.image.width, info.arrayLabel.material.map.image.height],
    };

    snapshotGroup.add(info.selectedLabel.clone());
    info.snapshot(snapshotGroup);
    const snapshotLabel = snapshotGroup.children.find(child => child.userData.role === "label");
    const snapshotMap = snapshotLabel.material.map;
    const snapshotNumber = snapshotLabel.userData.numberText;
    const frozenSnapshot = snapshotMap.image.toDataURL("image/png");
    info.select(tenthRecord, 9);
    const snapshotStable = snapshotMap.image.toDataURL("image/png") === frozenSnapshot;
    const selectedNumberAfterChange = info.selectedLabel.userData.numberText;
    const snapshotShell = cloneShellWithoutLabel();
    const snapshotScene = new THREE.Scene();
    snapshotScene.background = new THREE.Color("#101923");
    snapshotScene.add(snapshotShell, snapshotLabel.clone());
    const snapshotImage = renderCanvas(snapshotScene, modelCamera);
    const snapshotAudit = {
      numberText: snapshotNumber,
      selectedNumberAfterChange,
      textureIndependent: snapshotMap !== info.selectedLabel.material.map && snapshotMap.image !== info.selectedLabel.material.map.image,
      stableAfterSelection: snapshotStable,
    };

    const snapshotMaterial = snapshotLabel.material;
    const snapshotMaterialBefore = {
      type: snapshotMaterial.type,
      color: snapshotMaterial.color?.getHexString() ?? null,
      depthWrite: snapshotMaterial.depthWrite,
    };
    const baseLabelTransform = appearance.transforms?.label ?? {
      visible: true, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    };
    const snapshotHiddenAppearance = structuredClone(appearance);
    snapshotHiddenAppearance.transforms = {
      ...snapshotHiddenAppearance.transforms,
      label: { ...baseLabelTransform, visible: false },
    };
    applyCaseAppearance(model, snapshotHiddenAppearance, qualityPresets.high);
    info.applyAppearance(snapshotHiddenAppearance, model);
    applyCaseAppearance(snapshotGroup, snapshotHiddenAppearance, qualityPresets.high);
    const hiddenSnapshotLabel = snapshotGroup.children.find(child => child.userData.role === "label");
    const snapshotHiddenAudit = {
      selectedMaterialHidden: snapshotLabel.material.visible === false,
      selectedObjectVisible: snapshotLabel.visible === true,
      snapshotMaterialHidden: hiddenSnapshotLabel.material.visible === false,
      snapshotObjectVisible: hiddenSnapshotLabel.visible === true,
    };
    const snapshotShownAppearance = structuredClone(appearance);
    snapshotShownAppearance.transforms = {
      ...snapshotShownAppearance.transforms,
      label: { ...baseLabelTransform, visible: true },
    };
    applyCaseAppearance(model, snapshotShownAppearance, qualityPresets.high);
    info.applyAppearance(snapshotShownAppearance, model);
    applyCaseAppearance(snapshotGroup, snapshotShownAppearance, qualityPresets.high);
    const snapshotVisibilityAudit = {
      ...snapshotHiddenAudit,
      selectedMaterialRestored: snapshotLabel.material.visible === true,
      selectedObjectRestored: snapshotLabel.visible === true,
      snapshotMaterialRestored: hiddenSnapshotLabel.material.visible === true,
      snapshotObjectRestored: hiddenSnapshotLabel.visible === true,
      materialTypeUnchanged: snapshotLabel.material === snapshotMaterial && snapshotLabel.material.type === snapshotMaterialBefore.type,
      materialColorUnchanged: snapshotLabel.material.color?.getHexString() === snapshotMaterialBefore.color,
      materialRemainsUnlitBasic: snapshotLabel.material.type === "MeshBasicMaterial" && hiddenSnapshotLabel.material.type === "MeshBasicMaterial",
      depthWrite: snapshotMaterialBefore.depthWrite,
    };

    const basePositions = Float32Array.from(info.selectedLabel.geometry.getAttribute("position").array);
    const movedAppearance = structuredClone(appearance);
    movedAppearance.transforms = {
      ...movedAppearance.transforms,
      label: { visible: true, offset: [0.08, 0.04, 0.015], rotation: [0, 0, 6], scale: [1.05, 0.95, 1] },
    };
    applyCaseAppearance(model, movedAppearance, qualityPresets.high);
    info.applyAppearance(movedAppearance, model);
    const movedPositions = info.selectedLabel.geometry.getAttribute("position").array;
    const transformMaxDelta = Math.max(...Array.from(movedPositions, (value, index) => Math.abs(value - basePositions[index])));
    const hiddenAppearance = structuredClone(movedAppearance);
    hiddenAppearance.transforms.label.visible = false;
    applyCaseAppearance(model, hiddenAppearance, qualityPresets.high);
    info.applyAppearance(hiddenAppearance, model);
    const transformAudit = {
      movedGeometry: transformMaxDelta > 0.05,
      maxDelta: transformMaxDelta,
      hidesSelectedAndArrayLabel: !info.selectedLabel.visible && !info.arrayLabel.visible,
      arrayInstanceCount: info.arrayLabel.count,
    };

    const labelCanvas = info.selectedLabel.material.map.image;
    const labelData = labelCanvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, labelCanvas.width, labelCanvas.height).data;
    let opaqueLabelPixels = 0, darkLabelPixels = 0;
    for (let offset = 0; offset < labelData.length; offset += 4) {
      if (labelData[offset + 3] > 240) opaqueLabelPixels++;
      if (Math.max(labelData[offset], labelData[offset + 1], labelData[offset + 2]) < 150) darkLabelPixels++;
    }
    const labelCanvasAudit = {
      width: labelCanvas.width,
      height: labelCanvas.height,
      numberText: info.selectedLabel.userData.numberText,
      opaquePixels: opaqueLabelPixels,
      darkInkPixels: darkLabelPixels,
      pixelsPerDesignUnit: labelCanvas.width / 1024,
    };
    return {
      images: {
        "punk-box-full-label": fullBoxImage.toDataURL("image/png"),
        "punk-label-closeup": selectedCloseup.toDataURL("image/png"),
        "punk-label-array": arrayImage.toDataURL("image/png"),
        "punk-label-snapshot": snapshotImage.toDataURL("image/png"),
      },
      labelCanvasAudit,
      unlitLabelCompare,
      arrayAudit,
      snapshotAudit,
      snapshotVisibilityAudit,
      transformAudit,
    };
  } finally {
    if (snapshotGroup.children.length) {
      const snapshotAppearance = new CardAppearance();
      snapshotAppearance.dispose(snapshotGroup);
    }
    info.dispose();
    disposeCaseModel(model);
    studio.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

window.caseCheck = {
  editor,
  get settings() { return serializeSettings(settings); },
  get changes() { return serializeSettings(changes); },
  get observations() { return serializeSettings(observations); },
  get rendererCalls() { return serializeSettings(rendererCalls); },
  get editorInsertObservations() { return serializeSettings(editorInsertObservations); },
  get editorRendererCreations() { return editorRendererCreations; },
  setEditorLighting(value) { quality.lighting = value; },
  setCover(url) { cover = { url, title: "Updated local fixture" }; },
  setTheme(value) { theme = value; },
  setEditorDesign(value) {
    if (value !== "rhine" && value !== "archive") return;
    settingsByDesign[editorDesign] = structuredClone(settings);
    editorDesign = value;
    settings = structuredClone(settingsByDesign[editorDesign]);
    editor.refresh();
  },
  get userPresets() { return serializeSettings(userPresetPreferences[presetPreferenceKey(editorDesign)]); },
  get userPresetLibraries() { return serializeSettings(userPresetPreferences); },
  get userPresetChanges() { return userPresetChangeCounts[editorDesign]; },
  reloadUserPresets() {
    const saved = JSON.parse(localStorage.getItem("fixture-punk-preferences") || "{}");
    userPresetPreferences = {
      futurePunkPresets: normalizeCaseUserPresets(saved.futurePunkPresets),
      archivePunkPresets: normalizeCaseUserPresets(saved.archivePunkPresets),
    };
    editor.refresh();
  },
  setupArchiveScene,
  changeArchiveStructure,
  exerciseArchiveSelection,
  raceArchiveStructures,
  captureScenePaperProtection,
  get archiveSceneSummary() { return archiveSceneSummary(); },
  get archiveSceneCaptureStats() { return archiveSceneCaptureStats; },
  get archiveSceneScreenshot() { return archiveSceneCapture?.toDataURL("image/png") ?? ""; },
  captureRhineInsetAlbum,
  captureRhineAlbumInfo,
  capturePunkAlbumInfo,
  exerciseUnifiedRender,
  exercisePunkArrayMotion,
  prepareArrayPointer,
  arrayHoverSnapshot,
  arraySurfaceVariant,
  unifiedRenderVariant,
  unifiedPointerTarget,
  unifiedRenderResult() { return { clicks: unifiedClicks, opens: unifiedOpens, snapshot: unifiedSnapshot() }; },
  exerciseCardLifecycle,
  async run() {
    const archiveStyleMarkup = musicStyleMarkup({ ...defaultMusicStyle, design: "archive" }, "day");
    const musicStyleAudit = {
      caseCardsAbsent: !archiveStyleMarkup.includes("data-style-case") && !archiveStyleMarkup.includes("CASE SKIN") &&
        !archiveStyleMarkup.includes("hero-clear.png") && !archiveStyleMarkup.includes("array-clear.png"),
      schemeCardsPresent: archiveStyleMarkup.includes("data-style-scheme") && archiveStyleMarkup.includes("COLOUR SCHEME"),
      schemePreviewPresent: archiveStyleMarkup.includes("data-style-preview-content") &&
        archiveStyleMarkup.includes("style-preview-scheme") && archiveStyleMarkup.includes("style-dual-swatches"),
      displaySettingsPresent: ["arrayScale", "inspectScale", "textScale", "floor", "topTitles", "grain"]
        .every(field => archiveStyleMarkup.includes(\`data-style-field="\${field}"\`)),
      themeSwitchPresent: archiveStyleMarkup.includes('data-style-design="rhine"') && archiveStyleMarkup.includes('data-style-design="archive"'),
      qualitySlotPresent: archiveStyleMarkup.includes("theme-quality-slot"),
    };
    expect(musicStyleAudit.caseCardsAbsent && musicStyleAudit.schemeCardsPresent && musicStyleAudit.schemePreviewPresent &&
      musicStyleAudit.displaySettingsPresent && musicStyleAudit.themeSwitchPresent && musicStyleAudit.qualitySlotPresent,
    "Archive keeps theme, scheme, display, and quality settings while removing the native CASE SKIN image picker.");
    for (const structure of ["minimal", "rhine", "punk", "invalid"]) {
      for (const enabled of [false, true]) {
        const saved = defaultCaseSettings("archive");
        saved.structure = structure;
        saved.enabled = enabled;
        saved.appearances.punk.preset = "custom";
        saved.appearances.punk.surfaces.frame.color = "#123456";
        saved.appearances.punk.transforms = { frame: { visible: true, offset: [.1, .2, .3], rotation: [1, 2, 3], scale: [1, 1, 1] } };
        const profiles = normalizeCaseProfiles({ rhine: { ...saved, structure: "rhine" }, archive: saved });
        expect(profiles.archive.structure === "punk" && profiles.archive.enabled === true,
          "Punk must retain only its own structure and force the editable mode after legacy enabled:false migration.");
        expect(profiles.rhine.structure === "rhine" && profiles.archive.appearances.punk.surfaces.frame.color === "#123456" &&
          profiles.archive.appearances.punk.transforms.frame.offset[0] === .1,
          "Legacy structure migration must preserve Punk edits and the independent Future selection.");
        expect(normalizeCaseSettings(profiles.archive, "archive").structure === "punk", "Punk migration must be stable after reload.");
      }
    }
    expect(defaultCaseSettings("archive").enabled === true,
      "New Archive profiles must start directly in the editable Punk case mode.");
    const legacyDisabledArchive = defaultCaseSettings("archive");
    legacyDisabledArchive.enabled = false;
    legacyDisabledArchive.appearances.punk.preset = "custom";
    legacyDisabledArchive.appearances.punk.presetRevision = 4;
    legacyDisabledArchive.appearances.punk.surfaces.frame.color = "#2357A1";
    legacyDisabledArchive.appearances.punk.transforms = {
      frame: { visible: true, offset: [.2, -.1, .3], rotation: [4, 5, 6], scale: [1.1, .9, 1] },
    };
    const legacyArchiveCandidate = JSON.parse(JSON.stringify(legacyDisabledArchive));
    const migratedArchive = normalizeCaseSettings(legacyArchiveCandidate, "archive");
    const enabledArchiveBaseline = normalizeCaseSettings({ ...legacyArchiveCandidate, enabled: true }, "archive");
    const archiveEnabledMigration = {
      defaultEnabled: defaultCaseSettings("archive").enabled,
      migratedEnabled: migratedArchive.enabled,
      appearanceRetained: JSON.stringify(migratedArchive.appearances.punk) === JSON.stringify(enabledArchiveBaseline.appearances.punk) &&
        migratedArchive.appearances.punk.surfaces.frame.color === "#2357A1" &&
        migratedArchive.appearances.punk.transforms.frame.offset[0] === .2,
      futureIndependent: normalizeCaseSettings(undefined, "rhine").structure === "minimal" && normalizeCaseSettings(undefined, "rhine").enabled,
    };
    expect(archiveEnabledMigration.defaultEnabled && archiveEnabledMigration.migratedEnabled &&
      archiveEnabledMigration.appearanceRetained && archiveEnabledMigration.futureIndependent,
    "Legacy Archive enabled:false must migrate only its mode flag while retaining all Punk appearance/transform data and Future defaults.");
    const punkPresetIds = ["marble", "hazard", "white", "glass", "frost", "red", "blue", "coral", "tide", "aurora"];
    const structureParts = Object.fromEntries(["minimal", "rhine", "punk"].map(structure => [structure, casePartsForStructure(structure).sort()]));
    expect(JSON.stringify(Object.keys(caseAppearancePresets).filter(id => id !== "original")) === JSON.stringify(punkPresetIds),
      "Punk must expose exactly the ten original preset IDs in source order.");
    expect(JSON.stringify(structureParts.minimal) === JSON.stringify(["back", "cover", "frame"]),
      "Minimal structure must contain only frame, cover, and back.");
    expect(structureParts.punk.length === 15, "Punk structure must expose fifteen independently editable parts.");
    expect(JSON.stringify(structureParts.rhine) === JSON.stringify([
      "accent", "back", "cover", "fasteners", "frame", "ink", "label", "lettering", "trim", "trimHighlight",
    ]), "Rhine music shell must expose only its retained exterior parts.");
    const punkPresetCoverage = Object.fromEntries(punkPresetIds.map(id => {
      const appearance = casePreset(id, "punk");
      return [id, structureParts.punk.every(part =>
        Object.hasOwn(appearance.surfaces, part) && appearance.surfaces[part].preserveSource === false &&
        typeof appearance.surfaces[part].pattern === "string" && typeof appearance.surfaces[part].secondaryColor === "string")];
    }));
    expect(Object.values(punkPresetCoverage).every(Boolean), "Every Punk preset must define all fifteen parts with reconstructed materials.");
    expect(punkPresetIds.every(id => casePreset(id, "punk").presetRevision === 4),
      "Every current Punk preset must carry presetRevision 4.");
    const originalRhine = casePreset("original", "rhine");
    expect(structureParts.rhine.every(part => originalRhine.surfaces[part].preserveSource === true),
      "Rhine original appearance must preserve every native GLB part material.");

    const expectedLegacyPunkHashes = {
      marble: 488214401, hazard: 435241061, white: 504307058, glass: 4019825096,
      frost: 2946357657, red: 1351143729, blue: 2188553745, coral: 782040014,
      tide: 973666227, aurora: 3238676072,
    };
    const legacyPunkMigrations = {};
    let migratedTransformPreserved = false;
    for (const id of punkPresetIds) {
      const oldSurfaces = legacyPresetSurfaces(id);
      const rawOldHash = legacySurfaceFingerprint(oldSurfaces);
      const oldAppearance = { preset: id, surfaces: oldSurfaces };
      if (id === "blue") oldAppearance.transforms = { frame: {
        visible: false, offset: [0.12, -0.08, 0.04], rotation: [3, 4, 5], scale: [1.02, 0.98, 1.04],
      } };
      const migrated = normalizeCaseSettings({
        version: 1, enabled: true, structure: "punk", appearances: { punk: oldAppearance },
      }, "archive").appearances.punk;
      const currentPreset = casePreset(id, "punk");
      const hashMatched = rawOldHash === expectedLegacyPunkHashes[id];
      const upgraded = migrated.preset === id && migrated.presetRevision === 4 &&
        surfaceFingerprint(migrated.surfaces) === surfaceFingerprint(currentPreset.surfaces);
      if (id === "blue") migratedTransformPreserved = JSON.stringify(migrated.transforms?.frame) === JSON.stringify(oldAppearance.transforms.frame);
      legacyPunkMigrations[id] = { rawOldHash, expectedOldHash: expectedLegacyPunkHashes[id], hashMatched, upgraded };
      expect(hashMatched, "Embedded 4bafd77 " + id + " raw surface fixture must match its full-surface migration fingerprint.");
      expect(upgraded, "An untouched legacy " + id + " preset must migrate to revision 4 and the current named preset surfaces.");
    }
    const revisionTwoAurora = revisionTwoAuroraSurfaces();
    const revisionTwoAuroraSnapshotHash = hashRevisionTwoAurora(revisionTwoAurora);
    const revisionTwoAuroraNormalized = normalizeCaseSettings({
      version: 1,
      enabled: true,
      structure: "punk",
      appearances: { punk: { preset: "aurora", presetRevision: 2, surfaces: revisionTwoAurora } },
    }, "archive").appearances.punk;
    const currentAurora = casePreset("aurora", "punk");
    const revisionTwoAuroraUpgraded = revisionTwoAuroraNormalized.presetRevision === 4 &&
      sameSurfaceFields(revisionTwoAuroraNormalized.surfaces, currentAurora.surfaces, REVISION_TWO_AURORA_FIXTURE.fields) &&
      revisionTwoAuroraNormalized.surfaces.frame.iridescence === currentAurora.surfaces.frame.iridescence &&
      revisionTwoAuroraNormalized.surfaces.frame.gradientAngle === currentAurora.surfaces.frame.gradientAngle;
    const editedRevisionTwoAuroraSurfaces = structuredClone(revisionTwoAurora);
    editedRevisionTwoAuroraSurfaces.frame.gradientAngle = -30;
    const editedRevisionTwoAurora = normalizeCaseSettings({
      version: 1,
      enabled: true,
      structure: "punk",
      appearances: { punk: { preset: "aurora", presetRevision: 2, surfaces: editedRevisionTwoAuroraSurfaces } },
    }, "archive").appearances.punk;
    const revisionTwoAuroraMigration = {
      sourceCommit: "b06e6aa",
      rawHash: revisionTwoAuroraSnapshotHash,
      expectedRawHash: 2658149930,
      hashMatched: revisionTwoAuroraSnapshotHash === 2658149930,
      upgradedToRevision4: revisionTwoAuroraUpgraded,
      restoredAuroraIridescence: revisionTwoAuroraNormalized.surfaces.frame.iridescence,
      currentAuroraIridescence: currentAurora.surfaces.frame.iridescence,
      gradientAngleIsHashed: hashRevisionTwoAurora(editedRevisionTwoAuroraSurfaces) !== 2658149930,
      editedAngleKeptAtRevision2: editedRevisionTwoAurora.presetRevision === 2 &&
        editedRevisionTwoAurora.surfaces.frame.gradientAngle === -30 && editedRevisionTwoAurora.surfaces.frame.iridescence === 0.1,
    };
    expect(revisionTwoAuroraMigration.hashMatched && revisionTwoAuroraMigration.upgradedToRevision4,
      "The exact b06e6aa full-surface Aurora V2 snapshot must migrate to current preset revision 4: " + JSON.stringify(revisionTwoAuroraMigration));
    expect(revisionTwoAuroraMigration.gradientAngleIsHashed && revisionTwoAuroraMigration.editedAngleKeptAtRevision2,
      "Changing the saved Aurora gradient angle must break the V2 fingerprint and preserve the user's named-preset edit: " + JSON.stringify(revisionTwoAuroraMigration));

    const revisionThreeAurora = revisionThreeAuroraSurfaces();
    const revisionThreeAuroraSnapshotHash = hashRevisionThreeAurora(revisionThreeAurora);
    const revisionThreeAuroraNormalized = normalizeCaseSettings({
      version: 1,
      enabled: true,
      structure: "punk",
      appearances: { punk: { preset: "aurora", presetRevision: 3, surfaces: revisionThreeAurora } },
    }, "archive").appearances.punk;
    const revisionThreeAuroraCurrent = casePreset("aurora", "punk");
    const revisionThreeAuroraUpgraded = revisionThreeAuroraNormalized.presetRevision === 4 &&
      sameSurfaceFields(revisionThreeAuroraNormalized.surfaces, revisionThreeAuroraCurrent.surfaces, REVISION_THREE_AURORA_FIXTURE.fields);
    const editedRevisionThreeAuroraSurfaces = structuredClone(revisionThreeAurora);
    editedRevisionThreeAuroraSurfaces.frame.gradientAngle = -8;
    const editedRevisionThreeAurora = normalizeCaseSettings({
      version: 1,
      enabled: true,
      structure: "punk",
      appearances: { punk: { preset: "aurora", presetRevision: 3, surfaces: editedRevisionThreeAuroraSurfaces } },
    }, "archive").appearances.punk;
    const revisionThreeAuroraMigration = {
      source: "frozen pre-optics V3 settings snapshot",
      rawHash: revisionThreeAuroraSnapshotHash,
      expectedRawHash: 3928754121,
      hashMatched: revisionThreeAuroraSnapshotHash === 3928754121,
      upgradedToRevision4: revisionThreeAuroraUpgraded,
      editedAngleBreaksFingerprint: hashRevisionThreeAurora(editedRevisionThreeAuroraSurfaces) !== 3928754121,
      editedAngleKeptAtRevision3: editedRevisionThreeAurora.presetRevision === 3 &&
        editedRevisionThreeAurora.surfaces.frame.gradientAngle === -8 &&
        editedRevisionThreeAurora.surfaces.frame.iridescence === revisionThreeAuroraSurfaces().frame.iridescence,
    };
    expect(revisionThreeAuroraMigration.hashMatched && revisionThreeAuroraMigration.upgradedToRevision4,
      "The exact pre-optics Aurora V3 snapshot must migrate to current preset revision 4: " + JSON.stringify(revisionThreeAuroraMigration));
    expect(revisionThreeAuroraMigration.editedAngleBreaksFingerprint && revisionThreeAuroraMigration.editedAngleKeptAtRevision3,
      "Changing the saved Aurora V3 gradient angle must preserve the user's revision-3 edit: " + JSON.stringify(revisionThreeAuroraMigration));

    const editedLegacySurfaces = legacyPresetSurfaces("marble");
    editedLegacySurfaces.frame.color = "#123456";
    const editedLegacyNamed = normalizeCaseSettings({
      version: 1, enabled: true, structure: "punk",
      appearances: { punk: { preset: "marble", surfaces: editedLegacySurfaces } },
    }, "archive").appearances.punk;
    expect(editedLegacyNamed.preset === "marble" && editedLegacyNamed.presetRevision === 1 &&
      editedLegacyNamed.surfaces.frame.color === "#123456",
    "A manually edited named Punk preset must not auto-upgrade over its saved color.");
    expect(migratedTransformPreserved, "Migrating an untouched legacy named preset must retain its geometry transform.");
    const presetRevisionAudit = {
      generatedRevision4: punkPresetIds.every(id => casePreset(id, "punk").presetRevision === 4),
      legacyPunkMigrations,
      revisionTwoAuroraMigration,
      revisionThreeAuroraMigration,
      editedNamedPresetPreserved: editedLegacyNamed.preset === "marble" && editedLegacyNamed.presetRevision === 1 && editedLegacyNamed.surfaces.frame.color === "#123456",
      migratedTransformPreserved,
    };

    const legacy = normalizeCaseSettings({
      version: 1,
      enabled: true,
      structure: "punk",
      appearances: { punk: {
        preset: "custom",
        surfaces: { frame: {
          finish: "metal", color: "#112233", roughness: 0.33, transmission: 0.14,
          ior: 1.52, emission: 0.05, legacyMarker: "retain-me",
        } },
        transforms: { frame: {
          visible: false,
          offset: [0.25, -0.5, 50],
          rotation: [10, 20, 450],
          scale: [1.5, 0, 1],
        } },
      } },
    }, "archive");
    const legacyFrame = legacy.appearances.punk.surfaces.frame;
    const legacyTransform = legacy.appearances.punk.transforms?.frame;
    const explicitClearcoatCustom = normalizeCaseSettings({
      version: 1,
      enabled: true,
      structure: "punk",
      appearances: { punk: { preset: "custom", surfaces: { frame: {
        finish: "metal", color: "#334455", roughness: 0.63, clearcoatRoughness: 0.17,
      } } } },
    }, "archive").appearances.punk.surfaces.frame;
    const clearcoatRoughnessCompatibility = {
      legacyCustomMissingValueFallsBackToRoughness: legacyFrame.clearcoatRoughness === legacyFrame.roughness,
      legacyCustomFallbackValue: legacyFrame.clearcoatRoughness,
      oldRoughnessValue: legacyFrame.roughness,
      explicitCustomValuePreserved: explicitClearcoatCustom.clearcoatRoughness === 0.17,
      explicitCustomRoughness: explicitClearcoatCustom.roughness,
      explicitCustomClearcoatRoughness: explicitClearcoatCustom.clearcoatRoughness,
    };
    expect(clearcoatRoughnessCompatibility.legacyCustomMissingValueFallsBackToRoughness &&
      clearcoatRoughnessCompatibility.explicitCustomValuePreserved,
    "Custom profiles must map a missing clearcoat roughness to legacy roughness while preserving an explicit new value: " + JSON.stringify(clearcoatRoughnessCompatibility));
    expect(legacyFrame.color === "#112233" && legacyFrame.roughness === 0.33 && legacyFrame.transmission === 0.14 &&
      legacyFrame.ior === 1.52 && legacyFrame.emission === 0.05 && legacyFrame.legacyMarker === "retain-me",
    "Legacy surface values and custom fields must survive normalization.");
    expect(JSON.stringify(legacyTransform) === JSON.stringify({
      visible: false, offset: [0.25, -0.5, 10], rotation: [10, 20, 360], scale: [1.5, 0.01, 1],
    }), "Saved transforms must be normalized, finite, and clamped without losing the transform.");
    const legacyRhineCustom = normalizeCaseSettings({
      version: 1,
      structure: "rhine",
      appearances: { rhine: {
        preset: "custom",
        surfaces: { frame: {
          finish: "metal", color: "#224466", roughness: 0.41, transmission: 0.12, ior: 1.51, emission: 0.03,
        } },
      } },
    }, "rhine");
    const legacyRhinePreset = normalizeCaseSettings({
      version: 1,
      structure: "rhine",
      appearances: { rhine: {
        preset: "coral",
        surfaces: { frame: {
          finish: "paint", color: "#cc7766", roughness: 0.36, transmission: 0.08, ior: 1.46, emission: 0,
        } },
      } },
    }, "rhine");
    const legacyRhineCustomFrame = legacyRhineCustom.appearances.rhine.surfaces.frame;
    const legacyRhinePresetFrame = legacyRhinePreset.appearances.rhine.surfaces.frame;
    expect(legacyRhineCustomFrame.color === "#224466" && legacyRhineCustomFrame.preserveSource === false &&
      legacyRhinePresetFrame.color === "#CC7766" && legacyRhinePresetFrame.preserveSource === false,
    "Legacy custom and non-original Rhine surfaces without preserveSource must keep their saved values and remain custom materials.");
    const settingsAudit = {
      punkPresetIds,
      punkPartCount: structureParts.punk.length,
      rhinePartCount: structureParts.rhine.length,
      minimalParts: structureParts.minimal,
      punkPresetCoverage,
      presetRevisionAudit,
      rhineNativePreserved: structureParts.rhine.every(part => originalRhine.surfaces[part].preserveSource),
      legacySurfacePreserved: legacyFrame.legacyMarker === "retain-me",
      legacyCustomColorPreserved: legacyFrame.color === "#112233",
      clearcoatRoughnessCompatibility,
      normalizedTransform: legacyTransform,
      legacyRhineCustomColor: legacyRhineCustomFrame.color,
      legacyRhineCustomPreserveSource: legacyRhineCustomFrame.preserveSource,
      legacyRhinePresetColor: legacyRhinePresetFrame.color,
      legacyRhinePresetPreserveSource: legacyRhinePresetFrame.preserveSource,
    };

    const models = [];
    const combos = [
      ["minimal", "low"], ["minimal", "high"],
      ["rhine", "low"], ["rhine", "high"],
      ["punk", "low"], ["punk", "medium"], ["punk", "high"],
    ];
    let punkLowVertices = 0;
    let punkHighVertices = 0;
    let rhineLowTriangles = 0;
    let rhineHighTriangles = 0;
    let rhineNativeRestore = null;
    let nativeOpticalEvidence = [];
    let transformChecks = null;
    let blueTangentChecks = null;
    let punkGeometryAudit = null;
    let punkCoverRect = null;
    const coverageFailures = [];
    for (const [structure, detail] of combos) {
      const model = await createCaseModel(structure, detail);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const layout = getCaseLayout(model);
      const sourceSize = model.userData.caseSourceBounds?.size;
      const renderedAspectError = Math.max(
        Math.abs(size.x / size.y - layout.width / layout.height),
        Math.abs(size.z / size.y - layout.depth / layout.height),
      );
      const sourceLayoutAspectError = structure === "minimal" || !sourceSize
        ? renderedAspectError
        : Math.max(
          Math.abs(layout.width / layout.height - sourceSize[0] / sourceSize[1]),
          Math.abs(layout.depth / layout.height - sourceSize[2] / sourceSize[1]),
        );
      const layoutAspectPreserved = size.x > 0 && size.y > 0 && size.z > 0 &&
        layout.width > 0 && layout.height > 0 && layout.depth > 0 &&
        sourceLayoutAspectError < (structure === "minimal" ? 0.002 : 1e-6) &&
        (detail === "low" && structure !== "minimal" || renderedAspectError < 0.002);
      const vertices = [];
      model.traverse(child => { if (child instanceof THREE.Mesh) vertices.push(child.geometry.getAttribute("position").count); });
      const vertexCount = vertices.reduce((sum, value) => sum + value, 0);
      const parts = [...new Set(model.children.map(child => child.userData.casePart))].sort();
      const requiredParts = casePartsForStructure(structure).sort();
      const appearance = defaultCaseSettings("rhine").appearances[structure];
      applyCaseAppearance(model, appearance, { lighting: "refined", transmission: 0.25 });
      const before = materialSnapshot(model);
      appearance.surfaces.frame = { ...appearance.surfaces.frame, preserveSource: false, finish: "metal", color: "#27486a", roughness: 0.91, transmission: 0.12, ior: 1.57, emission: 0.14 };
      appearance.surfaces.cover = { ...appearance.surfaces.cover, preserveSource: false, finish: "frost", color: "#6389b0", roughness: 0.83, transmission: 0.22, ior: 1.62, emission: 0.08 };
      appearance.surfaces.back = { ...appearance.surfaces.back, preserveSource: false, finish: "paint", color: "#536b43", roughness: 0.72, transmission: 0, ior: 1.46, emission: 0.04 };
      appearance.surfaces.accent = { ...appearance.surfaces.accent, preserveSource: false, finish: "metal", color: "#b68b34", roughness: 0.26, transmission: 0, ior: 1.46, emission: 0.2 };
      applyCaseAppearance(model, appearance, { lighting: "refined", transmission: 0.25 });
      const after = materialSnapshot(model);
      const cover = after.find(surface => surface.part === "cover");
      const frame = after.find(surface => surface.part === "frame");
      const changed = after.some((surface, index) => surface.color !== before[index]?.color || surface.roughness !== before[index]?.roughness);
      const front = model.userData.caseFront;
      const layoutCover = layout.cover;
      const coverLayoutMatches = front?.cover && ["x", "y", "z", "width", "height"].every(key => Math.abs(front.cover[key] - layoutCover[key]) < 1e-6);
      const independentCover = !!coverLayoutMatches && JSON.stringify(front.normal) === JSON.stringify([0, 0, 1]);
      expect(model.userData.caseStructure === structure, structure + "/" + detail + ": model identity");
      expect(layoutAspectPreserved, structure + "/" + detail + ": source layout must preserve its own width/height/depth proportions; layout error=" + sourceLayoutAspectError + ", rendered detail error=" + renderedAspectError);
      expect(Math.abs(center.y - layout.center.y) < 0.04, structure + "/" + detail + ": layout vertical center " + center.y);
      const corePartsPresent = ["frame", "cover", "back"].every(part => parts.includes(part));
      const partCoverageValid = detail === "high"
        ? JSON.stringify(parts) === JSON.stringify(requiredParts)
        : corePartsPresent && parts.every(part => requiredParts.includes(part));
      if (!partCoverageValid) coverageFailures.push({ structure, detail, expected: requiredParts, actual: parts });
      expect(changed && cover?.color === "6389b0" && Math.abs(cover.transmission - 0.22) < 1e-6, structure + "/" + detail + ": render transmission quality must not rewrite the material's surface transmission");
      expect(frame?.transmission === 0 && cover?.transmission > 0, structure + "/" + detail + ": opaque metal framing and transmissive cover must remain optically distinct");
      expect(independentCover, structure + "/" + detail + ": independent artwork plane metadata must follow this model's cover layout and +Z front.");
      const triangleCount = model.userData.caseStats?.triangleCount ?? 0;
      if (structure === "rhine" && detail === "low") rhineLowTriangles = triangleCount;
      if (structure === "rhine" && detail === "high") {
        rhineHighTriangles = triangleCount;
        const nativeTransmitting = before.filter(surface => surface.native && surface.native.transmission > 0);
        const nativeOpaque = before.filter(surface => surface.native && surface.native.transmission === 0);
        expect(nativeTransmitting.length > 0 && nativeOpaque.length > 0,
          "Rhine GLB must preserve distinct transmissive and opaque native parts.");
        nativeOpticalEvidence = [
          ...nativeTransmitting.slice(0, 3).map(surface => ({ part: surface.part, surface: surface.surface, transmission: surface.native.transmission })),
          ...nativeOpaque.slice(0, 3).map(surface => ({ part: surface.part, surface: surface.surface, transmission: surface.native.transmission })),
        ];
        for (const part of requiredParts) appearance.surfaces[part].preserveSource = true;
        applyCaseAppearance(model, appearance, { lighting: "refined", transmission: 0.25 });
        const restored = materialSnapshot(model);
        const nativeClearcoatRoughnessPreserved = restored.length === before.length && restored.every(surface =>
          surface.native && Math.abs(surface.clearcoatRoughness - surface.native.clearcoatRoughness) < 1e-6);
        rhineNativeRestore = {
          materialCount: restored.length,
          restoredAllNativeParameters: nativeMaterialRestored(restored, before),
          nativeClearcoatRoughnessPreserved,
        };
        expect(rhineNativeRestore.restoredAllNativeParameters && nativeClearcoatRoughnessPreserved,
          "Using the Rhine original-material switch must restore native color, transmission, clearcoat roughness, anisotropy, film fields, and PBR values.");
        expect(rhineHighTriangles === 33256 && model.children.length === 13 &&
          model.userData.caseProvenance === "RhineLabUI/archive-cassette.glb",
          "Rhine must adapt the original shell while omitting internal exhibition meshes; got " + rhineHighTriangles);
        expect(model.userData.caseVariant === "inset-album-shell" && layout.insertThickness > 0 &&
          layout.cover.z < model.userData.caseGlassDepth[0] && layout.cover.z - layout.insertThickness > layout.bounds.min[2],
          "The Rhine album card must be inside the shell and behind the real front pane.");
        const artworkRight = layout.cover.x + layout.cover.width / 2;
        const labelLeft = layout.label.x - layout.label.width / 2;
        expect(layout.cover.width === layout.cover.height && layout.cover.x < 0 && layout.label.x > 0 && labelLeft - artworkRight > .4 * layout.sourceScale,
          "Rhine must show the square artwork on the left and the complete original label in a separate right-hand column.");
        const movedInk = model.children.find(child => child.userData.surface === "Carbon_Ink");
        expect(movedInk.geometry.boundingBox.min.x > artworkRight + .4 * layout.sourceScale,
          "Moving the label plate must also move all ink away from the artwork.");
        expect(model.children.every(child => !["Subsurface_Optics", "Optical_Film", "Optical_Film_Edge", "Amber_Optical_Inlay"].includes(child.userData.surface)),
          "The exhibition optics must not remain in the music shell.");
        expect(model.children.filter(child => ["label", "ink", "lettering"].includes(child.userData.casePart)).every(child => child.userData.assemblyPart !== "cover"),
          "Rhine label plate and glyphs must stay together on the carrier when the front glass is detached.");
        const coverMesh = model.children.find(child => child.userData.casePart === "cover");
        const nativeCover = coverMesh.material;
        const opticsBefore = { transmission: nativeCover.transmission, opacity: nativeCover.opacity,
          transparent: nativeCover.transparent, depthWrite: nativeCover.depthWrite, alphaTest: nativeCover.alphaTest,
          side: nativeCover.side, color: nativeCover.color.getHexString(), roughness: nativeCover.roughness, ior: nativeCover.ior, castShadow: coverMesh.castShadow };
        for (const opacity of [0, .4, 1]) {
          appearance.surfaces.cover.transmissionOverride = .37;
          appearance.surfaces.cover.opacityOverride = opacity;
          applyCaseAppearance(model, appearance, { transmission: .25 });
          expect(nativeCover.transmission === .37 && nativeCover.opacity === opacity &&
            nativeCover.color.getHexString() === opticsBefore.color && nativeCover.roughness === opticsBefore.roughness && nativeCover.ior === opticsBefore.ior,
            "Rhine optical overrides must change only transmission/alpha, keeping native colour and PBR.");
          expect(opacity === 1 || nativeCover.transparent && !nativeCover.depthWrite,
            "Rhine alpha transparency must blend without invisible depth occlusion.");
          expect(opacity !== 0 || !coverMesh.castShadow, "An invisible Rhine part must not leave an opaque shadow.");
        }
        delete appearance.surfaces.cover.transmissionOverride;
        delete appearance.surfaces.cover.opacityOverride;
        applyCaseAppearance(model, appearance);
        expect(JSON.stringify({ transmission: nativeCover.transmission, opacity: nativeCover.opacity,
          transparent: nativeCover.transparent, depthWrite: nativeCover.depthWrite, alphaTest: nativeCover.alphaTest,
          side: nativeCover.side, color: nativeCover.color.getHexString(), roughness: nativeCover.roughness, ior: nativeCover.ior, castShadow: coverMesh.castShadow }) === JSON.stringify(opticsBefore),
          "Removing Rhine optical overrides must restore the complete native optical/alpha state.");
      }
      if (structure === "punk" && detail === "low") punkLowVertices = vertexCount;
      if (structure === "punk" && detail === "high") punkHighVertices = vertexCount;
      if (structure === "punk" && detail === "high") {
        punkCoverRect = { ...layout.cover };
        const partBounds = partBoundsSnapshot(model);
        const glassBounds = partBounds.cover;
        const frameBounds = partBounds.frame;
        const inlayBounds = partBounds.spine;
        const labelBounds = partBounds.label;
        const coverWidth = glassBounds ? glassBounds.size[0] : 0;
        const frameWidth = frameBounds ? frameBounds.size[0] : 0;
        const edgeAllowance = Math.max(0.03, frameWidth * 0.05);
        const coverSpansFrontFace = !!glassBounds && !!frameBounds && coverWidth > layout.cover.width &&
          coverWidth >= frameWidth - edgeAllowance * 2 &&
          glassBounds.min[0] <= frameBounds.min[0] + edgeAllowance &&
          glassBounds.max[0] >= frameBounds.max[0] - edgeAllowance;
        const coverDepthZ = glassBounds?.min[2] ?? -Infinity;
        const albumBehindGlass = coverDepthZ > layout.cover.z;
        const glassAheadOfInlay = !!glassBounds && !!inlayBounds && coverDepthZ > inlayBounds.max[2];
        const labelAheadOfGlass = !!glassBounds && !!labelBounds && labelBounds.min[2] > glassBounds.max[2];
        const labelInlayGap = labelBounds && inlayBounds ? labelBounds.min[2] - inlayBounds.max[2] : -Infinity;
        const labelAheadOfInlay = labelInlayGap > 0;
        const partMeshes = part => model.children.filter(child => child instanceof THREE.Mesh && child.userData.casePart === part);
        const coverMeshes = partMeshes("cover");
        const labelMeshes = partMeshes("label");
        const inlayMeshes = partMeshes("spine");
        const trimMeshes = partMeshes("trim");
        const glassRegistration = trimMeshes.filter(mesh => mesh.userData.assemblyPart === "cover");
        const railInlays = trimMeshes.filter(mesh => mesh.userData.assemblyPart !== "cover");
        const registrationFollowsGlass = glassRegistration.length > 0 && railInlays.length > 0 &&
          glassRegistration.every(mesh => mesh.geometry.boundingBox.min.z > glassBounds.max[2]);
        const materialTransmissions = mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          .filter(material => material instanceof THREE.MeshPhysicalMaterial).map(material => material.transmission);
        const shadowAppearance = casePreset("marble", "punk");
        applyCaseAppearance(model, shadowAppearance);
        const noOpaqueGlassShadow = coverMeshes.length > 0 && coverMeshes.every(mesh =>
          !mesh.castShadow && materialTransmissions(mesh).some(value => value > 0));
        const labelCastsShadow = labelMeshes.some(mesh => mesh.visible && mesh.castShadow);
        const labelReceivesShadow = labelMeshes.some(mesh => mesh.visible && mesh.receiveShadow);
        const inlayCastsShadow = inlayMeshes.some(mesh => mesh.visible && mesh.castShadow);
        const inlayReceivesShadow = inlayMeshes.some(mesh => mesh.visible && mesh.receiveShadow);
        punkGeometryAudit = {
          triangleCount,
          partCount: parts.length,
          partBounds,
          coverWidth,
          albumWidth: layout.cover.width,
          frameWidth,
          edgeAllowance,
          coverSpansFrontFace,
          albumDepthZ: layout.cover.z,
          glassFrontDepthZ: coverDepthZ,
          rightInlayDepthZ: inlayBounds?.max[2] ?? null,
          labelBackDepthZ: labelBounds?.min[2] ?? null,
          labelInlayGap,
          albumBehindGlass,
          glassAheadOfInlay,
          labelAheadOfGlass,
          labelAheadOfInlay,
          registrationFollowsGlass,
          shadowAssignments: {
            coverMeshCount: coverMeshes.length,
            coverTransmission: coverMeshes.flatMap(materialTransmissions),
            noOpaqueGlassShadow,
            labelCastsShadow,
            labelReceivesShadow,
            inlayCastsShadow,
            inlayReceivesShadow,
          },
        };
        expect(coverSpansFrontFace, "Punk front glass must span the full shell face and be wider than the album artwork rectangle: " + JSON.stringify({ coverWidth, albumWidth: layout.cover.width, frameWidth, edgeAllowance, coverBounds: glassBounds, frameBounds }));
        expect(albumBehindGlass && glassAheadOfInlay && labelAheadOfGlass,
          "Depth order must place the recessed inlay behind the album plane, the glass ahead of both, and the raised label ahead of glass: " + JSON.stringify({ albumDepthZ: layout.cover.z, glassBounds, inlayBounds, labelBounds }));
        expect(labelAheadOfInlay, "Punk label geometry must sit a positive distance in front of its recessed right inlay.");
        expect(registrationFollowsGlass, "Outer-glass registration lines must retain their cover assembly metadata separately from the frame groove inlays.");
        expect(noOpaqueGlassShadow, "The continuous transmitting front glass must not cast an opaque shadow.");
        expect(labelCastsShadow && labelReceivesShadow && inlayCastsShadow && inlayReceivesShadow,
          "Opaque Punk label and right inlay meshes must retain their cast/receive shadow capabilities.");

        const whiteTubeAppearance = casePreset("white", "punk");
        applyCaseAppearance(model, whiteTubeAppearance, qualityPresets.high);
        const thinWallPartSnapshot = part => {
          const meshes = partMeshes(part);
          const materials = meshes.flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            .filter(material => material instanceof THREE.MeshPhysicalMaterial)
            .map(material => ({
              color: material.color.getHexString(),
              rawTransmission: material.transmission,
              intendedTubeTransmission: material.userData.caseTubeTransmission ?? 0,
              transmissionMode: material.userData.caseTransmissionMode ?? "",
              transparent: material.transparent,
              depthWrite: material.depthWrite,
              side: material.side,
              sideIsFront: material.side === THREE.FrontSide,
            })));
          return {
            meshCount: meshes.length,
            visibleMeshCount: meshes.filter(mesh => mesh.visible).length,
            vertexCount: meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute("position")?.count ?? 0), 0),
            triangleCount: meshes.reduce((sum, mesh) => sum + (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3, 0),
            materials,
          };
        };
        const thinWallOptics = {
          intendedTransmission: whiteTubeAppearance.surfaces.optics.transmission,
          optics: thinWallPartSnapshot("optics"),
          opaqueSleeve: thinWallPartSnapshot("emblem"),
          opaqueAccentCore: thinWallPartSnapshot("accent"),
        };
        const thinWallOpticsValid = thinWallOptics.optics.meshCount > 0 && thinWallOptics.optics.triangleCount > 0 &&
          thinWallOptics.optics.materials.length > 0 && thinWallOptics.optics.materials.every(material =>
            material.rawTransmission === 0 && material.intendedTubeTransmission === thinWallOptics.intendedTransmission &&
            material.transmissionMode === "thin-wall" && material.transparent && !material.depthWrite && material.sideIsFront) &&
          thinWallOptics.opaqueSleeve.meshCount > 0 && thinWallOptics.opaqueSleeve.materials.length > 0 &&
          thinWallOptics.opaqueSleeve.materials.every(material => material.rawTransmission === 0 &&
            material.intendedTubeTransmission === 0 && !material.transparent && material.depthWrite) &&
          thinWallOptics.opaqueAccentCore.meshCount > 0 && thinWallOptics.opaqueAccentCore.triangleCount > 0 &&
          thinWallOptics.opaqueAccentCore.materials.length > 0 && thinWallOptics.opaqueAccentCore.materials.every(material =>
            material.rawTransmission === 0 && material.intendedTubeTransmission === 0 && !material.transparent && material.depthWrite);
        punkGeometryAudit.thinWallOptics = { ...thinWallOptics, valid: thinWallOpticsValid };
        expect(thinWallOpticsValid,
          "Punk White optics must keep its intended Fresnel transmission in caseTubeTransmission while raw volume transmission is zero; the opaque sleeve/core retain visible depth-writing geometry: " + JSON.stringify(thinWallOptics));
        applyCaseAppearance(model, shadowAppearance, qualityPresets.high);

        const baseline = partGeometrySnapshot(model, "frame");
        expect(baseline.length > 0 && baseline.every(mesh => mesh.normals.length > 0), "Punk frame must expose geometry positions and normals for transform checks.");
        const transformedAppearance = casePreset("glass", "punk");
        transformedAppearance.transforms = { frame: {
          visible: false,
          offset: [0.16, -0.09, 0.13],
          rotation: [31, -23, 17],
          scale: [1.11, 0.91, 1.07],
        } };
        applyCaseAppearance(model, transformedAppearance);
        const transformed = partGeometrySnapshot(model, "frame");
        const transformedMaterials = materialSnapshot(model).filter(surface => surface.part === "frame");
        const positionDelta = snapshotDelta(baseline, transformed, "positions");
        const normalDelta = snapshotDelta(baseline, transformed, "normals");
        const hiddenOnTransform = transformedMaterials.length > 0 && transformedMaterials.every(surface => !surface.visible);
        applyCaseAppearance(model, transformedAppearance);
        const repeated = partGeometrySnapshot(model, "frame");
        const repeatDelta = Math.max(snapshotDelta(transformed, repeated, "positions"), snapshotDelta(transformed, repeated, "normals"));
        transformedAppearance.transforms.frame = { visible: true, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
        applyCaseAppearance(model, transformedAppearance);
        const restoredGeometry = partGeometrySnapshot(model, "frame");
        const restoredMaterials = materialSnapshot(model).filter(surface => surface.part === "frame");
        const restorePositionDelta = snapshotDelta(baseline, restoredGeometry, "positions");
        const restoreNormalDelta = snapshotDelta(baseline, restoredGeometry, "normals");
        const visibleAfterRestore = restoredMaterials.length > 0 && restoredMaterials.every(surface => surface.visible);
        transformChecks = {
          frameMeshes: baseline.length,
          positionDelta,
          normalDelta,
          repeatedApplyDelta: repeatDelta,
          restorePositionDelta,
          restoreNormalDelta,
          hiddenOnTransform,
          visibleAfterRestore,
        };
        expect(positionDelta > 0.05 && normalDelta > 0.05 && hiddenOnTransform,
          "Part transform must change actual positions and normals and honor visibility.");
        expect(repeatDelta < 1e-6, "Repeated application of one part transform must not drift.");
        expect(restorePositionDelta < 1e-6 && restoreNormalDelta < 1e-6 && visibleAfterRestore,
          "Resetting a part transform must restore original positions, normals, and visibility.");

        const blueAppearance = casePreset("blue", "punk");
        applyCaseAppearance(model, blueAppearance);
        const blueBaseline = partGeometrySnapshot(model, "frame");
        const blueBaselineHealth = partTangentHealth(model, "frame");
        const blueBaselineAnisotropy = materialSnapshot(model).filter(surface => surface.part === "frame")
          .map(surface => surface.anisotropy);
        const healthyTangentField = health => health.meshCount > 0 && health.missingTangentMeshes === 0 &&
          health.tangentVertexCount > 0 && health.nonFiniteVertexCount === 0 &&
          health.zeroTangentVertexCount === 0 && health.invalidNormalVertexCount === 0 &&
          health.nonzeroVertexCount === health.tangentVertexCount &&
          health.maxAbsNormalizedNormalDot <= 1e-4;
        expect(healthyTangentField(blueBaselineHealth) && blueBaselineAnisotropy.length > 0 &&
          blueBaselineAnisotropy.every(value => Math.abs(value - 0.12) < 1e-6),
        "Blue brushed frame must have finite nonzero tangents orthogonal to its normals and enable anisotropy only on those tangent-bearing materials: " +
          JSON.stringify({ health: blueBaselineHealth, anisotropy: blueBaselineAnisotropy }));

        blueAppearance.transforms = { frame: {
          visible: true,
          offset: [0.16, -0.09, 0.13],
          rotation: [31, -23, 17],
          scale: [1.11, 0.91, 1.07],
        } };
        const blueAppliedTransform = structuredClone(blueAppearance.transforms.frame);
        applyCaseAppearance(model, blueAppearance);
        const blueTransformed = partGeometrySnapshot(model, "frame");
        const blueTransformedHealth = partTangentHealth(model, "frame");
        const blueTransformedAnisotropy = materialSnapshot(model).filter(surface => surface.part === "frame")
          .map(surface => surface.anisotropy);
        const transformedPositionDelta = snapshotDelta(blueBaseline, blueTransformed, "positions");
        const transformedNormalDelta = snapshotDelta(blueBaseline, blueTransformed, "normals");
        const transformedTangentDelta = snapshotDelta(blueBaseline, blueTransformed, "tangents");
        applyCaseAppearance(model, blueAppearance);
        const blueRepeated = partGeometrySnapshot(model, "frame");
        const repeatTangentDelta = snapshotDelta(blueTransformed, blueRepeated, "tangents");
        const repeatGeometryDelta = Math.max(repeatTangentDelta,
          snapshotDelta(blueTransformed, blueRepeated, "positions"),
          snapshotDelta(blueTransformed, blueRepeated, "normals"));
        blueAppearance.transforms.frame = { visible: true, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
        applyCaseAppearance(model, blueAppearance);
        const blueRestored = partGeometrySnapshot(model, "frame");
        const blueRestoredHealth = partTangentHealth(model, "frame");
        const blueRestoredAnisotropy = materialSnapshot(model).filter(surface => surface.part === "frame")
          .map(surface => surface.anisotropy);
        const restoreTangentDelta = snapshotDelta(blueBaseline, blueRestored, "tangents");
        const restoreGeometryDelta = Math.max(restoreTangentDelta,
          snapshotDelta(blueBaseline, blueRestored, "positions"),
          snapshotDelta(blueBaseline, blueRestored, "normals"));
        blueTangentChecks = {
          expectedAnisotropy: 0.12,
          baseline: blueBaselineHealth,
          transformed: blueTransformedHealth,
          restored: blueRestoredHealth,
          baselineAnisotropy: blueBaselineAnisotropy,
          transformedAnisotropy: blueTransformedAnisotropy,
          restoredAnisotropy: blueRestoredAnisotropy,
          transform: blueAppliedTransform,
          transformedPositionDelta,
          transformedNormalDelta,
          transformedTangentDelta,
          repeatedApplyTangentDelta: repeatTangentDelta,
          repeatedApplyGeometryDelta: repeatGeometryDelta,
          resetTangentDelta: restoreTangentDelta,
          resetGeometryDelta: restoreGeometryDelta,
        };
        expect(healthyTangentField(blueTransformedHealth) && transformedPositionDelta > 0.05 &&
          transformedNormalDelta > 0.05 && transformedTangentDelta > 0.01 &&
          blueTransformedAnisotropy.length > 0 && blueTransformedAnisotropy.every(value => Math.abs(value - 0.12) < 1e-6),
        "Blue frame XYZ rotation and nonuniform scale must transform tangent vectors while keeping them finite, nonzero, normal-orthogonal, and anisotropic: " +
          JSON.stringify(blueTangentChecks));
        expect(healthyTangentField(blueRestoredHealth) && repeatGeometryDelta < 1e-6 && restoreGeometryDelta < 1e-6 &&
          blueRestoredAnisotropy.length > 0 && blueRestoredAnisotropy.every(value => Math.abs(value - 0.12) < 1e-6),
        "Repeated Blue transform application must not drift, and identity reset must restore positions, normals, tangents, and anisotropy: " +
          JSON.stringify(blueTangentChecks));
      }
      models.push({
        structure, detail, size: size.toArray(), layoutSize: [layout.width, layout.height, layout.depth],
        sourceLayoutAspectError, renderedAspectError, layoutAspectPreserved, center: center.toArray(), parts, triangleCount, vertexCount,
        materialChanged: changed, opticalDifference: frame?.transmission === 0 && (cover?.transmission ?? 0) > 0,
        coverLayoutMatches, independentCover,
      });
      disposeCaseModel(model);
    }
    expect(punkHighVertices > punkLowVertices, "Punk high detail must contain more geometric detail than low detail.");
    expect(rhineHighTriangles < 86154 && rhineLowTriangles < rhineHighTriangles,
      "Rhine high detail must retain the shell, not the old internal exhibition; low detail must reduce geometry.");
    expect(rhineNativeRestore?.restoredAllNativeParameters && transformChecks?.repeatedApplyDelta < 1e-6,
      "Native-material restoration and transform idempotence must be recorded.");
    expect(coverageFailures.length === 0,
      "Structure-specific case part coverage failed: " + JSON.stringify({ coverageFailures, rhineLowTriangles, rhineHighTriangles, rhineNativeRestore, nativeOpticalEvidence, transformChecks }));

    let initialEditorReady = observations.some(item => item.structure === settings.structure && item.coverMesh === "IndependentAlbumCover");
    for (let attempt = 0; !initialEditorReady && attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 30));
      initialEditorReady = observations.some(item => item.structure === settings.structure && item.coverMesh === "IndependentAlbumCover");
    }
    const editorStatus = {
      previewError: document.querySelector("#editor-host [data-preview-error]")?.textContent ?? "",
      previewErrorHidden: document.querySelector("#editor-host [data-preview-error]")?.hidden ?? null,
      previewCanvas: document.querySelector("#editor-host .case-editor__canvas canvas")?.getBoundingClientRect().toJSON() ?? null,
      observedEditorRenders: observations.filter(item => item.coverMesh === "IndependentAlbumCover").length,
      rendererCalls: rendererCalls.length,
      rendererCallWithCover: rendererCalls.some(call => call.cover),
      shadowEnabledOnRenderedEditor: rendererCalls.some(call => call.cover && call.shadowMapEnabled),
      pcfShadowMapOnRenderedEditor: rendererCalls.some(call => call.cover && call.pcfShadowMap),
      forwardShadowKeyOnRenderedEditor: rendererCalls.some(call => call.cover && call.forwardShadowKey),
      recentCalls: rendererCalls.slice(0, 10),
      structure: settings.structure,
    };
    expect(editorStatus.shadowEnabledOnRenderedEditor && editorStatus.pcfShadowMapOnRenderedEditor &&
      editorStatus.forwardShadowKeyOnRenderedEditor,
    "The live editor WebGL renderer must use PCF shadows and a positive-Z front key light.");
    return { models, punkPresetIds, structureParts, settingsAudit, archiveEnabledMigration, rhineLowTriangles, rhineHighTriangles, nativeOpticalEvidence, rhineNativeRestore, transformChecks, blueTangentChecks, punkGeometryAudit, coverageFailures, punkLowVertices, punkHighVertices, initialEditorReady, editorStatus, musicStyleAudit };
  },
};
`;

const referenceEntry = `
import * as THREE from "three";
import { createCaseModel, applyCaseAppearance, disposeCaseModel } from "./src/case-model.ts";
import { casePreset } from "./src/case-settings.ts";
import { createAlbumInsert } from "./src/album-insert.ts";
import { getCaseLayout } from "./src/case-layout.ts";
import { setCaseAlbumOcclusion } from "./src/case-materials.ts";
import { createAlbumPrintMaterial } from "./src/music-model.ts";
import caseMeta from "./src/assets/style/case/white/case.json";
import { qualityPresets } from "./src/render-quality.ts";
import { createCaseStudioLighting } from "./src/case-studio-lighting.ts";

const PRESETS = ${JSON.stringify(referencePresetIds)};
const ANGLE_PRESETS = ${JSON.stringify(referenceAnglePresetIds)};
const ANGLE_FRAMES = ${JSON.stringify(referenceAngleFrameIds)};
const REGIONS = ${JSON.stringify(referenceRegions)};
const BG = "#dedbd7";
const SCALE = 3.35 / 3.5;
const PPU = 210 / SCALE;
const SIZE = 1000;
const ORIGIN = { x: 500, y: 867.5 };
const CAMERA_CENTER_Y = 1.85;
const ART_RECT = { x: 122, y: 208, width: 584, height: 584 };
const captures = new Map();
const stage = document.querySelector("#reference-stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(BG, 1);
renderer.domElement.id = "case-reference-canvas";
stage.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
const lighting = createCaseStudioLighting(renderer, scene);
lighting.setTheme("day");
lighting.setQuality(qualityPresets.high);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.setClearColor(BG, 1);
const model = await createCaseModel("punk", "high");
// createCaseModel already bakes the native scale and .175 vertical offset.
// Applying them a second time shifts the ROI away from the real surfaces.
scene.add(model);
const layout = getCaseLayout(model);
const modelBounds = new THREE.Box3().setFromObject(model);
const modelCenter = modelBounds.getCenter(new THREE.Vector3());
if (!(layout.insertThickness > 0)) throw new Error("Punk reference GLB must expose a positive paper insert thickness.");
const testCover = document.createElement("canvas");
testCover.width = ART_RECT.width;
testCover.height = ART_RECT.height;
const testCoverContext = testCover.getContext("2d");
if (!testCoverContext) throw new Error("Canvas 2D is unavailable for the reference test cover.");
testCoverContext.fillStyle = "#09111b";
testCoverContext.fillRect(0, 0, testCover.width, testCover.height);
testCoverContext.fillStyle = "#ee653e";
testCoverContext.beginPath(); testCoverContext.moveTo(0, 0); testCoverContext.lineTo(198, 0); testCoverContext.lineTo(0, 198); testCoverContext.closePath(); testCoverContext.fill();
testCoverContext.fillStyle = "#22c9bf";
testCoverContext.beginPath(); testCoverContext.moveTo(584, 315); testCoverContext.lineTo(584, 584); testCoverContext.lineTo(315, 584); testCoverContext.closePath(); testCoverContext.fill();
testCoverContext.strokeStyle = "#ee653e"; testCoverContext.lineWidth = 13;
testCoverContext.beginPath(); testCoverContext.moveTo(70, 420); testCoverContext.lineTo(420, 70); testCoverContext.stroke();
testCoverContext.fillStyle = "#0b1018"; testCoverContext.fillRect(251, 251, 82, 82);
testCoverContext.fillStyle = "#f3eee1"; testCoverContext.textAlign = "left"; testCoverContext.font = "700 44px sans-serif";
testCoverContext.fillText("FIELD NOTES", 58, 333);
testCoverContext.font = "600 22px sans-serif"; testCoverContext.fillText("NIGHT DRIVE / TEST PRESSING 01", 58, 374);
testCoverContext.fillStyle = "#22c9bf"; testCoverContext.font = "700 26px sans-serif"; testCoverContext.fillText("LOCAL AUDIO", 58, 505);
const coverTexture = new THREE.CanvasTexture(testCover);
coverTexture.colorSpace = THREE.SRGBColorSpace;
coverTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
coverTexture.needsUpdate = true;
const albumInsert = createAlbumInsert(layout.cover, layout.insertThickness);
const albumPrint = new THREE.Mesh(
  new THREE.PlaneGeometry(layout.cover.width, layout.cover.height),
  createAlbumPrintMaterial(coverTexture),
);
albumPrint.name = "Synthetic 3D test album print";
albumPrint.position.set(layout.cover.x, layout.cover.y, layout.cover.z);
albumPrint.castShadow = false;
albumPrint.receiveShadow = true;
albumPrint.userData.testAlbumCover = true;
scene.add(albumInsert, albumPrint);
function referenceAlbumState() {
  const flags = [];
  let shellMeshCount = 0;
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.userData.caseAlbumWindow) return;
    shellMeshCount++;
    flags.push(object.userData.caseAlbumPresent === true);
  });
  return {
    albumInsertVisible: albumInsert.visible,
    albumPrintVisible: albumPrint.visible,
    shellMeshCount,
    apiFlags: [...new Set(flags)],
    apiMatchesInsert: shellMeshCount > 0 && flags.every(flag => flag === albumInsert.visible),
  };
}
function setReferenceAlbumState(present) {
  albumInsert.visible = present;
  albumPrint.visible = present;
  setCaseAlbumOcclusion(model, present);
  return referenceAlbumState();
}
function setReferenceOcclusionControl(present) {
  setCaseAlbumOcclusion(model, present);
  return referenceAlbumState();
}
setReferenceAlbumState(true);
const span = SIZE / PPU;
const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 100);
camera.position.set(0, CAMERA_CENTER_Y, 12);
camera.lookAt(0, CAMERA_CENTER_Y, 0);
camera.updateProjectionMatrix();
renderer.render(scene, camera);

function projectedPoint(x, y, z) {
  const ndc = new THREE.Vector3(x, y, z).project(camera);
  return [(ndc.x + 1) * SIZE / 2, (1 - ndc.y) * SIZE / 2];
}

function projectedCoverRect() {
  const corners = [
    projectedPoint(layout.cover.x - layout.cover.width / 2, layout.cover.y + layout.cover.height / 2, layout.cover.z),
    projectedPoint(layout.cover.x + layout.cover.width / 2, layout.cover.y + layout.cover.height / 2, layout.cover.z),
    projectedPoint(layout.cover.x + layout.cover.width / 2, layout.cover.y - layout.cover.height / 2, layout.cover.z),
    projectedPoint(layout.cover.x - layout.cover.width / 2, layout.cover.y - layout.cover.height / 2, layout.cover.z),
  ];
  return {
    x: Math.min(...corners.map(point => point[0])), y: Math.min(...corners.map(point => point[1])),
    width: Math.max(...corners.map(point => point[0])) - Math.min(...corners.map(point => point[0])),
    height: Math.max(...corners.map(point => point[1])) - Math.min(...corners.map(point => point[1])), corners,
  };
}

function cameraBasisFromAxes(axes, ppu) {
  const right = new THREE.Vector3(axes.x[0], axes.z[0], -axes.y[0]).multiplyScalar(1 / ppu).normalize();
  const up = new THREE.Vector3(-axes.x[1], -axes.z[1], axes.y[1]).multiplyScalar(1 / ppu);
  up.addScaledVector(right, -up.dot(right)).normalize();
  const forward = new THREE.Vector3().crossVectors(right, up).normalize();
  return { right, up, forward };
}

function basisQuaternion(right, up, forward) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
}

const inspectStartBasis = cameraBasisFromAxes(caseMeta.axes, caseMeta.array_ppu);
const inspectStartRotation = basisQuaternion(inspectStartBasis.right, inspectStartBasis.up, inspectStartBasis.forward);
const inspectFinalForward = new THREE.Vector3(0.16, -0.06, 0.985).normalize();
const inspectFinalRight = new THREE.Vector3(0, 1, 0).cross(inspectFinalForward).normalize();
const inspectFinalUp = new THREE.Vector3().crossVectors(inspectFinalForward, inspectFinalRight).normalize();
const inspectEndRotation = basisQuaternion(inspectFinalRight, inspectFinalUp, inspectFinalForward);

function inspectCameraAt(index) {
  const sourceQuad = caseMeta.inspect[index].cover;
  const rect = layout.cover;
  const sourceScale = Number.isFinite(layout.sourceScale) && layout.sourceScale > 0 ? layout.sourceScale : SCALE;
  const ppu = caseMeta.inspect_ppu / sourceScale;
  const [topLeft, topRight, bottomRight, bottomLeft] = sourceQuad;
  const screenX = new THREE.Vector2((topRight[0] - topLeft[0]) / rect.width, (topRight[1] - topLeft[1]) / rect.width);
  const screenY = new THREE.Vector2((topLeft[0] - bottomLeft[0]) / rect.height, (topLeft[1] - bottomLeft[1]) / rect.height);
  const rightX = screenX.x / ppu;
  const rightY = screenY.x / ppu;
  const upX = -screenX.y / ppu;
  const upY = -screenY.y / ppu;
  const rightZSquared = 1 - rightX * rightX - rightY * rightY;
  const upZSquared = 1 - upX * upX - upY * upY;
  const denominator = Math.max(1, caseMeta.inspect.length - 1);
  const expectedRotation = inspectStartRotation.clone().slerp(inspectEndRotation, index / denominator);
  const expectedForward = new THREE.Vector3(0, 0, 1).applyQuaternion(expectedRotation).normalize();
  let best = null;
  if (rightZSquared >= -0.03 && upZSquared >= -0.03) {
    for (const rightSign of [-1, 1]) for (const upSign of [-1, 1]) {
      const right = new THREE.Vector3(rightX, rightY, rightSign * Math.sqrt(Math.max(0, rightZSquared))).normalize();
      let up = new THREE.Vector3(upX, upY, upSign * Math.sqrt(Math.max(0, upZSquared)));
      up.addScaledVector(right, -up.dot(right)).normalize();
      const forward = new THREE.Vector3().crossVectors(right, up).normalize();
      const score = Math.abs(right.dot(up)) + (forward.z < 0 ? 2 : 0) + (1 - forward.dot(expectedForward)) * 0.1;
      if (!best || score < best.score) best = { right, up, forward, score };
    }
  }
  if (!best) {
    const rotation = expectedRotation;
    best = {
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).normalize(),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).normalize(),
      forward: new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).normalize(),
      score: Infinity,
    };
  }
  const { right, up, forward } = best;
  const [width, height] = caseMeta.inspect_res;
  const viewCamera = new THREE.OrthographicCamera(
    -width / (2 * ppu), width / (2 * ppu), height / (2 * ppu), -height / (2 * ppu), 0.01, 100,
  );
  viewCamera.position.copy(modelCenter).addScaledVector(forward, 20);
  viewCamera.quaternion.copy(basisQuaternion(right, up, forward));
  viewCamera.updateProjectionMatrix();
  viewCamera.updateMatrixWorld(true);
  // Fit image-plane translation from the source quad center. This uses the
  // already normalized model layout; it does not rescale the GLB geometry.
  const initialQuad = projectedCoverQuad(viewCamera, width, height);
  const sourceCenter = sourceQuad.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
  const renderedCenter = initialQuad.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
  const targetShift = new THREE.Vector3()
    .addScaledVector(right, (renderedCenter[0] - sourceCenter[0]) / ppu)
    .addScaledVector(up, -(renderedCenter[1] - sourceCenter[1]) / ppu);
  viewCamera.position.add(targetShift);
  viewCamera.updateMatrixWorld(true);
  const finalError = quadMaxError(projectedCoverQuad(viewCamera, width, height), sourceQuad);
  viewCamera.userData.sourceProjection = {
    index,
    sourcePpu: caseMeta.inspect_ppu,
    normalizedModelScale: sourceScale,
    renderedPpu: ppu,
    basisResidual: Number(best.score.toFixed(6)),
    maxCoverCornerResidualPixels: finalError,
  };
  return viewCamera;
}

function projectPointWithCamera(point, viewCamera, width, height) {
  const ndc = point.clone().project(viewCamera);
  return [(ndc.x + 1) * width / 2, (1 - ndc.y) * height / 2];
}

function projectedCoverQuad(viewCamera, width, height) {
  const rect = layout.cover;
  return [
    projectPointWithCamera(new THREE.Vector3(rect.x - rect.width / 2, rect.y + rect.height / 2, rect.z), viewCamera, width, height),
    projectPointWithCamera(new THREE.Vector3(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.z), viewCamera, width, height),
    projectPointWithCamera(new THREE.Vector3(rect.x + rect.width / 2, rect.y - rect.height / 2, rect.z), viewCamera, width, height),
    projectPointWithCamera(new THREE.Vector3(rect.x - rect.width / 2, rect.y - rect.height / 2, rect.z), viewCamera, width, height),
  ];
}

function quadMaxError(left, right) {
  let maximum = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index++)
    maximum = Math.max(maximum, Math.hypot(left[index][0] - right[index][0], left[index][1] - right[index][1]));
  return maximum;
}

function renderCameraAtSize(viewCamera, width, height) {
  renderer.setSize(width, height, false);
  renderer.render(scene, viewCamera);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(renderer.domElement, 0, 0, width, height);
  return canvas;
}

function drawImageToQuad(context, source, quad) {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  context.save();
  context.beginPath();
  context.moveTo(topLeft[0], topLeft[1]);
  context.lineTo(topRight[0], topRight[1]);
  context.lineTo(bottomRight[0], bottomRight[1]);
  context.lineTo(bottomLeft[0], bottomLeft[1]);
  context.closePath();
  context.clip();
  context.setTransform(
    (topRight[0] - topLeft[0]) / source.width,
    (topRight[1] - topLeft[1]) / source.width,
    (bottomLeft[0] - topLeft[0]) / source.height,
    (bottomLeft[1] - topLeft[1]) / source.height,
    topLeft[0], topLeft[1],
  );
  context.drawImage(source, 0, 0);
  context.restore();
}

function pixelRect(region) {
  return {
    left: Math.max(0, Math.floor(ORIGIN.x + region.x[0] * 210)),
    right: Math.min(SIZE, Math.ceil(ORIGIN.x + region.x[1] * 210)),
    top: Math.max(0, Math.floor(ORIGIN.y - region.z[1] * 210)),
    bottom: Math.min(SIZE, Math.ceil(ORIGIN.y - region.z[0] * 210)),
  };
}

function summarizePixels(canvas, region) {
  const rect = pixelRect(region);
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width < 1 || height < 1) throw new Error("A reference color sample region fell outside the image.");
  const pixels = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(rect.left, rect.top, width, height).data;
  const channels = [[], [], []];
  const mean = [0, 0, 0];
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels[index + channel];
      channels[channel].push(value);
      mean[channel] += value;
    }
    count++;
  }
  if (!count) throw new Error("A reference color sample region contains no visible pixels.");
  const median = channels.map(values => {
    values.sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
  });
  return {
    pixelRect: { x: rect.left, y: rect.top, width, height },
    count,
    medianSrgb8: median,
    meanSrgb8: mean.map(value => Number((value / count).toFixed(2))),
  };
}

async function loadPresetImage(id) {
  const response = await fetch("/assets/style/case/" + encodeURIComponent(id) + "/hero-clear.png", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the whitelisted hero image for " + id + ": " + response.status);
  return createImageBitmap(await response.blob());
}

async function loadInspectImage(id, index) {
  const frame = String(index).padStart(2, "0");
  const response = await fetch("/assets/style/case/" + encodeURIComponent(id) + "/inspect-" + frame + ".png", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load whitelisted inspect source " + id + "/" + frame + ": " + response.status);
  return createImageBitmap(await response.blob());
}

function imageCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  return canvas;
}

function copyRendererCanvas() {
  const canvas = imageCanvas();
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
  return canvas;
}

function samplePixel(canvas, point) {
  const x = Math.max(0, Math.min(SIZE - 1, Math.round(point[0])));
  const y = Math.max(0, Math.min(SIZE - 1, Math.round(point[1])));
  return [...canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data];
}

function angleSourceCanvas(rawImage, index) {
  const [width, height] = caseMeta.inspect_res;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = BG;
  context.fillRect(0, 0, width, height);
  const frame = caseMeta.inspect[index];
  // The source PNG is cropped; crop is its destination rectangle in the 900px
  // virtual projection. Draw the same opaque artwork into the published quad
  // first, then place the source raster glass/highlight layer over it.
  drawImageToQuad(context, testCover, frame.cover);
  const [cropX, cropY, cropWidth, cropHeight] = frame.crop;
  context.drawImage(rawImage, cropX, cropY, cropWidth, cropHeight);
  return canvas;
}

function partMaterialEvidence(part, appearance) {
  const materials = [];
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.casePart !== part) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
      materials.push({
        type: material.type,
        color: material.color.getHexString(),
        roughness: material.roughness,
        metalness: material.metalness,
        anisotropy: material.anisotropy,
        transmission: material.transmission,
        clearcoat: material.clearcoat,
        clearcoatRoughness: material.clearcoatRoughness,
        iridescence: material.iridescence,
        envMap: !!material.envMap,
        envMapIntensity: material.envMapIntensity,
        clearcoatMap: !!material.clearcoatMap,
        clearcoatRoughnessMap: !!material.clearcoatRoughnessMap,
      });
    }
  });
  const unique = new Map(materials.map(value => [JSON.stringify(value), value]));
  return {
    part,
    sceneEnvironmentAssigned: !!scene.environment,
    sceneEnvironmentMapping: scene.environment?.mapping ?? null,
    presetSurface: appearance.surfaces[part] ? {
      pattern: appearance.surfaces[part].pattern ?? "none",
      gradientAngle: appearance.surfaces[part].gradientAngle ?? 90,
      clearcoatRoughness: appearance.surfaces[part].clearcoatRoughness ?? null,
      roughness: appearance.surfaces[part].roughness,
    } : null,
    meshCount: materials.length,
    materials: [...unique.values()],
  };
}

function findSharedFramePoint(cameraA, cameraB) {
  const [width, height] = caseMeta.inspect_res;
  const raycaster = new THREE.Raycaster();
  model.updateMatrixWorld(true);
  const frameBounds = new THREE.Box3().makeEmpty();
  const frameMeshes = [];
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.casePart !== "frame") return;
    object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) frameBounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    frameMeshes.push(object);
  });
  const candidates = [];
  for (const object of frameMeshes) {
    const position = object.geometry.getAttribute("position");
    if (!position) continue;
    const index = object.geometry.getIndex();
    const triangleCount = Math.floor((index?.count ?? position.count) / 3);
    const stride = Math.max(1, Math.floor(triangleCount / 900));
    for (let triangle = 0; triangle < triangleCount; triangle += stride) {
      const vertexIndices = [0, 1, 2].map(corner => index
        ? index.getX(triangle * 3 + corner)
        : triangle * 3 + corner);
      const point = new THREE.Vector3();
      for (const vertexIndex of vertexIndices)
        point.add(new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(object.matrixWorld).multiplyScalar(1 / 3));
      if (point.y < frameBounds.max.y - 0.38 || Math.abs(point.x) > 1.25 || point.z < frameBounds.max.z - 0.45) continue;
      const viewScore = Math.abs(point.x) + Math.abs(point.y - (frameBounds.max.y - 0.12)) +
        1.5 * Math.abs(point.z - frameBounds.max.z);
      candidates.push({ object, point, viewScore, triangle });
    }
  }
  candidates.sort((left, right) => left.viewScore - right.viewScore);
  const hitPointFrom = (viewCamera, point) => {
    const screen = projectPointWithCamera(point, viewCamera, width, height);
    if (screen[0] < 0 || screen[0] >= width || screen[1] < 0 || screen[1] >= height) return null;
    const ndc = new THREE.Vector2(2 * screen[0] / width - 1, 1 - 2 * screen[1] / height);
    raycaster.setFromCamera(ndc, viewCamera);
    const hit = raycaster.intersectObject(model, true)[0];
    return hit && hit.object.userData.casePart === "frame" && hit.point.distanceTo(point) <= 0.02
      ? { screen, hit }
      : null;
  };
  for (const candidate of candidates) {
    const first = hitPointFrom(cameraA, candidate.point);
    const second = hitPointFrom(cameraB, candidate.point);
    if (!first || !second) continue;
    return {
      part: "frame",
      objectName: candidate.object.name || candidate.object.userData.surface || "frame mesh",
      objectUuid: candidate.object.uuid,
      worldPoint: candidate.point.toArray(),
      viewA: { index: 45, screen: first.screen },
      viewB: { index: 59, screen: second.screen },
      viewAHitDistance: first.hit.point.distanceTo(candidate.point),
      viewBHitDistance: second.hit.point.distanceTo(candidate.point),
      selectionMethod: "sampled triangle centroids from the real top/front frame geometry and confirmed both camera rays hit the same world point",
    };
  }

  // Fallback scan stays within the same actual top-frame surface; it never uses
  // a center pixel or compares unrelated points between views.
  for (let y = 12; y <= 140; y += 6) {
    for (let x = 270; x <= 570; x += 6) {
      const ndcA = new THREE.Vector2(2 * x / width - 1, 1 - 2 * y / height);
      raycaster.setFromCamera(ndcA, cameraA);
      const first = raycaster.intersectObject(model, true)[0];
      if (!first || first.object.userData.casePart !== "frame") continue;
      const point = first.point.clone();
      const screenB = projectPointWithCamera(point, cameraB, width, height);
      if (screenB[0] < 0 || screenB[0] >= width || screenB[1] < 0 || screenB[1] >= height) continue;
      const ndcB = new THREE.Vector2(2 * screenB[0] / width - 1, 1 - 2 * screenB[1] / height);
      raycaster.setFromCamera(ndcB, cameraB);
      const second = raycaster.intersectObject(model, true)[0];
      if (!second || second.object.userData.casePart !== "frame" || second.point.distanceTo(point) > 0.01) continue;
      return {
        part: "frame",
        objectName: first.object.name || first.object.userData.surface || "frame mesh",
        objectUuid: first.object.uuid,
        worldPoint: point.toArray(),
        viewA: { index: 45, screen: [x, y] },
        viewB: { index: 59, screen: screenB },
        viewBHitDistance: second.point.distanceTo(point),
        selectionMethod: "camera-raycast grid confirmed the same world point on the frame in both views",
      };
    }
  }
  throw new Error("Could not find one Punk top/front frame point visible in both inspect-45 and inspect-59 cameras; sampled " + candidates.length + " real frame triangle centroids.");
}

function framePointRoi(canvas, cameraForPoint, point) {
  const [width, height] = caseMeta.inspect_res;
  const center = projectPointWithCamera(new THREE.Vector3(...point), cameraForPoint, width, height);
  const size = 25;
  const rect = {
    x: Math.max(0, Math.min(width - size, Math.round(center[0] - size / 2))),
    y: Math.max(0, Math.min(height - size, Math.round(center[1] - size / 2))),
    width: size,
    height: size,
  };
  const pixels = canvas.getContext("2d", { willReadFrequently: true }).getImageData(rect.x, rect.y, size, size).data;
  let red = 0, green = 0, blue = 0, luminance = 0, maxLuminance = 0, count = 0, nonBackground = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const value = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
    if (Math.abs(pixels[index] - 222) + Math.abs(pixels[index + 1] - 219) + Math.abs(pixels[index + 2] - 215) > 18) nonBackground++;
    red += pixels[index]; green += pixels[index + 1]; blue += pixels[index + 2];
    luminance += value; maxLuminance = Math.max(maxLuminance, value); count++;
  }
  return {
    center,
    rect,
    pixels: count,
    nonBackgroundPixels: nonBackground,
    nonBackgroundFraction: Number((nonBackground / Math.max(1, count)).toFixed(4)),
    meanSrgb8: [red, green, blue].map(value => Number((value / Math.max(1, count)).toFixed(2))),
    meanLuminance: Number((luminance / Math.max(1, count)).toFixed(3)),
    maxLuminance: Number(maxLuminance.toFixed(2)),
  };
}

function roiDelta(left, right) {
  return Number((left.meanSrgb8.reduce((sum, value, index) => sum + Math.abs(value - right.meanSrgb8[index]), 0) / 3).toFixed(3));
}

function drawRoi(canvas, source, roi, destination) {
  const context = canvas.getContext("2d");
  context.drawImage(source, roi.rect.x, roi.rect.y, roi.rect.width, roi.rect.height,
    destination.x, destination.y, destination.width, destination.height);
}

function rgbDistance(left, right) {
  return Math.hypot(...left.slice(0, 3).map((value, index) => value - right[index]));
}

function changeAverage(canvasA, canvasB, region) {
  const rect = pixelRect(region);
  const contextA = canvasA.getContext("2d", { willReadFrequently: true });
  const contextB = canvasB.getContext("2d", { willReadFrequently: true });
  const a = contextA.getImageData(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top).data;
  const b = contextB.getImageData(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top).data;
  let total = 0;
  let count = 0;
  for (let index = 0; index < a.length; index += 4) {
    if (a[index + 3] === 0 && b[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel++) { total += Math.abs(a[index + channel] - b[index + channel]); count++; }
  }
  return count ? Number((total / count).toFixed(3)) : 0;
}

function regionColorSpread(canvas, region) {
  const rect = pixelRect(region);
  const pixels = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top).data;
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  const colors = new Set();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel++) {
      min[channel] = Math.min(min[channel], pixels[index + channel]);
      max[channel] = Math.max(max[channel], pixels[index + channel]);
    }
    colors.add((pixels[index] >> 3) + "," + (pixels[index + 1] >> 3) + "," + (pixels[index + 2] >> 3));
  }
  return { minSrgb8: min, maxSrgb8: max, quantizedColors: colors.size };
}

function projectedWorldRect(x0, y0, x1, y1, z) {
  const first = projectedPoint(x0, y1, z);
  const second = projectedPoint(x1, y0, z);
  const left = Math.max(0, Math.floor(Math.min(first[0], second[0])));
  const right = Math.min(SIZE, Math.ceil(Math.max(first[0], second[0])));
  const top = Math.max(0, Math.floor(Math.min(first[1], second[1])));
  const bottom = Math.min(SIZE, Math.ceil(Math.max(first[1], second[1])));
  if (right <= left || bottom <= top) throw new Error("A world-space shadow sample fell outside the reference render.");
  return { left, top, width: right - left, height: bottom - top };
}

function summarizeCanvasRect(canvas, rect) {
  const pixels = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(rect.left, rect.top, rect.width, rect.height).data;
  const channels = [0, 0, 0];
  let luminance = 0;
  let minimum = 255;
  let maximum = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const value = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
    for (let channel = 0; channel < 3; channel++) channels[channel] += pixels[index + channel];
    luminance += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    count++;
  }
  return {
    rect,
    pixels: count,
    meanSrgb8: channels.map(value => Number((value / Math.max(1, count)).toFixed(2))),
    meanLuminance: Number((luminance / Math.max(1, count)).toFixed(3)),
    minLuminance: Number(minimum.toFixed(2)),
    maxLuminance: Number(maximum.toFixed(2)),
  };
}

function sampleCanvasPointRoi(canvas, point, size = 21) {
  const rect = {
    left: Math.max(0, Math.min(SIZE - size, Math.round(point[0] - size / 2))),
    top: Math.max(0, Math.min(SIZE - size, Math.round(point[1] - size / 2))),
    width: size,
    height: size,
  };
  return summarizeCanvasRect(canvas, rect);
}

function meanColorDelta(left, right) {
  return Number((left.meanSrgb8.reduce((sum, value, index) => sum + Math.abs(value - right.meanSrgb8[index]), 0) / 3).toFixed(3));
}

function caseCardVisibilityAt(position, receiverNormal) {
  const rect = layout.cover;
  if (position.z >= rect.z - 1e-5) return 1;
  const corners = [
    [rect.x - rect.width / 2, rect.y - rect.height / 2, rect.z],
    [rect.x + rect.width / 2, rect.y - rect.height / 2, rect.z],
    [rect.x + rect.width / 2, rect.y + rect.height / 2, rect.z],
    [rect.x - rect.width / 2, rect.y + rect.height / 2, rect.z],
  ].map(point => new THREE.Vector3(...point).sub(position).normalize());
  let blocked = 0;
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index], b = corners[(index + 1) % corners.length];
    const edgeNormal = new THREE.Vector3().crossVectors(a, b);
    const edgeLength = edgeNormal.length();
    blocked += Math.atan2(edgeLength, THREE.MathUtils.clamp(a.dot(b), -1, 1)) *
      edgeNormal.dot(receiverNormal) / Math.max(edgeLength, 1e-7);
  }
  return THREE.MathUtils.clamp(1 - blocked / (Math.PI * 2), 0, 1);
}

function meshTriangleCandidates(object, predicate) {
  const geometry = object.geometry;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (!position || !normal) return [];
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);
  const result = [];
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const vertices = [0, 1, 2].map(corner => index
      ? index.getX(triangle * 3 + corner)
      : triangle * 3 + corner);
    const point = new THREE.Vector3();
    const receiverNormal = new THREE.Vector3();
    for (const vertex of vertices) {
      point.add(new THREE.Vector3().fromBufferAttribute(position, vertex).multiplyScalar(1 / 3));
      receiverNormal.add(new THREE.Vector3().fromBufferAttribute(normal, vertex).multiplyScalar(1 / 3));
    }
    receiverNormal.normalize();
    if (predicate(point, receiverNormal)) result.push({ object, triangle, point, receiverNormal });
  }
  return result;
}

function firstReferenceRayHit(point) {
  const screen = projectedPoint(point.x, point.y, point.z);
  if (screen[0] < 0 || screen[0] >= SIZE || screen[1] < 0 || screen[1] >= SIZE) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(2 * screen[0] / SIZE - 1, 1 - 2 * screen[1] / SIZE), camera);
  const first = raycaster.intersectObject(scene, true)[0];
  return first ? { screen, first } : null;
}

function findAlbumGutterProbe() {
  const rect = layout.cover;
  const right = rect.x + rect.width / 2;
  const candidates = [];
  model.updateMatrixWorld(true);
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !["spine", "back"].includes(object.userData.casePart)) return;
    const values = meshTriangleCandidates(object, (point, normal) => {
      return point.z < rect.z - 0.005 && normal.z > 0.25 &&
        point.x > right + 0.004 && point.x < right + 0.38 &&
        point.y > rect.y - rect.height * 0.38 && point.y < rect.y + rect.height * 0.38;
    });
    for (const candidate of values) {
      const visibility = caseCardVisibilityAt(candidate.point, candidate.receiverNormal);
      if (visibility >= 0.995) continue;
      const screen = projectedPoint(candidate.point.x, candidate.point.y, candidate.point.z);
      if (screen[0] < 0 || screen[0] >= SIZE || screen[1] < 0 || screen[1] >= SIZE) continue;
      const edgeDistance = candidate.point.x - right;
      const score = Math.abs(visibility - 0.48) + edgeDistance * 0.22 + Math.abs(candidate.point.y - rect.y) * 0.015;
      candidates.push({ ...candidate, visibility, edgeDistance, screen, score });
    }
  });
  candidates.sort((left, rightCandidate) => left.score - rightCandidate.score);
  const selected = candidates.slice(0, 240).find(candidate => {
    const ray = firstReferenceRayHit(candidate.point);
    if (!ray) return false;
    const hitPart = ray.first.object.userData.casePart ?? "";
    if (hitPart !== "cover" && hitPart !== candidate.object.userData.casePart) return false;
    candidate.screen = ray.screen;
    candidate.hitPart = hitPart;
    return true;
  });
  if (!selected) throw new Error("Could not find a visible real Punk inner-gutter/backboard probe with nontrivial insert form factor.");
  return {
    part: selected.object.userData.casePart,
    mesh: selected.object.name || selected.object.userData.surface || "inner shell",
    triangle: selected.triangle,
    worldPoint: selected.point.toArray(),
    normal: selected.receiverNormal.toArray(),
    screen: selected.screen,
    firstRayHit: selected.hitPart,
    expectedUnoccludedDiffuseFraction: Number(selected.visibility.toFixed(4)),
    distanceOutsideAlbumEdge: Number(selected.edgeDistance.toFixed(4)),
    selection: "actual visible back/spine triangle just outside the real insert rectangle; selected by the same rectangular cosine form-factor math used by the shader",
  };
}

function findFrontFrameControlProbe() {
  const rect = layout.cover;
  const candidates = [];
  model.updateMatrixWorld(true);
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.casePart !== "frame") return;
    const values = meshTriangleCandidates(object, (point, normal) =>
      point.z > rect.z + 0.01 && normal.z > 0.35 &&
      point.y > rect.y + rect.height / 2 + 0.04 && Math.abs(point.x - rect.x) < 1.15);
    for (const candidate of values) {
      const screen = projectedPoint(candidate.point.x, candidate.point.y, candidate.point.z);
      if (screen[0] < 0 || screen[0] >= SIZE || screen[1] < 0 || screen[1] >= SIZE) continue;
      const score = Math.abs(candidate.point.x - rect.x) + Math.abs(candidate.point.y - (rect.y + rect.height / 2 + 0.13));
      candidates.push({ ...candidate, screen, score });
    }
  });
  candidates.sort((left, right) => left.score - right.score);
  const selected = candidates.slice(0, 240).find(candidate => {
    const ray = firstReferenceRayHit(candidate.point);
    if (!ray || ray.first.object.userData.casePart !== "frame") return false;
    candidate.screen = ray.screen;
    return true;
  });
  if (!selected) throw new Error("Could not find a visible Punk front-frame control ROI ahead of the album card.");
  return {
    part: "frame",
    mesh: selected.object.name || selected.object.userData.surface || "front frame",
    triangle: selected.triangle,
    worldPoint: selected.point.toArray(),
    screen: selected.screen,
    firstRayHit: "frame",
    selection: "raycast-confirmed front-frame triangle in front of the card plane",
  };
}

function captureAlbumOcclusionEnvironmentHemi() {
  const presets = ["white", "red", "glass"];
  const gutterProbe = findAlbumGutterProbe();
  const frameProbe = findFrontFrameControlProbe();
  const printScreen = projectedPoint(layout.cover.x, layout.cover.y, layout.cover.z + 0.008);
  const directionalLights = [];
  const nonHemisphereDirectLights = [];
  scene.traverse(object => {
    if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight || object instanceof THREE.SpotLight) {
      nonHemisphereDirectLights.push(object);
      directionalLights.push({ object, visible: object.visible });
      object.visible = false;
    }
  });
  if (!directionalLights.length) throw new Error("Indirect-only album occlusion A/B requires at least one direct light to hide.");
  const lightingBefore = {
    environmentAssigned: !!scene.environment,
    environmentIntensity: scene.environmentIntensity,
    hemisphere: [],
  };
  scene.traverse(object => {
    if (object instanceof THREE.HemisphereLight) lightingBefore.hemisphere.push({
      visible: object.visible,
      intensity: object.intensity,
      sky: object.color.getHexString(),
      ground: object.groundColor.getHexString(),
    });
  });
  const cellWidth = 350;
  const headerHeight = 34;
  const rowHeight = 350;
  const contact = document.createElement("canvas");
  contact.width = cellWidth * 3;
  contact.height = headerHeight + rowHeight * presets.length;
  const context = contact.getContext("2d");
  context.fillStyle = BG;
  context.fillRect(0, 0, contact.width, contact.height);
  context.fillStyle = "#242932";
  context.fillRect(0, 0, contact.width, headerHeight);
  context.fillStyle = "#fff";
  context.font = "700 13px sans-serif";
  context.fillText("PUNK · ENVIRONMENT + HEMISPHERE ONLY · SAME REAL CARD / API A-B / ABSENT CONTROL", 10, 22);

  const captures = [];
  try {
    for (const [presetIndex, id] of presets.entries()) {
      const appearance = setReferenceAppearance(id);
      const onState = setReferenceAlbumState(true);
      if (!onState.apiMatchesInsert || !onState.albumPrintVisible)
        throw new Error("A real insert-present reference capture must have its print, geometry, and shader API all enabled: " + JSON.stringify(onState));
      renderer.render(scene, camera);
      const on = copyRendererCanvas();
      const onGutter = sampleCanvasPointRoi(on, gutterProbe.screen, 23);
      const onFrame = sampleCanvasPointRoi(on, frameProbe.screen, 23);
      const onPrint = sampleCanvasPointRoi(on, printScreen, 23);

      const controlState = setReferenceOcclusionControl(false);
      if (!controlState.albumInsertVisible || !controlState.albumPrintVisible || controlState.apiFlags.length !== 1 || controlState.apiFlags[0] !== false)
        throw new Error("The no-occlusion shader control must retain the actual card/print geometry while explicitly disabling only the test API.");
      renderer.render(scene, camera);
      const occlusionOffControl = copyRendererCanvas();
      const offGutter = sampleCanvasPointRoi(occlusionOffControl, gutterProbe.screen, 23);
      const offFrame = sampleCanvasPointRoi(occlusionOffControl, frameProbe.screen, 23);
      const offPrint = sampleCanvasPointRoi(occlusionOffControl, printScreen, 23);

      const absentState = setReferenceAlbumState(false);
      if (absentState.albumInsertVisible || absentState.albumPrintVisible || !absentState.apiMatchesInsert || absentState.apiFlags.some(Boolean))
        throw new Error("A real no-insert reference capture must hide both card layers and disable shader occlusion: " + JSON.stringify(absentState));
      renderer.render(scene, camera);
      const absent = copyRendererCanvas();

      const gutterDarkening = Number((offGutter.meanLuminance - onGutter.meanLuminance).toFixed(3));
      const frameDelta = meanColorDelta(onFrame, offFrame);
      const printDelta = meanColorDelta(onPrint, offPrint);
      const rowY = headerHeight + presetIndex * rowHeight;
      const variants = [
        { image: on, label: "INSERT + OCCLUSION ON" },
        { image: occlusionOffControl, label: "SAME INSERT · API OFF TEST CONTROL" },
        { image: absent, label: "NO INSERT + API OFF" },
      ];
      for (const [column, variant] of variants.entries()) {
        const x = column * cellWidth;
        context.fillStyle = "#242932";
        context.fillRect(x + 5, rowY + 5, cellWidth - 10, 19);
        context.fillStyle = "#fff";
        context.font = "600 10px sans-serif";
        context.fillText(id.toUpperCase() + " · " + variant.label, x + 9, rowY + 19, cellWidth - 18);
        context.drawImage(variant.image, 0, 0, SIZE, SIZE, x + 7, rowY + 29, cellWidth - 14, cellWidth - 14);
        const marker = (point, color) => {
          context.strokeStyle = color;
          context.lineWidth = 2;
          context.strokeRect(x + 7 + point[0] / SIZE * (cellWidth - 14) - 5,
            rowY + 29 + point[1] / SIZE * (cellWidth - 14) - 5, 10, 10);
        };
        marker(gutterProbe.screen, "#fa4d5d");
        marker(frameProbe.screen, "#37c78b");
      }
      captures.push({
        preset: id,
        material: partMaterialEvidence("back", appearance),
        realInsert: onState,
        shaderOffDiagnosticControl: {
          ...controlState,
          diagnosticOnly: true,
          explanation: "Same physical insert and print remain visible; only the test shader API is forced false to isolate its indirect-light contribution.",
        },
        absentInsert: absentState,
        innerGutter: { probe: gutterProbe, withOcclusion: onGutter, shaderOff: offGutter, meanDarkening: gutterDarkening },
        frontFrameControl: { probe: frameProbe, withOcclusion: onFrame, shaderOff: offFrame, meanColorDelta: frameDelta },
        paperPrintControl: { screen: printScreen, withOcclusion: onPrint, shaderOff: offPrint, meanColorDelta: printDelta },
        visiblePixelPolicy: "Same real geometry and camera for the diagnostic A/B; separate absent capture proves the production card/API lifecycle is synchronized.",
      });
    }
  } finally {
    for (const state of directionalLights) state.object.visible = state.visible;
    setReferenceAlbumState(true);
    renderer.render(scene, camera);
  }
  const lightingAfter = {
    environmentAssigned: !!scene.environment,
    environmentIntensity: scene.environmentIntensity,
    hemisphere: [],
  };
  scene.traverse(object => {
    if (object instanceof THREE.HemisphereLight) lightingAfter.hemisphere.push({
      visible: object.visible,
      intensity: object.intensity,
      sky: object.color.getHexString(),
      ground: object.groundColor.getHexString(),
    });
  });
  return {
    presets,
    directionalLightsHidden: directionalLights.length,
    nonHemisphereDirectLightsHidden: nonHemisphereDirectLights.length,
    environmentAndHemisphereUnchanged: JSON.stringify(lightingBefore) === JSON.stringify(lightingAfter),
    lightingBefore,
    lightingAfter,
    rendererShadowMapEnabled: renderer.shadowMap.enabled,
    probes: { innerGutter: gutterProbe, frontFrame: frameProbe, paperPrint: printScreen },
    captures,
    contactSheet: contact.toDataURL("image/png"),
  };
}

function compareCanvasRects(castFrame, noCastFrame, rect) {
  const cast = castFrame.getContext("2d", { willReadFrequently: true })
    .getImageData(rect.left, rect.top, rect.width, rect.height).data;
  const noCast = noCastFrame.getContext("2d", { willReadFrequently: true })
    .getImageData(rect.left, rect.top, rect.width, rect.height).data;
  let castLuminance = 0;
  let noCastLuminance = 0;
  let darkerPixels = 0;
  let maxDarkening = 0;
  let count = 0;
  for (let index = 0; index < cast.length; index += 4) {
    if (cast[index + 3] === 0 || noCast[index + 3] === 0) continue;
    const castValue = cast[index] * 0.2126 + cast[index + 1] * 0.7152 + cast[index + 2] * 0.0722;
    const noCastValue = noCast[index] * 0.2126 + noCast[index + 1] * 0.7152 + noCast[index + 2] * 0.0722;
    const darkening = noCastValue - castValue;
    castLuminance += castValue;
    noCastLuminance += noCastValue;
    if (darkening > 1) darkerPixels++;
    maxDarkening = Math.max(maxDarkening, darkening);
    count++;
  }
  return {
    pixels: count,
    castMeanLuminance: Number((castLuminance / Math.max(1, count)).toFixed(3)),
    noCastMeanLuminance: Number((noCastLuminance / Math.max(1, count)).toFixed(3)),
    meanDarkening: Number(((noCastLuminance - castLuminance) / Math.max(1, count)).toFixed(3)),
    darkerPixelFraction: Number((darkerPixels / Math.max(1, count)).toFixed(4)),
    maxDarkening: Number(maxDarkening.toFixed(3)),
  };
}

function setReferenceAppearance(id, backColor) {
  const appearance = casePreset(id, "punk");
  if (backColor) appearance.surfaces.back = {
    ...appearance.surfaces.back,
    finish: "paint", color: backColor, roughness: 0.64, transmission: 0,
    ior: 1.46, emission: 0, metalness: 0, pattern: "none",
    secondaryColor: backColor, preserveSource: false,
  };
  applyCaseAppearance(model, appearance, qualityPresets.high);
  return appearance;
}

function composeOpticalComparison(id, frames) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1200;
  const context = canvas.getContext("2d");
  context.fillStyle = BG;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const labels = ["empty / red back", "empty / green back", "paper cover / red back", "paper cover / green back"];
  frames.forEach((frame, index) => {
    const x = (index % 2) * 600;
    const y = Math.floor(index / 2) * 600;
    context.drawImage(frame, x, y, 600, 600);
    context.fillStyle = "rgba(34,31,29,.82)";
    context.fillRect(x + 8, y + 8, 230, 28);
    context.fillStyle = "#fff";
    context.font = "600 15px sans-serif";
    context.fillText(id + " · " + labels[index], x + 16, y + 27);
  });
  return canvas;
}

function captureOpticalComparison(id) {
  const centerPoint = projectedPoint(layout.cover.x, layout.cover.y + layout.cover.height * 0.04, layout.cover.z);
  const captured = {};
  const frames = [];
  for (const covered of [false, true]) {
    for (const [backName, backColor] of [["red", "#ff0000"], ["green", "#00ff00"]]) {
      setReferenceAppearance(id, backColor);
      const albumState = setReferenceAlbumState(covered);
      renderer.render(scene, camera);
      const frame = copyRendererCanvas();
      frames.push(frame);
      captured[(covered ? "covered" : "empty") + backName] = {
        pixel: samplePixel(frame, centerPoint),
        png: frame.toDataURL("image/png"),
        albumState,
      };
    }
  }
  const emptyDelta = rgbDistance(captured.emptyred.pixel, captured.emptygreen.pixel);
  const coveredDelta = rgbDistance(captured.coveredred.pixel, captured.coveredgreen.pixel);
  const table = composeOpticalComparison(id, frames).toDataURL("image/png");
  setReferenceAppearance(id);
  setReferenceAlbumState(true);
  camera.position.set(7, CAMERA_CENTER_Y + 1.4, 10);
  camera.lookAt(0, CAMERA_CENTER_Y, 0);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const oblique = copyRendererCanvas().toDataURL("image/png");
  camera.position.set(0, CAMERA_CENTER_Y, 12);
  camera.lookAt(0, CAMERA_CENTER_Y, 0);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return {
    preset: id,
    centerPixel: centerPoint,
    emptyBackColorDelta: Number(emptyDelta.toFixed(3)),
    coveredBackColorDelta: Number(coveredDelta.toFixed(3)),
    emptyRed: captured.emptyred.pixel,
    emptyGreen: captured.emptygreen.pixel,
    coveredRed: captured.coveredred.pixel,
    coveredGreen: captured.coveredgreen.pixel,
    albumStates: {
      emptyRed: captured.emptyred.albumState,
      emptyGreen: captured.emptygreen.albumState,
      coveredRed: captured.coveredred.albumState,
      coveredGreen: captured.coveredgreen.albumState,
    },
    comparisonPng: table,
    obliquePng: oblique,
  };
}

function captureAuroraLighting() {
  const appearance = setReferenceAppearance("aurora");
  setReferenceAlbumState(true);
  let keyLight;
  scene.traverse(object => {
    if (!keyLight && object instanceof THREE.DirectionalLight && object.castShadow) keyLight = object;
  });
  if (!keyLight) throw new Error("Aurora lighting comparison requires the real cast-shadow key light.");
  const originalPosition = keyLight.position.clone();
  const originalTarget = keyLight.target.position.clone();
  keyLight.target.position.set(0, CAMERA_CENTER_Y, 0);
  const frames = [];
  for (const position of [[-6, 7, 10], [6, 8, 9]]) {
    keyLight.position.set(...position);
    keyLight.target.updateMatrixWorld(true);
    keyLight.shadow.needsUpdate = true;
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    frames.push(copyRendererCanvas());
  }
  const frameMaterial = (() => {
    let result;
    model.traverse(object => {
      if (result || !(object instanceof THREE.Mesh) || object.userData.casePart !== "frame") return;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      if (material instanceof THREE.MeshPhysicalMaterial) result = material;
    });
    return result;
  })();
  if (!frameMaterial) throw new Error("Aurora frame must use an actual MeshPhysicalMaterial.");
  const frameShaderKey = String(frameMaterial.customProgramCacheKey());
  const regionChange = changeAverage(frames[0], frames[1], REGIONS.frame);
  const spread = regionColorSpread(frames[0], REGIONS.frame);
  const panel = document.createElement("canvas");
  panel.width = 1200;
  panel.height = 620;
  const context = panel.getContext("2d");
  context.fillStyle = BG;
  context.fillRect(0, 0, panel.width, panel.height);
  context.drawImage(frames[0], 0, 20, 600, 600);
  context.drawImage(frames[1], 600, 20, 600, 600);
  context.fillStyle = "rgba(34,31,29,.82)";
  context.fillRect(8, 4, 400, 24); context.fillRect(608, 4, 400, 24);
  context.fillStyle = "#fff"; context.font = "600 14px sans-serif";
  context.fillText("AURORA · KEY FROM LEFT", 16, 21); context.fillText("AURORA · KEY FROM RIGHT", 616, 21);
  keyLight.position.copy(originalPosition);
  keyLight.target.position.copy(originalTarget);
  keyLight.target.updateMatrixWorld(true);
  keyLight.shadow.needsUpdate = true;
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  return {
    preset: appearance.preset,
    pattern: appearance.surfaces.frame.pattern,
    modelUuid: model.uuid,
    theme: "day",
    lightPositions: [[-6, 7, 10], [6, 8, 9]],
    fixedFrameRoiMeanAbsoluteDeltaUnderLightChange: regionChange,
    responseDescription: "Same material-space frame ROI under two key-light directions; this is not a BRDF curve or whole-image comparison.",
    frameRegionSpread: spread,
    material: {
      type: frameMaterial.type,
      color: frameMaterial.color.getHexString(),
      roughness: frameMaterial.roughness,
      metalness: frameMaterial.metalness,
      clearcoat: frameMaterial.clearcoat,
      iridescence: frameMaterial.iridescence,
      transmission: frameMaterial.transmission,
      gradientPatternShader: /case-optics-v[45]-pattern/.test(frameShaderKey),
      shaderKeySuffix: frameShaderKey.slice(-48),
      compiledPrograms: renderer.info.programs?.length ?? 0,
    },
    comparisonPng: panel.toDataURL("image/png"),
  };
}

function captureInsertShadowProjection() {
  const appearance = setReferenceAppearance("white", "#c6c6c2");
  setReferenceAlbumState(true);
  renderer.shadowMap.enabled = true;
  let keyLight;
  scene.traverse(object => {
    if (!keyLight && object instanceof THREE.DirectionalLight && object.castShadow) keyLight = object;
  });
  if (!keyLight) throw new Error("Paper insert shadow comparison requires the live cast-shadow key light.");
  const originalPosition = keyLight.position.clone();
  const originalTarget = keyLight.target.position.clone();
  keyLight.position.set(-8, CAMERA_CENTER_Y + 5, 10);
  keyLight.target.position.set(0, CAMERA_CENTER_Y, 0);
  keyLight.target.updateMatrixWorld(true);
  const rightEdge = layout.cover.x + layout.cover.width / 2;
  const gutterWorld = {
    x: [rightEdge + 0.007, rightEdge + 0.065],
    y: [layout.cover.y - 0.16, layout.cover.y + 0.16],
    backColor: "#c6c6c2",
  };
  const gutterPixels = projectedWorldRect(gutterWorld.x[0], gutterWorld.y[0], gutterWorld.x[1], gutterWorld.y[1], layout.cover.z);
  const frames = [];
  const materialEvidence = [];
  for (const castsShadow of [true, false]) {
    albumInsert.castShadow = castsShadow;
    keyLight.shadow.needsUpdate = true;
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const frame = copyRendererCanvas();
    frames.push(frame);
    materialEvidence.push(summarizeCanvasRect(frame, gutterPixels));
  }
  const projection = compareCanvasRects(frames[0], frames[1], gutterPixels);
  const table = document.createElement("canvas");
  table.width = 1200;
  table.height = 620;
  const context = table.getContext("2d");
  context.fillStyle = BG;
  context.fillRect(0, 0, table.width, table.height);
  context.drawImage(frames[0], 0, 20, 600, 600);
  context.drawImage(frames[1], 600, 20, 600, 600);
  context.fillStyle = "rgba(34,31,29,.82)";
  context.fillRect(8, 4, 470, 24); context.fillRect(608, 4, 470, 24);
  context.fillStyle = "#fff"; context.font = "600 14px sans-serif";
  context.fillText("WHITE · INSERT CASTS SHADOW", 16, 21);
  context.fillText("WHITE · INSERT CASTS NO SHADOW", 616, 21);
  albumInsert.castShadow = true;
  keyLight.position.copy(originalPosition);
  keyLight.target.position.copy(originalTarget);
  keyLight.target.updateMatrixWorld(true);
  keyLight.shadow.needsUpdate = true;
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  return {
    preset: appearance.preset,
    modelUuid: model.uuid,
    sameOpaquePrintInBothFrames: albumPrint.visible && !albumPrint.material.transparent && albumPrint.material.depthWrite,
    sameBackingColor: gutterWorld.backColor,
    castShadow: true,
    noCastShadow: false,
    gutterWorld,
    gutterPixels,
    sampleWithCast: materialEvidence[0],
    sampleWithoutCast: materialEvidence[1],
    pixelProjection: projection,
    keyLightPosition: [-8, CAMERA_CENTER_Y + 5, 10],
    comparisonPng: table.toDataURL("image/png"),
  };
}

async function captureMultiAngleComparisons() {
  const [width, height] = caseMeta.inspect_res;
  const frameCameraA = inspectCameraAt(45);
  const frameCameraB = inspectCameraAt(59);
  let framePoint = null;
  let framePointSearchError = "";
  try { framePoint = findSharedFramePoint(frameCameraA, frameCameraB); }
  catch (error) { framePointSearchError = error instanceof Error ? error.message : String(error); }
  const sheet = document.createElement("canvas");
  const cellWidth = 500;
  const cellHeight = 260;
  const headerHeight = 40;
  sheet.width = cellWidth * ANGLE_FRAMES.length;
  sheet.height = headerHeight + cellHeight * ANGLE_PRESETS.length;
  const sheetContext = sheet.getContext("2d");
  sheetContext.fillStyle = BG;
  sheetContext.fillRect(0, 0, sheet.width, sheet.height);
  sheetContext.fillStyle = "#242932";
  sheetContext.fillRect(0, 0, sheet.width, headerHeight);
  sheetContext.fillStyle = "#fff";
  sheetContext.font = "700 15px sans-serif";
  sheetContext.fillText("SOURCE / 3D PUNK CASE · ANGLES 00 / 23 / 45 / 59 · MAPPED TEST ARTWORK", 16, 25);

  const roiSheet = document.createElement("canvas");
  const roiCellWidth = 240;
  const roiCellHeight = 184;
  roiSheet.width = roiCellWidth * 4;
  roiSheet.height = 34 + roiCellHeight * ANGLE_PRESETS.length;
  const roiContext = roiSheet.getContext("2d");
  roiContext.fillStyle = BG;
  roiContext.fillRect(0, 0, roiSheet.width, roiSheet.height);
  roiContext.fillStyle = "#242932";
  roiContext.fillRect(0, 0, roiSheet.width, 34);
  roiContext.fillStyle = "#fff";
  roiContext.font = "700 13px sans-serif";
  roiContext.fillText("FRAME-POINT RESPONSE · SOURCE / 3D AT 45° AND 59° (LOCAL ROI; RAYCAST STATUS LABELLED PER SKIN)", 12, 22);

  const perPreset = [];
  for (const [presetIndex, id] of ANGLE_PRESETS.entries()) {
    const appearance = setReferenceAppearance(id);
    setReferenceAlbumState(true);
    const anglePairs = [];
    const viewRois = {};
    for (const [column, index] of ANGLE_FRAMES.entries()) {
      const viewCamera = inspectCameraAt(index);
      const sourceQuad = caseMeta.inspect[index].cover;
      const projectedQuad = projectedCoverQuad(viewCamera, width, height);
      const projectionError = quadMaxError(projectedQuad, sourceQuad);
      const cameraMatch = projectionError <= 3
        ? "source-matched"
        : "estimated-from-source-quad-fit";
      const rawSource = await loadInspectImage(id, index);
      const source = angleSourceCanvas(rawSource, index);
      const rendered = renderCameraAtSize(viewCamera, width, height);
      const cellX = column * cellWidth;
      const cellY = headerHeight + presetIndex * cellHeight;
      sheetContext.fillStyle = "rgba(36,41,50,.92)";
      sheetContext.fillRect(cellX + 5, cellY + 4, cellWidth - 10, 22);
      sheetContext.fillStyle = "#fff";
      sheetContext.font = "600 12px sans-serif";
      sheetContext.fillText(id + " · inspect-" + String(index).padStart(2, "0") + " · " + cameraMatch + " · residual " + projectionError.toFixed(2) + "px", cellX + 11, cellY + 19);
      sheetContext.drawImage(source, cellX + 7, cellY + 30, 238, 224);
      sheetContext.drawImage(rendered, cellX + 255, cellY + 30, 238, 224);
      sheetContext.fillStyle = "#242932";
      sheetContext.fillRect(cellX + 7, cellY + 237, 58, 17);
      sheetContext.fillRect(cellX + 255, cellY + 237, 46, 17);
      sheetContext.fillStyle = "#fff";
      sheetContext.font = "600 11px sans-serif";
      sheetContext.fillText("SOURCE", cellX + 13, cellY + 250);
      sheetContext.fillText("3D", cellX + 261, cellY + 250);

      const record = {
        index, source, rendered, cameraMatch, projectionError,
        sourceRasterSize: [rawSource.width, rawSource.height],
        sourceVirtualCrop: [...caseMeta.inspect[index].crop],
      };
      anglePairs.push(record);
      if (framePoint && (index === 45 || index === 59)) {
        const roiSource = framePointRoi(source, viewCamera, framePoint.worldPoint);
        const roiRendered = framePointRoi(rendered, viewCamera, framePoint.worldPoint);
        viewRois[index] = { source: roiSource, rendered: roiRendered, sourceCanvas: source, renderedCanvas: rendered };
      }
      rawSource.close();
    }

    const responseA = viewRois[45];
    const responseB = viewRois[59];
    const sourceRoiOnShell = !!responseA && !!responseB &&
      responseA.source.nonBackgroundFraction >= 0.05 && responseB.source.nonBackgroundFraction >= 0.05;
    const cameraMatchEvidence = {
      angle45: anglePairs.find(item => item.index === 45).cameraMatch,
      angle59: anglePairs.find(item => item.index === 59).cameraMatch,
      residualPixels: {
        angle45: anglePairs.find(item => item.index === 45).projectionError,
        angle59: anglePairs.find(item => item.index === 59).projectionError,
      },
    };
    const viewResponse = framePoint && responseA && responseB ? {
      status: sourceRoiOnShell ? "measured-same-raycast-world-point" : "source-roi-background-invalid",
      point: framePoint,
      viewIndices: [45, 59],
      sourceRoiOnShell,
      sourceNonBackgroundFractionAt45: responseA.source.nonBackgroundFraction,
      sourceNonBackgroundFractionAt59: responseB.source.nonBackgroundFraction,
      sourceCameraMatches: cameraMatchEvidence,
      sourceMeanColorAt45: responseA.source.meanSrgb8,
      sourceMeanColorAt59: responseB.source.meanSrgb8,
      renderedMeanColorAt45: responseA.rendered.meanSrgb8,
      renderedMeanColorAt59: responseB.rendered.meanSrgb8,
      renderedMeanColorDelta: roiDelta(responseA.rendered, responseB.rendered),
      renderedPeakLuminanceAt45: responseA.rendered.maxLuminance,
      renderedPeakLuminanceAt59: responseB.rendered.maxLuminance,
      renderedPeakLuminanceDelta: Number((responseA.rendered.maxLuminance - responseB.rendered.maxLuminance).toFixed(3)),
      material: partMaterialEvidence("frame", appearance),
    } : {
      status: "no-jointly-visible-raycast-point",
      reason: framePointSearchError,
      viewIndices: [45, 59],
      sourceCameraMatches: cameraMatchEvidence,
      material: partMaterialEvidence("frame", appearance),
    };

    const roiRowY = 34 + presetIndex * roiCellHeight;
    roiContext.fillStyle = "#242932";
    roiContext.fillRect(0, roiRowY, roiSheet.width, 22);
    roiContext.fillStyle = "#fff";
    roiContext.font = "600 12px sans-serif";
    const representative = viewResponse.material.materials[0] ?? {};
    roiContext.fillText(id + " · frame clearcoatRoughness=" + (representative.clearcoatRoughness ?? "n/a") +
      " · " + viewResponse.status + (Number.isFinite(viewResponse.renderedMeanColorDelta) ? " · view Δ=" + viewResponse.renderedMeanColorDelta : ""), 8, roiRowY + 15);
    if (!framePoint || !responseA || !responseB) {
      roiContext.fillStyle = "#d9d8d3";
      roiContext.font = "600 12px sans-serif";
      roiContext.fillText("No jointly visible same-point ROI; review the full source / 3D angle sheet.", 10, roiRowY + 74);
      perPreset.push({
        preset: id,
        views: anglePairs.map(({ index, cameraMatch, projectionError, sourceRasterSize, sourceVirtualCrop }) => ({ index, cameraMatch, projectionError, sourceRasterSize, sourceVirtualCrop })),
        frameViewResponse: viewResponse,
        frameMaterials: partMaterialEvidence("frame", appearance),
        coverMaterials: partMaterialEvidence("cover", appearance),
      });
      continue;
    }
    const source45Crop = document.createElement("canvas");
    source45Crop.width = source45Crop.height = 25;
    source45Crop.getContext("2d").drawImage(responseA.sourceCanvas,
      responseA.source.rect.x, responseA.source.rect.y, 25, 25, 0, 0, 25, 25);
    const render45Crop = document.createElement("canvas");
    render45Crop.width = render45Crop.height = 25;
    render45Crop.getContext("2d").drawImage(responseA.renderedCanvas,
      responseA.rendered.rect.x, responseA.rendered.rect.y, 25, 25, 0, 0, 25, 25);
    const source59Crop = document.createElement("canvas");
    source59Crop.width = source59Crop.height = 25;
    source59Crop.getContext("2d").drawImage(responseB.sourceCanvas,
      responseB.source.rect.x, responseB.source.rect.y, 25, 25, 0, 0, 25, 25);
    const render59Crop = document.createElement("canvas");
    render59Crop.width = render59Crop.height = 25;
    render59Crop.getContext("2d").drawImage(responseB.renderedCanvas,
      responseB.rendered.rect.x, responseB.rendered.rect.y, 25, 25, 0, 0, 25, 25);
    const crops = [source45Crop, render45Crop, source59Crop, render59Crop];
    const cropLabels = ["SOURCE · 45", "3D · 45", "SOURCE · 59", "3D · 59"];
    crops.forEach((crop, cropIndex) => {
      const x = cropIndex * roiCellWidth;
      roiContext.fillStyle = "#242932";
      roiContext.fillRect(x + 5, roiRowY + 25, roiCellWidth - 10, 18);
      roiContext.fillStyle = "#fff";
      roiContext.font = "600 10px sans-serif";
      roiContext.fillText(cropLabels[cropIndex], x + 11, roiRowY + 38);
      roiContext.imageSmoothingEnabled = false;
      roiContext.drawImage(crop, x + 6, roiRowY + 45, roiCellWidth - 12, 132);
      roiContext.imageSmoothingEnabled = true;
    });
    perPreset.push({
      preset: id,
      views: anglePairs.map(({ index, cameraMatch, projectionError, sourceRasterSize, sourceVirtualCrop }) => ({ index, cameraMatch, projectionError, sourceRasterSize, sourceVirtualCrop })),
      frameViewResponse: viewResponse,
      frameMaterials: partMaterialEvidence("frame", appearance),
      coverMaterials: partMaterialEvidence("cover", appearance),
    });
  }

  renderer.setSize(SIZE, SIZE, false);
  setReferenceAppearance("aurora");
  renderer.render(scene, camera);
  return {
    sourceArtworkBlend: 1,
    sourceRasterCompositing: "The same opaque synthetic cover is drawn to case.json's inspect cover quad first; each naturally cropped inspect PNG is then placed at case.json's virtual crop rectangle to add its real raster glass highlights/occlusion.",
    sourceCameraMethod: "Inverted each published case.json inspect-frame cover quad into an orthographic camera using inspect_ppu corrected by layout.sourceScale; image-plane translation is fitted from the same quad center. A frame is labelled source-matched only when the rendered cover-corner residual is <=3px; larger residuals are explicitly estimated.",
    sourceAngles: ANGLE_FRAMES,
    sourcePresets: ANGLE_PRESETS,
    framePoint,
    framePointSearchError,
    contactSheet: sheet.toDataURL("image/png"),
    frameRoiContactSheet: roiSheet.toDataURL("image/png"),
    perPreset,
  };
}

function framePointVisibleInCamera(viewCamera, point) {
  const [width, height] = caseMeta.inspect_res;
  const screen = projectPointWithCamera(new THREE.Vector3(...point), viewCamera, width, height);
  if (screen[0] < 0 || screen[0] >= width || screen[1] < 0 || screen[1] >= height)
    return { visible: false, screen, reason: "outside-frame" };
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(2 * screen[0] / width - 1, 1 - 2 * screen[1] / height), viewCamera);
  const hit = raycaster.intersectObject(model, true)[0];
  const distance = hit ? hit.point.distanceTo(new THREE.Vector3(...point)) : Infinity;
  return {
    visible: !!hit && hit.object.userData.casePart === "frame" && distance <= 0.02,
    screen,
    hitPart: hit?.object.userData.casePart ?? null,
    hitDistance: Number.isFinite(distance) ? Number(distance.toFixed(6)) : null,
  };
}

function cropAroundFramePoint(canvas, screenPoint, size = 110) {
  const left = Math.max(0, Math.min(canvas.width - size, Math.round(screenPoint[0] - size / 2)));
  const top = Math.max(0, Math.min(canvas.height - size, Math.round(screenPoint[1] - size / 2)));
  const crop = document.createElement("canvas");
  crop.width = size;
  crop.height = size;
  crop.getContext("2d").drawImage(canvas, left, top, size, size, 0, 0, size, size);
  return { canvas: crop, rect: { x: left, y: top, width: size, height: size } };
}

async function captureMaterialCandidateGrid(worldPoint) {
  if (!Array.isArray(worldPoint) || worldPoint.length !== 3)
    throw new Error("Material candidate contact sheet needs the raycast-confirmed frame world point.");
  const viewIndices = [0, 23, 59];
  const groups = [
    {
      preset: "red",
      values: [1, 0.8, 0.6].map(metalness => ({ metalness, roughness: casePreset("red", "punk").surfaces.frame.roughness })),
    },
    {
      preset: "blue",
      values: [0.30, 0.20].flatMap(roughness => [0.38, 0.6, 0.8].map(metalness => ({ metalness, roughness }))),
    },
  ];
  const candidates = groups.flatMap(group => group.values.map(value => ({ preset: group.preset, ...value })));
  const cellWidth = 360;
  const rowHeight = 156;
  const headerHeight = 34;
  const contact = document.createElement("canvas");
  contact.width = cellWidth * viewIndices.length;
  contact.height = headerHeight + rowHeight * candidates.length;
  const context = contact.getContext("2d");
  context.fillStyle = BG;
  context.fillRect(0, 0, contact.width, contact.height);
  context.fillStyle = "#242932";
  context.fillRect(0, 0, contact.width, headerHeight);
  context.fillStyle = "#fff";
  context.font = "700 13px sans-serif";
  context.fillText("VISUAL-ONLY FRAME MATERIAL CANDIDATES · SAME WORLD POINT · 00 / 23 / 59", 12, 22);

  const reports = [];
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const appearance = casePreset(candidate.preset, "punk");
    const baseFrame = appearance.surfaces.frame;
    appearance.surfaces.frame = {
      ...baseFrame,
      metalness: candidate.metalness,
      roughness: candidate.roughness,
      // Keep the current coating amount and clearcoat roughness unchanged.
      clearcoat: baseFrame.clearcoat,
      clearcoatRoughness: baseFrame.clearcoatRoughness,
    };
    applyCaseAppearance(model, appearance, qualityPresets.high);
    setReferenceAlbumState(true);
    const actualMaterial = partMaterialEvidence("frame", appearance);
    const viewResults = [];
    for (const [column, viewIndex] of viewIndices.entries()) {
      const viewCamera = inspectCameraAt(viewIndex);
      const visibility = framePointVisibleInCamera(viewCamera, worldPoint);
      const rendered = renderCameraAtSize(viewCamera, caseMeta.inspect_res[0], caseMeta.inspect_res[1]);
      const cellX = column * cellWidth;
      const cellY = headerHeight + candidateIndex * rowHeight;
      if (visibility.visible) {
        const crop = cropAroundFramePoint(rendered, visibility.screen);
        context.drawImage(crop.canvas, cellX + 8, cellY + 30, 118, 118);
        context.fillStyle = "#f3eee1";
        context.font = "500 10px sans-serif";
        context.fillText("Same world-point", cellX + 138, cellY + 74);
        context.fillText("crop " + crop.rect.x + "," + crop.rect.y, cellX + 138, cellY + 90);
        viewResults.push({ viewIndex, ...visibility, crop: crop.rect });
      } else {
        context.fillStyle = "#343a42";
        context.fillRect(cellX + 8, cellY + 30, 118, 118);
        context.fillStyle = "#f3eee1";
        context.font = "600 12px sans-serif";
        context.fillText("FRAME POINT", cellX + 12, cellY + 80);
        context.fillText("OCCLUDED", cellX + 12, cellY + 98);
        viewResults.push({ viewIndex, ...visibility });
      }
      context.fillStyle = "rgba(36,41,50,.92)";
      context.fillRect(cellX + 6, cellY + 7, cellWidth - 12, 20);
      context.fillStyle = "#fff";
      context.font = "600 12px sans-serif";
      context.fillText("inspect-" + String(viewIndex).padStart(2, "0"), cellX + 12, cellY + 21);
    }
    const representative = actualMaterial.materials[0] ?? {};
    const rowY = headerHeight + candidateIndex * rowHeight;
    context.fillStyle = "#242932";
    context.fillRect(8, rowY + 132, contact.width - 16, 20);
    context.fillStyle = "#fff";
    context.font = "600 11px sans-serif";
    context.fillText(candidate.preset.toUpperCase() + " · metalness " + candidate.metalness +
      " · roughness " + candidate.roughness + " · clearcoat " + (representative.clearcoat ?? "n/a") +
      " / clearcoatRoughness " + (representative.clearcoatRoughness ?? "n/a"), 13, rowY + 146);
    reports.push({
      preset: candidate.preset,
      metalness: candidate.metalness,
      roughness: candidate.roughness,
      clearcoatUnchanged: representative.clearcoat === baseFrame.clearcoat,
      clearcoatRoughnessUnchanged: representative.clearcoatRoughness === baseFrame.clearcoatRoughness,
      material: actualMaterial,
      views: viewResults,
      selectionPolicy: "visual comparison only; no numeric ranking or automatic material selection",
    });
  }
  renderer.setSize(SIZE, SIZE, false);
  setReferenceAppearance("aurora");
  renderer.render(scene, camera);
  return {
    point: worldPoint,
    views: viewIndices,
    candidates: reports,
    contactSheet: contact.toDataURL("image/png"),
  };
}

function frameGeometryTangentUvDiagnostics() {
  const meshes = [];
  let totalTriangles = 0;
  let degenerateUvTriangles = 0;
  let nonFiniteUvTriangles = 0;
  let tangentAttributes = 0;
  let finiteTangentComponents = 0;
  let tangentComponents = 0;
  model.updateMatrixWorld(true);
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.casePart !== "frame") return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const tangent = geometry.getAttribute("tangent");
    const index = geometry.getIndex();
    const triangleCount = position ? Math.floor((index?.count ?? position.count) / 3) : 0;
    let degenerate = 0;
    let nonFinite = 0;
    if (uv && position) {
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        const vertices = [0, 1, 2].map(corner => index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner);
        const a = [uv.getX(vertices[0]), uv.getY(vertices[0])];
        const b = [uv.getX(vertices[1]), uv.getY(vertices[1])];
        const c = [uv.getX(vertices[2]), uv.getY(vertices[2])];
        if (![...a, ...b, ...c].every(Number.isFinite)) { nonFinite++; continue; }
        const signedArea = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(signedArea) < 1e-10) degenerate++;
      }
    }
    let finiteTangent = 0;
    let tangentCount = 0;
    if (tangent) {
      tangentAttributes++;
      tangentCount = tangent.count * tangent.itemSize;
      for (let component = 0; component < tangentCount; component++)
        if (Number.isFinite(tangent.array[component])) finiteTangent++;
    }
    totalTriangles += triangleCount;
    degenerateUvTriangles += degenerate;
    nonFiniteUvTriangles += nonFinite;
    finiteTangentComponents += finiteTangent;
    tangentComponents += tangentCount;
    meshes.push({
      mesh: object.name || object.userData.surface || "frame mesh",
      surface: object.userData.surface ?? "",
      triangles: triangleCount,
      uvPresent: !!uv,
      uvItemSize: uv?.itemSize ?? 0,
      degenerateUvTriangles: degenerate,
      nonFiniteUvTriangles: nonFinite,
      tangentAttributePresent: !!tangent,
      tangentItemSize: tangent?.itemSize ?? 0,
      tangentCount: tangent?.count ?? 0,
      finiteTangentComponents: finiteTangent,
    });
  });
  return {
    part: "frame",
    meshCount: meshes.length,
    totalTriangles,
    tangentAttributeMeshCount: tangentAttributes,
    tangentComponentCount: tangentComponents,
    finiteTangentComponents,
    degenerateUvTriangles,
    nonFiniteUvTriangles,
    meshes,
  };
}

function setFrameMaterialAnisotropy(value) {
  let materialCount = 0;
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.casePart !== "frame") return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
      material.anisotropy = value;
      material.needsUpdate = true;
      materialCount++;
    }
  });
  return materialCount;
}

async function captureBlueAnisotropyDiagnostic(worldPoint) {
  const [width, height] = caseMeta.inspect_res;
  const views = [0, 23];
  const candidateValues = [0.12, 0];
  const shadowStates = [true, false];
  const columns = views.length * candidateValues.length;
  const cellWidth = 260;
  const rowHeight = 164;
  const headerHeight = 34;
  const sheet = document.createElement("canvas");
  sheet.width = columns * cellWidth;
  sheet.height = headerHeight + rowHeight * shadowStates.length;
  const context = sheet.getContext("2d");
  context.fillStyle = BG;
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.fillStyle = "#242932";
  context.fillRect(0, 0, sheet.width, headerHeight);
  context.fillStyle = "#fff";
  context.font = "700 13px sans-serif";
  context.fillText("BLUE · SAME FRAME WORLD POINT · ANISOTROPY A/B · SHADOW MAP A/B", 12, 22);

  const base = casePreset("blue", "punk");
  const baselineFrame = base.surfaces.frame;
  applyCaseAppearance(model, base, qualityPresets.high);
  const baselineFrameMaterialCount = setFrameMaterialAnisotropy(candidateValues[0]);
  const baselineMaterial = partMaterialEvidence("frame", base).materials[0] ?? {};
  const geometryDiagnostics = frameGeometryTangentUvDiagnostics();
  const captures = [];
  for (const [shadowIndex, shadowsEnabled] of shadowStates.entries()) {
    renderer.shadowMap.enabled = shadowsEnabled;
    const rowY = headerHeight + shadowIndex * rowHeight;
    for (const [viewIndexInRow, index] of views.entries()) {
      const viewCamera = inspectCameraAt(index);
      const visibility = framePointVisibleInCamera(viewCamera, worldPoint);
      for (const [anisotropyIndex, anisotropy] of candidateValues.entries()) {
        const appearance = casePreset("blue", "punk");
        applyCaseAppearance(model, appearance, qualityPresets.high);
        // case-materials derives anisotropy from the named brushed finish.
        // Override the live material after applying that unchanged Blue preset
        // so this diagnostic changes only the GPU anisotropy parameter.
        const frameMaterialCount = setFrameMaterialAnisotropy(anisotropy);
        setReferenceAlbumState(true);
        const rendered = renderCameraAtSize(viewCamera, width, height);
        const actualMaterial = partMaterialEvidence("frame", appearance).materials[0] ?? {};
        const column = viewIndexInRow * candidateValues.length + anisotropyIndex;
        const cellX = column * cellWidth;
        context.fillStyle = "rgba(36,41,50,.92)";
        context.fillRect(cellX + 5, rowY + 5, cellWidth - 10, 20);
        context.fillStyle = "#fff";
        context.font = "600 11px sans-serif";
        context.fillText("inspect-" + String(index).padStart(2, "0") + " · aniso=" + anisotropy, cellX + 10, rowY + 19);
        let roi = null;
        if (visibility.visible) {
          roi = framePointRoi(rendered, viewCamera, worldPoint);
          const crop = cropAroundFramePoint(rendered, visibility.screen, 110);
          context.drawImage(crop.canvas, cellX + 5, rowY + 30, 110, 110);
          context.fillStyle = "#f3eee1";
          context.font = "500 10px sans-serif";
          context.fillText("frame dL=" + roi.meanLuminance.toFixed(2), cellX + 121, rowY + 84);
        } else {
          context.fillStyle = "#343a42";
          context.fillRect(cellX + 5, rowY + 30, 110, 110);
          context.fillStyle = "#f3eee1";
          context.font = "600 11px sans-serif";
          context.fillText("OCCLUDED", cellX + 17, rowY + 86);
        }
        captures.push({
          shadowMapEnabled: shadowsEnabled,
          viewIndex: index,
          anisotropy,
          pointVisibility: visibility,
          roi,
          material: actualMaterial,
          sameAsBlueExceptAnisotropy: ["color", "roughness", "metalness", "transmission", "clearcoat", "clearcoatRoughness", "iridescence"]
            .every(key => actualMaterial[key] === baselineMaterial[key]) && actualMaterial.anisotropy === anisotropy,
          frameMaterialCount,
          parameterDifferences: Object.fromEntries(["color", "roughness", "metalness", "transmission", "clearcoat", "clearcoatRoughness", "iridescence", "anisotropy"]
            .filter(key => actualMaterial[key] !== (key === "anisotropy" ? anisotropy : baselineMaterial[key]))
            .map(key => [key, { baseline: baselineMaterial[key], actual: actualMaterial[key] }])),
          baseSurface: {
            anisotropy: baselineMaterial.anisotropy,
            roughness: baselineFrame.roughness,
            metalness: baselineFrame.metalness,
            clearcoat: baselineFrame.clearcoat,
            clearcoatRoughness: baselineFrame.clearcoatRoughness,
          },
        });
      }
    }
    context.fillStyle = "#242932";
    context.fillRect(5, rowY + 143, sheet.width - 10, 17);
    context.fillStyle = "#fff";
    context.font = "600 10px sans-serif";
    context.fillText("shadowMap " + (shadowsEnabled ? "ON" : "OFF") + " · same Blue appearance except frame anisotropy", 12, rowY + 155);
  }
  renderer.shadowMap.enabled = true;
  renderer.setSize(SIZE, SIZE, false);
  setReferenceAppearance("aurora");
  renderer.render(scene, camera);
  return {
    preset: "blue",
    views,
    anisotropyCandidates: candidateValues,
    shadowMapStates: shadowStates,
    worldPoint,
    baselineFrameMaterialCount,
    selectionPolicy: "diagnostic only; no automatic ranking or production material change",
    baseSurface: {
      anisotropy: baselineMaterial.anisotropy,
      roughness: baselineFrame.roughness,
      metalness: baselineFrame.metalness,
      clearcoat: baselineFrame.clearcoat,
      clearcoatRoughness: baselineFrame.clearcoatRoughness,
    },
    geometryTangentUv: geometryDiagnostics,
    captures,
    contactSheet: sheet.toDataURL("image/png"),
  };
}

function partGeometryPresenceSnapshot() {
  const byPart = new Map();
  model.traverse(object => {
    const part = object.userData?.casePart;
    if (!part) return;
    const entry = byPart.get(part) ?? { part, meshCount: 0, visibleMeshCount: 0, vertexCount: 0, triangleCount: 0 };
    if (object instanceof THREE.Mesh) {
      entry.meshCount++;
      if (object.visible) entry.visibleMeshCount++;
      const position = object.geometry.getAttribute("position");
      entry.vertexCount += position?.count ?? 0;
      entry.triangleCount += (object.geometry.getIndex()?.count ?? position?.count ?? 0) / 3;
    }
    byPart.set(part, entry);
  });
  return [...byPart.values()].sort((a, b) => a.part.localeCompare(b.part));
}

function emblemOpticsMaterialSnapshot(parts) {
  return Object.fromEntries(parts.map(part => {
    const materials = [];
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.userData.casePart !== part) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
        materials.push({
          type: material.type,
          color: material.color.getHexString(),
          roughness: material.roughness,
          metalness: material.metalness,
          transmission: material.transmission,
          ior: material.ior,
          thickness: material.thickness,
          clearcoat: material.clearcoat,
          clearcoatRoughness: material.clearcoatRoughness,
          attenuationDistance: material.attenuationDistance,
          opacity: material.opacity,
          transparent: material.transparent,
          materialVisible: material.visible,
          side: material.side,
          transmissionMode: material.userData.caseTransmissionMode,
          tubeTransmission: material.userData.caseTubeTransmission,
        });
      }
    });
    const unique = new Map(materials.map(material => [JSON.stringify(material), material]));
    return [part, [...unique.values()]];
  }));
}

function summarizeEmblemRoi(canvas, rect) {
  const data = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(rect.x, rect.y, rect.width, rect.height).data;
  const channels = [0, 0, 0];
  let luminance = 0, nonBackground = 0, count = 0;
  const colors = new Set();
  const background = [222, 219, 215];
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const rgb = [data[index], data[index + 1], data[index + 2]];
    for (let channel = 0; channel < 3; channel++) channels[channel] += rgb[channel];
    luminance += rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    if (Math.hypot(...rgb.map((value, channel) => value - background[channel])) > 18) nonBackground++;
    colors.add(rgb.map(value => value >> 3).join(","));
    count++;
  }
  return {
    rect,
    pixels: count,
    meanSrgb8: channels.map(value => Number((value / Math.max(1, count)).toFixed(2))),
    meanLuminance: Number((luminance / Math.max(1, count)).toFixed(3)),
    nonBackgroundFraction: Number((nonBackground / Math.max(1, count)).toFixed(4)),
    quantizedColors: colors.size,
  };
}

function captureEmblemOpticsDiagnostic() {
  setReferenceAppearance("white");
  setReferenceAlbumState(true);
  renderer.setSize(SIZE, SIZE, false);
  camera.position.set(0, CAMERA_CENTER_Y, 12);
  camera.lookAt(0, CAMERA_CENTER_Y, 0);
  camera.updateProjectionMatrix();
  const byPart = new Map();
  model.traverse(object => {
    const part = object.userData?.casePart;
    if (part && object instanceof THREE.Mesh) {
      const list = byPart.get(part) ?? [];
      list.push(object);
      byPart.set(part, list);
    }
  });
  const opticsMeshes = byPart.get("optics") ?? [];
  const emblemMeshes = byPart.get("emblem") ?? [];
  const accentMeshes = byPart.get("accent") ?? [];
  if (!opticsMeshes.length || !emblemMeshes.length || !accentMeshes.length)
    throw new Error("The live Punk model must provide optics, emblem, and opaque accent-core geometry for the seven-cell material diagnostic.");
  const opticsMaterials = [...new Set(opticsMeshes.flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]))]
    .filter(material => material instanceof THREE.MeshPhysicalMaterial);
  if (!opticsMaterials.length) throw new Error("The live optics geometry has no physical material to diagnose.");
  const baseVisibility = new Map([...opticsMeshes, ...emblemMeshes].map(mesh => [mesh, mesh.visible]));
  const baseOpticsParameters = new Map(opticsMaterials.map(material => [material, {
    roughness: material.roughness,
    thickness: material.thickness,
    side: material.side,
  }]));
  const roi = { x: 770, y: 270, width: 75, height: 140 };
  const scale = 7;
  const candidates = [
    { id: "A", label: "CURRENT WHITE · OPTICS + EMBLEM + CORE", apply() {} },
    { id: "B", label: "OPTICS HIDDEN · WHITE EMBLEM + CORE", apply() { for (const mesh of opticsMeshes) mesh.visible = false; } },
    { id: "C", label: "OPTICS + EMBLEM HIDDEN · OPAQUE ACCENT CORE", apply() {
      for (const mesh of opticsMeshes) mesh.visible = false;
      for (const mesh of emblemMeshes) mesh.visible = false;
    } },
    { id: "D", label: "CURRENT OPTICS · ROUGHNESS .015 · THICKNESS .002", apply() {
      for (const material of opticsMaterials) { material.roughness = 0.015; material.thickness = 0.002; material.needsUpdate = true; }
    } },
    { id: "E", label: "CURRENT OPTICS · ROUGHNESS .015 · THICKNESS 0", apply() {
      for (const material of opticsMaterials) { material.roughness = 0.015; material.thickness = 0; material.needsUpdate = true; }
    } },
    { id: "F", label: "CURRENT OPTICS · FRONT SIDE ONLY", apply() {
      for (const material of opticsMaterials) { material.side = THREE.FrontSide; material.needsUpdate = true; }
    } },
    { id: "G", label: "CURRENT OPTICS · BACK SIDE ONLY", apply() {
      for (const material of opticsMaterials) { material.side = THREE.BackSide; material.needsUpdate = true; }
    } },
  ];
  const contact = document.createElement("canvas");
  const scaledWidth = roi.width * scale, scaledHeight = roi.height * scale;
  const cellWidth = scaledWidth + 20, headerHeight = 34, footerHeight = 58;
  contact.width = cellWidth * candidates.length;
  contact.height = headerHeight + scaledHeight + footerHeight;
  const context = contact.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable for the emblem/optics diagnostic contact sheet.");
  context.fillStyle = BG;
  context.fillRect(0, 0, contact.width, contact.height);
  const partGeometry = partGeometryPresenceSnapshot();
  const actualParts = partGeometry.filter(part => part.meshCount > 0).map(part => part.part);
  const baselineWhiteOptics = emblemOpticsMaterialSnapshot(["optics", "emblem", "accent"]);
  const candidateReports = [];
  try {
    for (const [index, candidate] of candidates.entries()) {
      for (const [mesh, visible] of baseVisibility) mesh.visible = visible;
      for (const [material, parameters] of baseOpticsParameters) {
        material.roughness = parameters.roughness;
        material.thickness = parameters.thickness;
        material.side = parameters.side;
        material.needsUpdate = true;
      }
      candidate.apply();
      setReferenceAlbumState(true);
      renderer.render(scene, camera);
      const rendered = copyRendererCanvas();
      const crop = document.createElement("canvas");
      crop.width = roi.width;
      crop.height = roi.height;
      crop.getContext("2d").drawImage(rendered, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);
      const cellX = index * cellWidth;
      context.fillStyle = "#242932";
      context.fillRect(cellX, 0, cellWidth, headerHeight);
      context.fillStyle = "#fff";
      context.font = "600 12px sans-serif";
      context.fillText(candidate.id + " · " + candidate.label, cellX + 8, 22, cellWidth - 16);
      context.imageSmoothingEnabled = false;
      context.drawImage(crop, cellX + 10, headerHeight, scaledWidth, scaledHeight);
      context.strokeStyle = "#f3eee1";
      context.lineWidth = 1;
      context.strokeRect(cellX + 9.5, headerHeight - 0.5, scaledWidth + 1, scaledHeight + 1);
      const materials = emblemOpticsMaterialSnapshot(["optics", "emblem", "accent"]);
      const geometryNow = partGeometryPresenceSnapshot();
      const visibleNow = Object.fromEntries(["optics", "emblem", "accent"].map(part => [part, (byPart.get(part) ?? []).map(mesh => mesh.visible)]));
      const roiStats = summarizeEmblemRoi(rendered, roi);
      context.fillStyle = "#242932";
      context.fillRect(cellX, headerHeight + scaledHeight + 3, cellWidth, footerHeight - 3);
      context.fillStyle = "#f3eee1";
      context.font = "11px sans-serif";
      const optics = materials.optics?.[0] ?? {};
      context.fillText("optics T=" + optics.transmission + " r=" + optics.roughness + " t=" + optics.thickness + " IOR=" + optics.ior,
        cellX + 8, headerHeight + scaledHeight + 20, cellWidth - 16);
      context.fillText("visible O/E/core=" + [visibleNow.optics.some(Boolean), visibleNow.emblem.some(Boolean), visibleNow.accent.some(Boolean)].map(Boolean).join("/"),
        cellX + 8, headerHeight + scaledHeight + 39, cellWidth - 16);
      candidateReports.push({
        id: candidate.id,
        label: candidate.label,
        camera: { type: "same front orthographic camera", position: camera.position.toArray(), lookAtY: CAMERA_CENTER_Y },
        lighting: "same live reference scene lights/environment; no light, exposure, preset, or global theme change between cells",
        modelPartCount: actualParts.length,
        actualParts,
        geometryPresence: geometryNow,
        visibleMeshesByPart: visibleNow,
        focusMaterialParameters: materials,
        roiStats,
        visualOnly: true,
      });
    }
  } finally {
    for (const [mesh, visible] of baseVisibility) mesh.visible = visible;
    for (const [material, parameters] of baseOpticsParameters) {
      material.roughness = parameters.roughness;
      material.thickness = parameters.thickness;
      material.side = parameters.side;
      material.needsUpdate = true;
    }
    setReferenceAppearance("white");
    setReferenceAlbumState(true);
    renderer.render(scene, camera);
  }
  return {
    preset: "white",
    source: "same live Punk high model, same production White appearance, camera, lighting and renderer; only optics/emblem visibility or live optics roughness/thickness vary",
    renderer: { width: renderer.domElement.width, height: renderer.domElement.height, toneMapping: renderer.toneMapping, toneMappingExposure: renderer.toneMappingExposure, shadowMapEnabled: renderer.shadowMap.enabled },
    model: { structure: model.userData.caseStructure, detail: model.userData.caseDetail, triangleCount: model.userData.caseStats?.triangleCount ?? 0, uniquePartCount: actualParts.length, actualParts },
    roi: { ...roi, nearestNeighborScale: scale, outputWidth: scaledWidth, outputHeight: scaledHeight },
    baselineWhiteOptics,
    candidates: candidateReports,
    selectionPolicy: "visual-only comparison; no automatic material ranking or production changes",
    contactSheet: contact.toDataURL("image/png"),
  };
}

window.caseReference = {
  rendererCount: 1,
  modelCount: 1,
  canvasWidth: renderer.domElement.width,
  canvasHeight: renderer.domElement.height,
  get coverSetup() {
    return {
      type: "synthetic non-personal test cover",
      sourceRect: { ...ART_RECT },
      projected3dRect: projectedCoverRect(),
      insertThickness: layout.insertThickness,
      insert: {
        visible: albumInsert.visible,
        castShadow: albumInsert.castShadow,
        receiveShadow: albumInsert.receiveShadow,
        materialType: albumInsert.material.type,
        transparent: albumInsert.material.transparent,
        opacity: albumInsert.material.opacity,
        emissive: albumInsert.material.emissive.getHexString(),
      },
      albumOcclusion: referenceAlbumState(),
      frontPrint: {
        visible: albumPrint.visible,
        materialType: albumPrint.material.type,
        textured: !!albumPrint.material.map,
        receiveShadow: albumPrint.receiveShadow,
        depthWrite: albumPrint.material.depthWrite,
        transparent: albumPrint.material.transparent,
        toneMapped: albumPrint.material.toneMapped,
        alphaTest: albumPrint.material.alphaTest,
        shaderKey: albumPrint.material.customProgramCacheKey(),
        emissive: albumPrint.material.emissive.getHexString(),
      },
    };
  },
  async capture(id) {
    if (!PRESETS.includes(id)) throw new Error("Unknown Punk reference preset: " + id);
    const source = await loadPresetImage(id);
    const originalCanvas = imageCanvas();
    const originalContext = originalCanvas.getContext("2d", { willReadFrequently: true });
    originalContext.fillStyle = BG;
    originalContext.fillRect(0, 0, SIZE, SIZE);
    originalContext.drawImage(testCover, ART_RECT.x, ART_RECT.y, ART_RECT.width, ART_RECT.height);
    originalContext.drawImage(source, 0, 0, SIZE, SIZE);
    setReferenceAppearance(id);
    setReferenceAlbumState(true);
    renderer.render(scene, camera);
    const renderedCanvas = imageCanvas();
    renderedCanvas.getContext("2d", { willReadFrequently: true }).drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
    const regions = {};
    for (const [part, region] of Object.entries(REGIONS)) regions[part] = {
      source: summarizePixels(originalCanvas, region),
      rendered: summarizePixels(renderedCanvas, region),
    };
    captures.set(id, { originalCanvas, renderedCanvas });
    const originalPng = originalCanvas.toDataURL("image/png");
    const renderedPng = renderedCanvas.toDataURL("image/png");
    source.close();
    return { id, regions, originalPng, renderedPng };
  },
  composeComparison(ids) {
    if (ids.length !== 5 || ids.some(id => !captures.has(id))) throw new Error("Comparison tables require five completed preset captures.");
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1800;
    const context = canvas.getContext("2d");
    context.fillStyle = BG;
    context.fillRect(0, 0, canvas.width, canvas.height);
    ids.forEach((id, index) => {
      const row = index * 360;
      const capture = captures.get(id);
      context.drawImage(capture.originalCanvas, 0, row, 360, 360);
      context.drawImage(capture.renderedCanvas, 360, row, 360, 360);
      context.fillStyle = "rgba(34, 31, 29, 0.78)";
      context.fillRect(5, row + 6, 174, 22);
      context.fillRect(365, row + 6, 206, 22);
      context.fillStyle = "#fff";
      context.font = "600 13px sans-serif";
      context.fillText(id + " · source + test cover", 11, row + 22);
      context.fillText(id + " · 3D + same test cover", 371, row + 22);
    });
    return canvas.toDataURL("image/png");
  },
  captureOpticalComparison,
  captureAuroraLighting,
  captureInsertShadowProjection,
  captureAlbumOcclusionEnvironmentHemi,
  captureMultiAngleComparisons,
  captureMaterialCandidateGrid,
  captureBlueAnisotropyDiagnostic,
  captureEmblemOpticsDiagnostic,
  dispose() {
    lighting.dispose();
    albumInsert.geometry.dispose();
    albumInsert.material.dispose();
    albumPrint.geometry.dispose();
    albumPrint.material.dispose();
    coverTexture.dispose();
    disposeCaseModel(model);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  },
};
window.caseReferenceReady = true;
`;

const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/case-editor.css"><style>
html,body{margin:0;background:#101923;color:#e8edf2;font:14px sans-serif}body{padding:24px}#editor-host{width:1450px;min-height:900px}.case-editor__workspace{grid-template-columns:minmax(360px,1fr) minmax(500px,1.15fr)}.case-editor__preview-stage{height:560px;min-height:560px}.case-editor__canvas,.case-editor__canvas canvas{width:100%;height:100%}.case-editor__canvas canvas{display:block}
</style></head><body><div id="editor-host"></div><script type="module" src="/case-check.js"></script></body></html>`;

const referenceHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=1000,initial-scale=1"><style>html,body{margin:0;width:1000px;height:1000px;overflow:hidden;background:#dedbd7}#reference-stage,#reference-stage canvas{display:block;width:1000px;height:1000px}</style></head><body><div id="reference-stage"></div><script type="module" src="/case-check.js"></script></body></html>`;

const assetPaths = new Map(isReference
  ? [
      ["/assets/punk-reference-case.glb", path.join(project, "public/assets/punk-reference-case.glb")],
      ...referencePresetIds.map(id => [
        `/assets/style/case/${id}/hero-clear.png`,
        path.join(project, "src/assets/style/case", id, "hero-clear.png"),
      ]),
      ...referenceAnglePresetIds.flatMap(id => referenceAngleFrameIds.map(index => {
        const frame = String(index).padStart(2, "0");
        return [
          `/assets/style/case/${id}/inspect-${frame}.png`,
          path.join(project, "src/assets/style/case", id, `inspect-${frame}.png`),
        ];
      })),
    ]
  : [
      ["/assets/music-cd.glb", path.join(project, "public/assets/music-cd.glb")],
      ["/assets/archive-cassette.glb", path.join(project, "public/assets/archive-cassette.glb")],
      ["/assets/archive-assembly.glb", path.join(project, "public/assets/archive-assembly.glb")],
      ["/assets/punk-reference-case.glb", path.join(project, "public/assets/punk-reference-case.glb")],
      ["/audio-tech/hi-res.svg", path.join(project, "public/audio-tech/hi-res.svg")],
      ["/audio-tech/dsd.svg", path.join(project, "public/audio-tech/dsd.svg")],
      ...["array-clear.png", "array-frost.png", "inspect-00.png"].map(file => [
        `/assets/style/case/white/${file}`,
        path.join(project, "src/assets/style/case/white", file),
      ]),
      ...["rail-front.png", "rail-mid.png", "rail-back.png"].map(file => [
        `/assets/style/rail/${file}`,
        path.join(project, "src/assets/style/rail", file),
      ]),
    ]);
const assetBuffers = new Map();
for (const [route, file] of assetPaths) assetBuffers.set(route, await readFile(file));
const archiveAssemblyTriangleData = isReference ? { total: 0, byMaterial: {} } : glbTriangleCounts(assetBuffers.get("/assets/archive-assembly.glb"));
const archiveCassetteTriangleData = isReference ? { total: 0, byMaterial: {} } : glbTriangleCounts(assetBuffers.get("/assets/archive-cassette.glb"));
const punkReferenceTriangleData = glbTriangleCounts(assetBuffers.get("/assets/punk-reference-case.glb"));
const archiveAssemblyTriangleCount = archiveAssemblyTriangleData.total;
const archiveCassetteCarbonInkTriangleCount = archiveCassetteTriangleData.byMaterial.Carbon_Ink ?? 0;
const punkReferenceTriangleCount = punkReferenceTriangleData.total;
const rhineFullSourceTriangleCount = archiveCassetteTriangleData.total;

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const route = url.pathname;
  if (route === "/" && request.method === "GET") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(isReference ? referenceHtml : fixtureHtml);
    return;
  }
  if (route === "/case-check.js" && request.method === "GET" && bundleJs) {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(bundleJs);
    return;
  }
  if (route === "/case-editor.css" && request.method === "GET") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
    response.end(bundleCss);
    return;
  }
  if (assetBuffers.has(route) && request.method === "GET") {
    const bytes = assetBuffers.get(route);
    const contentType = route.endsWith(".png") ? "image/png"
      : route.endsWith(".svg") ? "image/svg+xml; charset=utf-8"
        : "model/gltf-binary";
    response.writeHead(200, { "content-type": contentType, "content-length": bytes.length, "cache-control": "no-store" });
    response.end(bytes);
    return;
  }
  if (route === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  blockedRoutes.push(`${request.method} ${url.href}`);
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Offline fixture route is not whitelisted.");
});

let bundleJs = "";
let bundleCss = "";
const blockedRoutes = [];
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/`;
try {
  const built = await build({
    stdin: { contents: isReference ? referenceEntry : fixtureEntry, resolveDir: project, sourcefile: "case-system-check-entry.ts", loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outdir: ".tools/case-system-check/bundle",
    define: { "import.meta.env.BASE_URL": JSON.stringify(baseUrl) },
    plugins: [{
      name: "offline-case-fixture-adapters",
      setup(buildApi) {
        buildApi.onLoad({ filter: /[\\/]case-editor\.ts$/ }, async args => ({
          contents: (await readFile(args.path, "utf8")).replace(
            /new THREE\.WebGLRenderer\(/g,
            "new window.__CaseCheckWebGLRenderer(",
          ),
          loader: "ts",
        }));
        buildApi.onLoad({ filter: /[\\/]music-style\.ts$/ }, async args => ({
          contents: stubImportMetaGlobCalls(await readFile(args.path, "utf8"), args.path),
          loader: "ts",
        }));
      },
    }],
    logLevel: "silent",
  });
  bundleJs = built.outputFiles.find(file => file.path.endsWith(".js"))?.text ?? "";
  bundleCss = built.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  assert.ok(bundleJs, "esbuild must bundle the local offline fixture in memory.");
  if (!isReference) assert.ok(bundleCss, "esbuild must bundle the real case-editor.css stylesheet.");
} catch (error) {
  await new Promise(resolve => server.close(resolve));
  throw error;
}

const browserCandidates = [
  process.env.CASE_CHECK_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
let browserExecutable;
for (const candidate of browserCandidates) {
  if (await access(candidate).then(() => true, () => false)) { browserExecutable = candidate; break; }
}
assert.ok(browserExecutable, "An already-installed Chrome or Edge is required; this check never downloads a browser.");

const profile = path.join(output, `profile-${process.pid}-${Date.now()}`);
await mkdir(profile, { recursive: true });
const browser = spawn(browserExecutable, [
  "--headless=new",
  "--remote-debugging-port=0",
  "--remote-debugging-address=127.0.0.1",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-extensions",
  "--disable-default-apps",
  "--disable-features=OptimizationHints,MediaRouter",
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  `--user-data-dir=${profile}`,
], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let browserErrors = "";
browser.stderr.on("data", chunk => { browserErrors = (browserErrors + chunk.toString()).slice(-5000); });
let socket;
let sequence = 0;
const pending = new Map();
const browserLog = [];
const runtimeErrors = [];
const shaderErrors = [];
let sceneAcceptance = null;

function receive(event) {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.consoleAPICalled") {
    const text = message.params.args.map(argument => argument.value ?? argument.description ?? "").join(" ");
    browserLog.push({ type: message.params.type, text });
    if (/shader error|failed to compile|program link|link.*program|webgl.*error|gl_invalid/i.test(text)) shaderErrors.push(text);
  }
  if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails?.text ?? "Browser runtime exception");
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  clearTimeout(entry.timer);
  message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
}

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, isUnifiedRender ? 60000 : 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

function pngBuffer(dataUrl, label) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/u.exec(dataUrl ?? "");
  assert.ok(match, `${label} did not return a PNG data URL.`);
  return Buffer.from(match[1], "base64");
}

async function runReference(evaluate) {
  await mkdir(referenceOutput, { recursive: true });
  const initialization = await evaluate(`window.caseReferenceReady === true && window.caseReference ? {
    rendererCount: window.caseReference.rendererCount,
    modelCount: window.caseReference.modelCount,
    canvasWidth: window.caseReference.canvasWidth,
    canvasHeight: window.caseReference.canvasHeight,
    coverSetup: window.caseReference.coverSetup,
  } : null`);
  assert.equal(initialization.rendererCount, 1, "Reference mode must create one WebGL renderer.");
  assert.equal(initialization.modelCount, 1, "Reference mode must reuse one Punk model.");
  assert.equal(initialization.canvasWidth, 1000);
  assert.equal(initialization.canvasHeight, 1000);
  assert.ok(initialization.coverSetup.insertThickness > 0 && initialization.coverSetup.insert.visible &&
    initialization.coverSetup.insert.castShadow && initialization.coverSetup.insert.receiveShadow &&
    initialization.coverSetup.albumOcclusion.apiMatchesInsert && initialization.coverSetup.albumOcclusion.apiFlags.length === 1 &&
    initialization.coverSetup.albumOcclusion.apiFlags[0] === true &&
    initialization.coverSetup.insert.materialType === "MeshLambertMaterial" &&
    !initialization.coverSetup.insert.transparent && initialization.coverSetup.insert.opacity === 1 &&
    initialization.coverSetup.insert.emissive === "000000",
  "Reference rendering must use an opaque non-emissive Lambert paper card that casts and receives shadows.");
  assert.ok(initialization.coverSetup.frontPrint.visible && initialization.coverSetup.frontPrint.textured &&
    initialization.coverSetup.frontPrint.materialType === "MeshLambertMaterial" &&
    initialization.coverSetup.frontPrint.receiveShadow && initialization.coverSetup.frontPrint.depthWrite &&
    !initialization.coverSetup.frontPrint.transparent && initialization.coverSetup.frontPrint.emissive === "000000" &&
    initialization.coverSetup.frontPrint.toneMapped === false && initialization.coverSetup.frontPrint.alphaTest === 0.025 &&
    initialization.coverSetup.frontPrint.shaderKey === "album-diffuse-print-v1",
  "Reference rendering must use the production matte, capped-color album-print material at layout.cover.");
  const sourceRect = initialization.coverSetup.sourceRect;
  const renderedRect = initialization.coverSetup.projected3dRect;
  const coverAlignmentError = Math.max(
    Math.abs(sourceRect.x - renderedRect.x), Math.abs(sourceRect.y - renderedRect.y),
    Math.abs(sourceRect.width - renderedRect.width), Math.abs(sourceRect.height - renderedRect.height),
  );
  assert.ok(coverAlignmentError <= 18,
    "The source and 3D reference must use the same test cover aligned to the known hero rectangle: " + JSON.stringify({ sourceRect, renderedRect, coverAlignmentError }));

  let albumOcclusionAudit = null;
  albumOcclusionAudit = await evaluate("window.caseReference.captureAlbumOcclusionEnvironmentHemi()");
  await writeFile(path.join(referenceOutput, "album-occlusion-environment-hemi-ab.png"),
    pngBuffer(albumOcclusionAudit.contactSheet, "real insert occlusion under environment and hemisphere only"));
  delete albumOcclusionAudit.contactSheet;
  await writeFile(path.join(referenceOutput, "album-occlusion-environment-hemi-ab.json"),
    JSON.stringify(albumOcclusionAudit, null, 2));
  assert.deepEqual(albumOcclusionAudit.presets, ["white", "red", "glass"]);
  assert.ok(albumOcclusionAudit.directionalLightsHidden > 0 && albumOcclusionAudit.environmentAndHemisphereUnchanged,
    "Occlusion A/B must hide direct lights while leaving the same assigned environment and HemisphereLight values untouched: " + JSON.stringify(albumOcclusionAudit));
  assert.ok(albumOcclusionAudit.captures.every(capture =>
    capture.realInsert.albumInsertVisible && capture.realInsert.albumPrintVisible && capture.realInsert.apiMatchesInsert &&
    capture.realInsert.apiFlags.length === 1 && capture.realInsert.apiFlags[0] === true &&
    capture.absentInsert.albumInsertVisible === false && capture.absentInsert.albumPrintVisible === false &&
    capture.absentInsert.apiMatchesInsert && capture.absentInsert.apiFlags.length === 1 && capture.absentInsert.apiFlags[0] === false &&
    capture.shaderOffDiagnosticControl.diagnosticOnly && capture.shaderOffDiagnosticControl.albumInsertVisible &&
    capture.shaderOffDiagnosticControl.albumPrintVisible && capture.shaderOffDiagnosticControl.apiFlags.length === 1 &&
    capture.shaderOffDiagnosticControl.apiFlags[0] === false),
  "Every product present/absent capture must keep the real card visibility synchronized with the API; the separate shader-off control must retain the actual card geometry: " +
    JSON.stringify(albumOcclusionAudit.captures.map(capture => ({ preset: capture.preset, real: capture.realInsert, absent: capture.absentInsert, control: capture.shaderOffDiagnosticControl }))));
  assert.ok(albumOcclusionAudit.captures.every(capture => capture.innerGutter.meanDarkening > 2 &&
    capture.frontFrameControl.meanColorDelta <= 2.5 && capture.paperPrintControl.meanColorDelta <= 3),
  "The real card must darken a visible backing/inner-edge ROI without globally darkening the front frame or textured paper face: " +
    JSON.stringify(albumOcclusionAudit.captures.map(capture => ({
      preset: capture.preset,
      gutter: capture.innerGutter,
      frontFrameDelta: capture.frontFrameControl.meanColorDelta,
      printDelta: capture.paperPrintControl.meanColorDelta,
    }))));

  const measurements = [];
  const opticalComparisons = [];
  let emblemOpticsDiagnostic = null;
  let auroraLighting = null;
  let cardShadowProjection = null;
  let multiAngleComparisons = null;
  let materialCandidateAudit = null;
  let blueAnisotropyDiagnostic = null;
  try {
    emblemOpticsDiagnostic = await evaluate("window.caseReference.captureEmblemOpticsDiagnostic()");
    await writeFile(path.join(referenceOutput, "emblem-optics-diagnostic.png"),
      pngBuffer(emblemOpticsDiagnostic.contactSheet, "seven-candidate live emblem/optics diagnostic"));
    const emblemOpticsAudit = { ...emblemOpticsDiagnostic };
    delete emblemOpticsAudit.contactSheet;
    await writeFile(path.join(referenceOutput, "emblem-optics-diagnostic.json"), JSON.stringify(emblemOpticsAudit, null, 2));
    delete emblemOpticsDiagnostic.contactSheet;
    assert.equal(emblemOpticsDiagnostic.candidates.length, 7);
    assert.equal(emblemOpticsDiagnostic.model.uniquePartCount, 15,
      "The live optics contact sheet must use the full fifteen-part reference GLB.");
    assert.deepEqual(emblemOpticsDiagnostic.candidates.map(candidate => candidate.id), ["A", "B", "C", "D", "E", "F", "G"]);
    assert.ok(emblemOpticsDiagnostic.candidates.every(candidate => candidate.geometryPresence.length === 15 &&
      candidate.geometryPresence.some(part => part.part === "optics" && part.meshCount > 0) &&
      candidate.geometryPresence.some(part => part.part === "emblem" && part.meshCount > 0) &&
      candidate.geometryPresence.some(part => part.part === "accent" && part.meshCount > 0)),
    "Every optics candidate must report the actual GLB part geometry and opaque accent core: " + JSON.stringify(emblemOpticsDiagnostic.candidates.map(candidate => ({ id: candidate.id, geometry: candidate.geometryPresence }))));
    const candidateById = Object.fromEntries(emblemOpticsDiagnostic.candidates.map(candidate => [candidate.id, candidate]));
    assert.ok(candidateById.B.visibleMeshesByPart.optics.every(visible => !visible) &&
      candidateById.B.visibleMeshesByPart.emblem.every(Boolean) && candidateById.B.visibleMeshesByPart.accent.every(Boolean) &&
      candidateById.C.visibleMeshesByPart.optics.every(visible => !visible) &&
      candidateById.C.visibleMeshesByPart.emblem.every(visible => !visible) && candidateById.C.visibleMeshesByPart.accent.every(Boolean),
    "B/C visibility variants must retain the white emblem or isolate only the opaque accent core as labeled.");
    assert.ok(candidateById.D.focusMaterialParameters.optics.every(material => material.roughness === 0.015 && material.thickness === 0.002) &&
      candidateById.E.focusMaterialParameters.optics.every(material => material.roughness === 0.015 && material.thickness === 0),
    "D/E must change only the live optics material roughness/thickness values requested for the visual comparison.");

    for (const id of referencePresetIds) {
      const capture = await evaluate(`window.caseReference.capture(${JSON.stringify(id)})`);
      assert.equal(capture.id, id, `Reference renderer returned the wrong preset for ${id}.`);
      await writeFile(path.join(referenceOutput, `${id}-original.png`), pngBuffer(capture.originalPng, `${id} source image`));
      await writeFile(path.join(referenceOutput, `${id}-rendered.png`), pngBuffer(capture.renderedPng, `${id} rendered image`));
      measurements.push({ preset: id, parts: capture.regions });
      console.log(`Captured Punk reference preset: ${id}`);
    }
    for (const [index, start] of [0, 5].entries()) {
      const ids = referencePresetIds.slice(start, start + 5);
      const table = await evaluate(`window.caseReference.composeComparison(${JSON.stringify(ids)})`);
      await writeFile(path.join(referenceOutput, `comparison-${String(index + 1).padStart(2, "0")}.png`), pngBuffer(table, `comparison table ${index + 1}`));
    }
    multiAngleComparisons = await evaluate("window.caseReference.captureMultiAngleComparisons()");
    await writeFile(path.join(referenceOutput, "multi-angle-source-3d-contact.png"),
      pngBuffer(multiAngleComparisons.contactSheet, "six-skin multi-angle source/3D contact sheet"));
    await writeFile(path.join(referenceOutput, "frame-point-view-response.png"),
      pngBuffer(multiAngleComparisons.frameRoiContactSheet, "same-frame-point view response contact sheet"));
    const multiAngleAudit = { ...multiAngleComparisons, contactSheet: undefined, frameRoiContactSheet: undefined };
    await writeFile(path.join(referenceOutput, "multi-angle-source-3d-data.json"), JSON.stringify(multiAngleAudit, null, 2));
    delete multiAngleComparisons.contactSheet;
    delete multiAngleComparisons.frameRoiContactSheet;
    assert.deepEqual(multiAngleComparisons.sourcePresets, ["white", "glass", "frost", "red", "blue", "aurora"]);
    assert.deepEqual(multiAngleComparisons.sourceAngles, [0, 23, 45, 59]);
    assert.equal(multiAngleComparisons.perPreset.length, 6);
    assert.ok(multiAngleComparisons.perPreset.every(preset => preset.views.length === 4 &&
      preset.views.map(view => view.index).join(",") === "0,23,45,59" &&
      ["measured-same-raycast-world-point", "source-roi-background-invalid", "no-jointly-visible-raycast-point"].includes(preset.frameViewResponse.status) &&
      (preset.frameViewResponse.status !== "measured-same-raycast-world-point" ||
        (Number.isFinite(preset.frameViewResponse.renderedMeanColorDelta) && preset.frameViewResponse.sourceRoiOnShell === true)) &&
      preset.frameMaterials.meshCount > 0 && preset.coverMaterials.meshCount > 0),
    "Each selected Punk skin must compare the four inspect views and measure the same raycast frame point's view response, with current physical material values: " + JSON.stringify(multiAngleComparisons.perPreset));
    const sourceAngleMatches = multiAngleComparisons.perPreset.flatMap(preset => preset.views)
      .map(view => view.cameraMatch);
    assert.ok(sourceAngleMatches.every(match => match === "source-matched" || match === "estimated-from-source-quad-fit"),
      "Every source camera comparison must state whether its inspect projection is matched or estimated.");
    assert.ok(multiAngleComparisons.perPreset.every(preset => preset.frameViewResponse.status === "measured-same-raycast-world-point" &&
      preset.frameViewResponse.sourceRoiOnShell),
    "The same world-point ROI must sample actual non-background source shell pixels before the reference run is marked passed: " + JSON.stringify(multiAngleComparisons.perPreset.map(preset => ({ preset: preset.preset, response: preset.frameViewResponse }))));
    materialCandidateAudit = await evaluate("window.caseReference.captureMaterialCandidateGrid(" +
      JSON.stringify(multiAngleComparisons.framePoint.worldPoint) + ")");
    assert.equal(materialCandidateAudit.candidates.length, 9);
    assert.ok(materialCandidateAudit.candidates.every(candidate => candidate.clearcoatUnchanged && candidate.clearcoatRoughnessUnchanged &&
      candidate.selectionPolicy.includes("visual comparison only")),
    "Red/blue material sweeps must hold clearcoat values fixed and remain a visual review tool, not an automatic ranking.");
    await writeFile(path.join(referenceOutput, "frame-material-candidate-grid.png"),
      pngBuffer(materialCandidateAudit.contactSheet, "red and blue clearcoat-preserving candidate grid"));
    delete materialCandidateAudit.contactSheet;
    blueAnisotropyDiagnostic = await evaluate("window.caseReference.captureBlueAnisotropyDiagnostic(" +
      JSON.stringify(multiAngleComparisons.framePoint.worldPoint) + ")");
    await writeFile(path.join(referenceOutput, "blue-anisotropy-shadow-diagnostic.png"),
      pngBuffer(blueAnisotropyDiagnostic.contactSheet, "Blue anisotropy and shadowMap diagnostic"));
    delete blueAnisotropyDiagnostic.contactSheet;
    await writeFile(path.join(referenceOutput, "blue-anisotropy-shadow-diagnostic.json"),
      JSON.stringify(blueAnisotropyDiagnostic, null, 2));
    assert.equal(blueAnisotropyDiagnostic.captures.length, 8);
    assert.ok(blueAnisotropyDiagnostic.captures.every(capture => capture.sameAsBlueExceptAnisotropy),
      "Blue anisotropy/shadow diagnostic must change only anisotropy and render shadowMap on/off variants of the same preset: " +
      JSON.stringify(blueAnisotropyDiagnostic.captures.map(capture => ({
        shadowMapEnabled: capture.shadowMapEnabled,
        viewIndex: capture.viewIndex,
        anisotropy: capture.anisotropy,
        differences: capture.parameterDifferences,
      }))));
    for (const id of ["white", "marble", "aurora"]) {
      const comparison = await evaluate(`window.caseReference.captureOpticalComparison(${JSON.stringify(id)})`);
      assert.equal(comparison.preset, id);
      assert.ok(comparison.albumStates.emptyRed.apiMatchesInsert && comparison.albumStates.emptyGreen.apiMatchesInsert &&
        comparison.albumStates.emptyRed.albumInsertVisible === false && comparison.albumStates.emptyGreen.albumInsertVisible === false &&
        comparison.albumStates.coveredRed.apiMatchesInsert && comparison.albumStates.coveredGreen.apiMatchesInsert &&
        comparison.albumStates.coveredRed.albumInsertVisible && comparison.albumStates.coveredGreen.albumInsertVisible,
      `${id}: every back-color image capture must synchronize real insert visibility and the album-occlusion API.`);
      assert.ok(comparison.emptyBackColorDelta > 18,
        `${id}: the empty-case control must respond when the real back material changes from red to green: ${JSON.stringify(comparison)}`);
      assert.ok(comparison.coveredBackColorDelta <= 8,
        `${id}: the opaque test cover must keep its center pixel stable when the hidden back material changes: ${JSON.stringify(comparison)}`);
      await writeFile(path.join(referenceOutput, `${id}-empty-vs-covered-ab.png`), pngBuffer(comparison.comparisonPng, `${id} opaque-cover A/B comparison`));
      await writeFile(path.join(referenceOutput, `${id}-oblique-test-cover.png`), pngBuffer(comparison.obliquePng, `${id} oblique test-cover render`));
      opticalComparisons.push({ ...comparison, comparisonPng: undefined, obliquePng: undefined });
      console.log(`Verified opaque insert A/B and oblique GLB render: ${id}`);
    }
    auroraLighting = await evaluate("window.caseReference.captureAuroraLighting()");
    assert.equal(auroraLighting.preset, "aurora");
    assert.equal(auroraLighting.pattern, "gradient");
    assert.ok((auroraLighting.material.iridescence > 0 || auroraLighting.material.clearcoat > 0) &&
      auroraLighting.material.gradientPatternShader && auroraLighting.material.compiledPrograms > 0 &&
      auroraLighting.fixedFrameRoiMeanAbsoluteDeltaUnderLightChange > 1,
    "Aurora PBR gradient and specular response must visibly change under two key-light directions on the same GLB/model: " + JSON.stringify(auroraLighting));
    await writeFile(path.join(referenceOutput, "aurora-two-key-light-directions.png"), pngBuffer(auroraLighting.comparisonPng, "Aurora lighting comparison"));
    delete auroraLighting.comparisonPng;
    cardShadowProjection = await evaluate("window.caseReference.captureInsertShadowProjection()");
    assert.equal(cardShadowProjection.sameBackingColor, "#c6c6c2");
    assert.ok(cardShadowProjection.sameOpaquePrintInBothFrames && cardShadowProjection.pixelProjection.meanDarkening > 2 &&
      cardShadowProjection.pixelProjection.darkerPixelFraction > 0.05,
    "The opaque album insert must cast a measurable real shadow onto the adjacent neutral backboard gutter: " + JSON.stringify(cardShadowProjection));
    await writeFile(path.join(referenceOutput, "paper-card-shadow-ab.png"), pngBuffer(cardShadowProjection.comparisonPng, "paper-card shadow projection comparison"));
    delete cardShadowProjection.comparisonPng;
  } finally {
    await evaluate("window.caseReference?.dispose()").catch(() => {});
  }

  assert.deepEqual(blockedRoutes, [], "Reference mode requested a route outside the offline asset whitelist.");
  const report = {
    ok: true,
    mode: "reference",
    emblemOpticsDiagnostic,
    model: { structure: "punk", detail: "high", instances: 1 },
    renderer: {
      instances: 1,
      width: 1000,
      height: 1000,
      antialias: true,
      shadows: true,
      toneMapping: "ACESFilmicToneMapping",
      toneMappingExposure: 1.0,
      background: "#dedbd7",
    },
    projection: {
      modelScale: 3.35 / 3.5,
      pixelsPerUnit: 210 / (3.35 / 3.5),
      orthographicSpan: 1000 / (210 / (3.35 / 3.5)),
      center: [0, 1.85, 0],
      cameraPosition: [0, 1.85, 12],
      sourceOriginPixels: [500, 867.5],
      sourcePixelsPerUnit: 210,
      modelOriginAlignmentOffset: 0,
    },
    sampleRegions: referenceRegions,
    colorMeasurements: measurements,
    testCover: {
      type: "synthetic non-personal cover with dark field, diagonal marks, and labels",
      sourceRect,
      projected3dRect: renderedRect,
      maxAlignmentErrorPixels: coverAlignmentError,
      sameCoverInSourceAndRender: true,
      insert: initialization.coverSetup.insert,
      frontPrint: initialization.coverSetup.frontPrint,
    },
    measurementNote: "Median and mean values are rendered sRGB pixels from the specified image regions, not material base-color values. The same synthetic non-personal cover is composited into the source hero and rendered as a textured 3D Lambert plane; sampled material regions exclude the artwork window.",
    opaqueCoverBackMaterialComparisons: opticalComparisons,
    auroraTwoLightDirectionPbr: auroraLighting,
    insertShadowProjection: cardShadowProjection,
    indirectAlbumOcclusionEnvironmentHemi: albumOcclusionAudit,
    multiAngleSource3dAndFrameViewResponse: multiAngleComparisons,
    frameMaterialCandidateVisualAudit: materialCandidateAudit,
    blueAnisotropyShadowDiagnostic: blueAnisotropyDiagnostic,
    assetsServed: [...assetPaths.keys()],
    blockedRoutes,
    shaderErrors,
    runtimeErrors,
    comparisonTables: [
      { file: "comparison-01.png", presets: referencePresetIds.slice(0, 5), width: 720, height: 1800 },
      { file: "comparison-02.png", presets: referencePresetIds.slice(5), width: 720, height: 1800 },
    ],
    opticalComparisonImages: ["white-empty-vs-covered-ab.png", "marble-empty-vs-covered-ab.png", "aurora-empty-vs-covered-ab.png"],
    obliqueTestCoverImages: ["white-oblique-test-cover.png", "marble-oblique-test-cover.png", "aurora-oblique-test-cover.png"],
    auroraLightingImage: "aurora-two-key-light-directions.png",
    insertShadowProjectionImage: "paper-card-shadow-ab.png",
    indirectAlbumOcclusionImage: "album-occlusion-environment-hemi-ab.png",
    multiAngleContactSheet: "multi-angle-source-3d-contact.png",
    sameFramePointContactSheet: "frame-point-view-response.png",
    frameMaterialCandidateGrid: "frame-material-candidate-grid.png",
    blueAnisotropyShadowDiagnosticImage: "blue-anisotropy-shadow-diagnostic.png",
    emblemOpticsDiagnosticImage: "emblem-optics-diagnostic.png",
    emblemOpticsDiagnosticData: "emblem-optics-diagnostic.json",
    multiAngleAudit: "multi-angle-source-3d-data.json",
  };
  await writeFile(path.join(referenceOutput, "colors.json"), JSON.stringify(report, null, 2));
  console.log(`Reference images and color comparison: ${referenceOutput}`);
}

async function main() {
  if (!isReference) assert.equal(archiveAssemblyTriangleCount, 82346,
    "The served archive-assembly.glb source must contain 82,346 triangle primitives in its active GLB scene.");
  if (!isReference) assert.equal(archiveCassetteCarbonInkTriangleCount, 3808,
    "The served archive-cassette.glb Carbon_Ink source surface must contain 3,808 triangles.");
  if (!isReference) assert.equal(rhineFullSourceTriangleCount, 86154,
    "The complete upstream cassette source must contain 86,154 triangles.");
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await stat(portFile).then(() => true, () => false)) break;
    if (browser.exitCode !== null) throw new Error(`Browser exited before CDP became ready: ${browserErrors}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const [debugPort, endpoint] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${debugPort}${endpoint}`);
  socket.addEventListener("message", receive);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  await command("Runtime.enable", {});
  await command("Log.enable", {});
  await command("Page.enable", {});
  await command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1500, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  await command("Page.navigate", { url: baseUrl });
  for (let attempt = 0; attempt < 200; attempt++) {
    const readyExpression = isReference
      ? "document.readyState === 'complete' && window.caseReferenceReady === true && !!window.caseReference"
      : "document.readyState === 'complete' && !!window.caseCheck";
    const ready = await evaluate(readyExpression).catch(() => false);
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate(isReference ? "!!window.caseReference" : "!!window.caseCheck"), true, "Offline fixture module must load.");
  if (isReference) {
    await runReference(evaluate);
    return;
  }

  if (isUnifiedRender) {
    await mkdir(unifiedOutput, { recursive: true });
    await command("Emulation.setDeviceMetricsOverride", { width: 1450, height: 840, deviceScaleFactor: 1, mobile: false });
    if (process.argv.includes("--punk-array-motion")) {
      const motionOutput = path.join(project, ".tools", "array-surface-refinement");
      await mkdir(motionOutput, { recursive: true });
      const motion = await evaluate("window.caseCheck.exercisePunkArrayMotion()");
      const hoverChecks = [], surfaceChecks = [];
      for (const design of ["archive", "rhine"]) {
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1440, y: 830 });
        const targets = await evaluate("window.caseCheck.prepareArrayPointer(" + JSON.stringify(design) + ")");
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: targets.selected.x, y: targets.selected.y });
        const hovered = await evaluate("window.caseCheck.arrayHoverSnapshot()");
        assert.ok(Math.abs(hovered.y - targets.baseline.y - .5) < 2e-5,
          "Pointer move alone adds exactly the selected hover lift: " + JSON.stringify({ design, baseline: targets.baseline, hovered }));
        assert.deepEqual(hovered.selected, targets.baseline.selected);
        assert.deepEqual(hovered.catalog, targets.baseline.catalog);
        assert.equal(hovered.phase, targets.baseline.phase); assert.equal(hovered.phase, "archive");
        assert.equal(hovered.clicks, targets.baseline.clicks); assert.equal(hovered.opens, targets.baseline.opens);
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: targets.other.x, y: targets.other.y });
        const other = await evaluate("window.caseCheck.arrayHoverSnapshot()");
        assert.ok(Math.abs(other.y - targets.baseline.y) < 2e-5, "Another track from the same album cannot masquerade as selected hover.");
        assert.deepEqual(other.selected, targets.baseline.selected);
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: targets.selected.x, y: targets.selected.y });
        await evaluate("window.caseCheck.arrayHoverSnapshot()");
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1451, y: 841 });
        const left = await evaluate("window.caseCheck.arrayHoverSnapshot()");
        assert.ok(Math.abs(left.y - targets.baseline.y) < 2e-5, "Pointer leave restores the selected browsing lift.");
        hoverChecks.push({ design, targets, hovered, other, left });
        const screen = await command("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1450, height: 840, scale: 1 } });
        await writeFile(path.join(motionOutput, "array-" + design + "-selection.png"), Buffer.from(screen.data, "base64"));
        const variants = [];
        for (const floor of design === "archive" ? ["plain", "deck", "real", "plain"] : ["plain", "deck"]) {
          const surface = await evaluate("window.caseCheck.arraySurfaceVariant(" + [design, floor].map(JSON.stringify).join(",") + ")");
          if ((floor === "plain" && variants.length === 0) || (design === "archive" && floor === "deck")) {
            await writeFile(path.join(motionOutput, "array-" + design + "-" + floor + ".png"), pngBuffer(surface.standard, "Array floor screenshot"));
            await writeFile(path.join(motionOutput, "array-" + design + "-" + floor + "-closeup.png"), pngBuffer(surface.closeup, "Array floor closeup"));
          }
          variants.push(surface.detail);
        }
        assert.deepEqual(variants[0].textures, variants.at(-1).textures, "Returning to a floor style reuses its retained surface textures.");
        surfaceChecks.push({ design, variants });
      }
      assert.deepEqual(runtimeErrors, []); assert.deepEqual(shaderErrors, []); assert.deepEqual(blockedRoutes, []);
      await writeFile(path.join(motionOutput, "scene-motion-audit.json"), JSON.stringify({ ok: true, ...motion, hoverChecks, surfaceChecks,
        runtimeErrors, shaderErrors, blockedRoutes }, null, 2));
      console.log(JSON.stringify({ ok: true, checks: ["Common ARRAY independent rails", "persistent selection and neighbor lift", "real selected-only pointer hover", "off/reduced shape", "twenty-slot final partial tray", "detail/return bounds", "both MATRIX guards"],
        report: ".tools/array-surface-refinement/scene-motion-audit.json" }, null, 2));
      return;
    }
    const result = await evaluate("window.caseCheck.exerciseUnifiedRender()");
    await writeFile(path.join(unifiedOutput, "unified-production-paper-occlusion.png"), pngBuffer(result.paperProtection.image, "Production paper protection"));
    delete result.paperProtection.image;
    await writeFile(path.join(unifiedOutput, "unified-archive-asymmetric-bounds.png"), pngBuffer(result.transformedImage, "Asymmetric bounds scene"));
    delete result.transformedImage;
    const target = result.pointerTarget;
    const click = async (point, count) => {
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: count });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: count });
    };
    await click(target, 1);
    const selected = await evaluate("window.caseCheck.unifiedRenderResult()");
    assert.equal(selected.clicks.at(-1)?.cell?.foobarEntryKey, target.key, "Shelf raycasting selects the actual visible entry key.");
    assert.equal(selected.clicks.at(-1)?.index, target.index);
    const selectedTarget = await evaluate("window.caseCheck.unifiedPointerTarget(true)");
    await click(selectedTarget, 1); await click(selectedTarget, 2);
    const opened = await evaluate("window.caseCheck.unifiedRenderResult()");
    await writeFile(path.join(unifiedOutput, "unified-pointer-diagnostic.json"), JSON.stringify({ target, selectedTarget, selected, opened }, null, 2));
    assert.equal(opened.opens.at(-1)?.index, target.index, "A real double click invokes the shelf album-open callback: " +
      JSON.stringify({ selectedTarget, clicks: opened.clicks, opens: opened.opens, phase: opened.snapshot.stats.musicPresentationPhase }));
    assert.equal(opened.opens.at(-1)?.key, target.key);
    const screenshots = [];
    for (const [design, mode, scheme] of [["rhine", "day", "rhine"], ["rhine", "night", "rhine"],
      ["archive", "day", "front"], ["archive", "night", "hazard"]]) {
      const snapshot = await evaluate("window.caseCheck.unifiedRenderVariant(" + [design, mode, scheme].map(JSON.stringify).join(",") + ")");
      const name = "unified-" + design + "-" + mode + "-" + scheme + ".png";
      const screen = await command("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1450, height: 840, scale: 1 } });
      await writeFile(path.join(unifiedOutput, name), Buffer.from(screen.data, "base64"));
      screenshots.push({ name, snapshot });
      if (design === "archive") {
        assert.match(snapshot.clipPath, /^inset\(0(?:px)? [1-9]/, "Punk shelves keep the right information region clipped.");
        const pixel = await evaluate("(async()=>{const i=new Image();i.src=" + JSON.stringify("data:image/png;base64," + screen.data) +
          ";await i.decode();const c=document.createElement('canvas');c.width=1450;c.height=840;const x=c.getContext('2d');x.drawImage(i,0,0);return Array.from(x.getImageData(1430,820,1,1).data);})()");
        const bg = await evaluate("getComputedStyle(document.getElementById('scene-host')).backgroundColor");
        const rgb = bg.match(/\d+/g).slice(0, 3).map(Number);
        assert.deepEqual(pixel, [...rgb, 255], "Punk's clipped right region preserves its theme background.");
      }
    }
    const motionOutput = path.join(project, ".tools", "array-surface-refinement");
    await mkdir(motionOutput, { recursive: true });
    const motion = await evaluate("window.caseCheck.exercisePunkArrayMotion()");
    await writeFile(path.join(motionOutput, "scene-motion-unified-audit.json"), JSON.stringify({ ok: true, ...motion,
      runtimeErrors, shaderErrors, blockedRoutes }, null, 2));
    assert.deepEqual(runtimeErrors, []); assert.deepEqual(shaderErrors, []); assert.deepEqual(blockedRoutes, []);
    await writeFile(path.join(unifiedOutput, "unified-render-audit.json"), JSON.stringify({ ok: true,
      scope: "Production ArchiveScene/WebGL, local GLBs and browser pointer input; synthetic tracks only, no player or audio ports.",
      ...result, pointerResult: opened, screenshots, runtimeErrors, shaderErrors, blockedRoutes }, null, 2));
    console.log(JSON.stringify({ ok: true, checks: ["Both physical shelves", "sole WebGL canvas", "finite TRACKS identity/paging",
      "query recovery", "detail/layout continuity", "transformed spacing", "real raycast and double click", "Punk clipping"],
      report: ".tools/array-surface-refinement/unified-render-audit.json", screenshots: screenshots.map(item => item.name) }, null, 2));
    return;
  }
  const fixture = await evaluate("window.caseCheck.run()");
  assert.deepEqual(fixture.musicStyleAudit, {
    caseCardsAbsent: true,
    schemeCardsPresent: true,
    schemePreviewPresent: true,
    displaySettingsPresent: true,
    themeSwitchPresent: true,
    qualitySlotPresent: true,
  }, "Archive style page must remove the native CASE SKIN picker and PNG preview while preserving theme, scheme, display, and quality controls.");
  assert.deepEqual(fixture.archiveEnabledMigration, {
    defaultEnabled: true,
    migratedEnabled: true,
    appearanceRetained: true,
    futureIndependent: true,
  }, "Legacy Archive profiles must force editable Punk without changing their saved appearance or Future profile.");
  assert.ok(fixture.initialEditorReady, "The editor's independent-cover preview must render before interaction tests: " + JSON.stringify(fixture.editorStatus));
  assert.equal(fixture.models.length, 7);
  assert.ok(fixture.models.every(model => model.layoutAspectPreserved), "Every structure/detail pair must preserve its own model layout width/height/depth ratios.");
  assert.ok(fixture.punkHighVertices > fixture.punkLowVertices, "Punk detail levels must change the actual geometry.");
  assert.deepEqual(fixture.punkPresetIds, ["marble", "hazard", "white", "glass", "frost", "red", "blue", "coral", "tide", "aurora"]);
  assert.equal(fixture.settingsAudit.punkPartCount, 15);
  assert.equal(fixture.settingsAudit.rhinePartCount, 10);
  assert.equal(fixture.settingsAudit.legacySurfacePreserved, true);
  assert.deepEqual(fixture.settingsAudit.normalizedTransform, { visible: false, offset: [0.25, -0.5, 10], rotation: [10, 20, 360], scale: [1.5, 0.01, 1] });
  assert.equal(fixture.rhineHighTriangles, 33256);
  assert.equal(archiveAssemblyTriangleCount, 82346);
  assert.equal(archiveCassetteCarbonInkTriangleCount, 3808);
  assert.ok(fixture.rhineHighTriangles < rhineFullSourceTriangleCount,
    "Rhine runtime must reuse the unmodified source asset but omit internal display components.");
  const rhineInsetAlbum = await evaluate("window.caseCheck.captureRhineInsetAlbum()");
  for (const [view, data] of Object.entries(rhineInsetAlbum.images)) {
    await writeFile(path.join(output, "rhine-inset-album-" + view + ".png"), Buffer.from(data.slice("data:image/png;base64,".length), "base64"));
  }
  delete rhineInsetAlbum.images;
  await writeFile(path.join(output,"rhine-inset-window-audit.json"),JSON.stringify(rhineInsetAlbum,null,2));
  assert.ok(rhineInsetAlbum.clearFrostInside > 2000 && rhineInsetAlbum.clearEmptyInside > 2000,
    "The actual Rhine GLB window must show the inserted artwork and react to window clarity: " + JSON.stringify(rhineInsetAlbum));
  assert.ok(rhineInsetAlbum.clearFrostOutside < 150,
    "Changing window clarity must retain the original glass outside its square: " + JSON.stringify(rhineInsetAlbum));
  assert.ok(rhineInsetAlbum.checkerContrastClear > 70 && rhineInsetAlbum.checkerContrastLegacy > 70 && rhineInsetAlbum.checkerContrastFrost < rhineInsetAlbum.checkerContrastClear,
    "The aperture must show sharp artwork even when a legacy exterior coating is opaque: " + JSON.stringify(rhineInsetAlbum));
  const rhineAlbumInfo = await evaluate("window.caseCheck.captureRhineAlbumInfo()");
  for (const [view, data] of Object.entries(rhineAlbumInfo.images))
    await writeFile(path.join(output, `rhine-album-${view}.png`), Buffer.from(data.slice("data:image/png;base64,".length), "base64"));
  delete rhineAlbumInfo.images;
  await writeFile(path.join(output, "rhine-album-info-audit.json"), JSON.stringify(rhineAlbumInfo, null, 2));
  assert.deepEqual(rhineAlbumInfo.badges, { hiRes: "hi-res", dsd: "hi-res-dsd" },
    "Synthetic source metadata must show Hi-Res alone or both DSD-qualified marks.");
  assert.deepEqual(rhineAlbumInfo.slotAudit.numberText, ["NO.001", "NO.010", "NO.003", "NO.---"]);
  assert.deepEqual(rhineAlbumInfo.slotAudit.archiveIndex, [0, 9, 2, null]);
  assert.deepEqual(rhineAlbumInfo.slotAudit.sourceBadges, ["hi-res", "hi-res-dsd", null, null]);
  assert.deepEqual(rhineAlbumInfo.slotAudit.instanceBadgeTypes, [1, 3, 0, 0]);
  assert.ok(Object.values(rhineAlbumInfo.slotAudit.textureColorSpaces).every(space => space === "srgb"));
  assert.equal(rhineAlbumInfo.assetStatus.state, "ready");
  assert.deepEqual({
    labelMark: rhineAlbumInfo.assetStatus.labelMark,
    hiResBadge: rhineAlbumInfo.assetStatus.hiResBadge,
    dsdBadge: rhineAlbumInfo.assetStatus.dsdBadge,
  }, { labelMark: "loaded", hiResBadge: "loaded", dsdBadge: "loaded" });
  assert.deepEqual(rhineAlbumInfo.assetStatus.errors, {});
  assert.deepEqual({ width: rhineAlbumInfo.rawLabelCanvasAudit.width, height: rhineAlbumInfo.rawLabelCanvasAudit.height },
    { width: 1024, height: 440 }, "The selected label must retain the complete 1024×440 source Canvas.");
  assert.ok(rhineAlbumInfo.rawLabelCanvasAudit.topRuleDarkPixels > 5000 &&
    rhineAlbumInfo.rawLabelCanvasAudit.bottomRuleDarkPixels > 2500 &&
    rhineAlbumInfo.rawLabelCanvasAudit.infoBarDarkPixels > 8000 &&
    rhineAlbumInfo.rawLabelCanvasAudit.infoTextDarkPixels > 0 &&
    rhineAlbumInfo.rawLabelCanvasAudit.numberDarkPixels > 0 &&
    rhineAlbumInfo.rawLabelCanvasAudit.brandMarkDarkPixels > 0,
  "The raw Canvas must contain both rule lines, INFO, number, and brand mark before any WebGL layering: " + JSON.stringify(rhineAlbumInfo.rawLabelCanvasAudit));
  assert.equal(rhineAlbumInfo.labelDepthDiagnostic.selectedLabelMaterial.depthWriteBeforeAblation, true,
    "Production selected-label material must write depth.");
  assert.equal(rhineAlbumInfo.labelDepthDiagnostic.arrayLabelMaterial.depthWrite, true,
    "Every array label instance must write depth with the same opaque label material.");
  assert.equal(rhineAlbumInfo.snapshot.labelDepthWrite, true,
    "Outgoing snapshot labels must retain the depth-write fix.");
  assert.equal(rhineAlbumInfo.depthWriteAblation.changedPixels > 0, true,
    "The isolated depthWrite A/B must produce a measurable render change.");
  assert.ok(rhineAlbumInfo.labelDepthDiagnostic.shellSurfaces.some(surface => surface.surface === "Frosted_Polymer") &&
    rhineAlbumInfo.labelDepthDiagnostic.shellSurfaces.some(surface => surface.surface === "Carbon_Ink"),
  "The label depth report must include front-glass and original ink bounds/order/material IDs.");
  assert.equal(rhineAlbumInfo.depthWriteAblation.onlyChangedMaterialProperty, "selectedLabel.material.depthWrite");
  assert.deepEqual([rhineAlbumInfo.depthWriteAblation.depthWriteOff, rhineAlbumInfo.depthWriteAblation.depthWriteOn], [false, true]);
  assert.equal(rhineAlbumInfo.assembledLabelRegionCompare.changedPixels, 0,
    "With production depthWrite enabled, the projected label plane interior must match the isolated label within a 2px inset.");
  assert.deepEqual(rhineAlbumInfo.selectedDsd, { numberText: "NO.010", formatBadge: "hi-res-dsd" });
  assert.deepEqual(rhineAlbumInfo.selectedAfterSnapshotChange, {
    numberText: "NO.001", labelPixelsChanged: true, snapshotPixelsStable: true,
  });
  assert.ok(rhineAlbumInfo.snapshot.labelTextureIndependent && rhineAlbumInfo.snapshot.badgeMaterialIndependent &&
    rhineAlbumInfo.snapshot.badgeAtlasShared && rhineAlbumInfo.snapshot.labelPixelsStableAfterSelection,
  "Outgoing labels need independent pixels/materials while the badge shader safely shares its atlas.");
  assert.deepEqual(rhineAlbumInfo.snapshotDisposal, {
    ownedLabelTextureDisposed: true,
    snapshotBadgeMaterialDisposed: true,
    selectedTextureDisposed: false,
    sharedBadgeAtlasDisposed: false,
  }, "CardAppearance disposal must release only snapshot-owned label pixels and materials.");
  assert.deepEqual(rhineAlbumInfo.selectedMetadataRefresh, { before: "hi-res", after: null },
    "Selecting the same record after in-place source metadata changes must recalculate its badge key.");
  assert.equal(rhineAlbumInfo.inPlaceRefresh.refreshedType, 0,
    "The fixed-pool atlas must reclassify an edited track after explicit refresh().");
  const badgeLayouts = rhineAlbumInfo.badgeLayouts;
  assert.ok(badgeLayouts.hiResOnlyLayout.inkPixels > 100 &&
    Math.abs(badgeLayouts.hiResOnlyLayout.centroidOffsetX) <= 18 &&
    Math.abs(badgeLayouts.hiResOnlyLayout.boundsCenterOffsetX) <= 18,
  "The rendered single Hi-Res mark must be visibly centered on its badge plane: " + JSON.stringify(badgeLayouts.hiResOnlyLayout));
  assert.ok(badgeLayouts.dsdOnlySyntheticLayout.inkPixels > 100 &&
    Math.abs(badgeLayouts.dsdOnlySyntheticLayout.centroidOffsetX) <= 18 &&
    Math.abs(badgeLayouts.dsdOnlySyntheticLayout.boundsCenterOffsetX) <= 18,
  "The low-level DSD-only synthetic shader branch must center one mark without changing source classification: " + JSON.stringify(badgeLayouts.dsdOnlySyntheticLayout));
  assert.ok(badgeLayouts.pairedLayout.left.inkPixels > 100 && badgeLayouts.pairedLayout.right.inkPixels > 100 &&
    badgeLayouts.pairedLayout.left.maxX < badgeLayouts.pairedLayout.width / 2 &&
    badgeLayouts.pairedLayout.right.minX >= badgeLayouts.pairedLayout.width / 2 &&
    badgeLayouts.pairedLayout.left.centroidX < badgeLayouts.pairedLayout.width / 2 - 20 &&
    badgeLayouts.pairedLayout.right.centroidX > badgeLayouts.pairedLayout.width / 2 + 20 &&
    Math.abs((badgeLayouts.pairedLayout.width / 2 - badgeLayouts.pairedLayout.left.centroidX) -
      (badgeLayouts.pairedLayout.right.centroidX - badgeLayouts.pairedLayout.width / 2)) <= 20 &&
    badgeLayouts.pairedLayout.leftRightGapPixels > 0 && badgeLayouts.pairedLayout.centerGapInkPixels === 0 &&
    Math.abs(badgeLayouts.pairedLayout.boundsCenterOffsetX) <= 18,
  "A combined DSD/Hi-Res mark must render as two separated left/right icons with a central gap: " + JSON.stringify(badgeLayouts.pairedLayout));
  assert.equal(badgeLayouts.pairedSourceBadgeBeforeDsdOnlyProbe, "hi-res-dsd");
  assert.equal(badgeLayouts.pairedSourceBadgeAfterDsdOnlyProbe, "hi-res-dsd",
    "The synthetic type-2 probe must not falsify the record's combined badge classification.");
  assert.ok(badgeLayouts.markSizeConsistency.hiRes.difference.width <= 2 &&
    badgeLayouts.markSizeConsistency.hiRes.difference.height <= 2 &&
    badgeLayouts.markSizeConsistency.dsd.difference.width <= 2 &&
    badgeLayouts.markSizeConsistency.dsd.difference.height <= 2,
  "Each source SVG must retain the same rendered ink bounds in its single and paired modes (within 2px): " + JSON.stringify(badgeLayouts.markSizeConsistency));
  assert.ok(rhineAlbumInfo.webgl.animationDifference.changedPixels > 0,
    "The badge shader must visibly animate when motion is enabled.");
  assert.equal(rhineAlbumInfo.webgl.reducedDifference.changedPixels, 0,
    "Reduced motion must freeze badge pixels across frames.");
  assert.equal(rhineAlbumInfo.webgl.environmentDifference.changedPixels, 0,
    "Changing ambient, directional, and environment lighting must not alter isolated unlit badge pixels.");
  const punkAlbumInfo = await evaluate("window.caseCheck.capturePunkAlbumInfo()");
  for (const [name, data] of Object.entries(punkAlbumInfo.images))
    await writeFile(path.join(output, `${name}.png`), Buffer.from(data.slice("data:image/png;base64,".length), "base64"));
  delete punkAlbumInfo.images;
  await writeFile(path.join(output, "punk-album-info-audit.json"), JSON.stringify(punkAlbumInfo, null, 2));
  assert.deepEqual({
    width: punkAlbumInfo.labelCanvasAudit.width,
    height: punkAlbumInfo.labelCanvasAudit.height,
    numberText: punkAlbumInfo.labelCanvasAudit.numberText,
    pixelsPerDesignUnit: punkAlbumInfo.labelCanvasAudit.pixelsPerDesignUnit,
  }, { width: 1024, height: 607, numberText: "NO.010", pixelsPerDesignUnit: 1 });
  assert.equal(punkAlbumInfo.labelCanvasAudit.opaquePixels, 1024 * 607);
  assert.ok(punkAlbumInfo.labelCanvasAudit.darkInkPixels > 1000,
    "The Punk GLB label canvas must contain the complete paper label and dark RHINE LAB/INFO/number/mark ink.");
  assert.ok(punkAlbumInfo.unlitLabelCompare.pixelsCompared > 1000 && punkAlbumInfo.unlitLabelCompare.changedPixels === 0,
    "The actual Punk nameplate text and mark must remain pixel-identical under extreme lighting/environment changes.");
  assert.deepEqual(punkAlbumInfo.arrayAudit.numbers, ["NO.001", "NO.010"]);
  assert.deepEqual(punkAlbumInfo.arrayAudit.indices, [0, 9]);
  assert.equal(punkAlbumInfo.arrayAudit.badgesHidden, true, "The Punk label must not add Rhine source-format badges.");
  assert.deepEqual(punkAlbumInfo.arrayAudit.badgeTypes, [0, 0]);
  assert.deepEqual(punkAlbumInfo.snapshotAudit, {
    numberText: "NO.001", selectedNumberAfterChange: "NO.010", textureIndependent: true, stableAfterSelection: true,
  }, "A lifted Punk copy must preserve its own full label image and album number after selection changes.");
  assert.deepEqual(punkAlbumInfo.snapshotVisibilityAudit, {
    selectedMaterialHidden: true,
    selectedObjectVisible: true,
    snapshotMaterialHidden: true,
    snapshotObjectVisible: true,
    selectedMaterialRestored: true,
    selectedObjectRestored: true,
    snapshotMaterialRestored: true,
    snapshotObjectRestored: true,
    materialTypeUnchanged: true,
    materialColorUnchanged: true,
    materialRemainsUnlitBasic: true,
    depthWrite: true,
  }, "Hiding/showing the case label must propagate to selected and outgoing snapshots without replacing or tinting their unlit Basic material.");
  assert.equal(punkAlbumInfo.transformAudit.movedGeometry, true,
    "The Punk info plane must follow the editable label part offset/rotation/scale transform.");
  assert.equal(punkAlbumInfo.transformAudit.hidesSelectedAndArrayLabel, true,
    "Hiding the Punk label part must also hide its full selected and array info overlays.");
  const punkHighModel = fixture.models.find(model => model.structure === "punk" && model.detail === "high");
  assert.ok(punkHighModel, "The Punk high-detail model check must exist.");
  assert.equal(punkHighModel.triangleCount, punkReferenceTriangleCount,
    "Punk high detail must retain every triangle primitive in the reference GLB's active scene.");
  const thinWallOptics = fixture.punkGeometryAudit.thinWallOptics;
  assert.ok(thinWallOptics?.valid && thinWallOptics.intendedTransmission > 0.9 &&
    thinWallOptics.optics.materials.every(material => material.rawTransmission === 0 &&
      material.intendedTubeTransmission === thinWallOptics.intendedTransmission && material.transmissionMode === "thin-wall" &&
      material.transparent && !material.depthWrite && material.sideIsFront) &&
    thinWallOptics.opaqueSleeve.materials.every(material => material.rawTransmission === 0 &&
      material.intendedTubeTransmission === 0 && !material.transparent && material.depthWrite) &&
    thinWallOptics.opaqueAccentCore.materials.every(material => material.rawTransmission === 0 &&
      material.intendedTubeTransmission === 0 && !material.transparent && material.depthWrite),
  "Thin-wall Punk optics must retain its intended Fresnel transmission separately from volume transmission, while White sleeve and opaque core continue writing real depth: " + JSON.stringify(thinWallOptics));
  assert.ok(fixture.nativeOpticalEvidence.some(surface => surface.transmission > 0) && fixture.nativeOpticalEvidence.some(surface => surface.transmission === 0),
    "The Rhine source must retain distinct transmitting and opaque material samples.");
  assert.equal(fixture.rhineNativeRestore.restoredAllNativeParameters, true);
  assert.ok(fixture.transformChecks.positionDelta > 0.05 && fixture.transformChecks.normalDelta > 0.05);
  assert.ok(fixture.transformChecks.repeatedApplyDelta < 1e-6 && fixture.transformChecks.restorePositionDelta < 1e-6 && fixture.transformChecks.restoreNormalDelta < 1e-6);
  assert.ok(fixture.blueTangentChecks &&
    [fixture.blueTangentChecks.baseline, fixture.blueTangentChecks.transformed, fixture.blueTangentChecks.restored].every(health =>
      health.missingTangentMeshes === 0 && health.nonFiniteVertexCount === 0 && health.zeroTangentVertexCount === 0 &&
      health.invalidNormalVertexCount === 0 && health.maxAbsNormalizedNormalDot <= 1e-4),
  "Blue frame tangent fields must remain valid and orthogonal before, during, and after the XYZ transform.");
  assert.ok(fixture.blueTangentChecks.baselineAnisotropy.every(value => Math.abs(value - 0.12) < 1e-6) &&
    fixture.blueTangentChecks.transformedAnisotropy.every(value => Math.abs(value - 0.12) < 1e-6) &&
    fixture.blueTangentChecks.restoredAnisotropy.every(value => Math.abs(value - 0.12) < 1e-6) &&
    fixture.blueTangentChecks.repeatedApplyGeometryDelta < 1e-6 && fixture.blueTangentChecks.resetGeometryDelta < 1e-6,
  "Blue frame anisotropy must remain enabled and tangent/normal/position transforms must be idempotent and reversible.");
  const interactions = await evaluate(`(async () => {
    const host=document.querySelector('#editor-host');
    const root=host.querySelector('.case-editor');
    const click=selector=>{const node=root.querySelector(selector);if(!node)throw new Error('Missing editor control '+selector);node.click();};
    const setValue=(selector,value,eventName)=>{const node=root.querySelector(selector);if(!node)throw new Error('Missing editor field '+selector);node.value=String(value);node.dispatchEvent(new Event(eventName,{bubbles:true}));};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate())return true;await wait(50);}return false;};
    click('[data-structure="minimal"]');
    const minimalUnavailableParts=['accent','spine','optics'].every(part=>root.querySelector('[data-part="'+part+'"]').disabled);
    const minimalAvailableParts=['frame','cover','back'].every(part=>!root.querySelector('[data-part="'+part+'"]').disabled);
    click('[data-structure="punk"]');
    const visiblePunkPresetCount=[...root.querySelectorAll('[data-preset]')].filter(button=>!button.hidden).length;
    click('[data-part="frame"]');
    setValue('[data-part-preset]','marble','change');
    click('[data-action="apply-part-preset"]');
    const partSourceApplied=window.caseCheck.settings.appearances.punk.surfaces.frame.pattern==='marble'&&window.caseCheck.settings.appearances.punk.surfaces.frame.preserveSource===false;
    click('[data-preset="glass"]');
    click('[data-part="frame"]');
    setValue('[data-transform-value="offset"][data-axis="0"]',0.125,'change');
    const punkTransform=structuredClone(window.caseCheck.settings.appearances.punk.transforms.frame);
    const transformChangeSnapshot=window.caseCheck.changes.at(-1);
    click('[data-preset="marble"]');
    const wholePresetKeptTransforms=JSON.stringify(window.caseCheck.settings.appearances.punk.transforms.frame)===JSON.stringify(punkTransform);
    click('[data-preset="glass"]');
    click('[data-structure="rhine"]');
    click('[data-part="frame"]');
    const rhineOriginalMaterialSwitch=root.querySelector('[data-surface-field="preserveSource"]');
    const rhineOriginalMaterialMarked=rhineOriginalMaterialSwitch.checked&&root.querySelector('[data-surface-field="roughness"]').disabled;
    setValue('[data-transform-value="offset"][data-axis="0"]',0.375,'change');
    const rhineTransform=structuredClone(window.caseCheck.settings.appearances.rhine.transforms?.frame ?? null);
    click('[data-preset="coral"]');
    click('[data-structure="punk"]');
    const transformsIndependent=JSON.stringify(window.caseCheck.settings.appearances.punk.transforms.frame)===JSON.stringify(punkTransform)&&
      JSON.stringify(window.caseCheck.settings.appearances.rhine.transforms?.frame ?? null)===JSON.stringify(rhineTransform)&&
      rhineTransform===null&&punkTransform.offset[0]===0.125;
    const transformHistoryDeepCopied=transformChangeSnapshot.appearances.punk.transforms.frame.offset[0]===0.125;
    click('[data-preset="glass"]');
    click('[data-part="cover"]');
    setValue('[data-surface-field="transmission"]',0.63,'input');
    setValue('[data-surface-field="roughness"]',0.74,'input');
    setValue('[data-surface-field="finish"]','frost','change');
    setValue('[data-surface-field="color"]','#66aacc','input');
    const punkCustom=structuredClone(window.caseCheck.settings.appearances.punk);
    click('[data-structure="rhine"]');
    click('[data-preset="coral"]');
    const rhinePreset=window.caseCheck.settings.appearances.rhine.preset;
    click('[data-structure="punk"]');
    click('[data-part="cover"]');
    const coverFieldValues={
      finish:root.querySelector('[data-surface-field="finish"]').value,
      color:root.querySelector('[data-surface-field="color"]').value,
      roughness:Number(root.querySelector('[data-surface-field="roughness"]').value),
      transmission:Number(root.querySelector('[data-surface-field="transmission"]').value),
    };
    click('[data-part="frame"]');
    setValue('[data-surface-field="finish"]','metal','change');
    setValue('[data-surface-field="roughness"]',0.82,'input');
    setValue('[data-surface-field="color"]','#336699','input');
    const frameAfter=structuredClone(window.caseCheck.settings.appearances.punk.surfaces.frame);
    const callbacksBeforeCover=window.caseCheck.changes.length;

    // Resolve two overlapping GLB/model requests out of order; the last preview must win.
    const observationsBeforeRace=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').length;
    click('[data-structure="rhine"]');
    await wait(20);
    click('[data-structure="punk"]');
    window.caseCheck.editor.refresh();
    const previewResolved=await waitFor(()=>{const list=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover');return list.length>observationsBeforeRace&&list.at(-1)?.structure==='punk';});
    await wait(250);
    const presetRenderChecks=[];
    const renderPresetIds=['marble','hazard','white','glass','frost','red','blue','coral','tide','aurora'];
    for(const id of renderPresetIds){
      const observationCount=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').length;
      click('[data-preset="'+id+'"]');
      const expectedPattern=window.caseCheck.settings.appearances.punk.surfaces.frame.pattern;
      const rendered=await waitFor(()=>{
        const list=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover');
        const last=list.at(-1);
        return list.length>observationCount&&last?.structure==='punk'&&last.surfaces.some(surface=>surface.part==='frame'&&surface.pattern===expectedPattern);
      });
      const renderedPreset=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').at(-1);
      const frame=renderedPreset?.surfaces.find(surface=>surface.part==='frame');
      presetRenderChecks.push({id,expectedPattern,rendered,pattern:frame?.pattern??null,anisotropy:frame?.anisotropy??null,
        shaderKey:frame?.shaderKey??'',programCount:frame?.programCount??0});
    }
    const presetModelsReused=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').slice(-renderPresetIds.length).every(item=>item.structure==='punk');
    click('[data-preset="glass"]');
    click('[data-part="cover"]');
    setValue('[data-surface-field="transmission"]',0.63,'input');
    setValue('[data-surface-field="roughness"]',0.74,'input');
    setValue('[data-surface-field="finish"]','frost','change');
    setValue('[data-surface-field="color"]','#66aacc','input');
    click('[data-part="frame"]');
    setValue('[data-surface-field="finish"]','metal','change');
    setValue('[data-surface-field="roughness"]',0.82,'input');
    setValue('[data-surface-field="color"]','#336699','input');
    const activeBeforeCover=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').at(-1);
    const beforeMaterials=activeBeforeCover?.surfaces ?? [];
    const blueSvg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2455df"/></svg>');
    window.caseCheck.setCover(blueSvg);
    window.caseCheck.editor.refresh();
    const coverReloaded=await waitFor(()=>window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').at(-1)?.coverMap===blueSvg);
    const activeAfterCover=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').at(-1);
    const sameMaterials=JSON.stringify(beforeMaterials)===JSON.stringify(activeAfterCover?.surfaces ?? []);
    click('[data-view="front"]');
    window.caseCheck.setTheme('night');
    window.caseCheck.editor.refresh();
    await waitFor(()=>window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').at(-1)?.structure==='punk');
    const callbacksBeforeCoverToggle=window.caseCheck.changes.length;
    const showCover=root.querySelector('[data-field="show-cover"]');showCover.checked=false;showCover.dispatchEvent(new Event('input',{bubbles:true}));
    await waitFor(()=>window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover').at(-1)?.coverVisible===false);
    const coverTogglePreviewOnly=window.caseCheck.changes.length===callbacksBeforeCoverToggle&&showCover.checked===false;
    const finalPreviewError=root.querySelector('[data-preview-error]').hidden;
    const structurePressed=root.querySelector('[data-structure="punk"]').getAttribute('aria-pressed');
    const presetSaved=window.caseCheck.settings.appearances.rhine.preset;
    const expectedPunkRestoration={...punkCustom,preset:'custom',surfaces:{...punkCustom.surfaces,cover:{...punkCustom.surfaces.cover,finish:'frost',color:'#66AACC',roughness:0.74,transmission:0.63},frame:frameAfter}};
    const actualPunkRestoration=structuredClone(window.caseCheck.settings.appearances.punk);
    const surfaceDifferences=Object.keys(expectedPunkRestoration.surfaces).filter(part=>JSON.stringify(actualPunkRestoration.surfaces[part])!==JSON.stringify(expectedPunkRestoration.surfaces[part]));
    const punkRestorationAudit={actualPreset:actualPunkRestoration.preset,expectedPreset:expectedPunkRestoration.preset,
      topLevelDifferences:Object.keys(expectedPunkRestoration).filter(key=>JSON.stringify(actualPunkRestoration[key])!==JSON.stringify(expectedPunkRestoration[key])),
      surfaceDifferences, surfaceDetails:Object.fromEntries(surfaceDifferences.map(part=>[part,{actual:actualPunkRestoration.surfaces[part],expected:expectedPunkRestoration.surfaces[part]}])),
      transformDifferences:Object.keys({...expectedPunkRestoration.transforms,...actualPunkRestoration.transforms}).filter(part=>JSON.stringify(actualPunkRestoration.transforms?.[part])!==JSON.stringify(expectedPunkRestoration.transforms?.[part]))};
    const punkRestored=JSON.stringify(actualPunkRestoration)===JSON.stringify(expectedPunkRestoration);
    const changes=window.caseCheck.changes.length;
    const previewObservations=window.caseCheck.observations.filter(item=>item.coverMesh==='IndependentAlbumCover');
    return {callbacks:changes,callbacksBeforeCover,punkRestored,punkRestorationAudit,rhinePreset,presetSaved,coverFieldValues,frameAfter,previewResolved,coverReloaded,sameMaterials,finalPreviewError,structurePressed,observedStructures:previewObservations.map(item=>item.structure),previewDetail:previewObservations.at(-1)?.modelDetail,minimalUnavailableParts,minimalAvailableParts,visiblePunkPresetCount,partSourceApplied,punkTransform,rhineTransform,transformsIndependent,wholePresetKeptTransforms,transformHistoryDeepCopied,rhineOriginalMaterialMarked,coverTogglePreviewOnly,coverVisible:showCover.checked,presetRenderChecks,presetModelsReused,editorRendererCreations:window.caseCheck.editorRendererCreations};
  })()`);

  assert.ok(interactions.callbacks > 8, "Preset, part, finish, sliders and enabled switch must persist through onChange.");
  assert.ok(interactions.minimalUnavailableParts && interactions.minimalAvailableParts, "Minimal must keep only frame/cover/back active and disable accent and extensions.");
  assert.equal(interactions.visiblePunkPresetCount, 10, "Punk preset chooser must show exactly ten skins.");
  assert.equal(interactions.partSourceApplied, true, "A part must accept material data from another preset.");
  assert.equal(interactions.wholePresetKeptTransforms, true, "Applying a whole preset must retain independent part transforms.");
  assert.equal(interactions.transformsIndependent, true, "Structure switching must save each structure's transforms independently.");
  assert.equal(interactions.transformHistoryDeepCopied, true, "Saved onChange snapshots must not be mutated by later structure edits.");
  assert.equal(interactions.rhineOriginalMaterialMarked, true, "Rhine original appearance must mark and lock native material controls.");
  assert.ok(interactions.punkRestored, "Switching structures must restore the customized Punk appearance: " + JSON.stringify(interactions.punkRestorationAudit));
  assert.equal(interactions.rhinePreset, "original", "Rhine must reject Punk finish presets and hidden generic transform edits.");
  assert.equal(interactions.presetSaved, "original");
  assert.deepEqual(interactions.coverFieldValues, { finish: "frost", color: "#66aacc", roughness: 0.74, transmission: 0.63 });
  assert.equal(interactions.frameAfter.finish, "metal");
  assert.equal(interactions.frameAfter.color, "#336699");
  assert.ok(interactions.previewResolved, "The latest asynchronous structure must render after refresh.");
  assert.ok(interactions.coverReloaded, "The independent cover texture must refresh from the local data URL.");
  assert.ok(interactions.sameMaterials, "Changing only the artwork must leave every case material unchanged.");
  assert.equal(interactions.coverTogglePreviewOnly, true, "The preview cover switch must not change saved player settings.");
  assert.equal(interactions.coverVisible, false, "The final high-detail preview should leave the album art hidden for shell inspection.");
  assert.equal(interactions.previewDetail, 2, "The editor shell screenshots must use the high-detail Rhine/Punk preview model.");
  const expectedFramePatterns = { marble: "marble", hazard: "carbon", white: "none", glass: "none", frost: "none", red: "none", blue: "brushed", coral: "none", tide: "gradient", aurora: "gradient" };
  assert.deepEqual(interactions.presetRenderChecks.map(check => check.id), Object.keys(expectedFramePatterns));
  assert.ok(interactions.presetRenderChecks.every(check => check.rendered && check.pattern === expectedFramePatterns[check.id] &&
    check.programCount > 0 && /case-(?:optics-v[45]-)?pattern/iu.test(check.shaderKey)),
  "Every Punk skin must drive a compiled pattern-capable material in the same live WebGL preview: " + JSON.stringify(interactions.presetRenderChecks));
  const blueAnisotropy = interactions.presetRenderChecks.find(check => check.id === "blue")?.anisotropy;
  assert.ok(typeof blueAnisotropy === "number" && blueAnisotropy > 0 && blueAnisotropy <= 1,
    "The blue brushed-metal preset must enable a supported nonzero anisotropy value.");
  assert.equal(interactions.editorRendererCreations, 1, "All ten preset renders must reuse one editor WebGL renderer/context.");
  assert.equal(interactions.presetModelsReused, true, "All ten material presets must render on the same Punk model instance.");
  assert.equal(interactions.finalPreviewError, true, "The editor must not report a preview error.");
  assert.equal(interactions.structurePressed, "true");
  assert.ok(interactions.observedStructures.includes("rhine") && interactions.observedStructures.at(-1) === "punk");

  const editorBasicCard = await evaluate(`(async () => {
    const root=document.querySelector('#editor-host .case-editor');
    const show=root.querySelector('[data-field="show-cover"]');
    show.checked=true;show.dispatchEvent(new Event('input',{bubbles:true}));
    window.caseCheck.setEditorLighting('basic');
    window.caseCheck.editor.refresh();
    for(let i=0;i<100;i++){
      const item=window.caseCheck.editorInsertObservations.filter(value=>value.structure==='punk'&&value.lighting==='basic'&&value.visible).at(-1);
      if(item?.lambert&&item.materialType==='MeshLambertMaterial'&&item.emissive==='000000'&&item.opacity===1&&
         !item.transparent&&item.depthWrite&&item.colorWrite&&item.castsShadow&&item.receivesShadow&&item.printReceivesShadow&&item.thickness>0)
        return {rendered:true,item};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return {rendered:false,item:window.caseCheck.editorInsertObservations.at(-1)};
  })()`);
  assert.equal(editorBasicCard.rendered, true,
    "The actual Punk Basic-light editor render must contain a non-emissive opaque Lambert paper card that writes depth, casts/receives shadows, and lets the front print receive the card shadow: " + JSON.stringify(editorBasicCard));
  assert.ok(editorBasicCard.item.albumOcclusionMeshCount > 0 && editorBasicCard.item.albumOcclusionFlags.length === 1 &&
    editorBasicCard.item.albumOcclusionFlags[0] === true,
  "A visible editor insert must activate the real Punk shell's album-occlusion metadata/uniform.");
  const editorBasicRect = await evaluate("(() => { const r=document.querySelector('#editor-host [data-preview-stage]').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
  const editorBasicShot = await command("Page.captureScreenshot", { format: "png", clip: { ...editorBasicRect, scale: 1 } });
  await writeFile(path.join(output, "punk-editor-basic-paper-card.png"), Buffer.from(editorBasicShot.data, "base64"));
  const editorHiddenAfterPaper = await evaluate(`(async () => {
    const root=document.querySelector('#editor-host .case-editor');
    const show=root.querySelector('[data-field="show-cover"]');
    show.checked=false;show.dispatchEvent(new Event('input',{bubbles:true}));
    window.caseCheck.setEditorLighting('high');
    window.caseCheck.editor.refresh();
    for(let i=0;i<100;i++){
      const item=window.caseCheck.editorInsertObservations.filter(value=>value.structure==='punk'&&value.lighting==='high'&&!value.visible).at(-1);
      if(item&&item.albumOcclusionMeshCount>0&&item.albumOcclusionFlags.length===1&&item.albumOcclusionFlags[0]===false)return {rendered:true,item};
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return {rendered:false,item:window.caseCheck.editorInsertObservations.at(-1)};
  })()`);
  assert.equal(editorHiddenAfterPaper.rendered, true,
    "Hiding the editor album art must turn the actual shell's album-occlusion state off: " + JSON.stringify(editorHiddenAfterPaper));
  const editorOcclusionLifecycle = await evaluate(`(async () => {
    const root=document.querySelector('#editor-host .case-editor');
    const show=root.querySelector('[data-field="show-cover"]');
    const waitFor=async predicate=>{for(let i=0;i<100;i++){const item=window.caseCheck.editorInsertObservations.filter(value=>value.structure==='punk'&&value.lighting==='high').at(-1);if(item&&predicate(item))return item;await new Promise(resolve=>setTimeout(resolve,50));}return null;};
    show.checked=true;show.dispatchEvent(new Event('input',{bubbles:true}));window.caseCheck.editor.refresh();
    const visible=await waitFor(item=>item.visible&&item.albumOcclusionMeshCount>0&&item.albumOcclusionFlags.length===1&&item.albumOcclusionFlags[0]===true);
    show.checked=false;show.dispatchEvent(new Event('input',{bubbles:true}));window.caseCheck.editor.refresh();
    const hidden=await waitFor(item=>!item.visible&&item.albumOcclusionMeshCount>0&&item.albumOcclusionFlags.length===1&&item.albumOcclusionFlags[0]===false);
    return {visible,hidden,finalShowCover:show.checked};
  })()`);
  assert.ok(editorOcclusionLifecycle.visible && editorOcclusionLifecycle.hidden && editorOcclusionLifecycle.finalShowCover === false,
    "Editor show-cover must propagate metadata/uniform true when reopened and false when hidden again: " + JSON.stringify(editorOcclusionLifecycle));

  const editorRect = await evaluate("(() => { const r=document.querySelector('#editor-host').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,1050)}; })()");
  const editorShot = await command("Page.captureScreenshot", { format: "png", clip: { ...editorRect, scale: 1 } });
  await writeFile(path.join(output, "case-editor-final.png"), Buffer.from(editorShot.data, "base64"));
  const previewRect = await evaluate("(() => { const r=document.querySelector('#editor-host [data-preview-stage]').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
  const frontShellShot = await command("Page.captureScreenshot", { format: "png", clip: { ...previewRect, scale: 1 } });
  await writeFile(path.join(output, "punk-front-cover-hidden.png"), Buffer.from(frontShellShot.data, "base64"));
  const obliqueView = await evaluate("(() => { const root=document.querySelector('#editor-host .case-editor');root.querySelector('[data-view=display]').click();window.caseCheck.editor.refresh();return root.querySelector('[data-field=show-cover]').checked===false;})()");
  assert.equal(obliqueView, true, "The oblique shell capture must keep the preview-only album art hidden.");
  await new Promise(resolve => setTimeout(resolve, 120));
  const obliqueShellShot = await command("Page.captureScreenshot", { format: "png", clip: { ...previewRect, scale: 1 } });
  await writeFile(path.join(output, "punk-oblique-cover-hidden.png"), Buffer.from(obliqueShellShot.data, "base64"));
  const rhinePreviewReady = await evaluate(`(async () => {
    const root=document.querySelector('#editor-host .case-editor');
    const before=window.caseCheck.observations.length;
    window.caseCheck.setTheme('day');
    root.querySelector('[data-structure=rhine]').click();
    root.querySelector('[data-preset=original]').click();
    root.querySelector('[data-view=display]').click();
    window.caseCheck.editor.refresh();
    for(let i=0;i<100;i++) {
      const last=window.caseCheck.observations.at(-1);
      if(window.caseCheck.observations.length>before && last?.structure==='rhine' && last.modelDetail===2 && last.coverVisible===false) return true;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return false;
  })()`);
  assert.equal(rhinePreviewReady, true, "Rhine full source materials must render with the preview cover hidden.");
  const rhineShellShot = await command("Page.captureScreenshot", { format: "png", clip: { ...previewRect, scale: 1 } });
  await writeFile(path.join(output, "rhine-oblique-cover-hidden.png"), Buffer.from(rhineShellShot.data, "base64"));
  const personalUi = await evaluate(`(() => {
    const root = document.querySelector('#editor-host .case-editor');
    const click = selector => root.querySelector(selector).click();
    const input = (selector, value, event = 'input') => {
      const node = root.querySelector(selector); node.value = value; node.dispatchEvent(new Event(event, { bubbles: true }));
    };
    const name = root.querySelector('[data-user-preset-name]');
    const groupOrder = () => [...root.querySelector('.case-editor__controls').children].map(node =>
      node.getAttribute('aria-labelledby') || (node.hasAttribute('data-punk-material-section') ? 'punk-material' : 'unknown'));
    const visualStyle = () => {
      const rootStyle = getComputedStyle(root);
      const material = root.querySelector('[data-punk-material-section]');
      const selected = root.querySelector('[data-structure=punk]');
      return { design: root.dataset.design, radius: getComputedStyle(material).borderRadius,
        ink: rootStyle.color, panel: getComputedStyle(material).backgroundColor,
        accent: rootStyle.getPropertyValue('--ce-accent').trim(), font: rootStyle.fontFamily,
        inheritedFont: getComputedStyle(document.body).fontFamily };
    };
    const checks = [];
    for (const structure of ['minimal', 'rhine']) {
      click('[data-structure=' + structure + ']');
      const before = window.caseCheck.changes.length;
      input('[data-surface-field=color]', '#ff0000');
      input('[data-surface-field=finish]', 'metal', 'change');
      input('[data-transform-value=offset][data-axis="0"]', '4.5', 'change');
      checks.push({ structure, commonVisible: !root.querySelector('[aria-labelledby=case-part-heading]').hidden,
        opticsVisible: !root.querySelector('[data-rhine-optics-section]').hidden,
        resetVisible: !root.querySelector('[data-action=reset]').hidden,
        materialHidden: root.querySelector('[data-punk-material-section]').hidden,
        personalHidden: root.querySelector('[data-user-preset-section]').hidden,
        blocked: window.caseCheck.changes.length === before });
    }
    input('[data-rhine-optics-part]', 'cover', 'change');
    const originalRhine = JSON.stringify(window.caseCheck.settings.appearances.rhine.surfaces.cover);
    input('[data-rhine-optics=transmission]', '0.37');
    input('[data-rhine-optics=transparency]', '0.6');
    const opticalSurface = window.caseCheck.settings.appearances.rhine.surfaces.cover;
    const opticalSaved = opticalSurface.transmissionOverride === .37 && Math.abs(opticalSurface.opacityOverride - .4) < 1e-6 && opticalSurface.preserveSource;
    window.caseCheck.editor.refresh();
    const opticalReloaded = root.querySelector('[data-rhine-optics=transmission]').value === '0.37' && root.querySelector('[data-rhine-optics=transparency]').value === '0.6';
    click('[data-action=reset]');
    const opticsReset = JSON.stringify(window.caseCheck.settings.appearances.rhine.surfaces.cover) === originalRhine;
    click('[data-structure=punk]');
    const punkCommonRemoved = root.querySelector('[aria-labelledby=case-part-heading]').hidden &&
      root.querySelector('[data-transform-editor]').closest('[data-punk-material-section]') !== null &&
      root.querySelector('[data-rhine-optics-section]').hidden;
    input('[data-finish-part]', 'cover', 'change');
    const finishPartSelection = root.querySelector('[data-finish-part]').value === 'cover';
    input('[data-finish-part]', 'frame', 'change');
    const colorCode = root.querySelector('[data-color-code=color]');
    const colorPicker = root.querySelector('[data-surface-field=color]');
    const beforeHexInput = window.caseCheck.settings.appearances.punk.surfaces.frame.color;
    const changesBeforeHexTyping = window.caseCheck.changes.length;
    input('[data-color-code=color]', ' 2468ac ');
    const hexTypingDidNotCommit = window.caseCheck.settings.appearances.punk.surfaces.frame.color === beforeHexInput &&
      window.caseCheck.changes.length === changesBeforeHexTyping;
    input('[data-color-code=color]', ' 2468ac ', 'change');
    const hexChangeCommitted = window.caseCheck.settings.appearances.punk.surfaces.frame.color === '#2468AC';
    const pickerSyncedFromHex = colorPicker.value.toUpperCase() === '#2468AC';
    const changesBeforeInvalidHex = window.caseCheck.changes.length;
    input('[data-color-code=color]', '#12GG34');
    input('[data-color-code=color]', '#12GG34', 'change');
    const invalidHexRejected = colorCode.getAttribute('aria-invalid') === 'true' &&
      !root.querySelector('[data-color-code-error=color]').hidden &&
      window.caseCheck.settings.appearances.punk.surfaces.frame.color === '#2468AC' &&
      window.caseCheck.changes.length === changesBeforeInvalidHex;
    colorCode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const escapeRestoredHex = colorCode.value === '#2468AC' && !colorCode.hasAttribute('aria-invalid') &&
      root.querySelector('[data-color-code-error=color]').hidden;
    input('[data-color-code=color]', '#abc');
    colorCode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const hexEnterCommitted = window.caseCheck.settings.appearances.punk.surfaces.frame.color === '#AABBCC' &&
      colorPicker.value.toUpperCase() === '#AABBCC';
    input('[data-color-code=color]', '2468ac', 'change');
    const secondaryHex = root.querySelector('[data-color-code=secondaryColor]');
    const secondaryPicker = root.querySelector('[data-surface-field=secondaryColor]');
    const secondaryBefore = window.caseCheck.settings.appearances.punk.surfaces.frame.secondaryColor;
    input('[data-color-code=secondaryColor]', '#0f8', 'change');
    const secondaryHexCommitted = window.caseCheck.settings.appearances.punk.surfaces.frame.secondaryColor === '#00FF88' &&
      secondaryPicker.value.toUpperCase() === '#00FF88';
    input('[data-color-code=secondaryColor]', secondaryBefore, 'change');
    const hexAudit = { hexTypingDidNotCommit, hexChangeCommitted, pickerSyncedFromHex, invalidHexRejected, escapeRestoredHex,
      hexEnterCommitted, secondaryHexCommitted, secondaryCodeFieldPresent: !!secondaryHex };
    input('[data-transform-value=offset][data-axis="0"]', '0.625', 'change');
    const beforeEmpty = window.caseCheck.userPresetChanges;
    click('[data-action=save-user-preset]');
    const emptyRejected = beforeEmpty === window.caseCheck.userPresetChanges;
    name.value = 'Warm test'; name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const first = window.caseCheck.userPresets[0];
    const savedColour = first.appearance.surfaces.frame.color;
    const savedOffset = first.appearance.transforms.frame.offset[0];
    const beforeDuplicate = window.caseCheck.userPresetChanges;
    name.value = ' warm TEST '; click('[data-action=save-user-preset]');
    const duplicateRejected = beforeDuplicate === window.caseCheck.userPresetChanges;
    input('[data-surface-field=color]', '#ff1122');
    input('[data-transform-value=offset][data-axis="0"]', '1.25', 'change');
    const detached = window.caseCheck.userPresets[0].appearance.surfaces.frame.color === savedColour && window.caseCheck.userPresets[0].appearance.transforms.frame.offset[0] === savedOffset;
    click('[data-user-preset="' + first.id + '"]');
    const applied = window.caseCheck.settings.appearances.punk.surfaces.frame.color === savedColour && window.caseCheck.settings.appearances.punk.transforms.frame.offset[0] === savedOffset;
    window.caseCheck.reloadUserPresets();
    const reloadKept = window.caseCheck.userPresets.length === 1 && root.querySelector('[data-user-preset="' + first.id + '"]').getAttribute('aria-pressed') === 'true';
    const unsafeName = '<img src=x onerror=alert(1)>';
    name.value = unsafeName; click('[data-action=save-user-preset]');
    const escapedName = !root.querySelector('[data-user-presets] img') && root.querySelector('[data-user-presets]').textContent.includes(unsafeName);
    const futurePresetsBeforeArchive = JSON.stringify(window.caseCheck.userPresets);
    const futureAppearanceBeforeArchive = JSON.stringify(window.caseCheck.settings.appearances.punk);
    const futureEnabledBeforeArchive = window.caseCheck.settings.enabled;
    const futureGroupOrder = groupOrder();
    const futureStyle = visualStyle();
    window.caseCheck.setEditorDesign('archive');
    const archiveGroupOrder = groupOrder();
    const archiveStyle = visualStyle();
    const archiveGroupsVisible = root.dataset.design === 'archive' && root.querySelector('[data-field=enabled]') === null &&
      !root.querySelector('[data-preset-section]').hidden && !root.querySelector('[data-punk-material-section]').hidden &&
      !root.querySelector('[data-user-preset-section]').hidden && root.querySelector('[aria-labelledby=case-part-heading]').hidden &&
      root.querySelector('[data-rhine-optics-section]').hidden && root.querySelector('[data-finish-part]').closest('[data-punk-material-section]') !== null &&
      root.querySelector('[data-transform-editor]').closest('[data-punk-material-section]') !== null;
    const beforeArchiveEmpty = window.caseCheck.userPresetChanges;
    name.value = '';
    click('[data-action=save-user-preset]');
    const archiveEmptyRejected = beforeArchiveEmpty === window.caseCheck.userPresetChanges;
    input('[data-finish-part]', 'frame', 'change');
    input('[data-color-code=color]', ' 2468ac ', 'change');
    input('[data-transform-value=offset][data-axis="0"]', '0.75', 'change');
    name.value = 'Archive Brass'; click('[data-action=save-user-preset]');
    const archiveFirst = window.caseCheck.userPresets[0];
    const archiveSavedColour = archiveFirst?.appearance.surfaces.frame.color;
    const archiveSavedOffset = archiveFirst?.appearance.transforms.frame.offset[0];
    const archiveSaved = archiveFirst?.name === 'Archive Brass' && archiveSavedColour?.toLowerCase() === '#2468ac' && archiveSavedOffset === .75;
    const beforeArchiveDuplicate = window.caseCheck.userPresetChanges;
    name.value = ' archive BRASS '; click('[data-action=save-user-preset]');
    const archiveDuplicateRejected = beforeArchiveDuplicate === window.caseCheck.userPresetChanges;
    input('[data-surface-field=color]', '#cb4567');
    input('[data-transform-value=offset][data-axis="0"]', '1.5', 'change');
    const archiveDetached = window.caseCheck.userPresets[0].appearance.surfaces.frame.color === archiveSavedColour &&
      window.caseCheck.userPresets[0].appearance.transforms.frame.offset[0] === archiveSavedOffset;
    click('[data-user-preset="' + archiveFirst.id + '"]');
    const archiveApplied = window.caseCheck.settings.appearances.punk.surfaces.frame.color === archiveSavedColour &&
      window.caseCheck.settings.appearances.punk.transforms.frame.offset[0] === archiveSavedOffset;
    window.caseCheck.reloadUserPresets();
    const archiveReloadKept = window.caseCheck.userPresets.length === 1 &&
      root.querySelector('[data-user-preset="' + archiveFirst.id + '"]').getAttribute('aria-pressed') === 'true';
    const bothLibrariesRoundTrip = JSON.stringify(window.caseCheck.userPresetLibraries.futurePunkPresets) === futurePresetsBeforeArchive &&
      window.caseCheck.userPresetLibraries.archivePunkPresets.length === 1 &&
      window.caseCheck.userPresetLibraries.archivePunkPresets[0].id === archiveFirst.id;
    name.value = 'Archive Spare'; click('[data-action=save-user-preset]');
    const archiveBeforeDelete = JSON.stringify(window.caseCheck.settings.appearances.punk);
    click('[data-delete-user-preset="' + archiveFirst.id + '"]');
    const archiveNoEarlyDelete = window.caseCheck.userPresets.length === 2;
    click('[data-action=cancel-delete-preset]');
    click('[data-delete-user-preset="' + archiveFirst.id + '"]'); click('[data-action=confirm-delete-preset]');
    const archiveDeletedSafely = window.caseCheck.userPresets.length === 1 &&
      JSON.stringify(window.caseCheck.settings.appearances.punk) === archiveBeforeDelete;
    window.caseCheck.reloadUserPresets();
    const archiveDeleteReloaded = window.caseCheck.userPresets.length === 1 && window.caseCheck.userPresets[0].name === 'Archive Spare';
    const archiveEnabledSaved = window.caseCheck.settings.enabled === true && root.querySelector('[data-field=enabled]') === null;
    window.caseCheck.setEditorDesign('rhine');
    const futureRetained = JSON.stringify(window.caseCheck.userPresets) === futurePresetsBeforeArchive &&
      JSON.stringify(window.caseCheck.settings.appearances.punk) === futureAppearanceBeforeArchive;
    const futureEnabledRetained = window.caseCheck.settings.enabled === futureEnabledBeforeArchive;
    window.caseCheck.setEditorDesign('archive');
    const archiveRetained = window.caseCheck.userPresets.length === 1 && window.caseCheck.userPresets[0].name === 'Archive Spare' &&
      window.caseCheck.settings.enabled === true && JSON.stringify(window.caseCheck.settings.appearances.punk) === archiveBeforeDelete;
    window.caseCheck.setEditorDesign('rhine');
    const currentBeforeDelete = JSON.stringify(window.caseCheck.settings.appearances.punk);
    click('[data-delete-user-preset="' + first.id + '"]');
    const noEarlyDelete = window.caseCheck.userPresets.length === 2;
    click('[data-action=cancel-delete-preset]');
    click('[data-delete-user-preset="' + first.id + '"]'); click('[data-action=confirm-delete-preset]');
    const deletedSafely = window.caseCheck.userPresets.length === 1 && JSON.stringify(window.caseCheck.settings.appearances.punk) === currentBeforeDelete;
    click('[data-structure=rhine]');
    return { checks, opticalSaved, opticalReloaded, opticsReset, punkCommonRemoved, finishPartSelection, emptyRejected, duplicateRejected, detached, applied, reloadKept, escapedName, hexAudit,
      archiveEmptyRejected, archiveGroupsVisible, archiveSaved, archiveDuplicateRejected, archiveDetached, archiveApplied, archiveReloadKept, bothLibrariesRoundTrip,
      archiveNoEarlyDelete, archiveDeletedSafely, archiveDeleteReloaded, archiveEnabledSaved, archiveRetained, futureRetained, futureEnabledRetained,
      futureGroupOrder, archiveGroupOrder, futureStyle, archiveStyle, noEarlyDelete, deletedSafely };
  })()`);
  assert.ok(personalUi.checks.every(check => !check.commonVisible && check.opticsVisible === (check.structure === "rhine") &&
    check.resetVisible === (check.structure === "rhine") && check.materialHidden && check.personalHidden && check.blocked),
    "Simple must have no editing controls; Detailed exposes only its optical section: " + JSON.stringify(personalUi));
  for (const [key, passed] of Object.entries(personalUi))
    if (key !== "checks" && key !== "hexAudit" && !["futureStyle", "archiveStyle", "futureGroupOrder", "archiveGroupOrder"].includes(key))
      assert.equal(passed, true, "Personal preset UI: " + key + " " + JSON.stringify(personalUi));
  assert.deepEqual(personalUi.hexAudit, {
    hexTypingDidNotCommit: true,
    hexChangeCommitted: true,
    pickerSyncedFromHex: true,
    invalidHexRejected: true,
    escapeRestoredHex: true,
    hexEnterCommitted: true,
    secondaryHexCommitted: true,
    secondaryCodeFieldPresent: true,
  }, "Direct HEX color input must normalize valid short/unprefixed codes, sync both pickers, reject invalid values, and support Enter/Escape.");
  assert.equal(personalUi.archiveStyle.design, "archive");
  assert.equal(personalUi.archiveStyle.radius, "3px", "Archive must keep its compact Punk corner radius.");
  assert.equal(personalUi.futureStyle.radius, "13px", "Future must keep its own corner radius.");
  assert.notEqual(personalUi.archiveStyle.ink, personalUi.futureStyle.ink, "Archive palette must remain distinct from Future.");
  assert.notEqual(personalUi.archiveStyle.panel, personalUi.futureStyle.panel, "Archive panel palette must remain distinct from Future.");
  assert.ok(/#edb64d|rgb\s*\(\s*237\s*,\s*182\s*,\s*77\s*\)/iu.test(personalUi.archiveStyle.accent),
    "Archive must retain its Punk gold accent token: " + personalUi.archiveStyle.accent);
  assert.notEqual(personalUi.archiveStyle.accent, personalUi.futureStyle.accent, "The Future accent token must remain independent.");
  assert.equal(personalUi.archiveStyle.font, personalUi.futureStyle.font, "The shared editor layout must continue to inherit the surrounding font in both themes.");
  assert.equal(personalUi.archiveStyle.font, personalUi.archiveStyle.inheritedFont);
  assert.deepEqual(personalUi.archiveGroupOrder, personalUi.futureGroupOrder,
    "Future and Archive must share the same Punk editor group order.");

  await command("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const archiveScreenshotReady = await evaluate(`(async () => {
    const host = document.querySelector('#editor-host'); host.style.width = 'calc(100vw - 48px)';
    const root = document.querySelector('#editor-host .case-editor');
    window.caseCheck.setEditorDesign('archive');
    root.querySelector('[data-action=reset]').click();
    const showCover = root.querySelector('[data-field=show-cover]');
    showCover.checked = true; showCover.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-view=display]').click();
    root.querySelectorAll('details').forEach(details => { details.open = false; });
    host.scrollIntoView({ block: 'start' }); window.scrollTo(0, 0);
    if (document.fonts?.ready) await document.fonts.ready;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await nextFrame(); await nextFrame();
    window.caseCheck.editor.refresh();
    await nextFrame(); await nextFrame();
    window.scrollTo(0, 0);
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    return { design: root.dataset.design, width: host.getBoundingClientRect().width, scrollY: window.scrollY,
      enabledSwitchAbsent: !root.querySelector('[data-enabled-row]') && !root.querySelector('[data-field=enabled]'),
      archiveCaseEnabled: window.caseCheck.settings.enabled,
      presetVisible: !root.querySelector('[data-preset-section]').hidden,
      materialVisible: !root.querySelector('[data-punk-material-section]').hidden,
      personalVisible: !root.querySelector('[data-user-preset-section]').hidden,
      selectedPunk: root.querySelector('[data-structure=punk]').getAttribute('aria-pressed'),
      headerRect: rect(root.querySelector('.case-editor__heading')),
      structureRect: rect(root.querySelector('[aria-labelledby=case-structure-heading]')),
      presetRect: rect(root.querySelector('[data-preset-section]')),
      materialRect: rect(root.querySelector('[data-punk-material-section]')),
      previewRect: rect(root.querySelector('.case-editor__preview-panel')),
      fontsStatus: document.fonts?.status ?? 'unavailable' };
  })()`);
  assert.equal(archiveScreenshotReady.design, "archive");
  assert.ok(archiveScreenshotReady.width >= 1850 && archiveScreenshotReady.scrollY === 0 && archiveScreenshotReady.enabledSwitchAbsent && archiveScreenshotReady.archiveCaseEnabled &&
    archiveScreenshotReady.presetVisible && archiveScreenshotReady.materialVisible && archiveScreenshotReady.personalVisible &&
    archiveScreenshotReady.selectedPunk === "true" && archiveScreenshotReady.headerRect.y >= 0 &&
    archiveScreenshotReady.presetRect.y >= 0 && archiveScreenshotReady.presetRect.bottom <= 1080 &&
    archiveScreenshotReady.materialRect.y < 1080 && archiveScreenshotReady.materialRect.height > 0 &&
    archiveScreenshotReady.previewRect.y < 1080 && archiveScreenshotReady.previewRect.bottom > 0,
  "The Archive Punk controls and preview must occupy the 1920px top viewport before capture: " + JSON.stringify(archiveScreenshotReady));
  await new Promise(resolve => setTimeout(resolve, 250));
  const archiveEditorTopShot = await command("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
  await writeFile(path.join(output, "archive-punk-editor-1920-top.png"), Buffer.from(archiveEditorTopShot.data, "base64"));
  const archivePersonalCapture = await evaluate(`(() => {
    const personal = document.querySelector('#editor-host [data-user-preset-section]');
    personal.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const r = personal.getBoundingClientRect();
    const preview = document.querySelector('#editor-host .case-editor__preview-panel').getBoundingClientRect();
    return { scrollY: window.scrollY, personalTop: r.top, personalBottom: r.bottom, viewportHeight: window.innerHeight,
      previewTop: preview.top, previewBottom: preview.bottom };
  })()`);
  assert.ok(archivePersonalCapture.personalTop >= 0 && archivePersonalCapture.personalBottom <= archivePersonalCapture.viewportHeight &&
    archivePersonalCapture.previewTop < archivePersonalCapture.viewportHeight && archivePersonalCapture.previewBottom > 0,
  "The 1920px personal-preset capture must show both the whole preset section and the live preview in the actual viewport: " + JSON.stringify(archivePersonalCapture));
  await new Promise(resolve => setTimeout(resolve, 150));
  const archiveEditorPersonalShot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(output, "archive-punk-editor-1920-personal.png"), Buffer.from(archiveEditorPersonalShot.data, "base64"));
  await evaluate("window.scrollTo(0,0);document.querySelector('#editor-host').style.width='';window.caseCheck.setEditorDesign('rhine')");
  await command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1500, deviceScaleFactor: 1, mobile: false });

  const themeRestriction = await evaluate(`(() => {
    const root = document.querySelector('#editor-host .case-editor');
    const visible = () => [...root.querySelectorAll('[data-structure]')].filter(node => !node.hidden).map(node => ({ id: node.dataset.structure, label: node.querySelector('strong').textContent }));
    const futureChoices = visible();
    const presetAvailability = [];
    for (const structure of ['minimal', 'rhine', 'punk']) {
      root.querySelector('[data-structure=' + structure + ']').click();
      const before = window.caseCheck.changes.length;
      if (structure !== 'punk') {
        root.querySelector('[data-preset=coral]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        root.querySelector('[data-action=apply-part-preset]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      presetAvailability.push({ structure, sectionVisible: !root.querySelector('[data-preset-section]').hidden,
        partSourceVisible: !root.querySelector('.case-editor__part-source').hidden,
        blockedCallbacks: window.caseCheck.changes.length - before });
    }
    root.querySelector('[data-structure=rhine]').click();
    const futureSettings = structuredClone(window.caseCheck.settings);
    window.caseCheck.setEditorDesign('archive');
    const punkChoices = visible();
    const before = window.caseCheck.changes.length;
    root.querySelector('[data-structure=minimal]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root.querySelector('[data-structure=rhine]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const blockedCallbacks = window.caseCheck.changes.length - before;
    const selected = root.querySelector('[data-structure=punk]').getAttribute('aria-pressed');
    const archiveEnabledSwitchAbsent = !root.querySelector('[data-enabled-row]') && !root.querySelector('[data-field=enabled]');
    window.caseCheck.setEditorDesign('rhine');
    return { futureChoices, presetAvailability, punkChoices, blockedCallbacks, selected, archiveEnabledSwitchAbsent,
      futureSettingsRetained: JSON.stringify(window.caseCheck.settings) === JSON.stringify(futureSettings),
      futureEnabledSwitchAbsent: !root.querySelector('[data-enabled-row]') && !root.querySelector('[data-field=enabled]') };
  })()`);
  assert.deepEqual(themeRestriction.presetAvailability, [
    { structure: "minimal", sectionVisible: false, partSourceVisible: false, blockedCallbacks: 0 },
    { structure: "rhine", sectionVisible: false, partSourceVisible: false, blockedCallbacks: 0 },
    { structure: "punk", sectionVisible: true, partSourceVisible: true, blockedCallbacks: 0 },
  ], "Finish presets and part preset sources must exist only for Punk cases, including synthetic-event rejection.");
  assert.deepEqual(themeRestriction.futureChoices, [
    { id: "minimal", label: "简单粗糙" }, { id: "rhine", label: "精细" }, { id: "punk", label: "Punk拓展" },
  ]);
  assert.deepEqual(themeRestriction.punkChoices, [{ id: "punk", label: "Punk盒体" }]);
  assert.equal(themeRestriction.blockedCallbacks, 0, "Hidden structure controls must reject synthetic clicks in Punk.");
  assert.equal(themeRestriction.selected, "true");
  assert.equal(themeRestriction.archiveEnabledSwitchAbsent && themeRestriction.futureEnabledSwitchAbsent && themeRestriction.futureSettingsRetained, true,
    "Archive case mode is always editable, without an enable switch, and theme refresh must keep the Future profile independent.");
  const destroyed = await evaluate(`(() => {const host=document.querySelector('#editor-host');const before=window.caseCheck.changes.length;window.caseCheck.editor.destroy();window.caseCheck.editor.refresh();return {children:host.childElementCount,canvases:host.querySelectorAll('canvas').length,callbacks:window.caseCheck.changes.length-before};})()`);
  assert.deepEqual(destroyed, { children: 0, canvases: 0, callbacks: 0 }, "destroy must remove preview drawing and leave no active editor DOM.");

  const sceneInitial = await evaluate("window.caseCheck.setupArchiveScene()");
  assert.equal(sceneInitial.loaded, true, "ArchiveScene must load the synthetic music array.");
  assert.equal(sceneInitial.albumCount, 8, "The scene uses eight synthetic albums.");
  assert.equal(sceneInitial.coverUrlMissing, true, "Synthetic albums have no cover URL and must use local fallback art.");
  assert.equal(sceneInitial.caseGeometryKey, "minimal:low");
  assert.equal(sceneInitial.insertThickness, 0, "Minimal Scene layout must not allocate a paper-card thickness.");
  assert.equal(sceneInitial.arrayInsertVisible || sceneInitial.selectedInsertVisible, false,
    "Minimal Scene inserts must stay hidden when the cover atlas has no physical card.");
  assert.deepEqual([...new Set(sceneInitial.modelParts)].sort(), fixture.structureParts.minimal,
    "Minimal ArchiveScene model must contain only frame, cover, and back.");
  assert.ok(!sceneInitial.modelParts.includes("accent"), "Minimal ArchiveScene must not instantiate an accent part.");
  assert.ok(sceneInitial.selectionLighting && sceneInitial.coverAtlasVisible && sceneInitial.coverAtlasRetained);
  assert.ok(sceneInitial.positionsRetained && sceneInitial.drawCalls > 0);

  const sceneMediumParts = {
    minimal: fixture.structureParts.minimal,
    rhine: fixture.structureParts.rhine.filter(part => part !== "trim"),
    punk: fixture.models.find(model => model.structure === "punk" && model.detail === "medium")?.parts ?? [],
  };
  const sceneStructures = {};
  for (const structure of ["minimal", "rhine", "punk"]) {
    const state = await evaluate("window.caseCheck.changeArchiveStructure(" + JSON.stringify(structure) + ")");
    const expectedKey = structure + ":" + (structure === "minimal" ? "low" : "medium");
    assert.equal(state.caseGeometryKey, expectedKey, structure + " model key");
    assert.equal(state.caseStructure, structure);
    assert.deepEqual([...new Set(state.modelParts)].sort(), sceneMediumParts[structure], structure + " ArchiveScene medium-detail part set");
    assert.equal(state.insertThickness > 0, structure !== "minimal", structure + " Scene paper-card thickness must follow its case layout.");
    if (state.modelOcclusionFlags.length > 0)
      assert.equal(state.modelOcclusionMatchesSelectedInsert, true,
        structure + " selected 3D shell metadata/uniforms must match the actual selected card visibility: " + JSON.stringify(state));
    if (structure === "punk") {
      assert.ok(state.modelOcclusionFlags.length > 0 && state.modelOcclusionMatchesSelectedInsert,
        "Punk selected 3D shell must receive the visible/hidden selected-card state from ArchiveScene.");
      assert.ok(state.arrayInsertVisible && state.allInstanceOcclusionMatchesArrayInsert &&
        state.instanceOcclusion.some(item => item.flags.length > 0),
      "Punk Scene array-shell instances must each match the actual array insert visibility: " + JSON.stringify(state.instanceOcclusion));
    }
    assert.ok(state.instanceCount > 0 && state.instanceParts.length > 0, structure + " instances must remain allocated");
    assert.ok(state.coverAtlasRetained && state.positionsRetained && state.coverAtlasVisible, structure + " must preserve placements and the album cover atlas");
    assert.ok(state.drawCalls > 0 && state.selectionLighting, structure + " must render with selection lighting");
    sceneStructures[structure] = state;
    if (structure === "rhine") {
      const sceneImage = await evaluate("window.caseCheck.archiveSceneScreenshot");
      assert.ok(sceneImage.startsWith("data:image/png;base64,"), "Rhine array render must produce a captured WebGL image.");
      await writeFile(path.join(output, "archive-scene-rhine.png"), Buffer.from(sceneImage.slice("data:image/png;base64,".length), "base64"));
      const captureStats = await evaluate("window.caseCheck.archiveSceneCaptureStats");
      assert.ok(captureStats.width > 500 && captureStats.height > 300 && captureStats.sampledColors > 8 && captureStats.nonBackgroundSamples > 50,
        "Rhine array screenshot must contain rendered scene pixels: " + JSON.stringify(captureStats));
      sceneStructures.rhineScreenshot = captureStats;
    }
  }

  const sceneCardLifecycle = await evaluate("window.caseCheck.exerciseCardLifecycle()");
  assert.ok(sceneCardLifecycle.insertThickness > 0 && sceneCardLifecycle.insertsVisibleWithCovers && sceneCardLifecycle.insertsHiddenWithCovers,
    "ArchiveScene paper inserts must follow cover visibility through real structure transitions: " + JSON.stringify(sceneCardLifecycle));
  assert.ok(sceneCardLifecycle.selectedArrayMaterialsIndependent && sceneCardLifecycle.viewerMaterialIndependent,
    "Selected, array, and Viewer album inserts must own independent materials.");
  assert.ok(sceneCardLifecycle.actualSceneOcclusionSync.noAlbums.modelOcclusionFlags.length > 0 &&
    sceneCardLifecycle.actualSceneOcclusionSync.noAlbums.modelOcclusionFlags.every(flag => flag === false) &&
    sceneCardLifecycle.actualSceneOcclusionSync.noAlbums.allInstanceOcclusionMatchesArrayInsert &&
    sceneCardLifecycle.actualSceneOcclusionSync.restoredAlbums.modelOcclusionMatchesSelectedInsert &&
    sceneCardLifecycle.actualSceneOcclusionSync.restoredAlbums.modelOcclusionFlags.some(flag => flag === true) &&
    sceneCardLifecycle.actualSceneOcclusionSync.restoredAlbums.allInstanceOcclusionMatchesArrayInsert &&
    sceneCardLifecycle.actualSceneOcclusionSync.restoredAlbums.instanceOcclusion.some(item => item.flags.includes(true)),
  "ArchiveScene's real empty-library and restored-library lifecycle must disable and reactivate shell occlusion in sync with its physical cards: " + JSON.stringify(sceneCardLifecycle.actualSceneOcclusionSync));
  assert.ok(sceneCardLifecycle.viewerDetachedAfterDispose && sceneCardLifecycle.viewerMarkedDisposed &&
    sceneCardLifecycle.viewerMaterialDisposed && sceneCardLifecycle.atlasMaterialsNotDisposed,
  "Disposing a Viewer card must detach and release only its own print/insert materials, preserving the live Scene atlas: " + JSON.stringify(sceneCardLifecycle));

  const selection = await evaluate("window.caseCheck.exerciseArchiveSelection()");
  assert.ok(selection.outgoingBeforeReturn >= 2, "Rapid album selection must retain multiple outgoing copies.");
  assert.ok(selection.returningCopyRemoved, "Returning to a prior selection must remove only that outgoing copy.");
  assert.ok(selection.materialGroupsIndependent, "Selected and outgoing groups must own distinct physical-material UUIDs.");
  assert.ok(selection.originalMaterialIdsRetained, "Disposing a returning copy must not dispose shared selected materials.");
  assert.ok(selection.summary.coverAtlasRetained && selection.summary.positionsRetained);

  const sceneRace = await evaluate("window.caseCheck.raceArchiveStructures()");
  assert.equal(sceneRace.caseGeometryKey, "punk:medium", "The last concurrent case-structure request must win.");
  assert.equal(sceneRace.caseStructure, "punk");
  assert.ok(sceneRace.coverAtlasRetained && sceneRace.positionsRetained && sceneRace.drawCalls > 0);
  assert.ok(sceneRace.modelOcclusionFlags.length > 0 && sceneRace.modelOcclusionMatchesSelectedInsert &&
    sceneRace.allInstanceOcclusionMatchesArrayInsert,
  "After the real structure-request race, selected and instanced Punk shells must still agree with the live album-card atlas.");
  const paperProtection = await evaluate("window.caseCheck.captureScenePaperProtection()");
  await writeFile(path.join(output, "production-scene-paper-occlusion.png"), pngBuffer(paperProtection.image, "Production Scene paper protection"));
  delete paperProtection.image;
  sceneAcceptance = { initial: sceneInitial, structures: sceneStructures, cardLifecycle: sceneCardLifecycle, selection, race: sceneRace, paperProtection };

  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(runtimeErrors, [], "Browser runtime errors must remain empty.");
  assert.deepEqual(shaderErrors, [], "Actual GLB/material renders must not produce WebGL shader compile/link errors.");
  assert.deepEqual(blockedRoutes, [], "The offline fixture must not request anything beyond its exact route whitelist.");

  const report = {
    ok: true,
    browser: browserExecutable,
    fixtureOrigin: baseUrl,
    assetsServed: [...assetPaths.keys()],
    sourceTriangleCounts: {
      archiveAssembly: archiveAssemblyTriangleCount,
      cassetteCarbonInk: archiveCassetteCarbonInkTriangleCount,
      rhineFullSource: rhineFullSourceTriangleCount,
      punkReferenceCase: punkReferenceTriangleCount,
    },
    modelChecks: fixture.models,
    punkGeometryAudit: fixture.punkGeometryAudit,
    editorBasicPaperCard: editorBasicCard.item,
    editorAlbumOcclusionLifecycle: {
      initiallyHiddenAfterPaperCapture: editorHiddenAfterPaper,
      reopenedVisibleThenHidden: editorOcclusionLifecycle,
    },
    editorInsertObservations: await evaluate("window.caseCheck.editorInsertObservations"),
    editorStatus: fixture.editorStatus,
    settingsAudit: fixture.settingsAudit,
    rhineNativeRestore: fixture.rhineNativeRestore,
    nativeOpticalEvidence: fixture.nativeOpticalEvidence,
    transformChecks: fixture.transformChecks,
    blueTangentChecks: fixture.blueTangentChecks,
    rhineSourceTriangles: fixture.rhineHighTriangles,
    interactions,
    personalUi,
    archivePunkEditorCapture: {
      topViewport: archiveScreenshotReady,
      personalViewport: archivePersonalCapture,
      screenshots: ["archive-punk-editor-1920-top.png", "archive-punk-editor-1920-personal.png"],
    },
    rhineInsetAlbum,
    rhineAlbumInfo,
    themeRestriction,
    destroyed,
    sceneIntegration: sceneAcceptance,
    viewerCoverage: "ViewerAlbumCover insert material/disposal lifecycle is runtime-tested; ModelViewer.attachAlbumCover consumer wiring is code-reviewed, not runtime-instantiated by this offline fixture.",
    shaderErrors,
    runtimeErrors,
    blockedRoutes,
    screenshots: [
      "case-editor-final.png", "punk-editor-basic-paper-card.png", "production-scene-paper-occlusion.png",
      "archive-punk-editor-1920-top.png", "archive-punk-editor-1920-personal.png",
      "punk-front-cover-hidden.png", "punk-oblique-cover-hidden.png", "rhine-oblique-cover-hidden.png", "archive-scene-rhine.png",
      "rhine-album-info-hi-res.png", "rhine-album-info-dsd.png",
      "rhine-album-label-canvas-raw.png", "rhine-album-label-case-zoom-depth-write-off.png",
      "rhine-album-label-case-zoom-depth-write-on.png", "rhine-album-label-case-zoom-production.png",
      "rhine-album-label-only-zoom.png",
    ],
  };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log("Editable case system and ArchiveScene integration passed: actual GLB/shader rendering, editor persistence, eight synthetic albums, structure swaps, outgoing material isolation, request revisions, and common renderer state.");
  console.log(`Screenshots and report: ${output}`);
}

try {
  await main();
} catch (error) {
  const failureDirectory = isReference ? referenceOutput : isUnifiedRender ? unifiedOutput : output;
  await mkdir(failureDirectory, { recursive: true });
  const failurePath = path.join(failureDirectory, `failure-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  await writeFile(failurePath, JSON.stringify({
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    browserErrors,
    browserLog,
    sceneIntegration: sceneAcceptance,
    shaderErrors,
    runtimeErrors,
    blockedRoutes,
    assetsServed: [...assetPaths.keys()],
  }, null, 2));
  console.error(`Failure report saved without replacing prior history: ${failurePath}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const { timer } of pending.values()) clearTimeout(timer);
  if (socket?.readyState === WebSocket.OPEN) await send("Browser.close").catch(() => browser.kill());
  else browser.kill();
  socket?.close();
  await new Promise(resolve => server.close(resolve));
  if (isReference) {
    console.log("Reference shader errors:", JSON.stringify(shaderErrors));
    console.log("Reference runtime errors:", JSON.stringify(runtimeErrors));
  }
}
