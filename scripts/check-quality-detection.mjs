import assert from "node:assert/strict";
import {
  isStableQualityScenario,
  recommendQuality,
} from "../src/quality-detection.ts";
import { qualityPresets } from "../src/render-quality.ts";

const presetNames = Object.keys(qualityPresets);
const scenario = (name, fps = 60) => ({
  scenario: name,
  fps,
  p95FrameMs: 18,
  slowFramePercent: 1,
  samples: 90,
});
const allStable = presetNames.map(preset => ({
  preset,
  scenarios: [scenario("shelf"), scenario("case")],
}));

assert.equal(recommendQuality(allStable), "ultra", "recommend the highest stable preset");
assert.equal(recommendQuality(allStable.slice(0, 2)), null, "incomplete preset runs cannot produce a recommendation");
assert.equal(recommendQuality(allStable.map((result, index) => index >= 2
  ? { ...result, scenarios: [scenario("shelf", 45), scenario("case", 45)] }
  : result)), "original", "fall back to the highest preset whose two scenes are stable");
assert.equal(recommendQuality(allStable.map((result, index) => index > 0
  ? { ...result, scenarios: [scenario("shelf", 40), scenario("case", 40)] }
  : result)), "performance", "a stable performance preset remains eligible when higher presets are slow");
assert.equal(recommendQuality(allStable.map(result => ({
  ...result,
  scenarios: [scenario("shelf", 45), scenario("case", 45)],
}))), null, "no preset is recommended when neither scene sustains the target");

assert.equal(isStableQualityScenario(scenario("shelf")), true);
assert.equal(isStableQualityScenario({ ...scenario("shelf"), fps: -1 }), false);
assert.equal(isStableQualityScenario({ ...scenario("shelf"), p95FrameMs: -1 }), false);
assert.equal(isStableQualityScenario({ ...scenario("shelf"), slowFramePercent: 101 }), false);
assert.equal(isStableQualityScenario({ ...scenario("shelf"), samples: 59 }), false);

console.log("Quality detection checks passed: complete scenes, stable target, and highest eligible preset.");
