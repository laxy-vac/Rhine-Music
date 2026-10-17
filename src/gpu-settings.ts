import { trUi, uiLanguage } from "./i18n";

export type GpuReport = {
  supported: boolean;
  adapters: { id: string; name: string }[];
  selectedId: string;
  activeName: string | null;
  restartRequired: boolean;
  warning?: string;
  error?: string;
};

const AUTO_ID = "auto";

function t(zh: string, en: string): string {
  return uiLanguage() === "en" ? en : zh;
}

function normalizeReport(value: unknown): GpuReport {
  if (!value || typeof value !== "object") {
    throw new Error(t("显卡信息格式无效。", "The GPU report is invalid."));
  }

  const report = value as Partial<GpuReport>;
  const adapters = Array.isArray(report.adapters)
    ? report.adapters.filter(
        (adapter): adapter is { id: string; name: string } =>
          Boolean(adapter) &&
          typeof adapter.id === "string" &&
          adapter.id.length > 0 &&
          adapter.id !== AUTO_ID &&
          typeof adapter.name === "string",
      )
    : [];

  if (typeof report.supported !== "boolean") {
    throw new Error(t("显卡信息缺少支持状态。", "The GPU report has no support status."));
  }

  return {
    supported: report.supported,
    adapters,
    selectedId: typeof report.selectedId === "string" ? report.selectedId : "",
    activeName: typeof report.activeName === "string" ? report.activeName : null,
    restartRequired: report.restartRequired === true,
    warning: typeof report.warning === "string" ? report.warning : undefined,
    error: typeof report.error === "string" ? report.error : undefined,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return t("显卡设置操作失败。", "The GPU settings operation failed.");
}

function makeOption(document: Document, label: string, value: string, disabled = false): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.disabled = disabled;
  return option;
}

export function mountGpuSettings(
  root: HTMLElement,
  bridge?: {
    gpuInfo(): Promise<GpuReport>;
    selectGpu(id: string): Promise<GpuReport>;
  },
): () => void {
  root.innerHTML = `
    <section class="gpu-settings">
      <div class="gpu-settings-heading">
        <h3>${t("优先显卡", "GPU preference")}</h3>
        <span class="gpu-settings-experimental">EXPERIMENTAL</span>
      </div>
      <p class="gpu-settings-description">${t(
        "默认自动，由播放器选择。更改后需完全退出并重新打开播放器。",
        "Automatic is selected by default and the player chooses the GPU. Fully quit and reopen the player after changing it.",
      )}</p>
      <label class="gpu-settings-choice">
        <span>${t("显卡选择", "GPU")}</span>
        <select data-gpu-preference data-keep-native-select>
          <option value="auto">${t("自动（播放器决定）", "Automatic (player decides)")}</option>
        </select>
      </label>
      <p class="gpu-settings-active" data-gpu-active></p>
      <p class="gpu-settings-status" data-gpu-status role="status" aria-live="polite"></p>
      <p class="gpu-settings-error" data-gpu-error role="alert" hidden></p>
      <p class="gpu-settings-warning" data-gpu-warning hidden></p>
      <button class="gpu-settings-refresh" type="button" data-gpu-refresh>${t(
        "刷新列表",
        "Refresh list",
      )}</button>
    </section>
  `;

  const select = root.querySelector<HTMLSelectElement>("[data-gpu-preference]");
  const activeText = root.querySelector<HTMLElement>("[data-gpu-active]");
  const statusText = root.querySelector<HTMLElement>("[data-gpu-status]");
  const errorText = root.querySelector<HTMLElement>("[data-gpu-error]");
  const warningText = root.querySelector<HTMLElement>("[data-gpu-warning]");
  const refreshButton = root.querySelector<HTMLButtonElement>("[data-gpu-refresh]");
  if (!select || !activeText || !statusText || !errorText || !warningText || !refreshButton) {
    return () => undefined;
  }

  let destroyed = false;
  let busy = false;
  let requestSequence = 0;
  let currentReport: GpuReport | null = null;
  let lastSavedSelection: string | null = null;

  const setError = (message = "") => {
    errorText.textContent = trUi(message).replace(/^无法读取可用显卡：/, t("无法读取可用显卡：", "Unable to read available GPUs: "));
    errorText.hidden = !message;
  };

  const setWarning = (message = "") => {
    warningText.textContent = trUi(message);
    warningText.hidden = !message;
  };

  const syncControls = () => {
    select.disabled = busy || !bridge || !currentReport?.supported;
    refreshButton.disabled = busy || !bridge;
  };

  const statusFor = (report: GpuReport, wasSaved = false) => {
    if (report.error) return t("显卡状态无法确认。", "GPU status could not be confirmed.");
    if (!report.supported) {
      return t("当前环境不支持显卡选择。", "GPU selection is not supported in this environment.");
    }
    if (wasSaved) {
      return report.restartRequired
        ? t(
            "已保存。更改需完全退出并重新打开播放器后生效。",
            "Saved. Fully quit and reopen the player to apply the change.",
          )
        : t("已保存。", "Saved.");
    }
    if (report.restartRequired) {
      return t(
        "所选显卡需在完全退出并重新打开播放器后生效。",
        "The selected GPU will apply after you fully quit and reopen the player.",
      );
    }
    return t("显卡状态已同步。", "GPU status synchronized.");
  };

  const renderReport = (report: GpuReport, selectionSaved = false) => {
    currentReport = report;
    if (selectionSaved) {
      lastSavedSelection = report.selectedId;
    } else if (lastSavedSelection !== null && lastSavedSelection !== report.selectedId) {
      lastSavedSelection = null;
    }

    select.replaceChildren(makeOption(root.ownerDocument, t("自动（播放器决定）", "Automatic (player decides)"), AUTO_ID));

    if (report.supported) {
      const availableIds = new Set<string>();
      for (const adapter of report.adapters) {
        if (availableIds.has(adapter.id)) continue;
        availableIds.add(adapter.id);
        select.add(makeOption(root.ownerDocument, adapter.name, adapter.id));
      }

      if (report.selectedId !== AUTO_ID && !availableIds.has(report.selectedId)) {
        select.add(
          makeOption(
            root.ownerDocument,
            t("所选显卡暂不可用", "The selected GPU is temporarily unavailable"),
            report.selectedId,
            true,
          ),
          1,
        );
      }
      select.value = report.selectedId;
    } else {
      select.value = AUTO_ID;
    }

    activeText.textContent = `${t("当前使用：", "Currently using: ")}${report.activeName || t("尚未确认", "Not yet confirmed")}`;
    statusText.textContent = statusFor(
      report,
      !report.error && lastSavedSelection !== null && lastSavedSelection === report.selectedId,
    );
    setError(report.error || "");
    setWarning(report.warning || "");
    syncControls();
  };

  const refresh = async () => {
    if (destroyed || busy || !bridge) return;
    const sequence = ++requestSequence;
    busy = true;
    setError();
    setWarning();
    statusText.textContent = t("正在读取显卡列表…", "Reading the GPU list…");
    syncControls();
    try {
      const report = normalizeReport(await bridge.gpuInfo());
      if (destroyed || sequence !== requestSequence) return;
      if (report.error) {
        if (!currentReport) renderReport(report);
        setError(report.error);
        statusText.textContent = t(
          "刷新失败，之前的显卡状态仍保留。",
          "Refresh failed. The previous GPU state was kept.",
        );
        return;
      }
      renderReport(report);
    } catch (error) {
      if (destroyed || sequence !== requestSequence) return;
      setError(errorMessage(error));
      statusText.textContent = currentReport
        ? t("刷新失败，之前的显卡状态仍保留。", "Refresh failed. The previous GPU state was kept.")
        : t("暂无法读取显卡设置。", "GPU settings could not be read.");
    } finally {
      if (!destroyed && sequence === requestSequence) {
        busy = false;
        syncControls();
      }
    }
  };

  const saveSelection = async () => {
    if (destroyed || busy || !bridge || !currentReport?.supported) return;
    const requestedId = select.value;
    const previousReport = currentReport;
    if (!requestedId || requestedId === previousReport.selectedId) return;

    const sequence = ++requestSequence;
    busy = true;
    setError();
    setWarning();
    statusText.textContent = t("正在保存显卡选择…", "Saving GPU preference…");
    syncControls();

    try {
      const report = normalizeReport(await bridge.selectGpu(requestedId));
      if (destroyed || sequence !== requestSequence) return;
      if (report.error || !report.supported || report.selectedId !== requestedId) {
        renderReport(previousReport);
        setError(
          report.error ||
            t("显卡选择未能确认，已保留之前的设置。", "The GPU preference could not be confirmed. The previous setting was kept."),
        );
        statusText.textContent = t("显卡选择未保存。", "GPU preference was not saved.");
        return;
      }
      renderReport(report, true);
    } catch (error) {
      if (destroyed || sequence !== requestSequence) return;
      renderReport(previousReport);
      setError(errorMessage(error));
      statusText.textContent = t("显卡选择未保存，之前的设置仍保留。", "GPU preference was not saved. The previous setting was kept.");
    } finally {
      if (!destroyed && sequence === requestSequence) {
        busy = false;
        syncControls();
      }
    }
  };

  const onChange = () => {
    void saveSelection();
  };
  const onRefresh = () => {
    void refresh();
  };

  select.addEventListener("change", onChange);
  refreshButton.addEventListener("click", onRefresh);

  if (bridge) {
    void refresh();
  } else {
    activeText.textContent = `${t("当前使用：", "Currently using: ")}${t("尚未确认", "Not yet confirmed")}`;
    statusText.textContent = t(
      "当前环境不支持显卡选择。",
      "GPU selection is not supported in this environment.",
    );
    setWarning(t("显卡设置仅在提供桌面显卡接口的播放器中可用。", "GPU settings are available only in a player that provides the desktop GPU interface."));
    syncControls();
  }

  return () => {
    if (destroyed) return;
    destroyed = true;
    requestSequence += 1;
    select.removeEventListener("change", onChange);
    refreshButton.removeEventListener("click", onRefresh);
  };
}
