import { uiLanguage } from './i18n';

type DayPalette = 'soft' | 'original';
const t = (zh: string, en: string) => uiLanguage() === 'en' ? en : zh;

/** Two stable layers: the light/dark pill, then a smaller day-palette pill. */
export function futureAppearancePickerMarkup(palette: DayPalette, mode: 'day' | 'night') {
  const day = mode === 'day';
  return `<div class="theme-mode-buttons future-appearance-switch" data-appearance-mode="${mode}" data-day-choice="${palette}" role="group" aria-label="${t('日夜模式与日间配色','Light, dark and daytime palette')}">
    <span class="future-mode-indicator" aria-hidden="true"></span>
    <div class="future-light-choice">
      <button type="button" class="future-light-trigger" data-theme="day" aria-pressed="${day}" aria-hidden="${day}" tabindex="${day ? -1 : 0}"><i class="theme-mode-dot day" aria-hidden="true"></i>LIGHT</button>
      <div class="future-day-options" role="group" aria-label="${t('LIGHT 日间配色','LIGHT daytime palette')}"${day ? '' : ' inert'}>
        <span class="future-day-indicator" aria-hidden="true"></span>
        <button type="button" data-day-palette="soft" aria-pressed="${palette === 'soft'}" tabindex="${day && palette === 'soft' ? 0 : -1}" title="${t('暖白底色与橙色点缀','Soft white with orange accents')}"><i class="theme-mode-dot soft" aria-hidden="true"></i>${t('暖白','SOFT')}</button>
        <button type="button" data-day-palette="original" aria-pressed="${palette === 'original'}" tabindex="${day && palette === 'original' ? 0 : -1}" title="${t('原版日间配色','Original daytime palette')}"><i class="theme-mode-dot original" aria-hidden="true"></i>${t('原版','ORIGINAL')}</button>
      </div>
    </div>
    <button type="button" class="future-dark-trigger" data-theme="night" aria-pressed="${!day}"><i class="theme-mode-dot night" aria-hidden="true"></i>DARK</button>
  </div>
  <p class="future-day-palette-note"><span>LIGHT</span> · <b data-day-palette-label>${palette === 'original' ? t('原版','Original') : t('暖白','Soft white')}</b></p>`;
}

export function syncFutureAppearancePicker(root: HTMLElement, palette: DayPalette, mode: 'day' | 'night') {
  const picker = root.matches('.future-appearance-switch') ? root : root.querySelector<HTMLElement>('.future-appearance-switch');
  if (!picker) return;
  const active = picker.ownerDocument.activeElement;
  const dayButton = picker.querySelector<HTMLButtonElement>('[data-theme="day"]')!;
  const darkButton = picker.querySelector<HTMLButtonElement>('[data-theme="night"]')!;
  const options = picker.querySelector<HTMLElement>('.future-day-options')!;
  picker.dataset.appearanceMode = mode;
  picker.dataset.dayChoice = palette;
  dayButton.setAttribute('aria-pressed', String(mode === 'day'));
  dayButton.setAttribute('aria-hidden', String(mode === 'day'));
  dayButton.tabIndex = mode === 'day' ? -1 : 0;
  darkButton.setAttribute('aria-pressed', String(mode === 'night'));
  options.inert = mode !== 'day';
  picker.querySelectorAll<HTMLButtonElement>('[data-day-palette]').forEach(button => {
    const selected = button.dataset.dayPalette === palette;
    button.setAttribute('aria-pressed', String(selected));
    button.tabIndex = mode === 'day' && selected ? 0 : -1;
  });
  const note = picker.parentElement?.querySelector<HTMLElement>('[data-day-palette-label]');
  if (note) note.textContent = palette === 'original' ? t('原版','Original') : t('暖白','Soft white');
  if (mode === 'day' && active === dayButton) picker.querySelector<HTMLButtonElement>(`[data-day-palette="${palette}"]`)?.focus({ preventScroll: true });
  else if (mode === 'night' && active && options.contains(active)) darkButton.focus({ preventScroll: true });
}

export function handleFutureAppearanceKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.closest('.future-appearance-switch')) return false;
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return false;
  const picker = target.closest<HTMLElement>('.future-appearance-switch')!;
  const buttons = Array.from(picker.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.getAttribute('aria-hidden') !== 'true' && !button.closest('[inert]'));
  const current = buttons.indexOf(target);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.click();
  // A LIGHT click reveals the remembered day option and focuses it in sync().
  if (buttons[next]?.getAttribute('aria-hidden') !== 'true') buttons[next]?.focus({ preventScroll: true });
  return true;
}
