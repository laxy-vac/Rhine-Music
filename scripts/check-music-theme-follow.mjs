import assert from "node:assert/strict";
import test from "node:test";
import { setupMusicThemeFollow } from "../src/music-theme-follow.ts";

class MockThemeQuery {
  matches;
  listeners = new Set();

  constructor(matches) {
    this.matches = matches;
  }

  addEventListener(type, listener) {
    assert.equal(type, "change");
    this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    assert.equal(type, "change");
    this.listeners.delete(listener);
  }

  setSystem(matches, eventMatches = !matches) {
    this.matches = matches;
    for (const listener of [...this.listeners]) listener({ matches: eventMatches });
  }

  notify(eventMatches = !this.matches) {
    for (const listener of [...this.listeners]) listener({ matches: eventMatches });
  }
}

function makeThemeState(theme) {
  const applied = [];
  return {
    applied,
    getTheme: () => theme.value,
    applyTheme: (next) => {
      applied.push(next);
      theme.value = next;
    },
    theme,
  };
}

test("initial following preserves the saved theme and ignores unchanged system notifications", () => {
  const query = new MockThemeQuery(false);
  const state = makeThemeState({ value: "night" });
  const follow = setupMusicThemeFollow(query, true, state);

  assert.equal(follow.following, true);
  assert.deepEqual(state.applied, []);

  state.theme.value = "day";
  query.notify(true);
  assert.equal(state.theme.value, "day");
  assert.deepEqual(state.applied, []);

  follow.destroy();
});

test("real system changes follow, while duplicate notifications cannot overwrite a manual theme", () => {
  const query = new MockThemeQuery(false);
  const state = makeThemeState({ value: "day" });
  const follow = setupMusicThemeFollow(query, true, state);

  query.setSystem(true, false);
  assert.equal(state.theme.value, "night");
  assert.deepEqual(state.applied, ["night"]);

  state.theme.value = "day";
  query.notify(false);
  assert.equal(state.theme.value, "day");
  assert.deepEqual(state.applied, ["night"]);

  query.setSystem(false, true);
  assert.equal(state.theme.value, "day");
  assert.deepEqual(state.applied, ["night"]);

  follow.destroy();
});

test("enabling a matching theme does not apply, and repeated enable does not undo a manual choice", () => {
  const query = new MockThemeQuery(false);
  const state = makeThemeState({ value: "day" });
  const follow = setupMusicThemeFollow(query, false, state);

  follow.setFollowing(true);
  assert.deepEqual(state.applied, []);

  state.theme.value = "night";
  follow.setFollowing(true);
  assert.equal(state.theme.value, "night");
  assert.deepEqual(state.applied, []);

  follow.destroy();
});

test("enabling aligns once, disabling tracks silently, and re-enabling aligns to the latest system state", () => {
  const query = new MockThemeQuery(false);
  const state = makeThemeState({ value: "night" });
  const follow = setupMusicThemeFollow(query, false, state);

  follow.setFollowing(true);
  assert.equal(state.theme.value, "day");
  assert.deepEqual(state.applied, ["day"]);

  follow.setFollowing(true);
  assert.deepEqual(state.applied, ["day"]);

  follow.setFollowing(false);
  query.setSystem(true, false);
  assert.equal(follow.following, false);
  assert.equal(state.theme.value, "day");
  assert.deepEqual(state.applied, ["day"]);

  state.theme.value = "day";
  follow.setFollowing(true);
  assert.equal(state.theme.value, "night");
  assert.deepEqual(state.applied, ["day", "night"]);

  follow.setFollowing(true);
  assert.deepEqual(state.applied, ["day", "night"]);
  follow.destroy();
});

test("destroy removes the listener and makes later state changes inert", () => {
  const query = new MockThemeQuery(false);
  const state = makeThemeState({ value: "day" });
  const follow = setupMusicThemeFollow(query, true, state);

  assert.equal(query.listeners.size, 1);
  follow.destroy();
  follow.setFollowing(false);
  query.setSystem(true);

  assert.equal(query.listeners.size, 0);
  assert.equal(follow.following, true);
  assert.deepEqual(state.applied, []);
});
