const socket = io();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
}

const state = {
  room: null,
  clientId: localStorage.getItem("tt-client-id") || uuid(),
  selectedId: null,
  saveTimer: null,
  sheetBindController: null,
  rollPeekTimer: null,
  rollMode: "normal",
  lastCriticalAttackId: null,
  sheetTab: "main",
  resuming: false
};
const rules = window.TT_RULES;
let spellCatalog = null;
localStorage.setItem("tt-client-id", state.clientId);

const abilities = {
  str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма"
};
const skills = [
  ["acrobatics", "Акробатика", "dex"], ["animal", "Уход за животными", "wis"], ["arcana", "Магия", "int"],
  ["athletics", "Атлетика", "str"], ["deception", "Обман", "cha"], ["history", "История", "int"],
  ["insight", "Проницательность", "wis"], ["intimidation", "Запугивание", "cha"], ["investigation", "Анализ", "int"],
  ["medicine", "Медицина", "wis"], ["nature", "Природа", "int"], ["perception", "Восприятие", "wis"],
  ["performance", "Выступление", "cha"], ["persuasion", "Убеждение", "cha"], ["religion", "Религия", "int"],
  ["sleight", "Ловкость рук", "dex"], ["stealth", "Скрытность", "dex"], ["survival", "Выживание", "wis"]
];
const conditionNames = ["Ослеплён", "Очарован", "Оглушён", "Отравлен", "Испуган", "Схвачен", "Недееспособен", "Невидим", "Парализован", "Окаменел", "Сбит с ног", "Опутан", "Без сознания", "Истощён"];

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}
function modifier(score) { return Math.floor((Number(score || 10) - 10) / 2); }
function signed(number) { return Number(number) >= 0 ? `+${number}` : String(number); }
function classEntries(sheet) {
  if (Array.isArray(sheet.classes) && sheet.classes.length) return sheet.classes;
  if (!sheet.classKey) return [];
  const cls = rules.classes[sheet.classKey];
  return [{ key:sheet.classKey, name:sheet.className || cls?.name || sheet.classKey, subclass:sheet.subclass || "", level:Math.max(1, Number(sheet.level) || 1), hitDie:Number(sheet.hitDieSize || cls?.hitDie || 8), spellAbility:sheet.spellcastingAbility || cls?.spellAbility || "" }];
}
function totalLevel(sheet) { return Math.max(1, classEntries(sheet).reduce((sum, entry) => sum + Number(entry.level || 0), 0) || Number(sheet.level) || 1); }
function classLevel(sheet, classKey) { return Number(classEntries(sheet).find(entry => entry.key === classKey)?.level || 0); }
function hasClass(sheet, classKey) { return classLevel(sheet, classKey) > 0; }
function featKey(feat) { return typeof feat === "string" ? feat : feat?.key; }
function hasFeat(sheet, key) { return (sheet.feats || []).some(feat => featKey(feat) === key); }
function passiveBonus(sheet, key) { return hasFeat(sheet, "observant") && ["perception","investigation"].includes(key) ? 5 : 0; }
function effectiveProficiency(sheet) { return sheet.autoProficiency ? rules.proficiency(totalLevel(sheet)) : Number(sheet.proficiency || 0); }
function initiativeBonus(sheet) { return modifier(sheet.stats.dex) + Number(sheet.initiativeBonus || 0) + (hasFeat(sheet, "alert") ? 5 : 0); }
const classSymbols = { barbarian:"◈", bard:"♫", cleric:"✚", druid:"❧", fighter:"⚔", monk:"☯", paladin:"✦", ranger:"➹", sorcerer:"✧", warlock:"⌁" };
function classGlyph(classKey, title = "") {
  const safeKey = rules.classes[classKey] ? classKey : "unknown";
  return `<span class="class-glyph" data-class="${safeKey}" title="${esc(title || rules.classes[classKey]?.name || "Класс")}">${esc(classSymbols[classKey] || "")}</span>`;
}
function classSummary(sheet) {
  const entries = classEntries(sheet);
  if (!entries.length) return "Класс не выбран";
  return entries.map(entry => `${entry.name || rules.classes[entry.key]?.name || entry.key}${entry.subclass ? ` — ${entry.subclass}` : ""} ${Number(entry.level)}`).join(" / ");
}
function levelProgression(sheet) {
  const entries = classEntries(sheet);
  if (!entries.length) return [];
  if (Array.isArray(sheet.levelProgression) && sheet.levelProgression.length === totalLevel(sheet)) return sheet.levelProgression;
  return entries.flatMap(entry => Array.from({ length:Number(entry.level) || 0 }, (_, index) => ({ classKey:entry.key, classLevel:index + 1 }))).map((entry, index) => ({ ...entry, level:index + 1 }));
}
function progressionMarkup(sheet) {
  const progression = levelProgression(sheet);
  if (!progression.length) return "";
  return `<details class="level-path"><summary><div class="level-path-head"><span>Путь героя</span><strong>${esc(classSummary(sheet))}</strong></div><div class="level-path-peek">${progression.slice(-3).map(entry => `${classGlyph(entry.classKey)}<small>${Number(entry.level)}</small>`).join("")}<b>показать</b></div></summary><div class="level-tokens">${progression.map(entry => {
    const name = rules.classes[entry.classKey]?.name || entry.classKey;
    return `<button class="level-token" type="button" data-level-info="${Number(entry.level)}" title="Что получено на ${Number(entry.level)} уровне: ${esc(name)} ${Number(entry.classLevel)}">${classGlyph(entry.classKey)}<small>${Number(entry.level)}</small></button>`;
  }).join("")}${totalLevel(sheet) < 20 ? `<button id="level-up-track" class="level-token next" type="button" title="Повысить уровень"><span>+</span><small>${totalLevel(sheet) + 1}</small></button>` : ""}</div></details>`;
}
function experienceMarkup(sheet, mine) {
  const progress = rules.xpProgress(sheet.xp, totalLevel(sheet));
  const levelByXpNote = progress.xpLevel !== totalLevel(sheet) ? `<span class="xp-milestone">Уровень по вехам · по XP: ${progress.xpLevel}</span>` : "";
  return `<section class="xp-track" ${mine ? "role=button tabindex=0 title=\"Добавить или изменить опыт\"" : ""}>
    <div class="xp-head"><span><b>Опыт</b>${levelByXpNote}</span><strong>${progress.xp.toLocaleString("ru-RU")}${totalLevel(sheet) >= 20 ? " · максимум" : ` / ${progress.next.toLocaleString("ru-RU")}`}</strong></div>
    <div class="xp-bar"><i style="width:${Math.round(progress.value * 100)}%"></i></div>
    <div class="xp-foot"><span>${totalLevel(sheet)} уровень</span><span>${totalLevel(sheet) >= 20 ? "Легенда" : `ещё ${progress.remaining.toLocaleString("ru-RU")} XP до ${totalLevel(sheet) + 1}`}</span></div>
  </section>`;
}
function classHighlightsMarkup(sheet) {
  const cards = classEntries(sheet).flatMap(entry => rules.classHighlights(entry.key, entry.level, sheet).map(item => ({ ...item, classKey:entry.key })));
  if (!cards.length) return "";
  return `<section class="class-highlights">${cards.map(item => `<button type="button" class="class-highlight ${item.accent ? "accent" : ""}" ${item.formula ? `data-class-damage="${esc(item.formula)}" title="Нажми, чтобы бросить"` : "disabled"}>${classGlyph(item.classKey)}<span><small>${esc(item.label)}</small><strong>${esc(item.value)}</strong></span>${item.formula ? "<i>бросить</i>" : ""}</button>`).join("")}</section>`;
}
function levelFeaturesMarkup(classKey, classLevel) {
  return rules.featuresAt(classKey, classLevel).map(feature => `<article class="level-gain ${feature.choice ? "choice" : ""}"><span>${feature.choice ? "?" : "✓"}</span><div><strong>${esc(feature.name)}</strong><p>${esc(feature.summary)}</p></div>${feature.choice ? "<b>нужен выбор</b>" : ""}</article>`).join("");
}
function commonLevelFeaturesMarkup(level) {
  const items = [];
  if ([5,9,13,17].includes(Number(level))) items.push({ name:`Бонус мастерства ${signed(rules.proficiency(level))}`, summary:"Автоматически улучшает атаки с владением, навыки, спасброски и сложность многих умений." });
  if ([5,11,17].includes(Number(level))) items.push({ name:"Усиление заговоров", summary:"Большинство атакующих заговоров получает дополнительную кость урона по общему уровню персонажа." });
  return items.map(feature => `<article class="level-gain common"><span>★</span><div><strong>${esc(feature.name)}</strong><p>${esc(feature.summary)}</p></div></article>`).join("");
}
function mergeText(current, addition) {
  if (!addition || addition === "Нет") return current || "";
  if (String(current || "").includes(addition)) return current;
  return [current, addition].filter(Boolean).join("; ");
}
function syncCharacterMechanics(sheet) {
  sheet.classes = classEntries(sheet).map(entry => {
    const cls = rules.classes[entry.key];
    return { ...entry, name:entry.name || cls?.name || entry.key, subclass:entry.subclass || "", level:Math.max(1, Number(entry.level) || 1), hitDie:Number(entry.hitDie || cls?.hitDie || 8), spellAbility:entry.spellAbility || cls?.spellAbility || "" };
  });
  sheet.level = totalLevel(sheet);
  sheet.levelProgression = levelProgression(sheet).map((entry, index) => ({ ...entry, level:index + 1 }));
  const primary = sheet.classes[0];
  if (primary) {
    sheet.classKey = primary.key; sheet.className = primary.name; sheet.subclass = primary.subclass || ""; sheet.subclassKey = primary.subclass || "";
    sheet.hitDieSize = primary.hitDie; sheet.spellcastingAbility ||= primary.spellAbility || "";
  }
  sheet.hitDicePools = rules.hitDicePoolsFor(sheet.classes, sheet.hitDicePools || []);
  sheet.hitDiceMax = sheet.hitDicePools.reduce((sum, pool) => sum + Number(pool.total), 0);
  sheet.hitDiceCurrent = sheet.hitDicePools.reduce((sum, pool) => sum + Number(pool.current), 0);
  if (sheet.autoProficiency) sheet.proficiency = rules.proficiency(sheet.level);
  if (sheet.autoSpellSlots) {
    const magic = rules.multiclassSpellcasting(sheet.classes);
    sheet.spellSlots = Array.from({length:9}, (_, index) => {
      const old = (sheet.spellSlots || []).find(slot => Number(slot.level) === index + 1);
      const total = Number(magic.slots[index] || 0);
      return { level:index + 1, total, used:Math.min(total, Number(old?.used || 0)) };
    });
    const oldPact = sheet.pactSlots || {};
    sheet.pactSlots = { ...magic.pact, used:Math.min(Number(magic.pact.total || 0), Number(oldPact.used || 0)) };
  }
  sheet.resources = Array.isArray(sheet.resources) ? sheet.resources : [];
  sheet.classes.forEach(entry => {
    const cls = rules.classes[entry.key];
    (cls?.resources?.(entry.level, { ...sheet, level:entry.level }) || []).forEach(source => {
      const automaticKey = `${entry.key}:${source.name}`;
      const existing = sheet.resources.find(resource => resource.automaticKey === automaticKey || (resource.automatic && resource.name === source.name));
      if (existing) {
        const spent = Math.max(0, Number(existing.max || 0) - Number(existing.current || 0));
        Object.assign(existing, source, { automatic:true, automaticKey, current:Math.max(0, Number(source.max) - spent) });
      } else sheet.resources.push({ id:uuid(), ...source, current:source.max, automatic:true, automaticKey });
    });
  });
  sheet.xp = Math.max(0, Number(sheet.xp) || 0);
  sheet.schemaVersion = 5;
  if (sheet.autoArmorClass) sheet.ac = calculateAc(sheet);
  return sheet;
}
function calculateAc(sheet) {
  if (!sheet.autoArmorClass) return Number(sheet.ac || 10);
  const equipped = (sheet.inventoryList || []).filter(item => item.equipped && item.type === "armor");
  const body = equipped.filter(item => item.armorType !== "shield").sort((a,b) => Number(b.baseAc||0)-Number(a.baseAc||0))[0];
  const shields = equipped.filter(item => item.armorType === "shield").length;
  const dex = modifier(sheet.stats.dex);
  let ac = 10 + dex;
  if (!body && hasClass(sheet, "barbarian")) ac = 10 + dex + modifier(sheet.stats.con);
  if (!body && hasClass(sheet, "monk") && !shields) ac = 10 + dex + modifier(sheet.stats.wis);
  if (body?.armorType === "light") ac = Number(body.baseAc) + dex;
  else if (body?.armorType === "medium") ac = Number(body.baseAc) + Math.min(2, dex);
  else if (body?.armorType === "heavy") ac = Number(body.baseAc);
  return ac + Math.min(1, shields) * 2;
}
function preparedSpellLimit(sheet) {
  if (!sheet.spellcastingAbility) return null;
  const primaryCaster = classEntries(sheet).find(entry => rules.classes[entry.key]?.spellAbility === sheet.spellcastingAbility) || classEntries(sheet)[0];
  return rules.preparedLimit(primaryCaster?.key, primaryCaster?.level, modifier(sheet.stats[sheet.spellcastingAbility]));
}
function criticalFormula(formula) {
  return String(formula || "").replace(/(\d*)[dк](\d+)/gi, (_, count, sides) => `${(Number(count || 1) * 2)}к${sides}`);
}
const spellUpcastDice = {
  "burning-hands":"1d6", "cure-wounds":"1d8", "healing-word":"1d4", "magic-missile":"1d4+1", sleep:"2d8", thunderwave:"1d8",
  moonbeam:"1d10", "scorching-ray":"2d6", fireball:"1d6", "lightning-bolt":"1d6", "spirit-guardians":"1d8", "mass-healing-word":"1d4",
  "ice-storm":"1d8", "wall-of-fire":"1d8", "cone-of-cold":"1d8", "mass-cure-wounds":"1d8", "chain-lightning":"1d8", disintegrate:"3d6"
};
const healingSpellKeys = new Set(["cure-wounds","healing-word","mass-cure-wounds","mass-healing-word","heal","regenerate","mass-heal"]);
function spellRollKind(spell) {
  if (["damage","healing","none"].includes(spell.rollKind)) return spell.rollKind;
  if (healingSpellKeys.has(spell.catalogKey)) return "healing";
  return spell.damage || spell.effectParts?.length ? "damage" : "none";
}
function spellRollFormula(spell, slotLevel, sheet) {
  let formula = Array.isArray(spell.effectParts) && spell.effectParts.length ? formulaFromParts(spell.effectParts,sheet) : String(spell.damage || "");
  if (Number(spell.level) === 0 && spell.catalogKey !== "shillelagh") {
    const multiplier = totalLevel(sheet) >= 17 ? 4 : totalLevel(sheet) >= 11 ? 3 : totalLevel(sheet) >= 5 ? 2 : 1;
    if (multiplier > 1) formula = formula.replace(/(\d*)[dк](\d+)/i, (_, count, sides) => `${Number(count || 1) * multiplier}d${sides}`);
  }
  const levelsAbove = Math.max(0, Number(slotLevel || spell.level) - Number(spell.level || 0));
  const customUpcast = Array.isArray(spell.upcastParts) && spell.upcastParts.length ? formulaFromParts(spell.upcastParts,sheet) : "";
  const extra = customUpcast || spellUpcastDice[spell.catalogKey];
  if (extra && levelsAbove) formula += Array.from({ length:levelsAbove }, () => `+${extra}`).join("");
  return resolveDiceFormula(formula, sheet);
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

$$('[data-lobby-tab]').forEach(button => button.addEventListener("click", () => {
  $$('[data-lobby-tab]').forEach(x => {
    x.classList.toggle("active", x === button);
    x.setAttribute("aria-selected", String(x === button));
  });
  $("#join-form").classList.toggle("hidden", button.dataset.lobbyTab !== "join");
  $("#create-form").classList.toggle("hidden", button.dataset.lobbyTab !== "create");
  $("#entry-error").textContent = "";
}));

$("#create-form").addEventListener("submit", event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  socket.emit("room:create", { ...data, clientId: state.clientId }, enterResponse);
});
$("#join-form").addEventListener("submit", event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  socket.emit("room:join", { ...data, clientId: state.clientId }, enterResponse);
});
function enterResponse(response) {
  state.resuming = false;
  if (!response.ok) {
    localStorage.removeItem("tabaxi-session");
    return $("#entry-error").textContent = response.error;
  }
  state.clientId = response.clientId;
  localStorage.setItem("tt-client-id", response.clientId);
  state.room = response.room;
  state.selectedId = response.clientId;
  const me = response.room.players[response.clientId];
  localStorage.setItem("tabaxi-session", JSON.stringify({ code: response.code, name: me?.name || me?.sheet?.characterName || "Игрок" }));
  history.replaceState(null, "", `#${response.code}`);
  $("#lobby").classList.add("hidden");
  $("#room").classList.remove("hidden");
  restorePendingDraft(response.code, response.clientId);
  renderAll();
}

function draftKey(code = state.room?.code, clientId = state.clientId) { return `tabaxi-draft:${code}:${clientId}`; }
function rememberDraft(sheet) {
  if (!state.room) return;
  localStorage.setItem(draftKey(), JSON.stringify({ at: Date.now(), sheet }));
}
function clearDraft() { if (state.room) localStorage.removeItem(draftKey()); }
function restorePendingDraft(code, clientId) {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(code, clientId)) || "null");
    if (!saved?.sheet || Date.now() - Number(saved.at || 0) > 7 * 86400000) return;
    state.room.players[clientId].sheet = saved.sheet;
    socket.emit("sheet:update", { sheet: saved.sheet }, response => {
      if (response.ok) { localStorage.removeItem(draftKey(code, clientId)); toast("Несохранённые изменения восстановлены"); }
    });
  } catch { localStorage.removeItem(draftKey(code, clientId)); }
}

socket.on("connect", () => {
  try {
    const session = JSON.parse(localStorage.getItem("tabaxi-session") || "null");
    if (!session?.code || !session?.name) return;
    if (state.resuming) return;
    if (state.room) {
      const selected = state.selectedId;
      state.resuming = true;
      $("#save-state").textContent = "Возвращаю связь…";
      socket.emit("room:join", { code:session.code, name:session.name, clientId:state.clientId }, response => {
        state.resuming = false;
        if (!response.ok) { $("#save-state").textContent = "Нет связи"; return; }
        state.room = response.room;
        state.selectedId = response.room.players[selected] ? selected : state.clientId;
        restorePendingDraft(response.code, state.clientId);
        $("#save-state").textContent = "Сохранено";
        renderAll();
      });
      return;
    }
    state.resuming = true;
    socket.emit("room:join", { code: session.code, name: session.name, clientId: state.clientId }, enterResponse);
  } catch { localStorage.removeItem("tabaxi-session"); }
});
socket.on("disconnect", () => { if (state.room) $("#save-state").textContent = "Нет связи · черновик сохранён"; });

socket.on("room:state", room => {
  if (!state.room || room.code !== state.room.code) return;
  state.room = room;
  if (!room.players[state.selectedId]) state.selectedId = state.clientId;
  renderChrome();
  renderRolls();
  const editing = $("#sheet-view").contains(document.activeElement);
  if (!editing) renderSheet();
});

function renderAll() { renderChrome(); renderSheet(); renderRolls(); }
function renderChrome() {
  const room = state.room;
  $("#campaign-title").textContent = room.title;
  $("#copy-code").textContent = room.code;
  const players = Object.values(room.players);
  $("#party-count").textContent = players.length;
  $("#players").innerHTML = players.map(player => `
    <button class="player ${player.online ? "online" : ""} ${player.id === state.selectedId ? "active" : ""}" data-player="${esc(player.id)}">
      <span class="avatar">${esc((player.sheet.characterName || player.name)[0]?.toUpperCase() || "?")}</span>
      <span><strong>${esc(player.sheet.characterName || player.name)}</strong><small>${player.role === "dm" ? "Ведущий" : esc(player.sheet.className || "Искатель приключений")}</small></span>
    </button>`).join("");
  $$('[data-player]').forEach(button => button.addEventListener("click", () => {
    state.selectedId = button.dataset.player; renderChrome(); renderSheet(); switchView("sheet");
  }));
}

function field(label, name, value, type = "text") {
  return `<label>${label}<input type="${type}" data-field="${name}" value="${esc(value)}"></label>`;
}
function area(label, name, value, placeholder = "") {
  return `<label>${label}<textarea data-field="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
}

function formulaVariables(sheet) {
  return {
    STR: modifier(sheet.stats.str), DEX: modifier(sheet.stats.dex), CON: modifier(sheet.stats.con),
    INT: modifier(sheet.stats.int), WIS: modifier(sheet.stats.wis), CHA: modifier(sheet.stats.cha),
    PROF: effectiveProficiency(sheet), LVL: Number(sheet.level || 1),
    SPELL: sheet.spellcastingAbility ? modifier(sheet.stats[sheet.spellcastingAbility]) : 0
  };
}
function resolveBonus(expression, sheet) {
  if (typeof expression === "number") return expression;
  let source = String(expression || "0");
  const variables = formulaVariables(sheet);
  source = source.replace(/\[([A-Z]+)]/gi, (_, key) => String(variables[key.toUpperCase()] ?? 0));
  if (!/^[\d+\-*/().\s]+$/.test(source)) return Number(expression) || 0;
  try { return Math.trunc(Function(`"use strict"; return (${source})`)()); } catch { return Number(expression) || 0; }
}
function resolveDiceFormula(expression, sheet) {
  const variables = formulaVariables(sheet);
  return String(expression || "").replace(/\[([A-Z]+)]/gi, (_, key) => String(variables[key.toUpperCase()] ?? 0)).replace(/\+\-/g, "-").replace(/d/gi, "к");
}
const abilityAbbreviations = { str:"СИЛ", dex:"ЛОВ", con:"ТЕЛ", int:"ИНТ", wis:"МДР", cha:"ХАР" };
function parseFormulaParts(expression, kind = "damage") {
  const source = String(expression || "").replace(/\s+/g, "").replace(/-/g, "+-");
  return source.split("+").filter(Boolean).map(token => {
    const variable = token.match(/^\[?(STR|DEX|CON|INT|WIS|CHA|SPELL|PROF)\]?$/i)?.[1]?.toLowerCase();
    if (variable === "prof") return { id:uuid(), type:"proficiency", value:"prof" };
    if (variable === "spell") return { id:uuid(), type:"spell", value:"spell" };
    if (variable && abilityAbbreviations[variable]) return { id:uuid(), type:"ability", value:variable };
    const die = token.match(/^(\d*)[dк](\d+)$/i);
    if (die) return { id:uuid(), type:"dice", count:Number(die[1] || 1), sides:Number(die[2]) };
    if (/^-?\d+$/.test(token)) return { id:uuid(), type:"flat", value:String(Number(token)) };
    return null;
  }).filter(Boolean).filter(part => kind === "attack" ? !["dice","sneak","martial"].includes(part.type) : part.type !== "proficiency");
}
function formulaParts(attack, kind, sheet) {
  const saved = kind === "attack" ? attack.attackParts : attack.damageParts;
  if (Array.isArray(saved) && saved.length) return saved.map(part => ({ ...part, id:part.id || uuid() }));
  const parsed = parseFormulaParts(kind === "attack" ? attack.bonus : attack.damage, kind);
  if (parsed.length) return parsed;
  if (kind === "attack") return [{ id:uuid(), type:"ability", value:modifier(sheet.stats.dex) >= modifier(sheet.stats.str) ? "dex" : "str" },{ id:uuid(), type:"proficiency", value:"prof" }];
  return [{ id:uuid(), type:"dice", count:1, sides:6 },{ id:uuid(), type:"ability", value:modifier(sheet.stats.dex) >= modifier(sheet.stats.str) ? "dex" : "str" }];
}
function formulaPartValue(part, sheet, context = {}) {
  if (part.type === "ability") return `[${String(part.value || "str").toUpperCase()}]`;
  if (part.type === "proficiency") return "[PROF]";
  if (part.type === "spell") return "[SPELL]";
  if (part.type === "dice") return `${Math.max(1, Number(part.count) || 1)}к${Math.max(2, Number(part.sides) || 6)}`;
  if (part.type === "flat") return String(Number(part.value) || 0);
  if (part.type === "sneak") return `${rules.sneakAttackDice(classLevel(sheet,"rogue"))}к6`;
  if (part.type === "martial") { const level = classLevel(sheet,"monk"); return `1к${level >= 17 ? 10 : level >= 11 ? 8 : level >= 5 ? 6 : 4}`; }
  if (part.type === "rage") { const level = classLevel(sheet,"barbarian"); return String(level >= 16 ? 4 : level >= 9 ? 3 : 2); }
  if (part.type === "smite") return `${Math.max(2, Number(context.smiteDice) || 2)}к8`;
  if (part.type === "superiority") { const level = classLevel(sheet,"fighter"); return `1к${level >= 18 ? 12 : level >= 10 ? 10 : 8}`; }
  return "0";
}
function formulaFromParts(parts, sheet, context = {}) {
  return (parts || []).map(part => formulaPartValue(part, sheet, context)).filter(Boolean).join("+").replace(/\+(-)/g, "$1") || "0";
}
function attackBonusFormula(attack, sheet) { return Array.isArray(attack.attackParts) && attack.attackParts.length ? formulaFromParts(attack.attackParts, sheet) : String(attack.bonus || "0"); }
function attackDamageFormula(attack, sheet, context = {}) { return Array.isArray(attack.damageParts) && attack.damageParts.length ? formulaFromParts(attack.damageParts, sheet, context) : String(attack.damage || ""); }
function attacksPerAction(sheet) {
  const fighter = classLevel(sheet,"fighter");
  if (fighter >= 20) return 4;
  if (fighter >= 11) return 3;
  if (fighter >= 5) return 2;
  if (["barbarian","monk","paladin","ranger"].some(key => classLevel(sheet,key) >= 5)) return 2;
  if (classEntries(sheet).some(entry => entry.key === "bard" && entry.level >= 6 && /доблест|меч/i.test(entry.subclass || ""))) return 2;
  return 1;
}
const actionCostLabels = { action:"действие", bonus:"бонусное", reaction:"реакция", free:"без действия" };
function actionCostLabel(value) { return actionCostLabels[value] || actionCostLabels.action; }
function formulaPartLabel(part, sheet) {
  if (part.type === "ability") return `${signed(modifier(sheet.stats[part.value]))} ${abilityAbbreviations[part.value] || String(part.value).toUpperCase()}`;
  if (part.type === "proficiency") return `${signed(effectiveProficiency(sheet))} мастерство`;
  if (part.type === "spell") return `${signed(formulaVariables(sheet).SPELL)} магия`;
  if (part.type === "flat") return signed(Number(part.value) || 0);
  if (part.type === "sneak") return `${rules.sneakAttackDice(classLevel(sheet,"rogue"))}к6 скрытая атака`;
  if (part.type === "martial") return `${formulaPartValue(part,sheet)} кость монаха`;
  if (part.type === "rage") return `${signed(Number(formulaPartValue(part,sheet)))} ярость`;
  if (part.type === "smite") return "Божественная кара · ячейка";
  if (part.type === "superiority") return `${formulaPartValue(part,sheet)} приём`;
  return `${Math.max(1, Number(part.count) || 1)}к${Math.max(2, Number(part.sides) || 6)}`;
}
function friendlyFormula(attack, kind, sheet) {
  const parts = formulaParts(attack, kind, sheet);
  return parts.map(part => formulaPartLabel(part, sheet)).join(" + ").replace(/\+ -/g, "− ");
}
function getSkillBonus(sheet, key) {
  const skill = skills.find(entry => entry[0] === key);
  if (!skill) return 0;
  const multiplier = (sheet.expertise || []).includes(key) ? 2 : (sheet.skillProficiencies.includes(key) ? 1 : 0);
  return modifier(sheet.stats[skill[2]]) + effectiveProficiency(sheet) * multiplier;
}

function renderSheet() {
  const player = state.room?.players?.[state.selectedId];
  if (!player) return;
  const s = player.sheet;
  const mine = player.id === state.clientId;
  const proficiency = effectiveProficiency(s);
  const armorClass = calculateAc(s);
  const initiative = initiativeBonus(s);
  const statCards = Object.entries(abilities).map(([key, name]) => `
    <div class="stat">
      <label>${name}</label>
      <input type="number" min="1" max="30" data-stat="${key}" aria-label="${name}" value="${Number(s.stats[key] ?? 10)}">
      <div class="stat-bottom"><span class="modifier" data-mod="${key}">${signed(modifier(s.stats[key]))}</span><button class="roll-mini" data-roll-stat="${key}">к20</button></div>
    </div>`).join("");
  const saves = Object.entries(abilities).map(([key, name]) => {
    const proficient = s.saveProficiencies.includes(key);
    return `<div class="check-row clean-check ${proficient ? "proficient" : ""}"><span class="mastery-mark">${proficient ? "◆" : "·"}</span><button class="bonus" data-save-bonus="${key}" data-roll-save="${key}" title="Бросить спасбросок"></button><span>${name}</span><span class="mastery-label">${proficient ? "владение" : key.toUpperCase()}</span></div>`;
  }).join("");
  const skillRows = skills.map(([key, name, ability]) => {
    const expert = (s.expertise || []).includes(key), proficient = expert || s.skillProficiencies.includes(key);
    return `<div class="check-row clean-check skill-row ${expert ? "expert" : proficient ? "proficient" : ""}"><span class="mastery-mark">${expert ? "✦" : proficient ? "◆" : "·"}</span><button class="bonus" data-skill-bonus="${key}" data-ability="${ability}" data-roll-skill="${key}" title="Бросить проверку"></button><span>${name}</span><span class="mastery-label">${expert ? "компетентность" : proficient ? "владение" : abilityAbbreviations[ability]}</span></div>`;
  }).join("");
  const attacksList = Array.isArray(s.attacksList) ? s.attacksList : [];
  const attacksInAction = attacksPerAction(s);
  const attackRows = attacksList.length ? attacksList.map(attack => `
    <div class="attack-row">
      <button class="attack-name" data-attack-roll="${esc(attack.id)}"><span>${esc(attack.name || "Безымянная атака")}</span><small>${esc(actionCostLabel(attack.actionCost))}${(!attack.actionCost || attack.actionCost === "action") && attacksInAction > 1 ? ` · атак ×${attacksInAction}` : ""}</small></button>
      <button data-attack-roll="${esc(attack.id)}">${signed(resolveBonus(attackBonusFormula(attack, s), s))}</button>
      <button class="attack-damage" data-damage-roll="${esc(attack.id)}"><span>${esc(friendlyFormula(attack,"damage",s) || "—")}</span><small>${esc(attack.damageType || "")}</small></button>
      <button data-critical-damage="${esc(attack.id)}" title="Критический урон">✦</button>
      <button data-attack-edit="${esc(attack.id)}">⋮</button>
    </div>`).join("") : `<div class="read-only">Добавь оружие или атаку — бонус и урон можно будет бросать одним нажатием.</div>`;
  const activeConditions = (s.conditions || []).map(name => `<button type="button" data-condition-info="${esc(name)}" title="Показать эффект">${esc(name)}</button>`).join("") || `<span>Нет состояний</span>`;
  const coinNames = [["cp","ММ"],["sp","СМ"],["ep","ЭМ"],["gp","ЗМ"],["pp","ПМ"]];
  const coins = coinNames.map(([key, label]) => `<label>${label}<input type="number" min="0" data-coin="${key}" value="${Number(s.coins?.[key] || 0)}"></label>`).join("");
  const slots = (s.spellSlots || []).filter(slot => slot.total > 0).map(slot => `
    <div class="slot-row"><strong>${slot.level}</strong><div class="slot-pips">${Array.from({length: slot.total}, (_, index) => `<span class="slot-pip ${index < slot.used ? "used" : ""}"></span>`).join("")}</div><button data-slot-restore="${slot.level}">−</button><button data-slot-use="${slot.level}">+</button></div>`).join("");
  const pact = s.pactSlots || { level:0, total:0, used:0 };
  const pactSlots = Number(pact.total) > 0 ? `<div class="slot-row pact-slot-row"><strong>Д${Number(pact.level)}</strong><div class="slot-pips">${Array.from({length:Number(pact.total)}, (_, index) => `<span class="slot-pip ${index < Number(pact.used) ? "used" : ""}"></span>`).join("")}</div><button data-pact-slot="restore">−</button><button data-pact-slot="use">+</button></div>` : "";
  const resources = (s.resources || []).map(resource => `
    <div class="entity-row resource-row"><strong>${esc(resource.name || "Ресурс")}</strong><div class="resource-meter"><small>${Number(resource.current || 0)}/${Number(resource.max || 0)}</small><progress max="${Math.max(1, Number(resource.max || 0))}" value="${Number(resource.current || 0)}"></progress></div><button data-resource-change="${esc(resource.id)}" data-delta="-1">−</button><button data-resource-change="${esc(resource.id)}" data-delta="1">+</button><button data-resource-edit="${esc(resource.id)}">⋮</button></div>`).join("");
  const inventory = (s.inventoryList || []);
  const inventoryWeight = inventory.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.quantity || 0), 0);
  const carryingCapacity = Number(s.stats.str || 0) * 15;
  const attunedCount = inventory.filter(item => item.attuned).length;
  const inventoryRows = inventory.map(item => `
    <div class="entity-row"><div><strong>${esc(item.name || "Предмет")}</strong><div class="item-flags">${item.equipped ? "<span>надето</span>" : ""}${item.attuned ? "<span>настроено</span>" : ""}${item.magical ? "<span>магия</span>" : ""}${item.type === "weapon" ? "<span>оружие</span>" : ""}${item.type === "armor" ? "<span>броня</span>" : ""}</div></div><small>${Number(item.quantity || 0)} шт.</small><small>${Number(item.weight || 0) * Number(item.quantity || 0)} фнт.</small><button data-item-edit="${esc(item.id)}">⋮</button></div>`).join("");
  const spellAbility = s.spellcastingAbility || "";
  const spellMod = spellAbility ? modifier(s.stats[spellAbility]) : 0;
  const spellSave = 8 + proficiency + spellMod;
  const spellAttack = proficiency + spellMod;
  const preparedCount = (s.spellsList || []).filter(spell => spell.prepared && Number(spell.level) > 0).length;
  const preparedLimit = preparedSpellLimit(s);
  const classRoadmaps = classEntries(s).map(entry => `<details class="class-roadmap" ${classEntries(s).length === 1 ? "open" : ""}><summary>${classGlyph(entry.key)}<span><strong>${esc(entry.name || rules.classes[entry.key]?.name)} · ${Number(entry.level)} уровень</strong><small>Все особенности класса по уровням</small></span><i>раскрыть</i></summary><div>${Array.from({length:20},(_,index) => {
    const level = index + 1, unlocked = level <= Number(entry.level);
    return `<article class="roadmap-level ${unlocked ? "unlocked" : "locked"} ${level === Number(entry.level) ? "current" : ""}"><b>${level}</b><div><strong>${rules.featuresAt(entry.key,level).map(feature => esc(feature.name)).join(" · ")}</strong><p>${rules.featuresAt(entry.key,level).map(feature => esc(feature.summary)).join(" ")}</p></div></article>`;
  }).join("")}</div></details>`).join("");
  const featRows = (s.feats || []).map(feat => {
    const key = featKey(feat), info = rules.feats[key];
    return `<article class="feat-chip"><span>${classGlyph(feat.classKey || s.classKey)}</span><div><strong>${esc(feat.name || info?.name || key || "Черта")}</strong><small>${esc(info?.summary || feat.summary || "Добавлена вручную")}</small></div></article>`;
  }).join("");
  const spellRows = [...(s.spellsList || [])].sort((a, b) => Number(a.level) - Number(b.level) || String(a.name).localeCompare(String(b.name))).map(spell => `
    <div class="entity-row spell-row ${spell.prepared ? "prepared" : ""}" data-spell-name="${esc(String(spell.name || "").toLowerCase())}" data-spell-level="${Number(spell.level || 0)}" data-spell-prepared="${spell.prepared ? "yes" : "no"}"><span class="spell-level">${Number(spell.level || 0)}</span><div><strong>${esc(spell.name || "Заклинание")}${spellRollKind(spell) === "healing" ? `<i class="spell-kind healing">лечение</i>` : spellRollKind(spell) === "damage" ? `<i class="spell-kind damage">урон</i>` : ""}</strong><small>${spell.sourceClassKey ? `${esc(rules.classes[spell.sourceClassKey]?.name || spell.sourceClassKey)} · ` : ""}${esc(spell.castingTime || "действие")} · ${esc(spell.range || "на себя")}${spell.concentration ? " · концентрация" : ""}${spell.ritual ? " · ритуал" : ""}</small></div><button data-spell-prepare="${esc(spell.id)}" title="Подготовить или убрать">${spell.prepared ? "★" : "☆"}</button><button data-spell-cast="${esc(spell.id)}">Сотворить</button><button data-spell-info="${esc(spell.id)}" title="Описание">i</button><button data-spell-edit="${esc(spell.id)}">⋮</button></div>`).join("");
  const goalRows = (s.goalsList || []).map(goal => `<div class="entity-row"><input type="checkbox" data-goal-done="${esc(goal.id)}" ${goal.done ? "checked" : ""}><strong>${esc(goal.text)}</strong><button data-goal-edit="${esc(goal.id)}">⋮</button></div>`).join("");
  const noteRows = (s.notesList || []).map(note => `<div class="panel"><h3 class="panel-title">${esc(note.title || "Заметка")}</h3><p>${esc(note.text).replace(/\n/g, "<br>")}</p><button data-note-edit="${esc(note.id)}" class="secondary">Изменить</button></div>`).join("");

  $("#sheet-view").innerHTML = `<div class="sheet ${mine && !s.classKey ? "unbuilt" : ""}">
    ${mine ? "" : `<div class="read-only">Ты просматриваешь лист персонажа «${esc(s.characterName || player.name)}». Редактировать его может владелец.</div>`}
    <section class="character-hero">
      <div class="hero-avatar">${s.portraitUrl ? `<img src="${esc(s.portraitUrl)}" alt="Портрет ${esc(s.characterName || player.name)}">` : esc((s.characterName || player.name || "?")[0].toUpperCase())}<span class="hero-class-mark">${classGlyph(classEntries(s)[0]?.key)}</span></div>
      <div class="hero-identity"><span class="eyebrow">${esc(s.race || "Раса не выбрана")} · ${esc(s.background || "Предыстория не выбрана")}</span><h1>${esc(s.characterName || player.name)}</h1><p>${esc(classSummary(s))} · общий ${totalLevel(s)} уровень</p></div>
      <div class="hero-vitals"><button data-quick="ac"><small>КД</small><strong>${armorClass}</strong></button><button id="quick-hp"><small>HP</small><strong>${Number(s.hpCurrent)}/${Number(s.hpMax)}</strong></button><button id="quick-initiative"><small>Инициатива</small><strong>${signed(initiative)}</strong></button><button data-quick="passive"><small>Пассивка</small><strong>${10 + getSkillBonus(s,"perception") + passiveBonus(s,"perception")}</strong></button><button id="quick-inspiration" class="${s.inspiration ? "lit" : ""}"><small>Вдохновение</small><strong>${s.inspiration ? "◆" : "◇"}</strong></button></div>
    </section>
    ${experienceMarkup(s, mine)}
    ${progressionMarkup(s)}
    ${mine && !s.classKey ? `<section class="character-onboarding"><div><span class="eyebrow">Новый персонаж</span><h2>Готовый герой примерно за минуту</h2><p>Выбери класс, расу, уровень и предысторию — TabaxiTable сам распределит характеристики, рассчитает HP и КД, выдаст навыки, оружие и стартовые заклинания.</p></div><button id="quick-character" class="primary" type="button">✦ Быстро создать</button></section>` : ""}
    <details class="identity-editor"><summary>Ручное редактирование паспорта</summary><div class="sheet-head">
      <label class="character-name">Имя персонажа<input data-field="characterName" value="${esc(s.characterName)}"></label>
      <div class="identity-class-summary"><small>Классы и уровни</small><strong>${esc(classSummary(s))}</strong><span>Меняются через кнопку «Повысить уровень».</span></div>
      ${field("Раса", "race", s.race)} ${field("Размер", "size", s.size || "Средний")}
      ${field("Предыстория", "background", s.background)}
      ${field("Мировоззрение", "alignment", s.alignment)} ${field("Опыт", "xp", s.xp, "number")}
      ${field("Бонус мастерства", "proficiency", proficiency, "number")}
    </div></details>
    ${mine ? `<div class="sheet-tools">${s.classKey && totalLevel(s) < 20 ? `<button id="level-up" class="primary level-up-button" type="button"><span>↑</span> Повысить уровень</button>` : ""}<button id="character-builder" class="secondary" type="button">${s.classKey ? "Пересобрать героя" : "Подробный мастер"}</button>${s.classKey ? `<button id="quick-character" class="secondary" type="button">Быстрая сборка</button>` : ""}<details class="sheet-more"><summary>Ещё ···</summary><div><button id="sheet-history" class="secondary" type="button">История версий</button><button id="sheet-export" class="secondary" type="button">Экспорт листа</button><button id="sheet-import" class="secondary" type="button">Импорт листа</button>${player.role === "dm" ? `<button id="campaign-backup" class="secondary" type="button">Копия кампании</button><button id="campaign-restore" class="secondary" type="button">Восстановить кампанию</button>` : ""}</div></details><input id="sheet-import-file" type="file" accept="application/json" hidden><input id="campaign-restore-file" type="file" accept="application/json" hidden></div>` : ""}
    <details class="roll-mode" aria-label="Режим броска"><summary>Следующий к20: <b>${state.rollMode === "advantage" ? "преимущество" : state.rollMode === "disadvantage" ? "помеха" : "обычно"}</b></summary><div><button data-roll-mode="normal">Обычно</button><button data-roll-mode="advantage">Преимущество</button><button data-roll-mode="disadvantage">Помеха</button></div></details>
    <nav class="sheet-tabs">
      <button data-sheet-tab="main">Главное</button><button data-sheet-tab="combat">Бой</button><button data-sheet-tab="spells">Магия</button><button data-sheet-tab="equipment">Снаряжение</button><button data-sheet-tab="features">Развитие</button><button data-sheet-tab="story">История</button>
    </nav>
    <div class="sheet-grid">
      <div class="stack">
        <div class="panel stats" data-section="main">${statCards}</div>
        <div class="panel" data-section="main"><div class="panel-heading"><h3 class="panel-title">Спасброски</h3>${mine ? `<button id="proficiencies-manager-saves" class="quiet-action" type="button">Настроить</button>` : ""}</div><div class="checks save-checks">${saves}</div></div>
        <div class="panel" data-section="main"><h3 class="panel-title">Пассивные чувства</h3><div class="checks"><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"perception") + passiveBonus(s,"perception")}</span><span>Восприятие</span></div><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"insight")}</span><span>Проницательность</span></div><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"investigation") + passiveBonus(s,"investigation")}</span><span>Анализ</span></div></div></div>
        <div class="panel" data-section="features"><h3 class="panel-title">Владения и языки</h3>${area("Доспехи", "armorProficiencies", s.armorProficiencies || "")}${area("Оружие", "weaponProficiencies", s.weaponProficiencies || "")}${area("Инструменты", "toolProficiencies", s.toolProficiencies || "")}${area("Языки", "languages", s.languages || "")}</div>
      </div>
      <div class="stack">
        <div data-section="combat">${classHighlightsMarkup(s)}</div>
        <div class="combat" data-section="combat">
          <label>Класс доспеха<input type="number" data-field="ac" value="${armorClass}" ${s.autoArmorClass ? "readonly" : ""}></label>
          <label>Инициатива<input data-derived="initiative" value="${signed(initiative)}" readonly></label>
          <label>Скорость<input type="number" data-field="speed" value="${Number(s.speed)}"></label>
        </div>
        <div class="panel two-col" data-section="combat">${field("Прыжок в высоту", "jumpHigh", s.jumpHigh || Math.max(0, 3 + modifier(s.stats.str)))}${field("Прыжок в длину", "jumpLong", s.jumpLong || Number(s.stats.str))}</div>
        <div class="panel hp" data-section="combat">
          <label>Максимум<input type="number" data-field="hpMax" value="${Number(s.hpMax)}"></label>
          <label class="hp-current">Текущие HP<input type="number" data-field="hpCurrent" value="${Number(s.hpCurrent)}"></label>
          <label>Временные<input type="number" data-field="hpTemp" value="${Number(s.hpTemp)}"></label>
          <button id="hp-manager" class="secondary manage" type="button">Здоровье и отдых</button>
        </div>
        <div class="panel skills-panel" data-section="main"><div class="panel-heading"><h3 class="panel-title">Навыки</h3>${mine ? `<button id="proficiencies-manager" class="quiet-action" type="button">Настроить</button>` : ""}</div><div class="checks skill-checks">${skillRows}</div></div>
        <div class="panel" data-section="combat">
          <div class="panel-heading"><h3 class="panel-title">Кости хитов</h3><small>${(s.hitDicePools || []).reduce((sum,pool)=>sum+Number(pool.current),0)}/${(s.hitDicePools || []).reduce((sum,pool)=>sum+Number(pool.total),0)} осталось</small></div>
          <div class="hit-dice-pills">${(s.hitDicePools || [{sides:s.hitDieSize,total:s.hitDiceMax,current:s.hitDiceCurrent}]).map(pool => `<span><b>${Number(pool.current)}/${Number(pool.total)}</b> к${Number(pool.sides)}</span>`).join("")}</div>
          <div class="death">Спасброски от смерти: успехи <input type="number" min="0" max="3" data-field="deathSuccess" value="${Number(s.deathSuccess)}"> провалы <input type="number" min="0" max="3" data-field="deathFail" value="${Number(s.deathFail)}"><button id="death-save-roll" class="secondary" type="button">Бросить спасбросок</button></div>
        </div>
        <div class="panel" data-section="combat"><h3 class="panel-title">Атаки</h3><div class="attack-list">${attackRows}</div>${mine ? `<button id="attack-add" class="secondary" type="button">+ Добавить атаку</button>` : ""}${area("Прочие атаки и заклинания", "attacks", s.attacks, "Свободные заметки об атаках...")}</div>
        <div class="panel" data-section="features"><h3 class="panel-title">Ресурсы и заряды</h3><div class="entity-list">${resources || `<div class="read-only">Стрелы, ярость, ци, превосходство и любые другие заряды.</div>`}</div>${mine ? `<button id="resource-add" class="secondary" type="button">+ Добавить ресурс</button>` : ""}</div>
        <div class="panel" data-section="equipment"><div class="section-actions"><h3 class="panel-title">Снаряжение · ${inventoryWeight}/${carryingCapacity} фнт. · настройка ${attunedCount}/3</h3>${mine ? `<button id="item-catalog" class="secondary" type="button">Справочник</button><button id="item-add" class="secondary" type="button">Хоумбрю</button>` : ""}</div><div class="capacity-bar"><span style="width:${Math.min(100, inventoryWeight/Math.max(1,carryingCapacity)*100)}%"></span></div><div class="entity-list">${inventoryRows || `<div class="read-only">Инвентарь пока пуст.</div>`}</div>${area("Дополнительное снаряжение", "equipment", s.equipment)}</div>
      </div>
      <div class="stack">
        <div class="panel" data-section="combat"><h3 class="panel-title">Состояния и истощение</h3><div class="active-conditions">${activeConditions}</div><div class="two-col">${field("Истощение", "exhaustion", s.exhaustion || 0, "number")}${mine ? `<button id="conditions-manager" class="secondary" type="button">Изменить</button>` : ""}</div>${Number(s.exhaustion || 0) > 0 ? `<div class="exhaustion-effect">Уровень ${Math.min(6, Number(s.exhaustion))}: ${esc(rules.exhaustionInfo[Math.min(6, Number(s.exhaustion))])}</div>` : ""}${s.concentrationSpellName ? `<div class="concentration"><span>◉ Концентрация: <strong>${esc(s.concentrationSpellName)}</strong></span>${mine ? `<button id="stop-concentration">Завершить</button>` : ""}</div>` : ""}</div>
        <div class="panel" data-section="equipment"><h3 class="panel-title">Монеты</h3><div class="coins">${coins}</div></div>
        <div class="panel progression-panel" data-section="features"><div class="panel-heading"><h3 class="panel-title">Развитие персонажа</h3>${mine && totalLevel(s) < 20 ? `<button id="level-up-features" class="secondary" type="button">+ Уровень</button>` : ""}</div><div class="class-summary-list">${classEntries(s).map(entry => `<article>${classGlyph(entry.key)}<div><strong>${esc(entry.name || rules.classes[entry.key]?.name)} ${Number(entry.level)}</strong><small>${esc(entry.subclass || `Подкласс на ${rules.subclassLevel(entry.key)} уровне`)}</small></div></article>`).join("") || `<div class="read-only">Сначала выбери класс.</div>`}</div>${featRows ? `<h3 class="panel-title feat-title">Черты</h3><div class="feat-list">${featRows}</div>` : ""}<h3 class="panel-title roadmap-title">Классовые особенности 1–20</h3><div class="class-roadmaps">${classRoadmaps}</div></div>
        <div class="panel" data-section="features"><h3 class="panel-title">Наследие и особенности</h3>${area("Расовые особенности", "ancestryTraits", s.ancestryTraits || "")}${area("Классовые особенности и умения", "features", s.features)}</div>
        <div class="panel" data-section="features"><h3 class="panel-title">Чувства и защита</h3><div class="bio-grid">${field("Тёмное зрение", "darkvision", s.darkvision || 0, "number")}${field("Слепое зрение", "blindsight", s.blindsight || 0, "number")}${field("Чувство вибрации", "tremorsense", s.tremorsense || 0, "number")}${field("Истинное зрение", "truesight", s.truesight || 0, "number")}</div>${area("Сопротивления", "resistances", s.resistances || "")}${area("Иммунитеты", "immunities", s.immunities || "")}${area("Уязвимости", "vulnerabilities", s.vulnerabilities || "")}</div>
        <div class="panel" data-section="spells"><h3 class="panel-title">Гримуар</h3><div class="spell-summary"><div><small>Сложность</small><strong>${spellSave}</strong></div><div><small>Атака</small><strong>${signed(spellAttack)}</strong></div><div class="${preparedLimit !== null && preparedCount > preparedLimit ? "over-limit" : ""}"><small>Подготовлено</small><strong>${preparedCount}${preparedLimit === null ? "" : `/${preparedLimit}`}</strong></div><label>Характеристика<select data-field="spellcastingAbility"><option value="">—</option>${Object.entries(abilities).map(([key,name]) => `<option value="${key}" ${spellAbility === key ? "selected" : ""}>${name}</option>`).join("")}</select></label></div><div class="spell-slots">${slots || (!pactSlots ? `<span class="read-only">Настрой доступные ячейки.</span>` : "")}${pactSlots}</div><div class="section-actions">${mine ? `<button id="slots-manager" class="secondary" type="button">Ячейки</button><button id="spell-library" class="secondary" type="button">Справочник</button><button id="spell-add" class="secondary" type="button">Хоумбрю</button>` : ""}</div><div class="spell-filters"><input id="owned-spell-search" aria-label="Поиск в гримуаре" placeholder="Поиск в гримуаре"><select id="owned-spell-level" aria-label="Уровень заклинаний"><option value="all">Все уровни</option><option value="0">Заговоры</option>${Array.from({length:9},(_,i)=>`<option value="${i+1}">${i+1} уровень</option>`).join("")}</select><select id="owned-spell-prepared" aria-label="Статус подготовки"><option value="all">Все</option><option value="yes">Подготовленные</option><option value="no">Неподготовленные</option></select></div><div class="entity-list" id="owned-spells">${spellRows || `<div class="read-only">Гримуар пока пуст.</div>`}</div>${area("Заметки заклинателя", "spells", s.spells)}</div>
        <div class="panel" data-section="personality"><h3 class="panel-title">Личность и внешность</h3>${s.portraitUrl ? `<img class="portrait-preview" src="${esc(s.portraitUrl)}" alt="Портрет">` : ""}${field("Ссылка на портрет", "portraitUrl", s.portraitUrl || "")}<div class="bio-grid">${field("Возраст", "age", s.age || "")}${field("Рост", "height", s.height || "")}${field("Вес", "weight", s.weight || "")}${field("Глаза", "eyes", s.eyes || "")}${field("Кожа", "skin", s.skin || "")}${field("Волосы", "hair", s.hair || "")}</div>${area("Внешность", "appearance", s.appearance || "")}${area("Предыстория персонажа", "backstory", s.backstory || "")}${area("Союзники и организации", "allies", s.allies || "")}${area("Черты характера", "personality", s.personality)}${area("Идеалы", "ideals", s.ideals)}${area("Привязанности", "bonds", s.bonds)}${area("Слабости", "flaws", s.flaws)}</div>
        <div class="panel" data-section="personality"><h3 class="panel-title">Будущий токен карты</h3><div class="bio-grid">${field("Картинка токена", "tokenImageUrl", s.tokenImageUrl || s.portraitUrl || "")}${field("Цвет рамки", "tokenColor", s.tokenColor || "#9f7842", "color")}${field("Зрение, футы", "tokenVision", s.tokenVision ?? 60, "number")}${field("Размер на сетке", "tokenScale", s.tokenScale ?? 1, "number")}</div><div class="read-only">Эти настройки уже сохраняются в персонаже и будут использованы модулем карты.</div></div>
        <div class="panel" data-section="goals"><div class="section-actions"><h3 class="panel-title">Цели и задачи</h3>${mine ? `<button id="goal-add" class="secondary" type="button">+ Цель</button>` : ""}</div><div class="entity-list">${goalRows || `<div class="read-only">Целей пока нет.</div>`}</div></div>
        <div class="panel" data-section="notes"><div class="section-actions"><h3 class="panel-title">Заметки</h3>${mine ? `<button id="note-add" class="secondary" type="button">+ Заметка</button>` : ""}</div>${noteRows}${area("Общие заметки", "notes", s.notes)}</div>
      </div>
    </div>
  </div>`;

  if (!mine) $$("input, textarea, select", $("#sheet-view")).forEach(el => el.disabled = true);
  updateDerived();
  if (mine) bindSheet();
  else { state.sheetBindController?.abort(); state.sheetBindController = null; }
  $$('[data-roll-stat]').forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.rollStat; roll(`1к20${signed(modifier(s.stats[key]))}`, abilities[key]);
  }));
  $$('[data-condition-info]').forEach(element => element.addEventListener("click", () => showConditionInfo(element.dataset.conditionInfo)));
  if (!mine) $$('[data-spell-info]').forEach(button => button.addEventListener("click", () => showSpellInfoFor(s, button.dataset.spellInfo)));
  if (mine) bindGameControls();
  bindRollModeControls();
  applySheetTab();
}

function bindRollModeControls() {
  $$('[data-roll-mode]', $("#sheet-view")).forEach(button => {
    button.classList.toggle("active", button.dataset.rollMode === state.rollMode);
    button.setAttribute("aria-pressed", String(button.dataset.rollMode === state.rollMode));
    button.addEventListener("click", () => {
      state.rollMode = button.dataset.rollMode;
      const label = state.rollMode === "advantage" ? "преимущество" : state.rollMode === "disadvantage" ? "помеха" : "обычно";
      $(".roll-mode summary b", $("#sheet-view")) && ($(".roll-mode summary b", $("#sheet-view")).textContent = label);
      $$('[data-roll-mode]', $("#sheet-view")).forEach(item => item.classList.toggle("active", item === button));
      $$('[data-roll-mode]', $("#sheet-view")).forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      $$('[data-dice-roll-mode]').forEach(item => {
        item.classList.toggle("active", item.dataset.diceRollMode === state.rollMode);
        item.setAttribute("aria-pressed", String(item.dataset.diceRollMode === state.rollMode));
      });
    });
  });
}

function applySheetTab() {
  const root = $("#sheet-view");
  const groups = { main:["main"], combat:["combat"], spells:["spells"], equipment:["equipment"], features:["features"], story:["personality","goals","notes"] };
  if (!groups[state.sheetTab]) state.sheetTab = "main";
  const visibleSections = groups[state.sheetTab];
  $$('[data-sheet-tab]', root).forEach(button => {
    button.classList.toggle("active", button.dataset.sheetTab === state.sheetTab);
    button.setAttribute("aria-current", button.dataset.sheetTab === state.sheetTab ? "page" : "false");
    button.onclick = () => { state.sheetTab = button.dataset.sheetTab; applySheetTab(); };
  });
  $$('[data-section]', root).forEach(section => section.classList.toggle("hidden", !visibleSections.includes(section.dataset.section)));
  const stacks = $$('.sheet-grid > .stack', root);
  stacks.forEach(stack => stack.classList.toggle("hidden", !$$(':scope > [data-section]:not(.hidden)', stack).length));
  const visibleCount = stacks.filter(stack => !stack.classList.contains("hidden")).length;
  const grid = $(".sheet-grid", root);
  if (grid) {
    grid.classList.remove("columns-1", "columns-2", "columns-3");
    grid.classList.add(`columns-${Math.max(1, Math.min(3, visibleCount))}`);
  }
}

function currentSheet() { return state.room.players[state.clientId].sheet; }
function collectSheet() {
  const sheet = structuredClone(currentSheet());
  $$('[data-field]', $("#sheet-view")).forEach(el => {
    if (el.type === "checkbox") sheet[el.dataset.field] = el.checked;
    else if (el.type === "number") sheet[el.dataset.field] = Number(el.value || 0);
    else sheet[el.dataset.field] = el.value;
  });
  sheet.stats = { ...sheet.stats };
  $$('[data-stat]', $("#sheet-view")).forEach(el => sheet.stats[el.dataset.stat] = Number(el.value || 10));
  const saveInputs = $$('[data-save]', $("#sheet-view"));
  const skillInputs = $$('[data-skill]', $("#sheet-view"));
  const expertiseInputs = $$('[data-expertise]', $("#sheet-view"));
  if (saveInputs.length) sheet.saveProficiencies = saveInputs.filter(el => el.checked).map(el => el.dataset.save);
  if (skillInputs.length) sheet.skillProficiencies = skillInputs.filter(el => el.checked).map(el => el.dataset.skill);
  if (expertiseInputs.length) sheet.expertise = expertiseInputs.filter(el => el.checked).map(el => el.dataset.expertise);
  sheet.coins = { ...(sheet.coins || {}) };
  $$('[data-coin]', $("#sheet-view")).forEach(el => sheet.coins[el.dataset.coin] = Math.max(0, Number(el.value || 0)));
  return syncCharacterMechanics(sheet);
}
function bindSheet() {
  state.sheetBindController?.abort();
  state.sheetBindController = new AbortController();
  const { signal } = state.sheetBindController;
  $("#sheet-view").addEventListener("input", () => {
    const sheet = collectSheet();
    state.room.players[state.clientId].sheet = sheet;
    rememberDraft(sheet);
    updateDerived();
    $("#save-state").textContent = "Сохраняю…";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => socket.emit("sheet:update", { sheet }, response => {
      $("#save-state").textContent = response.ok ? "Сохранено" : "Ошибка сохранения";
      if (response.ok) clearDraft();
    }), 350);
  }, { signal });
  $("#sheet-view").addEventListener("change", () => {
    clearTimeout(state.saveTimer);
    const sheet = collectSheet();
    rememberDraft(sheet);
    socket.emit("sheet:update", { sheet }, response => {
      $("#save-state").textContent = response.ok ? "Сохранено" : "Ошибка сохранения";
      if (response.ok) clearDraft();
    });
  }, { signal });
}
function saveNow(sheet, message = "Сохранено", reason = "") {
  state.room.players[state.clientId].sheet = sheet;
  rememberDraft(sheet);
  $("#save-state").textContent = "Сохраняю…";
  socket.emit("sheet:update", { sheet, reason }, response => {
    $("#save-state").textContent = response.ok ? message : "Ошибка сохранения";
    if (response.ok) clearDraft();
  });
}
function openModal(title, content) {
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML = content;
  $("#game-modal").showModal();
}
function closeModal() { $("#game-modal").close(); $("#game-modal").classList.remove("library-open", "builder-modal"); }

function openExperienceModal() {
  const sheet = currentSheet(), progress = rules.xpProgress(sheet.xp, totalLevel(sheet));
  openModal("Опыт персонажа", `<div class="xp-modal-summary"><span><small>Сейчас</small><strong>${progress.xp.toLocaleString("ru-RU")} XP</strong></span><span><small>${totalLevel(sheet) >= 20 ? "Максимальный уровень" : `До ${totalLevel(sheet) + 1} уровня`}</small><strong>${totalLevel(sheet) >= 20 ? "Легенда" : `${progress.remaining.toLocaleString("ru-RU")} XP`}</strong></span></div>
    <section class="xp-add-card"><span class="eyebrow">После встречи</span><h3>Сколько опыта получил персонаж?</h3><div class="xp-quick">${[50,100,250,500,1000].map(value => `<button type="button" data-xp-quick="${value}">+${value}</button>`).join("")}</div><label>Другое количество<input id="xp-earned" type="number" min="0" step="1" value="0"></label><button id="xp-add" class="primary" type="button">Добавить опыт</button></section>
    <details class="xp-exact"><summary>Установить точное значение</summary><div><input id="xp-exact-value" type="number" min="0" step="1" value="${progress.xp}"><button id="xp-set" class="secondary" type="button">Сохранить значение</button></div></details>`);
  $$('[data-xp-quick]').forEach(button => button.addEventListener("click", () => { $("#xp-earned").value = button.dataset.xpQuick; }));
  const saveXp = (value, reason) => {
    const next = structuredClone(currentSheet()); next.xp = Math.max(0, Math.floor(Number(value) || 0));
    const earnedLevel = rules.levelFromXp(next.xp);
    closeModal(); saveNow(next, "Опыт сохранён", reason); renderSheet();
    if (earnedLevel > totalLevel(next)) toast(`Опыта хватает на ${earnedLevel} уровень — можно повысить героя`);
  };
  $("#xp-add").addEventListener("click", () => saveXp(Number(sheet.xp || 0) + Math.max(0, Number($("#xp-earned").value) || 0), "Получен опыт"));
  $("#xp-set").addEventListener("click", () => saveXp($("#xp-exact-value").value, "Изменён опыт"));
}

function openLevelInfo(total) {
  const sheet = currentSheet(), entry = levelProgression(sheet).find(item => Number(item.level) === Number(total));
  if (!entry) return;
  const cls = rules.classes[entry.classKey];
  openModal(`${Number(total)} уровень · ${cls?.name || entry.classKey}`, `<div class="level-info-head">${classGlyph(entry.classKey)}<div><span class="eyebrow">Общий уровень ${Number(total)}</span><h3>${esc(cls?.name || entry.classKey)} ${Number(entry.classLevel)}</h3>${entry.choice ? `<p>Сделанный выбор: <strong>${esc(entry.choice)}</strong></p>` : ""}</div></div><div class="level-gains">${levelFeaturesMarkup(entry.classKey, entry.classLevel)}${commonLevelFeaturesMarkup(total)}</div><div class="read-only">Также увеличиваются максимум HP и запас костей хитов этого класса.</div><button id="level-info-close" class="primary" type="button">Понятно</button>`);
  $("#level-info-close").addEventListener("click", closeModal);
}

function openProficienciesModal() {
  const sheet = currentSheet();
  $("#game-modal").classList.add("library-open");
  openModal("Владения и компетентности", `<div class="mastery-editor"><div class="mastery-intro"><strong>Обычный лист остаётся чистым</strong><p>Здесь один раз настраиваются владения. В игре просто нажимай на бонус навыка, чтобы бросить к20.</p></div><section><div class="panel-heading"><h3>Спасброски</h3><small>Обычно их выдаёт первый класс</small></div><div class="save-mastery-grid">${Object.entries(abilities).map(([key,name]) => `<label class="mastery-toggle"><input type="checkbox" data-mastery-save="${key}" ${sheet.saveProficiencies.includes(key) ? "checked" : ""}><span><b>${name}</b><small>${key.toUpperCase()}</small></span><i></i></label>`).join("")}</div></section><section><div class="panel-heading"><h3>Навыки</h3><small>Компетентность удваивает мастерство</small></div><div class="skill-mastery-grid">${skills.map(([key,name,ability]) => { const value = (sheet.expertise || []).includes(key) ? "expert" : sheet.skillProficiencies.includes(key) ? "proficient" : "none"; return `<label><span><b>${name}</b><small>${abilityAbbreviations[ability]}</small></span><select data-mastery-skill="${key}"><option value="none" ${value === "none" ? "selected" : ""}>Без владения</option><option value="proficient" ${value === "proficient" ? "selected" : ""}>Владение</option><option value="expert" ${value === "expert" ? "selected" : ""}>Компетентность ×2</option></select></label>`; }).join("")}</div></section><div class="modal-actions"><button id="mastery-save" class="primary" type="button">Сохранить</button><button id="mastery-cancel" class="secondary" type="button">Отмена</button></div></div>`);
  $("#mastery-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    next.saveProficiencies = $$('[data-mastery-save]:checked').map(input => input.dataset.masterySave);
    next.skillProficiencies = $$('[data-mastery-skill]').filter(select => select.value !== "none").map(select => select.dataset.masterySkill);
    next.expertise = $$('[data-mastery-skill]').filter(select => select.value === "expert").map(select => select.dataset.masterySkill);
    closeModal(); saveNow(next,"Владения сохранены","Владения и компетентности"); renderSheet();
  });
  $("#mastery-cancel").addEventListener("click", closeModal);
}

function bindGameControls() {
  $("#character-builder")?.addEventListener("click", () => openCharacterBuilderV2(false));
  $("#quick-character")?.addEventListener("click", () => openCharacterBuilderV2(true));
  $("#level-up")?.addEventListener("click", openLevelUpWizard);
  $("#level-up-track")?.addEventListener("click", openLevelUpWizard);
  $("#level-up-features")?.addEventListener("click", openLevelUpWizard);
  $("#sheet-history")?.addEventListener("click", openSheetHistory);
  $("#campaign-backup")?.addEventListener("click", exportCampaign);
  $("#campaign-restore")?.addEventListener("click", () => $("#campaign-restore-file").click());
  $("#campaign-restore-file")?.addEventListener("change", restoreCampaign);
  $("#hp-manager")?.addEventListener("click", openHealthModal);
  $("#quick-hp")?.addEventListener("click", openHealthModal);
  $("#quick-initiative")?.addEventListener("click", () => roll(`1к20${signed(initiativeBonus(currentSheet()))}`, "Инициатива", currentSheet().initiativeAdvantage ? { mode:"advantage" } : {}));
  $("#quick-inspiration")?.addEventListener("click", toggleInspiration);
  $("#proficiencies-manager")?.addEventListener("click", openProficienciesModal);
  $("#proficiencies-manager-saves")?.addEventListener("click", openProficienciesModal);
  $(".xp-track")?.addEventListener("click", openExperienceModal);
  $(".xp-track")?.addEventListener("keydown", event => { if (["Enter"," "].includes(event.key)) { event.preventDefault(); openExperienceModal(); } });
  $$('[data-level-info]').forEach(button => button.addEventListener("click", () => openLevelInfo(button.dataset.levelInfo)));
  $("#death-save-roll")?.addEventListener("click", rollDeathSave);
  $$('[data-class-damage]').forEach(button => button.addEventListener("click", () => roll(resolveDiceFormula(button.dataset.classDamage, currentSheet()), button.closest(".class-combat-hint")?.querySelector("span")?.textContent || "Классовый урон", { mode:"normal" })));
  $("#attack-add")?.addEventListener("click", () => openAttackModal());
  $("#conditions-manager")?.addEventListener("click", openConditionsModal);
  $("#slots-manager")?.addEventListener("click", openSlotsModal);
  $$('[data-attack-edit]').forEach(button => button.addEventListener("click", () => openAttackModal(button.dataset.attackEdit)));
  $$('[data-attack-roll]').forEach(button => button.addEventListener("click", () => {
    const attack = currentSheet().attacksList.find(item => item.id === button.dataset.attackRoll);
    const fixedMode = attack?.rollMode && attack.rollMode !== "inherit" ? attack.rollMode : undefined;
    if (attack) roll(`1к20${signed(resolveBonus(attackBonusFormula(attack,currentSheet()), currentSheet()))}`, `Атака: ${attack.name}`, { ...(fixedMode ? { mode:fixedMode } : {}), onResult: response => {
      if (response.natural === 20) { state.lastCriticalAttackId = attack.id; toast("Натуральная 20! Жми ✦ для критического урона"); }
      else if (response.natural === 1) toast("Натуральная 1 — автоматический промах");
    }});
  }));
  $$('[data-damage-roll]').forEach(button => button.addEventListener("click", () => {
    const attack = currentSheet().attacksList.find(item => item.id === button.dataset.damageRoll);
    if (attack) rollAttackDamage(attack,false);
  }));
  $$('[data-critical-damage]').forEach(button => button.addEventListener("click", () => {
    const attack = currentSheet().attacksList.find(item => item.id === button.dataset.criticalDamage);
    if (attack) rollAttackDamage(attack,true);
  }));
  $$('[data-slot-use]').forEach(button => button.addEventListener("click", () => changeSlot(Number(button.dataset.slotUse), 1)));
  $$('[data-slot-restore]').forEach(button => button.addEventListener("click", () => changeSlot(Number(button.dataset.slotRestore), -1)));
  $$('[data-pact-slot]').forEach(button => button.addEventListener("click", () => changePactSlot(button.dataset.pactSlot === "use" ? 1 : -1)));
  $("#resource-add")?.addEventListener("click", () => openResourceModal());
  $$('[data-resource-edit]').forEach(button => button.addEventListener("click", () => openResourceModal(button.dataset.resourceEdit)));
  $$('[data-resource-change]').forEach(button => button.addEventListener("click", () => changeResource(button.dataset.resourceChange, Number(button.dataset.delta))));
  $("#item-add")?.addEventListener("click", () => openItemModal());
  $("#item-catalog")?.addEventListener("click", openItemCatalog);
  $$('[data-item-edit]').forEach(button => button.addEventListener("click", () => openItemModal(button.dataset.itemEdit)));
  $("#spell-add")?.addEventListener("click", () => openSpellModal());
  $("#spell-library")?.addEventListener("click", openSpellLibrary);
  $$('[data-spell-edit]').forEach(button => button.addEventListener("click", () => openSpellModal(button.dataset.spellEdit)));
  $$('[data-spell-cast]').forEach(button => button.addEventListener("click", () => castSpell(button.dataset.spellCast)));
  $$('[data-spell-prepare]').forEach(button => button.addEventListener("click", () => toggleSpellPrepared(button.dataset.spellPrepare)));
  $$('[data-spell-info]').forEach(button => button.addEventListener("click", () => showSpellInfo(button.dataset.spellInfo)));
  $("#stop-concentration")?.addEventListener("click", stopConcentration);
  $("#owned-spell-search")?.addEventListener("input", filterOwnedSpells);
  $("#owned-spell-level")?.addEventListener("change", filterOwnedSpells);
  $("#owned-spell-prepared")?.addEventListener("change", filterOwnedSpells);
  $("#goal-add")?.addEventListener("click", () => openGoalModal());
  $$('[data-goal-edit]').forEach(button => button.addEventListener("click", () => openGoalModal(button.dataset.goalEdit)));
  $$('[data-goal-done]').forEach(input => input.addEventListener("change", () => toggleGoal(input.dataset.goalDone, input.checked)));
  $("#note-add")?.addEventListener("click", () => openNoteModal());
  $$('[data-note-edit]').forEach(button => button.addEventListener("click", () => openNoteModal(button.dataset.noteEdit)));
  $("#sheet-export")?.addEventListener("click", exportSheet);
  $("#sheet-import")?.addEventListener("click", () => $("#sheet-import-file").click());
  $("#sheet-import-file")?.addEventListener("change", importSheet);
  $$('[data-roll-skill]').forEach(element => element.addEventListener("click", event => { event.preventDefault(); rollSkill(element.dataset.rollSkill); }));
  $$('[data-roll-save]').forEach(element => element.addEventListener("click", event => { event.preventDefault(); rollSave(element.dataset.rollSave); }));
}

function skillName(key) { return skills.find(([skillKey]) => skillKey === key)?.[1] || key; }

function starterCatalogItem(key) {
  return [...rules.weapons, ...rules.armor, ...rules.gear].find(item => item.key === key);
}

function addStarterItem(sheet, source) {
  if (!source || sheet.inventoryList.some(item => item.catalogKey === source.key || item.key === source.key)) return;
  const itemId = uuid();
  const equipped = source.type === "armor";
  sheet.inventoryList.push({ ...structuredClone(source), key:undefined, catalogKey:source.key, id:itemId, quantity:1, equipped, attuned:false, magical:false, description:source.properties || "" });
  if (source.type !== "weapon") return;
  const ability = source.ability === "finesse" ? (modifier(sheet.stats.dex) >= modifier(sheet.stats.str) ? "dex" : "str") : source.ability;
  const attackParts = [{ id:uuid(), type:"ability", value:ability },{ id:uuid(), type:"proficiency", value:"prof" }];
  const damageParts = [...parseFormulaParts(source.damage,"damage"),{ id:uuid(), type:"ability", value:ability }];
  sheet.attacksList.push({ id:uuid(), sourceItemId:itemId, name:source.name, attackParts, damageParts, bonus:formulaFromParts(attackParts,sheet), damage:formulaFromParts(damageParts,sheet), damageType:source.damageType });
}

function addStarterEquipment(sheet, classKey, backgroundKey) {
  (rules.startingKits[classKey] || []).forEach(key => addStarterItem(sheet, starterCatalogItem(key)));
  const background = rules.backgrounds[backgroundKey];
  if (background?.item && !sheet.inventoryList.some(item => item.name === background.item)) {
    sheet.inventoryList.push({ id:uuid(), name:background.item, type:"gear", quantity:1, weight:0.5, equipped:false, attuned:false, magical:false, description:`Предыстория: ${background.name}` });
  }
}

async function loadSpellCatalog() {
  if (spellCatalog) return spellCatalog;
  const response = await fetch("/spells-5e.json");
  if (!response.ok) throw new Error("catalog");
  spellCatalog = await response.json();
  return spellCatalog;
}

async function addStarterSpells(sheet, classKey, level) {
  const keys = rules.recommendedSpells[classKey] || [];
  if (!keys.length) return;
  const catalog = await loadSpellCatalog();
  const availableLevels = rules.slotsFor(classKey, level);
  const highestLevel = Math.max(0, ...availableLevels.map((total, index) => total ? index + 1 : 0));
  keys.map(key => catalog.find(spell => spell.key === key)).filter(Boolean).filter(spell => Number(spell.level) === 0 || Number(spell.level) <= highestLevel).forEach(source => {
    if (sheet.spellsList.some(spell => spell.catalogKey === source.key)) return;
    const copy = { ...structuredClone(source), id:uuid(), catalogKey:source.key, prepared:true };
    delete copy.key; delete copy.classes;
    sheet.spellsList.push(copy);
  });
}

function openCharacterBuilderV2(quickStart = false) {
  const s = currentSheet();
  const guessedClass = s.classKey || Object.entries(rules.classes).find(([,value]) => value.name.toLowerCase() === String(s.className).toLowerCase())?.[0] || "rogue";
  const guessedRace = s.raceKey || Object.entries(rules.races).find(([,value]) => value.name.toLowerCase() === String(s.race).toLowerCase())?.[0] || "tabaxi";
  const guessedBackground = s.backgroundKey || Object.entries(rules.backgrounds).find(([,value]) => value.name.toLowerCase() === String(s.background).toLowerCase())?.[0] || "criminal";
  let currentStep = "identity";
  let autoStats = quickStart || !s.classKey;

  $("#game-modal").classList.add("library-open", "builder-modal");
  openModal(quickStart ? "Быстрое создание" : "Настройка персонажа", `
    <div class="builder-v2">
      <nav class="builder-steps" aria-label="Этапы создания">
        <button class="active" data-builder-step="identity"><b>1</b><span>Основа</span></button>
        <button data-builder-step="abilities"><b>2</b><span>Характеристики</span></button>
        <button data-builder-step="details"><b>3</b><span>Навыки и итог</span></button>
      </nav>
      <section class="builder-page" data-builder-page="identity">
        <div class="builder-lead"><div><span class="eyebrow">Концепция героя</span><h3>Кто отправится за приключениями?</h3><p>Выбирай из готовых вариантов. Всё можно изменить позже без потери заметок и предметов.</p></div><button id="builder-instant" class="quick-create" type="button"><span>✦</span><strong>Создать сразу</strong><small>Соберём рекомендуемые статы, навыки, снаряжение и заклинания</small></button></div>
        <div class="builder-form">
          <label class="builder-name">Имя персонажа<input id="builder-name" maxlength="60" value="${esc(s.characterName || "")}" placeholder="Например, Артемидеус"></label>
          <label>Класс<select id="builder-class">${Object.entries(rules.classes).map(([key,value]) => `<option value="${key}" ${key === guessedClass ? "selected" : ""}>${value.name} · к${value.hitDie}</option>`).join("")}</select></label>
          <label>Подкласс<select id="builder-subclass"></select></label>
          <label>Уровень<select id="builder-level">${Array.from({length:20},(_,i)=>`<option value="${i+1}" ${Number(s.level || 1) === i+1 ? "selected" : ""}>${i+1} уровень</option>`).join("")}</select></label>
          <label>Раса<select id="builder-race">${Object.entries(rules.races).map(([key,value]) => `<option value="${key}" ${key === guessedRace ? "selected" : ""}>${value.name}</option>`).join("")}</select></label>
          <label>Предыстория<select id="builder-background">${Object.entries(rules.backgrounds).map(([key,value]) => `<option value="${key}" ${key === guessedBackground ? "selected" : ""}>${value.name}</option>`).join("")}</select></label>
        </div>
        <div id="builder-concept" class="builder-concept"></div>
      </section>
      <section class="builder-page hidden" data-builder-page="abilities">
        <div class="builder-section-head"><div><span class="eyebrow">Автоматический расчёт</span><h3>Характеристики без бухгалтерии</h3></div><button id="builder-recommended" class="secondary" type="button">Распределить под класс</button></div>
        <p class="builder-help">Используется стандартный массив 15, 14, 13, 12, 10, 8, а затем применяются бонусы выбранной расы. При желании любое число можно изменить.</p>
        <div class="ability-builder ability-builder-v2">${Object.entries(abilities).map(([key,name]) => `<label><span>${name}</span><input data-builder-stat="${key}" type="number" min="1" max="30" value="${Number(s.stats[key] || 10)}"><small data-builder-stat-note="${key}">—</small></label>`).join("")}</div>
        <div id="builder-stat-summary" class="builder-stat-summary"></div>
      </section>
      <section class="builder-page hidden" data-builder-page="details">
        <div class="builder-section-head"><div><span class="eyebrow">Последние штрихи</span><h3>Навыки и готовый набор</h3></div><span id="builder-skill-count" class="builder-counter"></span></div>
        <div id="builder-background-skills" class="builder-grants"></div>
        <div id="builder-skills" class="builder-skills-v2"></div>
        <div id="builder-expertise" class="builder-expertise"></div>
        <div id="builder-review" class="builder-review"></div>
        <details class="builder-advanced"><summary>Дополнительные настройки</summary><div class="automation-options">
          <label class="toggle-row"><span><strong>Автоматическая КД</strong><small>По классу и надетой броне</small></span><input id="builder-ac" type="checkbox" ${s.autoArmorClass !== false ? "checked" : ""}><i></i></label>
          <label class="toggle-row"><span><strong>Стартовое снаряжение</strong><small>Оружие, броня и набор класса</small></span><input id="builder-equipment" type="checkbox" checked><i></i></label>
          <label class="toggle-row"><span><strong>Рекомендуемые заклинания</strong><small>Только для выбранного класса</small></span><input id="builder-spells" type="checkbox" checked><i></i></label>
          <label class="toggle-row"><span><strong>Пересчитать HP</strong><small>Среднее значение по уровню</small></span><input id="builder-hp" type="checkbox" checked><i></i></label>
        </div></details>
      </section>
      <footer class="builder-footer"><button id="builder-back" class="secondary hidden" type="button">Назад</button><span></span><button id="builder-next" class="primary" type="button">Дальше</button><button id="builder-finish" class="primary hidden" type="button">Создать готового героя</button></footer>
    </div>`);

  const statInputs = () => $$('[data-builder-stat]', $("#modal-content"));
  const currentKeys = () => ({ classKey:$("#builder-class").value, raceKey:$("#builder-race").value, backgroundKey:$("#builder-background").value, level:Math.max(1, Math.min(20, Number($("#builder-level").value || 1))) });

  const applyRecommendedStats = () => {
    const { classKey, raceKey, level } = currentKeys();
    const build = rules.abilityBuild(classKey, raceKey, level);
    statInputs().forEach(input => {
      const key = input.dataset.builderStat;
      const raceBonus = build.bonuses[key], levelBonus = build.levelBonuses[key];
      input.value = build.total[key]; input.dataset.base = build.base[key]; input.dataset.bonus = raceBonus + levelBonus;
      const additions = [raceBonus ? `+${raceBonus} раса` : "", levelBonus ? `+${levelBonus} уровни` : ""].filter(Boolean).join(" · ");
      $(`[data-builder-stat-note="${key}"]`).textContent = additions ? `${build.base[key]} · ${additions}` : `${build.base[key]} без бонуса`;
    });
    autoStats = true;
    refreshStatsSummary();
  };

  const refreshSubclasses = () => {
    const { classKey, level } = currentKeys();
    const unlock = rules.subclassLevel(classKey);
    const options = rules.subclasses[classKey] || [];
    const selected = $("#builder-subclass").value || (s.classKey === classKey ? s.subclass : "");
    $("#builder-subclass").disabled = level < unlock;
    $("#builder-subclass").innerHTML = level < unlock ? `<option value="">Выбор откроется на ${unlock} уровне</option>` : `<option value="">Без подкласса</option>${options.map(name => `<option ${name === selected ? "selected" : ""}>${name}</option>`).join("")}`;
  };

  const refreshConcept = () => {
    const { classKey, raceKey, backgroundKey, level } = currentKeys();
    const cls = rules.classes[classKey], race = rules.races[raceKey], background = rules.backgrounds[backgroundKey];
    refreshSubclasses();
    $("#builder-concept").innerHTML = `<article><small>Класс</small><strong>${cls.name}</strong><span>к${cls.hitDie} HP · ${cls.caster === "none" ? "без магии" : cls.caster === "pact" ? "магия договора" : "заклинатель"}</span></article><article><small>Раса</small><strong>${race.name}</strong><span>${race.speed} фт. · ${race.darkvision ? `тёмное зрение ${race.darkvision}` : "обычное зрение"}</span></article><article><small>Предыстория</small><strong>${background.name}</strong><span>${background.summary}</span></article><article><small>Уровень</small><strong>${level}</strong><span>Мастерство ${signed(rules.proficiency(level))}</span></article>`;
  };

  const refreshStatsSummary = () => {
    const { classKey, level } = currentKeys();
    const stats = Object.fromEntries(statInputs().map(input => [input.dataset.builderStat, Number(input.value || 10)]));
    const base = Object.fromEntries(statInputs().map(input => [input.dataset.builderStat, Number(input.dataset.base || input.value || 10)]));
    const hp = rules.fixedHp(rules.classes[classKey].hitDie, level, modifier(stats.con));
    const pointBuy = rules.pointBuyTotal(base);
    $("#builder-stat-summary").innerHTML = `<span><small>Максимум HP</small><strong>${hp}</strong></span><span><small>Инициатива</small><strong>${signed(modifier(stats.dex))}</strong></span><span><small>Покупка очков</small><strong class="${pointBuy !== null && pointBuy > 27 ? "danger-text" : ""}">${pointBuy === null ? "свой набор" : `${pointBuy}/27`}</strong></span><span><small>Главная характеристика</small><strong>${abilities[rules.statPriorities[classKey][0]]} ${stats[rules.statPriorities[classKey][0]]}</strong></span>`;
  };

  const refreshSkills = (autoPick = false) => {
    const { classKey, raceKey, backgroundKey } = currentKeys();
    const background = rules.backgrounds[backgroundKey], race = rules.races[raceKey], rule = rules.classSkills[classKey];
    const granted = [...new Set([...(background.skills || []), ...(race.skills || [])])];
    const options = (rule?.options || []).filter(key => !granted.includes(key));
    const previous = new Set($$('[data-builder-skill]:checked').map(input => input.dataset.builderSkill));
    const chosen = options.filter(key => previous.has(key)).slice(0, rule?.count || 0);
    if (autoPick || !chosen.length) options.forEach(key => { if (chosen.length < (rule?.count || 0) && !chosen.includes(key)) chosen.push(key); });
    $("#builder-background-skills").innerHTML = `<span>${background.name} и ${race.name} уже дают:</span>${granted.map(key => `<b>${skillName(key)}</b>`).join("") || "<b>свободный выбор</b>"}`;
    $("#builder-skills").innerHTML = options.map(key => `<label class="skill-choice"><input type="checkbox" data-builder-skill="${key}" ${chosen.includes(key) ? "checked" : ""}><i></i><span>${skillName(key)}</span></label>`).join("");
    $$('[data-builder-skill]').forEach(input => input.addEventListener("change", () => {
      const checked = $$('[data-builder-skill]:checked');
      if (checked.length > (rule?.count || 0)) input.checked = false;
      refreshExpertise(false); refreshReview();
    }));
  };

  const refreshExpertise = (autoPick = false) => {
    const { classKey, raceKey, backgroundKey, level } = currentKeys();
    const count = Array.from({length:level}, (_,index) => rules.expertiseChoicesAt(classKey,index + 1)).reduce((sum,value) => sum + value, 0);
    const root = $("#builder-expertise");
    if (!count) { root.innerHTML = ""; return; }
    const background = rules.backgrounds[backgroundKey], race = rules.races[raceKey];
    const available = [...new Set([...(background.skills || []), ...(race.skills || []), ...$$('[data-builder-skill]:checked').map(input => input.dataset.builderSkill)])];
    const previous = new Set($$('[data-builder-expertise]:checked').map(input => input.dataset.builderExpertise));
    const selected = available.filter(key => previous.has(key) || (s.expertise || []).includes(key)).slice(0,count);
    if (autoPick || !selected.length) available.forEach(key => { if (selected.length < count && !selected.includes(key)) selected.push(key); });
    root.innerHTML = `<div class="builder-section-head"><div><span class="eyebrow">Особенность ${rules.classes[classKey].name.toLowerCase()}</span><h3>Компетентность: выбери ${count}</h3></div><span class="builder-counter" id="builder-expertise-count">${selected.length}/${count}</span></div><p class="builder-help">Для выбранных навыков бонус мастерства удваивается. Это особенно важно для плута.</p><div class="builder-skills-v2">${available.map(key => `<label class="skill-choice expertise-choice"><input type="checkbox" data-builder-expertise="${key}" ${selected.includes(key) ? "checked" : ""}><i></i><span>${skillName(key)}</span></label>`).join("")}</div>`;
    $$('[data-builder-expertise]').forEach(input => input.addEventListener("change", () => {
      const checked = $$('[data-builder-expertise]:checked');
      if (checked.length > count) input.checked = false;
      $("#builder-expertise-count").textContent = `${$$('[data-builder-expertise]:checked').length}/${count}`;
      refreshReview();
    }));
  };

  const refreshReview = () => {
    const { classKey, raceKey, backgroundKey, level } = currentKeys();
    const cls = rules.classes[classKey], race = rules.races[raceKey], background = rules.backgrounds[backgroundKey], rule = rules.classSkills[classKey];
    const chosen = $$('[data-builder-skill]:checked').map(input => input.dataset.builderSkill);
    $("#builder-skill-count").textContent = `${chosen.length}/${rule?.count || 0} навыков класса`;
    $("#builder-review").innerHTML = `<div><span class="eyebrow">Готовый персонаж</span><h3>${esc($("#builder-name").value.trim() || "Безымянный герой")}</h3><p>${race.name} · ${cls.name}${$("#builder-subclass").value ? `, ${esc($("#builder-subclass").value)}` : ""} · ${level} уровень · ${background.name}</p></div><div class="review-tags"><span>HP рассчитаны</span><span>КД рассчитана</span><span>Спасброски класса</span><span>Ячейки по уровню</span></div>`;
  };

  const showStep = step => {
    currentStep = step;
    $$('[data-builder-page]').forEach(page => page.classList.toggle("hidden", page.dataset.builderPage !== step));
    $$('[data-builder-step]').forEach(button => button.classList.toggle("active", button.dataset.builderStep === step));
    const order = ["identity","abilities","details"], index = order.indexOf(step);
    $("#builder-back").classList.toggle("hidden", index === 0);
    $("#builder-next").classList.toggle("hidden", index === order.length - 1);
    $("#builder-finish").classList.toggle("hidden", index !== order.length - 1);
    if (step === "abilities" && autoStats) applyRecommendedStats();
    if (step === "details") { refreshSkills(!s.classKey); refreshExpertise(!s.classKey); refreshReview(); }
  };

  const finish = async instant => {
    const { classKey, raceKey, backgroundKey, level } = currentKeys();
    if (instant) { applyRecommendedStats(); refreshSkills(true); refreshExpertise(true); }
    const cls = rules.classes[classKey], race = rules.races[raceKey], background = rules.backgrounds[backgroundKey], skillRule = rules.classSkills[classKey];
    const selectedClassSkills = $$('[data-builder-skill]:checked').map(input => input.dataset.builderSkill);
    const selectedExpertise = $$('[data-builder-expertise]:checked').map(input => input.dataset.builderExpertise);
    const expertiseCount = Array.from({length:level}, (_,index) => rules.expertiseChoicesAt(classKey,index + 1)).reduce((sum,value) => sum + value, 0);
    if (selectedClassSkills.length < (skillRule?.count || 0) && !instant) return toast(`Выбери ещё ${(skillRule?.count || 0) - selectedClassSkills.length} навык(а)`);
    if (selectedExpertise.length < expertiseCount && !instant) return toast(`Выбери ещё ${expertiseCount - selectedExpertise.length} навык(а) для компетентности`);
    const next = structuredClone(currentSheet());
    next.characterName = $("#builder-name").value.trim() || next.characterName || "Безымянный герой";
    next.classKey = classKey; next.className = cls.name; next.raceKey = raceKey; next.race = race.name;
    next.backgroundKey = backgroundKey; next.background = background.name; next.level = level;
    next.subclass = level >= rules.subclassLevel(classKey) ? $("#builder-subclass").value : ""; next.subclassKey = next.subclass;
    next.classes = [{ key:classKey, name:cls.name, subclass:next.subclass, level, hitDie:cls.hitDie, spellAbility:cls.spellAbility || "" }];
    next.levelProgression = Array.from({ length:level }, (_, index) => ({ level:index + 1, classKey, classLevel:index + 1 }));
    next.creationMethod = instant ? "quick" : "builder";
    next.stats = Object.fromEntries(statInputs().map(input => [input.dataset.builderStat, Math.max(1, Math.min(30, Number(input.value || 10)))]));
    next.autoProficiency = true; next.autoSpellSlots = true; next.autoArmorClass = $("#builder-ac").checked;
    next.proficiency = rules.proficiency(level); next.saveProficiencies = [...cls.saves];
    next.skillProficiencies = [...new Set([...(background.skills || []), ...(race.skills || []), ...selectedClassSkills])];
    next.expertise = [...new Set(selectedExpertise)];
    next.spellcastingAbility = cls.spellAbility || "";
    next.hitDieSize = cls.hitDie; next.hitDiceMax = level; next.hitDiceCurrent = level; next.hitDicePools = [{ sides:cls.hitDie, total:level, current:level }];
    const recommendedAdvancements = rules.abilityBuild(classKey, raceKey, level).advancements;
    next.abilityAdvancements = recommendedAdvancements.map(entry => autoStats || instant ? entry : { ...entry, abilityIncreases:{}, manual:true });
    next.feats = [];
    next.armorProficiencies = cls.armor; next.weaponProficiencies = cls.weapons;
    next.toolProficiencies = background.tools || ""; next.languages = [race.languages, background.languages].filter(value => value && value !== "—").join("; ");
    next.size = race.size; next.speed = race.speed; next.darkvision = race.darkvision; next.ancestryTraits = race.traits;
    next.xp = Math.max(Number(next.xp || 0), rules.xpForLevel(level));
    if ($("#builder-hp").checked || instant) { next.hpMax = rules.fixedHp(cls.hitDie, level, modifier(next.stats.con)); next.hpCurrent = next.hpMax; next.hpTemp = 0; }
    const totals = rules.slotsFor(classKey, level);
    next.spellSlots = Array.from({length:9}, (_,i) => ({ level:i+1, total:Number(totals[i] || 0), used:0 }));
    const automaticNames = new Set((cls.resources(level, next) || []).map(resource => resource.name));
    next.resources = next.resources.filter(resource => !resource.automatic || automaticNames.has(resource.name));
    (cls.resources(level, next) || []).forEach(source => {
      const existing = next.resources.find(resource => resource.name === source.name);
      if (existing) Object.assign(existing, source, { current:source.max, automatic:true });
      else next.resources.push({ id:uuid(), ...source, current:source.max, automatic:true });
    });
    if ($("#builder-equipment").checked || instant) addStarterEquipment(next, classKey, backgroundKey);
    if ($("#builder-spells").checked || instant) { try { await addStarterSpells(next, classKey, level); } catch { toast("Персонаж создан, но справочник заклинаний не загрузился"); } }
    if (next.autoArmorClass) next.ac = calculateAc(next);
    syncCharacterMechanics(next);
    closeModal(); saveNow(next, "Персонаж готов", instant ? "Быстрое создание персонажа" : "Мастер персонажа"); renderSheet();
  };

  ["builder-class","builder-race","builder-background","builder-level"].forEach(id => $("#" + id).addEventListener("change", () => {
    refreshConcept();
    if (autoStats) applyRecommendedStats();
    if (currentStep === "details") { refreshSkills(true); refreshExpertise(true); refreshReview(); }
  }));
  $("#builder-name").addEventListener("input", refreshReview);
  statInputs().forEach(input => input.addEventListener("input", () => { autoStats = false; input.dataset.base = Number(input.value || 10) - Number(input.dataset.bonus || 0); refreshStatsSummary(); }));
  $("#builder-recommended").addEventListener("click", applyRecommendedStats);
  $("#builder-instant").addEventListener("click", () => finish(true));
  $("#builder-next").addEventListener("click", () => showStep(currentStep === "identity" ? "abilities" : "details"));
  $("#builder-back").addEventListener("click", () => showStep(currentStep === "details" ? "abilities" : "identity"));
  $("#builder-finish").addEventListener("click", () => finish(false));
  $$('[data-builder-step]').forEach(button => button.addEventListener("click", () => showStep(button.dataset.builderStep)));
  refreshConcept(); applyRecommendedStats(); showStep("identity");
}

const multiclassProficiencies = {
  barbarian:{ armor:"Лёгкие и средние доспехи, щиты", weapons:"Простое и воинское оружие" },
  bard:{ armor:"Лёгкие доспехи", skill:true },
  cleric:{ armor:"Лёгкие и средние доспехи, щиты" },
  druid:{ armor:"Лёгкие и средние неметаллические доспехи, щиты" },
  fighter:{ armor:"Лёгкие и средние доспехи, щиты", weapons:"Простое и воинское оружие" },
  monk:{ weapons:"Простое оружие, короткие мечи" },
  paladin:{ armor:"Лёгкие и средние доспехи, щиты", weapons:"Простое и воинское оружие" },
  ranger:{ armor:"Лёгкие и средние доспехи, щиты", weapons:"Простое и воинское оружие", skill:true },
  rogue:{ armor:"Лёгкие доспехи", tools:"Воровские инструменты", skill:true }
};

function multiclassEligibility(sheet, targetKey) {
  if (hasClass(sheet, targetKey)) return { ok:true, checks:[] };
  const keys = [...new Set([...classEntries(sheet).map(entry => entry.key), targetKey])];
  const checks = keys.map(key => ({ key, ok:rules.meetsRequirement(key, sheet.stats), text:rules.requirementText(key) }));
  return { ok:checks.every(check => check.ok), checks };
}

function openLevelUpWizard() {
  const current = currentSheet();
  const oldTotal = totalLevel(current);
  if (!classEntries(current).length) return openCharacterBuilderV2(true);
  if (oldTotal >= 20) return toast("Достигнут максимальный 20 уровень");
  const selectedKey = classEntries(current)[0].key;
  $("#game-modal").classList.add("library-open", "builder-modal");
  openModal("Повышение уровня", `
    <div class="level-up-wizard">
      <header class="level-up-hero"><div><span class="eyebrow">Новая глава</span><h3>${esc(current.characterName || "Герой")}: ${oldTotal} → ${oldTotal + 1}</h3><p>Продолжи текущий путь или возьми первый уровень другого класса.</p></div><div class="level-up-number">${oldTotal + 1}</div></header>
      <div class="level-up-grid"><label>Куда вложить уровень<select id="level-up-class">${Object.entries(rules.classes).map(([key, cls]) => `<option value="${key}" ${key === selectedKey ? "selected" : ""}>${cls.name}${hasClass(current,key) ? ` · сейчас ${classLevel(current,key)}` : " · новый класс"}</option>`).join("")}</select></label><label>Прирост HP<select id="level-up-hp"><option value="fixed">Среднее значение</option><option value="roll">Бросить кость хитов</option></select></label></div>
      <div id="level-up-eligibility"></div>
      <div id="level-up-subclass"></div>
      <div id="level-up-skill"></div>
      <div id="level-up-expertise"></div>
      <div id="level-up-advancement"></div>
      <section class="level-choice level-gains-panel"><div class="panel-heading"><div><span class="eyebrow">Что откроется</span><h3>Новые возможности уровня</h3></div></div><div id="level-up-gains" class="level-gains"></div></section>
      <div id="level-up-preview" class="level-up-preview"></div>
      <footer class="builder-footer"><button id="level-up-cancel" class="secondary" type="button">Отмена</button><span></span><button id="level-up-apply" class="primary" type="button">Получить ${oldTotal + 1} уровень</button></footer>
    </div>`);

  const targetData = () => {
    const key = $("#level-up-class").value;
    return { key, cls:rules.classes[key], existing:hasClass(current,key), nextClassLevel:classLevel(current,key) + 1 };
  };

  const renderFeatDetails = () => {
    const select = $("#level-up-feat");
    if (!select) return;
    const feat = rules.feats[select.value];
    const abilityOptions = feat?.abilityChoices || [];
    const availableSkills = skills.filter(([key]) => !current.skillProficiencies.includes(key));
    $("#level-up-feat-detail").innerHTML = `<p>${esc(feat?.summary || "")}</p>${abilityOptions.length ? `<label>Характеристика<select id="level-up-feat-ability">${abilityOptions.map(key => `<option value="${key}">${abilities[key]}</option>`).join("")}</select></label>` : ""}${select.value === "skilled" ? `<div><small>Выбери три навыка</small><div class="level-skill-picks">${availableSkills.map(([key,name]) => `<label><input type="checkbox" data-level-feat-skill="${key}"><span>${name}</span></label>`).join("")}</div></div>` : ""}`;
    $$('[data-level-feat-skill]').forEach(input => input.addEventListener("change", () => {
      if ($$('[data-level-feat-skill]:checked').length > 3) input.checked = false;
      updatePreview();
    }));
    $("#level-up-feat-ability")?.addEventListener("change", updatePreview);
    updatePreview();
  };

  const renderAdvancement = () => {
    const { key, nextClassLevel } = targetData();
    const panel = $("#level-up-advancement");
    if (!rules.isAsiLevel(key, nextClassLevel)) { panel.innerHTML = ""; return; }
    const availableFeats = Object.entries(rules.feats).filter(([featKey]) => !hasFeat(current, featKey));
    panel.innerHTML = `<section class="level-choice"><div class="panel-heading"><div><span class="eyebrow">Выбор развития</span><h3>Характеристики или черта</h3></div><span class="required-badge">обязательно</span></div><div class="advancement-tabs"><button class="active" data-advancement="asi2" type="button">+2 к одной</button><button data-advancement="asi11" type="button">+1 к двум</button><button data-advancement="feat" type="button">Черта</button></div><input id="level-up-advancement-type" type="hidden" value="asi2"><div id="level-up-advancement-detail"></div></section>`;
    const showChoice = type => {
      $("#level-up-advancement-type").value = type;
      $$('[data-advancement]').forEach(button => button.classList.toggle("active", button.dataset.advancement === type));
      const detail = $("#level-up-advancement-detail");
      if (type === "asi2") detail.innerHTML = `<label>Повысить на 2<select id="level-up-ability-a">${Object.entries(abilities).map(([ability,name]) => `<option value="${ability}">${name} · сейчас ${Number(current.stats[ability])}</option>`).join("")}</select></label>`;
      else if (type === "asi11") detail.innerHTML = `<div class="two-col"><label>Первая +1<select id="level-up-ability-a">${Object.entries(abilities).map(([ability,name]) => `<option value="${ability}">${name}</option>`).join("")}</select></label><label>Вторая +1<select id="level-up-ability-b">${Object.entries(abilities).map(([ability,name],index) => `<option value="${ability}" ${index === 1 ? "selected" : ""}>${name}</option>`).join("")}</select></label></div>`;
      else detail.innerHTML = `<label>Выбрать черту<select id="level-up-feat">${availableFeats.map(([featKey,feat]) => `<option value="${featKey}">${feat.name}</option>`).join("")}</select></label><div id="level-up-feat-detail" class="feat-detail"></div>`;
      $("#level-up-ability-a")?.addEventListener("change", updatePreview);
      $("#level-up-ability-b")?.addEventListener("change", updatePreview);
      $("#level-up-feat")?.addEventListener("change", renderFeatDetails);
      if (type === "feat") renderFeatDetails(); else updatePreview();
    };
    $$('[data-advancement]').forEach(button => button.addEventListener("click", () => showChoice(button.dataset.advancement)));
    showChoice("asi2");
  };

  const renderLevelExpertise = () => {
    const { key, nextClassLevel } = targetData(), count = rules.expertiseChoicesAt(key,nextClassLevel), root = $("#level-up-expertise");
    if (!count) { root.innerHTML = ""; return; }
    const addedSkill = $("#level-up-multiclass-skill")?.value;
    const available = [...new Set([...(current.skillProficiencies || []), ...(addedSkill ? [addedSkill] : [])])].filter(skillKey => !(current.expertise || []).includes(skillKey));
    root.innerHTML = `<section class="level-choice"><div class="panel-heading"><div><span class="eyebrow">Классовый выбор</span><h3>Компетентность: выбери ${count}</h3></div><span id="level-expertise-count" class="required-badge">0/${count}</span></div><p class="builder-help">Бонус мастерства выбранных навыков будет удвоен.</p><div class="level-skill-picks">${available.map(skillKey => `<label><input type="checkbox" data-level-expertise="${skillKey}"><span>${skillName(skillKey)}</span></label>`).join("")}</div></section>`;
    $$('[data-level-expertise]').forEach(input => input.addEventListener("change", () => {
      if ($$('[data-level-expertise]:checked').length > count) input.checked = false;
      $("#level-expertise-count").textContent = `${$$('[data-level-expertise]:checked').length}/${count}`;
      updatePreview();
    }));
  };

  const renderTarget = () => {
    const { key, cls, existing, nextClassLevel } = targetData();
    const eligibility = multiclassEligibility(current, key);
    $("#level-up-eligibility").innerHTML = existing ? `<div class="eligibility ok">${classGlyph(key)}<span><strong>Продолжение класса</strong><small>${cls.name} ${classLevel(current,key)} → ${nextClassLevel}</small></span></div>` : `<div class="eligibility ${eligibility.ok ? "ok" : "fail"}">${classGlyph(key)}<span><strong>${eligibility.ok ? "Мультикласс доступен" : "Не хватает характеристик"}</strong><small>${eligibility.checks.map(check => `${rules.classes[check.key]?.name}: ${check.text} ${check.ok ? "✓" : "✕"}`).join(" · ")}</small></span></div>`;
    const unlock = rules.subclassLevel(key);
    const oldEntry = classEntries(current).find(entry => entry.key === key);
    const chooseSubclass = nextClassLevel >= unlock && !oldEntry?.subclass;
    $("#level-up-subclass").innerHTML = chooseSubclass ? `<section class="level-choice"><span class="eyebrow">Подкласс</span><h3>Выбери направление ${cls.name.toLowerCase()}</h3><select id="level-up-subclass-select"><option value="">Выбрать позже</option>${(rules.subclasses[key] || []).map(name => `<option>${name}</option>`).join("")}</select></section>` : "";
    const grants = !existing && multiclassProficiencies[key]?.skill;
    const skillOptions = (rules.classSkills[key]?.options || skills.map(([skillKey]) => skillKey)).filter(skillKey => !current.skillProficiencies.includes(skillKey));
    $("#level-up-skill").innerHTML = grants ? `<section class="level-choice"><span class="eyebrow">Мультикласс</span><h3>Дополнительный навык</h3><select id="level-up-multiclass-skill">${skillOptions.map(skillKey => `<option value="${skillKey}">${skillName(skillKey)}</option>`).join("")}</select></section>` : "";
    renderAdvancement();
    renderLevelExpertise();
    $("#level-up-gains").innerHTML = levelFeaturesMarkup(key,nextClassLevel) + commonLevelFeaturesMarkup(oldTotal + 1);
    $("#level-up-subclass-select")?.addEventListener("change", updatePreview);
    $("#level-up-multiclass-skill")?.addEventListener("change", () => { renderLevelExpertise(); updatePreview(); });
    $("#level-up-apply").disabled = !eligibility.ok;
    updatePreview();
  };

  function updatePreview() {
    const { key, cls, nextClassLevel } = targetData();
    const fixed = Math.floor(cls.hitDie / 2) + 1;
    const hpText = $("#level-up-hp").value === "roll" ? `1к${cls.hitDie} + ТЕЛ` : `${fixed} + ТЕЛ`;
    const choiceType = $("#level-up-advancement-type")?.value;
    let choice = "Новый классовый уровень";
    if (choiceType === "asi2") choice = `+2 ${abilities[$("#level-up-ability-a")?.value] || "к характеристике"}`;
    if (choiceType === "asi11") choice = `+1 ${abilities[$("#level-up-ability-a")?.value]} и +1 ${abilities[$("#level-up-ability-b")?.value]}`;
    if (choiceType === "feat") choice = rules.feats[$("#level-up-feat")?.value]?.name || "Черта";
    $("#level-up-preview").innerHTML = `<div>${classGlyph(key)}<span><small>Класс</small><strong>${cls.name} ${nextClassLevel}</strong></span></div><div><span><small>HP</small><strong>${hpText}</strong></span></div><div><span><small>Развитие</small><strong>${esc(choice)}</strong></span></div>`;
  }

  const applyLevel = hitRoll => {
    const { key, cls, existing, nextClassLevel } = targetData();
    const eligibility = multiclassEligibility(current, key);
    if (!eligibility.ok) return toast("Характеристики пока не подходят для этого мультикласса");
    const expertiseRequired = rules.expertiseChoicesAt(key,nextClassLevel);
    const expertisePicks = $$('[data-level-expertise]:checked').map(input => input.dataset.levelExpertise);
    if (expertisePicks.length < expertiseRequired) return toast(`Выбери ${expertiseRequired} навык(а) для компетентности`);
    const next = structuredClone(current);
    next.classes = classEntries(next).map(entry => ({ ...entry }));
    next.levelProgression = levelProgression(next).map(entry => ({ ...entry }));
    next.abilityAdvancements = Array.isArray(next.abilityAdvancements) ? next.abilityAdvancements : [];
    next.feats = Array.isArray(next.feats) ? next.feats : [];
    const oldCon = modifier(next.stats.con);
    if (existing) {
      const entry = next.classes.find(item => item.key === key);
      entry.level += 1;
      if (!entry.subclass && $("#level-up-subclass-select")?.value) entry.subclass = $("#level-up-subclass-select").value;
    } else {
      next.classes.push({ key, name:cls.name, subclass:$("#level-up-subclass-select")?.value || "", level:1, hitDie:cls.hitDie, spellAbility:cls.spellAbility || "" });
      const grants = multiclassProficiencies[key] || {};
      next.armorProficiencies = mergeText(next.armorProficiencies, grants.armor);
      next.weaponProficiencies = mergeText(next.weaponProficiencies, grants.weapons);
      next.toolProficiencies = mergeText(next.toolProficiencies, grants.tools);
      if ($("#level-up-multiclass-skill")?.value) next.skillProficiencies = [...new Set([...next.skillProficiencies, $("#level-up-multiclass-skill").value])];
      if (!next.spellcastingAbility && cls.spellAbility) next.spellcastingAbility = cls.spellAbility;
    }
    let advancementChoice = "";
    let newlyTough = false;
    if (rules.isAsiLevel(key, nextClassLevel)) {
      const type = $("#level-up-advancement-type").value;
      const increases = {};
      if (type === "asi2") {
        const ability = $("#level-up-ability-a").value;
        increases[ability] = Math.min(2, Math.max(0, 20 - Number(next.stats[ability])));
      } else if (type === "asi11") {
        const first = $("#level-up-ability-a").value, second = $("#level-up-ability-b").value;
        if (first === second) return toast("Для варианта +1/+1 выбери две разные характеристики");
        increases[first] = Math.min(1, Math.max(0, 20 - Number(next.stats[first])));
        increases[second] = Math.min(1, Math.max(0, 20 - Number(next.stats[second])));
      } else {
        const feat = $("#level-up-feat").value, info = rules.feats[feat];
        if (!feat || hasFeat(next, feat)) return toast("Выбери новую черту");
        const featAbility = $("#level-up-feat-ability")?.value || "";
        if (featAbility) increases[featAbility] = Math.min(1, Math.max(0, 20 - Number(next.stats[featAbility])));
        const featSkills = $$('[data-level-feat-skill]:checked').map(input => input.dataset.levelFeatSkill);
        if (feat === "skilled" && featSkills.length !== 3) return toast("Для черты «Умелец» выбери три навыка");
        next.skillProficiencies = [...new Set([...next.skillProficiencies, ...featSkills])];
        if (feat === "resilient" && featAbility) next.saveProficiencies = [...new Set([...next.saveProficiencies, featAbility])];
        if (feat === "mobile") next.speed = Number(next.speed || 0) + 10;
        if (feat === "lucky" && !next.resources.some(resource => resource.automaticKey === "feat:lucky")) next.resources.push({ id:uuid(), name:"Очки удачи", current:3, max:3, reset:"long", automatic:true, automaticKey:"feat:lucky" });
        newlyTough = feat === "tough";
        next.feats.push({ key:feat, name:info.name, ability:featAbility, classKey:key, classLevel:nextClassLevel, atLevel:oldTotal + 1, skillProficiencies:featSkills });
        advancementChoice = info.name;
      }
      Object.entries(increases).forEach(([ability, amount]) => { next.stats[ability] = Math.min(20, Number(next.stats[ability]) + Number(amount)); });
      next.abilityAdvancements.push({ id:uuid(), classKey:key, classLevel:nextClassLevel, totalLevel:oldTotal + 1, type:type === "feat" ? "feat" : "asi", abilityIncreases:increases, featKey:type === "feat" ? $("#level-up-feat").value : "" });
      if (!advancementChoice) advancementChoice = Object.entries(increases).map(([ability,amount]) => `${abilities[ability]} +${amount}`).join(", ");
    }
    const newCon = modifier(next.stats.con);
    const baseGain = Math.max(1, Number(hitRoll) + newCon);
    const toughGain = (hasFeat(current, "tough") ? 2 : 0) + (newlyTough ? 2 * (oldTotal + 1) : 0);
    const hpGain = Math.max(1, baseGain + (newCon - oldCon) * oldTotal + toughGain);
    next.hpMax = Math.max(1, Number(next.hpMax || 0) + hpGain);
    next.hpCurrent = Math.min(next.hpMax, Number(next.hpCurrent || 0) + hpGain);
    next.expertise = [...new Set([...(next.expertise || []), ...expertisePicks])];
    if (expertisePicks.length) advancementChoice = [advancementChoice, `Компетентность: ${expertisePicks.map(skillName).join(", ")}`].filter(Boolean).join(" · ");
    next.xp = Math.max(Number(next.xp || 0), rules.xpForLevel(oldTotal + 1));
    next.levelProgression.push({ level:oldTotal + 1, classKey:key, classLevel:nextClassLevel, choice:advancementChoice });
    syncCharacterMechanics(next);
    closeModal(); saveNow(next, `${oldTotal + 1} уровень получен`, `Повышение уровня: ${cls.name} ${nextClassLevel}`); renderSheet();
    toast(`Готово: ${cls.name} ${nextClassLevel}, +${hpGain} HP`);
  };

  $("#level-up-class").addEventListener("change", renderTarget);
  $("#level-up-hp").addEventListener("change", updatePreview);
  $("#level-up-cancel").addEventListener("click", closeModal);
  $("#level-up-apply").addEventListener("click", () => {
    const { cls } = targetData();
    if ($("#level-up-hp").value === "roll") socket.emit("dice:roll", { formula:`1к${cls.hitDie}`, label:`HP за новый уровень · к${cls.hitDie}`, mode:"normal" }, response => response.ok ? applyLevel(response.total) : toast(response.error));
    else applyLevel(Math.floor(cls.hitDie / 2) + 1);
  });
  renderTarget();
}

function openCharacterBuilder() {
  const s = currentSheet();
  const statPriority = {
    barbarian:["str","con","dex","wis","cha","int"], bard:["cha","dex","con","wis","int","str"], cleric:["wis","con","str","dex","cha","int"],
    druid:["wis","con","dex","int","cha","str"], fighter:["str","con","dex","wis","cha","int"], monk:["dex","wis","con","str","int","cha"],
    paladin:["str","cha","con","wis","dex","int"], ranger:["dex","wis","con","str","int","cha"], rogue:["dex","con","cha","wis","int","str"],
    sorcerer:["cha","con","dex","wis","int","str"], warlock:["cha","con","dex","wis","int","str"], wizard:["int","con","dex","wis","cha","str"]
  };
  const guessedClass = s.classKey || Object.entries(rules.classes).find(([,value]) => value.name.toLowerCase() === String(s.className).toLowerCase())?.[0] || "rogue";
  const guessedRace = s.raceKey || Object.entries(rules.races).find(([,value]) => value.name.toLowerCase() === String(s.race).toLowerCase())?.[0] || "custom";
  $("#game-modal").classList.add("library-open");
  openModal("Мастер персонажа", `
    <div class="builder-intro"><strong>Безопасная автоматизация</strong><span>Существующие заметки, предметы, атаки и заклинания останутся на месте.</span></div>
    <div class="builder-grid">
      <label>Класс<select id="builder-class">${Object.entries(rules.classes).map(([key,value]) => `<option value="${key}" ${key === guessedClass ? "selected" : ""}>${value.name} · к${value.hitDie}</option>`).join("")}</select></label>
      <label>Раса<select id="builder-race">${Object.entries(rules.races).map(([key,value]) => `<option value="${key}" ${key === guessedRace ? "selected" : ""}>${value.name}</option>`).join("")}</select></label>
      <label>Уровень<input id="builder-level" type="number" min="1" max="20" value="${Number(s.level || 1)}"></label>
      <label>Имя класса вручную<input id="builder-custom-class" value="${esc(s.className || rules.classes[guessedClass]?.name || "")}"></label>
      <label>Имя расы вручную<input id="builder-custom-race" value="${esc(s.race || rules.races[guessedRace]?.name || "")}"></label>
      <label>Бонус инициативы<input id="builder-initiative" type="number" value="${Number(s.initiativeBonus || 0)}"></label>
    </div>
    <div class="section-actions builder-stat-actions"><h3 class="panel-title">Характеристики</h3><button id="builder-standard" class="secondary" type="button">Стандартный массив</button><button id="builder-tens" class="secondary" type="button">Все по 10</button></div>
    <div class="ability-builder">${Object.entries(abilities).map(([key,name]) => `<label>${name}<input data-builder-stat="${key}" type="number" min="1" max="30" value="${Number(s.stats[key] || 10)}"><small>${signed(modifier(s.stats[key]))}</small></label>`).join("")}</div>
    <h3 class="panel-title">Автоматизация</h3>
    <div class="automation-options">
      <label class="condition-chip"><input id="builder-prof" type="checkbox" ${s.autoProficiency !== false ? "checked" : ""}>Бонус мастерства по уровню</label>
      <label class="condition-chip"><input id="builder-slots" type="checkbox" ${s.autoSpellSlots !== false ? "checked" : ""}>Ячейки по классу и уровню</label>
      <label class="condition-chip"><input id="builder-ac" type="checkbox" ${s.autoArmorClass ? "checked" : ""}>КД по надетой броне</label>
      <label class="condition-chip"><input id="builder-saves" type="checkbox" checked>Классовые спасброски</label>
      <label class="condition-chip"><input id="builder-hp" type="checkbox" ${!s.classKey ? "checked" : ""}>Пересчитать максимум HP по среднему</label>
      <label class="condition-chip"><input id="builder-init-adv" type="checkbox" ${s.initiativeAdvantage ? "checked" : ""}>Преимущество инициативы</label>
    </div>
    <h3 class="panel-title">Навыки <span id="builder-skill-count"></span></h3>
    <div class="builder-skills">${skills.map(([key,name]) => `<label><input type="checkbox" data-builder-skill="${key}" ${s.skillProficiencies.includes(key) ? "checked" : ""}>${name}</label>`).join("")}</div>
    <div id="builder-preview" class="read-only"></div>
    <div class="modal-actions"><button id="builder-apply" class="primary">Применить</button><button id="builder-cancel" class="secondary">Отмена</button></div>`);

  const refreshPreview = () => {
    const classKey = $("#builder-class").value;
    const cls = rules.classes[classKey];
    const race = rules.races[$("#builder-race").value];
    const level = Math.max(1, Math.min(20, Number($("#builder-level").value || 1)));
    const con = modifier($('[data-builder-stat="con"]').value);
    const slots = rules.slotsFor(classKey, level);
    const stats = Object.fromEntries($$('[data-builder-stat]').map(input => [input.dataset.builderStat, Number(input.value)]));
    const pointBuy = rules.pointBuyTotal(stats);
    const skillRule = rules.classSkills[classKey];
    const selectedSkills = $$('[data-builder-skill]:checked').length;
    $("#builder-skill-count").textContent = `· выбрано ${selectedSkills}${skillRule ? ` · класс даёт ${skillRule.count}` : ""}`;
    $$('[data-builder-skill]').forEach(input => input.closest("label").classList.toggle("recommended", Boolean(skillRule?.options.includes(input.dataset.builderSkill))));
    $("#builder-preview").innerHTML = `<strong>${cls.name} ${level}</strong> · мастерство ${signed(rules.proficiency(level))} · кость хитов к${cls.hitDie} · средние HP ${rules.fixedHp(cls.hitDie, level, con)} · КД ${calculateAc({ ...s, classKey, stats, autoArmorClass:true })} · скорость ${race.speed} · ячейки ${slots.some(Boolean) ? slots.map((n,i)=>n ? `${i+1}:${n}` : "").filter(Boolean).join(" / ") : "нет"}<br><span class="${pointBuy !== null && pointBuy > 27 ? "danger-text" : ""}">Покупка характеристик: ${pointBuy === null ? "значения вне диапазона 8–15" : `${pointBuy}/27 очков`}</span>`;
  };
  $("#builder-class").addEventListener("change", () => { $("#builder-custom-class").value = rules.classes[$("#builder-class").value].name; refreshPreview(); });
  $("#builder-race").addEventListener("change", () => { $("#builder-custom-race").value = rules.races[$("#builder-race").value].name; refreshPreview(); });
  $("#builder-level").addEventListener("input", refreshPreview);
  $$('[data-builder-stat]').forEach(input => input.addEventListener("input", () => { input.nextElementSibling.textContent = signed(modifier(input.value)); refreshPreview(); }));
  $$('[data-builder-skill]').forEach(input => input.addEventListener("change", refreshPreview));
  $("#builder-standard").addEventListener("click", () => {
    const priority = statPriority[$("#builder-class").value] || Object.keys(abilities);
    [15,14,13,12,10,8].forEach((value,index) => {
      const input = $(`[data-builder-stat="${priority[index]}"]`);
      input.value = value; input.nextElementSibling.textContent = signed(modifier(value));
    });
    refreshPreview();
  });
  $("#builder-tens").addEventListener("click", () => { $$('[data-builder-stat]').forEach(input => { input.value = 10; input.nextElementSibling.textContent = "+0"; }); refreshPreview(); });
  $("#builder-cancel").addEventListener("click", closeModal);
  $("#builder-apply").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const classKey = $("#builder-class").value;
    const raceKey = $("#builder-race").value;
    const cls = rules.classes[classKey];
    const race = rules.races[raceKey];
    const level = Math.max(1, Math.min(20, Number($("#builder-level").value || 1)));
    next.stats = { ...next.stats };
    $$('[data-builder-stat]').forEach(input => next.stats[input.dataset.builderStat] = Math.max(1, Math.min(30, Number(input.value || 10))));
    next.classKey = classKey; next.raceKey = raceKey;
    next.className = $("#builder-custom-class").value.trim() || cls.name;
    next.race = $("#builder-custom-race").value.trim() || race.name;
    next.level = level; next.hitDieSize = cls.hitDie; next.hitDiceMax = level;
    next.hitDiceCurrent = Math.min(level, Math.max(0, Number(next.hitDiceCurrent || level)));
    next.autoProficiency = $("#builder-prof").checked;
    next.autoSpellSlots = $("#builder-slots").checked;
    next.autoArmorClass = $("#builder-ac").checked;
    next.initiativeBonus = Number($("#builder-initiative").value || 0);
    next.initiativeAdvantage = $("#builder-init-adv").checked;
    if (next.autoProficiency) next.proficiency = rules.proficiency(level);
    if ($("#builder-saves").checked) next.saveProficiencies = [...cls.saves];
    next.skillProficiencies = $$('[data-builder-skill]:checked').map(input => input.dataset.builderSkill);
    if (cls.spellAbility) next.spellcastingAbility = cls.spellAbility;
    next.armorProficiencies = cls.armor;
    next.weaponProficiencies = cls.weapons;
    next.size = race.size; next.speed = race.speed; next.darkvision = race.darkvision;
    next.ancestryTraits = race.traits;
    if ($("#builder-hp").checked) {
      const hp = rules.fixedHp(cls.hitDie, level, modifier(next.stats.con));
      const ratio = Number(next.hpMax || 0) ? Number(next.hpCurrent || 0) / Number(next.hpMax) : 1;
      next.hpMax = hp; next.hpCurrent = Math.max(0, Math.min(hp, Math.round(hp * ratio)));
    }
    if (next.autoSpellSlots) {
      const totals = rules.slotsFor(classKey, level);
      next.spellSlots = Array.from({length:9}, (_,i) => {
        const old = next.spellSlots?.find(slot => Number(slot.level) === i+1);
        const total = Number(totals[i] || 0);
        return { level:i+1, total, used:Math.min(total, Number(old?.used || 0)) };
      });
    }
    const automaticResources = cls.resources(level, next);
    automaticResources.forEach(source => {
      const existing = next.resources.find(item => item.name === source.name);
      if (existing) {
        const spent = Math.max(0, Number(existing.max || 0) - Number(existing.current || 0));
        existing.max = source.max; existing.current = Math.max(0, source.max - spent); existing.reset = source.reset; existing.automatic = true;
      } else next.resources.push({ id:uuid(), ...source, current:source.max, automatic:true });
    });
    if (next.autoArmorClass) next.ac = calculateAc(next);
    closeModal(); saveNow(next, "Персонаж настроен", "Мастер персонажа"); renderSheet();
  });
  refreshPreview();
}

function toggleInspiration() {
  const next = structuredClone(currentSheet());
  next.inspiration = !next.inspiration;
  saveNow(next, next.inspiration ? "Вдохновение получено" : "Вдохновение потрачено", "Вдохновение"); renderSheet();
}

function showConditionInfo(name) {
  openModal(name, `<div class="condition-description">${esc(rules.conditionInfo[name] || "Описание состояния пока не добавлено.")}</div><button id="condition-info-close" class="primary">Понятно</button>`);
  $("#condition-info-close").addEventListener("click", closeModal);
}

function filterOwnedSpells() {
  const query = $("#owned-spell-search")?.value.trim().toLowerCase() || "";
  const level = $("#owned-spell-level")?.value || "all";
  const prepared = $("#owned-spell-prepared")?.value || "all";
  $$('.spell-row', $("#owned-spells")).forEach(row => row.classList.toggle("hidden",
    (query && !row.dataset.spellName.includes(query)) ||
    (level !== "all" && row.dataset.spellLevel !== level) ||
    (prepared !== "all" && row.dataset.spellPrepared !== prepared)
  ));
}

function toggleSpellPrepared(id) {
  const next = structuredClone(currentSheet());
  const spell = next.spellsList.find(item => item.id === id); if (!spell) return;
  spell.prepared = !spell.prepared;
  const limit = preparedSpellLimit(next);
  const count = next.spellsList.filter(item => item.prepared && Number(item.level) > 0).length;
  if (spell.prepared && limit !== null && count > limit) toast(`Подготовлено ${count}/${limit} — лимит превышен`);
  saveNow(next, spell.prepared ? "Заклинание подготовлено" : "Заклинание убрано", "Подготовка заклинаний"); renderSheet();
}

function showSpellInfo(id) {
  showSpellInfoFor(currentSheet(), id);
}
function showSpellInfoFor(sheet, id) {
  const spell = sheet.spellsList.find(item => item.id === id); if (!spell) return;
  const formula = Array.isArray(spell.effectParts) && spell.effectParts.length ? formulaFromParts(spell.effectParts,sheet) : spell.damage;
  const kind = spellRollKind(spell);
  openModal(spell.name, `<div class="spell-detail"><div class="item-flags"><span>${Number(spell.level) ? `${spell.level} уровень` : "заговор"}</span><span>${esc(spell.school || "школа не указана")}</span>${kind === "healing" ? "<span>лечение</span>" : kind === "damage" ? "<span>урон</span>" : ""}${spell.ritual ? "<span>ритуал</span>" : ""}${spell.concentration ? "<span>концентрация</span>" : ""}</div><dl><dt>Накладывание</dt><dd>${esc(spell.castingTime || "—")}</dd><dt>Дистанция</dt><dd>${esc(spell.range || "—")}</dd><dt>Длительность</dt><dd>${esc(spell.duration || "—")}</dd>${formula ? `<dt>${kind === "healing" ? "Лечение" : "Урон"}</dt><dd>${esc(resolveDiceFormula(formula,sheet))}</dd>` : ""}${spell.upcastParts?.length ? `<dt>За круг выше</dt><dd>+${esc(resolveDiceFormula(formulaFromParts(spell.upcastParts,sheet),sheet))}</dd>` : ""}</dl><p>${esc(spell.description || "Описание не добавлено.")}</p></div><button id="spell-info-close" class="primary">Закрыть</button>`);
  $("#spell-info-close").addEventListener("click", closeModal);
}

function stopConcentration() {
  const next = structuredClone(currentSheet());
  next.concentrationSpellId = ""; next.concentrationSpellName = "";
  saveNow(next, "Концентрация завершена", "Концентрация"); renderSheet();
}

function openItemCatalog() {
  const catalog = [...rules.weapons, ...rules.armor, ...rules.gear];
  $("#game-modal").classList.add("library-open");
  openModal("Справочник снаряжения", `<div class="spell-library-tools"><label>Поиск<input id="item-search" placeholder="Лук, латы, зелье..."></label><label>Категория<select id="item-type"><option value="all">Все</option><option value="weapon">Оружие</option><option value="armor">Броня</option><option value="gear">Снаряжение</option></select></label></div><div id="item-catalog-results" class="item-catalog-results"></div>`);
  const refresh = () => {
    const query = $("#item-search").value.trim().toLowerCase();
    const type = $("#item-type").value;
    const found = catalog.filter(item => (type === "all" || item.type === type) && (!query || `${item.name} ${item.properties || ""}`.toLowerCase().includes(query)));
    $("#item-catalog-results").innerHTML = found.map(item => `<article class="catalog-item"><div><strong>${esc(item.name)}</strong><small>${item.type === "weapon" ? `${esc(item.damage)} ${esc(item.damageType)} · ${esc(item.properties || "")}` : item.type === "armor" ? `КД ${item.armorType === "shield" ? "+2" : item.baseAc} · ${item.armorType}` : "Обычное снаряжение"} · ${item.weight} фнт.</small></div><button class="primary" data-catalog-item="${item.key}">Добавить</button></article>`).join("");
    $$('[data-catalog-item]', $("#item-catalog-results")).forEach(button => button.addEventListener("click", () => {
      const source = catalog.find(item => item.key === button.dataset.catalogItem);
      const next = structuredClone(currentSheet());
      const itemId = uuid();
      next.inventoryList.push({ ...structuredClone(source), id:itemId, quantity:1, equipped:false, attuned:false, magical:false, description:source.properties || "" });
      if (source.type === "weapon") {
        const ability = source.ability === "finesse" ? (modifier(next.stats.dex) >= modifier(next.stats.str) ? "dex" : "str") : source.ability;
        const attackParts = [{ id:uuid(), type:"ability", value:ability },{ id:uuid(), type:"proficiency", value:"prof" }];
        const damageParts = [...parseFormulaParts(source.damage,"damage"),{ id:uuid(), type:"ability", value:ability }];
        next.attacksList.push({ id:uuid(), sourceItemId:itemId, name:source.name, attackParts, damageParts, bonus:formulaFromParts(attackParts,next), damage:formulaFromParts(damageParts,next), damageType:source.damageType });
      }
      saveNow(next, `${source.name} добавлен`, "Снаряжение");
      button.textContent = "Добавлено ✓"; button.disabled = true;
    }));
  };
  $("#item-search").addEventListener("input", refresh); $("#item-type").addEventListener("change", refresh); refresh();
}

function openSheetHistory() {
  socket.emit("sheet:history", {}, response => {
    if (!response.ok) return toast("История недоступна");
    openModal("История персонажа", `<p class="read-only">Хранятся последние 20 контрольных точек. Текущая версия перед откатом тоже сохранится.</p><div class="history-list">${response.history.length ? response.history.map(item => `<article><div><strong>${esc(item.label)}</strong><small>${new Date(item.at).toLocaleString("ru-RU")} · ${esc(item.characterName)} · ${item.level} ур.</small></div><button data-restore-revision="${esc(item.id)}" class="secondary">Восстановить</button></article>`).join("") : `<div class="read-only">Контрольных точек пока нет.</div>`}</div>`);
    $$('[data-restore-revision]', $("#modal-content")).forEach(button => button.addEventListener("click", () => {
      if (!confirm("Восстановить эту версию персонажа?")) return;
      socket.emit("sheet:restore", { revisionId:button.dataset.restoreRevision }, result => {
        if (!result.ok) return toast(result.error || "Не удалось восстановить");
        state.room.players[state.clientId].sheet = result.sheet; closeModal(); renderSheet(); toast("Версия восстановлена");
      });
    }));
  });
}

function exportCampaign() {
  socket.emit("room:backup", {}, response => {
    if (!response.ok) return toast(response.error || "Не удалось создать копию");
    downloadJson(response.backup, `TabaxiTable-${state.room.code}-backup.json`);
    toast("Копия кампании сохранена");
  });
}

async function restoreCampaign(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup?.players || typeof backup.players !== "object") throw new Error("Это не копия кампании TabaxiTable");
    if (!confirm(`Восстановить кампанию «${backup.title || "Без названия"}»? Текущее состояние всех листов будет заменено.`)) return;
    socket.emit("room:restore-backup", { backup }, response => {
      if (!response.ok) return toast(response.error || "Не удалось восстановить кампанию");
      toast("Кампания восстановлена");
    });
  } catch (error) { toast(error.message || "Файл не читается"); }
  finally { event.target.value = ""; }
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type:"application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
}

function openHealthModal() {
  const s = currentSheet();
  const pools = s.hitDicePools?.length ? s.hitDicePools : [{ sides:Number(s.hitDieSize || 8), total:Number(s.hitDiceMax || totalLevel(s)), current:Number(s.hitDiceCurrent ?? s.hitDiceMax ?? totalLevel(s)) }];
  openModal("Здоровье и отдых", `
    <div class="hp-summary"><strong>${s.hpCurrent}/${s.hpMax}</strong>временные HP: ${s.hpTemp || 0}</div>
    <label>Количество<input id="hp-amount" type="number" min="0" value="1"></label>
    <div class="modal-actions"><button class="secondary" data-hp-action="damage">Получить урон</button><button class="secondary" data-hp-action="heal">Лечение</button><button class="secondary" data-hp-action="temp">Временные HP</button><button class="secondary" data-hp-action="max">Изменить максимум</button></div>
    <div class="panel hit-dice-manager"><div class="panel-heading"><h3 class="panel-title">Кости хитов</h3><small>Выбери кость для лечения</small></div><div class="hit-dice-actions">${pools.map(pool => `<button class="secondary" data-rest-die="${Number(pool.sides)}" ${Number(pool.current) <= 0 ? "disabled" : ""}><strong>к${Number(pool.sides)}</strong><small>${Number(pool.current)}/${Number(pool.total)} осталось</small></button>`).join("")}</div><div class="rest-actions"><button class="secondary" data-rest="short-complete">Завершить короткий отдых</button><button class="primary" data-rest="long">Долгий отдых</button></div></div>`);
  $$('[data-hp-action]', $("#modal-content")).forEach(button => button.addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    const amount = Math.max(0, Number($("#hp-amount").value || 0));
    let concentrationDamage = 0;
    if (button.dataset.hpAction === "damage") {
      const wasAtZero = Number(sheet.hpCurrent || 0) === 0;
      const absorbed = Math.min(sheet.hpTemp || 0, amount);
      sheet.hpTemp -= absorbed;
      concentrationDamage = Math.max(0, amount - absorbed);
      sheet.hpCurrent = Math.max(0, sheet.hpCurrent - concentrationDamage);
      if (wasAtZero && concentrationDamage > 0) sheet.deathFail = Math.min(3, Number(sheet.deathFail || 0) + 1);
    } else if (button.dataset.hpAction === "heal") {
      sheet.hpCurrent = Math.min(sheet.hpMax, sheet.hpCurrent + amount);
      if (sheet.hpCurrent > 0) { sheet.deathSuccess = 0; sheet.deathFail = 0; }
    }
    else if (button.dataset.hpAction === "temp") sheet.hpTemp = Math.max(sheet.hpTemp || 0, amount);
    else if (button.dataset.hpAction === "max") { sheet.hpMax = amount; sheet.hpCurrent = Math.min(sheet.hpCurrent, amount); }
    closeModal(); saveNow(sheet, button.dataset.hpAction === "damage" ? `Получено урона: ${amount}` : "Здоровье изменено", "Здоровье"); renderSheet();
    if (concentrationDamage > 0 && sheet.concentrationSpellName) rollConcentrationCheck(concentrationDamage);
  }));
  $$('[data-rest-die]', $("#modal-content")).forEach(dieButton => dieButton.addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    const sides = Number(dieButton.dataset.restDie);
    const pool = sheet.hitDicePools?.find(entry => Number(entry.sides) === sides);
    if (!pool || Number(pool.current) <= 0) return toast("Эти кости хитов закончились");
    const con = modifier(sheet.stats.con);
    socket.emit("dice:roll", { formula: `1к${sides}${signed(con)}`, label: `Кость хитов к${sides}` }, response => {
      if (!response.ok) return toast(response.error);
      pool.current -= 1;
      sheet.hitDiceCurrent = sheet.hitDicePools.reduce((sum, entry) => sum + Number(entry.current), 0);
      sheet.hpCurrent = Math.min(sheet.hpMax, sheet.hpCurrent + Math.max(0, response.total));
      closeModal(); saveNow(sheet, "Потрачена кость хитов", "Короткий отдых"); renderSheet(); renderRolls();
    });
  }));
  $('[data-rest="long"]', $("#modal-content")).addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    sheet.hpCurrent = sheet.hpMax;
    sheet.hpTemp = 0;
    sheet.deathSuccess = 0;
    sheet.deathFail = 0;
    let restoredDice = Math.max(1, Math.floor(totalLevel(sheet) / 2));
    sheet.hitDicePools = (sheet.hitDicePools || []).map(pool => {
      const room = Math.max(0, Number(pool.total) - Number(pool.current));
      const restored = Math.min(room, restoredDice);
      restoredDice -= restored;
      return { ...pool, current:Number(pool.current) + restored };
    });
    sheet.hitDiceCurrent = sheet.hitDicePools.reduce((sum, pool) => sum + Number(pool.current), 0);
    sheet.spellSlots = sheet.spellSlots.map(slot => ({ ...slot, used: 0 }));
    if (sheet.pactSlots) sheet.pactSlots.used = 0;
    sheet.resources = sheet.resources.map(resource => ["short", "long"].includes(resource.reset) ? { ...resource, current: resource.max } : resource);
    sheet.exhaustion = Math.max(0, Number(sheet.exhaustion || 0) - 1);
    sheet.concentrationSpellId = ""; sheet.concentrationSpellName = "";
    closeModal(); saveNow(sheet, "Долгий отдых завершён", "Долгий отдых"); renderSheet();
  });
  $('[data-rest="short-complete"]', $("#modal-content")).addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    sheet.resources = sheet.resources.map(resource => resource.reset === "short" ? { ...resource, current: resource.max } : resource);
    if (sheet.pactSlots) sheet.pactSlots.used = 0;
    closeModal(); saveNow(sheet, "Короткий отдых завершён", "Короткий отдых"); renderSheet();
  });
}

function rollConcentrationCheck(damage) {
  const sheet = currentSheet();
  const dc = Math.max(10, Math.floor(Number(damage || 0) / 2));
  const bonus = modifier(sheet.stats.con) + (sheet.saveProficiencies.includes("con") ? effectiveProficiency(sheet) : 0);
  roll(`1к20${signed(bonus)}`, `Концентрация · Сл ${dc}`, { onResult: response => {
    if (response.total >= dc) return toast("Концентрация сохранена");
    const next = structuredClone(currentSheet());
    next.concentrationSpellId = ""; next.concentrationSpellName = "";
    saveNow(next, "Концентрация потеряна", "Концентрация"); renderSheet();
  }});
}

function rollDeathSave() {
  const sheet = currentSheet();
  if (sheet.hpCurrent > 0) return toast("Спасброски от смерти нужны только при 0 HP");
  roll("1к20", "Спасбросок от смерти", { mode:"normal", onResult: response => {
    const next = structuredClone(currentSheet());
    const natural = Number(response.natural || response.dice?.[0] || 0);
    if (natural === 20) { next.hpCurrent = 1; next.deathSuccess = 0; next.deathFail = 0; toast("Натуральная 20 — персонаж приходит в сознание с 1 HP"); }
    else if (natural === 1) next.deathFail = Math.min(3, Number(next.deathFail || 0) + 2);
    else if (response.total >= 10) next.deathSuccess = Math.min(3, Number(next.deathSuccess || 0) + 1);
    else next.deathFail = Math.min(3, Number(next.deathFail || 0) + 1);
    if (next.deathSuccess >= 3) toast("Три успеха — персонаж стабилен");
    if (next.deathFail >= 3) toast("Три провала — персонаж погибает");
    saveNow(next, "Спасбросок от смерти", "Спасбросок от смерти"); renderSheet();
  }});
}

function openAttackModal(id = null) {
  const sheet = currentSheet();
  const attack = sheet.attacksList.find(item => item.id === id) || { id: uuid(), name: "", bonus: "[DEX]+[PROF]", damage: "1d6+[DEX]", damageType: "", notes: "" };
  const draft = { attack:formulaParts(attack,"attack",sheet), damage:formulaParts(attack,"damage",sheet) };
  const palettePiece = (zone, type, label, extra = {}) => `<button type="button" draggable="true" data-lego-zone="${zone}" data-lego-type="${type}" ${extra.value !== undefined ? `data-lego-value="${esc(extra.value)}"` : ""} ${extra.count ? `data-lego-count="${extra.count}"` : ""} ${extra.sides ? `data-lego-sides="${extra.sides}"` : ""}><b>${esc(label)}</b><small>нажми или перетащи</small></button>`;
  const abilityPieces = Object.keys(abilities).map(key => palettePiece("attack","ability",`+ ${abilityAbbreviations[key]}`,{value:key})).join("");
  const damageAbilities = Object.keys(abilities).map(key => palettePiece("damage","ability",`+ ${abilityAbbreviations[key]}`,{value:key})).join("");
  const classPieces = [
    hasClass(sheet,"rogue") ? palettePiece("damage","sneak","+ Скрытая атака") : "",
    hasClass(sheet,"monk") ? palettePiece("damage","martial","Кость монаха") : "",
    hasClass(sheet,"barbarian") ? palettePiece("damage","rage","+ Урон ярости") : "",
    classLevel(sheet,"paladin") >= 2 ? palettePiece("damage","smite","+ Бож. кара") : "",
    classEntries(sheet).some(entry => entry.key === "fighter" && /боевых искусств/i.test(entry.subclass || "")) ? palettePiece("damage","superiority","+ Кость приёма") : ""
  ].join("");
  $("#game-modal").classList.add("library-open");
  openModal(id ? "Конструктор атаки" : "Новая атака", `
    <div class="attack-builder">
      <div class="lego-intro"><span>🧱</span><div><strong>Собери атаку как конструктор</strong><p>Нажимай на детали или перетаскивай их в полосу. TabaxiTable сам посчитает характеристики и мастерство.</p></div></div>
      <label class="attack-builder-name">Название<input id="attack-name" value="${esc(attack.name)}" placeholder="Например, длинный лук +1"></label>
      <section class="formula-builder-card"><div class="formula-builder-head"><div><span class="eyebrow">Попадание</span><h3>Что прибавить к к20?</h3></div><b>к20 уже добавлен</b></div>
        <div class="lego-palette compact">${abilityPieces}${palettePiece("attack","proficiency","+ Мастерство")}${palettePiece("attack","spell","+ Магия")}${palettePiece("attack","flat","+ Свой бонус",{value:1})}</div>
        <div id="attack-parts" class="lego-zone" data-lego-drop="attack"></div><div id="attack-formula-preview" class="formula-preview"></div>
      </section>
      <section class="formula-builder-card"><div class="formula-builder-head"><div><span class="eyebrow">Урон</span><h3>Из чего складывается урон?</h3></div><b>порядок не важен</b></div>
        <div class="lego-palette">${[4,6,8,10,12].map(sides => palettePiece("damage","dice",`1к${sides}`,{count:1,sides})).join("")}${palettePiece("damage","dice","2к6",{count:2,sides:6})}${damageAbilities}${palettePiece("damage","spell","+ Магия")}${palettePiece("damage","flat","+ Свой бонус",{value:1})}${classPieces}</div>
        <div id="damage-parts" class="lego-zone damage-zone" data-lego-drop="damage"></div><div id="damage-formula-preview" class="formula-preview"></div>
      </section>
      <div class="attack-builder-options"><label>Цена атаки<select id="attack-action-cost"><option value="action" ${!attack.actionCost || attack.actionCost === "action" ? "selected" : ""}>Действие</option><option value="bonus" ${attack.actionCost === "bonus" ? "selected" : ""}>Бонусное действие</option><option value="reaction" ${attack.actionCost === "reaction" ? "selected" : ""}>Реакция</option><option value="free" ${attack.actionCost === "free" ? "selected" : ""}>Без действия</option></select></label><label>Тип урона<input id="attack-type" list="damage-types" value="${esc(attack.damageType)}" placeholder="Выбери или напиши"><datalist id="damage-types">${["дробящий","колющий","рубящий","огонь","холод","электричество","кислота","яд","психический","некротический","излучение","силовое поле","звук"].map(type => `<option value="${type}">`).join("")}</datalist></label><label>Режим попадания<select id="attack-roll-mode"><option value="inherit" ${!attack.rollMode || attack.rollMode === "inherit" ? "selected" : ""}>Как выбрано на листе</option><option value="normal" ${attack.rollMode === "normal" ? "selected" : ""}>Всегда обычно</option><option value="advantage" ${attack.rollMode === "advantage" ? "selected" : ""}>Всегда с преимуществом</option><option value="disadvantage" ${attack.rollMode === "disadvantage" ? "selected" : ""}>Всегда с помехой</option></select></label><label>Короткая памятка<input id="attack-notes" value="${esc(attack.notes)}" placeholder="Дальность, особое условие..."></label></div>
      <div class="modal-actions"><button id="attack-save" class="primary">Сохранить атаку</button>${id ? `<button id="attack-delete" class="secondary">Удалить</button>` : `<button id="attack-cancel" class="secondary">Отмена</button>`}</div>
    </div>`);

  const addPart = (zone, source) => {
    const type = source.dataset.legoType;
    if (!["dice","flat"].includes(type) && draft[zone].some(part => part.type === type && String(part.value || "") === String(source.dataset.legoValue || ""))) return toast("Такая деталь уже добавлена");
    draft[zone].push({ id:uuid(), type, value:source.dataset.legoValue || "", count:Number(source.dataset.legoCount || 1), sides:Number(source.dataset.legoSides || 6) });
    renderParts();
  };
  const partChip = (part, zone) => `<div class="lego-piece" draggable="true" data-lego-part="${esc(part.id)}"><span>${esc(formulaPartLabel(part,sheet))}</span>${part.type === "flat" ? `<input data-lego-flat="${esc(part.id)}" type="number" value="${Number(part.value) || 0}" aria-label="Числовой бонус">` : ""}<button type="button" data-lego-remove="${esc(part.id)}" data-lego-remove-zone="${zone}" aria-label="Убрать деталь">×</button></div>`;
  function renderParts() {
    ["attack","damage"].forEach(zone => {
      const root = $(`#${zone}-parts`);
      root.innerHTML = draft[zone].length ? draft[zone].map(part => partChip(part,zone)).join("") : `<span class="lego-empty">Перетащи детали сюда или нажми на них выше</span>`;
    });
    const attackFormula = formulaFromParts(draft.attack,sheet), damageFormula = formulaFromParts(draft.damage,sheet);
    $("#attack-formula-preview").innerHTML = `<span>Получится</span><strong>к20 ${signed(resolveBonus(attackFormula,sheet))}</strong><small>${esc(draft.attack.map(part => formulaPartLabel(part,sheet)).join(" + ") || "без бонуса")}</small>`;
    $("#damage-formula-preview").innerHTML = `<span>Получится</span><strong>${esc(resolveDiceFormula(damageFormula,sheet))}</strong><small>${esc(draft.damage.map(part => formulaPartLabel(part,sheet)).join(" + ") || "урон не задан")}</small>`;
    $$('[data-lego-remove]').forEach(button => button.addEventListener("click", () => { draft[button.dataset.legoRemoveZone] = draft[button.dataset.legoRemoveZone].filter(part => part.id !== button.dataset.legoRemove); renderParts(); }));
    $$('[data-lego-flat]').forEach(input => input.addEventListener("input", () => { const part = [...draft.attack,...draft.damage].find(item => item.id === input.dataset.legoFlat); if (part) part.value = String(Number(input.value) || 0); renderPreviews(); }));
  }
  function renderPreviews() {
    const attackFormula = formulaFromParts(draft.attack,sheet), damageFormula = formulaFromParts(draft.damage,sheet);
    $("#attack-formula-preview").innerHTML = `<span>Получится</span><strong>к20 ${signed(resolveBonus(attackFormula,sheet))}</strong><small>${esc(draft.attack.map(part => formulaPartLabel(part,sheet)).join(" + ") || "без бонуса")}</small>`;
    $("#damage-formula-preview").innerHTML = `<span>Получится</span><strong>${esc(resolveDiceFormula(damageFormula,sheet))}</strong><small>${esc(draft.damage.map(part => formulaPartLabel(part,sheet)).join(" + ") || "урон не задан")}</small>`;
  }
  $$('[data-lego-type]').forEach(button => {
    button.addEventListener("click", () => addPart(button.dataset.legoZone,button));
    button.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", JSON.stringify({ zone:button.dataset.legoZone, type:button.dataset.legoType, value:button.dataset.legoValue || "", count:button.dataset.legoCount || 1, sides:button.dataset.legoSides || 6 })));
  });
  $$('[data-lego-drop]').forEach(zone => {
    zone.addEventListener("dragover", event => { event.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", event => {
      event.preventDefault(); zone.classList.remove("dragover");
      try { const data = JSON.parse(event.dataTransfer.getData("text/plain")); if (data.zone !== zone.dataset.legoDrop) return toast("Эта деталь сюда не подходит"); addPart(data.zone,{ dataset:{ legoType:data.type, legoValue:data.value, legoCount:data.count, legoSides:data.sides } }); } catch { toast("Не получилось добавить деталь"); }
    });
  });
  renderParts();
  $("#attack-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const name = $("#attack-name").value.trim();
    if (!name) return toast("Дай атаке понятное название");
    const value = { ...attack, id: attack.id, name, attackParts:draft.attack, damageParts:draft.damage, bonus:formulaFromParts(draft.attack,sheet), damage:formulaFromParts(draft.damage,sheet), actionCost:$("#attack-action-cost").value, damageType: $("#attack-type").value.trim(), rollMode:$("#attack-roll-mode").value, notes: $("#attack-notes").value.trim() };
    const index = next.attacksList.findIndex(item => item.id === attack.id);
    if (index >= 0) next.attacksList[index] = value; else next.attacksList.push(value);
    closeModal(); saveNow(next, "Атака сохранена", "Атаки"); renderSheet();
  });
  $("#attack-delete")?.addEventListener("click", () => {
    if (!confirm("Удалить атаку?")) return;
    const next = structuredClone(currentSheet());
    next.attacksList = next.attacksList.filter(item => item.id !== attack.id);
    closeModal(); saveNow(next, "Атака удалена", "Удаление атаки"); renderSheet();
  });
  $("#attack-cancel")?.addEventListener("click", closeModal);
}

function rollAttackDamage(attack, critical = false) {
  const sheet = currentSheet();
  const hasSmite = Array.isArray(attack.damageParts) && attack.damageParts.some(part => part.type === "smite");
  if (hasSmite) return openSmiteDamageModal(attack,critical);
  let formula = attackDamageFormula(attack,sheet);
  if (!formula) return;
  formula = resolveDiceFormula(formula,sheet);
  if (critical) formula = criticalFormula(formula);
  roll(formula, `${critical ? "Критический урон" : "Урон"}: ${attack.name}`, { mode:"normal" });
}

function openSmiteDamageModal(attack, critical) {
  const sheet = currentSheet();
  const ordinary = (sheet.spellSlots || []).filter(slot => Number(slot.total) - Number(slot.used) > 0);
  const pact = sheet.pactSlots || {};
  const pactAvailable = Number(pact.total) - Number(pact.used) > 0;
  const choices = [...ordinary.map(slot => ({ value:`slot:${slot.level}`, level:Number(slot.level), label:`Ячейка ${slot.level} круга · осталось ${Number(slot.total)-Number(slot.used)}` })), ...(pactAvailable ? [{ value:"pact", level:Number(pact.level), label:`Ячейка договора ${pact.level} круга · осталось ${Number(pact.total)-Number(pact.used)}` }] : [])];
  const rollBase = () => {
    const parts = (attack.damageParts || []).filter(part => part.type !== "smite");
    let formula = resolveDiceFormula(formulaFromParts(parts,currentSheet()),currentSheet());
    if (critical) formula = criticalFormula(formula);
    closeModal(); roll(formula, `${critical ? "Критический урон" : "Урон"} без кары: ${attack.name}`, { mode:"normal" });
  };
  openModal("Божественная кара", `<div class="smite-card"><div class="smite-symbol">✦</div><div><span class="eyebrow">После попадания</span><h3>${esc(attack.name)}</h3><p>Выбери ячейку. Кости кары автоматически удвоятся при критическом попадании.</p></div></div>${choices.length ? `<label>Потратить ячейку<select id="smite-slot">${choices.map(choice => `<option value="${choice.value}" data-level="${choice.level}">${choice.label}</option>`).join("")}</select></label><label class="toggle-row"><span><strong>Исчадие или нежить</strong><small>Добавляет ещё 1к8 урона излучением</small></span><input id="smite-special" type="checkbox"><i></i></label><div id="smite-preview" class="formula-preview"></div><div class="modal-actions"><button id="smite-roll" class="primary" type="button">Потратить ячейку и бросить</button><button id="smite-skip" class="secondary" type="button">Урон без кары</button></div>` : `<div class="read-only">Свободных ячеек нет. Можно бросить обычный урон без кары.</div><button id="smite-skip" class="primary" type="button">Бросить без кары</button>`}`);
  const refresh = () => {
    const option = $("#smite-slot")?.selectedOptions?.[0]; if (!option) return;
    const dice = Math.min(5, Number(option.dataset.level) + 1) + ($("#smite-special")?.checked ? 1 : 0);
    $("#smite-preview").innerHTML = `<span>Кара</span><strong>${dice}к8${critical ? " × крит" : ""}</strong><small>урон излучением</small>`;
  };
  $("#smite-slot")?.addEventListener("change",refresh); $("#smite-special")?.addEventListener("change",refresh); refresh();
  $("#smite-skip").addEventListener("click",rollBase);
  $("#smite-roll")?.addEventListener("click", () => {
    const selected = $("#smite-slot").value, choice = choices.find(item => item.value === selected);
    if (!choice) return;
    const next = structuredClone(currentSheet());
    if (selected === "pact") next.pactSlots.used = Math.min(Number(next.pactSlots.total),Number(next.pactSlots.used)+1);
    else { const level = Number(selected.split(":")[1]), slot = next.spellSlots.find(item => Number(item.level) === level); if (slot) slot.used = Math.min(Number(slot.total),Number(slot.used)+1); }
    const dice = Math.min(5,choice.level + 1) + ($("#smite-special").checked ? 1 : 0);
    let formula = resolveDiceFormula(attackDamageFormula(attack,next,{smiteDice:dice}),next);
    if (critical) formula = criticalFormula(formula);
    closeModal(); saveNow(next,"Ячейка потрачена","Божественная кара"); renderSheet();
    roll(formula, `${critical ? "Критическая кара" : "Божественная кара"}: ${attack.name}`, { mode:"normal" });
  });
}

function openConditionsModal() {
  const sheet = currentSheet();
  openModal("Состояния", `<div class="conditions-list">${conditionNames.map(name => `<label class="condition-chip"><input type="checkbox" value="${esc(name)}" ${sheet.conditions.includes(name) ? "checked" : ""}>${esc(name)}</label>`).join("")}</div><button id="conditions-save" class="primary">Применить</button>`);
  $("#conditions-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    next.conditions = $$('.condition-chip input:checked', $("#modal-content")).map(input => input.value);
    closeModal(); saveNow(next, "Состояния обновлены", "Состояния"); renderSheet();
  });
}

function openSlotsModal() {
  const sheet = currentSheet();
  openModal("Ячейки заклинаний", `${sheet.spellSlots.map(slot => `<label>${slot.level} уровень<input type="number" min="0" max="20" data-slot-total="${slot.level}" value="${slot.total}"></label>`).join("")}<button id="slots-save" class="primary">Сохранить</button>`);
  $("#slots-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    next.autoSpellSlots = false;
    $$('[data-slot-total]', $("#modal-content")).forEach(input => {
      const slot = next.spellSlots.find(item => item.level === Number(input.dataset.slotTotal));
      slot.total = Math.max(0, Number(input.value || 0));
      slot.used = Math.min(slot.used, slot.total);
    });
    closeModal(); saveNow(next, "Ячейки настроены", "Ячейки заклинаний"); renderSheet();
  });
}

function changeSlot(level, delta) {
  const next = structuredClone(currentSheet());
  const slot = next.spellSlots.find(item => item.level === level);
  if (!slot) return;
  slot.used = Math.max(0, Math.min(slot.total, slot.used + delta));
  saveNow(next); renderSheet();
}
function changePactSlot(delta) {
  const next = structuredClone(currentSheet());
  next.pactSlots ||= { level:0, total:0, used:0 };
  next.pactSlots.used = Math.max(0, Math.min(Number(next.pactSlots.total || 0), Number(next.pactSlots.used || 0) + delta));
  saveNow(next); renderSheet();
}

function openResourceModal(id = null) {
  const resource = currentSheet().resources.find(item => item.id === id) || { id: uuid(), name: "", current: 0, max: 1, reset: "none" };
  openModal(id ? "Настроить ресурс" : "Новый ресурс", `
    <label>Название<input id="resource-name" value="${esc(resource.name)}" placeholder="Стрелы, ярость, ци..."></label>
    <div class="two-col"><label>Сейчас<input id="resource-current" type="number" value="${Number(resource.current)}"></label><label>Максимум<input id="resource-max" type="number" min="0" value="${Number(resource.max)}"></label></div>
    <label>Восстановление<select id="resource-reset"><option value="none">Вручную</option><option value="short" ${resource.reset === "short" ? "selected" : ""}>Короткий отдых</option><option value="long" ${resource.reset === "long" ? "selected" : ""}>Долгий отдых</option></select></label>
    <div class="modal-actions"><button id="resource-save" class="primary">Сохранить</button>${id ? `<button id="resource-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#resource-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const max = Math.max(0, Number($("#resource-max").value || 0));
    const value = { id: resource.id, name: $("#resource-name").value.trim(), current: Math.max(0, Math.min(max, Number($("#resource-current").value || 0))), max, reset: $("#resource-reset").value };
    const index = next.resources.findIndex(item => item.id === resource.id);
    if (index >= 0) next.resources[index] = value; else next.resources.push(value);
    closeModal(); saveNow(next); renderSheet();
  });
  $("#resource-delete")?.addEventListener("click", () => deleteEntity("resources", resource.id));
}
function changeResource(id, delta) {
  const next = structuredClone(currentSheet());
  const resource = next.resources.find(item => item.id === id);
  if (!resource) return;
  resource.current = Math.max(0, Math.min(resource.max, Number(resource.current || 0) + delta));
  saveNow(next); renderSheet();
}

function openItemModal(id = null) {
  const item = currentSheet().inventoryList.find(entry => entry.id === id) || { id: uuid(), name: "", quantity: 1, weight: 0, equipped: false, attuned: false, magical: false, description: "" };
  openModal(id ? "Предмет" : "Новый предмет", `
    <label>Название<input id="item-name" value="${esc(item.name)}"></label>
    ${item.type ? `<div class="read-only">${item.type === "weapon" ? `Оружие · ${esc(item.damage || "")} ${esc(item.damageType || "")}` : item.type === "armor" ? `Броня · базовый КД ${Number(item.baseAc || 0)} · ${esc(item.armorType || "")}` : "Обычное снаряжение"}</div>` : ""}
    <div class="two-col"><label>Количество<input id="item-quantity" type="number" min="0" value="${Number(item.quantity)}"></label><label>Вес одного, фнт.<input id="item-weight" type="number" min="0" step="0.1" value="${Number(item.weight)}"></label></div>
    <div class="conditions-list"><label class="condition-chip"><input id="item-equipped" type="checkbox" ${item.equipped ? "checked" : ""}>Надето</label><label class="condition-chip"><input id="item-attuned" type="checkbox" ${item.attuned ? "checked" : ""}>Настроено</label><label class="condition-chip"><input id="item-magical" type="checkbox" ${item.magical ? "checked" : ""}>Магический</label></div>
    <label>Описание<textarea id="item-description">${esc(item.description)}</textarea></label>
    <div class="modal-actions"><button id="item-save" class="primary">Сохранить</button>${id ? `<button id="item-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#item-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    if ($("#item-attuned").checked && !item.attuned && next.inventoryList.filter(entry => entry.attuned).length >= 3) return toast("Одновременно можно настроиться максимум на 3 предмета");
    const value = { ...item, id: item.id, name: $("#item-name").value.trim(), quantity: Math.max(0, Number($("#item-quantity").value || 0)), weight: Math.max(0, Number($("#item-weight").value || 0)), equipped: $("#item-equipped").checked, attuned: $("#item-attuned").checked, magical: $("#item-magical").checked, description: $("#item-description").value.trim() };
    const index = next.inventoryList.findIndex(entry => entry.id === item.id);
    if (index >= 0) next.inventoryList[index] = value; else next.inventoryList.push(value);
    if (next.autoArmorClass) next.ac = calculateAc(next);
    closeModal(); saveNow(next, "Снаряжение обновлено", "Снаряжение"); renderSheet();
  });
  $("#item-delete")?.addEventListener("click", () => deleteEntity("inventoryList", item.id));
}

function openSpellModal(id = null) {
  const sheet = currentSheet();
  const spell = sheet.spellsList.find(entry => entry.id === id) || { id: uuid(), name: "", level: 0, school: "", castingTime: "1 действие", range: "", duration: "", damage: "", prepared: true, ritual: false, concentration: false, description: "", rollKind:"damage" };
  const casterClasses = classEntries(sheet).filter(entry => rules.classes[entry.key]?.spellAbility);
  const draft = {
    effect:Array.isArray(spell.effectParts) && spell.effectParts.length ? structuredClone(spell.effectParts) : parseFormulaParts(spell.damage,"damage"),
    upcast:Array.isArray(spell.upcastParts) ? structuredClone(spell.upcastParts) : []
  };
  const palettePiece = (zone, type, label, extra = {}) => `<button type="button" draggable="true" data-spell-lego-zone="${zone}" data-spell-lego-type="${type}" ${extra.value !== undefined ? `data-spell-lego-value="${esc(extra.value)}"` : ""} ${extra.count ? `data-spell-lego-count="${extra.count}"` : ""} ${extra.sides ? `data-spell-lego-sides="${extra.sides}"` : ""}><b>${esc(label)}</b><small>нажми или перетащи</small></button>`;
  const dicePalette = zone => [4,6,8,10,12].map(sides => palettePiece(zone,"dice",`1к${sides}`,{count:1,sides})).join("") + palettePiece(zone,"dice","2к6",{count:2,sides:6});
  const abilityPalette = Object.keys(abilities).map(key => palettePiece("effect","ability",`+ ${abilityAbbreviations[key]}`,{value:key})).join("");
  const knownUpcast = spellUpcastDice[spell.catalogKey] || "";
  $("#game-modal").classList.add("library-open");
  openModal(id ? "Заклинание" : "Новое заклинание", `
    <div class="spell-builder">
      <div class="lego-intro"><span>✦</span><div><strong>Заклинание без формул и скобок</strong><p>Собери урон или лечение из кубиков. Усиление автоматически повторится за каждый круг ячейки выше.</p></div></div>
      <div class="spell-builder-basics"><label>Название<input id="spell-name" value="${esc(spell.name)}" placeholder="Например, Ледяная игла"></label>${casterClasses.length ? `<label>Источник магии<select id="spell-source-class">${casterClasses.map(entry => `<option value="${entry.key}" ${spell.sourceClassKey === entry.key ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}</select></label>` : ""}<label>Что бросаем<select id="spell-roll-kind"><option value="damage" ${spellRollKind(spell) === "damage" ? "selected" : ""}>Урон</option><option value="healing" ${spellRollKind(spell) === "healing" ? "selected" : ""}>Лечение</option><option value="none" ${spellRollKind(spell) === "none" ? "selected" : ""}>Без числового броска</option></select></label></div>
      <div id="spell-roll-builders">
        <section class="formula-builder-card"><div class="formula-builder-head"><div><span class="eyebrow">Основной эффект</span><h3>Что бросить при сотворении?</h3></div><b>кубики + модификатор</b></div>
          <div class="lego-palette">${dicePalette("effect")}${palettePiece("effect","spell","+ Магия")}${palettePiece("effect","flat","+ Число",{value:1})}</div>
          <details class="lego-more"><summary>Другой модификатор характеристики</summary><div class="lego-palette compact">${abilityPalette}</div></details>
          <div id="spell-effect-parts" class="lego-zone spell-effect-zone" data-spell-lego-drop="effect"></div><div id="spell-effect-preview" class="formula-preview"></div>
        </section>
        <section class="formula-builder-card upcast-builder"><div class="formula-builder-head"><div><span class="eyebrow">Ячейка выше</span><h3>Что добавить за каждый круг?</h3></div><b>можно оставить пустым</b></div>
          <div class="lego-palette">${dicePalette("upcast")}${palettePiece("upcast","flat","+ Число",{value:1})}</div>
          <div id="spell-upcast-parts" class="lego-zone spell-upcast-zone" data-spell-lego-drop="upcast"></div><div id="spell-upcast-preview" class="formula-preview"></div>
          ${knownUpcast ? `<p class="spell-upcast-note">Справочник уже знает усиление этого заклинания: <b>+${esc(knownUpcast)}</b> за круг. Оно работает, пока полоса выше пустая.</p>` : ""}
        </section>
      </div>
      <details class="spell-builder-details"><summary>Паспорт и описание заклинания</summary><div>
        <div class="two-col"><label>Уровень<input id="spell-level" type="number" min="0" max="9" value="${Number(spell.level)}"></label><label>Школа<input id="spell-school" value="${esc(spell.school)}"></label></div>
        <div class="two-col"><label>Время накладывания<input id="spell-time" value="${esc(spell.castingTime)}"></label><label>Дистанция<input id="spell-range" value="${esc(spell.range)}"></label></div>
        <label>Длительность<input id="spell-duration" value="${esc(spell.duration)}"></label>
        <div class="conditions-list"><label class="condition-chip"><input id="spell-prepared" type="checkbox" ${spell.prepared ? "checked" : ""}>Подготовлено</label><label class="condition-chip"><input id="spell-ritual" type="checkbox" ${spell.ritual ? "checked" : ""}>Ритуал</label><label class="condition-chip"><input id="spell-concentration" type="checkbox" ${spell.concentration ? "checked" : ""}>Концентрация</label></div>
        <label>Описание<textarea id="spell-description">${esc(spell.description)}</textarea></label>
      </div></details>
      <div class="modal-actions"><button id="spell-save" class="primary">Сохранить заклинание</button>${id ? `<button id="spell-delete" class="secondary">Удалить</button>` : `<button id="spell-cancel" class="secondary">Отмена</button>`}</div>
    </div>`);

  const addPart = (zone, source) => {
    const type = source.dataset.spellLegoType;
    if (!["dice","flat"].includes(type) && draft[zone].some(part => part.type === type && String(part.value || "") === String(source.dataset.spellLegoValue || ""))) return toast("Такая деталь уже добавлена");
    draft[zone].push({ id:uuid(), type, value:source.dataset.spellLegoValue || "", count:Number(source.dataset.spellLegoCount || 1), sides:Number(source.dataset.spellLegoSides || 6) });
    renderSpellParts();
  };
  const partChip = (part, zone) => `<div class="lego-piece" draggable="true"><span>${esc(formulaPartLabel(part,sheet))}</span>${part.type === "flat" ? `<input data-spell-lego-flat="${esc(part.id)}" type="number" value="${Number(part.value) || 0}" aria-label="Числовой бонус">` : ""}<button type="button" data-spell-lego-remove="${esc(part.id)}" data-spell-lego-remove-zone="${zone}" aria-label="Убрать деталь">×</button></div>`;
  function renderSpellPreviews() {
    const effectFormula = draft.effect.length ? formulaFromParts(draft.effect,sheet) : "";
    const upcastFormula = draft.upcast.length ? formulaFromParts(draft.upcast,sheet) : "";
    $("#spell-effect-preview").innerHTML = `<span>Получится</span><strong>${effectFormula ? esc(resolveDiceFormula(effectFormula,sheet)) : "—"}</strong><small>${esc(draft.effect.map(part => formulaPartLabel(part,sheet)).join(" + ") || "числовой эффект не задан")}</small>`;
    $("#spell-upcast-preview").innerHTML = `<span>За круг</span><strong>${upcastFormula ? `+ ${esc(resolveDiceFormula(upcastFormula,sheet))}` : knownUpcast ? `+ ${esc(knownUpcast.replace(/d/gi,"к"))}` : "—"}</strong><small>${esc(draft.upcast.map(part => formulaPartLabel(part,sheet)).join(" + ") || (knownUpcast ? "автоматически из справочника" : "без усиления"))}</small>`;
  }
  function renderSpellParts() {
    ["effect","upcast"].forEach(zone => {
      const root = $(`#spell-${zone}-parts`);
      root.innerHTML = draft[zone].length ? draft[zone].map(part => partChip(part,zone)).join("") : `<span class="lego-empty">Нажми на детали выше или перетащи их сюда</span>`;
    });
    $$('[data-spell-lego-remove]', $("#modal-content")).forEach(button => button.addEventListener("click", () => { draft[button.dataset.spellLegoRemoveZone] = draft[button.dataset.spellLegoRemoveZone].filter(part => part.id !== button.dataset.spellLegoRemove); renderSpellParts(); }));
    $$('[data-spell-lego-flat]', $("#modal-content")).forEach(input => input.addEventListener("input", () => { const part = [...draft.effect,...draft.upcast].find(item => item.id === input.dataset.spellLegoFlat); if (part) part.value = String(Number(input.value) || 0); renderSpellPreviews(); }));
    renderSpellPreviews();
  }
  $$('[data-spell-lego-type]', $("#modal-content")).forEach(button => {
    button.addEventListener("click", () => addPart(button.dataset.spellLegoZone,button));
    button.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", JSON.stringify({ spellLego:true, zone:button.dataset.spellLegoZone, type:button.dataset.spellLegoType, value:button.dataset.spellLegoValue || "", count:button.dataset.spellLegoCount || 1, sides:button.dataset.spellLegoSides || 6 })));
  });
  $$('[data-spell-lego-drop]', $("#modal-content")).forEach(zone => {
    zone.addEventListener("dragover", event => { event.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", event => {
      event.preventDefault(); zone.classList.remove("dragover");
      try { const data = JSON.parse(event.dataTransfer.getData("text/plain")); if (!data.spellLego || data.zone !== zone.dataset.spellLegoDrop) return toast("Эта деталь сюда не подходит"); addPart(data.zone,{ dataset:{ spellLegoType:data.type, spellLegoValue:data.value, spellLegoCount:data.count, spellLegoSides:data.sides } }); } catch { toast("Не получилось добавить деталь"); }
    });
  });
  const updateRollKind = () => $("#spell-roll-builders").classList.toggle("hidden", $("#spell-roll-kind").value === "none");
  $("#spell-roll-kind").addEventListener("change", updateRollKind);
  renderSpellParts(); updateRollKind();
  $("#spell-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const name = $("#spell-name").value.trim();
    if (!name) return toast("Дай заклинанию название");
    const rollKind = $("#spell-roll-kind").value;
    const effectParts = rollKind === "none" ? [] : draft.effect;
    const value = { ...spell, id: spell.id, sourceClassKey:$("#spell-source-class")?.value || spell.sourceClassKey || currentSheet().classKey, name, level: Math.max(0, Math.min(9, Number($("#spell-level").value || 0))), school: $("#spell-school").value.trim(), castingTime: $("#spell-time").value.trim(), range: $("#spell-range").value.trim(), duration: $("#spell-duration").value.trim(), rollKind, effectParts, upcastParts:rollKind === "none" ? [] : draft.upcast, damage:effectParts.length ? formulaFromParts(effectParts,sheet) : "", prepared: $("#spell-prepared").checked, ritual: $("#spell-ritual").checked, concentration: $("#spell-concentration").checked, description: $("#spell-description").value.trim() };
    const index = next.spellsList.findIndex(entry => entry.id === spell.id);
    if (index >= 0) next.spellsList[index] = value; else next.spellsList.push(value);
    closeModal(); saveNow(next, "Заклинание сохранено", "Гримуар"); renderSheet();
  });
  $("#spell-delete")?.addEventListener("click", () => deleteEntity("spellsList", spell.id));
  $("#spell-cancel")?.addEventListener("click", closeModal);
}

async function openSpellLibrary() {
  try {
    await loadSpellCatalog();
  } catch {
    return toast("Не удалось открыть справочник");
  }
  $("#game-modal").classList.add("library-open");
  openModal("Справочник заклинаний", `
    <div class="spell-library-tools">
      <label>Поиск<input id="spell-search" autocomplete="off" placeholder="Огненный шар, лечение, щит..."></label>
      <label>Уровень<select id="spell-level-filter"><option value="all">Все</option><option value="0">Заговоры</option>${Array.from({length: 9}, (_, i) => `<option value="${i + 1}">${i + 1} уровень</option>`).join("")}</select></label>
      <label>Класс<select id="spell-class-filter"><option value="all">Все классы</option>${["Бард","Волшебник","Друид","Жрец","Колдун","Паладин","Следопыт","Чародей"].map(name => `<option ${rules.classes[currentSheet().classKey]?.name === name ? "selected" : ""}>${name}</option>`).join("")}</select></label>
    </div>
    <div id="spell-library-count" class="read-only"></div>
    <div id="spell-library-results" class="spell-library-results"></div>`);
  const refresh = () => {
    const query = $("#spell-search").value.trim().toLocaleLowerCase("ru");
    const level = $("#spell-level-filter").value;
    const characterClass = $("#spell-class-filter").value;
    const found = spellCatalog.filter(spell =>
      (level === "all" || Number(level) === Number(spell.level)) &&
      (characterClass === "all" || spell.classes.includes(characterClass)) &&
      (!query || `${spell.name} ${spell.school} ${spell.description}`.toLocaleLowerCase("ru").includes(query))
    );
    $("#spell-library-count").textContent = `Найдено: ${found.length} · уже в гримуаре: ${currentSheet().spellsList.length}`;
    $("#spell-library-results").innerHTML = found.map(spell => {
      const exists = currentSheet().spellsList.some(item => item.catalogKey === spell.key || (item.name === spell.name && Number(item.level) === Number(spell.level)));
      return `
      <article class="spell-card">
        <div><span class="spell-level">${spell.level || "З"}</span></div>
        <div><strong>${esc(spell.name)}</strong><small>${esc(spell.school)} · ${esc(spell.castingTime)} · ${esc(spell.range)}</small><p>${esc(spell.description)}</p><small>${esc(spell.classes.join(", "))}${spell.concentration ? " · концентрация" : ""}${spell.ritual ? " · ритуал" : ""}</small></div>
        <button class="primary" data-catalog-spell="${esc(spell.key)}" ${exists ? "disabled" : ""}>${exists ? "Уже в гримуаре" : "Добавить"}</button>
      </article>`; }).join("") || `<div class="read-only">Ничего не найдено. Попробуй другое слово или фильтр.</div>`;
    $$('[data-catalog-spell]', $("#spell-library-results")).forEach(button => button.addEventListener("click", () => {
      const source = spellCatalog.find(spell => spell.key === button.dataset.catalogSpell);
      const next = structuredClone(currentSheet());
      const sourceClassKey = Object.entries(rules.classes).find(([, cls]) => cls.name === $("#spell-class-filter").value)?.[0] || currentSheet().classKey;
      next.spellsList.push({ ...structuredClone(source), id: uuid(), catalogKey:source.key, sourceClassKey, prepared: true, rollKind:healingSpellKeys.has(source.key) ? "healing" : source.damage ? "damage" : "none" });
      delete next.spellsList.at(-1).key;
      delete next.spellsList.at(-1).classes;
      saveNow(next, "Заклинание добавлено", "Гримуар");
      button.textContent = "Добавлено ✓";
      button.disabled = true;
    }));
  };
  $("#spell-search").addEventListener("input", refresh);
  $("#spell-level-filter").addEventListener("change", refresh);
  $("#spell-class-filter").addEventListener("change", refresh);
  refresh();
  $("#spell-search").focus();
}

function castSpell(id) {
  const sheet = currentSheet();
  const spell = sheet.spellsList.find(entry => entry.id === id);
  if (!spell) return;
  if (!spell.prepared && !confirm(`«${spell.name}» не отмечено как подготовленное. Всё равно сотворить?`)) return;
  if (spell.concentration && sheet.concentrationSpellId && sheet.concentrationSpellId !== spell.id && !confirm(`Сейчас поддерживается «${sheet.concentrationSpellName}». Завершить его и начать «${spell.name}»?`)) return;
  if (Number(spell.level) === 0) return completeSpellCast(spell, null, false);
  const available = sheet.spellSlots.filter(slot => slot.level >= Number(spell.level) && slot.used < slot.total);
  const pactAvailable = Number(sheet.pactSlots?.level || 0) >= Number(spell.level) && Number(sheet.pactSlots?.used || 0) < Number(sheet.pactSlots?.total || 0);
  if (!available.length && !pactAvailable && !spell.ritual) return toast(`Нет подходящих ячеек для «${spell.name}»`);
  openModal(`Сотворить «${spell.name}»`, `<p>Выбери уровень ячейки:</p><div class="cast-levels">${available.map(slot => `<button data-cast-level="${slot.level}" class="secondary"><strong>${slot.level}</strong><small>осталось ${slot.total-slot.used}</small></button>`).join("")}${pactAvailable ? `<button id="cast-pact" class="secondary pact-cast"><strong>Д${Number(sheet.pactSlots.level)}</strong><small>договор · осталось ${Number(sheet.pactSlots.total)-Number(sheet.pactSlots.used)}</small></button>` : ""}${!available.length && !pactAvailable ? `<div class="read-only">Свободных ячеек нет.</div>` : ""}</div>${spell.ritual ? `<button id="cast-ritual" class="secondary">Сотворить ритуалом · +10 минут · без ячейки</button>` : ""}`);
  $$('[data-cast-level]', $("#modal-content")).forEach(button => button.addEventListener("click", () => completeSpellCast(spell, Number(button.dataset.castLevel), false)));
  $("#cast-pact")?.addEventListener("click", () => completeSpellCast(spell, Number(sheet.pactSlots.level), false, true));
  $("#cast-ritual")?.addEventListener("click", () => completeSpellCast(spell, null, true));
}
function completeSpellCast(spell, slotLevel, asRitual = false, usePact = false) {
  const next = structuredClone(currentSheet());
  if (usePact) next.pactSlots.used += 1;
  else if (slotLevel) next.spellSlots.find(slot => slot.level === slotLevel).used += 1;
  if (spell.concentration) { next.concentrationSpellId = spell.id; next.concentrationSpellName = spell.name; }
  if ($("#game-modal").open) closeModal();
  saveNow(next, `Сотворено: ${spell.name}`, "Сотворение заклинания"); renderSheet();
  const rollKind = spellRollKind(spell);
  const formula = rollKind === "none" ? "" : spellRollFormula(spell, slotLevel, next);
  if (formula) roll(formula, `${rollKind === "healing" ? "Лечение" : "Заклинание"}: ${spell.name}${slotLevel ? ` (${slotLevel} ур.)` : ""}`, { mode:"normal" });
  else socket.emit("activity:log", { label: `Сотворено: ${spell.name}`, detail: asRitual ? "Ритуал" : usePact ? `Договор · ячейка ${slotLevel} уровня` : slotLevel ? `Ячейка ${slotLevel} уровня` : "Заговор" }, () => renderRolls());
}

function openGoalModal(id = null) {
  const goal = currentSheet().goalsList.find(entry => entry.id === id) || { id: uuid(), text: "", done: false };
  openModal(id ? "Цель" : "Новая цель", `<label>Описание<textarea id="goal-text">${esc(goal.text)}</textarea></label><div class="modal-actions"><button id="goal-save" class="primary">Сохранить</button>${id ? `<button id="goal-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#goal-save").addEventListener("click", () => upsertSimple("goalsList", goal.id, { ...goal, text: $("#goal-text").value.trim() }));
  $("#goal-delete")?.addEventListener("click", () => deleteEntity("goalsList", goal.id));
}
function toggleGoal(id, done) {
  const next = structuredClone(currentSheet());
  const goal = next.goalsList.find(entry => entry.id === id); if (!goal) return;
  goal.done = done; saveNow(next); renderSheet();
}
function openNoteModal(id = null) {
  const note = currentSheet().notesList.find(entry => entry.id === id) || { id: uuid(), title: "", text: "" };
  openModal(id ? "Заметка" : "Новая заметка", `<label>Название<input id="note-title" value="${esc(note.title)}"></label><label>Текст<textarea id="note-text">${esc(note.text)}</textarea></label><div class="modal-actions"><button id="note-save" class="primary">Сохранить</button>${id ? `<button id="note-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#note-save").addEventListener("click", () => upsertSimple("notesList", note.id, { id: note.id, title: $("#note-title").value.trim(), text: $("#note-text").value.trim() }));
  $("#note-delete")?.addEventListener("click", () => deleteEntity("notesList", note.id));
}
function upsertSimple(collection, id, value) {
  const next = structuredClone(currentSheet());
  const index = next[collection].findIndex(entry => entry.id === id);
  if (index >= 0) next[collection][index] = value; else next[collection].push(value);
  closeModal(); saveNow(next); renderSheet();
}
function deleteEntity(collection, id) {
  if (!confirm("Удалить эту запись? Это действие попадёт в историю версий.")) return;
  const next = structuredClone(currentSheet());
  next[collection] = next[collection].filter(entry => entry.id !== id);
  if (collection === "inventoryList") {
    next.attacksList = next.attacksList.filter(attack => attack.sourceItemId !== id);
    if (next.autoArmorClass) next.ac = calculateAc(next);
  }
  if (collection === "spellsList" && next.concentrationSpellId === id) {
    next.concentrationSpellId = ""; next.concentrationSpellName = "";
  }
  closeModal(); saveNow(next, "Удалено", "Удаление записи"); renderSheet();
}

function rollSkill(key) {
  const sheet = currentSheet();
  const skill = skills.find(entry => entry[0] === key); if (!skill) return;
  const bonus = getSkillBonus(sheet, key);
  roll(`1к20${signed(bonus)}`, skill[1]);
}
function rollSave(key) {
  const sheet = currentSheet();
  const bonus = modifier(sheet.stats[key]) + (sheet.saveProficiencies.includes(key) ? effectiveProficiency(sheet) : 0);
  roll(`1к20${signed(bonus)}`, `Спасбросок: ${abilities[key]}`);
}

function exportSheet() {
  const sheet = collectSheet();
  const blob = new Blob([JSON.stringify(sheet, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${(sheet.characterName || "character").replace(/[^а-яёa-z0-9_-]/gi, "_")}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
async function importSheet(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported || typeof imported !== "object" || !imported.stats) throw new Error("Это не лист персонажа");
    if (!confirm(`Заменить текущий лист данными персонажа «${imported.characterName || "Без имени"}»?`)) return;
    const base = structuredClone(currentSheet());
    const merged = { ...base, ...imported, stats: { ...base.stats, ...(imported.stats || {}) }, coins: { ...base.coins, ...(imported.coins || {}) } };
    ["saveProficiencies", "skillProficiencies", "expertise", "conditions", "attacksList", "resources", "inventoryList", "spellsList", "goalsList", "notesList", "spellSlots"].forEach(key => {
      if (!Array.isArray(merged[key])) merged[key] = structuredClone(base[key] || []);
    });
    saveNow(merged, "Импортировано", "Импорт листа"); renderSheet();
  } catch (error) { toast(error.message || "Не удалось импортировать файл"); }
  event.target.value = "";
}
function updateDerived() {
  const root = $("#sheet-view");
  if (!root.children.length) return;
  const s = state.selectedId === state.clientId ? collectSheet() : state.room.players[state.selectedId].sheet;
  Object.keys(abilities).forEach(key => {
    const mod = modifier(s.stats[key]);
    const modEl = $(`[data-mod="${key}"]`, root); if (modEl) modEl.textContent = signed(mod);
    const saveEl = $(`[data-save-bonus="${key}"]`, root); if (saveEl) saveEl.textContent = signed(mod + (s.saveProficiencies.includes(key) ? effectiveProficiency(s) : 0));
  });
  skills.forEach(([key, , ability]) => {
    const el = $(`[data-skill-bonus="${key}"]`, root);
    const multiplier = (s.expertise || []).includes(key) ? 2 : (s.skillProficiencies.includes(key) ? 1 : 0);
    if (el) el.textContent = signed(modifier(s.stats[ability]) + effectiveProficiency(s) * multiplier);
  });
  const initiative = $('[data-derived="initiative"]', root); if (initiative) initiative.value = signed(initiativeBonus(s));
}

function roll(formula, label = formula, options = {}) {
  const isD20 = /(?:^|[^\d])1[кd]20(?:$|[^\d])/i.test(String(formula));
  const usesSelectedMode = isD20 && !options.mode;
  const mode = options.mode || (isD20 ? state.rollMode : "normal");
  socket.emit("dice:roll", { formula, label, mode }, response => {
    if (!response.ok) return toast(response.error);
    showRollPeek(label, response);
    options.onResult?.(response);
    if (usesSelectedMode && state.rollMode !== "normal") {
      state.rollMode = "normal";
      $$('[data-roll-mode]', $("#sheet-view")).forEach(button => {
        button.classList.toggle("active", button.dataset.rollMode === "normal");
        button.setAttribute("aria-pressed", String(button.dataset.rollMode === "normal"));
      });
      $$('[data-dice-roll-mode]').forEach(button => {
        button.classList.toggle("active", button.dataset.diceRollMode === "normal");
        button.setAttribute("aria-pressed", String(button.dataset.diceRollMode === "normal"));
      });
      $(".roll-mode summary b", $("#sheet-view")) && ($(".roll-mode summary b", $("#sheet-view")).textContent = "обычно");
    }
  });
}
function showRollPeek(label, response) {
  const peek = $("#roll-peek");
  const modeLabel = response.mode === "advantage" ? " · преимущество" : response.mode === "disadvantage" ? " · помеха" : "";
  const naturalLabel = response.natural === 20 ? " · КРИТ" : response.natural === 1 ? " · ПРОВАЛ" : "";
  $("span", peek).textContent = `${label}${modeLabel}${naturalLabel}`;
  $("strong", peek).textContent = response.total;
  peek.classList.toggle("critical", response.natural === 20);
  peek.classList.toggle("fumble", response.natural === 1);
  peek.classList.remove("hidden");
  clearTimeout(state.rollPeekTimer);
  state.rollPeekTimer = setTimeout(() => peek.classList.add("hidden"), 8000);
}
$$('[data-die]').forEach(button => button.addEventListener("click", () => roll(button.dataset.die)));
$$('[data-dice-roll-mode]').forEach(button => button.addEventListener("click", () => {
  state.rollMode = button.dataset.diceRollMode;
  $$('[data-dice-roll-mode]').forEach(item => {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  });
  $$('[data-roll-mode]', $("#sheet-view")).forEach(item => {
    item.classList.toggle("active", item.dataset.rollMode === state.rollMode);
    item.setAttribute("aria-pressed", String(item.dataset.rollMode === state.rollMode));
  });
}));
$("#custom-roll").addEventListener("submit", event => { event.preventDefault(); const formula = new FormData(event.currentTarget).get("formula"); roll(formula); });
function renderRolls() {
  if (!state.room) return;
  $("#roll-log").innerHTML = state.room.rollLog.length ? [...state.room.rollLog].reverse().map(item => `
    <div class="roll ${item.natural === 20 ? "critical" : item.natural === 1 ? "fumble" : ""}"><div><strong>${esc(item.player)}</strong><br><span>${esc(item.label)}${item.activity ? ` · ${esc(item.activity)}` : ` · [${(item.dice || []).join(", ")}]${item.modifier ? ` ${signed(item.modifier)}` : ""}${item.mode === "advantage" ? " · преимущество" : item.mode === "disadvantage" ? " · помеха" : ""}`}</span></div><b>${item.total === null ? "✦" : item.total}</b></div>`).join("") : `<div class="read-only">Здесь появятся броски всей партии.</div>`;
}
function switchView(view) {
  $$('[data-view]').forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $("#sheet-view").classList.toggle("hidden", view !== "sheet");
  $("#dice-view").classList.toggle("hidden", view !== "dice");
}
$$('[data-view]').forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#roll-peek").addEventListener("click", () => switchView("dice"));
$("#own-sheet").addEventListener("click", () => { state.selectedId = state.clientId; renderAll(); switchView("sheet"); });
$("#copy-code").addEventListener("click", async () => { await navigator.clipboard.writeText(state.room.code); toast("Код скопирован"); });
$("#leave").addEventListener("click", () => {
  localStorage.removeItem("tabaxi-session");
  location.href = location.pathname;
});
$("#modal-close").addEventListener("click", closeModal);
$("#game-modal").addEventListener("click", event => {
  if (event.target === $("#game-modal")) closeModal();
});

const hashCode = location.hash.slice(1).toUpperCase();
if (/^[A-Z0-9]{6}$/.test(hashCode)) {
  $('[data-lobby-tab="join"]').click();
  $('#join-form [name="code"]').value = hashCode;
}
