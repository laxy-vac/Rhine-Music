import './desktop-window.css';

/** Native caption buttons sit over the page; the remaining top edge drags it. */
export function setupDesktopWindow() {
  const bridge = window.rhineDesktop;
  if (bridge?.windowControlsOverlay && !document.getElementById('desktop-window-drag')) {
    const dragRegion = document.createElement('div');
    dragRegion.id = 'desktop-window-drag';
    dragRegion.className = 'desktop-window-drag';
    dragRegion.setAttribute('aria-hidden', 'true');
    document.body.append(dragRegion);
    bridge.onFullscreenChange?.(fullscreen => {
      document.documentElement.dataset.desktopFullscreen = String(fullscreen);
    });
  }

  let previous = '';
  return {
    syncAppearance(background: string, foreground: string) {
      if (!bridge?.windowControlsOverlay || !bridge.setWindowAppearance) return;
      const key = `${background}/${foreground}`;
      if (key === previous) return;
      previous = key;
      void bridge.setWindowAppearance({ background, foreground }).catch(error => {
        previous = '';
        console.error('Window appearance update failed:', error);
      });
    },
  };
}
