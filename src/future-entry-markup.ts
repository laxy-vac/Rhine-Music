import { logo, brandHeading } from "./brand";
import { escapeHtml } from "./html";
import {
  defaultEntryWelcome,
  normalizeEntryText,
  type EntryTextCopy,
} from "./entry-preferences.mjs";

export function futureEntryMarkup(copy: EntryTextCopy = {}): string {
  const welcome = escapeHtml(normalizeEntryText(copy.welcome, defaultEntryWelcome));
  return `
    <div class="future-entry" role="dialog" aria-modal="true" aria-label="系统入场">
      <div class="future-entry-film" data-mode="boot" aria-hidden="true">
        <div id="boot-background" class="boot-background" aria-hidden="true">
          <svg viewBox="0 0 1920 1080" preserveAspectRatio="none"><g fill="none" stroke="#fff" stroke-width="3"><path d="M-210 705C-45 705 182 704 247 567C337 377 99 306 4 435S27 680 169 631C309 584 227 314 279 111S568-113 568-113"/><path d="M1560-80C1374 114 1671 168 1601 323S1371 367 1431 480S1692 666 1559 787S1329 886 1498 1130"/><circle cx="1450" cy="648" r="346"/><circle cx="1450" cy="648" r="348"/></g></svg>
          <div class="boot-white"></div>
        </div>
        <div class="future-entry-branding">
          <header class="brand">${brandHeading}</header>
          <div class="powered">POWERED BY <b>RHINE LAB</b><i></i></div>
        </div>
        <section class="boot" aria-label="系统启动">
          <div class="access-text">ACCESS</div>
          <div class="boot-logo">${logo}</div>
          <div class="auth-status"><span>▪</span> <span id="auth-message"></span><i></i></div>
          <div class="scan"><svg viewBox="0 0 1920 1080" aria-hidden="true"><g fill="none" stroke="#080a08" stroke-width="2" stroke-linecap="round"><path/><path stroke="#fff"/><path/><path/><path/><path/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="orbit-dot" r="8" fill="#ed821b" stroke="none"/><circle class="scan-core" cx="960" cy="540" r="5" fill="#080a08" stroke="none"/></g></svg><span>PERMISSION AUTHORIZED</span></div>
          <div class="welcome">
            <div class="welcome-panel"></div>
            <div class="welcome-heading">WELCOME TO</div>
            <div class="welcome-company"><strong>RHINE LAB.LLC.</strong><strong class="welcome-highlight" aria-hidden="true">RHINE LAB.LLC.</strong></div>
            <div class="welcome-database">${welcome}</div>
            <div class="welcome-logo">${logo}</div>
          </div>
        </section>
      </div>
      <div class="future-entry-shelf-caption" aria-hidden="true"><span>COLLECTION / ARRAY</span><i></i></div>
      <button class="future-entry-skip" type="button">SKIP INTRO ↗</button>
    </div>
  `;
}
