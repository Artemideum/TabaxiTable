(() => {
  "use strict";

  const SIDES = [4,6,8,10,12,20,100];
  const STORAGE_KEY = "tt-dice-tray";
  const MAX_DICE = 24;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      const counts = Object.fromEntries(SIDES.map(sides => [sides, Math.max(0,Math.min(MAX_DICE,Number(saved?.counts?.[sides]) || 0))]));
      if (!Object.values(counts).some(Boolean)) counts[20] = 1;
      return {
        counts,
        modifier:Math.max(-999,Math.min(999,Number(saved?.modifier) || 0)),
        visibility:saved?.visibility === "private" ? "private" : "public"
      };
    } catch {
      return { counts:Object.fromEntries(SIDES.map(sides => [sides,sides === 20 ? 1 : 0])), modifier:0, visibility:"public" };
    }
  }

  const state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function dieCost(sides) { return Number(sides) === 100 ? 2 : 1; }

  function totalCount() {
    return SIDES.reduce((sum,sides) => sum + Number(state.counts[sides] || 0) * dieCost(sides),0);
  }

  function setCount(sides, count) {
    sides = Number(sides);
    if (!SIDES.includes(sides)) return;
    const cost = dieCost(sides);
    const currentWithout = totalCount() - Number(state.counts[sides] || 0) * cost;
    const maximum = Math.max(0,Math.floor((MAX_DICE-currentWithout)/cost));
    state.counts[sides] = Math.max(0,Math.min(maximum,Number(count) || 0));
    save();
  }

  function add(sides, delta = 1) {
    setCount(sides, Number(state.counts[Number(sides)] || 0) + Number(delta || 0));
  }

  function setModifier(value) {
    state.modifier = Math.max(-999,Math.min(999,Number(value) || 0));
    save();
  }

  function setVisibility(value) {
    state.visibility = value === "private" ? "private" : "public";
    save();
  }

  function clear() {
    SIDES.forEach(sides => { state.counts[sides] = 0; });
    state.modifier = 0;
    save();
  }

  function reset() {
    clear();
    state.counts[20] = 1;
    save();
  }

  function selection() {
    return SIDES.map(sides => ({ sides, count:Number(state.counts[sides] || 0) })).filter(entry => entry.count > 0);
  }

  function formula() {
    const parts = selection().map(entry => `${entry.count > 1 ? `${entry.count}к` : `к`}${entry.sides}`);
    if (state.modifier) parts.push(`${state.modifier > 0 ? "+" : "−"}${Math.abs(state.modifier)}`);
    return parts.join(" ") || "Добавь кубики";
  }

  function apply(selection, modifier = 0, visibility = state.visibility) {
    SIDES.forEach(sides => { state.counts[sides] = 0; });
    (Array.isArray(selection) ? selection : []).forEach(entry => setCount(entry.sides,entry.count));
    state.modifier = Math.max(-999,Math.min(999,Number(modifier) || 0));
    state.visibility = visibility === "private" ? "private" : "public";
    save();
  }

  window.TT_DICE_TRAY = { SIDES, MAX_DICE, state, add, setCount, setModifier, setVisibility, clear, reset, selection, formula, totalCount, apply };
})();
