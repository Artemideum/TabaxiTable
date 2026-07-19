const socket = io();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  room: null,
  clientId: localStorage.getItem("tt-client-id") || crypto.randomUUID(),
  selectedId: null,
  saveTimer: null,
  rollPeekTimer: null,
  sheetTab: "main",
  resuming: false
};
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
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

$$('[data-lobby-tab]').forEach(button => button.addEventListener("click", () => {
  $$('[data-lobby-tab]').forEach(x => x.classList.toggle("active", x === button));
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
  if (state.room || state.resuming) return;
  try {
    const session = JSON.parse(localStorage.getItem("tabaxi-session") || "null");
    if (!session?.code || !session?.name) return;
    state.resuming = true;
    socket.emit("room:join", { code: session.code, name: session.name, clientId: state.clientId }, enterResponse);
  } catch { localStorage.removeItem("tabaxi-session"); }
});

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
    PROF: Number(sheet.proficiency || 0), LVL: Number(sheet.level || 1)
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
function getSkillBonus(sheet, key) {
  const skill = skills.find(entry => entry[0] === key);
  if (!skill) return 0;
  const multiplier = (sheet.expertise || []).includes(key) ? 2 : (sheet.skillProficiencies.includes(key) ? 1 : 0);
  return modifier(sheet.stats[skill[2]]) + Number(sheet.proficiency || 0) * multiplier;
}

function renderSheet() {
  const player = state.room?.players?.[state.selectedId];
  if (!player) return;
  const s = player.sheet;
  const mine = player.id === state.clientId;
  const statCards = Object.entries(abilities).map(([key, name]) => `
    <div class="stat">
      <label>${name}</label>
      <input type="number" min="1" max="30" data-stat="${key}" value="${Number(s.stats[key] ?? 10)}">
      <div class="stat-bottom"><span class="modifier" data-mod="${key}">${signed(modifier(s.stats[key]))}</span><button class="roll-mini" data-roll-stat="${key}">к20</button></div>
    </div>`).join("");
  const saves = Object.entries(abilities).map(([key, name]) => `
    <label class="check-row"><input type="checkbox" data-save="${key}" ${s.saveProficiencies.includes(key) ? "checked" : ""}><span class="bonus" data-save-bonus="${key}" data-roll-save="${key}"></span><span>${name}</span><span class="ability">${key.toUpperCase()}</span></label>`).join("");
  const skillRows = skills.map(([key, name, ability]) => `
    <label class="check-row skill-row" title="Первый кружок — владение, второй — экспертиза"><input type="checkbox" data-skill="${key}" ${s.skillProficiencies.includes(key) ? "checked" : ""}><input type="checkbox" data-expertise="${key}" ${(s.expertise || []).includes(key) ? "checked" : ""}><span class="bonus" data-skill-bonus="${key}" data-ability="${ability}" data-roll-skill="${key}"></span><span>${name}</span><span class="ability">${ability.toUpperCase()}</span></label>`).join("");
  const attacksList = Array.isArray(s.attacksList) ? s.attacksList : [];
  const attackRows = attacksList.length ? attacksList.map(attack => `
    <div class="attack-row">
      <button class="attack-name" data-attack-roll="${esc(attack.id)}">${esc(attack.name || "Безымянная атака")}</button>
      <button data-attack-roll="${esc(attack.id)}">${signed(resolveBonus(attack.bonus, s))}</button>
      <button class="attack-damage" data-damage-roll="${esc(attack.id)}">${esc(attack.damage || "—")} ${esc(attack.damageType || "")}</button>
      <button data-attack-edit="${esc(attack.id)}">⋮</button>
    </div>`).join("") : `<div class="read-only">Добавь оружие или атаку — бонус и урон можно будет бросать одним нажатием.</div>`;
  const activeConditions = (s.conditions || []).map(name => `<span>${esc(name)}</span>`).join("") || `<span>Нет состояний</span>`;
  const coinNames = [["cp","ММ"],["sp","СМ"],["ep","ЭМ"],["gp","ЗМ"],["pp","ПМ"]];
  const coins = coinNames.map(([key, label]) => `<label>${label}<input type="number" min="0" data-coin="${key}" value="${Number(s.coins?.[key] || 0)}"></label>`).join("");
  const slots = (s.spellSlots || []).filter(slot => slot.total > 0).map(slot => `
    <div class="slot-row"><strong>${slot.level}</strong><div class="slot-pips">${Array.from({length: slot.total}, (_, index) => `<span class="slot-pip ${index < slot.used ? "used" : ""}"></span>`).join("")}</div><button data-slot-restore="${slot.level}">−</button><button data-slot-use="${slot.level}">+</button></div>`).join("");
  const resources = (s.resources || []).map(resource => `
    <div class="entity-row resource-row"><strong>${esc(resource.name || "Ресурс")}</strong><div class="resource-meter"><small>${Number(resource.current || 0)}/${Number(resource.max || 0)}</small><progress max="${Math.max(1, Number(resource.max || 0))}" value="${Number(resource.current || 0)}"></progress></div><button data-resource-change="${esc(resource.id)}" data-delta="-1">−</button><button data-resource-change="${esc(resource.id)}" data-delta="1">+</button><button data-resource-edit="${esc(resource.id)}">⋮</button></div>`).join("");
  const inventory = (s.inventoryList || []);
  const inventoryWeight = inventory.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.quantity || 0), 0);
  const carryingCapacity = Number(s.stats.str || 0) * 15;
  const inventoryRows = inventory.map(item => `
    <div class="entity-row"><div><strong>${esc(item.name || "Предмет")}</strong><div class="item-flags">${item.equipped ? "<span>надето</span>" : ""}${item.attuned ? "<span>настроено</span>" : ""}${item.magical ? "<span>магия</span>" : ""}</div></div><small>${Number(item.quantity || 0)} шт.</small><small>${Number(item.weight || 0) * Number(item.quantity || 0)} фнт.</small><button data-item-edit="${esc(item.id)}">⋮</button></div>`).join("");
  const spellAbility = s.spellcastingAbility || "";
  const spellMod = spellAbility ? modifier(s.stats[spellAbility]) : 0;
  const spellSave = 8 + Number(s.proficiency || 0) + spellMod;
  const spellAttack = Number(s.proficiency || 0) + spellMod;
  const spellRows = [...(s.spellsList || [])].sort((a, b) => Number(a.level) - Number(b.level) || String(a.name).localeCompare(String(b.name))).map(spell => `
    <div class="entity-row spell-row ${spell.prepared ? "prepared" : ""}"><span class="spell-level">${Number(spell.level || 0)}</span><div><strong>${esc(spell.name || "Заклинание")}</strong><small>${esc(spell.castingTime || "действие")} · ${esc(spell.range || "на себя")}${spell.concentration ? " · концентрация" : ""}</small></div><button data-spell-cast="${esc(spell.id)}">Сотворить</button><button data-spell-edit="${esc(spell.id)}">⋮</button></div>`).join("");
  const goalRows = (s.goalsList || []).map(goal => `<div class="entity-row"><input type="checkbox" data-goal-done="${esc(goal.id)}" ${goal.done ? "checked" : ""}><strong>${esc(goal.text)}</strong><button data-goal-edit="${esc(goal.id)}">⋮</button></div>`).join("");
  const noteRows = (s.notesList || []).map(note => `<div class="panel"><h3 class="panel-title">${esc(note.title || "Заметка")}</h3><p>${esc(note.text).replace(/\n/g, "<br>")}</p><button data-note-edit="${esc(note.id)}" class="secondary">Изменить</button></div>`).join("");

  $("#sheet-view").innerHTML = `<div class="sheet">
    ${mine ? "" : `<div class="read-only">Ты просматриваешь лист персонажа «${esc(s.characterName || player.name)}». Редактировать его может владелец.</div>`}
    <div class="sheet-head">
      <label class="character-name">Имя персонажа<input data-field="characterName" value="${esc(s.characterName)}"></label>
      ${field("Класс", "className", s.className)} ${field("Подкласс", "subclass", s.subclass || "")}
      ${field("Уровень", "level", s.level, "number")}
      ${field("Раса", "race", s.race)} ${field("Размер", "size", s.size || "Средний")}
      ${field("Предыстория", "background", s.background)}
      ${field("Мировоззрение", "alignment", s.alignment)} ${field("Опыт", "xp", s.xp, "number")}
      ${field("Бонус мастерства", "proficiency", s.proficiency, "number")}
    </div>
    ${mine ? `<div class="sheet-tools"><button id="sheet-export" class="secondary" type="button">Экспорт JSON</button><button id="sheet-import" class="secondary" type="button">Импорт JSON</button><input id="sheet-import-file" type="file" accept="application/json" hidden></div>` : ""}
    <nav class="sheet-tabs">
      <button data-sheet-tab="main">Основное</button><button data-sheet-tab="combat">Бой</button><button data-sheet-tab="features">Способности</button><button data-sheet-tab="equipment">Снаряжение</button><button data-sheet-tab="spells">Заклинания</button><button data-sheet-tab="personality">Личность</button><button data-sheet-tab="goals">Цели</button><button data-sheet-tab="notes">Заметки</button>
    </nav>
    <div class="sheet-grid">
      <div class="stack">
        <div class="panel stats" data-section="main">${statCards}</div>
        <div class="panel" data-section="main"><h3 class="panel-title">Спасброски</h3><div class="checks">${saves}</div></div>
        <div class="panel" data-section="main"><h3 class="panel-title">Пассивные чувства</h3><div class="checks"><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"perception")}</span><span>Восприятие</span></div><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"insight")}</span><span>Проницательность</span></div><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"investigation")}</span><span>Анализ</span></div></div></div>
        <div class="panel" data-section="features"><h3 class="panel-title">Владения и языки</h3>${area("Доспехи", "armorProficiencies", s.armorProficiencies || "")}${area("Оружие", "weaponProficiencies", s.weaponProficiencies || "")}${area("Инструменты", "toolProficiencies", s.toolProficiencies || "")}${area("Языки", "languages", s.languages || "")}</div>
      </div>
      <div class="stack">
        <div class="combat" data-section="combat">
          <label>Класс доспеха<input type="number" data-field="ac" value="${Number(s.ac)}"></label>
          <label>Инициатива<input data-derived="initiative" value="${signed(modifier(s.stats.dex))}" readonly></label>
          <label>Скорость<input type="number" data-field="speed" value="${Number(s.speed)}"></label>
        </div>
        <div class="panel two-col" data-section="combat">${field("Прыжок в высоту", "jumpHigh", s.jumpHigh || Math.max(0, 3 + modifier(s.stats.str)))}${field("Прыжок в длину", "jumpLong", s.jumpLong || Number(s.stats.str))}</div>
        <div class="panel hp" data-section="combat">
          <label>Максимум<input type="number" data-field="hpMax" value="${Number(s.hpMax)}"></label>
          <label class="hp-current">Текущие HP<input type="number" data-field="hpCurrent" value="${Number(s.hpCurrent)}"></label>
          <label>Временные<input type="number" data-field="hpTemp" value="${Number(s.hpTemp)}"></label>
          <button id="hp-manager" class="secondary manage" type="button">Здоровье и отдых</button>
        </div>
        <div class="panel" data-section="main"><h3 class="panel-title">Навыки</h3><div class="checks">${skillRows}</div></div>
        <div class="panel" data-section="combat">
          <div class="two-col">${field("Размер кости хитов", "hitDieSize", s.hitDieSize || 8, "number")}<label>Вдохновение<input type="checkbox" data-field="inspiration" ${s.inspiration ? "checked" : ""}></label></div>
          <div class="two-col">${field("Костей осталось", "hitDiceCurrent", s.hitDiceCurrent ?? s.level, "number")}${field("Всего костей", "hitDiceMax", s.hitDiceMax ?? s.level, "number")}</div>
          <div class="death">Спасброски от смерти: успехи <input type="number" min="0" max="3" data-field="deathSuccess" value="${Number(s.deathSuccess)}"> провалы <input type="number" min="0" max="3" data-field="deathFail" value="${Number(s.deathFail)}"></div>
        </div>
        <div class="panel" data-section="combat"><h3 class="panel-title">Атаки</h3><div class="attack-list">${attackRows}</div>${mine ? `<button id="attack-add" class="secondary" type="button">+ Добавить атаку</button>` : ""}${area("Прочие атаки и заклинания", "attacks", s.attacks, "Свободные заметки об атаках...")}</div>
        <div class="panel" data-section="features"><h3 class="panel-title">Ресурсы и заряды</h3><div class="entity-list">${resources || `<div class="read-only">Стрелы, ярость, ци, превосходство и любые другие заряды.</div>`}</div>${mine ? `<button id="resource-add" class="secondary" type="button">+ Добавить ресурс</button>` : ""}</div>
        <div class="panel" data-section="equipment"><div class="section-actions"><h3 class="panel-title">Снаряжение · ${inventoryWeight}/${carryingCapacity} фнт.</h3>${mine ? `<button id="item-add" class="secondary" type="button">+ Предмет</button>` : ""}</div><div class="entity-list">${inventoryRows || `<div class="read-only">Инвентарь пока пуст.</div>`}</div>${area("Дополнительное снаряжение", "equipment", s.equipment)}</div>
      </div>
      <div class="stack">
        <div class="panel" data-section="combat"><h3 class="panel-title">Состояния и истощение</h3><div class="active-conditions">${activeConditions}</div><div class="two-col">${field("Истощение", "exhaustion", s.exhaustion || 0, "number")}${mine ? `<button id="conditions-manager" class="secondary" type="button">Изменить</button>` : ""}</div></div>
        <div class="panel" data-section="equipment"><h3 class="panel-title">Монеты</h3><div class="coins">${coins}</div></div>
        <div class="panel" data-section="features">${area("Особенности и умения", "features", s.features)}</div>
        <div class="panel" data-section="spells"><h3 class="panel-title">Гримуар</h3><div class="two-col"><label>Характеристика<select data-field="spellcastingAbility"><option value="">—</option>${Object.entries(abilities).map(([key,name]) => `<option value="${key}" ${spellAbility === key ? "selected" : ""}>${name}</option>`).join("")}</select></label><div class="read-only">Сл ${spellSave} · атака ${signed(spellAttack)}</div></div><div class="spell-slots">${slots || `<span class="read-only">Настрой доступные ячейки.</span>`}</div><div class="section-actions">${mine ? `<button id="slots-manager" class="secondary" type="button">Ячейки</button><button id="spell-library" class="secondary" type="button">+ Из справочника</button><button id="spell-add" class="secondary" type="button">Хоумбрю</button>` : ""}</div><div class="entity-list">${spellRows || `<div class="read-only">Гримуар пока пуст.</div>`}</div>${area("Заметки заклинателя", "spells", s.spells)}</div>
        <div class="panel" data-section="personality"><h3 class="panel-title">Личность и внешность</h3>${s.portraitUrl ? `<img class="portrait-preview" src="${esc(s.portraitUrl)}" alt="Портрет">` : ""}${field("Ссылка на портрет", "portraitUrl", s.portraitUrl || "")}<div class="bio-grid">${field("Возраст", "age", s.age || "")}${field("Рост", "height", s.height || "")}${field("Вес", "weight", s.weight || "")}${field("Глаза", "eyes", s.eyes || "")}${field("Кожа", "skin", s.skin || "")}${field("Волосы", "hair", s.hair || "")}</div>${area("Внешность", "appearance", s.appearance || "")}${area("Предыстория персонажа", "backstory", s.backstory || "")}${area("Союзники и организации", "allies", s.allies || "")}${area("Черты характера", "personality", s.personality)}${area("Идеалы", "ideals", s.ideals)}${area("Привязанности", "bonds", s.bonds)}${area("Слабости", "flaws", s.flaws)}</div>
        <div class="panel" data-section="personality"><h3 class="panel-title">Будущий токен карты</h3><div class="bio-grid">${field("Картинка токена", "tokenImageUrl", s.tokenImageUrl || s.portraitUrl || "")}${field("Цвет рамки", "tokenColor", s.tokenColor || "#9f7842", "color")}${field("Зрение, футы", "tokenVision", s.tokenVision ?? 60, "number")}${field("Размер на сетке", "tokenScale", s.tokenScale ?? 1, "number")}</div><div class="read-only">Эти настройки уже сохраняются в персонаже и будут использованы модулем карты.</div></div>
        <div class="panel" data-section="goals"><div class="section-actions"><h3 class="panel-title">Цели и задачи</h3>${mine ? `<button id="goal-add" class="secondary" type="button">+ Цель</button>` : ""}</div><div class="entity-list">${goalRows || `<div class="read-only">Целей пока нет.</div>`}</div></div>
        <div class="panel" data-section="notes"><div class="section-actions"><h3 class="panel-title">Заметки</h3>${mine ? `<button id="note-add" class="secondary" type="button">+ Заметка</button>` : ""}</div>${noteRows}${area("Общие заметки", "notes", s.notes)}</div>
      </div>
    </div>
  </div>`;

  if (!mine) $$("input, textarea", $("#sheet-view")).forEach(el => el.disabled = true);
  updateDerived();
  if (mine) bindSheet();
  $$('[data-roll-stat]').forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.rollStat; roll(`1к20${signed(modifier(currentSheet().stats[key]))}`, abilities[key]);
  }));
  if (mine) bindGameControls();
  applySheetTab();
}

function applySheetTab() {
  const root = $("#sheet-view");
  $$('[data-sheet-tab]', root).forEach(button => {
    button.classList.toggle("active", button.dataset.sheetTab === state.sheetTab);
    button.onclick = () => { state.sheetTab = button.dataset.sheetTab; applySheetTab(); };
  });
  $$('[data-section]', root).forEach(section => section.classList.toggle("hidden", section.dataset.section !== state.sheetTab));
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
  sheet.saveProficiencies = $$('[data-save]:checked', $("#sheet-view")).map(el => el.dataset.save);
  sheet.skillProficiencies = $$('[data-skill]:checked', $("#sheet-view")).map(el => el.dataset.skill);
  sheet.expertise = $$('[data-expertise]:checked', $("#sheet-view")).map(el => el.dataset.expertise);
  sheet.coins = { ...(sheet.coins || {}) };
  $$('[data-coin]', $("#sheet-view")).forEach(el => sheet.coins[el.dataset.coin] = Math.max(0, Number(el.value || 0)));
  return sheet;
}
function bindSheet() {
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
  });
  $("#sheet-view").addEventListener("change", () => {
    clearTimeout(state.saveTimer);
    const sheet = collectSheet();
    rememberDraft(sheet);
    socket.emit("sheet:update", { sheet }, response => {
      $("#save-state").textContent = response.ok ? "Сохранено" : "Ошибка сохранения";
      if (response.ok) clearDraft();
    });
  });
}
function saveNow(sheet, message = "Сохранено") {
  state.room.players[state.clientId].sheet = sheet;
  rememberDraft(sheet);
  $("#save-state").textContent = "Сохраняю…";
  socket.emit("sheet:update", { sheet }, response => {
    $("#save-state").textContent = response.ok ? message : "Ошибка сохранения";
    if (response.ok) clearDraft();
  });
}
function openModal(title, content) {
  $("#modal-title").textContent = title;
  $("#modal-content").innerHTML = content;
  $("#game-modal").showModal();
}
function closeModal() { $("#game-modal").close(); $("#game-modal").classList.remove("library-open"); }

function bindGameControls() {
  $("#hp-manager")?.addEventListener("click", openHealthModal);
  $("#attack-add")?.addEventListener("click", () => openAttackModal());
  $("#conditions-manager")?.addEventListener("click", openConditionsModal);
  $("#slots-manager")?.addEventListener("click", openSlotsModal);
  $$('[data-attack-edit]').forEach(button => button.addEventListener("click", () => openAttackModal(button.dataset.attackEdit)));
  $$('[data-attack-roll]').forEach(button => button.addEventListener("click", () => {
    const attack = currentSheet().attacksList.find(item => item.id === button.dataset.attackRoll);
    if (attack) roll(`1к20${signed(resolveBonus(attack.bonus, currentSheet()))}`, `Атака: ${attack.name}`);
  }));
  $$('[data-damage-roll]').forEach(button => button.addEventListener("click", () => {
    const attack = currentSheet().attacksList.find(item => item.id === button.dataset.damageRoll);
    if (attack?.damage) roll(resolveDiceFormula(attack.damage, currentSheet()), `Урон: ${attack.name}`);
  }));
  $$('[data-slot-use]').forEach(button => button.addEventListener("click", () => changeSlot(Number(button.dataset.slotUse), 1)));
  $$('[data-slot-restore]').forEach(button => button.addEventListener("click", () => changeSlot(Number(button.dataset.slotRestore), -1)));
  $("#resource-add")?.addEventListener("click", () => openResourceModal());
  $$('[data-resource-edit]').forEach(button => button.addEventListener("click", () => openResourceModal(button.dataset.resourceEdit)));
  $$('[data-resource-change]').forEach(button => button.addEventListener("click", () => changeResource(button.dataset.resourceChange, Number(button.dataset.delta))));
  $("#item-add")?.addEventListener("click", () => openItemModal());
  $$('[data-item-edit]').forEach(button => button.addEventListener("click", () => openItemModal(button.dataset.itemEdit)));
  $("#spell-add")?.addEventListener("click", () => openSpellModal());
  $("#spell-library")?.addEventListener("click", openSpellLibrary);
  $$('[data-spell-edit]').forEach(button => button.addEventListener("click", () => openSpellModal(button.dataset.spellEdit)));
  $$('[data-spell-cast]').forEach(button => button.addEventListener("click", () => castSpell(button.dataset.spellCast)));
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

function openHealthModal() {
  const s = currentSheet();
  openModal("Здоровье и отдых", `
    <div class="hp-summary"><strong>${s.hpCurrent}/${s.hpMax}</strong>временные HP: ${s.hpTemp || 0}</div>
    <label>Количество<input id="hp-amount" type="number" min="0" value="1"></label>
    <div class="modal-actions"><button class="secondary" data-hp-action="damage">Получить урон</button><button class="secondary" data-hp-action="heal">Лечение</button><button class="secondary" data-hp-action="temp">Временные HP</button><button class="secondary" data-hp-action="max">Изменить максимум</button></div>
    <div class="panel">Кости хитов: <strong>${s.hitDiceCurrent}/${s.hitDiceMax}</strong>, к${s.hitDieSize}<div class="rest-actions"><button class="secondary" data-rest="short">Потратить кость</button><button class="primary" data-rest="long">Долгий отдых</button></div><button class="secondary" data-rest="short-complete">Завершить короткий отдых без траты кости</button></div>`);
  $$('[data-hp-action]', $("#modal-content")).forEach(button => button.addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    const amount = Math.max(0, Number($("#hp-amount").value || 0));
    if (button.dataset.hpAction === "damage") {
      const absorbed = Math.min(sheet.hpTemp || 0, amount);
      sheet.hpTemp -= absorbed;
      sheet.hpCurrent = Math.max(0, sheet.hpCurrent - (amount - absorbed));
    } else if (button.dataset.hpAction === "heal") sheet.hpCurrent = Math.min(sheet.hpMax, sheet.hpCurrent + amount);
    else if (button.dataset.hpAction === "temp") sheet.hpTemp = Math.max(sheet.hpTemp || 0, amount);
    else if (button.dataset.hpAction === "max") { sheet.hpMax = amount; sheet.hpCurrent = Math.min(sheet.hpCurrent, amount); }
    closeModal(); saveNow(sheet); renderSheet();
  }));
  $('[data-rest="short"]', $("#modal-content")).addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    if (sheet.hitDiceCurrent <= 0) return toast("Кости хитов закончились");
    const con = modifier(sheet.stats.con);
    socket.emit("dice:roll", { formula: `1к${sheet.hitDieSize}${signed(con)}`, label: "Кость хитов" }, response => {
      if (!response.ok) return toast(response.error);
      sheet.hitDiceCurrent -= 1;
      sheet.hpCurrent = Math.min(sheet.hpMax, sheet.hpCurrent + Math.max(0, response.total));
      sheet.resources = sheet.resources.map(resource => resource.reset === "short" ? { ...resource, current: resource.max } : resource);
      closeModal(); saveNow(sheet); renderSheet(); renderRolls();
    });
  });
  $('[data-rest="long"]', $("#modal-content")).addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    sheet.hpCurrent = sheet.hpMax;
    sheet.hpTemp = 0;
    sheet.deathSuccess = 0;
    sheet.deathFail = 0;
    sheet.hitDiceCurrent = Math.min(sheet.hitDiceMax, sheet.hitDiceCurrent + Math.max(1, Math.floor(sheet.hitDiceMax / 2)));
    sheet.spellSlots = sheet.spellSlots.map(slot => ({ ...slot, used: 0 }));
    sheet.resources = sheet.resources.map(resource => ["short", "long"].includes(resource.reset) ? { ...resource, current: resource.max } : resource);
    closeModal(); saveNow(sheet, "Отдых завершён"); renderSheet();
  });
  $('[data-rest="short-complete"]', $("#modal-content")).addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    sheet.resources = sheet.resources.map(resource => resource.reset === "short" ? { ...resource, current: resource.max } : resource);
    closeModal(); saveNow(sheet, "Короткий отдых завершён"); renderSheet();
  });
}

function openAttackModal(id = null) {
  const sheet = currentSheet();
  const attack = sheet.attacksList.find(item => item.id === id) || { id: crypto.randomUUID(), name: "", bonus: "[DEX]+[PROF]", damage: "1d6+[DEX]", damageType: "", notes: "" };
  openModal(id ? "Настроить атаку" : "Новая атака", `
    <label>Название<input id="attack-name" value="${esc(attack.name)}" placeholder="Длинный лук +1"></label>
    <div class="two-col"><label>Бонус атаки<input id="attack-bonus" value="${esc(attack.bonus)}" placeholder="[DEX]+[PROF]+1"></label><label>Урон<input id="attack-damage" value="${esc(attack.damage)}" placeholder="1d8+[DEX]+1"></label></div>
    <label>Тип урона<input id="attack-type" value="${esc(attack.damageType)}" placeholder="колющий"></label>
    <label>Заметки<textarea id="attack-notes">${esc(attack.notes)}</textarea></label>
    <div class="modal-actions"><button id="attack-save" class="primary">Сохранить</button>${id ? `<button id="attack-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#attack-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const value = { id: attack.id, name: $("#attack-name").value.trim(), bonus: $("#attack-bonus").value.trim(), damage: $("#attack-damage").value.trim(), damageType: $("#attack-type").value.trim(), notes: $("#attack-notes").value.trim() };
    const index = next.attacksList.findIndex(item => item.id === attack.id);
    if (index >= 0) next.attacksList[index] = value; else next.attacksList.push(value);
    closeModal(); saveNow(next); renderSheet();
  });
  $("#attack-delete")?.addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    next.attacksList = next.attacksList.filter(item => item.id !== attack.id);
    closeModal(); saveNow(next); renderSheet();
  });
}

function openConditionsModal() {
  const sheet = currentSheet();
  openModal("Состояния", `<div class="conditions-list">${conditionNames.map(name => `<label class="condition-chip"><input type="checkbox" value="${esc(name)}" ${sheet.conditions.includes(name) ? "checked" : ""}>${esc(name)}</label>`).join("")}</div><button id="conditions-save" class="primary">Применить</button>`);
  $("#conditions-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    next.conditions = $$('.condition-chip input:checked', $("#modal-content")).map(input => input.value);
    closeModal(); saveNow(next); renderSheet();
  });
}

function openSlotsModal() {
  const sheet = currentSheet();
  openModal("Ячейки заклинаний", `${sheet.spellSlots.map(slot => `<label>${slot.level} уровень<input type="number" min="0" max="20" data-slot-total="${slot.level}" value="${slot.total}"></label>`).join("")}<button id="slots-save" class="primary">Сохранить</button>`);
  $("#slots-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    $$('[data-slot-total]', $("#modal-content")).forEach(input => {
      const slot = next.spellSlots.find(item => item.level === Number(input.dataset.slotTotal));
      slot.total = Math.max(0, Number(input.value || 0));
      slot.used = Math.min(slot.used, slot.total);
    });
    closeModal(); saveNow(next); renderSheet();
  });
}

function changeSlot(level, delta) {
  const next = structuredClone(currentSheet());
  const slot = next.spellSlots.find(item => item.level === level);
  if (!slot) return;
  slot.used = Math.max(0, Math.min(slot.total, slot.used + delta));
  saveNow(next); renderSheet();
}

function openResourceModal(id = null) {
  const resource = currentSheet().resources.find(item => item.id === id) || { id: crypto.randomUUID(), name: "", current: 0, max: 1, reset: "none" };
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
  const item = currentSheet().inventoryList.find(entry => entry.id === id) || { id: crypto.randomUUID(), name: "", quantity: 1, weight: 0, equipped: false, attuned: false, magical: false, description: "" };
  openModal(id ? "Предмет" : "Новый предмет", `
    <label>Название<input id="item-name" value="${esc(item.name)}"></label>
    <div class="two-col"><label>Количество<input id="item-quantity" type="number" min="0" value="${Number(item.quantity)}"></label><label>Вес одного, фнт.<input id="item-weight" type="number" min="0" step="0.1" value="${Number(item.weight)}"></label></div>
    <div class="conditions-list"><label class="condition-chip"><input id="item-equipped" type="checkbox" ${item.equipped ? "checked" : ""}>Надето</label><label class="condition-chip"><input id="item-attuned" type="checkbox" ${item.attuned ? "checked" : ""}>Настроено</label><label class="condition-chip"><input id="item-magical" type="checkbox" ${item.magical ? "checked" : ""}>Магический</label></div>
    <label>Описание<textarea id="item-description">${esc(item.description)}</textarea></label>
    <div class="modal-actions"><button id="item-save" class="primary">Сохранить</button>${id ? `<button id="item-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#item-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const value = { id: item.id, name: $("#item-name").value.trim(), quantity: Math.max(0, Number($("#item-quantity").value || 0)), weight: Math.max(0, Number($("#item-weight").value || 0)), equipped: $("#item-equipped").checked, attuned: $("#item-attuned").checked, magical: $("#item-magical").checked, description: $("#item-description").value.trim() };
    const index = next.inventoryList.findIndex(entry => entry.id === item.id);
    if (index >= 0) next.inventoryList[index] = value; else next.inventoryList.push(value);
    closeModal(); saveNow(next); renderSheet();
  });
  $("#item-delete")?.addEventListener("click", () => deleteEntity("inventoryList", item.id));
}

function openSpellModal(id = null) {
  const spell = currentSheet().spellsList.find(entry => entry.id === id) || { id: crypto.randomUUID(), name: "", level: 0, school: "", castingTime: "1 действие", range: "", duration: "", damage: "", prepared: true, ritual: false, concentration: false, description: "" };
  openModal(id ? "Заклинание" : "Новое заклинание", `
    <label>Название<input id="spell-name" value="${esc(spell.name)}"></label>
    <div class="two-col"><label>Уровень<input id="spell-level" type="number" min="0" max="9" value="${Number(spell.level)}"></label><label>Школа<input id="spell-school" value="${esc(spell.school)}"></label></div>
    <div class="two-col"><label>Время накладывания<input id="spell-time" value="${esc(spell.castingTime)}"></label><label>Дистанция<input id="spell-range" value="${esc(spell.range)}"></label></div>
    <label>Длительность<input id="spell-duration" value="${esc(spell.duration)}"></label>
    <label>Бросок урона/лечения<input id="spell-damage" value="${esc(spell.damage)}" placeholder="2d6+[WIS]"></label>
    <div class="conditions-list"><label class="condition-chip"><input id="spell-prepared" type="checkbox" ${spell.prepared ? "checked" : ""}>Подготовлено</label><label class="condition-chip"><input id="spell-ritual" type="checkbox" ${spell.ritual ? "checked" : ""}>Ритуал</label><label class="condition-chip"><input id="spell-concentration" type="checkbox" ${spell.concentration ? "checked" : ""}>Концентрация</label></div>
    <label>Описание<textarea id="spell-description">${esc(spell.description)}</textarea></label>
    <div class="modal-actions"><button id="spell-save" class="primary">Сохранить</button>${id ? `<button id="spell-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#spell-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const value = { id: spell.id, name: $("#spell-name").value.trim(), level: Math.max(0, Math.min(9, Number($("#spell-level").value || 0))), school: $("#spell-school").value.trim(), castingTime: $("#spell-time").value.trim(), range: $("#spell-range").value.trim(), duration: $("#spell-duration").value.trim(), damage: $("#spell-damage").value.trim(), prepared: $("#spell-prepared").checked, ritual: $("#spell-ritual").checked, concentration: $("#spell-concentration").checked, description: $("#spell-description").value.trim() };
    const index = next.spellsList.findIndex(entry => entry.id === spell.id);
    if (index >= 0) next.spellsList[index] = value; else next.spellsList.push(value);
    closeModal(); saveNow(next); renderSheet();
  });
  $("#spell-delete")?.addEventListener("click", () => deleteEntity("spellsList", spell.id));
}

async function openSpellLibrary() {
  try {
    spellCatalog ||= await fetch("/spells-5e.json").then(response => {
      if (!response.ok) throw new Error("catalog");
      return response.json();
    });
  } catch {
    return toast("Не удалось открыть справочник");
  }
  $("#game-modal").classList.add("library-open");
  openModal("Справочник заклинаний", `
    <div class="spell-library-tools">
      <label>Поиск<input id="spell-search" autocomplete="off" placeholder="Огненный шар, лечение, щит..."></label>
      <label>Уровень<select id="spell-level-filter"><option value="all">Все</option><option value="0">Заговоры</option>${Array.from({length: 9}, (_, i) => `<option value="${i + 1}">${i + 1} уровень</option>`).join("")}</select></label>
      <label>Класс<select id="spell-class-filter"><option value="all">Все классы</option>${["Бард","Волшебник","Друид","Жрец","Колдун","Паладин","Следопыт","Чародей"].map(name => `<option>${name}</option>`).join("")}</select></label>
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
    $("#spell-library-results").innerHTML = found.map(spell => `
      <article class="spell-card">
        <div><span class="spell-level">${spell.level || "З"}</span></div>
        <div><strong>${esc(spell.name)}</strong><small>${esc(spell.school)} · ${esc(spell.castingTime)} · ${esc(spell.range)}</small><p>${esc(spell.description)}</p><small>${esc(spell.classes.join(", "))}${spell.concentration ? " · концентрация" : ""}${spell.ritual ? " · ритуал" : ""}</small></div>
        <button class="primary" data-catalog-spell="${esc(spell.key)}">Добавить</button>
      </article>`).join("") || `<div class="read-only">Ничего не найдено. Попробуй другое слово или фильтр.</div>`;
    $$('[data-catalog-spell]', $("#spell-library-results")).forEach(button => button.addEventListener("click", () => {
      const source = spellCatalog.find(spell => spell.key === button.dataset.catalogSpell);
      const next = structuredClone(currentSheet());
      next.spellsList.push({ ...structuredClone(source), id: crypto.randomUUID(), prepared: true });
      delete next.spellsList.at(-1).key;
      delete next.spellsList.at(-1).classes;
      saveNow(next, "Заклинание добавлено");
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
  if (Number(spell.level) === 0 || spell.ritual) return completeSpellCast(spell, null);
  const available = sheet.spellSlots.filter(slot => slot.level >= Number(spell.level) && slot.used < slot.total);
  if (!available.length) return toast(`Нет подходящих ячеек для «${spell.name}»`);
  openModal(`Сотворить «${spell.name}»`, `<p>Выбери уровень ячейки:</p><div class="quick-dice">${available.map(slot => `<button data-cast-level="${slot.level}">${slot.level}</button>`).join("")}</div><button id="cast-ritual" class="secondary">Не тратить ячейку</button>`);
  $$('[data-cast-level]', $("#modal-content")).forEach(button => button.addEventListener("click", () => completeSpellCast(spell, Number(button.dataset.castLevel))));
  $("#cast-ritual").addEventListener("click", () => completeSpellCast(spell, null));
}
function completeSpellCast(spell, slotLevel) {
  const next = structuredClone(currentSheet());
  if (slotLevel) next.spellSlots.find(slot => slot.level === slotLevel).used += 1;
  if ($("#game-modal").open) closeModal();
  saveNow(next); renderSheet();
  if (spell.damage) roll(resolveDiceFormula(spell.damage, next), `Заклинание: ${spell.name}${slotLevel ? ` (${slotLevel} ур.)` : ""}`);
  else socket.emit("activity:log", { label: `Сотворено: ${spell.name}`, detail: slotLevel ? `Ячейка ${slotLevel} уровня` : "Без ячейки" }, () => renderRolls());
}

function openGoalModal(id = null) {
  const goal = currentSheet().goalsList.find(entry => entry.id === id) || { id: crypto.randomUUID(), text: "", done: false };
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
  const note = currentSheet().notesList.find(entry => entry.id === id) || { id: crypto.randomUUID(), title: "", text: "" };
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
  const next = structuredClone(currentSheet());
  next[collection] = next[collection].filter(entry => entry.id !== id);
  closeModal(); saveNow(next); renderSheet();
}

function rollSkill(key) {
  const sheet = currentSheet();
  const skill = skills.find(entry => entry[0] === key); if (!skill) return;
  const bonus = getSkillBonus(sheet, key);
  roll(`1к20${signed(bonus)}`, skill[1]);
}
function rollSave(key) {
  const sheet = currentSheet();
  const bonus = modifier(sheet.stats[key]) + (sheet.saveProficiencies.includes(key) ? Number(sheet.proficiency) : 0);
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
    saveNow(merged, "Импортировано"); renderSheet();
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
    const saveEl = $(`[data-save-bonus="${key}"]`, root); if (saveEl) saveEl.textContent = signed(mod + (s.saveProficiencies.includes(key) ? Number(s.proficiency) : 0));
  });
  skills.forEach(([key, , ability]) => {
    const el = $(`[data-skill-bonus="${key}"]`, root);
    const multiplier = (s.expertise || []).includes(key) ? 2 : (s.skillProficiencies.includes(key) ? 1 : 0);
    if (el) el.textContent = signed(modifier(s.stats[ability]) + Number(s.proficiency) * multiplier);
  });
  const initiative = $('[data-derived="initiative"]', root); if (initiative) initiative.value = signed(modifier(s.stats.dex));
}

function roll(formula, label = formula) {
  socket.emit("dice:roll", { formula, label }, response => {
    if (!response.ok) toast(response.error);
    else showRollPeek(label, response.total);
  });
}
function showRollPeek(label, total) {
  const peek = $("#roll-peek");
  $("span", peek).textContent = label;
  $("strong", peek).textContent = total;
  peek.classList.remove("hidden");
  clearTimeout(state.rollPeekTimer);
  state.rollPeekTimer = setTimeout(() => peek.classList.add("hidden"), 8000);
}
$$('[data-die]').forEach(button => button.addEventListener("click", () => roll(button.dataset.die)));
$("#custom-roll").addEventListener("submit", event => { event.preventDefault(); const formula = new FormData(event.currentTarget).get("formula"); roll(formula); });
function renderRolls() {
  if (!state.room) return;
  $("#roll-log").innerHTML = state.room.rollLog.length ? [...state.room.rollLog].reverse().map(item => `
    <div class="roll"><div><strong>${esc(item.player)}</strong><br><span>${esc(item.label)}${item.activity ? ` · ${esc(item.activity)}` : ` · [${(item.dice || []).join(", ")}]${item.modifier ? ` ${signed(item.modifier)}` : ""}`}</span></div><b>${item.total === null ? "✦" : item.total}</b></div>`).join("") : `<div class="read-only">Здесь появятся броски всей партии.</div>`;
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
