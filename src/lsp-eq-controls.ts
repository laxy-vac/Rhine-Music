import { trUi, ui } from "./i18n";
import type { ProcessingSettings } from "./audio-processing-model.mjs";

const pluginStateMaxChars = 699_052;
const pluginStateMaxBytes = 512 * 1024;
const pollIntervalMs = 500;

type NativeEqEditorState = {
  editorOpen: boolean;
  pluginState: string;
  latencyFrames: number;
  active: boolean;
  revision?: number;
};

type NativeEqEditorPoll = Omit<NativeEqEditorState, "pluginState"> & {
  pluginState?: string;
  unchanged?: boolean;
};

type LspEqControlHooks = {
  getSettings: () => ProcessingSettings;
  onSettingsChange: (settings: ProcessingSettings, committed?: boolean) => void;
  render?: () => void;
};

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function isCanonicalPluginState(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > pluginStateMaxChars ||
    value.length % 4 !== 0 ||
    !canonicalBase64Pattern.test(value)
  )
    return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if ((value.length / 4) * 3 - padding > pluginStateMaxBytes) return false;
  if (value.endsWith("==")) {
    const secondSextet = base64Alphabet.indexOf(value[value.length - 3]);
    return secondSextet >= 0 && (secondSextet & 15) === 0;
  }
  if (value.endsWith("=")) {
    const thirdSextet = base64Alphabet.indexOf(value[value.length - 2]);
    return thirdSextet >= 0 && (thirdSextet & 3) === 0;
  }
  return true;
}

function parseEditorPoll(value: unknown): NativeEqEditorPoll {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(trUi("LSP 面板状态无效。"));
  const state = value as Partial<NativeEqEditorPoll>;
  if (
    typeof state.editorOpen !== "boolean" ||
    typeof state.active !== "boolean" ||
    !Number.isSafeInteger(state.latencyFrames) ||
    Number(state.latencyFrames) < 0 ||
    (state.revision !== undefined &&
      (!Number.isSafeInteger(state.revision) || Number(state.revision) < 0))
  )
    throw new Error(trUi("LSP 面板状态无效。"));
  if (state.unchanged === true && state.pluginState === undefined)
    return state as NativeEqEditorPoll;
  if (!isCanonicalPluginState(state.pluginState))
    throw new Error(trUi("LSP 面板状态无效。"));
  return state as NativeEqEditorPoll;
}

async function responsePoll(response: Response): Promise<NativeEqEditorPoll> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(trUi("LSP 面板没有返回有效状态。"));
  }
  if (!response.ok) {
    const message =
      value && typeof value === "object" &&
      typeof (value as { error?: unknown }).error === "string"
        ? (value as { error: string }).error
        : trUi("LSP 面板操作失败。");
    throw new Error(message);
  }
  return parseEditorPoll(value);
}

export function renderLspEqControls(settings: ProcessingSettings) {
  return ui`<section class="lsp-eq-controls" data-lsp-eq-controls data-lsp-algorithm="${settings.eq.lsp.algorithm}">
    <div class="lsp-eq-actions lsp-native-editor">
      <output class="lsp-native-editor-status" data-lsp-editor-status role="status" aria-live="polite">${trUi("面板已关闭")}</output>
      <button type="button" class="eq-add-band lsp-native-editor-open" data-lsp-action="open-editor">${trUi("打开 LSP 原生面板")}</button>
    </div>
    <p class="lsp-eq-description">${trUi("高级滤波器参数由 LSP 原生面板提供。")}</p>
  </section>`;
}

export function setupLspEqControls(
  root: HTMLElement,
  hooks: LspEqControlHooks,
) {
  const windowRef = root.ownerDocument.defaultView;
  const fetcher = windowRef?.fetch?.bind(windowRef);
  let timer: number | undefined;
  let destroyed = false;
  let panelOpen = false;
  let requestPending = false;
  let opening: Promise<void> | undefined;
  let snapshotTail: Promise<void> = Promise.resolve();
  let snapshotting = false;
  let statusError = "";
  let latestState: NativeEqEditorState | undefined;
  const initialSettings = hooks.getSettings();
  const lspDesignKey = (settings: ProcessingSettings) => {
    return JSON.stringify(
      Object.entries(settings.eq.lsp).filter(([key]) => key !== "pluginState"),
    );
  };
  let observedEngine = initialSettings.eq.engine;
  let observedLspDesign = lspDesignKey(initialSettings);
  let observedPluginState = initialSettings.eq.lsp.pluginState;
  let preserveExternalSettings = false;
  let closePending: "engine" | "settings" | undefined;

  const observeSettings = () => {
    const current = hooks.getSettings();
    const engineChanged = current.eq.engine !== observedEngine;
    const designChanged = lspDesignKey(current) !== observedLspDesign;
    const pluginStateChanged =
      current.eq.lsp.pluginState !== observedPluginState;
    observedEngine = current.eq.engine;
    observedLspDesign = lspDesignKey(current);
    observedPluginState = current.eq.lsp.pluginState;
    if (panelOpen && (engineChanged || designChanged || pluginStateChanged)) {
      if (designChanged || pluginStateChanged) {
        preserveExternalSettings = true;
        closePending = "settings";
      } else closePending = "engine";
    }
    return current;
  };

  const editorStatus = () =>
    root.querySelector<HTMLOutputElement>("[data-lsp-editor-status]");

  const paintStatus = () => {
    const output = editorStatus();
    if (!output) return;
    output.textContent = statusError
      ? `${trUi("LSP 面板操作失败。")} ${statusError}`
      : requestPending
        ? trUi("正在同步 LSP 面板…")
        : latestState?.editorOpen
          ? latestState.active
            ? trUi("已连接当前播放")
            : trUi("LSP 面板已打开")
          : trUi("面板已关闭");
    output.dataset.state = statusError
      ? "error"
      : requestPending
        ? "busy"
        : latestState?.editorOpen
          ? "open"
          : "closed";
  };

  const applySnapshot = (
    state: NativeEqEditorState,
    committed = false,
    allowMerge = true,
  ) => {
    const current = observeSettings();
    latestState = state;
    panelOpen = state.editorOpen;
    statusError = "";
    if (!isCanonicalPluginState(state.pluginState)) {
      statusError = trUi("LSP 面板状态无效。");
      paintStatus();
      return;
    }
    if (!allowMerge || preserveExternalSettings) {
      latestState = { ...state, pluginState: current.eq.lsp.pluginState };
      if (!panelOpen) {
        preserveExternalSettings = false;
        closePending = undefined;
      }
      if (committed) hooks.onSettingsChange(current, true);
      paintStatus();
      return;
    }
    const changed = current.eq.lsp.pluginState !== state.pluginState;
    if (changed || committed) {
      observedPluginState = state.pluginState;
      hooks.onSettingsChange(
        changed
          ? {
              ...current,
              eq: {
                ...current.eq,
                lsp: { ...current.eq.lsp, pluginState: state.pluginState },
              },
            }
          : current,
        committed,
      );
    }
    paintStatus();
  };

  const acceptPoll = (poll: NativeEqEditorPoll, commit = false, allowMerge = true) => {
    observeSettings();
    const previous = latestState;
    if (poll.unchanged) {
      if (!previous) throw new Error(trUi("LSP 面板状态无效。"));
      latestState = {
        ...previous,
        editorOpen: poll.editorOpen,
        latencyFrames: poll.latencyFrames,
        active: poll.active,
        ...(poll.revision === undefined ? {} : { revision: poll.revision }),
      };
      panelOpen = poll.editorOpen;
      if (commit || (previous.editorOpen && !poll.editorOpen))
        hooks.onSettingsChange(hooks.getSettings(), true);
      paintStatus();
      return;
    }
    applySnapshot(
      {
        editorOpen: poll.editorOpen,
        pluginState: poll.pluginState!,
        latencyFrames: poll.latencyFrames,
        active: poll.active,
        ...(poll.revision === undefined ? {} : { revision: poll.revision }),
      },
      commit || (previous?.editorOpen === true && !poll.editorOpen),
      allowMerge,
    );
  };

  const request = async (
    action: "open" | "close" | "state",
    eq: ProcessingSettings["eq"] = hooks.getSettings().eq,
  ) => {
    if (!fetcher) throw new Error(trUi("本地 LSP 面板接口暂不可用。"));
    const lspEq = eq.engine === "lsp" ? eq : { ...eq, engine: "lsp" as const };
    const response = await fetcher("/api/native/eq-editor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action, eq: lspEq }),
    });
    return responsePoll(response);
  };

  const requestState = async (conditional: boolean) => {
    if (!fetcher) throw new Error(trUi("本地 LSP 面板接口暂不可用。"));
    const revision = conditional ? latestState?.revision : undefined;
    const query = revision === undefined ? "" : `?revision=${revision}`;
    const response = await fetcher(`/api/native/eq-editor${query}`, {
      method: "GET",
      cache: "no-store",
    });
    return responsePoll(response);
  };

  const poll = async () => {
    if (destroyed || !panelOpen || requestPending || snapshotting) return;
    requestPending = true;
    paintStatus();
    try {
      acceptPoll(await requestState(true));
      statusError = "";
    } catch (error) {
      statusError = error instanceof Error ? error.message : trUi("LSP 面板状态读取失败。");
    } finally {
      if (!snapshotting) requestPending = false;
      paintStatus();
      if (!panelOpen) closePending = undefined;
      else if (preserveExternalSettings) closePending = "settings";
      if (!snapshotting && closePending && !destroyed) runPendingClose();
      else if (!snapshotting && panelOpen && !destroyed)
        timer = windowRef?.setTimeout(() => {
          timer = undefined;
          void poll();
        }, pollIntervalMs);
    }
  };

  const stopPoll = () => {
    if (timer !== undefined) windowRef?.clearTimeout(timer);
    timer = undefined;
  };

  const syncSnapshot = (closePanel = false) => {
    const task = snapshotTail.catch(() => {}).then(async () => {
    stopPoll();
    if (opening) await opening;
    stopPoll();
    if (!panelOpen) return;
    snapshotting = true;
    const before = hooks.getSettings();
    const stateKey = JSON.stringify(before.eq.lsp);
    requestPending = true;
    paintStatus();
    let closeFailure: unknown;
    try {
      const state = await request("state");
      const unchangedSettings = JSON.stringify(hooks.getSettings().eq.lsp) === stateKey;
      acceptPoll(state, true, unchangedSettings);
      if (closePanel && panelOpen) {
        const savedLsp = JSON.stringify(hooks.getSettings().eq.lsp);
        const closed = await request("close");
        const unchangedBeforeClose =
          JSON.stringify(hooks.getSettings().eq.lsp) === savedLsp;
        acceptPoll(closed, true, unchangedBeforeClose);
      }
      statusError = "";
    } catch (error) {
      statusError = error instanceof Error ? error.message : trUi("LSP 面板状态读取失败。");
      closeFailure = error;
    } finally {
      snapshotting = false;
      requestPending = false;
      paintStatus();
      if (panelOpen && !destroyed)
        timer = windowRef?.setTimeout(() => {
          timer = undefined;
          void poll();
        }, pollIntervalMs);
    }
    if (closeFailure) throw closeFailure;
    });
    snapshotTail = task;
    return task;
  };

  const closeForEngineSwitch = async () => {
    if (!panelOpen || requestPending) return;
    stopPoll();
    requestPending = true;
    paintStatus();
    try {
      const state = await request("close");
      acceptPoll(state, !state.editorOpen);
    } catch (error) {
      statusError = error instanceof Error ? error.message : trUi("LSP 面板关闭失败。");
    } finally {
      requestPending = false;
      paintStatus();
      if (!panelOpen) closePending = undefined;
      else if (hooks.getSettings().eq.engine !== "lsp" && !closePending)
        closePending = "engine";
      if (closePending && !destroyed)
        timer = windowRef?.setTimeout(() => {
          timer = undefined;
          runPendingClose();
        }, pollIntervalMs);
      else if (panelOpen && !destroyed)
        timer = windowRef?.setTimeout(() => {
          timer = undefined;
          void poll();
        }, pollIntervalMs);
    }
  };

  const closeForExternalSettings = async () => {
    if (!panelOpen || requestPending) return;
    stopPoll();
    requestPending = true;
    paintStatus();
    try {
      const state = await request("close");
      acceptPoll(state, false, false);
    } catch (error) {
      statusError = error instanceof Error ? error.message : trUi("LSP 面板关闭失败。");
    } finally {
      requestPending = false;
      paintStatus();
      if (!panelOpen) {
        preserveExternalSettings = false;
        closePending = undefined;
      } else {
        closePending = "settings";
        timer = windowRef?.setTimeout(() => {
          timer = undefined;
          runPendingClose();
        }, pollIntervalMs);
      }
    }
  };

  function runPendingClose() {
    if (!closePending || requestPending || !panelOpen) {
      if (!panelOpen) closePending = undefined;
      return;
    }
    const reason = closePending;
    closePending = undefined;
    if (reason === "settings") void closeForExternalSettings();
    else void closeForEngineSwitch();
  }

  const open = async (button: HTMLButtonElement) => {
    if (requestPending || snapshotting || destroyed) return;
    observeSettings();
    if (closePending && panelOpen) {
      runPendingClose();
      return;
    }
    const current = hooks.getSettings();
    const openingState = JSON.stringify(current.eq.lsp);
    const openingEngine = current.eq.engine;
    observedEngine = current.eq.engine;
    observedLspDesign = lspDesignKey(current);
    observedPluginState = current.eq.lsp.pluginState;
    preserveExternalSettings = false;
    requestPending = true;
    statusError = "";
    button.disabled = true;
    paintStatus();
    try {
      const opened = await request("open");
      const unchanged = hooks.getSettings().eq.engine === openingEngine && JSON.stringify(hooks.getSettings().eq.lsp) === openingState;
      acceptPoll(opened, false, unchanged);
      if (panelOpen && (destroyed || !unchanged)) {
        acceptPoll(await request("close"), true, unchanged);
      } else if (panelOpen) {
        stopPoll();
        timer = windowRef?.setTimeout(() => {
          timer = undefined;
          void poll();
        }, pollIntervalMs);
      }
    } catch (error) {
      statusError = error instanceof Error ? error.message : trUi("LSP 面板打开失败。");
    } finally {
      requestPending = false;
      if (button.isConnected) button.disabled = false;
      paintStatus();
    }
  };

  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>(
      'button[data-lsp-action="open-editor"]',
    );
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    if (!opening) {
      opening = open(button).finally(() => { opening = undefined; });
      void opening;
    }
  };

  const sync = () => {
    observeSettings();
    paintStatus();
    runPendingClose();
  };

  root.addEventListener("click", onClick);
  paintStatus();

  return {
    sync,
    render: () => hooks.render?.(),
    async saveState() {
      await syncSnapshot(false);
      if (panelOpen && !destroyed && timer === undefined)
        timer = windowRef?.setTimeout(() => { timer = undefined; void poll(); }, pollIntervalMs);
    },
    beforeDestroy: () => syncSnapshot(true),
    destroy() {
      destroyed = true;
      stopPoll();
      root.removeEventListener("click", onClick);
      return syncSnapshot(true);
    },
  };
}
