export type MusicTheme = "day" | "night";

export type MusicThemeFollowQuery = {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};

export type MusicThemeFollowOptions = {
  getTheme: () => MusicTheme;
  applyTheme: (theme: MusicTheme) => void;
};

export function setupMusicThemeFollow(
  query: MusicThemeFollowQuery,
  initialFollowing: boolean,
  { getTheme, applyTheme }: MusicThemeFollowOptions,
): {
  readonly following: boolean;
  setFollowing(next: boolean): void;
  destroy(): void;
} {
  let following = initialFollowing;
  let lastSystemMatches = query.matches;
  let destroyed = false;

  const syncToSystem = (matches: boolean) => {
    const systemTheme: MusicTheme = matches ? "night" : "day";
    if (getTheme() !== systemTheme) applyTheme(systemTheme);
  };

  const onSystemChange = () => {
    if (destroyed) return;

    const currentMatches = query.matches;
    if (currentMatches === lastSystemMatches) return;

    lastSystemMatches = currentMatches;
    if (following) syncToSystem(currentMatches);
  };

  query.addEventListener("change", onSystemChange);

  return {
    get following() {
      return following;
    },
    setFollowing(next: boolean) {
      if (destroyed || next === following) return;

      following = next;
      if (!next) return;

      const currentMatches = query.matches;
      lastSystemMatches = currentMatches;
      syncToSystem(currentMatches);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      query.removeEventListener("change", onSystemChange);
    },
  };
}
