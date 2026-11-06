/*
 * Cloak Desk Browser Safety: runs in the page's own JavaScript world (MAIN) at document_start.
 *
 * 1. Notices when this page starts or stops sharing the screen (getDisplayMedia, and the
 *    legacy chromeMediaSource "desktop"/"screen" form) and tells the extension, so
 *    "While sharing" mode can switch hiding on in every tab.
 * 2. While hiding is on, replaces the text of web notifications this page shows, so a
 *    chat preview popping up on your desktop doesn't leak to viewers.
 * 3. Keeps CSS.highlights.clear() from wiping the extension's masks.
 *
 * It only reads and dispatches events on `document`; it has no access to the extension.
 * A page could fake these events, but faking "start" only turns hiding on, and faking
 * "stop" only affects shares started by that same page.
 */
(() => {
  'use strict';
  const MARK = Symbol.for('cloakdesk.hook');
  if (window[MARK]) return;
  Object.defineProperty(window, MARK, { value: true });

  const emit = (type, id) => {
    try {
      document.dispatchEvent(new CustomEvent('cloakdesk:share', { detail: JSON.stringify({ type, id }) }));
    } catch (_) {
      /* document gone */
    }
  };

  let seq = 0;
  const liveTracks = new WeakMap(); // track -> share id
  const remaining = new Map(); // share id -> live track count

  function trackEnded(track) {
    const id = liveTracks.get(track);
    if (!id) return;
    liveTracks.delete(track);
    const left = (remaining.get(id) || 1) - 1;
    if (left <= 0) {
      remaining.delete(id);
      emit('stop', id);
    } else remaining.set(id, left);
  }

  function watch(stream) {
    try {
      const tracks = stream.getVideoTracks().filter((t) => t.readyState === 'live');
      if (!tracks.length) return stream;
      const id = `${Date.now().toString(36)}-${++seq}`;
      remaining.set(id, tracks.length);
      for (const t of tracks) {
        liveTracks.set(t, id);
        t.addEventListener('ended', () => trackEnded(t), { once: true });
      }
      emit('start', id);
    } catch (_) {
      /* never break the page's call */
    }
    return stream;
  }

  // A page stopping its own share calls track.stop(), which fires no 'ended' event.
  const TrackProto = window.MediaStreamTrack && MediaStreamTrack.prototype;
  if (TrackProto && TrackProto.stop) {
    const origStop = TrackProto.stop;
    const stop = {
      stop() {
        const r = origStop.apply(this, arguments);
        trackEnded(this);
        return r;
      },
    }.stop;
    Object.defineProperty(TrackProto, 'stop', { value: stop, writable: true, configurable: true, enumerable: false });
  }

  const MD = window.MediaDevices && MediaDevices.prototype;
  if (MD && MD.getDisplayMedia) {
    const orig = MD.getDisplayMedia;
    const getDisplayMedia = {
      getDisplayMedia() {
        return orig.apply(this, arguments).then(watch);
      },
    }.getDisplayMedia;
    Object.defineProperty(MD, 'getDisplayMedia', { value: getDisplayMedia, writable: true, configurable: true, enumerable: true });
  }
  if (MD && MD.getUserMedia) {
    const origUser = MD.getUserMedia;
    const isScreen = (c) => {
      const v = c && c.video;
      const src = v && ((v.mandatory && v.mandatory.chromeMediaSource) || v.chromeMediaSource);
      return src === 'desktop' || src === 'screen' || src === 'tab';
    };
    const getUserMedia = {
      getUserMedia(c) {
        const p = origUser.apply(this, arguments);
        return isScreen(c) ? p.then(watch) : p;
      },
    }.getUserMedia;
    Object.defineProperty(MD, 'getUserMedia', { value: getUserMedia, writable: true, configurable: true, enumerable: true });
  }

  // ---------- highlight registry ----------

  // The extension's masks live in the shared CSS highlight registry but are invisible to this
  // world, so a page's CSS.highlights.clear() would also wipe them. Make clear() remove only
  // the highlights this page can see (its own), which is all a page ever means by it.
  const HR = window.HighlightRegistry && HighlightRegistry.prototype;
  if (HR && HR.clear && HR.delete && HR.keys) {
    const del = HR.delete;
    const keys = HR.keys;
    const clear = {
      clear() {
        for (const k of [...keys.call(this)]) del.call(this, k);
      },
    }.clear;
    Object.defineProperty(HR, 'clear', { value: clear, writable: true, configurable: true, enumerable: true });
  }

  // ---------- notifications ----------

  let hiding = false;
  document.addEventListener('cloakdesk:state', (e) => {
    hiding = e.detail === 'on';
  });

  const site = () => location.hostname.replace(/^www\./, '') || 'This site';
  const quiet = (options) => {
    const o = Object.assign({}, options || {});
    o.body = 'Message hidden by Cloak Desk while you share';
    delete o.image;
    delete o.icon;
    o.silent = true;
    return o;
  };

  const N = window.Notification;
  if (typeof N === 'function') {
    const Wrapped = new Proxy(N, {
      construct(target, args, newTarget) {
        if (hiding) args = [site(), quiet(args[1])];
        return Reflect.construct(target, args, newTarget === Wrapped ? target : newTarget);
      },
    });
    try {
      Object.defineProperty(window, 'Notification', { value: Wrapped, writable: true, configurable: true });
    } catch (_) {
      /* leave it */
    }
  }
  const SWR = window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype;
  if (SWR && SWR.showNotification) {
    const origShow = SWR.showNotification;
    const showNotification = {
      showNotification(title, options) {
        return hiding ? origShow.call(this, site(), quiet(options)) : origShow.apply(this, arguments);
      },
    }.showNotification;
    Object.defineProperty(SWR, 'showNotification', { value: showNotification, writable: true, configurable: true, enumerable: true });
  }
})();
