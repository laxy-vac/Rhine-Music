/** Shared album interaction surface with independent Future and Punk skins. */
export function setupAlbumPanel(root: HTMLElement, reduced: () => boolean) {
  const panel = document.createElement("aside");
  panel.className = "album-panel";
  panel.tabIndex = -1;
  panel.hidden = true;
  panel.inert = true;
  panel.setAttribute("aria-label", "专辑信息");
  panel.dataset.panelState = "browse";

  // Future's reading veil belongs to the persistent pane, not to the browse
  // surface that fades out while the camera opens an album.
  const readingVeil = document.createElement("div");
  readingVeil.className = "album-panel-veil";
  readingVeil.hidden = true;
  readingVeil.setAttribute("aria-hidden", "true");

  const viewport = document.createElement("div");
  viewport.className = "album-panel-scroll";
  const callout = root.querySelector<HTMLElement>(".album-callout")!;
  const article = root.querySelector<HTMLElement>("#album-detail-content")!;
  const content = () => article.querySelector<HTMLElement>("#album-tab-content");

  function rememberPosition(node: HTMLElement, label: string) {
    const parent = node.parentNode;
    const nextSibling = node.nextSibling;
    const marker = document.createComment("album-panel:" + label);
    parent?.insertBefore(marker, node);
    return { node, parent, nextSibling, marker };
  }

  const calloutPosition = rememberPosition(callout, "music-browse");
  const articlePosition = rememberPosition(article, "music-detail");
  panel.append(viewport);
  root.append(readingVeil, panel);

  let active = false;
  let destroyed = false;
  let wanted = false;
  let revision = 0;
  let frame = 0;
  let album = "";
  let focusAfterOpen = false;
  let focusAfterClose = false;
  let buttonAnimation: Animation | undefined;
  let typingFrame = 0;
  let typingLabels: HTMLElement[] = [];
  const fullLabels = new WeakMap<HTMLElement,string>();
  let sceneTabindex: string | null = null;
  let sceneTabindexCaptured = false;
  let rootAlbumPanelValue: string | null = null;
  let rootAlbumPanelCaptured = false;
  let originalArticleState: { hidden: boolean; inert: boolean } | undefined;
  let originalActionSurfaceState: { node: HTMLElement; hidden: boolean; inert: boolean } | undefined;
  let originalActionButtonStates: Array<{ node: HTMLElement; hidden: boolean; inert: boolean }> = [];
  let originalArticleTabindex: string | null = null;
  const tabAnimations = new Set<Animation>();
  let scanHead: HTMLElement | undefined;

  const openButton = () => callout.querySelector<HTMLElement>('.open-album[data-action="open"]');
  const actionSurface = () => callout.querySelector<HTMLElement>(".album-actions") ?? openButton();
  const actionButtons = () => {
    const surface = actionSurface();
    if (!surface) return [];
    return surface.matches("button")
      ? [surface]
      : Array.from(surface.querySelectorAll<HTMLElement>("button"));
  };
  function captureActionState() {
    const surface = actionSurface();
    originalActionSurfaceState = surface
      ? { node: surface, hidden: surface.hidden, inert: surface.inert }
      : undefined;
    originalActionButtonStates = actionButtons().map(node => ({
      node,
      hidden: node.hidden,
      inert: node.inert,
    }));
  }
  function restoreActionState() {
    const surface = actionSurface();
    if (surface) {
      const state = originalActionSurfaceState?.node === surface ? originalActionSurfaceState : undefined;
      surface.hidden = state?.hidden ?? false;
      surface.inert = state?.inert ?? false;
    }
    for (const button of actionButtons()) {
      const state = originalActionButtonStates.find(item => item.node === button);
      button.hidden = state?.hidden ?? false;
      button.inert = state?.inert ?? false;
    }
  }
  function setActionState(state: "browse" | "transition" | "expanded") {
    const hidden = state === "expanded";
    const inert = state !== "browse";
    const surface = actionSurface();
    if (surface) {
      surface.hidden = hidden;
      surface.inert = inert;
    }
    for (const button of actionButtons()) {
      button.hidden = hidden;
      button.inert = inert;
    }
  }
  const futureTheme = () => {
    const app = root.closest<HTMLElement>(".music-app");
    return app?.dataset.design === "rhine" || root.dataset.design === "rhine";
  };
  const instant = () => reduced() || matchMedia("(prefers-reduced-motion: reduce)").matches;

  function cancelFrame() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function cancelButtonAnimation(finish = false) {
    cancelTyping();
    const animation = buttonAnimation;
    buttonAnimation = undefined;
    if (!animation) return;
    try {
      if (finish) animation.finish();
      else animation.cancel();
    } catch {
      animation.cancel();
    }
  }
  function cancelTyping() {
    cancelAnimationFrame(typingFrame);typingFrame=0;
    for (const label of typingLabels) {
      label.textContent = fullLabels.get(label) ?? label.textContent;
      label.style.removeProperty("width");
    }
    typingLabels = [];
  }
  function typeActionLabels(duration=560) {
    cancelTyping();
    if(futureTheme()||instant())return;
    typingLabels = Array.from(actionSurface()?.querySelectorAll<HTMLElement>(".play-album-label, .open-album-label") ?? []);
    if (!typingLabels.length) return;
    const entries = typingLabels.map(label => {
      const text = fullLabels.get(label) ?? label.textContent ?? "";
      fullLabels.set(label, text);
      label.style.width = `${label.getBoundingClientRect().width}px`;
      return { label, glyphs: Array.from(text) };
    });
    const noise='#%/\\=<>_01',start=performance.now();
    const tick=(now:number)=>{const p=Math.min(1,(now-start)/duration);
      entries.forEach(({label,glyphs},entry) => {
        const count=Math.min(glyphs.length,Math.floor(p*glyphs.length));
        label.textContent=glyphs.map((char,i)=>i<count?char:noise[(i*7+entry*3+Math.floor(now/45))%noise.length]).join('');
      });
      if(p<1)typingFrame=requestAnimationFrame(tick);else cancelTyping();};
    tick(start);
  }

  function cancelTabAnimations(finish = false) {
    for (const animation of tabAnimations) {
      try {
        if (finish) animation.finish();
        else animation.cancel();
      } catch {
        animation.cancel();
      }
    }
    tabAnimations.clear();
    scanHead?.remove();
    scanHead = undefined;
  }

  function trackTabAnimation(animation: Animation) {
    tabAnimations.add(animation);
    void animation.finished.then(
      () => tabAnimations.delete(animation),
      () => tabAnimations.delete(animation),
    );
    return animation;
  }

  /** Reveal existing text in reading order, without replacing any content or pane. */
  function revealFutureFields(scope: HTMLElement, reverse = false) {
    if (!futureTheme() || instant() || panel.hidden) return;
    const selectors = scope === callout
      ? ".music-eyebrow, .selection-rule, #selection-title, .selection-artist, .selection-meta, .selection-profile-heading, .selection-profile dl > div"
      : ".music-tabs, .disc-heading, .track-row, .album-about > *, .producer-section > *, .empty-tracks";
    const fields = Array.from(scope.querySelectorAll<HTMLElement>(selectors))
      .filter(node => node.getClientRects().length > 0).slice(0, 16);
    for (const [index, field] of fields.entries()) trackTabAnimation(field.animate(
      [{ clipPath: reverse ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)", opacity: .3 },
        { clipPath: "inset(0)", opacity: 1 }],
      { duration: 320, delay: Math.min(index, 7) * 24,
        easing: "cubic-bezier(.22,.7,.22,1)", fill: "backwards" },
    ));
  }

  function notifyPanelLayout() {
    root.dispatchEvent(new Event("album-panel-layout"));
  }

  function focusArticle() {
    const target = article.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      article.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (target) target.focus({ preventScroll: true });
    else {
      article.tabIndex = -1;
      article.focus({ preventScroll: true });
    }
  }

  function focusOpenButton() {
    const button = openButton();
    if (button) button.focus({ preventScroll: true });
    else panel.focus({ preventScroll: true });
  }

  function setBrowse() {
    article.hidden = true;
    article.inert = true;
    article.style.removeProperty("height");
    article.style.removeProperty("overflow");
    setActionState("browse");
    panel.dataset.panelState = "browse";
    viewport.scrollTop = 0;
  }

  function setExpanded() {
    setActionState("expanded");
    article.hidden = false;
    article.inert = false;
    article.style.removeProperty("height");
    article.style.removeProperty("overflow");
    panel.dataset.panelState = "expanded";
    notifyPanelLayout();
  }

  function settle(open: boolean, moveFocus = false) {
    const retainRightFocus = moveFocus && panel.contains(document.activeElement) && root.dataset.operationFocus === "right";
    if (open) {
      setExpanded();
      if (retainRightFocus) focusArticle();
    } else {
      setBrowse();
      if (retainRightFocus) focusOpenButton();
    }
    focusAfterOpen = false;
    focusAfterClose = false;
  }

  function animateButton(mode: "exit" | "enter", ticket: number, complete: () => void, origin?: Keyframe) {
    const surface = actionSurface();
    if (!surface || instant()) {
      complete();
      return;
    }

    const future = futureTheme();
    const keyframes: Keyframe[] = future
      ? mode === "exit"
        ? [{ opacity: 1, clipPath: "inset(0)" }, { opacity: 0, clipPath: "inset(0 0 0 100%)" }]
        : [{ opacity: .3, clipPath: "inset(0 100% 0 0)" }, { opacity: 1, clipPath: "inset(0)" }]
      : mode === "exit"
        ? [{ opacity: 1, clipPath: "inset(-6px)", transform: "translateY(0px) scaleY(1)" },
           { opacity: 0, clipPath: "inset(48% -6px)", transform: "translateY(-12px) scaleY(.88)" }]
        : [{ opacity: 0, clipPath: "inset(48% -6px)", transform: "translateY(10px) scaleY(.88)" },
           { opacity: 1, clipPath: "inset(-6px)", transform: "translateY(0px) scaleY(1)" }];
    if (origin) keyframes[0] = origin;
    const baseDuration = future ? 240 : mode === "exit" ? 360 : 560;
    const distance = origin ? Math.abs((mode === "enter" ? 1 : 0) - Number(origin.opacity)) : 1;
    const duration = origin ? Math.max(future ? 80 : 120, Math.round(baseDuration * distance)) : baseDuration;
    const animation = surface.animate(keyframes, {
      duration,
      easing: mode === "exit"
        ? future ? "cubic-bezier(.4,0,.7,.2)" : "cubic-bezier(.2,.65,.3,1)"
        : "cubic-bezier(.2,.7,.2,1)",
      fill: "none",
    });
    buttonAnimation = animation;
    if(mode==='enter')typeActionLabels(duration);else cancelTyping();
    void animation.finished.then(
      () => {
        if (buttonAnimation === animation) buttonAnimation = undefined;
        if (active && ticket === revision && wanted === (mode === "exit")) {
          if (mode === "enter") cancelTyping();
          complete();
        }
      },
      () => {
        if (buttonAnimation === animation) buttonAnimation = undefined;
      },
    );
  }

  function revealArticle(ticket: number, from: number) {
    if (!active || ticket !== revision || !wanted) return;
    setActionState("expanded");
    article.hidden = false;
    article.inert = false;
    revealFutureFields(article);
    notifyPanelLayout();
    article.style.height = Math.max(0, from) + "px";
    article.style.overflow = "hidden";
    panel.dataset.panelState = "expanding";

    const to = Math.max(0, article.scrollHeight);
    if (instant() || to <= from) {
      settle(true, focusAfterOpen);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      if (!active || ticket !== revision || !wanted) return;
      const p = Math.min(1, (now - start) / 360);
      const eased = 1 - Math.pow(1 - p, 3);
      article.style.height = (from + (to - from) * eased) + "px";
      if (p < 1) frame = requestAnimationFrame(tick);
      else {
        frame = 0;
        settle(true, focusAfterOpen);
      }
    };
    frame = requestAnimationFrame(tick);
  }

  function beginOpen(ticket: number, from: number, origin?: Keyframe) {
    if (!active || ticket !== revision || !wanted) return;
    if (article.hidden) {
      setActionState("transition");
      article.inert = true;
      panel.dataset.panelState = "button-exit";
      animateButton("exit", ticket, () => {
        if (!active || ticket !== revision || !wanted) return;
        revealArticle(ticket, 0);
      }, origin);
      return;
    }
    revealArticle(ticket, from);
  }

  function revealButton(ticket: number, origin?: Keyframe) {
    if (!active || ticket !== revision || wanted) return;
    viewport.scrollTop = 0;
    const surface = actionSurface();
    if (surface) setActionState("transition");
    panel.dataset.panelState = surface ? "button-enter" : "browse";
    if (!surface) {
      setBrowse();
      if (focusAfterClose && panel.contains(document.activeElement) && root.dataset.operationFocus === "right") focusOpenButton();
      focusAfterClose = false;
      return;
    }
    animateButton("enter", ticket, () => {
      if (!active || ticket !== revision || wanted) return;
      setActionState("browse");
      panel.dataset.panelState = "browse";
      if (focusAfterClose && panel.contains(document.activeElement) && root.dataset.operationFocus === "right") focusOpenButton();
      focusAfterClose = false;
    }, origin);
  }

  function collapseArticle(ticket: number, from: number, origin?: Keyframe) {
    if (!active || ticket !== revision || wanted) return;
    if (article.hidden) {
      if (origin) revealButton(ticket, origin);
      else settle(false, false);
      return;
    }
    article.inert = true;
    article.hidden = false;
    article.style.height = Math.max(0, from) + "px";
    article.style.overflow = "hidden";
    panel.dataset.panelState = "collapsing";

    if (instant() || from <= 0) {
      article.hidden = true;
      article.inert = true;
      article.style.removeProperty("height");
      article.style.removeProperty("overflow");
      revealButton(ticket);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      if (!active || ticket !== revision || wanted) return;
      const p = Math.min(1, (now - start) / 280);
      const eased = 1 - Math.pow(1 - p, 3);
      article.style.height = (from * (1 - eased)) + "px";
      if (p < 1) frame = requestAnimationFrame(tick);
      else {
        frame = 0;
        article.hidden = true;
        article.inert = true;
        article.style.removeProperty("height");
        article.style.removeProperty("overflow");
        revealButton(ticket);
      }
    };
    frame = requestAnimationFrame(tick);
  }

  function restorePosition(position: ReturnType<typeof rememberPosition>) {
    const { node, marker, parent, nextSibling } = position;
    const destination = marker.parentNode ?? parent;
    if (!destination) return;
    const reference = marker.parentNode === destination
      ? marker.nextSibling
      : nextSibling?.parentNode === destination ? nextSibling : null;
    destination.insertBefore(node, reference);
  }

  function restoreSceneTabindex() {
    if (!sceneTabindexCaptured) return;
    const scene = root.querySelector<HTMLElement>("#three-scene");
    if (scene) {
      if (sceneTabindex === null) scene.removeAttribute("tabindex");
      else scene.setAttribute("tabindex", sceneTabindex);
    }
    sceneTabindex = null;
    sceneTabindexCaptured = false;
  }

  function cancelMotion(finishAnimations = false) {
    cancelFrame();
    cancelButtonAnimation(finishAnimations);
    cancelTabAnimations(finishAnimations);
  }

  function deactivate() {
    if (!active) return;
    revision++;
    cancelMotion();
    wanted = false;
    focusAfterOpen = false;
    focusAfterClose = false;

    restoreActionState();
    if (originalArticleState) {
      article.hidden = originalArticleState.hidden;
      article.inert = originalArticleState.inert;
    } else {
      article.hidden = false;
      article.inert = false;
    }
    article.style.removeProperty("height");
    article.style.removeProperty("overflow");
    if (originalArticleTabindex === null) article.removeAttribute("tabindex");
    else article.setAttribute("tabindex", originalArticleTabindex);

    restorePosition(calloutPosition);
    restorePosition(articlePosition);
    restoreSceneTabindex();
    if (rootAlbumPanelCaptured) {
      if (rootAlbumPanelValue === null) delete root.dataset.albumPanel;
      else root.dataset.albumPanel = rootAlbumPanelValue;
    }
    rootAlbumPanelValue = null;
    rootAlbumPanelCaptured = false;
    panel.hidden = true;
    panel.inert = true;
    panel.dataset.panelState = "browse";
    readingVeil.hidden = true;
    active = false;
    originalArticleState = undefined;
    originalActionSurfaceState = undefined;
    originalActionButtonStates = [];
  }

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const onReducedMotionChange = (event: MediaQueryListEvent) => {
    if (!event.matches || !active) return;
    revision++;
    cancelMotion();
    settle(wanted, false);
  };
  reducedMotion.addEventListener?.("change", onReducedMotionChange);

  return {
    element: panel,
    get active(): boolean { return active; },
    setActive(next: boolean) {
      if (destroyed || active === next) return;
      if (!next) { deactivate(); return; }

      revision++;
      cancelMotion();
      wanted = false;
      originalArticleState = { hidden: article.hidden, inert: article.inert };
      originalArticleTabindex = article.getAttribute("tabindex");
      captureActionState();
      viewport.append(callout, article);
      if (!panel.isConnected) root.append(panel);
      article.hidden = true;
      article.inert = true;
      article.style.removeProperty("height");
      article.style.removeProperty("overflow");
      setActionState("browse");
      panel.dataset.panelState = "browse";
      panel.hidden = false;
      readingVeil.hidden = false;
      panel.inert = false;
      active = true;
      rootAlbumPanelValue = root.dataset.albumPanel ?? null;
      rootAlbumPanelCaptured = true;
      root.dataset.albumPanel = "true";

      const scene = root.querySelector<HTMLElement>("#three-scene");
      sceneTabindex = scene?.getAttribute("tabindex") ?? null;
      sceneTabindexCaptured = true;
      scene?.setAttribute("tabindex", "-1");
    },
    setVisible(visible: boolean, inert = false) {
      if (!active) return;
      panel.hidden = !visible;
      readingVeil.hidden = !visible;
      panel.inert = inert;
    },
    setOpen(open: boolean) {
      if (!active || wanted === open) return;
      const surface = actionSurface();
      const style = buttonAnimation && surface ? getComputedStyle(surface) : undefined;
      const fullClip = futureTheme() ? "inset(0)" : "inset(-6px)";
      const origin: Keyframe | undefined = style
        ? { opacity: style.opacity, clipPath: style.clipPath === "none" ? fullClip : style.clipPath, transform: style.transform }
        : undefined;
      const from = article.hidden ? 0 : article.getBoundingClientRect().height;
      const wasFocusedInArticle = article.contains(document.activeElement);
      wanted = open;
      const wasFocusedInActions = actionSurface()?.contains(document.activeElement) ?? false;
      focusAfterOpen = open && wasFocusedInActions && root.dataset.operationFocus === "right";
      focusAfterClose = !open && wasFocusedInArticle;
      if (wasFocusedInActions || (!open && wasFocusedInArticle)) panel.focus({ preventScroll: true });
      revision++;
      const ticket = revision;
      cancelMotion();
      if (instant()) {
        settle(open, open ? focusAfterOpen : focusAfterClose);
        return;
      }
      if (open) beginOpen(ticket, from, origin);
      else collapseArticle(ticket, from, origin);
    },
    contentChanged(id: string) {
      if (!active || album === id) return;
      album = id;
      revision++;
      cancelMotion();
      focusAfterOpen = false;
      focusAfterClose = false;
      viewport.scrollTop = 0;
      settle(wanted, false);
      if (!panel.hidden) {
        revealFutureFields(callout);
        if (wanted) revealFutureFields(article);
      }
    },
    scrollTarget() {
      return active ? viewport : null;
    },
    scanTab(previous: "tracks" | "about", next: "tracks" | "about") {
      if (!active || article.hidden) return;
      cancelTabAnimations();
      const body = content();
      if (!body || instant()) return;
      const reverse = previous === "about" && next === "tracks";
      if (futureTheme()) { revealFutureFields(article, reverse);return; }
      panel.dataset.scanDirection = reverse ? "left" : "right";
      trackTabAnimation(body.animate(
        [{ clipPath: reverse ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)" }, { clipPath: "inset(0)" }],
        { duration: 320, easing: "cubic-bezier(.22,.7,.22,1)" },
      ));
      const button = article.querySelector<HTMLElement>("#tab-" + next);
      if (button) trackTabAnimation(button.animate(
        [{ clipPath: reverse ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)" }, { clipPath: "inset(0)" }],
        { duration: 250, easing: "linear" },
      ));
      const head = document.createElement("i");
      head.className = "album-tab-scan";
      head.setAttribute("aria-hidden", "true");
      body.append(head);
      scanHead = head;
      const travel = body.clientWidth;
      trackTabAnimation(head.animate(
        [{ transform: "translateX(" + (reverse ? travel : 0) + "px)" }, { transform: "translateX(" + (reverse ? 0 : travel) + "px)" }],
        { duration: 320, easing: "cubic-bezier(.22,.7,.22,1)" },
      ));
    },
    finish() {
      if (!active) return;
      revision++;
      cancelFrame();
      cancelButtonAnimation(true);
      cancelTabAnimations(true);
      settle(wanted, wanted ? focusAfterOpen : focusAfterClose);
    },
    destroy() {
      if (destroyed) return;
      deactivate();
      restorePosition(calloutPosition);
      restorePosition(articlePosition);
      restoreSceneTabindex();
      calloutPosition.marker.remove();
      articlePosition.marker.remove();
      panel.remove();
      readingVeil.remove();
      reducedMotion.removeEventListener?.("change", onReducedMotionChange);
      destroyed = true;
    },
  };
}
