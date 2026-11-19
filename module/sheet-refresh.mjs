/** PROJECT GENESIS 1.6.1: live updates for open ActorSheetV2 instances.
 * Presentation only: never mutates game documents or changes colony progress.
 */
const openSheets = new Set();
const refreshTimers = new WeakMap();
const selectors = [
  '.genesis-workspace-body',
  '.genesis-tech-viewport',
  '.genesis-subtree-viewport',
  '.genesis-tech-inspector',
  '.genesis-sidebar-shell',
  '.genesis-library-reader',
  '.genesis-tablewrap'
];

export function captureGenesisScroll(root) {
  if (!root?.querySelectorAll) return [];
  return selectors.map(selector => ({
    selector,
    positions: [...root.querySelectorAll(selector)].map(el => [el.scrollLeft, el.scrollTop])
  }));
}

export function restoreGenesisScroll(root, snapshot) {
  if (!root?.querySelectorAll || !Array.isArray(snapshot)) return;
  for (const {selector, positions} of snapshot) {
    [...root.querySelectorAll(selector)].forEach((el, index) => {
      if (!positions[index]) return;
      [el.scrollLeft, el.scrollTop] = positions[index];
    });
  }
}

export function trackGenesisSheet(sheet) {openSheets.add(sheet);}
export function untrackGenesisSheet(sheet) {
  openSheets.delete(sheet);
  const timer = refreshTimers.get(sheet);
  if (timer) clearTimeout(timer);
  refreshTimers.delete(sheet);
}

export function queueGenesisSheetRefresh(sheet) {
  if (!sheet?.element?.isConnected || refreshTimers.has(sheet) || sheet._genesisWaitingForBlur) return;
  const timer = setTimeout(async () => {
    refreshTimers.delete(sheet);
    const root = sheet.element;
    if (!root?.isConnected) return;
    const focused = globalThis.document?.activeElement;
    // Preserve active inputs; refresh when the editor finishes entering a value.
    if (focused && root.contains(focused) && focused.matches?.('input, textarea, select, [contenteditable="true"]')) {
      sheet._genesisWaitingForBlur = true;
      focused.addEventListener('blur', () => {
        sheet._genesisWaitingForBlur = false;
        queueGenesisSheetRefresh(sheet);
      }, {once:true});
      return;
    }
    sheet._genesisPendingScroll = captureGenesisScroll(root);
    try {await sheet.render(true);}
    catch (error) {console.warn('PROJECT GENESIS: live sheet refresh failed', error);}
  }, 80);
  refreshTimers.set(sheet, timer);
}

let initialized = false;
export function initializeSheetLiveUpdates() {
  if (initialized) return;
  initialized = true;
  const scheduleAll = () => {
    for (const sheet of openSheets) {
      if (!sheet?.element?.isConnected) {untrackGenesisSheet(sheet); continue;}
      queueGenesisSheetRefresh(sheet);
    }
  };
  for (const event of ['createActor','updateActor','deleteActor','createItem','updateItem','deleteItem'])
    Hooks.on?.(event, scheduleAll);
  for (const event of ['createTile','updateTile','deleteTile'])
    Hooks.on?.(event, doc => {
      if (doc?.flags?.['project-genesis']?.buildingId || doc?.flags?.['project-genesis']?.networkId)
        scheduleAll();
    });
  Hooks.on?.('updateScene', (_scene, changes) => {
    if (changes?.flags?.['project-genesis'] || changes?.tiles) scheduleAll();
  });
  Hooks.on?.('updateSetting', setting => {
    if (['project-genesis.worldDay','project-genesis.logisticsJournal'].includes(setting?.key))
      scheduleAll();
  });
}
