// dsh-sidebar-enhancement-search — Client half (browser bundle, __ModuleLoader__ contract)
// v0.3.0: no new tab. Augments the BUILT-IN Explorer tab of dsh-better-sidebar:
// inserts a Codex-style filter box right below the workspace folder name.
// Filtering uses Codex-style subsequence matching (chars in order, contiguous
// and boundary hits score higher; basename dominates the path). While typing,
// the built-in tree is hidden and matching files render in its place with
// per-file-type badges. Click opens the sidebar editor, hover reveals the
// containing folder. The workspace root is resolved by the HOST from the
// session id.
//
// v1.0.2 (better-sidebar 0.14 adaptation):
//  - the Files window is now an editor tab titled "Files" (type 'explorer' is
//    normalized away), so the active-tab detection matches both shapes;
//  - the old explorerHeader anchor is gone; we mount right after the built-in
//    search row ([class*="editorTreeSearch"]) inside the tree panel and hide
//    that row so our filter box replaces the built-in search;
//  - carries the better-sidebar 0.14 bottom-panel layout-push CSS fix
//    (div:has(> [data-slot="conversation"]) margin-bottom), because the
//    shipped push selector never matches the current DSH shell DOM.
//
// v0.3.1 BADGE REWRITE: badges are now rendered with CSS pseudo-elements
// (::before + data-* attributes) instead of inserting DOM nodes into the
// React-managed tab bar / explorer tree. React's reconciliation previously
// wiped (or corrupted) injected nodes on every re-render, so badges kept
// reverting to the built-in icon. Data attributes and inline CSS variables
// on the tab/row elements survive React re-renders, and the pseudo-element
// is painted by the browser itself, so the badge can no longer be removed
// or fight React. Markdown files still keep the BUILT-IN icon (typeBadge
// returns null; no data attribute is set, the built-in "#" glyph stays).
// v0.3.1 adds a self-healing heartbeat: the <style> tag is re-injected if
// missing and badges are re-applied every 2s even if every observer dies.
// (Verified offline with headless Edge: pseudo-element badges render
// correctly and md keeps the built-in icon.)
window.__ModuleLoader__.load({ id: 'dsh-sidebar-enhancement-search', factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;
  var React = require('react');
  var ReactDOM = require('react-dom');

  var sidebarService = null;

  function dbg() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[dsh-sidebar-enhancement-search]');
    try { console.log.apply(console, args); } catch (e) {}
  }
  var lastTrace = '';
  function trace(msg) {
    if (msg === lastTrace) return;
    lastTrace = msg;
    dbg(msg);
  }
  var lastCountLog = '';
  function countLog(msg) {
    if (msg === lastCountLog) return;
    lastCountLog = msg;
    dbg(msg);
  }

  // ---- tiny module store: whether the built-in explorer is the active tab ----
  // mountTick is bumped by the host-level self-healing observer whenever the
  // injected mount node is wiped by a better-sidebar layout rebuild (tab drags,
  // splits), forcing ExplorerAugment to re-locate and re-mount.
  var storeRef = { state: { active: false, sessionId: null, mountTick: 0 } };
  var listeners = [];
  function setStore(next) {
    storeRef.state = next;
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](next); } catch (e) {}
    }
  }
  function subscribeStore(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (l) { return l !== fn; });
    };
  }

  // ---- tree helpers over the sidebar store snapshot ----
  function findLeaf(node, paneId) {
    if (!node) return null;
    if (node.kind === 'leaf') return node.id === paneId ? node : null;
    for (var i = 0; i < node.children.length; i++) {
      var f = findLeaf(node.children[i], paneId);
      if (f) return f;
    }
    return null;
  }
  function inTree(node, paneId) {
    if (!node) return false;
    if (node.kind === 'leaf') return node.id === paneId;
    return node.children.some(function (c) { return inTree(c, paneId); });
  }
  /** All leaves whose ACTIVE tab is the built-in explorer / Files window.
  *  v1.0.2: better-sidebar 0.14 normalized the explorer tab into an editor tab
  *  titled "Files" (see its store normalization), so both shapes match. */
  function findExplorerCandidates(st) {
    var out = [];
    function scan(node, inBottom) {
      if (!node) return;
      if (node.kind === 'leaf') {
        for (var i = 0; i < node.tabs.length; i++) {
          var tab = node.tabs[i];
          var isFiles = tab.type === 'explorer' || (tab.type === 'editor' && tab.title === 'Files');
          if (tab.id === node.active && isFiles) {
            out.push({ inBottom: inBottom });
            return;
          }
        }
        return;
      }
      for (var j = 0; j < node.children.length; j++) scan(node.children[j], inBottom);
    }
    scan(st.splits, false);
    scan(st.bottomSplits, true);
    return out;
  }

  function recompute(bs) {
    try {
      var snap = bs.getSnapshot();
      var st = snap && snap.state;
      var sessionId = snap && snap.sessionId;
      trace('snapshot: session=' + sessionId + ' activePane=' + (st && st.activePane) +
        ' panelOpen=' + (st && st.panelOpen) + ' hasState=' + (!!st));
      var active = false;
      if (st) {
        var candidates = findExplorerCandidates(st);
        trace('explorer candidates: ' + (candidates.length === 0 ? 'none' :
          candidates.map(function (c) { return c.inBottom ? 'bottom' : 'right'; }).join(' | ')));
        if (candidates.length > 0) {
          var activeInBottom = inTree(st.bottomSplits, st.activePane);
          var preferred = null;
          for (var k = 0; k < candidates.length; k++) {
            if (candidates[k].inBottom === activeInBottom) { preferred = candidates[k]; break; }
          }
          var chosen = preferred || candidates[0];
          if (chosen.inBottom || st.panelOpen) active = true;
          else trace('hide: explorer in right tree but panel closed');
        }
      }
      setStore(Object.assign({}, storeRef.state, { active: active, sessionId: sessionId }));
    } catch (e) {
      trace('recompute error: ' + ((e && e.message) || e));
      setStore(Object.assign({}, storeRef.state, { active: false, sessionId: null }));
    }
  }

  // ---- DOM locating: insert our search row into the built-in explorer tab ----
  var MOUNT_ATTR = 'data-dsh-sidebar-enhancement-search';

  function cleanupMounts() {
    var nodes = document.querySelectorAll('[' + MOUNT_ATTR + ']');
    for (var i = 0; i < nodes.length; i++) {
      try { nodes[i].parentNode.removeChild(nodes[i]); } catch (e) {}
    }
    // v1.0.2: restore the built-in search rows we hid while mounted
    var searches = document.querySelectorAll('[class*="editorTreeSearch"]');
    for (var j = 0; j < searches.length; j++) {
      try { searches[j].style.display = ''; } catch (e) {}
    }
  }

  /**
  * Find the built-in files window's search row. v1.0.2: better-sidebar 0.14
  * replaced the old explorerHeader with its OWN search row
  * (`[class*="editorTreeSearch"]`, part of TreePanel). We mount under the
  * tree panel, right after that row, and HIDE the built-in search row so our
  * filter box replaces it (the built-in search is a plain substring list
  * without file-type badges or reveal buttons).
  */
  function locateMount() {
    var searches = Array.prototype.slice.call(document.querySelectorAll('[class*="editorTreeSearch"]'))
      .filter(function (h) { return h.getClientRects().length > 0; });
    if (searches.length === 0) {
      dbg('locateMount: no visible editorTreeSearch found');
      return null;
    }
    var search = searches[0];
    var root = search.parentElement;
    if (!root) {
      dbg('locateMount: editorTreeSearch has no parent');
      return null;
    }
    var mount = root.querySelector('[' + MOUNT_ATTR + ']');
    if (mount) return mount;
    search.style.display = 'none';
    mount = document.createElement('div');
    mount.setAttribute(MOUNT_ATTR, '1');
    mount.style.cssText = 'position:relative;padding:0 10px 6px;';
    if (search.nextSibling) root.insertBefore(mount, search.nextSibling);
    else root.appendChild(mount);
    dbg('locateMount: filter box inserted, built-in search row hidden');
    return mount;
  }

  // ==========================================================================
  // v0.3.0: badges via CSS pseudo-elements. We never insert/replace nodes
  // inside React-managed containers; we only set data-* attributes + inline
  // CSS variables on EXISTING elements (tab divs, explorer rows), which React
  // leaves alone. A single <style> tag renders the badge from those attributes.
  // ==========================================================================
  var STYLE_ID = 'dsh-sidebar-enhancement-search-badges';

  function injectStyles() {
    var existing = document.getElementById(STYLE_ID);
    if (existing) {
      // v1.0.3: a stale stylesheet from an older plugin instance (or an older
      // version without the push fix) would otherwise block re-injection and
      // keep the old rules forever — verify the content, replace if outdated.
      if (existing.textContent.indexOf('data-slot="conversation"') !== -1) return;
      try { existing.parentNode.removeChild(existing); } catch (e) {}
    }
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent =
      // tab bar badges (div.tab): hide the built-in icon, draw the badge
      '[data-dsh-tab-badge] > svg{display:none !important;}' +
      '[data-dsh-tab-badge]::before{content:attr(data-dsh-badge-label);' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'width:14px;height:14px;border-radius:3px;flex:none;' +
      'font-size:7px;font-weight:700;line-height:14px;color:#fff;' +
      'background:var(--dsh-badge-bg,#868e96);letter-spacing:-.2px;}' +
      // explorer row badges: same technique on the row div
      '[data-dsh-badge] > svg{display:none !important;}' +
      '[data-dsh-badge]::before{content:attr(data-dsh-badge-label);' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'width:16px;height:16px;border-radius:3px;flex:none;' +
      'font-size:8px;font-weight:700;line-height:16px;color:#fff;' +
      'background:var(--dsh-badge-bg,#868e96);letter-spacing:-.2px;}' +
      // v1.0.2: better-sidebar 0.14 layout-push fix — its shipped selector
      // (#root [data-dsh-frame] > [data-pane="conversation"]) never matches the
      // current DSH shell DOM, so the bottom panel floats OVER the chat column.
      // Push the conversation column's grid item up by the panel height instead
      // (:has() targets the column regardless of hashed class names).
      'div:has(> [data-slot="conversation"]){margin-bottom:var(--dsh-sidebar-height,0px);}';
    document.head.appendChild(tag);
  }

  /** Self-healing style injection: if anything removed the <style> tag
  *  (plugin reload races, React root rebuilds, DOM resets), re-add it. */
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    injectStyles();
    dbg('badge style re-injected');
  }

  function removeStyles() {
    var tag = document.getElementById(STYLE_ID);
    if (tag) { try { tag.parentNode.removeChild(tag); } catch (e) {} }
  }

  function setBadge(el, label, color) {
    el.setAttribute('data-dsh-badge-label', label);
    el.style.setProperty('--dsh-badge-bg', color);
  }
  function clearBadge(el, attr) {
    el.removeAttribute(attr);
    el.removeAttribute('data-dsh-badge-label');
    el.style.removeProperty('--dsh-badge-bg');
  }

  /** Store editor tabs (type 'editor', with a path). */
  function collectEditors(st) {
    var out = [];
    function dfs(node) {
      if (!node) return;
      if (node.kind === 'leaf') {
        for (var i = 0; i < node.tabs.length; i++) {
          var t = node.tabs[i];
          if (t.type === 'editor' && t.path) out.push({ title: t.title, path: t.path });
        }
        return;
      }
      for (var j = 0; j < node.children.length; j++) dfs(node.children[j]);
    }
    dfs(st.splits);
    dfs(st.bottomSplits);
    return out;
  }

  /**
  * Tab badges: for every DOM tab div (identified by its title attribute, which
  * better-sidebar sets to tab.title), find a store editor tab with the same
  * title (consumed one-to-one in DOM order) and set/clear the badge attributes.
  * Non-editor tabs (Explorer/Git/Terminal/...) never match → their icon is left
  * untouched. Robust against any pane reordering / split rebuilds.
  */
  function applyTabBadges() {
    var host = document.querySelector('[data-dsh-better-sidebar]');
    if (!host) return;
    var snap = sidebarService ? sidebarService.getSnapshot() : null;
    var st = snap && snap.state;
    if (!st) { countLog('tab badges: no store state yet'); return; }
    var editors = collectEditors(st);
    var used = {};
    var matched = 0;
    var badged = 0;
    var divs = host.querySelectorAll('[class*="tab"]');
    for (var j = 0; j < divs.length; j++) {
      var div = divs[j];
      var title = div.getAttribute('title');
      if (!title) continue; // not a tab div (bar/list/plus buttons have no title)
      var match = null;
      for (var k = 0; k < editors.length; k++) {
        if (!used[k] && editors[k].title === title) { match = editors[k]; used[k] = true; break; }
      }
      if (!match) {
        // non-editor tab (or tab without a path): ensure no stale badge
        if (div.hasAttribute('data-dsh-tab-badge')) clearBadge(div, 'data-dsh-tab-badge');
        continue;
      }
      matched += 1;
      var want = typeBadge(match.path);
      if (!want) {
        // markdown etc.: keep the built-in icon
        if (div.hasAttribute('data-dsh-tab-badge')) clearBadge(div, 'data-dsh-tab-badge');
        continue;
      }
      if (div.getAttribute('data-dsh-badge-label') === want.label &&
          div.style.getPropertyValue('--dsh-badge-bg') === want.color) { badged += 1; continue; }
      div.setAttribute('data-dsh-tab-badge', '1');
      setBadge(div, want.label, want.color);
      badged += 1;
    }
    countLog('tab badges: editors=' + editors.length + ' matched=' + matched + ' badged=' + badged);
  }

  /**
  * Tree badges: for EVERY explorer body in the document (visible or hidden
  * pane), file rows (title attr present; directories have none) get their
  * badge attributes set from the row's file name. Idempotent + cheap.
  */
  function applyTreeBadges() {
    var bodies = document.querySelectorAll('[class*="explorerBody"]');
    if (bodies.length === 0) return;
    var rows = 0;
    var badged = 0;
    for (var b = 0; b < bodies.length; b++) {
      var body = bodies[b];
      var rowEls = body.querySelectorAll('[class*="explorerRow"][title]');
      for (var i = 0; i < rowEls.length; i++) {
        var row = rowEls[i];
        var nameEl = row.querySelector('[class*="explorerName"]');
        if (!nameEl) continue;
        rows += 1;
        var want = typeBadge(nameEl.textContent || '');
        if (!want) {
          if (row.hasAttribute('data-dsh-badge')) clearBadge(row, 'data-dsh-badge');
          continue;
        }
        if (row.getAttribute('data-dsh-badge-label') === want.label &&
            row.style.getPropertyValue('--dsh-badge-bg') === want.color) { badged += 1; continue; }
        row.setAttribute('data-dsh-badge', '1');
        setBadge(row, want.label, want.color);
        badged += 1;
      }
    }
    countLog('tree badges: rows=' + rows + ' badged=' + badged);
  }

  /**
  * Host-level self-healing: runs (debounced) on host DOM mutations. If the
  * explorer is active but our injected mount node is gone (a tab drag / split
  * rebuilt the pane DOM), re-insert it and bump mountTick so ExplorerAugment
  * re-mounts. Tree badges are refreshed by applyTreeBadges on every pass.
  */
  function checkMountHealth() {
    if (!storeRef.state.active) return;
    var mount = document.querySelector('[' + MOUNT_ATTR + ']');
    if (mount) return;
    var node = null;
    try { node = locateMount(); } catch (e) { node = null; }
    if (!node) return;
    setStore(Object.assign({}, storeRef.state, { mountTick: storeRef.state.mountTick + 1 }));
    dbg('mount rebuilt after layout change');
  }

  // ---- tab-bar observer state (v0.3.2: these two declarations were missing
  // since the v0.3.0 rewrite, so tryStart threw ReferenceError every 500ms
  // and the MutationObserver never started — the icon badges then only
  // refreshed on store events and layout changes stopped working) ----
  var tabBadgeTimer = null;
  var tabBadgeObserver = null;
  var hostApplyTimer = null;

  /** Debounced badge/mount refresh — driven by store notifications AND DOM mutations. */
  function scheduleBadgeApply() {
    if (hostApplyTimer) window.clearTimeout(hostApplyTimer);
    hostApplyTimer = window.setTimeout(function () {
      hostApplyTimer = null;
      try { ensureStyles(); } catch (e) {}
      try { applyTabBadges(); } catch (e) { dbg('applyTabBadges error:', e); }
      try { applyTreeBadges(); } catch (e) { dbg('applyTreeBadges error:', e); }
      try { checkMountHealth(); } catch (e) {}
    }, 120);
  }

  // ---- bulletproof fallback: even if EVERY observer dies (host root rebuilt,
  // plugin reload races, stale instances), a slow heartbeat re-applies badges
  // and re-ensures the style tag, so icons can never be stuck as built-in. ----
  var heartbeatTimer = null;
  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(function () {
      try { ensureStyles(); } catch (e) {}
      try { applyTabBadges(); } catch (e) {}
      try { applyTreeBadges(); } catch (e) {}
    }, 2000);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startTabBadges() {
    function tryStart() {
      var host = document.querySelector('[data-dsh-better-sidebar]');
      if (!host) return false;
      if (tabBadgeObserver) return true;
      try {
        tabBadgeObserver = new MutationObserver(function () {
          // debounce: coalesce the mutation flood during drags/splits into one pass
          scheduleBadgeApply();
        });
        tabBadgeObserver.observe(host, { childList: true, subtree: true });
        applyTabBadges();
        applyTreeBadges();
        checkMountHealth();
      } catch (e) {
        dbg('startTabBadges tryStart error:', e);
      }
      return true;
    }
    if (tryStart()) return;
    tabBadgeTimer = setInterval(function () {
      try {
        if (tryStart()) {
          clearInterval(tabBadgeTimer);
          tabBadgeTimer = null;
        }
      } catch (e) {
        dbg('tab badge retry error:', e);
      }
    }, 500);
  }

  function stopTabBadges() {
    if (tabBadgeTimer) {
      clearInterval(tabBadgeTimer);
      tabBadgeTimer = null;
    }
    if (hostApplyTimer) {
      window.clearTimeout(hostApplyTimer);
      hostApplyTimer = null;
    }
    if (tabBadgeObserver) {
      try { tabBadgeObserver.disconnect(); } catch (e) {}
      tabBadgeObserver = null;
    }
    stopHeartbeat();
  }

  // ---- per-file-type badges (distinguishable icons for pdf/img/... ) ----
  // Markdown files keep the BUILT-IN icon (the original "#"-looking code glyph):
  // typeBadge returns null for them, and the call sites leave the built-in
  // icon untouched (or render the same glyph in the search list).
  var MD_EXTS = ['md', 'markdown', 'mdown'];
  var CODE_ICON_PATH = 'M12.3368 1.53569L11.931 4.43172H14.8086V5.79673H11.7404L11.1962 9.67859H14.2839V11.0436H11.0056L10.4994 14.6529L9.14873 14.4643L9.62731 11.0436H5.75876L5.25252 14.6529L3.90186 14.4643L4.38043 11.0436H1.69141V9.67859H4.57104L5.11417 5.79673H2.21609V4.43172H5.30581L5.73724 1.34713L7.08995 1.53569L6.68414 4.43172H10.5527L10.9841 1.34713L12.3368 1.53569ZM5.94937 9.67859H9.81791L10.361 5.79673H6.49353L5.94937 9.67859Z';
  /** The original built-in "#"-glyph, drawn with currentColor like the shell icons. */
  function CodeHashIcon() {
    return React.createElement('svg', {
      width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      style: { display: 'block', flexShrink: 0 }, 'aria-hidden': true
    }, React.createElement('path', {
      fillRule: 'evenodd', clipRule: 'evenodd', fill: 'currentColor', d: CODE_ICON_PATH
    }));
  }
  var TYPE_TABLE = [
    [['txt', 'rtf', 'log'], 'TXT', '#74c0fc'],
    [['doc', 'docx', 'odt'], 'DOC', '#339af0'],
    [['xls', 'xlsx', 'csv', 'tsv', 'dta'], 'XLS', '#51cf66'],
    [['ppt', 'pptx', 'odp'], 'PPT', '#ff922b'],
    [['pdf'], 'PDF', '#ff6b6b'],
    [['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff'], 'IMG', '#f783ac'],
    [['zip', 'rar', '7z', 'tar', 'gz'], 'ZIP', '#adb5bd'],
    [['py', 'pyw'], 'PY', '#fab005'],
    [['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'], 'JS', '#ffd43b'],
    [['json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'xml'], 'CFG', '#b197fc'],
    [['sh', 'bat', 'cmd', 'ps1', 'bash'], 'SH', '#20c997'],
    [['c', 'h', 'cpp', 'cc', 'hpp', 'rs', 'go', 'java'], 'C', '#63e6be'],
    [['html', 'htm', 'css', 'scss'], 'WEB', '#4dabf7']
  ];
  function extOf(name) {
    var at = name.lastIndexOf('.');
    if (at <= 0) return '';
    var e = name.slice(at + 1).toLowerCase();
    return e.indexOf(' ') === -1 ? e : '';
  }
  function typeBadge(name) {
    var ext = extOf(name);
    for (var i = 0; i < MD_EXTS.length; i++) {
      if (MD_EXTS[i] === ext) return null; // markdown: keep the built-in icon
    }
    for (var j = 0; j < TYPE_TABLE.length; j++) {
      var row = TYPE_TABLE[j];
      for (var k = 0; k < row[0].length; k++) {
        if (row[0][k] === ext) return { label: row[1], color: row[2] };
      }
    }
    return { label: '·', color: '#868e96' };
  }
  function badgeStyle(type) {
    return {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 16, height: 16, borderRadius: 3, flexShrink: 0,
      fontSize: 8, fontWeight: 700, lineHeight: '16px', color: '#fff',
      background: type.color, letterSpacing: '-.2px'
    };
  }
  function TypeBadge(props) {
    var type = typeBadge(props.name);
    if (!type) return React.createElement(CodeHashIcon);
    return React.createElement('span', { style: badgeStyle(type), 'aria-hidden': true }, type.label);
  }
  function RevealIcon() {
    return React.createElement('svg', { viewBox: '0 0 16 16', width: 12, height: 12, style: { display: 'block' }, 'aria-hidden': true },
      React.createElement('path', { fill: 'currentColor',
        d: 'M5.5 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5.5 14h5a1.5 1.5 0 0 0 1.5-1.5v-7L9.5 2h-4zm4 1.5V6H11L9.5 3.5zM5.5 3.5H8v3h3v5h-5.5v-8z' }));
  }

  // ---- Codex-style subsequence matching ----
  function isSep(ch) {
    return ch === '/' || ch === '\\' || ch === '-' || ch === '_' || ch === '.' || ch === ' ';
  }
  /** Score how well `q` appears as an ordered subsequence of `t` (-1 = no). */
  function subseqScore(q, t) {
    var qi = 0, score = 0, last = -2;
    for (var ti = 0; ti < t.length && qi < q.length; ti++) {
      if (q.charCodeAt(qi) === t.charCodeAt(ti)) {
        score += 1;
        if (ti === last + 1) score += 3;           // contiguous run bonus
        if (ti === 0 || isSep(t.charAt(ti - 1))) score += 2; // boundary bonus
        last = ti;
        qi += 1;
      }
    }
    return qi === q.length ? score : -1;
  }
  /** All terms must be subsequences; basename hits dominate path hits. */
  function matchScore(fileLower, terms) {
    var slash = fileLower.lastIndexOf('/');
    var name = slash === -1 ? fileLower : fileLower.slice(slash + 1);
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var s = subseqScore(term, name);
      if (s >= 0) total += 1000 + s * 10;
      else {
        var p = subseqScore(term, fileLower);
        if (p < 0) return -1;
        total += 100 + p;
      }
    }
    return total;
  }

  // ---- styling ----
  var S = {
    input: {
      width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12,
      borderRadius: 6,
      color: 'var(--dsw-alias-label-primary, #ddd)',
      background: 'var(--dsw-specific-sidebar-fill, #1e1e1e)',
      border: '1px solid var(--dsw-alias-border-l2, #333)',
      outline: 'none'
    },
    list: {
      position: 'static', marginTop: 4, maxHeight: 400, overflowY: 'auto',
      borderRadius: 6,
      background: 'var(--dsw-specific-sidebar-fill, #1e1e1e)',
      border: '1px solid var(--dsw-alias-border-l2, #333)'
    },
    row: {
      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
      cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-primary, #ddd)',
      whiteSpace: 'nowrap'
    },
    name: { overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 },
    dir: {
      overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, maxWidth: '55%',
      color: 'var(--dsw-alias-label-secondary, #999)', fontSize: 11
    },
    hint: {
      padding: '8px', fontSize: 11, color: 'var(--dsw-alias-label-secondary, #999)', textAlign: 'center'
    },
    iconBtn: {
      border: 'none', background: 'transparent', cursor: 'pointer', padding: 2,
      borderRadius: 4, color: 'var(--dsw-alias-label-secondary, #999)',
      display: 'inline-flex', alignItems: 'center', flexShrink: 0
    }
  };

  function baseName(path) {
    var at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return at === -1 ? path : path.slice(at + 1);
  }
  function parentDir(path) {
    var at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return at <= 0 ? '' : path.slice(0, at);
  }
  // ---- the search bar rendered inside the built-in explorer tab ----
  function SearchBar(props) {
    var sessionId = props.sessionId;
    var rootEl = props.rootEl; // the explorer container (mount's parent)
    var [query, setQuery] = React.useState('');
    var [files, setFiles] = React.useState(null);
    var [status, setStatus] = React.useState('idle'); // idle | loading | ready | error
    var [errMsg, setErrMsg] = React.useState('');

    React.useEffect(function () {
      dbg('SearchBar mounted, sessionId=', JSON.stringify(sessionId));
      // reset when the session/workspace changes
      setQuery('');
      setFiles(null);
      setStatus('idle');
    }, [sessionId]);

    var queryTrim = (query || '').trim().toLowerCase();

    // While typing, hide the built-in tree so the results render in its place.
    React.useEffect(function () {
      var body = rootEl ? rootEl.querySelector('[class*="explorerBody"]') : null;
      if (body) body.style.display = queryTrim ? 'none' : '';
      return function () { if (body) body.style.display = ''; };
    }, [queryTrim, rootEl]);

    // Match the result list height to the sidebar's available space.
    // v1.0.3: also track the tree panel itself (ResizeObserver) — better-sidebar
    // 0.14 resizes the panel on tab drags / bottom-panel open-close without a
    // window resize, so window-resize-only tracking left the list stuck.
    var wrapRef = React.useRef(null);
    var [maxH, setMaxH] = React.useState(400);
    React.useEffect(function () {
      var lastH = 0;
      function measure() {
        var el = wrapRef.current;
        if (!el) return;
        var rect = el.getBoundingClientRect();
        var next = Math.max(160, Math.floor(window.innerHeight - rect.top - 12));
        if (next !== lastH) { lastH = next; setMaxH(next); }
      }
      measure();
      window.addEventListener('resize', measure);
      var ro = null;
      if (rootEl && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(function () { measure(); });
        ro.observe(rootEl);
        if (rootEl.parentElement) ro.observe(rootEl.parentElement);
      }
      return function () {
        window.removeEventListener('resize', measure);
        if (ro) ro.disconnect();
      };
    }, [queryTrim, rootEl]);

    function ensureIndex() {
      if (!sessionId) { dbg('ensureIndex: skipped (no sessionId)'); return; }
      if (status !== 'idle' && status !== 'error') return;
      dbg('ensureIndex: fetching index for session', sessionId);
      setStatus('loading');
      fetch('/dsh-sidebar-enhancement-search/index?sessionId=' + encodeURIComponent(sessionId))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && Array.isArray(data.files)) {
            dbg('index loaded:', data.files.length, 'files; first:', data.files.slice(0, 3));
            setFiles(data.files); setStatus('ready');
          } else {
            dbg('index response invalid:', JSON.stringify(data).slice(0, 200));
            setStatus('error'); setErrMsg((data && data.error) || 'empty response');
          }
        })
        .catch(function (e) { dbg('index fetch error:', e); setStatus('error'); setErrMsg(String((e && e.message) || e)); });
    }

    var queryTrim = (query || '').trim().toLowerCase();
    var terms = queryTrim ? queryTrim.split(/\s+/) : [];
    var filtered = [];
    if (terms.length > 0 && files) {
      var scored = [];
      for (var i = 0; i < files.length; i++) {
        var s = matchScore(files[i].toLowerCase(), terms);
        if (s >= 0) scored.push([files[i], s]);
      }
      scored.sort(function (a, b) { return b[1] - a[1]; });
      filtered = scored.slice(0, 100).map(function (p) { return p[0]; });
    }

    function openFile(path) {
      if (sidebarService && sessionId) {
        try {
          sidebarService.openFile({ sessionId: sessionId }, path, baseName(path));
          return;
        } catch (e) {}
      }
    }
    function reveal(path) {
      fetch('/dsh-sidebar-enhancement-search/reveal?sessionId=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(path)).catch(function () {});
    }

    var list = null;
    if (terms.length > 0) {
      if (status === 'loading') list = React.createElement('div', { style: S.hint }, '正在建立索引…');
      else if (status === 'error') list = React.createElement('div', { style: S.hint }, '索引失败：' + errMsg);
      else if (filtered.length === 0) list = React.createElement('div', { style: S.hint }, '没有匹配的文件');
      else {
        var rows = [];
        for (var j = 0; j < filtered.length; j++) {
          let p = filtered[j];
          rows.push(React.createElement('div', {
            key: 'f' + j,
            style: Object.assign({}, S.row, { background: 'transparent' }),
            onMouseEnter: function (e) { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.15))'; },
            onMouseLeave: function (e) { e.currentTarget.style.background = 'transparent'; },
            onClick: function () { openFile(p); },
            title: p
          },
            React.createElement(TypeBadge, { name: p }),
            React.createElement('span', { style: S.name }, baseName(p)),
            React.createElement('span', { style: S.dir }, parentDir(p)),
            React.createElement('button', {
              type: 'button', style: S.iconBtn, title: '在文件夹中显示',
              'aria-label': '在文件夹中显示',
              onClick: function (e) { e.stopPropagation(); reveal(p); }
            }, React.createElement(RevealIcon))
          ));
        }
        list = React.createElement('div', { style: Object.assign({}, S.list, { maxHeight: maxH }) }, rows);
      }
    }

    return React.createElement('div', { ref: wrapRef },
      React.createElement('input', {
        type: 'text',
        placeholder: '筛选文件…',
        value: query,
        style: S.input,
        onFocus: function () { ensureIndex(); },
        onChange: function (e) { ensureIndex(); setQuery(e.target.value); },
        onKeyDown: function (e) {
          if (e.key === 'Enter' && filtered.length > 0) openFile(filtered[0]);
          if (e.key === 'Escape') setQuery('');
        }
      }),
      list
    );
  }

  // ---- error boundary: a render error must never make the search bar vanish ----
  class SearchBarBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { error: null };
    }
    componentDidCatch(error) {
      dbg('SearchBar render error:', error && error.stack || error);
      this.setState({ error: String((error && error.message) || error) });
    }
    render() {
      if (this.state.error) {
        return React.createElement('div', { style: { padding: '0 10px 6px' } },
          React.createElement('input', {
            type: 'text',
            value: '筛选出错，见控制台',
            readOnly: true,
            style: S.input
          }),
          React.createElement('div', { style: S.hint }, this.state.error)
        );
      }
      return this.props.children;
    }
  }

  // ---- the augmenter: renders SearchBar into the built-in explorer tab ----
  function ExplorerAugment() {
    var [st, setLocal] = React.useState(storeRef.state);
    var [mountNode, setMountNode] = React.useState(null);
    React.useEffect(function () {
      return subscribeStore(function (s) { setLocal(s); });
    }, []);

    React.useEffect(function () {
      if (!st.active) {
        cleanupMounts();
        setMountNode(null);
        return;
      }
      var attempts = 0;
      var timer = null;
      function tryLocate() {
        attempts += 1;
        var node = null;
        try { node = locateMount(); } catch (e) { dbg('locateMount error:', e); }
        if (node) {
          setMountNode(node);
          try { applyTreeBadges(); } catch (e) { dbg('applyTreeBadges error:', e); }
          return;
        }
        if (attempts < 6) timer = window.setTimeout(tryLocate, 250);
      }
      timer = window.setTimeout(tryLocate, 60);
      return function () { window.clearTimeout(timer); };
    }, [st.active, st.sessionId, st.mountTick]);

    // Self-healing: if better-sidebar's React re-render removes our injected
    // mount node, re-insert it (badges are refreshed by the global pass).
    React.useEffect(function () {
      if (!st.active || !mountNode) return;
      var parent = mountNode.parentElement;
      if (!parent) return;
      var mo = new MutationObserver(function () {
        if (mountNode && !mountNode.isConnected) {
          dbg('mount node was removed by re-render; re-inserting');
          var fresh = null;
          try { fresh = locateMount(); } catch (e) { fresh = null; }
          if (fresh) {
            setMountNode(fresh);
            try { applyTreeBadges(); } catch (e) {}
          }
        }
      });
      mo.observe(parent, { childList: true });
      return function () { mo.disconnect(); };
    }, [st.active, mountNode]);

    if (!st.active || !mountNode) return null;
    return ReactDOM.createPortal(
      React.createElement(SearchBarBoundary, null,
        React.createElement(SearchBar, {
          sessionId: st.sessionId,
          rootEl: mountNode.parentElement
        })
      ),
      mountNode
    );
  }

  var apply = function (ctx) {
    dbg('client loaded (v1.0.4)');
    var bs = ctx.get('betterSidebar');
    if (!bs) { dbg('apply: betterSidebar service not available'); return; }
    sidebarService = bs;
    injectStyles();
    var disposers = [];
    var recomputeFn = function () {
      recompute(bs);
      scheduleBadgeApply(); // store changes drive badge/mount refresh too
    };
    disposers.push(bs.subscribeState(recomputeFn));
    recomputeFn();
    // the augmenter must be mounted to react to store changes; register it via
    // the shell.overlay layer (renders null while the explorer is inactive).
    var slots = ctx.get('slots');
    if (slots) {
      var reg = slots.inject('shell.overlay', function () {
        return slots.register({
          name: 'shell.overlay',
          id: 'dsh-sidebar-enhancement-search',
          order: 4,
          label: '文件筛选',
          registrant: 'dsh-sidebar-enhancement-search'
        }, ExplorerAugment);
      });
      if (reg) disposers.push(reg);
    }
    startTabBadges();
    startHeartbeat();
    return function () {
      cleanupMounts();
      stopTabBadges();
      removeStyles();
      for (var i = 0; i < disposers.length; i++) {
        try { disposers[i](); } catch (e) {}
      }
    };
  };

  module.exports = { apply: apply, inject: ['betterSidebar'] };
  // The browser ModuleLoader materializes a bundle as factory(require)'s RETURN
  // value; without this explicit return the plugin is undefined.
  return module.exports;
}});
