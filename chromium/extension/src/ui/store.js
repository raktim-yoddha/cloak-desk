/* Settings access for the popup and settings page. */
(function (root) {
  'use strict';
  const S = root.CloakDesk.settings;

  let queue = Promise.resolve();

  const store = {
    async get() {
      const r = await chrome.storage.local.get([S.KEY, S.RUNTIME_KEY]);
      return { settings: S.normalize(r[S.KEY]), runtime: r[S.RUNTIME_KEY] || { sharing: 0, tabs: [] } };
    },
    /** Applies a patch (object or fn(current) -> object) on top of the stored settings. */
    update(patch) {
      queue = queue.then(async () => {
        const r = await chrome.storage.local.get(S.KEY);
        const cur = S.normalize(r[S.KEY]);
        const next = S.normalize(Object.assign({}, cur, typeof patch === 'function' ? patch(cur) : patch));
        await chrome.storage.local.set({ [S.KEY]: next });
        return next;
      });
      return queue;
    },
    /** Calls fn({settings, runtime}) now and on every change. */
    watch(fn) {
      store.get().then(fn);
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes[S.KEY] || changes[S.RUNTIME_KEY])) store.get().then(fn);
      });
    },
  };

  root.CloakDesk.store = store;
})(globalThis);
