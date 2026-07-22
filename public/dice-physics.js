(() => {
  "use strict";

  const DISPLAY_MS = 9000;
  const FALLBACK_MS = 4500;
  const QUALITY_KEY = "tt-dice-quality";
  const MATERIAL_KEY = "tt-dice-material";
  const QUALITY = {
    low:{ maxSlots:2, prewarm:1, shadows:false, baseScale:72, iterationLimit:700, gravity:430 },
    medium:{ maxSlots:4, prewarm:2, shadows:true, baseScale:88, iterationLimit:1100, gravity:470 },
    high:{ maxSlots:5, prewarm:2, shadows:true, baseScale:96, iterationLimit:1700, gravity:500 }
  };
  let quality = ["low","medium","high"].includes(localStorage.getItem(QUALITY_KEY)) ? localStorage.getItem(QUALITY_KEY) : "medium";
  let material = ["none","metal","wood","glass"].includes(localStorage.getItem(MATERIAL_KEY)) ? localStorage.getItem(MATERIAL_KEY) : "none";
  const PLAYED_MEMORY_MS = 60000;
  const PREWARM_START_MS = 700;

  let modulePromise = null;
  let unavailable = false;
  let active = false;
  let slotSequence = 0;
  let warming = false;
  let lastRecoveryAt = 0;
  let lastError = "";
  const slots = [];
  const playedRolls = new Map();
  const playingRolls = new Map();

  function ensureLayer() {
    let layer = document.querySelector("#vtt-physical-dice-layer");
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = "vtt-physical-dice-layer";
    layer.className = "vtt-physical-dice-layer";
    layer.hidden = true;
    layer.innerHTML = '<div class="vtt-physical-dice-slots"></div><div class="vtt-physical-dice-results" aria-live="polite"></div>';
    document.body.appendChild(layer);
    return layer;
  }

  function shadeHex(hex, amount = 0) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#d3ad6e"));
    if (!match) return "#d3ad6e";
    const channels = match[1].match(/../g).map(part => parseInt(part,16));
    const blend = amount >= 0 ? 255 : 0;
    const factor = Math.min(1,Math.abs(amount));
    return `#${channels.map(channel => Math.round(channel + (blend-channel)*factor).toString(16).padStart(2,"0")).join("")}`;
  }

  function foregroundFor(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#d3ad6e"));
    if (!match) return "#171009";
    const [r,g,b] = match[1].match(/../g).map(part => parseInt(part,16));
    return (r*0.299 + g*0.587 + b*0.114) > 145 ? "#171009" : "#fff7e8";
  }


  function safeColor(color) {
    return /^#[0-9a-f]{6}$/i.test(String(color || "")) ? String(color) : "#d3ad6e";
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function promiseWithTimeout(promise, timeoutMs, label = "dice roll") {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out`)), Math.max(1000, Number(timeoutMs) || 1000));
      Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }


  function idleTask(task, timeout = 1800) {
    return new Promise(resolve => {
      const run = () => Promise.resolve().then(task).catch(error => console.warn("Не удалось прогреть 3D-кубики",error)).finally(resolve);
      if (typeof requestIdleCallback === "function") requestIdleCallback(run,{ timeout });
      else setTimeout(run,40);
    });
  }

  function notationFor(roll) {
    const sets = Array.isArray(roll?.sets) ? roll.sets : [];
    const terms = [];
    const forced = [];
    sets.forEach(set => {
      const sides = Number(set?.sides) || 20;
      const values = Array.isArray(set?.values) ? set.values.map(Number) : [];
      if (sides === 100) {
        values.forEach(value => {
          const safe = Math.max(1,Math.min(100,value || 1));
          const tens = safe === 100 ? 100 : Math.floor(safe/10)*10 || 100;
          const ones = safe % 10 || 10;
          terms.push("1d100","1d10");
          forced.push(tens,ones);
        });
        return;
      }
      if (!values.length) return;
      terms.push(`${values.length}d${sides}`);
      forced.push(...values);
    });
    if (!terms.length) return "1d20@1";
    return `${terms.join("+")}@${forced.join(",")}`;
  }

  function colorsetFor(color) {
    const base = /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : "#d3ad6e";
    return {
      name:`tabaxi-${base.slice(1)}`,
      category:"TabaxiTable",
      foreground:foregroundFor(base),
      background:[shadeHex(base,.18),base,shadeHex(base,-.18),shadeHex(base,.36)],
      outline:shadeHex(base,-.55),
      texture:"none",
      material
    };
  }

  function loadModule() {
    if (unavailable) return Promise.reject(new Error("3D-кубики недоступны"));
    if (!modulePromise) {
      modulePromise = import("/vendor/dice-box-threejs.es.js").catch(error => {
        modulePromise = null;
        console.error("Не удалось загрузить физические кубики", error);
        throw error;
      });
    }
    return modulePromise;
  }


  function slotContext(slot) {
    try { return slot?.box?.renderer?.getContext?.() || null; } catch { return null; }
  }

  function slotHealthy(slot) {
    if (!slot?.box || !slot.host?.isConnected) return false;
    const canvas = slot.host.querySelector("canvas");
    const context = slotContext(slot);
    return Boolean(canvas && context && !context.isContextLost?.());
  }

  function destroySlotBox(slot, forceContextLoss = true) {
    if (!slot || slot.destroying) return;
    slot.destroying = true;
    clearTimeout(slot.clearTimer);
    slot.clearTimer = null;
    const box = slot.box;
    try { box && (box.running = false, box.rolling = false); } catch {}
    try { box?.clearDice?.(); } catch {}
    try { box?.renderer?.dispose?.(); } catch {}
    if (forceContextLoss) {
      try { box?.renderer?.forceContextLoss?.(); } catch {}
      try { slotContext(slot)?.getExtension?.("WEBGL_lose_context")?.loseContext?.(); } catch {}
    }
    slot.host.replaceChildren();
    slot.box = null;
    slot.initPromise = null;
    slot.configuredColor = null;
    slot.busy = false;
    slot.rolling = false;
    slot.rollId = null;
    slot.startedAt = 0;
    queueMicrotask(() => { slot.destroying = false; });
  }

  function createSlot() {
    const root = ensureLayer();
    const slotsRoot = root.querySelector(".vtt-physical-dice-slots");
    const index = ++slotSequence;
    const host = document.createElement("div");
    host.id = `vtt-physical-dice-slot-${index}`;
    host.className = "vtt-physical-dice-slot";
    host.hidden = true;
    slotsRoot.appendChild(host);
    const slot = {
      index,
      host,
      box:null,
      initPromise:null,
      busy:false,
      rolling:false,
      rollId:null,
      startedAt:0,
      clearTimer:null,
      resultEl:null,
      configuredColor:null,
      destroying:false
    };
    slots.push(slot);
    return slot;
  }

  async function initializeSlot(slot, initialColor = "#d3ad6e") {
    if (slot.box && slotHealthy(slot)) return slot.box;
    if (slot.box && !slotHealthy(slot)) destroySlotBox(slot);
    if (slot.initPromise) return slot.initPromise;
    const color = safeColor(initialColor);
    slot.initPromise = (async () => {
      if (!window.WebGLRenderingContext) { unavailable = true; throw new Error("WebGL не поддерживается"); }
      slot.host.innerHTML = "";
      const module = await loadModule();
      const DiceBox = module.default;
      const box = new DiceBox(`#${slot.host.id}`, {
        assetPath:"/vendor/",
        sounds:false,
        shadows:QUALITY[quality].shadows,
        theme_surface:"green-felt",
        theme_customColorset:colorsetFor(color),
        theme_material:material,
        gravity_multiplier:QUALITY[quality].gravity,
        light_intensity:0.85,
        baseScale:QUALITY[quality].baseScale,
        strength:1.25,
        iterationLimit:QUALITY[quality].iterationLimit
      });
      await promiseWithTimeout(box.initialize(), 10000, "dice initialization");
      slot.box = box;
      slot.configuredColor = color;
      const canvas = slot.host.querySelector("canvas");
      canvas?.addEventListener("webglcontextlost", event => {
        event.preventDefault();
        if (slot.destroying) return;
        destroySlotBox(slot,false);
        slot.host.hidden = true;
        setTimeout(() => { void recover([color]); }, 120);
      }, { once:true });
      return box;
    })().catch(error => {
      slot.initPromise = null;
      throw error;
    });
    return slot.initPromise;
  }

  async function configureSlot(slot, color) {
    const desired = safeColor(color);
    const box = await initializeSlot(slot,desired);
    if (!slotHealthy(slot)) throw new Error("WebGL context unavailable");
    if (slot.configuredColor !== desired) {
      await promiseWithTimeout(box.updateConfig({ theme_customColorset:colorsetFor(desired), theme_material:material }), 6000, "dice colors");
      slot.configuredColor = desired;
    }
    return box;
  }

  async function recover(colors = []) {
    const now = Date.now();
    if (now - lastRecoveryAt < 350) return;
    lastRecoveryAt = now;
    unavailable = false;
    slots.filter(slot => !slot.busy && slot.box && !slotHealthy(slot)).forEach(slot => destroySlotBox(slot));
    if (!slots.some(slot => slotHealthy(slot))) {
      slots.forEach(slot => { if (!slot.busy) destroySlotBox(slot); });
    }
    await prewarm(colors);
  }

  async function prewarm(colors = []) {
    if (warming || unavailable) return;
    warming = true;
    const root = ensureLayer();
    const wasHidden = root.hidden;
    root.hidden = false;
    root.classList.add("is-prewarming");
    try {
      const palette = (Array.isArray(colors) ? colors : []).map(safeColor).filter(Boolean);
      if (!palette.length) palette.push("#d3ad6e");
      while (slots.length < QUALITY[quality].prewarm) createSlot();
      for (let index = 0; index < slots.length; index += 1) {
        const slot = slots[index];
        if (slot.box || slot.initPromise) continue;
        const color = palette[index % palette.length];
        slot.host.hidden = false;
        await idleTask(() => initializeSlot(slot,color));
        if (!slot.busy) slot.host.hidden = true;
      }
    } finally {
      root.classList.remove("is-prewarming");
      if (wasHidden && !active && !slots.some(slot => slot.busy)) root.hidden = true;
      warming = false;
    }
  }

  function removeResult(slot) {
    slot.resultEl?.remove();
    slot.resultEl = null;
  }

  function showResult(slot, roll, fallback = false) {
    const root = ensureLayer();
    const stack = root.querySelector(".vtt-physical-dice-results");
    removeResult(slot);
    const result = document.createElement("div");
    const details = (Array.isArray(roll?.sets) ? roll.sets : []).map(set => {
      const values = Array.isArray(set?.values) ? set.values.map(Number) : [];
      const prefix = values.length > 1 ? `${values.length}к${Number(set?.sides) || 20}` : `к${Number(set?.sides) || 20}`;
      return `${prefix}: [${values.join(", ")}]`;
    });
    if (Number(roll?.modifier)) details.push(`модификатор ${Number(roll.modifier) > 0 ? "+" : "−"}${Math.abs(Number(roll.modifier) || 0)}`);
    result.className = `vtt-physical-dice-result${fallback ? " is-fallback" : ""}${roll?.visibility === "private" ? " is-private" : ""}`;
    result.innerHTML = `<div><span>${roll?.visibility === "private" ? "🔒 " : ""}${roll.label || roll.formula || "Бросок"}</span><small>${details.join(" · ") || (roll.by || "Игрок")}</small></div><strong>${Number(roll.total)}</strong>`;
    stack.prepend(result);
    slot.resultEl = result;
    requestAnimationFrame(() => result.classList.add("is-visible"));
  }

  function releaseSlot(slot) {
    clearTimeout(slot.clearTimer);
    slot.clearTimer = null;
    try { slot.box?.clearDice?.(); } catch {}
    removeResult(slot);
    slot.host.hidden = true;
    slot.host.classList.remove("is-active");
    slot.busy = false;
    slot.rolling = false;
    slot.rollId = null;
    slot.startedAt = 0;
    const root = ensureLayer();
    if (!slots.some(entry => entry.busy)) root.classList.remove("is-active");
  }

  function scheduleRelease(slot, delay) {
    clearTimeout(slot.clearTimer);
    slot.clearTimer = setTimeout(() => releaseSlot(slot), Math.max(0,Number(delay) || 0));
  }

  function acquireSlot(color) {
    const desired = safeColor(color);
    let slot = slots.find(entry => !entry.busy && entry.box && entry.configuredColor === desired);
    if (!slot) slot = slots.find(entry => !entry.busy && !entry.box && !entry.initPromise);
    if (!slot) slot = slots.find(entry => !entry.busy);
    if (!slot && slots.length < QUALITY[quality].maxSlots) slot = createSlot();
    if (!slot) {
      slot = [...slots].sort((a,b) => a.startedAt - b.startedAt)[0];
      releaseSlot(slot);
    }
    slot.busy = true;
    slot.startedAt = Date.now();
    return slot;
  }

  function rememberPlayed(id) {
    const now = Date.now();
    playedRolls.set(id,now);
    for (const [rollId,at] of playedRolls) if (now-at > PLAYED_MEMORY_MS) playedRolls.delete(rollId);
  }

  async function runRoll(roll, attempt = 0) {
    const root = ensureLayer();
    root.hidden = false;
    root.classList.add("is-active");
    const slot = acquireSlot(roll.color);
    slot.rollId = roll.id;
    slot.host.hidden = false;
    slot.host.classList.add("is-active");
    try {
      await nextFrame();
      const box = await promiseWithTimeout(configureSlot(slot,roll.color), 11000, "dice slot");
      if (slot.rollId !== roll.id) return { ok:false, interrupted:true };
      await nextFrame();
      slot.rolling = true;
      await promiseWithTimeout(box.roll(notationFor(roll)), 15000, "physical dice");
      slot.rolling = false;
      if (slot.rollId !== roll.id) return { ok:false, interrupted:true };
      showResult(slot,roll,false);
      scheduleRelease(slot,DISPLAY_MS);
      return { ok:true, fallback:false };
    } catch (error) {
      lastError = String(error?.message || error || "Неизвестная ошибка");
      console.error("Не удалось воспроизвести физический бросок", error);
      if (slot.rollId !== roll.id) return { ok:false, interrupted:true };
      destroySlotBox(slot);
      slot.host.hidden = false;
      slot.busy = true;
      slot.rollId = roll.id;
      slot.rolling = false;
      if (attempt < 2 && !unavailable) {
        slot.host.hidden = true;
        slot.busy = false;
        slot.rollId = null;
        await new Promise(resolve => setTimeout(resolve,220 + attempt * 260));
        return runRoll(roll,attempt + 1);
      }
      slot.busy = true;
      slot.rollId = roll.id;
      showResult(slot,roll,true);
      scheduleRelease(slot,FALLBACK_MS);
      setTimeout(() => { void recover([roll.color]); }, 250);
      return { ok:false, fallback:true };
    }
  }

  function playOne(roll) {
    if (!roll?.id) return Promise.resolve({ ok:false, invalid:true });
    if (playingRolls.has(roll.id)) return playingRolls.get(roll.id);
    if (playedRolls.has(roll.id)) return Promise.resolve({ ok:true, duplicate:true });
    rememberPlayed(roll.id);
    const promise = runRoll(roll).finally(() => playingRolls.delete(roll.id));
    playingRolls.set(roll.id,promise);
    return promise;
  }

  function normalizeRolls(payload) {
    if (Array.isArray(payload)) return payload.filter(Boolean).sort((a,b) => Number(a.at || 0)-Number(b.at || 0));
    return payload ? [payload] : [];
  }

  function play(payload) {
    return Promise.all(normalizeRolls(payload).map(roll => playOne(roll)));
  }

  function activate(colors = []) {
    active = true;
    ensureLayer().hidden = false;
    void recover(colors);
  }

  function deactivate() {
    active = false;
    const root = ensureLayer();
    root.hidden = true;
    root.classList.remove("is-active");
    slots.forEach(releaseSlot);
  }

  function clear() {
    slots.forEach(releaseSlot);
  }

  function status() {
    return {
      quality,
      material,
      active,
      unavailable,
      slots:slots.length,
      healthy:slots.filter(slotHealthy).length,
      busy:slots.filter(slot => slot.busy).length,
      lastError
    };
  }

  async function setQuality(value) {
    const next = ["low","medium","high"].includes(value) ? value : "medium";
    if (next === quality) return status();
    quality = next;
    try { localStorage.setItem(QUALITY_KEY,quality); } catch {}
    slots.forEach(slot => destroySlotBox(slot));
    while (slots.length > QUALITY[quality].maxSlots) slots.pop()?.host?.remove();
    lastError = "";
    await recover();
    return status();
  }


  async function setMaterial(value) {
    const next = ["none","metal","wood","glass"].includes(value) ? value : "none";
    if (next === material) return status();
    material = next;
    try { localStorage.setItem(MATERIAL_KEY,material); } catch {}
    slots.forEach(slot => destroySlotBox(slot));
    lastError = "";
    await recover();
    return status();
  }

  window.TT_DICE_PHYSICS = { play, activate, deactivate, clear, prewarm, recover, status, setQuality, setMaterial, displayMs:DISPLAY_MS };
  setTimeout(() => { void loadModule().catch(() => {}); },PREWARM_START_MS);
  window.addEventListener("pageshow", () => { if (active) void recover(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && active) void recover(); });
  setInterval(() => {
    if (!active) return;
    const broken = slots.some(slot => slot.box && !slotHealthy(slot));
    if (broken || !slots.some(slot => slotHealthy(slot))) void recover();
  }, 12000);
})();
