const socket = io();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SHEET_SCHEMA_VERSION = 13;
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
  combatTab: localStorage.getItem("tt-combat-tab") || "actions",
  loadoutFilter: "all",
  loadoutSearch: "",
  selectedLoadoutItemId: "",
  mapSelectedTokenId: "",
  currentView: "sheet",
  previousView: "sheet",
  editMode: localStorage.getItem("tt-edit-mode") === "1",
  resuming: false,
  rollPlayerFilter: "all",
  rollTypeFilter: "all"
};
const rules = window.TT_RULES;
const itemSystem = window.TT_ITEM_SYSTEM;
let spellCatalog = null;
const itemCatalog2014 = [
  ...(Array.isArray(window.TT_ITEMS_2014) ? window.TT_ITEMS_2014 : []),
  ...(Array.isArray(window.TT_ITEMS_XGTE_TCOE) ? window.TT_ITEMS_XGTE_TCOE : [])
].map(item => itemSystem.enrichCatalogItem(item));
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
const conditionNames = ["Скрыт", "Ослеплён", "Очарован", "Оглушён", "Отравлен", "Испуган", "Схвачен", "Недееспособен", "Невидим", "Парализован", "Окаменел", "Сбит с ног", "Опутан", "Без сознания", "Истощён"];

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}
function sourceShort(sourceId) { return rules.sourceInfo?.(sourceId)?.short || ""; }
function sourceSuffix(sourceId) { return sourceId && sourceId !== "srd2014" ? ` · ${sourceShort(sourceId)}` : ""; }
function sourceBadge(sourceId) {
  if (!sourceId || sourceId === "srd2014") return "";
  const source = rules.sourceInfo?.(sourceId);
  return `<span class="content-source-badge" title="${esc(source?.name || sourceId)}">${esc(source?.short || sourceId)}</span>`;
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
function spellFocusBonus(sheet) {
  const classKeys = new Set(classEntries(sheet).map(entry => entry.key));
  return (sheet.inventoryList || []).filter(item => item.attuned && Number(item.spellBonus || 0) > 0 && (!Array.isArray(item.spellClassKeys) || item.spellClassKeys.some(key => classKeys.has(key)))).reduce((best,item) => Math.max(best,Number(item.spellBonus || 0)),0);
}
function passiveBonus(sheet, key) { return hasFeat(sheet, "observant") && ["perception","investigation"].includes(key) ? 5 : 0; }
function passivePerception(sheet) { return 10 + getSkillBonus(sheet,"perception") + passiveBonus(sheet,"perception") + Number(sheet.passivePerceptionBonus || 0); }
function effectiveProficiency(sheet) { return sheet.autoProficiency ? rules.proficiency(totalLevel(sheet)) : Number(sheet.proficiency || 0); }
function initiativeBonus(sheet) { return modifier(sheet.stats.dex) + Number(sheet.initiativeBonus || 0) + (hasFeat(sheet, "alert") ? 5 : 0); }
const classSymbols = { artificer:"⚙", barbarian:"◈", bard:"♫", cleric:"✚", druid:"❧", fighter:"⚔", monk:"☯", paladin:"✦", ranger:"➹", rogue:"⤫", sorcerer:"✧", warlock:"⌁", wizard:"⌃" };
function classGlyph(classKey, title = "") {
  const safeKey = rules.classes[classKey] ? classKey : "unknown";
  return `<span class="class-glyph" data-class="${safeKey}" title="${esc(title || rules.classes[classKey]?.name || "Класс")}">${esc(classSymbols[classKey] || "")}</span>`;
}

const combatSlotKeys = ["head", "neck", "cloak", "body", "mainHand", "offHand", "belt", "feet", "ammo"];
const combatSetIds = ["a", "b", "c"];
const combatSlotMeta = {
  head:{ label:"Голова", icon:"⌃", hint:"Шлем, обруч или очки" },
  neck:{ label:"Шея", icon:"◇", hint:"Амулет или ожерелье" },
  cloak:{ label:"Плечи", icon:"◖", hint:"Плащ или накидка" },
  body:{ label:"Тело", icon:"⬡", hint:"Доспех или одежда" },
  mainHand:{ label:"Основная рука", icon:"⚔", hint:"Оружие или фокус" },
  offHand:{ label:"Вторая рука", icon:"◈", hint:"Щит, оружие или фокус" },
  belt:{ label:"Пояс", icon:"≋", hint:"Подсумок или инструмент" },
  feet:{ label:"Ступни", icon:"⌄", hint:"Сапоги или обувь" },
  ammo:{ label:"Боеприпасы", icon:"➹", hint:"Стрелы, болты или камни" }
};

function emptyCombatSet(setId, index = 0) {
  return { id:setId, name:`Комплект ${String.fromCharCode(65 + index)}`, slots:Object.fromEntries(combatSlotKeys.map(key => [key,""])), quickSlots:Array(5).fill("") };
}
function isAmmoItem(item) { return item?.combatKind === "ammo" || /стрел|болт|боеприпас|снаряд|arrow|bolt/i.test(`${item?.name || ""} ${item?.catalogKey || ""} ${item?.description || ""}`); }
function isConsumableItem(item) { return item?.combatKind === "consumable" || /зель|potion|свиток|эликсир|яд|масло/i.test(`${item?.name || ""} ${item?.catalogKey || ""}`); }
function isShieldItem(item) { return item?.type === "armor" && (item?.armorType === "shield" || /щит/i.test(item?.name || "")); }
function isTwoHandedItem(item) { return item?.type === "weapon" && /двуруч/i.test(`${item?.properties || ""} ${item?.description || ""}`); }
function isRangedWeapon(item) { return item?.type === "weapon" && (/боеприпас/i.test(`${item?.properties || ""} ${item?.description || ""}`) || /лук|арбалет|пращ/i.test(item?.name || "")); }
function requiredAmmoKey(item) {
  const key = itemSystem.normalizeCatalogKey(item?.baseCatalogKey || item?.catalogKey);
  const text = `${key} ${item?.name || ""}`.toLowerCase();
  if (/crossbow|арбалет/.test(text)) return "crossbow-bolt";
  if (/blowgun|духов/.test(text)) return "blowgun-needle";
  if (/sling|пращ/.test(text)) return "sling-bullet";
  if (/bow|лук/.test(text)) return "arrow";
  return "";
}
function ammoMatchesWeapon(weapon, ammo) {
  const required = requiredAmmoKey(weapon);
  if (!required || !ammo) return true;
  return itemSystem.normalizeCatalogKey(ammo.baseCatalogKey || ammo.catalogKey) === required;
}
function itemCombatKind(item) {
  if (item?.combatKind && item.combatKind !== "auto") return item.combatKind;
  if (isAmmoItem(item)) return "ammo";
  if (isConsumableItem(item)) return "consumable";
  if (item?.type === "weapon") return "weapon";
  if (item?.type === "armor") return "armor";
  if (item?.magical) return "magic";
  return "gear";
}
function itemCombatIcon(item) {
  const kind = itemCombatKind(item);
  if (kind === "weapon") return "⚔";
  if (kind === "armor") return isShieldItem(item) ? "◈" : "⬡";
  if (kind === "ammo") return "➹";
  if (kind === "consumable") return "✚";
  if (kind === "magic") return "✦";
  return "◆";
}
function recommendedCombatSlots(item) {
  if (!item) return [];
  if (combatSlotKeys.includes(item.slotHint)) return [item.slotHint];
  const text = `${item.name || ""} ${item.description || ""}`.toLowerCase();
  if (isAmmoItem(item)) return ["ammo"];
  if (item.type === "weapon") return isTwoHandedItem(item) ? ["mainHand"] : ["mainHand","offHand"];
  if (isShieldItem(item)) return ["offHand"];
  if (item.type === "armor") return ["body"];
  if (/шлем|шап|обруч|очки|маск/.test(text)) return ["head"];
  if (/амулет|ожерел|медальон|талисман/.test(text)) return ["neck"];
  if (/плащ|накид|мант/.test(text)) return ["cloak"];
  if (/сапог|ботин|обув/.test(text)) return ["feet"];
  if (/пояс|ремень|подсум/.test(text)) return ["belt"];
  return ["belt","head","neck","cloak","feet"];
}
function ensureCombatLoadout(sheet) {
  sheet.inventoryList = Array.isArray(sheet.inventoryList) ? sheet.inventoryList : [];
  const validIds = new Set(sheet.inventoryList.map(item => item.id).filter(Boolean));
  const source = sheet.combatLoadout && typeof sheet.combatLoadout === "object" ? sheet.combatLoadout : {};
  const savedSets = Array.isArray(source.sets) ? source.sets : Object.values(source.sets || {});
  const keep = itemId => validIds.has(itemId) ? itemId : "";
  const sets = combatSetIds.map((setId,index) => {
    const saved = savedSets.find(set => set?.id === setId) || savedSets[index] || {}, empty = emptyCombatSet(setId,index);
    return { id:setId, name:String(saved.name || empty.name).slice(0,40), slots:Object.fromEntries(combatSlotKeys.map(key => [key,keep(saved.slots?.[key])])), quickSlots:Array.from({length:5},(_,slotIndex)=>keep(saved.quickSlots?.[slotIndex])) };
  });
  const initialized = Boolean(source.initialized);
  if (!initialized && sheet.inventoryList.length) {
    const active = sets[0], equipped = sheet.inventoryList.filter(item => item.equipped);
    const body = equipped.find(item => item.type === "armor" && !isShieldItem(item));
    const shield = equipped.find(isShieldItem);
    const weapon = equipped.find(item => item.type === "weapon") || sheet.inventoryList.find(item => item.type === "weapon");
    const ammo = sheet.inventoryList.find(isAmmoItem);
    const quick = sheet.inventoryList.find(isConsumableItem);
    if (body) active.slots.body = body.id;
    if (shield) active.slots.offHand = shield.id;
    if (weapon) active.slots.mainHand = weapon.id;
    if (ammo) active.slots.ammo = ammo.id;
    if (quick) active.quickSlots[0] = quick.id;
  }
  const attuned = sheet.inventoryList.filter(item => item.attuned).map(item => item.id);
  const savedAttuned = Array.isArray(source.attunementSlots) ? source.attunementSlots.map(keep).filter(Boolean) : [];
  sheet.combatLoadout = {
    initialized: initialized || sheet.inventoryList.length > 0,
    activeSet: combatSetIds.includes(source.activeSet) ? source.activeSet : "a",
    autoAmmo: source.autoAmmo !== false,
    sets,
    attunementSlots:[...new Set([...savedAttuned,...attuned])].slice(0,20)
  };
  return sheet.combatLoadout;
}
function activeCombatSet(sheet) {
  const loadout = ensureCombatLoadout(sheet);
  return loadout.sets.find(set => set.id === loadout.activeSet) || loadout.sets[0];
}
function combatItem(sheet, itemId) { return (sheet.inventoryList || []).find(item => item.id === itemId); }
function activeCombatItemIds(sheet) { return new Set(Object.values(activeCombatSet(sheet).slots || {}).filter(Boolean)); }
function syncActiveEquipmentFlags(sheet) {
  const activeIds = activeCombatItemIds(sheet);
  (sheet.inventoryList || []).forEach(item => {
    if (["weapon","armor"].includes(item.type)) item.equipped = activeIds.has(item.id);
  });
  if (sheet.autoArmorClass) sheet.ac = calculateAc(sheet);
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
function levelFeaturesMarkup(classKey, classLevel, subclass = "", enabledOptional = []) {
  return rules.featuresAt(classKey, classLevel, subclass, enabledOptional).map(feature => `<article class="level-gain ${feature.choice ? "choice" : ""}"><span>${feature.choice ? "?" : "✓"}</span><div><strong>${esc(feature.name)}</strong><p>${esc(feature.summary)}</p></div>${feature.choice ? "<b>нужен выбор</b>" : ""}</article>`).join("");
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
function applyInfusionToItem(item, infusionKey, artificerLevel = 1) {
  const infusion = rules.infusions?.find(entry => entry.key === infusionKey);
  item.baseMagical = item.baseMagical ?? Boolean(item.magical && !item.infused);
  item.baseMagicBonus = Number(item.baseMagicBonus ?? item.magicBonus ?? 0);
  item.baseSpellBonus = Number(item.baseSpellBonus ?? item.spellBonus ?? 0);
  item.magicBonus = Number(item.baseMagicBonus || 0);
  item.spellBonus = Number(item.baseSpellBonus || 0);
  item.infused = Boolean(infusion);
  item.infusionKey = infusion?.key || "";
  item.infusionName = infusion?.name || "";
  if (!infusion) { item.magical = Boolean(item.baseMagical || item.baseMagicBonus || item.baseSpellBonus); return item; }
  item.magical = true;
  const improved = artificerLevel >= 10 ? 2 : 1;
  if (["enhanced-defense","enhanced-weapon"].includes(infusion.key)) item.magicBonus = Math.max(item.magicBonus,improved);
  if (infusion.key === "enhanced-arcane-focus") item.spellBonus = Math.max(item.spellBonus,improved);
  if (["repeating-shot","returning-weapon","radiant-weapon","repulsion-shield"].includes(infusion.key)) item.magicBonus = Math.max(item.magicBonus,1);
  return item;
}
function syncCharacterMechanics(sheet) {
  ensureCombatLoadout(sheet);
  sheet.optionalFeatures = Array.isArray(sheet.optionalFeatures) ? sheet.optionalFeatures : [];
  sheet.infusionsKnown = Array.isArray(sheet.infusionsKnown) ? sheet.infusionsKnown : [];
  sheet.infusedItemIds = Array.isArray(sheet.infusedItemIds) ? sheet.infusedItemIds : [];
  sheet.originCustomization = sheet.originCustomization && typeof sheet.originCustomization === "object" ? sheet.originCustomization : { enabled:false, flexibleAbilities:[], skillChoice:"", lineageTalent:"darkvision", size:"", languageChoice:"", proficiencyChoice:"", levelOneFeatKey:"", levelOneFeatAbility:"" };
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
  sheet.spellsList = Array.isArray(sheet.spellsList) ? sheet.spellsList : [];
  const subclassSpellEntries=rules.subclassSpellsFor?.(sheet) || [];
  const expectedSubclassSpells=new Map(subclassSpellEntries.map(entry=>[`${entry.sourceClassKey}:${entry.subclass}:${entry.key}`,entry]));
  sheet.spellsList=sheet.spellsList.filter(spell=>!spell.automaticSubclass || expectedSubclassSpells.has(spell.automaticSubclassKey));
  sheet.spellsList.forEach(spell=>{ spell.alwaysPreparedBySubclass=false; spell.subclassGrantName=""; });
  expectedSubclassSpells.forEach((source,automaticSubclassKey)=>{
    let spell=sheet.spellsList.find(entry=>entry.catalogKey===source.key);
    if (!spell) {
      spell={ ...structuredClone(source), id:uuid(), catalogKey:source.key, sourceClassKey:source.sourceClassKey, prepared:true, automaticSubclass:true, automaticSubclassKey };
      delete spell.key; delete spell.mode; delete spell.grantLevel; delete spell.subclass;
      sheet.spellsList.push(spell);
    }
    spell.prepared=true;
    spell.alwaysPreparedBySubclass=true;
    spell.subclassGrantName=source.subclass;
    if (spell.automaticSubclass) spell.automaticSubclassKey=automaticSubclassKey;
  });
  sheet.resources = Array.isArray(sheet.resources) ? sheet.resources : [];
  const expected = new Map();
  const addAutomatic = (automaticKey, source) => {
    const max = Math.max(0,Number(source.max || 0));
    expected.set(automaticKey,{ ...source, max, automatic:true, automaticKey });
  };
  sheet.classes.forEach(entry => {
    const cls = rules.classes[entry.key];
    (cls?.resources?.(entry.level, { ...sheet, level:entry.level }) || []).forEach(source => addAutomatic(`${entry.key}:${source.name}`,source));
    (rules.subclassResourcesFor?.(entry.key,entry.subclass,entry.level,sheet) || []).forEach(source => addAutomatic(source.key || `subclass:${entry.key}:${entry.subclass}:${source.name}`,source));
  });
  (sheet.feats || []).forEach(feat => {
    const key=featKey(feat), resource=rules.feats[key]?.resource;
    if (!resource) return;
    const max=resource.maxFormula ? rules.resolveResourceMax(resource.maxFormula,sheet,sheet.level) : Number(resource.max || 0);
    addAutomatic(`feat:${key}`,{ name:resource.name, max, reset:resource.reset || "long" });
  });
  sheet.resources = sheet.resources.filter(resource => !resource.automatic || expected.has(resource.automaticKey || ""));
  expected.forEach((source,automaticKey) => {
    const existing = sheet.resources.find(resource => resource.automaticKey === automaticKey);
    if (existing) {
      const spent = Math.max(0, Number(existing.max || 0) - Number(existing.current || 0));
      Object.assign(existing, source, { current:Math.max(0,Number(source.max)-spent) });
    } else sheet.resources.push({ id:uuid(), ...source, current:source.max });
  });
  const artificerLevel=classLevel(sheet,"artificer");
  const activeIds=new Set(sheet.infusedItemIds);
  sheet.inventoryList=(sheet.inventoryList || []).map(item => {
    if (!activeIds.has(item.id)) return applyInfusionToItem(item,"",artificerLevel);
    return applyInfusionToItem(item,item.infusionKey,artificerLevel);
  });
  sheet.xp = Math.max(0, Number(sheet.xp) || 0);
  sheet.schemaVersion = SHEET_SCHEMA_VERSION;
  if (sheet.autoArmorClass) sheet.ac = calculateAc(sheet);
  return sheet;
}
function calculateAc(sheet) {
  if (!sheet.autoArmorClass) return Number(sheet.ac || 10);
  const activeIds = sheet.combatLoadout ? activeCombatItemIds(sheet) : new Set();
  const equipped = (sheet.inventoryList || []).filter(item => item.type === "armor" && (activeIds.size ? activeIds.has(item.id) : item.equipped));
  const body = equipped.filter(item => item.armorType !== "shield").sort((a,b) => (Number(b.baseAc||0)+Number(b.magicBonus||0))-(Number(a.baseAc||0)+Number(a.magicBonus||0)))[0];
  const shield = equipped.filter(item => item.armorType === "shield").sort((a,b) => (Number(b.baseAc||2)+Number(b.magicBonus||0))-(Number(a.baseAc||2)+Number(a.magicBonus||0)))[0];
  const dex = modifier(sheet.stats.dex);
  let ac = 10 + dex;
  if (!body && hasClass(sheet, "barbarian")) ac = 10 + dex + modifier(sheet.stats.con);
  if (!body && hasClass(sheet, "monk") && !shield) ac = 10 + dex + modifier(sheet.stats.wis);
  const bodyBonus = Number(body?.magicBonus || 0);
  if (body?.armorType === "light") ac = Number(body.baseAc) + dex + bodyBonus;
  else if (body?.armorType === "medium") ac = Number(body.baseAc) + Math.min(2, dex) + bodyBonus;
  else if (body?.armorType === "heavy") ac = Number(body.baseAc) + bodyBonus;
  const shieldBonus = shield ? Number(shield.baseAc || 2) + Number(shield.magicBonus || 0) : 0;
  return ac + shieldBonus;
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
const healingSpellKeys = new Set(["cure-wounds","healing-word","mass-cure-wounds","mass-healing-word","heal","regenerate","mass-heal","healing-spirit"]);
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
  const extra = customUpcast || spell.upcastDice || spellUpcastDice[spell.catalogKey];
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
function openQuickGuide(firstVisit = false) {
  openModal(firstVisit ? "Добро пожаловать в TabaxiTable 2.5" : "Краткая справка", `<div class="quick-guide"><section><span>☷</span><div><strong>Лист</strong><p>Игровой режим защищает значения от случайной правки. Нажимай на бонусы, формулы атак, навыки и спасброски, чтобы кидать кости.</p></div></section><section><span>🎲</span><div><strong>Дайстрей</strong><p>Собери горсть вручную или введи физическую формулу вроде 3d6+1. Переключатель «Всем / Закрыто» действует и на карте.</p></div></section><section><span>▦</span><div><strong>Карта</strong><p>V — выбор, H — рука, M — линейка, K — кубики. Ведущий может выделять группы, сохранять встречи и вручную скрывать карту туманом войны.</p></div></section><section><span>♜</span><div><strong>Бестиарий</strong><p>Выбери существо, посмотри статблок и поставь одну или несколько готовых копий на карту. Токен сразу получает HP, КД, размер и NPC-лист.</p></div></section><section><span>?</span><div><strong>Справка всегда рядом</strong><p>Эту памятку можно снова открыть кнопкой «?» в верхней панели.</p></div></section><button id="quick-guide-close" class="primary" type="button">К столу</button></div>`);
  $("#quick-guide-close")?.addEventListener("click", () => { localStorage.setItem("tt-2-tour","1"); closeModal(); });
}

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
  syncOwnMechanicsOnLoad();
  renderAll();
  if (!localStorage.getItem("tt-2-tour")) setTimeout(() => openQuickGuide(true), 250);
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
    const restoredSheet=syncCharacterMechanics(structuredClone(saved.sheet));
    state.room.players[clientId].sheet = restoredSheet;
    socket.emit("sheet:update", { sheet: restoredSheet }, response => {
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
        syncOwnMechanicsOnLoad();
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

function roomDiceColors(room = state.room) {
  const own = room?.players?.[state.clientId]?.sheet?.diceColor || "#d3ad6e";
  return [own, ...Object.values(room?.players || {}).map(player => player?.sheet?.diceColor).filter(Boolean), own];
}

socket.on("room:state", room => {
  if (!state.room || room.code !== state.room.code) return;
  state.room = room;
  if (!room.players[state.selectedId]) state.selectedId = state.clientId;
  window.TT_DICE_PHYSICS?.prewarm?.(roomDiceColors(room));
  window.TT_DICE_PHYSICS?.play(room.scene?.diceRolls?.length ? room.scene.diceRolls : room.scene?.diceRoll);
  renderChrome();
  renderRolls();
  renderDiceTray();
  if (state.currentView === "map") renderMap();
  if (state.currentView === "bestiary") renderBestiary();
  if (state.currentView === "forge") renderForge();
  const editing = $("#sheet-view").contains(document.activeElement);
  if (!editing) renderSheet();
});

function renderAll() {
  renderChrome();
  renderSheet();
  renderRolls();
  renderDiceTray();
  if (state.currentView === "map") renderMap();
  else if (state.currentView === "bestiary") { window.TT_VTT?.deactivate?.(); renderBestiary(); }
  else if (state.currentView === "forge") { window.TT_VTT?.deactivate?.(); renderForge(); }
  else {
    window.TT_VTT?.deactivate?.();
    if (state.currentView === "dice") window.TT_DICE_PHYSICS?.activate?.(roomDiceColors());
  }
}
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
  return `<label class="sheet-field ${value === "" || value === null || value === undefined ? "empty-field" : ""}">${label}<input type="${type}" data-field="${name}" value="${esc(value)}"></label>`;
}
function area(label, name, value, placeholder = "") {
  return `<label class="sheet-field ${value ? "" : "empty-field"}">${label}<textarea data-field="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
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

function combatAttackForItem(sheet, item) {
  if (!item) return null;
  return (sheet.attacksList || []).find(attack => attack.sourceItemId === item.id) || (sheet.attacksList || []).find(attack => String(attack.name || "").toLowerCase() === String(item.name || "").toLowerCase());
}
function combatItemSummary(item) {
  if (!item) return "";
  if (item.type === "weapon") return [String(item.damage || "").replace(/d/gi,"к"), item.damageType, Number(item.magicBonus || 0) ? `магия +${Number(item.magicBonus)}` : ""].filter(Boolean).join(" · ") || "оружие";
  if (isShieldItem(item)) return `+${Number(item.baseAc || 2) + Number(item.magicBonus || 0)} КД${item.variantLabel ? ` · ${item.variantLabel}` : ""}`;
  if (item.type === "armor") return `КД ${Number(item.baseAc || 0) + Number(item.magicBonus || 0)} · ${item.armorType === "light" ? "лёгкий" : item.armorType === "medium" ? "средний" : item.armorType === "heavy" ? "тяжёлый" : "доспех"}${item.variantLabel ? ` · ${item.variantLabel}` : ""}`;
  return `${Number(item.quantity || 0)} шт.${item.magical ? " · магия" : ""}`;
}
function slotAcceptsItem(slotKey, item) {
  if (!item) return true;
  if (item.slotHint) return item.slotHint === slotKey;
  if (slotKey === "ammo") return isAmmoItem(item);
  if (slotKey === "body") return item.type === "armor" && !isShieldItem(item);
  if (slotKey === "mainHand") return item.type === "weapon" || /фокус|жезл|посох/i.test(item.name || "");
  if (slotKey === "offHand") return item.type === "weapon" || isShieldItem(item) || /фокус|жезл/i.test(item.name || "");
  if (["head","neck","cloak","belt","feet"].includes(slotKey)) return item.type !== "weapon" && !isAmmoItem(item) && !(item.type === "armor" && !isShieldItem(item));
  return true;
}
function combatLoadoutWarnings(sheet) {
  const set = activeCombatSet(sheet), warnings = [];
  const main = combatItem(sheet,set.slots.mainHand), off = combatItem(sheet,set.slots.offHand), body = combatItem(sheet,set.slots.body), ammo = combatItem(sheet,set.slots.ammo);
  if (main && isTwoHandedItem(main) && off) warnings.push({ icon:"↔", title:"Обе руки заняты", text:`${main.name} — двуручное оружие, но во второй руке лежит «${off.name}».` });
  if (main && isRangedWeapon(main) && (!ammo || Number(ammo.quantity || 0) <= 0)) warnings.push({ icon:"➹", title:"Нет боеприпасов", text:`Для «${main.name}» нужен заполненный слот боеприпасов.` });
  if (main && ammo && !ammoMatchesWeapon(main,ammo)) warnings.push({ icon:"!", title:"Не тот боеприпас", text:`«${main.name}» не использует «${ammo.name}». Выбери подходящие снаряды.` });
  const armorProf = String(sheet.armorProficiencies || "").toLowerCase();
  if (body) {
    const required = body.armorType === "heavy" ? "тяж" : body.armorType === "medium" ? "средн" : body.armorType === "light" ? "лёгк" : "";
    if (required && !armorProf.includes(required) && !armorProf.includes("все доспехи")) warnings.push({ icon:"⬡", title:"Нет владения доспехом", text:`Проверь владение: «${body.name}» относится к ${body.armorType === "heavy" ? "тяжёлым" : body.armorType === "medium" ? "средним" : "лёгким"} доспехам.` });
    const strengthRequired = Number(body.strengthMinimum || itemSystem.strengthRequirements[itemSystem.normalizeCatalogKey(body.baseCatalogKey || body.catalogKey)] || 0);
    if (strengthRequired && Number(sheet.stats.str || 0) < strengthRequired) warnings.push({ icon:"◆", title:`Желательна Сила ${strengthRequired}`, text:"Недостаток Силы в тяжёлом доспехе обычно уменьшает скорость." });
  }
  if (isShieldItem(off) && !/щит|все доспехи/.test(armorProf)) warnings.push({ icon:"◈", title:"Нет владения щитом", text:"Щит можно оставить, но по обычным правилам без владения будут штрафы." });
  const weaponProf = String(sheet.weaponProficiencies || "").toLowerCase();
  const weaponNameTokens = String(main?.name || "").toLowerCase().split(/[^а-яёa-z]+/i).filter(token => token.length >= 4).map(token => token.slice(0,Math.min(5,token.length)));
  const specificallyProficient = weaponNameTokens.some(token => weaponProf.includes(token));
  if (main?.type === "weapon" && weaponProf && !weaponProf.includes("простое и воинское") && !specificallyProficient) {
    const category = itemSystem.simpleWeaponKeys.has(itemSystem.normalizeCatalogKey(main.baseCatalogKey || main.catalogKey)) ? "прост" : "воинск";
    if (!weaponProf.includes(category)) warnings.push({ icon:"⚔", title:"Владение оружием не найдено", text:`«${main.name}» можно использовать, но бонус мастерства обычно не добавляется без владения.` });
  }
  const attunedCount = (sheet.inventoryList || []).filter(item => item.attuned).length;
  if (attunedCount > 3) warnings.push({ icon:"✦", title:`Настройка ${attunedCount}/3`, text:"Лимит превышен. TabaxiTable сохраняет хоумбрю, но подсвечивает отклонение от стандартных правил." });
  combatSlotKeys.forEach(slotKey => {
    const item = combatItem(sheet,set.slots[slotKey]);
    if (item && !slotAcceptsItem(slotKey,item)) warnings.push({ icon:"?", title:`Необычный слот: ${combatSlotMeta[slotKey].label}`, text:`«${item.name}» оставлен на месте — это предупреждение, а не запрет.` });
  });
  return warnings;
}
function combatSlotMarkup(sheet, set, slotKey, editable) {
  const meta = combatSlotMeta[slotKey], item = combatItem(sheet,set.slots[slotKey]), attack = combatAttackForItem(sheet,item);
  const selected = state.selectedLoadoutItemId && state.selectedLoadoutItemId === item?.id;
  return `<article class="combat-slot slot-${slotKey} ${item ? "filled" : "empty"} ${selected ? "selected" : ""}" data-loadout-drop="${slotKey}">
    <button class="combat-slot-main" type="button" data-loadout-slot="${slotKey}" aria-label="${esc(meta.label)}: ${esc(item?.name || "пусто")}">
      <span class="combat-slot-icon">${item ? itemCombatIcon(item) : meta.icon}</span><span><small>${esc(meta.label)}</small><strong>${esc(item?.name || "Свободно")}</strong><em>${esc(item ? combatItemSummary(item) : meta.hint)}</em></span>
    </button>
    ${item ? `<div class="combat-slot-actions">${attack ? `<button type="button" data-loadout-attack="${esc(attack.id)}">к20</button><button type="button" data-loadout-damage="${esc(attack.id)}">урон</button><button type="button" data-loadout-critical="${esc(attack.id)}" title="Критический урон">✦</button>` : `<button type="button" data-loadout-inspect="${esc(item.id)}">сведения</button>`}${editable ? `<button class="remove" type="button" data-loadout-remove="${slotKey}" title="Освободить слот">×</button>` : ""}</div>` : ""}
  </article>`;
}
function combatLoadoutMarkup(sheet, mine) {
  const loadout = ensureCombatLoadout(sheet), set = activeCombatSet(sheet), editable = Boolean(mine && state.editMode);
  const assignedIds = new Set([...Object.values(set.slots),...set.quickSlots].filter(Boolean));
  const warnings = combatLoadoutWarnings(sheet);
  const inventoryCards = (sheet.inventoryList || []).map(item => {
    const kind = itemCombatKind(item), selected = state.selectedLoadoutItemId === item.id;
    return `<button class="loadout-inventory-card ${assignedIds.has(item.id) ? "assigned" : ""} ${selected ? "selected" : ""}" type="button" data-loadout-item="${esc(item.id)}" data-loadout-kind="${esc(kind)}" data-loadout-search="${esc(`${item.name || ""} ${item.originalName || ""} ${item.catalogKey || ""} ${item.baseCatalogKey || ""} ${item.rarity || ""} ${item.description || ""}`.toLowerCase())}" draggable="${editable}"><span>${itemCombatIcon(item)}</span><span><strong>${esc(item.name || "Предмет")}</strong><small>${esc(combatItemSummary(item))}</small></span><b>${Number(item.quantity || 0)}</b></button>`;
  }).join("");
  const attunementIds = loadout.attunementSlots.filter(itemId => combatItem(sheet,itemId));
  const attunementSlots = Array.from({length:3},(_,index) => {
    const item = combatItem(sheet,attunementIds[index]);
    return `<article class="attunement-slot ${item ? "filled" : ""}" data-attunement-drop="${index}"><button type="button" data-attunement-slot="${index}"><span>✦</span><span><small>Настройка ${index+1}</small><strong>${esc(item?.name || "Свободно")}</strong></span></button>${item && editable ? `<button type="button" data-attunement-remove="${index}" title="Снять настройку">×</button>` : ""}</article>`;
  }).join("");
  const overflowItems = (sheet.inventoryList || []).filter(item => item.attuned && !attunementIds.slice(0,3).includes(item.id));
  const quickSlots = set.quickSlots.map((itemId,index) => {
    const item = combatItem(sheet,itemId), empty = !item;
    return `<article class="quick-slot ${empty ? "empty" : ""}" data-quick-drop="${index}"><button type="button" data-quick-use="${index}"><small>${index+1}</small><span>${item ? itemCombatIcon(item) : "+"}</span><strong>${esc(item?.name || "Быстрый слот")}</strong>${item ? `<b>${Number(item.quantity || 0)}</b>` : ""}</button>${item && editable ? `<button class="remove" type="button" data-quick-remove="${index}" title="Освободить">×</button>` : ""}</article>`;
  }).join("");
  return `<section class="panel loadout-panel" data-section="combat" data-combat-view="loadout">
    <header class="loadout-header"><div><span class="eyebrow">Боевой рабочий стол</span><h2>Снаряди героя</h2><p>${editable ? "Нажми предмет, затем слот — или просто перетащи. Ошибиться здесь невозможно: спорные сочетания дадут подсказку, но сохранятся." : "Всё нужное в бою перед глазами. Включи редактирование, чтобы менять снаряжение."}</p></div><div class="loadout-summary"><span><small>КД</small><strong>${calculateAc(sheet)}</strong></span><span><small>Комплект</small><strong>${esc(set.name)}</strong></span><span><small>Настройка</small><strong>${(sheet.inventoryList || []).filter(item => item.attuned).length}/3</strong></span></div></header>
    <div class="loadout-toolbar"><div class="loadout-sets" role="tablist" aria-label="Боевые комплекты">${loadout.sets.map((entry,index) => `<button type="button" data-loadout-set="${entry.id}" class="${entry.id === loadout.activeSet ? "active" : ""}" aria-selected="${entry.id === loadout.activeSet}"><span>${String.fromCharCode(65+index)}</span><b>${esc(entry.name)}</b></button>`).join("")}${editable ? `<button type="button" id="loadout-rename" class="loadout-rename" title="Переименовать комплект">✎</button>` : ""}</div><label class="auto-ammo-switch"><span><b>Автоснаряды</b><small>−1 после атаки из лука или арбалета</small></span><input id="auto-ammo" type="checkbox" ${loadout.autoAmmo ? "checked" : ""} ${mine ? "" : "disabled"}><i></i></label></div>
    ${warnings.length ? `<div class="loadout-warnings">${warnings.map(warning => `<article><span>${warning.icon}</span><div><strong>${esc(warning.title)}</strong><small>${esc(warning.text)}</small></div></article>`).join("")}</div>` : `<div class="loadout-ready"><span>✓</span><strong>Комплект готов к бою</strong><small>Явных конфликтов не найдено</small></div>`}
    <div class="loadout-workspace">
      <aside class="loadout-inventory"><div class="loadout-side-head"><div><span class="eyebrow">Из рюкзака</span><h3>Предметы</h3><small id="loadout-visible-count">${sheet.inventoryList.length} из ${sheet.inventoryList.length}</small></div><b>${sheet.inventoryList.length}</b></div><input id="loadout-search" type="search" value="${esc(state.loadoutSearch)}" placeholder="Найти предмет…" aria-label="Поиск предмета"><div class="loadout-filters"><button data-loadout-filter="all" class="${state.loadoutFilter === "all" ? "active" : ""}">Все</button><button data-loadout-filter="weapon" class="${state.loadoutFilter === "weapon" ? "active" : ""}">Оружие</button><button data-loadout-filter="armor" class="${state.loadoutFilter === "armor" ? "active" : ""}">Броня</button><button data-loadout-filter="gear" class="${state.loadoutFilter === "gear" ? "active" : ""}">Вещи</button><button data-loadout-filter="magic" class="${state.loadoutFilter === "magic" ? "active" : ""}">Магия</button><button data-loadout-filter="consumable" class="${state.loadoutFilter === "consumable" ? "active" : ""}">Расходники</button><button data-loadout-filter="ammo" class="${state.loadoutFilter === "ammo" ? "active" : ""}">Снаряды</button></div><div class="loadout-inventory-list">${inventoryCards || `<div class="loadout-empty"><span>◇</span><strong>Рюкзак пуст</strong><small>Добавь предметы во вкладке «Снаряжение».</small></div>`}</div><div id="loadout-filter-empty" class="loadout-empty hidden"><span>⌕</span><strong>Ничего не найдено</strong><small>Попробуй другой запрос или нажми «Все».</small></div></aside>
      <section class="mannequin-card"><div class="mannequin-title"><span><small>Активный набор</small><strong>${esc(set.name)}</strong></span><b>${editable ? "режим сборки" : "готов к игре"}</b></div><div class="mannequin-stage"><div class="mannequin-figure" aria-hidden="true"><i class="figure-head"></i><i class="figure-neck"></i><i class="figure-torso"></i><i class="figure-arm left"></i><i class="figure-arm right"></i><i class="figure-leg left"></i><i class="figure-leg right"></i><span>${classGlyph(classEntries(sheet)[0]?.key)}</span></div>${combatSlotKeys.map(key => combatSlotMarkup(sheet,set,key,editable)).join("")}</div></section>
      <aside class="loadout-attunement"><div class="loadout-side-head"><div><span class="eyebrow">Магическая связь</span><h3>Настройка</h3></div><b>${(sheet.inventoryList || []).filter(item => item.attuned).length}/3</b></div><p>Три стандартных места. Хоумбрю сверх лимита разрешён, но будет подсвечен.</p><div class="attunement-list">${attunementSlots}</div>${editable ? `<button id="attunement-overflow" class="secondary" type="button">+ Настроить сверх лимита</button>` : ""}${overflowItems.length ? `<div class="attunement-overflow"><small>Сверх лимита</small>${overflowItems.map(item => `<button type="button" data-loadout-inspect="${esc(item.id)}">✦ ${esc(item.name)}</button>`).join("")}</div>` : ""}<div class="loadout-rule-card"><span>Совет</span><strong>${state.selectedLoadoutItemId ? `Выбран: ${esc(combatItem(sheet,state.selectedLoadoutItemId)?.name || "предмет")}` : editable ? "Сначала выбери предмет" : "Комплекты переключаются в один тап"}</strong><small>${state.selectedLoadoutItemId ? "Теперь нажми подходящий слот на герое." : editable ? "Подходящие места подсветятся после выбора." : "A, B и C могут хранить разные варианты вооружения."}</small></div></aside>
    </div>
    <section class="quick-belt"><div class="quick-belt-head"><div><span class="eyebrow">Быстрый доступ</span><h3>Пояс действий</h3></div><p>${editable ? "Перетащи зелья, свитки и метательные предметы." : "Нажатие использует предмет и уменьшает количество."}</p></div><div class="quick-slots">${quickSlots}</div></section>
  </section>`;
}

function deathSavePipsMarkup(sheet, editable = false) {
  const row = (kind,count,label,symbol) => `<div class="death-save-row ${kind}"><span>${label}</span><div>${Array.from({length:3},(_,index)=>`<button type="button" data-death-pip="${kind}" data-death-count="${index+1}" class="${index < Number(count||0) ? "filled" : ""}" ${editable ? "" : "disabled"} aria-label="${label}: ${index+1}">${symbol}</button>`).join("")}</div></div>`;
  return `<div class="death-save-card"><div>${row("success",sheet.deathSuccess,"Успехи","✓")}${row("fail",sheet.deathFail,"Провалы","×")}</div><button id="death-save-roll" class="primary" type="button" ${Number(sheet.hpCurrent)>0 ? "disabled" : ""}>🎲 Спасбросок от смерти</button>${sheet.stable ? `<strong class="death-stable">Стабилен</strong>` : ""}</div>`;
}

function setDeathSaveCount(kind,count) {
  if (!state.editMode) return;
  const next=structuredClone(currentSheet());
  const key=kind === "success" ? "deathSuccess" : "deathFail";
  const current=Number(next[key]||0), target=Math.max(0,Math.min(3,Number(count)||0));
  next[key]=current===target ? target-1 : target;
  saveNow(next,"Изменены спасброски от смерти","Спасброски от смерти");
  renderSheet();
}

function renderSheet() {
  const player = state.room?.players?.[state.selectedId];
  if (!player) return;
  const s = player.sheet;
  ensureCombatLoadout(s);
  const mine = player.id === state.clientId;
  const proficiency = effectiveProficiency(s);
  const armorClass = calculateAc(s);
  const initiative = initiativeBonus(s);
  const statCards = Object.entries(abilities).map(([key, name]) => `
    <div class="stat">
      <label>${name}</label>
      <input type="number" min="1" max="30" data-stat="${key}" aria-label="${name}" value="${Number(s.stats[key] ?? 10)}" ${mine && state.editMode ? "" : "readonly"}>
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
  const resourceResetNames = { short:"Короткий отдых", long:"Долгий отдых", none:"Вручную" };
  const resources = (s.resources || []).map(resource => {
    const current=Math.max(0,Number(resource.current || 0)), max=Math.max(0,Number(resource.max || 0));
    const percent=Math.max(0,Math.min(100,current/Math.max(1,max)*100));
    return `<div class="entity-row resource-row">
      <div class="resource-title"><strong>${esc(resource.name || "Ресурс")}</strong><small>${esc(resourceResetNames[resource.reset] || "Вручную")}</small></div>
      <div class="resource-meter"><div><small>Осталось</small><strong>${current}<i>/</i>${max}</strong></div><span><i style="width:${percent}%"></i></span></div>
      <div class="resource-controls"><button data-resource-change="${esc(resource.id)}" data-delta="-1" title="Потратить единицу">−</button><button data-resource-change="${esc(resource.id)}" data-delta="1" title="Вернуть единицу">+</button><button data-resource-edit="${esc(resource.id)}" title="Настроить ресурс">⋮</button></div>
    </div>`;
  }).join("");
  const inventory = (s.inventoryList || []);
  const inventoryWeight = inventory.reduce((sum, item) => sum + Number(item.weight || 0) * Number(item.quantity || 0), 0);
  const carryingCapacity = Number(s.stats.str || 0) * 15;
  const attunedCount = inventory.filter(item => item.attuned).length;
  const inventoryRows = inventory.map(item => {
    const glyph=item.type === "weapon" ? "⚔" : item.type === "armor" ? "◈" : item.type === "focus" ? "✦" : item.magical ? "◆" : "•";
    const totalWeight=Number(item.weight || 0) * Number(item.quantity || 0);
    return `<div class="entity-row inventory-row ${item.equipped ? "is-equipped" : ""} ${item.infused ? "is-infused" : ""}">
      <span class="inventory-item-icon">${glyph}</span>
      <div class="inventory-item-main"><strong>${esc(item.name || "Предмет")}</strong><div class="item-flags">${item.equipped ? "<span>надето</span>" : ""}${item.attuned ? "<span>настроено</span>" : ""}${item.magical ? "<span>магия</span>" : ""}${item.infused ? `<span class="infusion-flag" title="${esc(item.infusionName || "Инфузия")}">⚙ ${esc(item.infusionName || "инфузия")}</span>` : ""}${item.type === "weapon" ? "<span>оружие</span>" : ""}${item.type === "armor" ? "<span>броня</span>" : ""}</div></div>
      <div class="inventory-item-metrics"><span><small>Количество</small><strong>${Number(item.quantity || 0)}</strong></span><span><small>Вес</small><strong>${totalWeight} фнт.</strong></span></div>
      <button class="row-menu-button" data-item-edit="${esc(item.id)}" title="Открыть предмет">⋮</button>
    </div>`;
  }).join("");
  const spellAbility = s.spellcastingAbility || "";
  const spellMod = spellAbility ? modifier(s.stats[spellAbility]) : 0;
  const focusBonus = spellFocusBonus(s);
  const spellSave = 8 + proficiency + spellMod + focusBonus;
  const spellAttack = proficiency + spellMod + focusBonus;
  const preparedCount = (s.spellsList || []).filter(spell => spell.prepared && !spell.alwaysPreparedBySubclass && Number(spell.level) > 0).length;
  const preparedLimit = preparedSpellLimit(s);
  const classRoadmaps = classEntries(s).map(entry => `<details class="class-roadmap" ${classEntries(s).length === 1 ? "open" : ""}><summary>${classGlyph(entry.key)}<span><strong>${esc(entry.name || rules.classes[entry.key]?.name)} · ${Number(entry.level)} уровень</strong><small>Все особенности класса по уровням</small></span><i>раскрыть</i></summary><div>${Array.from({length:20},(_,index) => {
    const level = index + 1, unlocked = level <= Number(entry.level);
    return `<article class="roadmap-level ${unlocked ? "unlocked" : "locked"} ${level === Number(entry.level) ? "current" : ""}"><b>${level}</b><div><strong>${rules.featuresAt(entry.key,level,entry.subclass,s.optionalFeatures).map(feature => esc(feature.name)).join(" · ")}</strong><p>${rules.featuresAt(entry.key,level,entry.subclass,s.optionalFeatures).map(feature => esc(feature.summary)).join(" ")}</p></div></article>`;
  }).join("")}</div></details>`).join("");
  const featRows = (s.feats || []).map(feat => {
    const key = featKey(feat), info = rules.feats[key];
    return `<article class="feat-chip"><span>${classGlyph(feat.classKey || s.classKey)}</span><div><strong>${esc(feat.name || info?.name || key || "Черта")}</strong><small>${esc(info?.summary || feat.summary || "Добавлена вручную")}</small></div></article>`;
  }).join("");
  const spellRows = [...(s.spellsList || [])].sort((a, b) => Number(a.level) - Number(b.level) || String(a.name).localeCompare(String(b.name))).map(spell => `
    <div class="entity-row spell-row ${spell.prepared ? "prepared" : ""}" data-spell-name="${esc(String(spell.name || "").toLowerCase())}" data-spell-level="${Number(spell.level || 0)}" data-spell-prepared="${spell.prepared ? "yes" : "no"}"><span class="spell-level">${Number(spell.level || 0)}</span><div><strong>${esc(spell.name || "Заклинание")}${spellRollKind(spell) === "healing" ? `<i class="spell-kind healing">лечение</i>` : spellRollKind(spell) === "damage" ? `<i class="spell-kind damage">урон</i>` : ""}</strong><small>${spell.sourceClassKey ? `${esc(rules.classes[spell.sourceClassKey]?.name || spell.sourceClassKey)} · ` : ""}${esc(spell.castingTime || "действие")} · ${esc(spell.range || "на себя")}${spell.concentration ? " · концентрация" : ""}${spell.ritual ? " · ритуал" : ""}${spell.alwaysPreparedBySubclass ? ` · ${esc(spell.subclassGrantName || "подкласс")}` : ""}</small></div><button class="spell-prepare-button" data-spell-prepare="${esc(spell.id)}" title="${spell.alwaysPreparedBySubclass ? `Всегда подготовлено: ${esc(spell.subclassGrantName || "подкласс")}` : "Подготовить или убрать"}" ${spell.alwaysPreparedBySubclass ? "disabled" : ""}>${spell.alwaysPreparedBySubclass ? "◆" : spell.prepared ? "★" : "☆"}</button><button class="spell-cast-button" data-spell-cast="${esc(spell.id)}">Сотворить</button><button class="spell-info-button" data-spell-info="${esc(spell.id)}" title="Описание">i</button><button class="row-menu-button" data-spell-edit="${esc(spell.id)}">⋮</button></div>`).join("");
  const goalRows = (s.goalsList || []).map(goal => `<div class="entity-row goal-row"><input type="checkbox" data-goal-done="${esc(goal.id)}" ${goal.done ? "checked" : ""}><strong>${esc(goal.text)}</strong><button data-goal-edit="${esc(goal.id)}">⋮</button></div>`).join("");
  const noteRows = (s.notesList || []).map(note => `<div class="panel"><h3 class="panel-title">${esc(note.title || "Заметка")}</h3><p>${esc(note.text).replace(/\n/g, "<br>")}</p><button data-note-edit="${esc(note.id)}" class="secondary">Изменить</button></div>`).join("");
  const sheetTools = mine ? `<div class="sheet-tools"><label class="edit-mode-switch"><input id="edit-mode-toggle" type="checkbox" ${state.editMode ? "checked" : ""}><span><i></i></span><b>${state.editMode ? "Редактирование" : "Игровой режим"}</b></label>${s.classKey && totalLevel(s) < 20 ? `<button id="level-up" class="primary level-up-button" type="button"><span>↑</span> Повысить уровень</button>` : ""}<button id="character-builder" class="secondary" type="button">${s.classKey ? "Пересобрать героя" : "Подробный мастер"}</button>${s.classKey ? `<button id="quick-character" class="secondary" type="button">Быстрая сборка</button>` : ""}<details class="sheet-more"><summary>Ещё ···</summary><div><button id="sheet-history" class="secondary" type="button">История версий</button><button id="sheet-export" class="secondary" type="button">Экспорт листа</button><button id="sheet-import" class="secondary" type="button">Импорт листа</button>${player.role === "dm" ? `<button id="campaign-backup" class="secondary" type="button">Копия кампании</button><button id="campaign-restore" class="secondary" type="button">Восстановить кампанию</button>` : ""}</div></details><input id="sheet-import-file" type="file" accept="application/json" hidden><input id="campaign-restore-file" type="file" accept="application/json" hidden></div>` : "";

  $("#sheet-view").innerHTML = `<div class="sheet ${mine && !s.classKey ? "unbuilt" : ""} ${mine && state.editMode ? "editing" : ""}">
    ${mine ? "" : `<div class="read-only">Ты просматриваешь лист персонажа «${esc(s.characterName || player.name)}». Редактировать его может владелец.</div>`}
    <section class="character-hero">
      <div class="hero-avatar">${s.portraitUrl ? `<img src="${esc(s.portraitUrl)}" alt="Портрет ${esc(s.characterName || player.name)}">` : esc((s.characterName || player.name || "?")[0].toUpperCase())}<span class="hero-class-mark">${classGlyph(classEntries(s)[0]?.key)}</span></div>
      <div class="hero-identity"><span class="eyebrow">${esc(s.race || "Раса не выбрана")} · ${esc(s.background || "Предыстория не выбрана")}</span><h1>${esc(s.characterName || player.name)}</h1><p>${esc(classSummary(s))} · общий ${totalLevel(s)} уровень</p></div>
      <div class="hero-vitals"><button data-vital="ac" title="${state.editMode ? "Изменить КД" : "Включи редактирование, чтобы изменить"}"><small>КД</small><strong>${armorClass}</strong></button><button id="quick-hp" data-vital="hp"><small>HP${Number(s.hpTemp) ? ` · +${Number(s.hpTemp)}` : ""}</small><strong>${Number(s.hpCurrent)}/${Number(s.hpMax)}</strong></button><button id="quick-initiative" data-vital="initiative"><small>Инициатива</small><strong>${signed(initiative)}</strong></button><button data-vital="speed"><small>Скорость</small><strong>${Number(s.speed)}</strong></button><button data-vital="proficiency"><small>Мастерство</small><strong>${signed(proficiency)}</strong></button><button data-vital="passive"><small>Пассивка</small><strong>${passivePerception(s)}</strong></button><button id="quick-inspiration" class="${s.inspiration ? "lit" : ""}"><small>Вдохновение</small><strong>${s.inspiration ? "◆" : "◇"}</strong></button></div>
    </section>
    ${sheetTools}
    ${experienceMarkup(s, mine)}
    ${progressionMarkup(s)}
    ${mine && !s.classKey ? `<section class="character-onboarding"><div><span class="eyebrow">Новый персонаж</span><h2>Готовый герой примерно за минуту</h2><p>Выбери класс, расу, уровень и предысторию — TabaxiTable сам распределит характеристики, рассчитает HP и КД, выдаст навыки, оружие и стартовые заклинания.</p></div><button id="quick-character" class="primary" type="button">✦ Быстро создать</button></section>` : ""}
    <details class="identity-editor"><summary>Ручное редактирование паспорта</summary><div class="sheet-head">
      <label class="character-name">Имя персонажа<input data-field="characterName" value="${esc(s.characterName)}"></label>
      <div class="identity-class-summary"><small>Классы и уровни</small><strong>${esc(classSummary(s))}</strong><span>Меняются через кнопку «Повысить уровень».</span></div>
      ${field("Раса", "race", s.race)} ${field("Размер", "size", s.size || "Средний")}
      ${field("Предыстория", "background", s.background)}
      ${field("Мировоззрение", "alignment", s.alignment)}
    </div></details>
    <details class="roll-mode" aria-label="Режим броска"><summary>Следующий к20: <b>${state.rollMode === "advantage" ? "преимущество" : state.rollMode === "disadvantage" ? "помеха" : "обычно"}</b></summary><div><button data-roll-mode="normal">Обычно</button><button data-roll-mode="advantage">Преимущество</button><button data-roll-mode="disadvantage">Помеха</button></div></details>
    <nav class="sheet-tabs">
      <button data-sheet-tab="main">Главное</button><button data-sheet-tab="combat">Бой</button><button data-sheet-tab="spells">Магия</button><button data-sheet-tab="equipment">Снаряжение</button><button data-sheet-tab="features">Развитие</button><button data-sheet-tab="story">История</button>
    </nav>
    <nav class="combat-subtabs" aria-label="Раздел боя"><button type="button" data-combat-tab="actions"><span>⚔</span><b>Действия</b><small>атаки, состояния и кости</small></button><button type="button" data-combat-tab="loadout"><span>⬡</span><b>Боевой комплект</b><small>экипировка и быстрый доступ</small></button></nav>
    <div class="sheet-grid">
      <div class="stack">
        ${combatLoadoutMarkup(s,mine)}
        <div class="panel stats" data-section="main">${statCards}</div>
        <div class="panel" data-section="main"><div class="panel-heading"><h3 class="panel-title">Спасброски</h3>${mine ? `<button id="proficiencies-manager-saves" class="quiet-action" type="button">Настроить</button>` : ""}</div><div class="checks save-checks">${saves}</div></div>
        <div class="panel" data-section="main"><h3 class="panel-title">Пассивные чувства</h3><div class="checks"><div class="check-row"><span>◉</span><span class="bonus">${passivePerception(s)}</span><span>Восприятие</span></div><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"insight")}</span><span>Проницательность</span></div><div class="check-row"><span>◉</span><span class="bonus">${10 + getSkillBonus(s,"investigation") + passiveBonus(s,"investigation")}</span><span>Анализ</span></div></div></div>
        <div class="panel" data-section="features"><h3 class="panel-title">Владения и языки</h3>${area("Доспехи", "armorProficiencies", s.armorProficiencies || "")}${area("Оружие", "weaponProficiencies", s.weaponProficiencies || "")}${area("Инструменты", "toolProficiencies", s.toolProficiencies || "")}${area("Языки", "languages", s.languages || "")}</div>
      </div>
      <div class="stack">
        <div data-section="combat" data-combat-view="actions">${classHighlightsMarkup(s)}</div>
        <div class="panel skills-panel" data-section="main"><div class="panel-heading"><h3 class="panel-title">Навыки</h3>${mine ? `<button id="proficiencies-manager" class="quiet-action" type="button">Настроить</button>` : ""}</div><div class="checks skill-checks">${skillRows}</div></div>
        <div class="panel proficiency-overview" data-section="main"><div class="panel-heading"><h3 class="panel-title">Владения</h3><small>бонус мастерства ${signed(proficiency)}</small></div><div class="proficiency-overview-grid"><article><small>Доспехи</small><span>${esc(s.armorProficiencies || "—")}</span></article><article><small>Оружие</small><span>${esc(s.weaponProficiencies || "—")}</span></article><article><small>Инструменты</small><span>${esc(s.toolProficiencies || "—")}</span></article><article><small>Языки</small><span>${esc(s.languages || "—")}</span></article></div></div>
        <div class="panel" data-section="combat" data-combat-view="actions">
          <div class="panel-heading"><h3 class="panel-title">Кости хитов</h3><small>${(s.hitDicePools || []).reduce((sum,pool)=>sum+Number(pool.current),0)}/${(s.hitDicePools || []).reduce((sum,pool)=>sum+Number(pool.total),0)} осталось</small></div>
          <div class="hit-dice-pills">${(s.hitDicePools || [{sides:s.hitDieSize,total:s.hitDiceMax,current:s.hitDiceCurrent}]).map(pool => `<span><b>${Number(pool.current)}/${Number(pool.total)}</b> к${Number(pool.sides)}</span>`).join("")}</div>
          ${deathSavePipsMarkup(s,Boolean(mine && state.editMode))}
        </div>
        <div class="panel" data-section="combat" data-combat-view="actions"><h3 class="panel-title">Атаки</h3><div class="attack-list">${attackRows}</div>${mine ? `<button id="attack-add" class="secondary" type="button">+ Добавить атаку</button>` : ""}${area("Прочие атаки и заклинания", "attacks", s.attacks, "Свободные заметки об атаках...")}</div>
        <div class="panel" data-section="features"><div class="section-actions"><h3 class="panel-title">Ресурсы и заряды</h3>${mine ? `<div class="section-action-buttons"><button id="optional-features-manager" class="secondary" type="button">Опции Таши</button>${hasClass(s,"artificer") ? `<button id="infusions-manager" class="secondary" type="button">Инфузии</button>` : ""}<button id="resource-add" class="secondary" type="button">+ Ресурс</button></div>` : ""}</div><div class="entity-list">${resources || `<div class="read-only">Стрелы, ярость, ци, превосходство и любые другие заряды.</div>`}</div></div>
        <div class="panel" data-section="equipment"><div class="section-actions"><h3 class="panel-title">Снаряжение · ${inventoryWeight}/${carryingCapacity} фнт. · настройка ${attunedCount}/3</h3>${mine ? `<div class="section-action-buttons"><button id="item-catalog" class="secondary" type="button">Справочник</button><button id="item-add" class="secondary" type="button">Хоумбрю</button></div>` : ""}</div><div class="capacity-bar"><span style="width:${Math.min(100, inventoryWeight/Math.max(1,carryingCapacity)*100)}%"></span></div><div class="entity-list">${inventoryRows || `<div class="read-only">Инвентарь пока пуст.</div>`}</div>${area("Дополнительное снаряжение", "equipment", s.equipment)}</div>
      </div>
      <div class="stack">
        <div class="panel" data-section="combat" data-combat-view="actions"><div class="panel-heading"><h3 class="panel-title">Состояния</h3>${mine ? `<button id="conditions-manager" class="quiet-action" type="button">Изменить</button>` : ""}</div><div class="active-conditions">${activeConditions}</div>${Number(s.exhaustion || 0) > 0 ? `<div class="exhaustion-effect">Истощение ${Math.min(6, Number(s.exhaustion))}: ${esc(rules.exhaustionInfo[Math.min(6, Number(s.exhaustion))])}</div>` : ""}${s.concentrationSpellName ? `<div class="concentration"><span>◉ Концентрация: <strong>${esc(s.concentrationSpellName)}</strong></span>${mine ? `<button id="stop-concentration">Завершить</button>` : ""}</div>` : ""}</div>
        <div class="panel" data-section="equipment"><h3 class="panel-title">Монеты</h3><div class="coins">${coins}</div></div>
        <div class="panel progression-panel" data-section="features"><div class="panel-heading"><h3 class="panel-title">Развитие персонажа</h3>${mine && totalLevel(s) < 20 ? `<button id="level-up-features" class="secondary" type="button">+ Уровень</button>` : ""}</div><div class="class-summary-list">${classEntries(s).map(entry => `<article>${classGlyph(entry.key)}<div><strong>${esc(entry.name || rules.classes[entry.key]?.name)} ${Number(entry.level)}</strong><small>${esc(entry.subclass || `Подкласс на ${rules.subclassLevel(entry.key)} уровне`)}</small></div></article>`).join("") || `<div class="read-only">Сначала выбери класс.</div>`}</div>${featRows ? `<h3 class="panel-title feat-title">Черты</h3><div class="feat-list">${featRows}</div>` : ""}${(s.optionalFeatures || []).length ? `<h3 class="panel-title feat-title">Опциональные особенности Таши</h3><div class="feat-list">${classEntries(s).flatMap(entry=>(rules.optionalFeaturesFor?.(entry.key,entry.level)||[]).filter(feature=>(s.optionalFeatures||[]).includes(feature.key))).map(feature=>`<article class="feat-chip"><span>◆</span><div><strong>${esc(feature.name)}</strong><small>${esc(feature.summary)}</small></div></article>`).join("")}</div>` : ""}<h3 class="panel-title roadmap-title">Классовые особенности 1–20</h3><div class="class-roadmaps">${classRoadmaps}</div></div>
        <div class="panel" data-section="features"><h3 class="panel-title">Наследие и особенности</h3>${area("Расовые особенности", "ancestryTraits", s.ancestryTraits || "")}${area("Классовые особенности и умения", "features", s.features)}</div>
        <div class="panel" data-section="features"><h3 class="panel-title">Чувства и защита</h3><div class="bio-grid">${field("Тёмное зрение", "darkvision", s.darkvision || 0, "number")}${field("Слепое зрение", "blindsight", s.blindsight || 0, "number")}${field("Чувство вибрации", "tremorsense", s.tremorsense || 0, "number")}${field("Истинное зрение", "truesight", s.truesight || 0, "number")}</div>${area("Сопротивления", "resistances", s.resistances || "")}${area("Иммунитеты", "immunities", s.immunities || "")}${area("Уязвимости", "vulnerabilities", s.vulnerabilities || "")}</div>
        <div class="panel" data-section="spells"><h3 class="panel-title">Гримуар</h3>${focusBonus ? `<div class="content-pack-note">Магическая фокусировка: +${focusBonus} к атаке заклинанием и Сл.</div>` : ""}<div class="spell-summary"><div><small>Сложность</small><strong>${spellSave}</strong></div><div><small>Атака</small><strong>${signed(spellAttack)}</strong></div><div class="${preparedLimit !== null && preparedCount > preparedLimit ? "over-limit" : ""}"><small>Подготовлено</small><strong>${preparedCount}${preparedLimit === null ? "" : `/${preparedLimit}`}</strong></div><label>Характеристика<select data-field="spellcastingAbility"><option value="">—</option>${Object.entries(abilities).map(([key,name]) => `<option value="${key}" ${spellAbility === key ? "selected" : ""}>${name}</option>`).join("")}</select></label></div><div class="spell-slots">${slots || (!pactSlots ? `<span class="read-only">Настрой доступные ячейки.</span>` : "")}${pactSlots}</div><div class="section-actions spell-section-actions">${mine ? `<div class="section-action-buttons"><button id="slots-manager" class="secondary" type="button">Ячейки</button><button id="spell-library" class="secondary" type="button">Справочник</button><button id="spell-add" class="secondary" type="button">Хоумбрю</button></div>` : ""}</div><div class="spell-filters"><input id="owned-spell-search" aria-label="Поиск в гримуаре" placeholder="Поиск в гримуаре"><select id="owned-spell-level" aria-label="Уровень заклинаний"><option value="all">Все уровни</option><option value="0">Заговоры</option>${Array.from({length:9},(_,i)=>`<option value="${i+1}">${i+1} уровень</option>`).join("")}</select><select id="owned-spell-prepared" aria-label="Статус подготовки"><option value="all">Все</option><option value="yes">Подготовленные</option><option value="no">Неподготовленные</option></select></div><div class="entity-list" id="owned-spells">${spellRows || `<div class="read-only">Гримуар пока пуст.</div>`}</div>${area("Заметки заклинателя", "spells", s.spells)}</div>
        <div class="panel" data-section="personality"><h3 class="panel-title">Личность и внешность</h3>${s.portraitUrl ? `<img class="portrait-preview" src="${esc(s.portraitUrl)}" alt="Портрет">` : ""}${field("Ссылка на портрет", "portraitUrl", s.portraitUrl || "")}<div class="bio-grid">${field("Возраст", "age", s.age || "")}${field("Рост", "height", s.height || "")}${field("Вес", "weight", s.weight || "")}${field("Глаза", "eyes", s.eyes || "")}${field("Кожа", "skin", s.skin || "")}${field("Волосы", "hair", s.hair || "")}</div>${area("Внешность", "appearance", s.appearance || "")}${area("Предыстория персонажа", "backstory", s.backstory || "")}${area("Союзники и организации", "allies", s.allies || "")}${area("Черты характера", "personality", s.personality)}${area("Идеалы", "ideals", s.ideals)}${area("Привязанности", "bonds", s.bonds)}${area("Слабости", "flaws", s.flaws)}</div>
        <div class="panel" data-section="personality"><h3 class="panel-title">Токен карты</h3><div class="bio-grid">${field("Картинка токена", "tokenImageUrl", s.tokenImageUrl || s.portraitUrl || "")}${field("Цвет рамки", "tokenColor", s.tokenColor || "#9f7842", "color")}${field("Зрение, футы", "tokenVision", s.tokenVision ?? 60, "number")}${field("Размер на сетке", "tokenScale", s.tokenScale ?? 1, "number")}</div><div class="read-only">Имя, изображение, цвет, размер и зрение синхронно используются токеном персонажа на общей карте.</div></div>
        <div class="panel" data-section="goals"><div class="section-actions"><h3 class="panel-title">Цели и задачи</h3>${mine ? `<button id="goal-add" class="secondary" type="button">+ Цель</button>` : ""}</div><div class="entity-list">${goalRows || `<div class="read-only">Целей пока нет.</div>`}</div></div>
        <div class="panel" data-section="notes"><div class="section-actions"><h3 class="panel-title">Заметки</h3>${mine ? `<button id="note-add" class="secondary" type="button">+ Заметка</button>` : ""}</div>${noteRows}${area("Общие заметки", "notes", s.notes)}</div>
      </div>
    </div>
  </div>`;

  if (!mine) $$("input, textarea, select", $("#sheet-view")).forEach(el => el.disabled = true);
  updateDerived();
  applySheetEditing(mine);
  // Filter the full sheet before binding optional controls so one broken handler
  // can never expose sections from every tab at once.
  applySheetTab();
  if (mine) bindSheet();
  else { state.sheetBindController?.abort(); state.sheetBindController = null; }
  $$('[data-roll-stat]').forEach(button => button.addEventListener("click", () => {
    const key = button.dataset.rollStat; roll(`1к20${signed(modifier(s.stats[key]))}`, abilities[key]);
  }));
  $$('[data-condition-info]').forEach(element => element.addEventListener("click", () => showConditionInfo(element.dataset.conditionInfo)));
  if (!mine) $$('[data-spell-info]').forEach(button => button.addEventListener("click", () => showSpellInfoFor(s, button.dataset.spellInfo)));
  if (mine) bindGameControls();
  bindRollModeControls();
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
  applyCombatTab();
}

function updateSheetGrid(root = $("#sheet-view")) {
  const stacks = $$('.sheet-grid > .stack', root);
  stacks.forEach(stack => stack.classList.toggle("hidden", !$$(':scope > [data-section]:not(.hidden)', stack).length));
  const visibleCount = stacks.filter(stack => !stack.classList.contains("hidden")).length;
  const grid = $(".sheet-grid", root);
  if (grid) {
    let columnCount = Math.max(1, Math.min(3, visibleCount));
    if (state.sheetTab === "features" && columnCount >= 3) columnCount = 2;
    grid.classList.remove("columns-1", "columns-2", "columns-3");
    grid.classList.add(`columns-${columnCount}`);
  }
}

function applyCombatTab() {
  const root = $("#sheet-view");
  if (!root) return;
  if (!['actions','loadout'].includes(state.combatTab)) state.combatTab = "actions";
  const subnav = $(".combat-subtabs",root);
  subnav?.classList.toggle("hidden", state.sheetTab !== "combat");
  $$('[data-combat-tab]',root).forEach(button => {
    const active = button.dataset.combatTab === state.combatTab;
    button.classList.toggle("active",active);
    button.setAttribute("aria-current",active ? "page" : "false");
    button.onclick = () => {
      state.combatTab = button.dataset.combatTab;
      localStorage.setItem("tt-combat-tab",state.combatTab);
      applyCombatTab();
    };
  });
  $$('[data-combat-view]',root).forEach(section => section.classList.toggle("hidden", state.sheetTab !== "combat" || section.dataset.combatView !== state.combatTab));
  updateSheetGrid(root);
}

function applySheetEditing(mine) {
  const root = $("#sheet-view"), editing = Boolean(mine && state.editMode);
  $(".sheet", root)?.classList.toggle("editing", editing);
  $$('[data-field], [data-stat], [data-coin]', root).forEach(element => {
    const hardDisable = element.tagName === "SELECT" || ["checkbox","color","file"].includes(element.type);
    if (hardDisable) element.disabled = !editing;
    else element.readOnly = !editing;
    element.setAttribute("aria-readonly", String(!editing));
  });
}

function currentSheet() { return state.room.players[state.clientId].sheet; }
function syncOwnMechanicsOnLoad() {
  const player=state.room?.players?.[state.clientId];
  if (!player?.sheet) return false;
  const before=JSON.stringify(player.sheet);
  const next=syncCharacterMechanics(structuredClone(player.sheet));
  if (JSON.stringify(next) === before) return false;
  player.sheet=next; rememberDraft(next);
  socket.emit("sheet:update",{sheet:next},response=>{ if (response?.ok) clearDraft(); });
  return true;
}
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
function closeModal() { $("#game-modal").close(); $("#game-modal").classList.remove("library-open", "builder-modal", "catalog-modal", "content-manager-modal"); }

function openExperienceModal() {
  const sheet = currentSheet(), progress = rules.xpProgress(sheet.xp, totalLevel(sheet));
  openModal("Опыт персонажа", `<div class="xp-modal-summary"><span><small>Сейчас</small><strong>${progress.xp.toLocaleString("ru-RU")} XP</strong></span><span><small>${totalLevel(sheet) >= 20 ? "Максимальный уровень" : `До ${totalLevel(sheet) + 1} уровня`}</small><strong>${totalLevel(sheet) >= 20 ? "Легенда" : `${progress.remaining.toLocaleString("ru-RU")} XP`}</strong></span></div>
    <section class="xp-add-card"><span class="eyebrow">После встречи</span><h3>Сколько опыта получил персонаж?</h3><div class="xp-quick">${[50,100,250,500,1000].map(value => `<button type="button" data-xp-quick="${value}">+${value}</button>`).join("")}</div><label>Другое количество<input id="xp-earned" type="number" min="0" step="1" value="0"></label><button id="xp-add" class="primary" type="button">Добавить опыт</button></section>
    ${state.editMode ? `<details class="xp-exact"><summary>Установить точное значение</summary><div><input id="xp-exact-value" type="number" min="0" step="1" value="${progress.xp}"><button id="xp-set" class="secondary" type="button">Сохранить значение</button></div></details>` : ""}`);
  $$('[data-xp-quick]').forEach(button => button.addEventListener("click", () => { $("#xp-earned").value = button.dataset.xpQuick; }));
  const saveXp = (value, reason) => {
    const next = structuredClone(currentSheet()); next.xp = Math.max(0, Math.floor(Number(value) || 0));
    const earnedLevel = rules.levelFromXp(next.xp);
    closeModal(); saveNow(next, "Опыт сохранён", reason); renderSheet();
    if (earnedLevel > totalLevel(next)) toast(`Опыта хватает на ${earnedLevel} уровень — можно повысить героя`);
  };
  $("#xp-add").addEventListener("click", () => saveXp(Number(sheet.xp || 0) + Math.max(0, Number($("#xp-earned").value) || 0), "Получен опыт"));
  $("#xp-set")?.addEventListener("click", () => saveXp($("#xp-exact-value").value, "Изменён опыт"));
}

function openLevelInfo(total) {
  const sheet = currentSheet(), entry = levelProgression(sheet).find(item => Number(item.level) === Number(total));
  if (!entry) return;
  const cls = rules.classes[entry.classKey];
  openModal(`${Number(total)} уровень · ${cls?.name || entry.classKey}`, `<div class="level-info-head">${classGlyph(entry.classKey)}<div><span class="eyebrow">Общий уровень ${Number(total)}</span><h3>${esc(cls?.name || entry.classKey)} ${Number(entry.classLevel)}</h3>${entry.choice ? `<p>Сделанный выбор: <strong>${esc(entry.choice)}</strong></p>` : ""}</div></div><div class="level-gains">${levelFeaturesMarkup(entry.classKey, entry.classLevel, classEntries(currentSheet()).find(item=>item.key===entry.classKey)?.subclass || "", currentSheet().optionalFeatures || [])}${commonLevelFeaturesMarkup(total)}</div><div class="read-only">Также увеличиваются максимум HP и запас костей хитов этого класса.</div><button id="level-info-close" class="primary" type="button">Понятно</button>`);
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

function openVitalEditor(kind) {
  if (!state.editMode) return toast("Сначала включи ползунок «Редактирование»");
  const sheet = currentSheet();
  const configs = {
    ac:{ title:"Класс доспеха", body:`<div class="vital-editor"><div class="vital-editor-value"><small>Сейчас</small><strong>${calculateAc(sheet)}</strong></div><label class="condition-chip"><input id="vital-auto" type="checkbox" ${sheet.autoArmorClass ? "checked" : ""}>Считать КД автоматически по броне</label><label>КД вручную<input id="vital-value" type="number" min="0" max="99" value="${Number(sheet.ac || 10)}" ${sheet.autoArmorClass ? "disabled" : ""}></label><p>При автоматическом расчёте учитываются Ловкость, надетая броня, щит и классовая защита.</p></div>` },
    initiative:{ title:"Инициатива", body:`<div class="vital-editor"><div class="vital-editor-value"><small>Сейчас</small><strong>${signed(initiativeBonus(sheet))}</strong></div><label>Дополнительный бонус<input id="vital-value" type="number" min="-99" max="99" value="${Number(sheet.initiativeBonus || 0)}"></label><label class="condition-chip"><input id="vital-advantage" type="checkbox" ${sheet.initiativeAdvantage ? "checked" : ""}>Преимущество на броски инициативы</label><p>Модификатор Ловкости ${signed(modifier(sheet.stats.dex))} уже прибавляется автоматически.</p></div>` },
    speed:{ title:"Скорость и прыжки", body:`<div class="vital-editor"><div class="vital-editor-value"><small>Сейчас</small><strong>${Number(sheet.speed || 0)} фт.</strong></div><label>Скорость, футы<input id="vital-value" type="number" min="0" max="999" value="${Number(sheet.speed || 0)}"></label><div class="two-col"><label>Прыжок в высоту<input id="vital-jump-high" value="${esc(sheet.jumpHigh || Math.max(0,3 + modifier(sheet.stats.str)))}"></label><label>Прыжок в длину<input id="vital-jump-long" value="${esc(sheet.jumpLong || Number(sheet.stats.str))}"></label></div></div>` },
    proficiency:{ title:"Мастерство и владения", body:`<div class="vital-editor"><div class="vital-editor-value"><small>Сейчас</small><strong>${signed(effectiveProficiency(sheet))}</strong></div><label class="condition-chip"><input id="vital-auto" type="checkbox" ${sheet.autoProficiency ? "checked" : ""}>Считать бонус по общему уровню</label><label>Бонус вручную<input id="vital-value" type="number" min="-20" max="20" value="${Number(sheet.proficiency || 0)}" ${sheet.autoProficiency ? "disabled" : ""}></label><button id="vital-open-masteries" class="secondary" type="button">Настроить навыки и спасброски</button></div>` },
    passive:{ title:"Пассивное восприятие", body:`<div class="vital-editor"><div class="vital-editor-value"><small>Сейчас</small><strong>${passivePerception(sheet)}</strong></div><label>Дополнительный бонус<input id="vital-value" type="number" min="-100" max="100" value="${Number(sheet.passivePerceptionBonus || 0)}"></label><p>База без ручной поправки: ${passivePerception(sheet) - Number(sheet.passivePerceptionBonus || 0)}. Она считается из Восприятия, мастерства, компетентности и черт.</p></div>` }
  };
  const config = configs[kind];
  if (!config) return;
  openModal(config.title, `${config.body}<div class="modal-actions"><button id="vital-save" class="primary" type="button">Сохранить</button><button id="vital-cancel" class="secondary" type="button">Отмена</button></div>`);
  $("#vital-auto")?.addEventListener("change", event => { $("#vital-value").disabled = event.currentTarget.checked; });
  $("#vital-open-masteries")?.addEventListener("click", () => { closeModal(); openProficienciesModal(); });
  $("#vital-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    if (kind === "ac") { next.autoArmorClass = $("#vital-auto").checked; next.ac = next.autoArmorClass ? calculateAc({ ...next, autoArmorClass:true }) : Math.max(0, Number($("#vital-value").value) || 0); }
    if (kind === "initiative") { next.initiativeBonus = Number($("#vital-value").value) || 0; next.initiativeAdvantage = $("#vital-advantage").checked; }
    if (kind === "speed") { next.speed = Math.max(0, Number($("#vital-value").value) || 0); next.jumpHigh = $("#vital-jump-high").value.trim(); next.jumpLong = $("#vital-jump-long").value.trim(); }
    if (kind === "proficiency") { next.autoProficiency = $("#vital-auto").checked; next.proficiency = next.autoProficiency ? rules.proficiency(totalLevel(next)) : Number($("#vital-value").value) || 0; }
    if (kind === "passive") next.passivePerceptionBonus = Math.max(-100, Math.min(100, Number($("#vital-value").value) || 0));
    syncCharacterMechanics(next); closeModal(); saveNow(next,"Показатель сохранён",`Изменён показатель: ${config.title}`); renderSheet();
  });
  $("#vital-cancel").addEventListener("click", closeModal);
}

function bindGameControls() {
  $("#edit-mode-toggle")?.addEventListener("change", event => {
    state.editMode = event.currentTarget.checked;
    localStorage.setItem("tt-edit-mode", state.editMode ? "1" : "0");
    renderSheet();
    toast(state.editMode ? "Редактирование включено — нажимай на верхние карточки" : "Игровой режим — случайные правки заблокированы");
  });
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
  $("#quick-initiative")?.addEventListener("click", () => state.editMode ? openVitalEditor("initiative") : roll(`1к20${signed(initiativeBonus(currentSheet()))}`, "Инициатива", currentSheet().initiativeAdvantage ? { mode:"advantage" } : {}));
  $('[data-vital="ac"]')?.addEventListener("click", () => openVitalEditor("ac"));
  $('[data-vital="speed"]')?.addEventListener("click", () => openVitalEditor("speed"));
  $('[data-vital="proficiency"]')?.addEventListener("click", () => openVitalEditor("proficiency"));
  $('[data-vital="passive"]')?.addEventListener("click", () => openVitalEditor("passive"));
  $("#quick-inspiration")?.addEventListener("click", toggleInspiration);
  $("#proficiencies-manager")?.addEventListener("click", openProficienciesModal);
  $("#proficiencies-manager-saves")?.addEventListener("click", openProficienciesModal);
  $(".xp-track")?.addEventListener("click", openExperienceModal);
  $(".xp-track")?.addEventListener("keydown", event => { if (["Enter"," "].includes(event.key)) { event.preventDefault(); openExperienceModal(); } });
  $$('[data-level-info]').forEach(button => button.addEventListener("click", () => openLevelInfo(button.dataset.levelInfo)));
  $("#death-save-roll")?.addEventListener("click", rollDeathSave);
  $$('[data-death-pip]', $('#sheet-view')).forEach(button => button.addEventListener('click', () => setDeathSaveCount(button.dataset.deathPip, button.dataset.deathCount)));
  $$('[data-class-damage]').forEach(button => button.addEventListener("click", () => roll(resolveDiceFormula(button.dataset.classDamage, currentSheet()), button.closest(".class-combat-hint")?.querySelector("span")?.textContent || "Классовый урон", { mode:"normal" })));
  $("#attack-add")?.addEventListener("click", () => openAttackModal());
  $("#conditions-manager")?.addEventListener("click", openConditionsModal);
  $("#slots-manager")?.addEventListener("click", openSlotsModal);
  $$('[data-attack-edit]').forEach(button => button.addEventListener("click", () => openAttackModal(button.dataset.attackEdit)));
  $$('[data-attack-roll]').forEach(button => button.addEventListener("click", () => {
    const attack = currentSheet().attacksList.find(item => item.id === button.dataset.attackRoll);
    if (attack) performAttackRoll(attack);
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
  $("#optional-features-manager")?.addEventListener("click", openOptionalFeaturesManager);
  $("#infusions-manager")?.addEventListener("click", openInfusionsManager);
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
  bindCombatLoadoutControls();
}

function activeAmmoForAttack(sheet, attack) {
  const set = activeCombatSet(sheet);
  const weapon = combatItem(sheet,set.slots.mainHand) || combatItem(sheet,set.slots.offHand);
  if (!weapon || !isRangedWeapon(weapon) || (attack.sourceItemId && attack.sourceItemId !== weapon.id)) return null;
  const ammo = combatItem(sheet,set.slots.ammo);
  return ammoMatchesWeapon(weapon,ammo) ? ammo : null;
}
function activeAmmoMagicBonus(sheet, attack) {
  return Math.max(0,Number(activeAmmoForAttack(sheet,attack)?.magicBonus || 0));
}
function performAttackRoll(attack, options = {}) {
  const sheet = currentSheet();
  const fixedMode = options.mode || (attack?.rollMode && attack.rollMode !== "inherit" ? attack.rollMode : undefined);
  const ammoBonus = activeAmmoMagicBonus(sheet,attack);
  const targetSuffix = options.target?.name ? ` → ${options.target.name}` : "";
  const externalResult = options.onResult;
  return roll(`1к20${signed(resolveBonus(attackBonusFormula(attack,sheet),sheet) + ammoBonus)}`, `Атака: ${attack.name}${targetSuffix}${ammoBonus ? ` · боеприпас +${ammoBonus}` : ""}`, { ...options, ...(fixedMode ? { mode:fixedMode } : {}), onResult: response => {
    if (response.natural === 20) { state.lastCriticalAttackId = attack.id; toast("Натуральная 20! Жми ✦ для критического урона"); }
    else if (response.natural === 1) toast("Натуральная 1 — автоматический промах");
    consumeLoadoutAmmo(attack);
    externalResult?.(response);
  }});
}

function consumeLoadoutAmmo(attack) {
  const sheet = currentSheet(), loadout = ensureCombatLoadout(sheet), set = activeCombatSet(sheet);
  if (!loadout.autoAmmo) return;
  const weapon = combatItem(sheet,set.slots.mainHand) || combatItem(sheet,set.slots.offHand);
  if (!weapon || !isRangedWeapon(weapon) || (attack.sourceItemId && attack.sourceItemId !== weapon.id)) return;
  const ammo = combatItem(sheet,set.slots.ammo);
  if (!ammo || Number(ammo.quantity || 0) <= 0) return toast("Атака сохранена, но в слоте нет боеприпасов");
  if (!ammoMatchesWeapon(weapon,ammo)) return toast(`Для «${weapon.name}» выбран неподходящий боеприпас`);
  const next = structuredClone(sheet), nextAmmo = combatItem(next,activeCombatSet(next).slots.ammo);
  nextAmmo.quantity = Math.max(0,Number(nextAmmo.quantity || 0)-1);
  saveNow(next,`Боеприпасы: ${nextAmmo.quantity}`,"Израсходован боеприпас");
  renderSheet();
}

function selectLoadoutItem(itemId) {
  state.selectedLoadoutItemId = state.selectedLoadoutItemId === itemId ? "" : itemId;
  refreshLoadoutSelection();
  const item = combatItem(currentSheet(),state.selectedLoadoutItemId);
  if (item) toast(`Выбран предмет: ${item.name}`);
}
function refreshLoadoutSelection() {
  const root = $(".loadout-panel"); if (!root) return;
  $$('[data-loadout-item]',root).forEach(card => card.classList.toggle("selected",card.dataset.loadoutItem === state.selectedLoadoutItemId));
  const item = combatItem(currentSheet(),state.selectedLoadoutItemId), recommended = new Set(recommendedCombatSlots(item));
  $$('[data-loadout-drop]',root).forEach(slot => slot.classList.toggle("recommended",Boolean(item && recommended.has(slot.dataset.loadoutDrop))));
  const advice = $(".loadout-rule-card",root);
  if (advice && item) advice.innerHTML = `<span>Выбран предмет</span><strong>${esc(item.name)}</strong><small>Нажми подсвеченный слот или перетащи предмет.</small>`;
}
function applyLoadoutInventoryFilter() {
  const root = $(".loadout-panel"); if (!root) return;
  const query = String(state.loadoutSearch || "").trim().toLowerCase();
  let visible = 0;
  $$('[data-loadout-item]',root).forEach(card => {
    const kind = card.dataset.loadoutKind;
    const matchesKind = state.loadoutFilter === "all" || kind === state.loadoutFilter;
    const matchesSearch = !query || card.dataset.loadoutSearch.includes(query);
    card.classList.toggle("hidden",!(matchesKind && matchesSearch));
    if (matchesKind && matchesSearch) visible += 1;
  });
  const visibleCount = $("#loadout-visible-count",root);
  if (visibleCount) visibleCount.textContent = `${visible} из ${$$('[data-loadout-item]',root).length}`;
  $$('[data-loadout-filter]',root).forEach(button => button.classList.toggle("active",button.dataset.loadoutFilter === state.loadoutFilter));
  $("#loadout-filter-empty",root)?.classList.toggle("hidden",visible > 0 || !$$('[data-loadout-item]',root).length);
}
function assignCombatSlot(slotKey, itemId = state.selectedLoadoutItemId) {
  if (!state.editMode) return toast("Включи редактирование, чтобы менять комплект");
  if (!itemId) return toast("Сначала выбери предмет из рюкзака");
  const next = structuredClone(currentSheet()), set = activeCombatSet(next), item = combatItem(next,itemId);
  if (!item) return;
  combatSlotKeys.forEach(key => { if (set.slots[key] === itemId) set.slots[key] = ""; });
  set.quickSlots = set.quickSlots.map(id => id === itemId ? "" : id);
  set.slots[slotKey] = itemId;
  next.combatLoadout.initialized = true;
  syncActiveEquipmentFlags(next);
  state.selectedLoadoutItemId = "";
  saveNow(next,`${item.name}: ${combatSlotMeta[slotKey].label}`,"Изменён боевой комплект"); renderSheet();
}
function removeCombatSlot(slotKey) {
  if (!state.editMode) return;
  const next = structuredClone(currentSheet()), set = activeCombatSet(next), item = combatItem(next,set.slots[slotKey]);
  set.slots[slotKey] = ""; syncActiveEquipmentFlags(next);
  saveNow(next,`${combatSlotMeta[slotKey].label} освобождён`,"Изменён боевой комплект"); renderSheet();
  if (item) toast(`${item.name} остался в рюкзаке`);
}
function switchCombatSet(setId) {
  const next = structuredClone(currentSheet()); ensureCombatLoadout(next);
  if (!combatSetIds.includes(setId) || next.combatLoadout.activeSet === setId) return;
  next.combatLoadout.activeSet = setId; syncActiveEquipmentFlags(next);
  state.selectedLoadoutItemId = "";
  const name = activeCombatSet(next).name;
  saveNow(next,`${name} активен`,"Сменён боевой комплект"); renderSheet();
}
function openLoadoutRenameModal() {
  const set = activeCombatSet(currentSheet());
  openModal("Название комплекта",`<div class="lego-intro"><span>⬡</span><div><strong>Быстрая смена вооружения</strong><p>Например: «Лук», «Щит и меч» или «Скрытность».</p></div></div><label>Название<input id="loadout-name" maxlength="40" value="${esc(set.name)}"></label><div class="modal-actions"><button id="loadout-name-save" class="primary">Сохранить</button><button id="loadout-name-cancel" class="secondary">Отмена</button></div>`);
  $("#loadout-name")?.focus();
  $("#loadout-name-save")?.addEventListener("click",()=>{ const next=structuredClone(currentSheet()), nextSet=activeCombatSet(next); nextSet.name=$("#loadout-name").value.trim() || nextSet.name; closeModal(); saveNow(next,"Комплект переименован","Боевой комплект"); renderSheet(); });
  $("#loadout-name-cancel")?.addEventListener("click",closeModal);
}
function assignQuickSlot(index, itemId = state.selectedLoadoutItemId) {
  if (!state.editMode) return;
  if (!itemId) return toast("Сначала выбери расходник или предмет");
  const next = structuredClone(currentSheet()), set = activeCombatSet(next), item = combatItem(next,itemId); if (!item) return;
  set.quickSlots = set.quickSlots.map(id => id === itemId ? "" : id);
  combatSlotKeys.forEach(key => { if (set.slots[key] === itemId) set.slots[key] = ""; });
  set.quickSlots[index] = itemId; syncActiveEquipmentFlags(next); state.selectedLoadoutItemId = "";
  saveNow(next,`${item.name} на быстром поясе`,"Изменён быстрый доступ"); renderSheet();
}
function removeQuickSlot(index) {
  const next = structuredClone(currentSheet()), set = activeCombatSet(next); set.quickSlots[index] = "";
  saveNow(next,"Быстрый слот освобождён","Изменён быстрый доступ"); renderSheet();
}
function healingPotionFormula(item) {
  const text = `${item?.name || ""} ${item?.description || ""}`.toLowerCase();
  if (!/зель.*леч|лечебн|potion.*heal|healing potion/.test(text)) return "";
  if (item.useFormula) return resolveDiceFormula(item.useFormula,currentSheet());
  if (/величай|supreme/.test(text)) return "10к4+20";
  if (/превосход|superior/.test(text)) return "8к4+8";
  if (/больш|greater/.test(text)) return "4к4+4";
  return "2к4+2";
}
function quickItemCondition(item) {
  if (conditionNames.includes(item.useCondition)) return item.useCondition;
  const text = `${item.name || ""} ${item.description || ""}`.toLowerCase();
  const rules = [
    [/невидим|invisibility/,"Невидим"], [/скрыт|stealth/,"Скрыт"], [/отрав|poison/,"Отравлен"],
    [/испуг|frighten|fear/,"Испуган"], [/оглуш|stun/,"Оглушён"], [/парализ|paraly/,"Парализован"],
    [/опут|restrain|web/,"Опутан"], [/ослеп|blind/,"Ослеплён"], [/очаров|charm/,"Очарован"],
    [/окамен|petrif/,"Окаменел"], [/сбит с ног|prone/,"Сбит с ног"]
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "";
}
function ownVttTokenId() {
  return (state.room?.scene?.tokens || []).find(token => token.playerId === state.clientId)?.id || "";
}
async function useInventoryItem(itemId, options = {}) {
  const source = combatItem(currentSheet(),itemId);
  if (!source) return toast("Предмет не найден");
  if (Number(source.quantity || 0) <= 0) return toast(`${source.name}: запас закончился`);
  const formula = healingPotionFormula(source);
  const condition = quickItemCondition(source);
  const itemText = `${source.name || ""} ${source.description || ""}`.toLowerCase();
  const isScroll = source.catalogCategory === "scroll" || /свиток|scroll/.test(itemText);
  const targetId = options.targetId || ownVttTokenId();
  const visibility = options.visibility === "private" ? "private" : "public";
  let outcome = { ok:true };
  if (formula) {
    const result = await vttRollFormula(formula,`Лечение: ${source.name}`,visibility);
    if (!result?.ok) return result;
    if (targetId) outcome = await vttApplyCombat(targetId,"healing",Number(result.total)||0,`Использован ${source.name}`,visibility);
  } else if (condition && targetId) {
    outcome = await vttToggleCondition(targetId,condition,true);
    if (outcome?.ok && (source.useConcentration || /концентрац|concentration/.test(itemText))) await vttSetConcentration(targetId,source.name);
  } else if (isScroll && targetId && source.useConcentration) {
    const spellName = String(source.name || "Свиток").replace(/^Свиток[:\s-]*/i,"").trim() || source.name;
    outcome = await vttSetConcentration(targetId,spellName);
  } else if (source.useFormula) {
    outcome = await vttRollFormula(resolveDiceFormula(source.useFormula,currentSheet()),`Использован: ${source.name}`,visibility);
  }
  if (outcome?.ok === false) return outcome;
  const next=structuredClone(currentSheet()), item=combatItem(next,itemId);
  if (!item || Number(item.quantity||0)<=0) return toast(`${source.name}: предмет уже закончился`);
  item.quantity=Math.max(0,Number(item.quantity)-1);
  saveNow(next,`${item.name}: осталось ${item.quantity}`,"Использован предмет");
  renderSheet();
  if (!formula && !condition && !isScroll && !source.useFormula) toast(`${item.name} использован · осталось ${item.quantity}`);
  return { ok:true,quantity:item.quantity };
}

async function useQuickItem(index, options = {}) {
  const sheet=currentSheet(), set=activeCombatSet(sheet), source=combatItem(sheet,set.quickSlots[index]);
  if (!source) return state.editMode ? assignQuickSlot(index) : toast("Этот быстрый слот пуст");
  if (state.editMode && state.selectedLoadoutItemId) return assignQuickSlot(index);
  return useInventoryItem(source.id,options);
}

function assignAttunement(index, itemId = state.selectedLoadoutItemId) {
  if (!state.editMode) return;
  if (!itemId) return toast("Сначала выбери магический предмет");
  const next = structuredClone(currentSheet()), loadout = ensureCombatLoadout(next), item = combatItem(next,itemId); if (!item) return;
  const firstThree = loadout.attunementSlots.filter(id => id && id !== itemId).slice(0,3);
  const replaced = firstThree[index];
  while (firstThree.length <= index) firstThree.push("");
  firstThree[index] = itemId;
  const overflow = loadout.attunementSlots.filter((id,slotIndex) => slotIndex >= 3 && id !== itemId);
  loadout.attunementSlots = [...firstThree.filter(Boolean),...overflow]; item.attuned = true;
  if (replaced && !loadout.attunementSlots.includes(replaced)) { const old = combatItem(next,replaced); if (old) old.attuned = false; }
  state.selectedLoadoutItemId = ""; saveNow(next,`${item.name}: настройка`,"Магическая настройка"); renderSheet();
}
function removeAttunement(index) {
  const next = structuredClone(currentSheet()), loadout = ensureCombatLoadout(next), itemId = loadout.attunementSlots[index];
  loadout.attunementSlots.splice(index,1); const item = combatItem(next,itemId); if (item) item.attuned = false;
  saveNow(next,"Настройка снята","Магическая настройка"); renderSheet();
}
function addOverflowAttunement() {
  if (!state.selectedLoadoutItemId) return toast("Сначала выбери предмет");
  const next = structuredClone(currentSheet()), loadout = ensureCombatLoadout(next), item = combatItem(next,state.selectedLoadoutItemId); if (!item) return;
  if (!loadout.attunementSlots.includes(item.id)) loadout.attunementSlots.push(item.id);
  item.attuned = true; state.selectedLoadoutItemId = "";
  saveNow(next,`${item.name}: настройка сверх лимита`,"Хоумбрю-настройка"); renderSheet();
}
function showInventoryItem(itemId) {
  const item = combatItem(currentSheet(),itemId); if (!item) return;
  openModal(item.name || "Предмет",`<div class="item-detail-hero"><span>${itemCombatIcon(item)}</span><div><span class="eyebrow">${esc(item.rarity || itemCategoryNames[item.catalogCategory] || itemCombatKind(item))}</span><h3>${esc(item.name || "Предмет")}</h3>${item.originalName && item.originalName !== item.name ? `<small>${esc(item.originalName)}</small>` : ""}<p>${esc(combatItemSummary(item))}</p></div></div><div class="item-flags">${item.equipped ? "<span>в активном комплекте</span>" : ""}${item.attuned ? "<span>настроено</span>" : item.requiresAttunement ? "<span>требует настройки</span>" : ""}${item.magical ? "<span>магический</span>" : ""}<span>${Number(item.quantity || 0)} шт.</span></div><p class="item-detail-description">${esc(item.description || item.properties || "Описание не добавлено.").replace(/\n/g,"<br>")}</p><div class="modal-actions">${state.editMode ? `<button id="loadout-item-edit" class="primary">Редактировать</button>` : ""}<button id="loadout-item-close" class="secondary">Закрыть</button></div>`);
  $("#loadout-item-edit")?.addEventListener("click",()=>{ closeModal(); openItemModal(item.id); });
  $("#loadout-item-close")?.addEventListener("click",closeModal);
}
function bindCombatLoadoutControls() {
  const root = $(".loadout-panel"); if (!root) return;
  $$('[data-loadout-set]',root).forEach(button=>button.addEventListener("click",()=>switchCombatSet(button.dataset.loadoutSet)));
  $("#loadout-rename",root)?.addEventListener("click",openLoadoutRenameModal);
  $("#auto-ammo",root)?.addEventListener("change",event=>{ const next=structuredClone(currentSheet()); ensureCombatLoadout(next).autoAmmo=event.currentTarget.checked; saveNow(next,event.currentTarget.checked ? "Автоснаряды включены" : "Автоснаряды выключены","Настройка боевого комплекта"); renderSheet(); });
  $("#loadout-search",root)?.addEventListener("input",event=>{ state.loadoutSearch=event.currentTarget.value; applyLoadoutInventoryFilter(); });
  $$('[data-loadout-filter]',root).forEach(button=>button.addEventListener("click",()=>{ state.loadoutFilter=button.dataset.loadoutFilter; applyLoadoutInventoryFilter(); }));
  $$('[data-loadout-item]',root).forEach(card=>{
    card.addEventListener("click",()=>state.editMode ? selectLoadoutItem(card.dataset.loadoutItem) : showInventoryItem(card.dataset.loadoutItem));
    card.addEventListener("dragstart",event=>{ if(!state.editMode){event.preventDefault();return;} state.selectedLoadoutItemId=card.dataset.loadoutItem; event.dataTransfer.setData("text/tabaxi-item",card.dataset.loadoutItem); event.dataTransfer.effectAllowed="move"; refreshLoadoutSelection(); });
  });
  $$('[data-loadout-slot]',root).forEach(button=>button.addEventListener("click",()=>{ const slotKey=button.dataset.loadoutSlot, itemId=activeCombatSet(currentSheet()).slots[slotKey]; if(state.editMode) state.selectedLoadoutItemId ? assignCombatSlot(slotKey) : itemId ? selectLoadoutItem(itemId) : toast("Выбери предмет из рюкзака"); else if(itemId) showInventoryItem(itemId); }));
  $$('[data-loadout-remove]',root).forEach(button=>button.addEventListener("click",()=>removeCombatSlot(button.dataset.loadoutRemove)));
  $$('[data-loadout-drop]',root).forEach(zone=>{
    zone.addEventListener("dragover",event=>{ if(!state.editMode)return; event.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave",()=>zone.classList.remove("dragover"));
    zone.addEventListener("drop",event=>{ event.preventDefault(); zone.classList.remove("dragover"); assignCombatSlot(zone.dataset.loadoutDrop,event.dataTransfer.getData("text/tabaxi-item")); });
  });
  $$('[data-loadout-attack]',root).forEach(button=>button.addEventListener("click",()=>{ const attack=currentSheet().attacksList.find(entry=>entry.id===button.dataset.loadoutAttack); if(attack) performAttackRoll(attack); }));
  $$('[data-loadout-damage]',root).forEach(button=>button.addEventListener("click",()=>{ const attack=currentSheet().attacksList.find(entry=>entry.id===button.dataset.loadoutDamage); if(attack) rollAttackDamage(attack,false); }));
  $$('[data-loadout-critical]',root).forEach(button=>button.addEventListener("click",()=>{ const attack=currentSheet().attacksList.find(entry=>entry.id===button.dataset.loadoutCritical); if(attack) rollAttackDamage(attack,true); }));
  $$('[data-loadout-inspect]',root).forEach(button=>button.addEventListener("click",()=>showInventoryItem(button.dataset.loadoutInspect)));
  $$('[data-quick-use]',root).forEach(button=>button.addEventListener("click",()=>useQuickItem(Number(button.dataset.quickUse))));
  $$('[data-quick-remove]',root).forEach(button=>button.addEventListener("click",()=>removeQuickSlot(Number(button.dataset.quickRemove))));
  $$('[data-quick-drop]',root).forEach(zone=>{ zone.addEventListener("dragover",event=>{if(!state.editMode)return;event.preventDefault();zone.classList.add("dragover");}); zone.addEventListener("dragleave",()=>zone.classList.remove("dragover")); zone.addEventListener("drop",event=>{event.preventDefault();zone.classList.remove("dragover");assignQuickSlot(Number(zone.dataset.quickDrop),event.dataTransfer.getData("text/tabaxi-item"));}); });
  $$('[data-attunement-slot]',root).forEach(button=>button.addEventListener("click",()=>state.editMode ? assignAttunement(Number(button.dataset.attunementSlot)) : combatItem(currentSheet(),ensureCombatLoadout(currentSheet()).attunementSlots[Number(button.dataset.attunementSlot)]) && showInventoryItem(ensureCombatLoadout(currentSheet()).attunementSlots[Number(button.dataset.attunementSlot)])));
  $$('[data-attunement-remove]',root).forEach(button=>button.addEventListener("click",()=>removeAttunement(Number(button.dataset.attunementRemove))));
  $$('[data-attunement-drop]',root).forEach(zone=>{ zone.addEventListener("dragover",event=>{if(!state.editMode)return;event.preventDefault();zone.classList.add("dragover");}); zone.addEventListener("dragleave",()=>zone.classList.remove("dragover")); zone.addEventListener("drop",event=>{event.preventDefault();zone.classList.remove("dragover");assignAttunement(Number(zone.dataset.attunementDrop),event.dataTransfer.getData("text/tabaxi-item"));}); });
  $("#attunement-overflow",root)?.addEventListener("click",addOverflowAttunement);
  applyLoadoutInventoryFilter(); refreshLoadoutSelection();
}

function skillName(key) { return skills.find(([skillKey]) => skillKey === key)?.[1] || key; }

function starterCatalogItem(key) {
  const canonicalKey = itemSystem.normalizeCatalogKey(key);
  return fullItemCatalog().find(item => item.key === canonicalKey);
}

function addStarterItem(sheet, source) {
  if (!source || sheet.inventoryList.some(item => itemSystem.normalizeCatalogKey(item.catalogKey || item.key) === source.key)) return;
  const itemId = uuid();
  const equipped = source.type === "armor";
  sheet.inventoryList.push({ ...structuredClone(source), key:undefined, catalogKey:source.key, id:itemId, quantity:Number(source.quantity || 1), equipped, attuned:false, magical:false, description:source.properties || "" });
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
  const responses = await Promise.all([fetch("/spells-5e.json"), fetch("/spells-phb-support-xgte-tcoe.json"), fetch("/spells-xgte-tcoe.json")]);
  if (responses.some(response => !response.ok)) throw new Error("catalog");
  const [base, phbSupport, supplements] = await Promise.all(responses.map(response => response.json()));
  const subclassStubs=Object.values(window.TT_SUBCLASS_SPELLS_XGTE_TCOE || {}).flatMap(group=>Object.values(group || {}).flat()).map(spell=>({ ...spell, classes:[], source:rules.sourceInfo?.(spell.sourceId)?.name || "Базовые правила 2014" }));
  const merged = [...subclassStubs, ...base.map(spell => ({ ...spell, sourceId:spell.sourceId || "srd2014", source:spell.source || "Открытые правила 2014" })), ...phbSupport, ...supplements];
  const unique = new Map();
  merged.forEach(spell => unique.set(spell.key, { ...spell, classes:[...new Set(spell.classes || [])] }));
  spellCatalog = [...unique.values()].sort((a,b) => Number(a.level)-Number(b.level) || String(a.name).localeCompare(String(b.name),"ru"));
  Object.entries(rules.spellClassKeys || {}).forEach(([classKey,keys]) => {
    const className = rules.classes[classKey]?.name;
    if (!className) return;
    const allowed = new Set(keys);
    spellCatalog.forEach(spell => {
      if (allowed.has(spell.key) && !spell.classes.includes(className)) spell.classes.push(className);
    });
  });
  return spellCatalog;
}
function spellAvailableForClass(spell, classKey, sheet = currentSheet()) {
  if (!classKey) return true;
  const className = rules.classes[classKey]?.name;
  if (className && (spell.classes || []).includes(className)) return true;
  const classKeys=new Set(rules.spellKeysForClass?.(classKey,sheet.optionalFeatures || []) || []);
  const subclassKeys=new Set(rules.subclassSpellKeysFor?.(sheet,classKey) || []);
  return classKeys.has(spell.key) || subclassKeys.has(spell.key);
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
          <label>Класс<select id="builder-class">${Object.entries(rules.classes).map(([key,value]) => `<option value="${key}" ${key === guessedClass ? "selected" : ""}>${value.name} · к${value.hitDie}${sourceSuffix(value.source)}</option>`).join("")}</select></label>
          <label>Подкласс<select id="builder-subclass"></select></label>
          <label>Уровень<select id="builder-level">${Array.from({length:20},(_,i)=>`<option value="${i+1}" ${Number(s.level || 1) === i+1 ? "selected" : ""}>${i+1} уровень</option>`).join("")}</select></label>
          <label>Раса<select id="builder-race">${(rules.raceOptions?.() || Object.entries(rules.races).map(([key,value])=>({key,...value}))).map(value => `<option value="${value.key}" ${value.key === guessedRace ? "selected" : ""}>${value.name}${sourceSuffix(value.source)}</option>`).join("")}</select></label>
          <label>Предыстория<select id="builder-background">${Object.entries(rules.backgrounds).map(([key,value]) => `<option value="${key}" ${key === guessedBackground ? "selected" : ""}>${value.name}</option>`).join("")}</select></label>
        </div>
        <div id="builder-origin-box" class="builder-origin-box"></div>
        <div id="builder-concept" class="builder-concept"></div>
      </section>
      <section class="builder-page hidden" data-builder-page="abilities">
        <div class="builder-section-head"><div><span class="eyebrow">Автоматический расчёт</span><h3>Характеристики без бухгалтерии</h3></div><div class="builder-ability-actions"><button id="builder-recommended" class="secondary" type="button">Стандартный массив под класс</button></div></div>
        <p class="builder-help">Оставь стандартный массив, введи значения вручную или нажми 🎲 у конкретной характеристики — три физических к6 вылетят на стол, а результат запишется после остановки кубов.</p>
        <div class="ability-builder ability-builder-v2">${Object.entries(abilities).map(([key,name]) => `<label><span>${name}</span><input data-builder-stat="${key}" type="number" min="1" max="30" value="${Number(s.stats[key] || 10)}"><div class="ability-builder-card-footer"><small data-builder-stat-note="${key}">—</small><button class="ability-roll-3d6" data-builder-roll-stat="${key}" type="button" title="Бросить 3d6 для характеристики «${esc(name)}»" aria-label="Бросить 3d6 для характеристики «${esc(name)}»">🎲</button></div></label>`).join("")}</div>
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
          <label class="toggle-row"><span><strong>Опциональные особенности Таши</strong><small>Включить доступные дополнения и замены класса</small></span><input id="builder-tasha-options" type="checkbox" ${s.optionalFeatures?.length || !s.classKey ? "checked" : ""}><i></i></label>
          <label class="toggle-row"><span><strong>Пересчитать HP</strong><small>Среднее значение по уровню</small></span><input id="builder-hp" type="checkbox" checked><i></i></label>
        </div></details>
      </section>
      <footer class="builder-footer"><button id="builder-back" class="secondary hidden" type="button">Назад</button><span></span><button id="builder-next" class="primary" type="button">Дальше</button><button id="builder-finish" class="primary hidden" type="button">Создать готового героя</button></footer>
    </div>`);

  const statInputs = () => $$('[data-builder-stat]', $("#modal-content"));
  const currentKeys = () => ({ classKey:$("#builder-class").value, raceKey:$("#builder-race").value, backgroundKey:$("#builder-background").value, level:Math.max(1, Math.min(20, Number($("#builder-level").value || 1))) });
  let originDraft = structuredClone(s.originCustomization || { enabled:false, flexibleAbilities:[], skillChoice:"", lineageTalent:"darkvision", size:"", languageChoice:"", proficiencyChoice:"", levelOneFeatKey:"", levelOneFeatAbility:"" });
  const originAmounts = race => [...Object.values(race?.bonuses || {}).map(Number), ...(race?.flexible || []).map(Number)].filter(Boolean);
  const languageOptions = ["Дварфийский","Эльфийский","Великаний","Гномий","Гоблинский","Полуросликов","Орочий","Бездны","Небесный","Драконий","Глубинная речь","Инфернальный","Первичный","Сильван","Подземный"];
  const readOriginControls = () => {
    const enabled=$("#builder-origin-enabled"), talent=$("#builder-lineage-talent"), skill=$("#builder-origin-skill"), size=$("#builder-lineage-size"), feat=$("#builder-lineage-feat"), featAbility=$("#builder-lineage-feat-ability"), language=$("#builder-origin-language"), proficiency=$("#builder-origin-proficiency");
    if (enabled) originDraft.enabled=enabled.checked;
    originDraft.flexibleAbilities=$$('[data-origin-ability]').map(select=>select.value).filter(Boolean);
    if (talent) originDraft.lineageTalent=talent.value;
    if (skill) originDraft.skillChoice=skill.value;
    if (size) originDraft.size=size.value;
    if (feat) originDraft.levelOneFeatKey=feat.value;
    if (featAbility) originDraft.levelOneFeatAbility=featAbility.value;
    if (language) originDraft.languageChoice=language.value.trim();
    if (proficiency) originDraft.proficiencyChoice=proficiency.value.trim();
    return originDraft;
  };
  const buildOptions = () => {
    readOriginControls();
    const race=rules.races[currentKeys().raceKey];
    const enabled=Boolean(originDraft.enabled || race?.customLineage);
    return enabled ? { bonuses:{}, flexible:originAmounts(race), flexibleAbilities:originDraft.flexibleAbilities } : {};
  };
  const renderOriginControls = () => {
    const { classKey,raceKey }=currentKeys(), race=rules.races[raceKey];
    const forced=Boolean(race?.customLineage); if (forced) originDraft.enabled=true;
    const enabled=Boolean(originDraft.enabled || forced), amounts=originAmounts(race), priority=rules.statPriorities[classKey] || Object.keys(abilities);
    const used=[];
    const selected=amounts.map((_,index)=>{
      const preferred=originDraft.flexibleAbilities?.[index];
      const choice=preferred && !used.includes(preferred) ? preferred : priority.find(key=>!used.includes(key));
      used.push(choice); return choice;
    });
    originDraft.flexibleAbilities=selected;
    const temporary={ raceKey, race:race?.name, classes:[{key:classKey,level:1}] };
    const featOptions=Object.entries(rules.feats).filter(([key])=>rules.featAvailable?.(key,temporary)?.ok !== false).map(([key,feat])=>`<option value="${key}" ${originDraft.levelOneFeatKey===key ? "selected" : ""}>${esc(feat.name)}${sourceSuffix(feat.source)}</option>`).join("");
    const selectedFeat=rules.feats[originDraft.levelOneFeatKey] || null;
    const featAbilities=selectedFeat?.abilityChoices || [];
    if (featAbilities.length && !featAbilities.includes(originDraft.levelOneFeatAbility)) originDraft.levelOneFeatAbility=priority.find(key=>featAbilities.includes(key)) || featAbilities[0];
    const featAbilityControl=forced && featAbilities.length ? `<label>Характеристика черты<select id="builder-lineage-feat-ability">${featAbilities.map(key=>`<option value="${key}" ${originDraft.levelOneFeatAbility===key ? "selected" : ""}>${abilities[key]}</option>`).join("")}</select></label>` : "";
    const canReplaceSkill=Boolean(race?.skills?.length);
    const lineageSkill=forced && originDraft.lineageTalent === "skill";
    if (forced && !originDraft.languageChoice) originDraft.languageChoice="Эльфийский";
    const languageControl=`<label>${forced ? "Дополнительный язык" : "Новый язык вместо врождённого"}<input id="builder-origin-language" list="builder-language-list" value="${esc(originDraft.languageChoice || "")}" placeholder="Например, Драконий"><datalist id="builder-language-list">${languageOptions.map(name=>`<option value="${name}">`).join("")}</datalist></label>`;
    const proficiencyControl=!forced ? `<label>Замена владения<input id="builder-origin-proficiency" value="${esc(originDraft.proficiencyChoice || "")}" placeholder="Например, инструменты алхимика"><small>Необязательно: запишется в инструменты и прочие владения.</small></label>` : "";
    $("#builder-origin-box").innerHTML=`<div class="builder-section-head"><div><span class="eyebrow">Tasha's Cauldron of Everything</span><h3>${forced ? "Особая родословная" : "Настройка происхождения"}</h3></div>${forced ? "" : `<label class="compact-toggle"><input id="builder-origin-enabled" type="checkbox" ${enabled ? "checked" : ""}><span>использовать</span></label>`}</div><p class="builder-help">${forced ? "Выбери размер, талант происхождения, характеристику +2, язык и черту первого уровня." : "Перенеси врождённые бонусы характеристик, язык и подходящее владение. Каждый бонус назначается отдельно и не складывается с другим расовым бонусом."}</p>${enabled ? `<div class="origin-ability-grid">${amounts.map((amount,index)=>`<label>Бонус +${amount}<select data-origin-ability="${index}">${Object.entries(abilities).map(([key,name])=>`<option value="${key}" ${selected[index]===key ? "selected" : ""}>${name}</option>`).join("")}</select></label>`).join("")}</div>${forced ? `<div class="builder-form compact"><label>Размер<select id="builder-lineage-size"><option ${originDraft.size!=="Маленький" ? "selected" : ""}>Средний</option><option ${originDraft.size==="Маленький" ? "selected" : ""}>Маленький</option></select></label><label>Талант<select id="builder-lineage-talent"><option value="darkvision" ${originDraft.lineageTalent!=="skill" ? "selected" : ""}>Тёмное зрение 60 фт.</option><option value="skill" ${originDraft.lineageTalent==="skill" ? "selected" : ""}>Владение навыком</option></select></label><label class="wide">Черта 1 уровня<select id="builder-lineage-feat"><option value="">Выбери черту</option>${featOptions}</select></label>${featAbilityControl}</div>` : ""}<div class="builder-form compact origin-custom-proficiencies">${languageControl}${proficiencyControl}</div>${(canReplaceSkill || lineageSkill) ? `<label class="origin-skill-choice">${lineageSkill ? "Навык родословной" : "Замена расового навыка"}<select id="builder-origin-skill"><option value="">Автоматически</option>${skills.map(([key,name])=>`<option value="${key}" ${originDraft.skillChoice===key ? "selected" : ""}>${name}</option>`).join("")}</select></label>` : ""}` : ""}`;
    $("#builder-origin-enabled")?.addEventListener("change",()=>{ readOriginControls(); renderOriginControls(); if(autoStats) applyRecommendedStats(); });
    $("#builder-lineage-talent")?.addEventListener("change",()=>{ readOriginControls(); renderOriginControls(); });
    $("#builder-lineage-feat")?.addEventListener("change",()=>{ readOriginControls(); renderOriginControls(); });
    $$('[data-origin-ability]').forEach(select=>select.addEventListener("change",()=>{ readOriginControls(); const values=$$('[data-origin-ability]').map(item=>item.value); if(new Set(values).size!==values.length){ toast("Расовые бонусы нужно назначить разным характеристикам"); renderOriginControls(); } if(autoStats) applyRecommendedStats(); }));
    ["builder-origin-skill","builder-lineage-size","builder-lineage-feat-ability","builder-origin-language","builder-origin-proficiency"].forEach(id=>$("#"+id)?.addEventListener("change",readOriginControls));
  };

  const applyRecommendedStats = () => {
    const { classKey, raceKey, level } = currentKeys();
    const build = rules.abilityBuild(classKey, raceKey, level, buildOptions());
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


  const roll3d6Set = (abilityKey, abilityName) => new Promise(resolve => {
    socket.emit("scene:dice-roll", {
      x:0, y:0, formula:"3d6", visibility:"private", silent:true,
      label:`${abilityName} · 3d6`
    }, async response => {
      if (!response?.ok) return resolve(null);
      if (response.roll) {
        try { await window.TT_DICE_PHYSICS?.play?.(response.roll); } catch {}
      }
      const set = Array.isArray(response.sets) ? response.sets.find(entry => Number(entry?.sides) === 6) : null;
      const dice = Array.isArray(set?.values) ? set.values.map(Number) : Array.isArray(response.dice) ? response.dice.map(Number) : [];
      resolve({
        key:abilityKey,
        total:Number(response.total) || dice.reduce((sum,value) => sum + value,0),
        dice,
        rollId:response.rollId
      });
    });
  });

  const applySingleRolledStat = (key, roll) => {
    if (!roll) return;
    const { classKey, raceKey, level } = currentKeys();
    const build = rules.abilityBuild(classKey,raceKey,level,buildOptions());
    const input = $(`[data-builder-stat="${key}"]`);
    if (!input) return;
    const raceBonus = Number(build.bonuses[key] || 0);
    const levelBonus = Number(build.levelBonuses[key] || 0);
    const bonus = raceBonus + levelBonus;
    input.value = Math.max(1,Math.min(30,Number(roll.total || 10) + bonus));
    input.dataset.base = Number(roll.total || 10);
    input.dataset.bonus = bonus;
    const additions = [raceBonus ? `+${raceBonus} раса` : "", levelBonus ? `+${levelBonus} уровни` : ""].filter(Boolean).join(" · ");
    const note = $(`[data-builder-stat-note="${key}"]`);
    if (note) note.textContent = `${Number(roll.total || 10)} [${(roll.dice || []).join(", ")}]${additions ? ` · ${additions}` : ""}`;
    autoStats = false;
    refreshStatsSummary();
  };

  const refreshSubclasses = () => {
    const { classKey, level } = currentKeys();
    const unlock = rules.subclassLevel(classKey);
    const options = rules.subclassOptions?.(classKey) || (rules.subclasses[classKey] || []).map(name => ({ name, source:"srd2014" }));
    const selected = $("#builder-subclass").value || (s.classKey === classKey ? s.subclass : "");
    $("#builder-subclass").disabled = level < unlock;
    $("#builder-subclass").innerHTML = level < unlock ? `<option value="">Выбор откроется на ${unlock} уровне</option>` : `<option value="">Без подкласса</option>${options.map(option => `<option value="${esc(option.name)}" ${option.name === selected ? "selected" : ""}>${esc(option.name)}${sourceSuffix(option.source)}</option>`).join("")}`;
  };

  const refreshConcept = () => {
    const { classKey, raceKey, backgroundKey, level } = currentKeys();
    const cls = rules.classes[classKey], race = rules.races[raceKey], background = rules.backgrounds[backgroundKey];
    refreshSubclasses();
    renderOriginControls();
    $("#builder-concept").innerHTML = `<article><small>Класс</small><strong>${cls.name}</strong><span>к${cls.hitDie} HP · ${cls.caster === "none" ? "без магии" : cls.caster === "pact" ? "магия договора" : "заклинатель"}</span></article><article><small>Раса</small><strong>${race.name}</strong><span>${race.speed} фт. · ${race.darkvision ? `тёмное зрение ${race.darkvision}` : "обычное зрение"}</span></article><article><small>Предыстория</small><strong>${background.name}</strong><span>${background.summary}</span></article><article><small>Уровень</small><strong>${level}</strong><span>Мастерство ${signed(rules.proficiency(level))}</span></article>`;
  };

  const refreshStatsSummary = () => {
    const { classKey, level } = currentKeys();
    const stats = Object.fromEntries(statInputs().map(input => [input.dataset.builderStat, Number(input.value || 10)]));
    const base = Object.fromEntries(statInputs().map(input => [input.dataset.builderStat, Number(input.dataset.base || input.value || 10)]));
    const hp = rules.fixedHp(rules.classes[classKey].hitDie, level, modifier(stats.con));
    const pointBuy = rules.pointBuyTotal(base);
    const pointBuyWarning = pointBuy === null ? `<div class="builder-warning" role="status"><b>Нестандартные значения</b><span>Одна из базовых характеристик вышла за диапазон point buy 8–15. Это разрешено — просто проверь выбор с мастером.</span></div>` : pointBuy > 27 ? `<div class="builder-warning" role="status"><b>Лимит превышен на ${pointBuy - 27}</b><span>По стандартному point buy доступно 27 очков. TabaxiTable предупреждает, но не запрещает создать такого персонажа.</span></div>` : "";
    $("#builder-stat-summary").innerHTML = `<span><small>Максимум HP</small><strong>${hp}</strong></span><span><small>Инициатива</small><strong>${signed(modifier(stats.dex))}</strong></span><span><small>Покупка очков</small><strong class="${pointBuy !== null && pointBuy > 27 ? "danger-text" : ""}">${pointBuy === null ? "свой набор" : `${pointBuy}/27`}</strong></span><span><small>Главная характеристика</small><strong>${abilities[rules.statPriorities[classKey][0]]} ${stats[rules.statPriorities[classKey][0]]}</strong></span>${pointBuyWarning}`;
  };

  const refreshSkills = (autoPick = false) => {
    const { classKey, raceKey, backgroundKey } = currentKeys();
    const background = rules.backgrounds[backgroundKey], race = rules.races[raceKey], rule = rules.classSkills[classKey];
    readOriginControls();
    const raceSkills = originDraft.skillChoice ? [originDraft.skillChoice] : (race.skills || []);
    const granted = [...new Set([...(background.skills || []), ...raceSkills])];
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
    readOriginControls();
    const raceSkills = originDraft.skillChoice ? [originDraft.skillChoice] : (race.skills || []);
    const available = [...new Set([...(background.skills || []), ...raceSkills, ...$$('[data-builder-skill]:checked').map(input => input.dataset.builderSkill)])];
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
    readOriginControls();
    const raceSkills = originDraft.skillChoice ? [originDraft.skillChoice] : (race.skills || []);
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
    next.skillProficiencies = [...new Set([...(background.skills || []), ...raceSkills, ...selectedClassSkills])];
    next.expertise = [...new Set(selectedExpertise)];
    next.spellcastingAbility = cls.spellAbility || "";
    next.hitDieSize = cls.hitDie; next.hitDiceMax = level; next.hitDiceCurrent = level; next.hitDicePools = [{ sides:cls.hitDie, total:level, current:level }];
    const recommendedAdvancements = rules.abilityBuild(classKey, raceKey, level, buildOptions()).advancements;
    next.abilityAdvancements = recommendedAdvancements.map(entry => autoStats || instant ? entry : { ...entry, abilityIncreases:{}, manual:true });
    next.originCustomization = { ...originDraft, enabled:Boolean(originDraft.enabled || race.customLineage) };
    if (race.customLineage && !originDraft.levelOneFeatKey) return toast("Для Особой родословной выбери черту первого уровня");
    if (race.customLineage && !originDraft.languageChoice) return toast("Для Особой родословной выбери дополнительный язык");
    const lineageFeat=rules.feats[originDraft.levelOneFeatKey] || null;
    const lineageFeatSkills=[];
    if (race.customLineage && originDraft.levelOneFeatKey) {
      const featAbility=(lineageFeat?.abilityChoices || []).includes(originDraft.levelOneFeatAbility) ? originDraft.levelOneFeatAbility : "";
      if (featAbility) next.stats[featAbility]=Math.min(20,Number(next.stats[featAbility] || 10)+1);
      if (originDraft.levelOneFeatKey === "resilient" && featAbility) next.saveProficiencies=[...new Set([...next.saveProficiencies,featAbility])];
      if (originDraft.levelOneFeatKey === "mobile") next.speed=Number(race.speed || 30)+10;
      if (["skilled","skillexpert"].includes(originDraft.levelOneFeatKey)) {
        const count=originDraft.levelOneFeatKey === "skilled" ? 3 : 1;
        const available=[...(rules.classSkills[classKey]?.options || []),...skills.map(([key])=>key)].filter(key=>!next.skillProficiencies.includes(key));
        lineageFeatSkills.push(...[...new Set(available)].slice(0,count));
        next.skillProficiencies=[...new Set([...next.skillProficiencies,...lineageFeatSkills])];
        if (originDraft.levelOneFeatKey === "skillexpert" && lineageFeatSkills[0]) next.expertise=[...new Set([...next.expertise,lineageFeatSkills[0]])];
      }
      next.feats = [{ key:originDraft.levelOneFeatKey, name:lineageFeat?.name, source:lineageFeat?.source || "srd2014", level:1, ability:featAbility, skillProficiencies:lineageFeatSkills }];
    } else next.feats = [];
    next.armorProficiencies = cls.armor; next.weaponProficiencies = cls.weapons;
    next.toolProficiencies = mergeText(background.tools || "", originDraft.enabled ? originDraft.proficiencyChoice : "");
    const ancestryLanguages=race.customLineage ? `Общий, ${originDraft.languageChoice}` : race.languages;
    next.languages = [ancestryLanguages, originDraft.enabled && !race.customLineage ? originDraft.languageChoice : "", background.languages].filter(value => value && value !== "—").join("; ");
    next.size = race.customLineage ? (originDraft.size || "Средний") : race.size; next.speed = race.customLineage && originDraft.levelOneFeatKey === "mobile" ? Number(race.speed || 30)+10 : race.speed;
    next.darkvision = race.customLineage ? (originDraft.lineageTalent === "darkvision" ? 60 : 0) : race.darkvision;
    next.ancestryTraits = `${race.traits}${originDraft.enabled && !race.customLineage ? " Настройка происхождения Таши включена." : ""}`;
    next.optionalFeatures = $("#builder-tasha-options")?.checked ? (rules.optionalFeaturesFor?.(classKey,level) || []).map(entry=>entry.key) : [];
    next.xp = Math.max(Number(next.xp || 0), rules.xpForLevel(level));
    if ($("#builder-hp").checked || instant) { next.hpMax = rules.fixedHp(cls.hitDie, level, modifier(next.stats.con)) + (race.customLineage && originDraft.levelOneFeatKey === "tough" ? 2*level : 0); next.hpCurrent = next.hpMax; next.hpTemp = 0; }
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
    readOriginControls();
    if (id === "builder-race") originDraft = { enabled:false, flexibleAbilities:[], skillChoice:"", lineageTalent:"darkvision", size:"", languageChoice:"", proficiencyChoice:"", levelOneFeatKey:"", levelOneFeatAbility:"" };
    refreshConcept();
    if (autoStats) applyRecommendedStats();
    if (currentStep === "details") { refreshSkills(true); refreshExpertise(true); refreshReview(); }
  }));
  $("#builder-name").addEventListener("input", refreshReview);
  statInputs().forEach(input => input.addEventListener("input", () => { autoStats = false; input.dataset.base = Number(input.value || 10) - Number(input.dataset.bonus || 0); refreshStatsSummary(); }));
  $("#builder-recommended").addEventListener("click", applyRecommendedStats);
  $$('[data-builder-roll-stat]').forEach(button => button.addEventListener("click", async () => {
    const key = button.dataset.builderRollStat;
    const abilityName = abilities[key] || key.toUpperCase();
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add("is-rolling");
    const oldText = button.textContent;
    button.textContent = "…";
    const result = await roll3d6Set(key,abilityName);
    button.disabled = false;
    button.classList.remove("is-rolling");
    button.textContent = oldText;
    if (!result) return toast(`Не удалось бросить 3d6 для характеристики «${abilityName}»`);
    applySingleRolledStat(key,result);
    toast(`${abilityName}: ${result.total} [${result.dice.join(" + ")}]`);
  }));
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
  rogue:{ armor:"Лёгкие доспехи", tools:"Воровские инструменты", skill:true },
  artificer:{ armor:"Лёгкие и средние доспехи, щиты", tools:"Воровские инструменты, инструменты жестянщика" }
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
      <div class="level-up-grid"><label>Куда вложить уровень<select id="level-up-class">${Object.entries(rules.classes).map(([key, cls]) => `<option value="${key}" ${key === selectedKey ? "selected" : ""}>${cls.name}${sourceSuffix(cls.source)}${hasClass(current,key) ? ` · сейчас ${classLevel(current,key)}` : " · новый класс"}</option>`).join("")}</select></label><label>Прирост HP<select id="level-up-hp"><option value="fixed">Среднее значение</option><option value="roll">Бросить кость хитов</option></select></label></div>
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
    $("#level-up-feat-detail").innerHTML = `<div class="feat-detail-head"><strong>${esc(feat?.name || "Черта")}</strong>${sourceBadge(feat?.source)}</div>${feat?.originalName ? `<small>${esc(feat.originalName)}</small>` : ""}<p>${esc(feat?.summary || "")}</p>${abilityOptions.length ? `<label>Характеристика<select id="level-up-feat-ability">${abilityOptions.map(key => `<option value="${key}">${abilities[key]}</option>`).join("")}</select></label>` : ""}${select.value === "skilled" ? `<div><small>Выбери три навыка</small><div class="level-skill-picks">${availableSkills.map(([key,name]) => `<label><input type="checkbox" data-level-feat-skill="${key}"><span>${name}</span></label>`).join("")}</div></div>` : ""}`;
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
    const availableFeats = Object.entries(rules.feats).filter(([featKey]) => !hasFeat(current, featKey) && rules.featAvailable?.(featKey,current)?.ok !== false);
    panel.innerHTML = `<section class="level-choice"><div class="panel-heading"><div><span class="eyebrow">Выбор развития</span><h3>Характеристики или черта</h3></div><span class="required-badge">обязательно</span></div><div class="advancement-tabs"><button class="active" data-advancement="asi2" type="button">+2 к одной</button><button data-advancement="asi11" type="button">+1 к двум</button><button data-advancement="feat" type="button">Черта</button></div><input id="level-up-advancement-type" type="hidden" value="asi2"><div id="level-up-advancement-detail"></div></section>`;
    const showChoice = type => {
      $("#level-up-advancement-type").value = type;
      $$('[data-advancement]').forEach(button => button.classList.toggle("active", button.dataset.advancement === type));
      const detail = $("#level-up-advancement-detail");
      if (type === "asi2") detail.innerHTML = `<label>Повысить на 2<select id="level-up-ability-a">${Object.entries(abilities).map(([ability,name]) => `<option value="${ability}">${name} · сейчас ${Number(current.stats[ability])}</option>`).join("")}</select></label>`;
      else if (type === "asi11") detail.innerHTML = `<div class="two-col"><label>Первая +1<select id="level-up-ability-a">${Object.entries(abilities).map(([ability,name]) => `<option value="${ability}">${name}</option>`).join("")}</select></label><label>Вторая +1<select id="level-up-ability-b">${Object.entries(abilities).map(([ability,name],index) => `<option value="${ability}" ${index === 1 ? "selected" : ""}>${name}</option>`).join("")}</select></label></div>`;
      else detail.innerHTML = `<label>Выбрать черту<select id="level-up-feat">${availableFeats.map(([featKey,feat]) => `<option value="${featKey}">${feat.name}${sourceSuffix(feat.source)}</option>`).join("")}</select></label><div id="level-up-feat-detail" class="feat-detail"></div>`;
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
    $("#level-up-eligibility").innerHTML = existing ? `<div class="eligibility ok">${classGlyph(key)}<span><strong>Продолжение класса</strong><small>${cls.name} ${classLevel(current,key)} → ${nextClassLevel}</small></span></div>` : `<div class="eligibility ${eligibility.ok ? "ok" : "warn"}">${classGlyph(key)}<span><strong>${eligibility.ok ? "Мультикласс доступен" : "Требования не выполнены — но продолжить можно"}</strong><small>${eligibility.checks.map(check => `${rules.classes[check.key]?.name}: ${check.text} ${check.ok ? "✓" : "✕"}`).join(" · ")}${eligibility.ok ? "" : " · согласуй исключение с мастером"}</small></span></div>`;
    const unlock = rules.subclassLevel(key);
    const oldEntry = classEntries(current).find(entry => entry.key === key);
    const chooseSubclass = nextClassLevel >= unlock && !oldEntry?.subclass;
    const subclassChoices = rules.subclassOptions?.(key) || (rules.subclasses[key] || []).map(name => ({ name, source:"srd2014" }));
    $("#level-up-subclass").innerHTML = chooseSubclass ? `<section class="level-choice"><span class="eyebrow">Подкласс</span><h3>Выбери направление ${cls.name.toLowerCase()}</h3><select id="level-up-subclass-select"><option value="">Выбрать позже</option>${subclassChoices.map(option => `<option value="${esc(option.name)}">${esc(option.name)}${sourceSuffix(option.source)}</option>`).join("")}</select></section>` : "";
    const grants = !existing && multiclassProficiencies[key]?.skill;
    const skillOptions = (rules.classSkills[key]?.options || skills.map(([skillKey]) => skillKey)).filter(skillKey => !current.skillProficiencies.includes(skillKey));
    $("#level-up-skill").innerHTML = grants ? `<section class="level-choice"><span class="eyebrow">Мультикласс</span><h3>Дополнительный навык</h3><select id="level-up-multiclass-skill">${skillOptions.map(skillKey => `<option value="${skillKey}">${skillName(skillKey)}</option>`).join("")}</select></section>` : "";
    renderAdvancement();
    renderLevelExpertise();
    $("#level-up-gains").innerHTML = levelFeaturesMarkup(key,nextClassLevel,classEntries(current).find(entry=>entry.key===key)?.subclass || "",current.optionalFeatures || []) + commonLevelFeaturesMarkup(oldTotal + 1);
    $("#level-up-subclass-select")?.addEventListener("change", updatePreview);
    $("#level-up-multiclass-skill")?.addEventListener("change", () => { renderLevelExpertise(); updatePreview(); });
    $("#level-up-apply").disabled = false;
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
    const { key, cls, existing } = targetData();
    const eligibility = multiclassEligibility(current,key);
    if (!existing && !eligibility.ok && !confirm("Характеристики не соответствуют стандартным требованиям мультикласса. Всё равно получить этот уровень?")) return;
    if ($("#level-up-hp").value === "roll") roll(`1к${cls.hitDie}`,`HP за новый уровень · к${cls.hitDie}`,{mode:"normal"}).then(response=>response.ok?applyLevel(response.total):toast(response.error));
    else applyLevel(Math.floor(cls.hitDie / 2) + 1);
  });
  renderTarget();
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
  if (spell.alwaysPreparedBySubclass) return toast(`«${spell.name}» всегда подготовлено подклассом ${spell.subclassGrantName || "персонажа"}`);
  spell.prepared = !spell.prepared;
  const limit = preparedSpellLimit(next);
  const count = next.spellsList.filter(item => item.prepared && !item.alwaysPreparedBySubclass && Number(item.level) > 0).length;
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
  openModal(spell.name, `<div class="spell-detail"><div class="item-flags"><span>${Number(spell.level) ? `${spell.level} уровень` : "заговор"}</span>${spell.sourceId ? `<span>${esc(sourceShort(spell.sourceId) || spell.sourceId)}</span>` : ""}<span>${esc(spell.school || "школа не указана")}</span>${kind === "healing" ? "<span>лечение</span>" : kind === "damage" ? "<span>урон</span>" : ""}${spell.ritual ? "<span>ритуал</span>" : ""}${spell.concentration ? "<span>концентрация</span>" : ""}</div><dl><dt>Накладывание</dt><dd>${esc(spell.castingTime || "—")}</dd><dt>Дистанция</dt><dd>${esc(spell.range || "—")}</dd><dt>Длительность</dt><dd>${esc(spell.duration || "—")}</dd>${formula ? `<dt>${kind === "healing" ? "Лечение" : "Урон"}</dt><dd>${esc(resolveDiceFormula(formula,sheet))}</dd>` : ""}${spell.upcastParts?.length ? `<dt>За круг выше</dt><dd>+${esc(resolveDiceFormula(formulaFromParts(spell.upcastParts,sheet),sheet))}</dd>` : ""}</dl><p>${esc(spell.description || "Описание не добавлено.")}</p></div><button id="spell-info-close" class="primary">Закрыть</button>`);
  $("#spell-info-close").addEventListener("click", closeModal);
}

function stopConcentration() {
  const next = structuredClone(currentSheet());
  next.concentrationSpellId = ""; next.concentrationSpellName = "";
  saveNow(next, "Концентрация завершена", "Концентрация"); renderSheet();
}

const itemCategoryNames = {
  weapon:"Оружие", armor:"Броня и щиты", ammo:"Боеприпасы", consumable:"Расходники",
  gear:"Снаряжение", focus:"Фокусировки", pack:"Готовые наборы", tool:"Инструменты",
  mount:"Скакуны", vehicle:"Транспорт", magic:"Магические предметы", potion:"Зелья", scroll:"Свитки"
};
function fullItemCatalog() {
  if (itemCatalog2014.length) return itemCatalog2014;
  return [...rules.weapons, ...rules.armor, ...rules.gear].map(item => ({ ...item, catalogCategory:item.type }));
}
function catalogPrice(item) {
  if (!Number(item.costValue || 0)) return "цена не указана";
  const units = { cp:"мм", sp:"см", ep:"эм", gp:"зм", pp:"пм" };
  return `${Number(item.costValue).toLocaleString("ru-RU")} ${units[item.costUnit] || item.costUnit}`;
}
function catalogItemSummary(item) {
  if (item.type === "weapon") return `${String(item.damage || "—").replace(/d/gi,"к")} ${item.damageType || ""}${Number(item.magicBonus || 0) ? ` · +${Number(item.magicBonus)} к атаке и урону` : ""}${item.properties ? ` · ${item.properties}` : ""}`;
  if (item.type === "armor") return `${item.armorType === "shield" ? `+${Number(item.baseAc || 2) + Number(item.magicBonus || 0)} КД` : `КД ${Number(item.baseAc || 0) + Number(item.magicBonus || 0)}`} · ${item.weight || 0} фнт.${item.variantLabel ? ` · основа: ${item.variantLabel}` : ""}`;
  return [itemCategoryNames[item.catalogCategory] || "Предмет", item.rarity, item.quantity > 1 ? `${item.quantity} шт.` : "", item.weight ? `${item.weight} фнт.` : ""].filter(Boolean).join(" · ");
}
function catalogBaseOptions(source) {
  const catalog = fullItemCatalog();
  if (source.magicCategory === "weapon") return catalog.filter(item => item.catalogCategory === "weapon" && item.type === "weapon");
  if (source.magicCategory === "armor") return catalog.filter(item => item.catalogCategory === "armor" && item.type === "armor");
  if (source.magicCategory === "ammunition") return catalog.filter(item => item.catalogCategory === "ammo");
  return [];
}
function buildCatalogInventoryItem(source, baseSource = null) {
  const sourceItem = itemSystem.enrichCatalogItem(source);
  if (!baseSource) return { ...structuredClone(sourceItem), key:undefined, catalogKey:sourceItem.key };
  return structuredClone(itemSystem.buildMagicVariant(sourceItem,baseSource));
}
function createAttackForInventoryItem(sheet, item) {
  if (!item || item.type !== "weapon" || !item.damage || (sheet.attacksList || []).some(attack => attack.sourceItemId === item.id)) return;
  const ability = item.ability === "finesse" ? (modifier(sheet.stats.dex) >= modifier(sheet.stats.str) ? "dex" : "str") : (item.ability || "str");
  const attackParts = [{ id:uuid(), type:"ability", value:ability },{ id:uuid(), type:"proficiency", value:"prof" }];
  const damageParts = [...parseFormulaParts(item.damage,"damage"),{ id:uuid(), type:"ability", value:ability }];
  const magicBonus = Number(item.magicBonus || 0);
  if (magicBonus) {
    attackParts.push({ id:uuid(), type:"flat", value:String(magicBonus) });
    damageParts.push({ id:uuid(), type:"flat", value:String(magicBonus) });
  }
  if (item.extraDamage?.formula && !item.extraDamage.criticalOnly) damageParts.push(...parseFormulaParts(item.extraDamage.formula,"damage"));
  sheet.attacksList.push({
    id:uuid(), sourceItemId:item.id, name:item.name, attackParts, damageParts,
    bonus:formulaFromParts(attackParts,sheet), damage:formulaFromParts(damageParts,sheet), damageType:item.damageType,
    notes:item.extraDamage?.formula ? `Дополнительный урон: ${String(item.extraDamage.formula).replace(/d/gi,"к")} ${item.extraDamage.damageType || ""}${item.extraDamage.criticalOnly ? " при критическом попадании" : ""}.` : "",
    actionCost:"action", rollMode:"inherit"
  });
}
function addCatalogItem(source, baseSource = null) {
  const next = structuredClone(currentSheet());
  const prepared = buildCatalogInventoryItem(source,baseSource);
  const stackable = itemSystem.isStackable(prepared);
  const existing = stackable ? next.inventoryList.find(item => itemSystem.normalizeCatalogKey(item.catalogKey) === prepared.catalogKey && itemSystem.normalizeCatalogKey(item.baseCatalogKey) === itemSystem.normalizeCatalogKey(prepared.baseCatalogKey)) : null;
  if (existing) {
    existing.quantity = Math.max(0,Number(existing.quantity || 0)) + Math.max(1,Number(prepared.quantity || 1));
    saveNow(next, `${prepared.name}: теперь ${existing.quantity}`, "Пополнено снаряжение");
    return existing;
  }
  const value = {
    ...prepared,
    id:uuid(), quantity:Number(prepared.quantity || 1), equipped:false, attuned:false,
    magical:Boolean(prepared.magical), description:prepared.description || prepared.properties || ""
  };
  next.inventoryList.push(value);
  createAttackForInventoryItem(next,value);
  saveNow(next, `${value.name} добавлен`, "Снаряжение");
  return value;
}
function openMagicVariantModal(source) {
  const bases = catalogBaseOptions(source).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"ru"));
  const preferred = itemSystem.preferredBaseKey(source);
  const typeLabel = source.magicCategory === "weapon" ? "оружие" : source.magicCategory === "armor" ? "доспех или щит" : "вид боеприпаса";
  openModal("Собрать магический предмет", `<section class="magic-variant-builder"><div class="item-detail-hero"><span>${itemCombatIcon(source)}</span><div><span class="eyebrow">Магическая основа</span><h3>${esc(source.name)}</h3><small>${esc(source.originalName || "")}</small><p>${esc(source.rarity || "Магический предмет")}${source.magicBonus ? ` · бонус +${Number(source.magicBonus)}` : ""}</p></div></div><label>Выбери ${typeLabel}<select id="magic-base-item">${bases.map(item=>`<option value="${esc(item.key)}" ${item.key===preferred?"selected":""}>${esc(item.name)}${item.type === "weapon" ? ` · ${esc(String(item.damage||"").replace(/d/gi,"к"))}` : item.type === "armor" ? ` · КД ${Number(item.baseAc||0)}` : ` · ${Number(item.quantity||1)} шт.`}</option>`).join("")}</select></label><div id="magic-variant-preview" class="read-only"></div><div class="modal-actions"><button id="magic-variant-add" class="primary">Добавить в рюкзак</button><button id="magic-variant-cancel" class="secondary">Отмена</button></div></section>`);
  const updatePreview = () => {
    const base = bases.find(item=>item.key===$("#magic-base-item").value);
    const value = buildCatalogInventoryItem(source,base);
    $("#magic-variant-preview").innerHTML = `<strong>${esc(value.name)}</strong><br>${esc(catalogItemSummary(value))}<br><small>${esc(value.description || "")}</small>`;
  };
  $("#magic-base-item").addEventListener("change",updatePreview);
  $("#magic-variant-add").addEventListener("click",()=>{
    const base = bases.find(item=>item.key===$("#magic-base-item").value);
    if (!base) return toast("Не выбрана основа предмета");
    const value = addCatalogItem(source,base);
    closeModal(); renderSheet(); toast(`${value?.name || source.name} добавлен`);
  });
  $("#magic-variant-cancel").addEventListener("click",closeModal);
  updatePreview();
}
function requestAddCatalogItem(source, afterAdd = null) {
  if (itemSystem.isMagicVariant(source)) return openMagicVariantModal(source);
  const value = addCatalogItem(source);
  afterAdd?.();
  renderSheet();
  toast(`${value?.name || source.name} добавлен в рюкзак`);
}
function openItemCatalog() {
  const catalog = fullItemCatalog().slice();
  let visibleLimit = 80;
  $("#game-modal").classList.add("library-open", "catalog-modal");
  openModal("Каталог предметов 5e 2014", `<section class="item-catalog-shell">
    <header class="catalog-hero"><div><span class="eyebrow">PHB · XGtE · TCoE</span><h3>Весь арсенал в одном месте</h3><p>Базовое снаряжение, общие магические предметы Занатара, татуировки и фокусировки Таши работают через одну модель.</p></div><strong>${catalog.length}<small>позиций</small></strong></header>
    <div class="item-catalog-tools"><label>Поиск<input id="item-search" type="search" placeholder="Название, свойство, ключ или редкость…" autofocus></label><label>Категория<select id="item-type"><option value="all">Все категории</option>${Object.entries(itemCategoryNames).map(([key,name]) => `<option value="${key}">${name}</option>`).join("")}</select></label><label>Редкость<select id="item-rarity"><option value="all">Любая редкость</option>${["Обычный","Необычный","Редкий","Очень редкий","Легендарный","Артефакт"].map(name => `<option>${name}</option>`).join("")}</select></label><label>Источник<select id="item-source"><option value="all">Все книги</option><option value="srd2014">База 2014</option><option value="xgte">Занатар</option><option value="tcoe">Таша</option></select></label><label>Сортировка<select id="item-sort"><option value="name">По названию</option><option value="category">По категории</option><option value="rarity">По редкости</option><option value="price">По цене</option><option value="weight">По весу</option></select></label></div>
    <div class="catalog-result-head"><span id="item-result-count"></span><small>Поиск проверяет весь каталог и исходные английские названия.</small></div>
    <div id="item-catalog-results" class="item-catalog-results"></div><footer id="item-catalog-more" class="catalog-more"></footer>
  </section>`);
  const matchingItems = () => {
    const query = $("#item-search").value.trim().toLowerCase();
    const type = $("#item-type").value, rarity = $("#item-rarity").value, sourceId = $("#item-source").value, sort = $("#item-sort").value;
    const rarityOrder = { "Обычный":1,"Необычный":2,"Редкий":3,"Очень редкий":4,"Легендарный":5,"Артефакт":6 };
    return catalog.filter(item => {
      const matchesType = type === "all" || item.catalogCategory === type;
      const matchesRarity = rarity === "all" || item.rarity === rarity;
      const matchesSource = sourceId === "all" || (item.sourceId || "srd2014") === sourceId;
      const haystack = `${item.name} ${item.originalName || ""} ${item.key || ""} ${item.properties || ""} ${item.description || ""} ${item.rarity || ""} ${item.source || ""}`.toLowerCase();
      return matchesType && matchesRarity && matchesSource && (!query || haystack.includes(query));
    }).sort((a,b) => {
      if (sort === "category") return String(itemCategoryNames[a.catalogCategory]||"").localeCompare(String(itemCategoryNames[b.catalogCategory]||""),"ru") || String(a.name).localeCompare(String(b.name),"ru");
      if (sort === "rarity") return Number(rarityOrder[a.rarity]||0)-Number(rarityOrder[b.rarity]||0) || String(a.name).localeCompare(String(b.name),"ru");
      if (sort === "price") return Number(a.costValue||0)-Number(b.costValue||0) || String(a.name).localeCompare(String(b.name),"ru");
      if (sort === "weight") return Number(a.weight||0)-Number(b.weight||0) || String(a.name).localeCompare(String(b.name),"ru");
      return String(a.name).localeCompare(String(b.name),"ru");
    });
  };
  const refresh = (reset = false) => {
    if (reset) visibleLimit = 80;
    const found = matchingItems(), shown = found.slice(0,visibleLimit);
    $("#item-result-count").textContent = `Найдено ${found.length} · показано ${shown.length}`;
    $("#item-catalog-results").innerHTML = shown.length ? shown.map(item => {
      const owned = currentSheet().inventoryList.filter(entry => itemSystem.normalizeCatalogKey(entry.catalogKey) === item.key).reduce((sum,entry) => sum + Number(entry.quantity || 0),0);
      const baseNote = itemSystem.isMagicVariant(item) ? `<span>выбор основы</span>` : "";
      return `<article class="catalog-item ${item.magical ? "magical" : ""}"><span class="catalog-item-icon">${itemCombatIcon(item)}</span><div><div class="catalog-item-title"><strong>${esc(item.name)} ${sourceBadge(item.sourceId)}</strong>${item.originalName && item.originalName !== item.name ? `<small>${esc(item.originalName)}</small>` : ""}</div><div class="catalog-badges"><span>${esc(itemCategoryNames[item.catalogCategory] || "Предмет")}</span>${item.rarity ? `<span>${esc(item.rarity)}</span>` : ""}${item.requiresAttunement ? "<span>настройка</span>" : ""}${baseNote}<span>${esc(catalogPrice(item))}</span></div><p>${esc(catalogItemSummary(item))}</p><small class="catalog-source">${esc(item.source || "SRD 5.1")}${item.key ? ` · ${esc(item.key)}` : ""}</small></div><button class="primary" data-catalog-item="${esc(item.key)}">${itemSystem.isMagicVariant(item) ? `Собрать${owned ? `<small>есть ${owned}</small>` : ""}` : owned ? `Ещё +${Number(item.quantity || 1)}<small>есть ${owned}</small>` : "Добавить"}</button></article>`;
    }).join("") : `<div class="catalog-nothing"><span>⌕</span><strong>Ничего не найдено</strong><p>Сбрось редкость, выбери «Все категории» или попробуй часть названия.</p></div>`;
    $("#item-catalog-more").innerHTML = found.length > shown.length ? `<button id="item-show-more" class="secondary" type="button">Показать ещё ${Math.min(80,found.length-shown.length)}<small>осталось ${found.length-shown.length}</small></button>` : found.length ? `<span>Показаны все ${found.length} позиций</span>` : "";
    $$('[data-catalog-item]', $("#item-catalog-results")).forEach(button => button.addEventListener("click", () => {
      const source = catalog.find(item => item.key === button.dataset.catalogItem); if (!source) return;
      requestAddCatalogItem(source,refresh);
    }));
    $("#item-show-more")?.addEventListener("click", () => { visibleLimit += 80; refresh(); });
  };
  $("#item-search").addEventListener("input", () => refresh(true));
  $("#item-type").addEventListener("change", () => refresh(true));
  $("#item-rarity").addEventListener("change", () => refresh(true));
  $("#item-source").addEventListener("change", () => refresh(true));
  $("#item-sort").addEventListener("change", () => refresh(true));
  refresh();
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
    ${state.editMode ? `<section class="vital-exact-editor"><div class="panel-heading"><h3 class="panel-title">Точные значения</h3><small>режим редактирования</small></div><div class="three-col"><label>Текущие HP<input id="hp-exact-current" type="number" min="0" value="${Number(s.hpCurrent || 0)}"></label><label>Максимум<input id="hp-exact-max" type="number" min="1" value="${Number(s.hpMax || 1)}"></label><label>Временные<input id="hp-exact-temp" type="number" min="0" value="${Number(s.hpTemp || 0)}"></label></div><div class="two-col"><label>Успехи смерти<input id="hp-exact-success" type="number" min="0" max="3" value="${Number(s.deathSuccess || 0)}"></label><label>Провалы смерти<input id="hp-exact-fail" type="number" min="0" max="3" value="${Number(s.deathFail || 0)}"></label></div><button id="hp-exact-save" class="secondary" type="button">Сохранить точные HP</button></section>` : ""}
    <label>Количество<input id="hp-amount" type="number" min="0" value="1"></label>
    <div class="modal-actions"><button class="secondary" data-hp-action="damage">Получить урон</button><button class="secondary" data-hp-action="heal">Лечение</button><button class="secondary" data-hp-action="temp">Временные HP</button>${state.editMode ? `<button class="secondary" data-hp-action="max">Изменить максимум</button>` : ""}</div>
    <div class="panel hit-dice-manager"><div class="panel-heading"><h3 class="panel-title">Кости хитов</h3><small>Выбери кость для лечения</small></div><div class="hit-dice-actions">${pools.map(pool => `<button class="secondary" data-rest-die="${Number(pool.sides)}" ${Number(pool.current) <= 0 ? "disabled" : ""}><strong>к${Number(pool.sides)}</strong><small>${Number(pool.current)}/${Number(pool.total)} осталось</small></button>`).join("")}</div><div class="rest-actions"><button class="secondary" data-rest="short-complete">Завершить короткий отдых</button><button class="primary" data-rest="long">Долгий отдых</button></div></div>`);
  $("#hp-exact-save")?.addEventListener("click", () => {
    const sheet = structuredClone(currentSheet());
    sheet.hpMax = Math.max(1, Number($("#hp-exact-max").value) || 1);
    sheet.hpCurrent = Math.max(0, Number($("#hp-exact-current").value) || 0);
    sheet.hpTemp = Math.max(0, Number($("#hp-exact-temp").value) || 0);
    sheet.deathSuccess = Math.max(0, Math.min(3, Number($("#hp-exact-success").value) || 0));
    sheet.deathFail = Math.max(0, Math.min(3, Number($("#hp-exact-fail").value) || 0));
    closeModal(); saveNow(sheet,"HP сохранены","Точные значения здоровья"); renderSheet();
  });
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
    roll(`1к${sides}${signed(con)}`,`Кость хитов к${sides}`,{mode:"normal"}).then(response=>{
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
  const tokenId=(state.room?.scene?.tokens||[]).find(token=>token.playerId===state.selectedId)?.id || ownVttTokenId();
  if (tokenId) return vttDeathSave(tokenId,"public");
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
  const customDieControl = zone => `<div class="lego-custom-die"><span>Свой кубик</span><input data-custom-die-count="${zone}" type="number" min="1" max="100" value="1" aria-label="Количество кубиков"><b>к</b><input data-custom-die-sides="${zone}" type="number" min="2" max="1000" value="6" aria-label="Количество граней"><button type="button" data-custom-die-add="${zone}">Добавить</button></div>`;
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
        <div class="lego-palette">${[4,6,8,10,12].map(sides => palettePiece("damage","dice",`1к${sides}`,{count:1,sides})).join("")}${palettePiece("damage","dice","2к6",{count:2,sides:6})}${damageAbilities}${palettePiece("damage","spell","+ Магия")}${palettePiece("damage","flat","+ Свой бонус",{value:1})}${classPieces}</div>${customDieControl("damage")}
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
  $$('[data-custom-die-add]', $("#modal-content")).forEach(button => button.addEventListener("click", () => {
    const zone = button.dataset.customDieAdd;
    const count = Math.max(1, Math.min(100, Number($(`[data-custom-die-count="${zone}"]`).value) || 1));
    const sides = Math.max(2, Math.min(1000, Number($(`[data-custom-die-sides="${zone}"]`).value) || 6));
    addPart(zone,{ dataset:{ legoType:"dice", legoCount:count, legoSides:sides, legoValue:"" } });
  }));
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

function rollAttackDamage(attack, critical = false, options = {}) {
  const sheet = currentSheet();
  const hasSmite = Array.isArray(attack.damageParts) && attack.damageParts.some(part => part.type === "smite");
  if (hasSmite) return openSmiteDamageModal(attack,critical,options);
  let formula = attackDamageFormula(attack,sheet);
  if (!formula) return;
  formula = resolveDiceFormula(formula,sheet);
  const ammoBonus = activeAmmoMagicBonus(sheet,attack);
  if (ammoBonus) formula += `+${ammoBonus}`;
  if (critical) formula = criticalFormula(formula);
  const sourceItem = (sheet.inventoryList || []).find(item => item.id === attack.sourceItemId);
  if (critical && sourceItem?.extraDamage?.criticalOnly && sourceItem.extraDamage.formula) formula += `+${resolveDiceFormula(sourceItem.extraDamage.formula,sheet)}`;
  return roll(formula, `${critical ? "Критический урон" : "Урон"}: ${attack.name}`, { ...options, mode:"normal" });
}

function openSmiteDamageModal(attack, critical, options = {}) {
  const sheet = currentSheet();
  const ordinary = (sheet.spellSlots || []).filter(slot => Number(slot.total) - Number(slot.used) > 0);
  const pact = sheet.pactSlots || {};
  const pactAvailable = Number(pact.total) - Number(pact.used) > 0;
  const choices = [...ordinary.map(slot => ({ value:`slot:${slot.level}`, level:Number(slot.level), label:`Ячейка ${slot.level} круга · осталось ${Number(slot.total)-Number(slot.used)}` })), ...(pactAvailable ? [{ value:"pact", level:Number(pact.level), label:`Ячейка договора ${pact.level} круга · осталось ${Number(pact.total)-Number(pact.used)}` }] : [])];
  const rollBase = () => {
    const parts = (attack.damageParts || []).filter(part => part.type !== "smite");
    let formula = resolveDiceFormula(formulaFromParts(parts,currentSheet()),currentSheet());
    if (critical) formula = criticalFormula(formula);
    const sourceItem = (currentSheet().inventoryList || []).find(item => item.id === attack.sourceItemId);
    if (critical && sourceItem?.extraDamage?.criticalOnly && sourceItem.extraDamage.formula) formula += `+${resolveDiceFormula(sourceItem.extraDamage.formula,currentSheet())}`;
    closeModal(); roll(formula, `${critical ? "Критический урон" : "Урон"} без кары: ${attack.name}`, { ...options, mode:"normal" });
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
    const sourceItem = (next.inventoryList || []).find(item => item.id === attack.sourceItemId);
    if (critical && sourceItem?.extraDamage?.criticalOnly && sourceItem.extraDamage.formula) formula += `+${resolveDiceFormula(sourceItem.extraDamage.formula,next)}`;
    closeModal(); saveNow(next,"Ячейка потрачена","Божественная кара"); renderSheet();
    roll(formula, `${critical ? "Критическая кара" : "Божественная кара"}: ${attack.name}`, { ...options, mode:"normal" });
  });
}

function openConditionsModal() {
  const sheet = currentSheet();
  openModal("Состояния", `<div class="conditions-list">${conditionNames.map(name => `<label class="condition-chip"><input type="checkbox" value="${esc(name)}" ${sheet.conditions.includes(name) ? "checked" : ""}>${esc(name)}</label>`).join("")}</div>${state.editMode ? `<section class="vital-exact-editor"><div class="panel-heading"><h3 class="panel-title">Истощение</h3><small>режим редактирования</small></div><label>Уровень 0–6<input id="conditions-exhaustion" type="number" min="0" max="6" value="${Math.min(6, Number(sheet.exhaustion || 0))}"></label></section>` : ""}<button id="conditions-save" class="primary">Применить</button>`);
  $("#conditions-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    next.conditions = $$('.condition-chip input:checked', $("#modal-content")).map(input => input.value);
    if ($("#conditions-exhaustion")) next.exhaustion = Math.max(0, Math.min(6, Number($("#conditions-exhaustion").value) || 0));
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

function openOptionalFeaturesManager() {
  const sheet=currentSheet();
  const sections=classEntries(sheet).map(entry=>{
    const features=rules.optionalFeaturesFor?.(entry.key,entry.level,entry.subclass || "") || [];
    if (!features.length) return "";
    return `<section class="option-manager-section"><div class="panel-heading"><h3>${esc(entry.name || rules.classes[entry.key]?.name)}</h3><small>${entry.level} уровень</small></div>${features.map(feature=>`<label class="option-feature-row ${feature.replaces?.length ? "replacement" : ""}"><input type="checkbox" data-optional-feature="${esc(feature.key)}" ${(sheet.optionalFeatures || []).includes(feature.key) ? "checked" : ""}><span><strong>${esc(feature.name)} ${sourceBadge(feature.source)}</strong><small>${esc(feature.summary)}</small>${feature.replaces?.length ? `<i>Заменяет: ${esc(feature.replaces.join(", "))}</i>` : ""}</span></label>`).join("")}</section>`;
  }).join("");
  openModal("Опциональные особенности Таши",`${sections || `<div class="read-only">Для текущих классов и уровней опциональных особенностей пока нет.</div>`}<div class="read-only">Это переключатели правил, а не одноразовый выбор. Их можно изменить позже; лист пересчитает ресурсы и расширенные списки заклинаний.</div><div class="modal-actions"><button id="optional-features-save" class="primary" type="button">Сохранить</button><button id="optional-features-cancel" class="secondary" type="button">Отмена</button></div>`);
  $("#game-modal").classList.add("content-manager-modal");
  $("#optional-features-save")?.addEventListener("click",()=>{
    const next=structuredClone(currentSheet());
    next.optionalFeatures=$$('[data-optional-feature]:checked').map(input=>input.dataset.optionalFeature);
    syncCharacterMechanics(next); closeModal(); saveNow(next,"Опции Таши обновлены","Опциональные особенности"); renderSheet();
  });
  $("#optional-features-cancel")?.addEventListener("click",closeModal);
}

function infusionFitsItem(infusion,item) {
  if (!infusion || !item) return false;
  const key=infusion.key, text=`${item.name || ""} ${item.description || ""} ${item.properties || ""} ${item.slotHint || ""}`.toLowerCase();
  if (key === "enhanced-weapon" || key === "radiant-weapon") return item.type === "weapon";
  if (key === "repeating-shot") return item.type === "weapon" && isRangedWeapon(item);
  if (key === "returning-weapon") return item.type === "weapon" && /метатель|thrown|дротик|копь|топор|молот/i.test(text);
  if (["enhanced-defense","resistant-armor","arcane-propulsion-armor","armor-of-magical-strength","mind-sharpener"].includes(key)) return item.type === "armor" || /доспех|брон|одежд|armor|clothing/i.test(text);
  if (key === "repulsion-shield") return isShieldItem(item);
  if (key === "enhanced-arcane-focus") return item.type === "focus" || /фокус|палочк|жезл|посох|focus|wand|rod|staff/i.test(text);
  if (key === "boots-of-the-winding-path") return /сапог|ботин|обув|boot/i.test(text);
  if (key === "helm-of-awareness") return /шлем|шап|обруч|helm|hat/i.test(text);
  if (key === "spell-refueling-ring") return /кольц|ring/i.test(text);
  if (key === "homunculus-servant") return /самоцвет|кристалл|gem|crystal/i.test(text);
  if (key === "replicate-magic-item") return item.type === "gear" && !item.magical;
  return !item.magical;
}
function openInfusionsManager() {
  const sheet=currentSheet(), level=classLevel(sheet,"artificer");
  if (level < 2) return toast("Инфузии открываются на 2 уровне Изобретателя");
  const knownLimit=level >= 18 ? 12 : level >= 14 ? 10 : level >= 10 ? 8 : level >= 6 ? 6 : 4;
  const activeLimit=level >= 18 ? 6 : level >= 14 ? 5 : level >= 10 ? 4 : level >= 6 ? 3 : 2;
  const available=rules.infusionsFor?.(level) || [];
  const known=new Set(sheet.infusionsKnown || []), activeIds=new Set(sheet.infusedItemIds || []);
  const eligible=(sheet.inventoryList || []).filter(item=>item.infused || !item.magical);
  const infusionOptions=item=>available.filter(infusion=>known.has(infusion.key) && infusionFitsItem(infusion,item)).map(infusion=>`<option value="${esc(infusion.key)}" ${item.infusionKey===infusion.key ? "selected" : ""}>${esc(infusion.name)}</option>`).join("");
  openModal("Инфузии Изобретателя",`<div class="infusion-manager"><div class="infusion-summary"><span><small>Известно</small><strong id="infusions-known-count">${known.size}/${knownLimit}</strong></span><span><small>Активно</small><strong id="infusions-active-count">${activeIds.size}/${activeLimit}</strong></span><span><small>Уровень</small><strong>${level}</strong></span></div><section class="infusion-block"><h3>Известные инфузии</h3><div class="infusion-grid">${available.map(infusion=>`<label class="option-feature-row"><input type="checkbox" data-infusion-known="${esc(infusion.key)}" ${known.has(infusion.key) ? "checked" : ""}><span><strong>${esc(infusion.name)}</strong><small>${esc(infusion.summary)}</small><i>с ${Number(infusion.level || 2)} уровня</i></span></label>`).join("")}</div></section><section class="infusion-block"><h3>Наполненные предметы</h3><p class="builder-help">Инфузия применяется только к немагическому предмету. Числовые бонусы оружия, брони и фокуса лист пересчитывает автоматически.</p><div class="infused-items">${eligible.map(item=>`<div class="infused-item-row"><label class="infused-item-toggle"><input type="checkbox" data-infused-item="${esc(item.id)}" ${activeIds.has(item.id) ? "checked" : ""}><span><strong>${esc(item.name)}</strong><small>${item.type === "weapon" ? "оружие" : item.type === "armor" ? "броня" : "предмет"}</small></span></label><select data-item-infusion="${esc(item.id)}"><option value="">Выбери инфузию</option>${infusionOptions(item)}</select></div>`).join("") || `<div class="read-only">В инвентаре нет подходящих немагических предметов.</div>`}</div></section><div class="modal-actions"><button id="infusions-save" class="primary" type="button">Применить</button><button id="infusions-cancel" class="secondary" type="button">Отмена</button></div></div>`);
  $("#game-modal").classList.add("content-manager-modal");
  const refresh=()=>{
    const selectedKnown=$$('[data-infusion-known]:checked').map(input=>input.dataset.infusionKnown);
    $("#infusions-known-count").textContent=`${selectedKnown.length}/${knownLimit}`;
    $$('[data-item-infusion]').forEach(select=>{
      const item=(sheet.inventoryList || []).find(entry=>entry.id===select.dataset.itemInfusion);
      const previous=select.value;
      const itemToggle=$(`[data-infused-item="${CSS.escape(select.dataset.itemInfusion)}"]`);
      const options=available.filter(infusion=>selectedKnown.includes(infusion.key)&&infusionFitsItem(infusion,item));
      select.innerHTML=`<option value="">${options.length ? "Выбери инфузию" : "Нет доступных инфузий"}</option>${options.map(infusion=>`<option value="${esc(infusion.key)}" ${previous===infusion.key ? "selected" : ""}>${esc(infusion.name)}</option>`).join("")}`;
      if (!options.some(infusion=>infusion.key===select.value)) select.value = "";
      select.disabled=!itemToggle?.checked || !options.length;
    });
    $("#infusions-active-count").textContent=`${$$('[data-infused-item]:checked').length}/${activeLimit}`;
  };
  $$('[data-infusion-known],[data-infused-item]').forEach(input=>input.addEventListener("change",refresh)); refresh();
  $("#infusions-save")?.addEventListener("click",()=>{
    const selectedKnown=$$('[data-infusion-known]:checked').map(input=>input.dataset.infusionKnown);
    const selectedItems=$$('[data-infused-item]:checked').map(input=>input.dataset.infusedItem);
    if (selectedKnown.length > knownLimit) return toast(`Можно знать не больше ${knownLimit} инфузий`);
    if (selectedItems.length > activeLimit) return toast(`Можно наполнить не больше ${activeLimit} предметов`);
    const assignments=new Map();
    for (const itemId of selectedItems) {
      const key=$(`[data-item-infusion="${CSS.escape(itemId)}"]`)?.value;
      if (!key || !selectedKnown.includes(key)) return toast("Для каждого активного предмета выбери известную инфузию");
      if ([...assignments.values()].includes(key)) return toast("Одну и ту же инфузию нельзя держать на двух предметах одновременно");
      assignments.set(itemId,key);
    }
    const next=structuredClone(currentSheet()); next.infusionsKnown=selectedKnown; next.infusedItemIds=selectedItems;
    next.inventoryList=(next.inventoryList || []).map(item=>{
      const key=assignments.get(item.id) || ""; item.baseMagicBonus=Number(item.baseMagicBonus ?? item.magicBonus ?? 0); return applyInfusionToItem(item,key,level);
    });
    syncCharacterMechanics(next); closeModal(); saveNow(next,"Инфузии применены","Инфузии Изобретателя"); renderSheet();
  });
  $("#infusions-cancel")?.addEventListener("click",closeModal);
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
  const item = currentSheet().inventoryList.find(entry => entry.id === id) || { id: uuid(), name: "", quantity: 1, weight: 0, equipped: false, attuned: false, magical: false, combatKind:"auto", useFormula:"", description: "" };
  openModal(id ? "Предмет" : "Новый предмет", `
    <label>Название<input id="item-name" value="${esc(item.name)}"></label>
    ${item.type ? `<div class="read-only">${item.type === "weapon" ? `Оружие · ${esc(item.damage || "")} ${esc(item.damageType || "")}${item.magicBonus ? ` · +${Number(item.magicBonus)}` : ""}` : item.type === "armor" ? `Броня · КД ${Number(item.baseAc || 0) + Number(item.magicBonus || 0)} · ${esc(item.armorType || "")}` : item.magical ? `Магический предмет${item.rarity ? ` · ${esc(item.rarity)}` : ""}${item.requiresAttunement ? " · требует настройки" : ""}` : "Обычное снаряжение"}${item.variantLabel ? `<br><small>Основа: ${esc(item.variantLabel)}</small>` : ""}${item.originalName && item.originalName !== item.name ? `<br><small>${esc(item.originalName)}</small>` : ""}</div>` : ""}
    <div class="two-col"><label>Количество<input id="item-quantity" type="number" min="0" value="${Number(item.quantity)}"></label><label>Вес одного, фнт.<input id="item-weight" type="number" min="0" step="0.1" value="${Number(item.weight)}"></label></div>
    <div class="two-col"><label>Роль в бою<select id="item-combat-kind"><option value="auto" ${!item.combatKind || item.combatKind === "auto" ? "selected" : ""}>Определить автоматически</option><option value="weapon" ${item.combatKind === "weapon" ? "selected" : ""}>Оружие</option><option value="armor" ${item.combatKind === "armor" ? "selected" : ""}>Броня или защита</option><option value="ammo" ${item.combatKind === "ammo" ? "selected" : ""}>Боеприпасы</option><option value="consumable" ${item.combatKind === "consumable" ? "selected" : ""}>Расходник</option><option value="magic" ${item.combatKind === "magic" ? "selected" : ""}>Магический предмет</option><option value="gear" ${item.combatKind === "gear" ? "selected" : ""}>Прочее</option></select></label><label>Бросок при использовании<input id="item-use-formula" value="${esc(item.useFormula || "")}" placeholder="Например, 2к4+2"></label></div>
    <div class="two-col"><label>Состояние при использовании<select id="item-use-condition"><option value="">Не менять</option>${conditionNames.map(name => `<option value="${esc(name)}" ${item.useCondition === name ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label><label class="toggle-row compact"><span><strong>Концентрация</strong><small>Предмет запускает поддерживаемый эффект</small></span><input id="item-use-concentration" type="checkbox" ${item.useConcentration ? "checked" : ""}><i></i></label></div>
    <div class="item-toggle-grid"><label class="toggle-row"><span><strong>В активном комплекте</strong><small>TabaxiTable подберёт подходящий слот</small></span><input id="item-equipped" type="checkbox" ${item.equipped ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Магическая настройка</strong><small>${item.requiresAttunement ? "Этому предмету нужна настройка" : "Стандартный лимит — три предмета"}</small></span><input id="item-attuned" type="checkbox" ${item.attuned ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Магический предмет</strong><small>Показывать золотую метку</small></span><input id="item-magical" type="checkbox" ${item.magical ? "checked" : ""}><i></i></label></div>
    <label>Описание<textarea id="item-description">${esc(item.description)}</textarea></label>
    <div class="modal-actions"><button id="item-save" class="primary">Сохранить</button>${id ? `<button id="item-delete" class="secondary">Удалить</button>` : ""}</div>`);
  $("#item-save").addEventListener("click", () => {
    const next = structuredClone(currentSheet());
    const value = { ...item, id: item.id, name: $("#item-name").value.trim(), quantity: Math.max(0, Number($("#item-quantity").value || 0)), weight: Math.max(0, Number($("#item-weight").value || 0)), equipped: $("#item-equipped").checked, attuned: $("#item-attuned").checked, magical: $("#item-magical").checked, combatKind:$("#item-combat-kind").value, useFormula:$("#item-use-formula").value.trim(), useCondition:$("#item-use-condition").value, useConcentration:$("#item-use-concentration").checked, description: $("#item-description").value.trim() };
    const index = next.inventoryList.findIndex(entry => entry.id === item.id);
    if (index >= 0) next.inventoryList[index] = value; else next.inventoryList.push(value);
    const loadout = ensureCombatLoadout(next), set = activeCombatSet(next);
    loadout.attunementSlots = loadout.attunementSlots.filter(itemId => itemId !== value.id);
    if (value.attuned) loadout.attunementSlots.push(value.id);
    if (value.equipped) {
      const target = recommendedCombatSlots(value)[0] || "belt";
      combatSlotKeys.forEach(key => { if (set.slots[key] === value.id) set.slots[key] = ""; });
      set.slots[target] = value.id;
    } else combatSlotKeys.forEach(key => { if (set.slots[key] === value.id) set.slots[key] = ""; });
    syncActiveEquipmentFlags(next);
    if (next.autoArmorClass) next.ac = calculateAc(next);
    closeModal(); saveNow(next, "Снаряжение обновлено", "Снаряжение"); renderSheet();
    if (value.attuned && next.inventoryList.filter(entry => entry.attuned).length > 3) toast("Настройка сохранена: стандартный лимит 3 превышен");
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
  const customDieControl = zone => `<div class="lego-custom-die"><span>Свой кубик</span><input data-spell-custom-count="${zone}" type="number" min="1" max="100" value="1" aria-label="Количество кубиков"><b>к</b><input data-spell-custom-sides="${zone}" type="number" min="2" max="1000" value="6" aria-label="Количество граней"><button type="button" data-spell-custom-add="${zone}">Добавить</button></div>`;
  const abilityPalette = Object.keys(abilities).map(key => palettePiece("effect","ability",`+ ${abilityAbbreviations[key]}`,{value:key})).join("");
  const knownUpcast = spellUpcastDice[spell.catalogKey] || "";
  $("#game-modal").classList.add("library-open");
  openModal(id ? "Заклинание" : "Новое заклинание", `
    <div class="spell-builder">
      <div class="lego-intro"><span>✦</span><div><strong>Заклинание без формул и скобок</strong><p>Собери урон или лечение из кубиков. Усиление автоматически повторится за каждый круг ячейки выше.</p></div></div>
      <div class="spell-builder-basics"><label>Название<input id="spell-name" value="${esc(spell.name)}" placeholder="Например, Ледяная игла"></label>${casterClasses.length ? `<label>Источник магии<select id="spell-source-class">${casterClasses.map(entry => `<option value="${entry.key}" ${spell.sourceClassKey === entry.key ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}</select></label>` : ""}<label>Что бросаем<select id="spell-roll-kind"><option value="damage" ${spellRollKind(spell) === "damage" ? "selected" : ""}>Урон</option><option value="healing" ${spellRollKind(spell) === "healing" ? "selected" : ""}>Лечение</option><option value="none" ${spellRollKind(spell) === "none" ? "selected" : ""}>Без числового броска</option></select></label></div>
      <div id="spell-roll-builders">
        <section class="formula-builder-card"><div class="formula-builder-head"><div><span class="eyebrow">Основной эффект</span><h3>Что бросить при сотворении?</h3></div><b>кубики + модификатор</b></div>
          <div class="lego-palette">${dicePalette("effect")}${palettePiece("effect","spell","+ Магия")}${palettePiece("effect","flat","+ Число",{value:1})}</div>${customDieControl("effect")}
          <details class="lego-more"><summary>Другой модификатор характеристики</summary><div class="lego-palette compact">${abilityPalette}</div></details>
          <div id="spell-effect-parts" class="lego-zone spell-effect-zone" data-spell-lego-drop="effect"></div><div id="spell-effect-preview" class="formula-preview"></div>
        </section>
        <section class="formula-builder-card upcast-builder"><div class="formula-builder-head"><div><span class="eyebrow">Ячейка выше</span><h3>Что добавить за каждый круг?</h3></div><b>можно оставить пустым</b></div>
          <div class="lego-palette">${dicePalette("upcast")}${palettePiece("upcast","flat","+ Число",{value:1})}</div>${customDieControl("upcast")}
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
  $$('[data-spell-custom-add]', $("#modal-content")).forEach(button => button.addEventListener("click", () => {
    const zone = button.dataset.spellCustomAdd;
    const count = Math.max(1, Math.min(100, Number($(`[data-spell-custom-count="${zone}"]`).value) || 1));
    const sides = Math.max(2, Math.min(1000, Number($(`[data-spell-custom-sides="${zone}"]`).value) || 6));
    addPart(zone,{ dataset:{ spellLegoType:"dice", spellLegoCount:count, spellLegoSides:sides, spellLegoValue:"" } });
  }));
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
  const casterClasses = Object.entries(rules.classes).filter(([,cls]) => cls.caster !== "none").sort((a,b) => a[1].name.localeCompare(b[1].name,"ru"));
  const initialClassKey = currentSheet().classKey || casterClasses[0]?.[0] || "";
  $("#game-modal").classList.add("library-open");
  openModal("Справочник заклинаний", `
    <div class="spell-library-tools">
      <label>Поиск<input id="spell-search" autocomplete="off" placeholder="Огненный шар, призыв, лечение..."></label>
      <label>Уровень<select id="spell-level-filter"><option value="all">Все</option><option value="0">Заговоры</option>${Array.from({length: 9}, (_, i) => `<option value="${i + 1}">${i + 1} уровень</option>`).join("")}</select></label>
      <label>Класс<select id="spell-class-filter"><option value="all">Все классы</option>${casterClasses.map(([key,cls]) => `<option value="${key}" ${key===initialClassKey ? "selected" : ""}>${esc(cls.name)}</option>`).join("")}</select></label>
      <label>Источник<select id="spell-source-filter"><option value="all">Все книги</option><option value="srd2014">База 2014</option><option value="xgte">Занатар</option><option value="tcoe">Таша</option></select></label>
    </div>
    <div id="spell-library-count" class="read-only"></div>
    <div id="spell-library-results" class="spell-library-results"></div>`);
  const refresh = () => {
    const query = $("#spell-search").value.trim().toLocaleLowerCase("ru");
    const level = $("#spell-level-filter").value;
    const classKey = $("#spell-class-filter").value;
    const sourceId = $("#spell-source-filter").value;
    const found = spellCatalog.filter(spell =>
      (level === "all" || Number(level) === Number(spell.level)) &&
      (classKey === "all" || spellAvailableForClass(spell,classKey)) &&
      (sourceId === "all" || (spell.sourceId || "srd2014") === sourceId) &&
      (!query || `${spell.name} ${spell.originalName || ""} ${spell.school} ${spell.description} ${(spell.classes || []).join(" ")}`.toLocaleLowerCase("ru").includes(query))
    );
    $("#spell-library-count").textContent = `Найдено: ${found.length} из ${spellCatalog.length} · уже в гримуаре: ${currentSheet().spellsList.length}`;
    $("#spell-library-results").innerHTML = found.map(spell => {
      const exists = currentSheet().spellsList.some(item => item.catalogKey === spell.key || (item.name === spell.name && Number(item.level) === Number(spell.level)));
      return `
      <article class="spell-card">
        <div><span class="spell-level">${spell.level || "З"}</span></div>
        <div><strong>${esc(spell.name)} ${sourceBadge(spell.sourceId)}</strong>${spell.originalName ? `<small>${esc(spell.originalName)}</small>` : ""}<small>${esc(spell.school)} · ${esc(spell.castingTime)} · ${esc(spell.range)}</small><p>${esc(spell.description)}</p><small>${esc((spell.classes || []).join(", "))}${spell.concentration ? " · концентрация" : ""}${spell.ritual ? " · ритуал" : ""}${spell.summon ? " · призыв" : ""}</small></div>
        <button class="primary" data-catalog-spell="${esc(spell.key)}" ${exists ? "disabled" : ""}>${exists ? "Уже в гримуаре" : "Добавить"}</button>
      </article>`; }).join("") || `<div class="read-only">Ничего не найдено. Попробуй другое слово или фильтр.</div>`;
    $$('[data-catalog-spell]', $("#spell-library-results")).forEach(button => button.addEventListener("click", () => {
      const source = spellCatalog.find(spell => spell.key === button.dataset.catalogSpell);
      const next = structuredClone(currentSheet());
      const selectedClassKey = $("#spell-class-filter").value;
      const sourceClassKey = selectedClassKey !== "all" ? selectedClassKey : currentSheet().classKey;
      next.spellsList.push({ ...structuredClone(source), id:uuid(), catalogKey:source.key, sourceClassKey, prepared:true, rollKind:source.rollKind || (healingSpellKeys.has(source.key) ? "healing" : source.damage ? "damage" : "none") });
      delete next.spellsList.at(-1).key;
      delete next.spellsList.at(-1).classes;
      saveNow(next, "Заклинание добавлено", "Гримуар");
      button.textContent = "Добавлено ✓";
      button.disabled = true;
    }));
  };
  ["spell-search","spell-level-filter","spell-class-filter","spell-source-filter"].forEach(id => {
    const node=$("#"+id); node.addEventListener(id==="spell-search" ? "input" : "change",refresh);
  });
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
    const loadout = ensureCombatLoadout(next);
    loadout.sets.forEach(set => {
      combatSlotKeys.forEach(key => { if (set.slots[key] === id) set.slots[key] = ""; });
      set.quickSlots = set.quickSlots.map(itemId => itemId === id ? "" : itemId);
    });
    loadout.attunementSlots = loadout.attunementSlots.filter(itemId => itemId !== id);
    syncActiveEquipmentFlags(next);
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
  const visibility = options.visibility || "public";
  const finish = response => {
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
    return response;
  };
  return new Promise(resolve => socket.emit("scene:dice-roll", { x:0, y:0, formula, label, mode, visibility, silent:Boolean(options.silent) }, response => {
    if (response?.ok) {
      if (response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
      resolve(finish(response));
      return;
    }
    // Редкие домашние формулы, которые нельзя показать физически, всё ещё работают текстом.
    socket.emit("dice:roll", { formula, label, mode, visibility, silent:Boolean(options.silent) }, fallback => {
      if (!fallback?.ok) { toast(fallback?.error || response?.error || "Не удалось бросить кубики"); resolve(fallback || response); return; }
      showRollPeek(label, fallback);
      resolve(finish(fallback));
    });
  }));
}
function showRollPeek(label, response) {
  const peek = $("#roll-peek");
  const modeLabel = response.mode === "advantage" ? " · преимущество" : response.mode === "disadvantage" ? " · помеха" : "";
  const naturalLabel = response.natural === 20 ? " · КРИТ" : response.natural === 1 ? " · ПРОВАЛ" : "";
  $("span", peek).textContent = `${label}${modeLabel}${naturalLabel}`;
  const diceDetails = (response.detail || []).map(entry => {
    const sign = Number(entry.sign) < 0 ? "−" : "";
    const rolls = (entry.rolls || []).join(", ");
    const prefix = Number(entry.count) > 1 ? `${Number(entry.count)}к${Number(entry.sides)}` : `к${Number(entry.sides)}`;
    return `${sign}${prefix}: [${rolls}]${entry.kept !== undefined ? ` → оставлен ${entry.kept}` : ""}`;
  });
  if (Number(response.modifier)) diceDetails.push(`модификатор ${signed(response.modifier)}`);
  $("small", peek).textContent = diceDetails.join(" · ") || "без кубиков";
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

function diceTraySelectionFromRoll(item) {
  const detail = Array.isArray(item?.detail) ? item.detail : [];
  return detail.filter(entry => Number(entry?.count) > 0 && window.TT_DICE_TRAY?.SIDES?.includes(Number(entry?.sides))).map(entry => ({ sides:Number(entry.sides), count:Number(entry.count) }));
}

function renderDiceTray() {
  const tray = window.TT_DICE_TRAY;
  const root = $("#dice-view");
  if (!tray || !root) return;
  const build = $("#dice-tray-build",root);
  if (build) build.innerHTML = tray.SIDES.map(sides => {
    const count = Number(tray.state.counts[sides] || 0);
    return `<article class="dice-tray-die ${count ? "active" : ""}"><span>к${sides}</span><div><button type="button" data-dice-tray-sub="${sides}" ${count ? "" : "disabled"}>−</button><b>${count}</b><button type="button" data-dice-tray-add="${sides}" ${tray.totalCount() >= tray.MAX_DICE ? "disabled" : ""}>＋</button></div></article>`;
  }).join("");
  const formula = $("#dice-tray-formula",root);
  if (formula) formula.textContent = tray.formula();
  const visibility = $("#dice-tray-visibility",root);
  if (visibility) {
    visibility.textContent = tray.state.visibility === "private" ? "🔒 В закрытую" : "🌐 Всем";
    visibility.classList.toggle("active", tray.state.visibility === "private");
    visibility.setAttribute("aria-pressed", String(tray.state.visibility === "private"));
  }
  const modifier = $("#dice-tray-modifier",root);
  if (modifier && document.activeElement !== modifier) modifier.value = tray.state.modifier;
  const color = $("#dice-player-color",root);
  const ownSheet = state.room?.players?.[state.clientId]?.sheet || {};
  const ownColor = ownSheet.diceColor || "#d3ad6e";
  if (color && document.activeElement !== color) color.value = ownColor;
  const presets = $("#dice-presets",root);
  if (presets) presets.innerHTML = (ownSheet.dicePresets || []).length
    ? ownSheet.dicePresets.map(preset => `<article><button type="button" data-dice-preset-roll="${esc(preset.id)}"><strong>${esc(preset.name)}</strong><small>${preset.visibility === "private" ? "🔒 " : ""}${esc(preset.formula)}</small></button><button type="button" data-dice-preset-remove="${esc(preset.id)}" title="Удалить">×</button></article>`).join("")
    : `<div class="read-only">Сохрани любимую формулу — атака, лечение или любой домашний бросок.</div>`;
  root.querySelectorAll("[data-dice-tray-add]").forEach(button => button.addEventListener("click",()=>{ tray.add(button.dataset.diceTrayAdd,1); renderDiceTray(); }));
  root.querySelectorAll("[data-dice-tray-sub]").forEach(button => button.addEventListener("click",()=>{ tray.add(button.dataset.diceTraySub,-1); renderDiceTray(); }));
  root.querySelectorAll("[data-dice-preset-roll]").forEach(button => button.addEventListener("click",()=>{
    const preset=(ownSheet.dicePresets||[]).find(entry=>entry.id===button.dataset.dicePresetRoll);
    if (!preset) return;
    tray.setVisibility(preset.visibility);
    rollPhysicalFormula(preset.formula);
  }));
  root.querySelectorAll("[data-dice-preset-remove]").forEach(button => button.addEventListener("click",async()=>{
    const dicePresets=(ownSheet.dicePresets||[]).filter(entry=>entry.id!==button.dataset.dicePresetRemove);
    await vttSavePreferences({ dicePresets }); renderDiceTray();
  }));
}

function rollPhysicalDice(selection = window.TT_DICE_TRAY?.selection?.(), modifier = window.TT_DICE_TRAY?.state?.modifier || 0) {
  const dice = Array.isArray(selection) ? selection.filter(entry => Number(entry.count) > 0) : [];
  if (!dice.length) return toast("Добавь хотя бы один кубик");
  const visibility = window.TT_DICE_TRAY?.state?.visibility === "private" ? "private" : "public";
  socket.emit("scene:dice-roll", { x:0, y:0, dice, modifier:Number(modifier) || 0, visibility }, response => {
    if (!response?.ok) return toast(response?.error || "Не удалось бросить кубики");
    if (response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
  });
}
function rollPhysicalFormula(formula) {
  const value = String(formula || "").trim();
  if (!value) return toast("Введи формулу, например 3d6+1");
  const visibility = window.TT_DICE_TRAY?.state?.visibility === "private" ? "private" : "public";
  socket.emit("scene:dice-roll", { x:0, y:0, formula:value, visibility }, response => {
    if (!response?.ok) return toast(response?.error || "Не удалось бросить формулу");
    if (response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
  });
}

$("#dice-tray-modifier")?.addEventListener("input",event=>{ window.TT_DICE_TRAY?.setModifier(event.currentTarget.value); renderDiceTray(); });
$("#dice-tray-visibility")?.addEventListener("click",()=>{ window.TT_DICE_TRAY?.setVisibility(window.TT_DICE_TRAY?.state?.visibility === "private" ? "public" : "private"); renderDiceTray(); });
$("#dice-tray-roll")?.addEventListener("click",()=>rollPhysicalDice());
$("#dice-physical-formula")?.addEventListener("submit", event => { event.preventDefault(); rollPhysicalFormula(new FormData(event.currentTarget).get("formula")); });
$("#dice-save-preset")?.addEventListener("click", async()=>{
  const formula=String($("#dice-physical-formula [name=formula]")?.value||"").trim();
  if (!formula) return toast("Сначала введи формулу");
  const name=prompt("Название пресета",formula);
  if (!name) return;
  const sheet=state.room?.players?.[state.clientId]?.sheet||{};
  const dicePresets=[...(sheet.dicePresets||[]),{ id:uuid(),name:name.trim(),formula,visibility:window.TT_DICE_TRAY?.state?.visibility||"public" }].slice(-20);
  await vttSavePreferences({ dicePresets }); renderDiceTray();
});
$("#dice-clear-visuals")?.addEventListener("click",()=>window.TT_DICE_PHYSICS?.clear?.());
$("#dice-tray-reset")?.addEventListener("click",()=>{ window.TT_DICE_TRAY?.reset(); renderDiceTray(); });
$("#dice-tray-clear")?.addEventListener("click",()=>{ window.TT_DICE_TRAY?.clear(); renderDiceTray(); });
$("#dice-player-color")?.addEventListener("change",async event=>{ await vttSavePreferences({ diceColor:event.currentTarget.value }); renderDiceTray(); });
$("#roll-player-filter")?.addEventListener("change",event=>{ state.rollPlayerFilter=event.currentTarget.value; renderRolls(); });
$("#roll-type-filter")?.addEventListener("change",event=>{ state.rollTypeFilter=event.currentTarget.value; renderRolls(); });

function buildVttCharacterModels() {
  return Object.fromEntries(Object.entries(state.room?.players || {}).map(([playerId, player]) => {
    const sheet = player?.sheet;
    if (!sheet) return [playerId, null];
    const proficiency = effectiveProficiency(sheet);
    const classes = classEntries(sheet);
    const set = activeCombatSet(sheet);
    const equippedIds = new Set([...Object.values(set.slots || {}), ...(set.quickSlots || [])].filter(Boolean));
    const attackList = [
      ...(sheet.attacksList || []).filter(attack => attack.sourceItemId && equippedIds.has(attack.sourceItemId)),
      ...(sheet.attacksList || []).filter(attack => !attack.sourceItemId)
    ].slice(0,8).map(attack => {
      const bonus = resolveBonus(attackBonusFormula(attack,sheet),sheet) + activeAmmoMagicBonus(sheet,attack);
      const safeDamageParts = Array.isArray(attack.damageParts) ? attack.damageParts.filter(part => part.type !== "smite") : [];
      const rawDamage = safeDamageParts.length ? formulaFromParts(safeDamageParts,sheet) : attackDamageFormula(attack,sheet);
      let damageFormula = rawDamage ? resolveDiceFormula(rawDamage,sheet) : "";
      const ammoBonus = activeAmmoMagicBonus(sheet,attack);
      if (damageFormula && ammoBonus) damageFormula += `${ammoBonus > 0 ? "+" : ""}${ammoBonus}`;
      return {
        id:attack.id,
        name:attack.name || "Атака",
        attackFormula:`1к20${bonus ? signed(bonus) : ""}`,
        damageFormula:String(damageFormula || "").replace(/d/gi,"к"),
        damageType:attack.damageType || ""
      };
    });
    const equipmentIds = new Set();
    const equipment = [];
    Object.entries(set.slots || {}).forEach(([slot,itemId]) => {
      const item = combatItem(sheet,itemId);
      if (!item) return;
      equipmentIds.add(item.id);
      equipment.push({ id:item.id, slot, slotLabel:combatSlotMeta[slot]?.label || slot, name:item.name || "Предмет", icon:itemCombatIcon(item), quantity:Number(item.quantity || 0), usable:itemCombatKind(item)==="consumable" || Boolean(item.useFormula), useFormula:item.useFormula || "" });
    });
    const quickItems = (set.quickSlots || []).map((itemId,index) => {
      const item = combatItem(sheet,itemId);
      if (!item) return null;
      equipmentIds.add(item.id);
      const model={ id:item.id,index,name:item.name||`Слот ${index+1}`,icon:itemCombatIcon(item),quantity:Number(item.quantity||0),usable:true,useFormula:item.useFormula||healingPotionFormula(item)||"" };
      equipment.push({ ...model, slot:`quick-${index}`, slotLabel:`Быстрый слот ${index+1}` });
      return model;
    }).filter(Boolean);
    (sheet.inventoryList || []).filter(item => (item.equipped || item.attuned) && !equipmentIds.has(item.id)).forEach(item => {
      equipmentIds.add(item.id);
      equipment.push({ id:item.id, slot:"equipped", slotLabel:item.attuned ? "Настроено" : "Экипировано", name:item.name || "Предмет", icon:itemCombatIcon(item), quantity:Number(item.quantity || 0), usable:itemCombatKind(item)==="consumable" || Boolean(item.useFormula), useFormula:item.useFormula || "" });
    });
    const abilityModels = Object.entries(abilities).map(([key,name]) => {
      const bonus = modifier(sheet.stats?.[key]);
      return { key, name, value:Number(sheet.stats?.[key] || 0), modifier:bonus, formula:`1к20${bonus ? signed(bonus) : ""}` };
    });
    const saveModels = Object.entries(abilities).map(([key,name]) => {
      const proficient = (sheet.saveProficiencies || []).includes(key);
      const bonus = modifier(sheet.stats?.[key]) + (proficient ? proficiency : 0);
      return { key, name, bonus, proficient, formula:`1к20${bonus ? signed(bonus) : ""}` };
    });
    const skillModels = skills.map(([key,name,ability]) => {
      const bonus = getSkillBonus(sheet,key);
      return { key, name, ability, bonus, proficient:(sheet.skillProficiencies || []).includes(key), expertise:(sheet.expertise || []).includes(key), formula:`1к20${bonus ? signed(bonus) : ""}` };
    });
    const spellModels=(sheet.spellsList||[]).filter(spell=>Number(spell.level||0)===0||spell.prepared).map(spell=>{
      const formula=spellRollFormula(spell,Number(spell.level)||0,sheet);
      return { id:spell.id,name:spell.name||"Заклинание",level:Number(spell.level||0),school:spell.school||"",prepared:Boolean(spell.prepared),concentration:Boolean(spell.concentration),ritual:Boolean(spell.ritual),formula:String(formula||"").replace(/d/gi,"к"),kind:spellRollKind(spell),sourceId:spell.sourceId||"srd2014",summon:Boolean(spell.summon),summonProfile:spell.summonProfile||"",description:spell.description||"" };
    }).slice(0,80);
    const resourceModels=(sheet.resources||[]).map(resource=>({ id:resource.id,name:resource.name||"Ресурс",current:Number(resource.current||0),max:Number(resource.max||0),reset:resource.reset||"none" }));
    const spellSlotModels=(sheet.spellSlots||[]).filter(slot=>Number(slot.total)>0).map(slot=>({ level:Number(slot.level),total:Number(slot.total),used:Number(slot.used||0),remaining:Math.max(0,Number(slot.total)-Number(slot.used||0)) }));
    const pactSlotModel=Number(sheet.pactSlots?.total||0)>0?{ level:Number(sheet.pactSlots.level||0),total:Number(sheet.pactSlots.total||0),used:Number(sheet.pactSlots.used||0),remaining:Math.max(0,Number(sheet.pactSlots.total||0)-Number(sheet.pactSlots.used||0)) }:null;
    const companions=(rules.companionMarkersFor?.(sheet) || []).map(entry=>({ ...entry }));
    const combatFeatures=[];
    const rogueLevel=classLevel(sheet,"rogue");
    if (rogueLevel>0) combatFeatures.push({ id:"sneak-attack",name:"Скрытая атака",formula:`${rules.sneakAttackDice(rogueLevel)}к6`,note:"Раз за ход при выполнении условий" });
    (rules.combatFeaturesFor?.(sheet) || []).forEach((feature,index) => combatFeatures.push({ id:`supplement-${index}-${feature.subclass || feature.name}`,name:feature.name,formula:String(feature.formula || "").replace(/d/gi,"к"),note:feature.note || feature.summary || feature.subclass || "",kind:feature.kind || "damage",sourceId:feature.sourceId || "" }));
    return [playerId, {
      playerId,
      name:sheet.characterName || player.name,
      playerName:player.name,
      portraitUrl:sheet.portraitUrl || sheet.tokenImageUrl || "",
      tokenImageUrl:sheet.tokenImageUrl || sheet.portraitUrl || "",
      classSummary:classes.map(entry => `${entry.name || rules.classes[entry.key]?.name || entry.key} ${Number(entry.level || 1)}`).join(" / "),
      race:sheet.race || "",
      background:sheet.background || "",
      level:totalLevel(sheet),
      hp:Number(sheet.hpCurrent || 0),
      hpMax:Number(sheet.hpMax || 0),
      tempHp:Number(sheet.hpTemp || 0),
      ac:calculateAc(sheet),
      speed:Number(sheet.speed || 0),
      initiativeBonus:initiativeBonus(sheet),
      initiativeAdvantage:Boolean(sheet.initiativeAdvantage),
      proficiency,
      passivePerception:passivePerception(sheet),
      inspiration:Boolean(sheet.inspiration),
      abilities:abilityModels,
      saves:saveModels,
      skills:skillModels,
      attacks:attackList,
      equipment,
      quickItems,
      consumables:equipment.filter(item=>item.usable && Number(item.quantity)>0),
      resources:resourceModels,
      spellSlots:spellSlotModels,
      pactSlots:pactSlotModel,
      combatFeatures,
      companions,
      spells:spellModels,
      quickSheet:sheet.vttQuickSheet || { sections:["overview","combat","checks","spells"] },
      notes:(sheet.notesList||[]).slice(0,8).map(note=>({ id:note.id,title:note.title||note.name||"Заметка",text:note.text||note.description||"" })),
      goals:(sheet.goalsList||[]).slice(0,8).map(goal=>({ id:goal.id,title:goal.title||goal.name||"Цель",text:goal.text||goal.description||"" })),
      combatSetName:set.name || "Боевой комплект",
      conditions:[...(sheet.conditions || [])],
      concentration:sheet.concentrationSpellName || "",
      deathSuccess:Number(sheet.deathSuccess || 0),
      deathFail:Number(sheet.deathFail || 0),
      stable:Boolean(sheet.stable)
    }];
  }).filter(([, value]) => value));
}

function vttRollFormula(formula, label = formula, visibility = "public") {
  return new Promise(resolve => socket.emit("scene:dice-roll", { x:0, y:0, formula, label, visibility }, response => {
    if (!response?.ok) toast(response?.error || "Не удалось бросить кубики");
    else if (response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
    resolve(response || { ok:false });
  }));
}
function vttApplyCombat(tokenId, kind, amount, label = "Бой", visibility = "public") {
  return new Promise(resolve => socket.emit("combat:apply", { tokenId, kind, amount, label, visibility }, response => {
    if (!response?.ok) toast(response?.error || "Не удалось применить эффект");
    else if (response.pending) toast("Отправлено ведущему на подтверждение");
    resolve(response || { ok:false });
  }));
}
function vttUseItem(itemId,targetId,visibility="public") {
  return useInventoryItem(itemId,{ targetId,visibility });
}
function vttChangeResource(resourceId,delta) {
  const next=structuredClone(currentSheet()), resource=next.resources.find(item=>item.id===resourceId);
  if (!resource) return Promise.resolve({ ok:false });
  resource.current=Math.max(0,Math.min(Number(resource.max||0),Number(resource.current||0)+Number(delta||0)));
  saveNow(next,`${resource.name}: ${resource.current}/${resource.max}`,"Изменён ресурс"); renderSheet();
  return Promise.resolve({ ok:true,current:resource.current });
}
function vttChangeSpellSlot(level,delta,pact=false) {
  const next=structuredClone(currentSheet());
  if (pact) {
    if (!next.pactSlots) return Promise.resolve({ok:false});
    next.pactSlots.used=Math.max(0,Math.min(Number(next.pactSlots.total||0),Number(next.pactSlots.used||0)+Number(delta||0)));
  } else {
    const slot=next.spellSlots.find(item=>Number(item.level)===Number(level));
    if (!slot) return Promise.resolve({ok:false});
    slot.used=Math.max(0,Math.min(Number(slot.total||0),Number(slot.used||0)+Number(delta||0)));
  }
  saveNow(next,"Изменены ячейки заклинаний","Ячейки заклинаний"); renderSheet();
  return Promise.resolve({ok:true});
}
function vttCastSpell(spellId) { castSpell(spellId); return Promise.resolve({ok:true}); }
function vttPlaceSummon(spellId,playerId) {
  if (state.room?.dmId !== state.clientId) return Promise.resolve({ok:false,error:"Только ведущий ставит маркеры призыва"});
  const player=state.room?.players?.[playerId], spell=(player?.sheet?.spellsList||[]).find(entry=>entry.id===spellId);
  if (!spell?.summon) return Promise.resolve({ok:false,error:"Заклинание призыва не найдено"});
  const caster=(state.room.scene?.tokens||[]).find(token=>token.playerId===playerId);
  const profileNames={ aberration:"Аберрация",beast:"Зверь",celestial:"Небожитель",construct:"Конструкт",elemental:"Элементаль",fey:"Фея",fiend:"Исчадие",shadowspawn:"Теневой дух",undead:"Нежить" };
  const summonedName=profileNames[spell.summonProfile] || spell.name.replace(/^Призыв\s+/i,"") || "Призванное существо";
  const payload={ name:`${summonedName} · ${player?.sheet?.characterName||player?.name||"заклинатель"}`, x:caster?Number(caster.x||0)+1:undefined, y:caster?Number(caster.y||0):undefined, size:["celestial","elemental","fiend"].includes(spell.summonProfile)?2:1, hpMax:1, hp:1, ac:10, color:"#7763a8", showHp:false, showAc:false };
  return new Promise(resolve=>socket.emit("scene:token-add",payload,response=>{
    if (!response?.ok) toast(response?.error||"Не удалось поставить маркер призыва");
    else toast(`Маркер «${summonedName}» добавлен на сцену — характеристики можно настроить по ПКМ`);
    resolve(response||{ok:false});
  }));
}
function vttPlaceCompanion(companionId,playerId) {
  if (state.room?.dmId !== state.clientId) return Promise.resolve({ok:false,error:"Только ведущий ставит спутников"});
  const player=state.room?.players?.[playerId], companion=(rules.companionMarkersFor?.(player?.sheet || {}) || []).find(entry=>entry.id===companionId);
  if (!player || !companion) return Promise.resolve({ok:false,error:"Спутник недоступен"});
  const caster=(state.room.scene?.tokens||[]).find(token=>token.playerId===playerId);
  const ownerName=player.sheet?.characterName || player.name || "герой";
  const tokenName=`${companion.name} · ${ownerName}`;
  const payload={ name:tokenName,x:caster?Number(caster.x||0)+1:undefined,y:caster?Number(caster.y||0):undefined,size:Number(companion.size||1),hpMax:Number(companion.hpMax||1),hp:Number(companion.hpMax||1),ac:Number(companion.ac||10),color:companion.color||"#7763a8",showHp:Number(companion.hpMax||1)>1,showAc:true };
  return new Promise(resolve=>socket.emit("scene:token-add",payload,response=>{
    if (!response?.ok) { toast(response?.error||"Не удалось поставить спутника"); resolve(response||{ok:false}); return; }
    const created=[...(response.scene?.tokens||[])].reverse().find(token=>!token.playerId&&token.name===tokenName);
    if (!created) { toast(`Маркер «${companion.name}» добавлен`); resolve(response); return; }
    const stats={str:{value:10,public:false},dex:{value:10,public:false},con:{value:10,public:false},int:{value:10,public:false},wis:{value:10,public:false},cha:{value:10,public:false}};
    const attacks=companion.attackFormula||companion.damageFormula?[{id:uuid(),name:companion.name,public:false,attackFormula:companion.attackFormula||"",damageFormula:companion.damageFormula||"",damageType:companion.damageType||""}]:[];
    const formulas=[];
    socket.emit("scene:token-update",{tokenId:created.id,badge:companion.kind||"Спутник",badgeColor:companion.color||"#f4c875",npcSheet:{stats,saves:[],checks:[],attacks,formulas}},()=>{});
    toast(`Спутник «${companion.name}» добавлен — параметры можно уточнить по ПКМ`);
    resolve(response);
  }));
}
function vttDeathSave(tokenId,visibility="public") {
  return new Promise(resolve=>socket.emit("combat:death-save",{tokenId,visibility},response=>{
    if (!response?.ok) toast(response?.error||"Не удалось бросить спасбросок");
    else if (response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
    resolve(response||{ok:false});
  }));
}

function vttToggleCondition(tokenId, condition, active) {
  return new Promise(resolve => socket.emit("combat:condition", { tokenId, condition, active }, response => {
    if (!response?.ok) toast(response?.error || "Не удалось изменить состояние");
    resolve(response || { ok:false });
  }));
}
function vttSetConcentration(tokenId, name) {
  return new Promise(resolve => socket.emit("combat:concentration", { tokenId, name }, response => {
    if (!response?.ok) toast(response?.error || "Не удалось изменить концентрацию");
    resolve(response || { ok:false });
  }));
}
function vttOpenSheet(playerId = state.clientId) {
  if (state.room?.players?.[playerId]) state.selectedId = playerId;
  renderAll();
  switchView("sheet");
}
function vttSavePreferences(patch = {}) {
  const sheet = structuredClone(state.room?.players?.[state.clientId]?.sheet || currentSheet());
  if (patch.uiMode) sheet.vttUiMode = patch.uiMode === "assistant" ? "assistant" : "veteran";
  if (Array.isArray(patch.hotbar)) sheet.vttHotbar = patch.hotbar.slice(0,10);
  if (/^#[0-9a-f]{6}$/i.test(String(patch.diceColor || ""))) sheet.diceColor = patch.diceColor;
  if (patch.quickSheet && typeof patch.quickSheet === "object") sheet.vttQuickSheet = patch.quickSheet;
  if (Array.isArray(patch.dicePresets)) sheet.dicePresets = patch.dicePresets.slice(0,20);
  state.room.players[state.clientId].sheet = sheet;
  return new Promise(resolve => socket.emit("sheet:update", { sheet, reason:"Настройки виртуального стола" }, response => {
    if (!response?.ok) toast(response?.error || "Не удалось сохранить панель действий");
    resolve(response || { ok:false });
  }));
}

function bestiarySocketEmit(event,payload={}) {
  return new Promise(resolve=>socket.emit(event,payload,response=>resolve(response||{ok:false})));
}
async function openBestiaryForge(monster) {
  if (!monster || !state.room || state.room.dmId !== state.clientId) return;
  const response=await fetch(`/api/rooms/${state.room.code}/bestiary/${encodeURIComponent(monster.key)}/source`,{method:"POST",headers:{"x-client-id":state.clientId}}).then(result=>result.json());
  if(!response.ok)throw new Error(response.error||"Не удалось подготовить портрет для Кузницы");
  if(response.tokenAsset) window.TT_TOKEN_FORGE?.openAsset?.(response.asset,state.room);
  else window.TT_TOKEN_FORGE?.openBestiary?.(monster,response.asset,state.room);
  state.previousView="bestiary";
  switchView("forge");
}

function renderBestiary() {
  const root=$("#bestiary-view");
  if (!root || !state.room || state.currentView!=="bestiary") return;
  const ctx={room:state.room,clientId:state.clientId,isDm:state.room.dmId===state.clientId};
  if (!window.TT_BESTIARY?.render) { root.innerHTML='<div class="read-only">Модуль Бестиария не загрузился.</div>'; return; }
  window.TT_BESTIARY.render(root,ctx,{
    toast,
    switchView,
    emit:bestiarySocketEmit,
    openForge:openBestiaryForge,
    cameraCenterGrid:()=>window.TT_VTT?.cameraCenterGrid?.()||{x:0,y:0}
  });
}

function forgeSocketEmit(event,payload={}) {
  return new Promise(resolve=>socket.emit(event,payload,response=>resolve(response||{ok:false})));
}
function renderForge() {
  const root=$("#forge-view");
  if (!root || !state.room || state.currentView!=="forge") return;
  const ownPlayer=state.room.players?.[state.clientId];
  const ctx={room:state.room,clientId:state.clientId,isDm:state.room.dmId===state.clientId,ownSheet:ownPlayer?.sheet||{},ownPlayer};
  if (!window.TT_TOKEN_FORGE?.markup) { root.innerHTML='<div class="read-only">Модуль Кузницы не загрузился.</div>'; return; }
  root.innerHTML=window.TT_TOKEN_FORGE.markup(ctx);
  const helpers={
    close:()=>switchView(state.previousView||"sheet"),
    rerender:renderForge,
    toast,
    refreshButtons:disabled=>root.querySelectorAll('[data-forge-save],[data-forge-save-place],[data-forge-apply-character],[data-forge-appearance-update]').forEach(button=>button.disabled=Boolean(disabled)),
    cameraCenterGrid:()=>window.TT_VTT?.cameraCenterGrid?.()||{x:0,y:0},
    emit:forgeSocketEmit,
    switchView
  };
  window.TT_TOKEN_FORGE.bind(root,ctx,helpers);
}

function renderMap() {
  const root = $("#map-view");
  if (!root || !state.room || state.currentView !== "map") {
    window.TT_VTT?.deactivate?.();
    return;
  }
  if (window.TT_VTT?.render) {
    window.TT_VTT.render(root, {
      room: state.room,
      clientId: state.clientId,
      socket,
      toast,
      openModal,
      closeModal,
      switchView,
      characters:buildVttCharacterModels(),
      actions:{ roll:vttRollFormula, openSheet:vttOpenSheet, savePreferences:vttSavePreferences, applyCombat:vttApplyCombat, useItem:vttUseItem, changeResource:vttChangeResource, changeSpellSlot:vttChangeSpellSlot, castSpell:vttCastSpell, placeSummon:vttPlaceSummon, placeCompanion:vttPlaceCompanion, deathSave:vttDeathSave }
    });
    return;
  }
  root.innerHTML = `<div class="read-only">Модуль виртуального стола не загрузился. Обнови страницу с очисткой кеша.</div>`;
}
function renderRolls() {
  if (!state.room) return;
  const all=[...(state.room.rollLog || [])].sort((a,b) => Number(b.at || 0) - Number(a.at || 0));
  const playerSelect=$("#roll-player-filter");
  const typeSelect=$("#roll-type-filter");
  if (playerSelect) {
    const names=[...new Set(all.map(item=>item.player).filter(Boolean))];
    playerSelect.innerHTML=`<option value="all">Все игроки</option>${names.map(name=>`<option value="${esc(name)}" ${state.rollPlayerFilter===name?"selected":""}>${esc(name)}</option>`).join("")}`;
  }
  if (typeSelect) typeSelect.value=state.rollTypeFilter;
  const rolls=all.filter(item=>state.rollPlayerFilter==="all"||item.player===state.rollPlayerFilter).filter(item=>{
    if (state.rollTypeFilter==="all") return true;
    if (state.rollTypeFilter==="private") return item.visibility==="private"||item.visibility==="gm"||item.privateToDm;
    if (state.rollTypeFilter==="physical") return String(item.label||"").includes("на столе");
    if (state.rollTypeFilter==="critical") return item.natural===20||item.natural===1;
    return true;
  });
  $("#roll-log").innerHTML = rolls.length ? rolls.map(item => {
    const privateRoll = item.visibility === "private" || item.visibility === "gm" || item.privateToDm;
    const repeatSelection = diceTraySelectionFromRoll(item);
    const repeat = repeatSelection.length ? `<button type="button" class="roll-repeat" data-repeat-roll="${esc(item.id)}" title="Собрать этот набор снова">↻</button>` : "";
    return `<div class="roll ${item.natural === 20 ? "critical" : item.natural === 1 ? "fumble" : ""} ${privateRoll ? "private-roll" : ""}"><div><strong>${privateRoll ? "🔒 " : ""}${esc(item.player)}</strong><br><span>${esc(item.label)}${item.activity ? ` · ${esc(item.activity)}` : ` · [${(item.dice || []).join(", ")}]${item.modifier ? ` ${signed(item.modifier)}` : ""}${item.mode === "advantage" ? " · преимущество" : item.mode === "disadvantage" ? " · помеха" : ""}`}</span></div><b>${item.total === null ? "✦" : item.total}</b>${repeat}</div>`;
  }).join("") : `<div class="read-only">По этому фильтру бросков нет.</div>`;
  $$('[data-repeat-roll]', $("#roll-log")).forEach(button => button.addEventListener("click",()=>{
    const item = all.find(entry => entry.id === button.dataset.repeatRoll);
    const selection = diceTraySelectionFromRoll(item);
    if (!selection.length) return;
    window.TT_DICE_TRAY?.apply(selection,Number(item.modifier)||0,item.visibility);
    renderDiceTray(); rollPhysicalDice(selection,Number(item.modifier)||0);
  }));
}

function switchView(view) {
  const next=["sheet","dice","map","bestiary","forge"].includes(view) ? view : "sheet";
  if (!["forge","bestiary"].includes(state.currentView) && ["forge","bestiary"].includes(next)) state.previousView=state.currentView;
  state.currentView=next;
  const mapActive=state.currentView==="map", bestiaryActive=state.currentView==="bestiary", forgeActive=state.currentView==="forge";
  $$('[data-view]').forEach(button=>button.classList.toggle("active",button.dataset.view===state.currentView));
  $("#sheet-view").classList.toggle("hidden",state.currentView!=="sheet");
  $("#dice-view").classList.toggle("hidden",state.currentView!=="dice");
  $("#map-view").classList.toggle("hidden",!mapActive);
  $("#bestiary-view").classList.toggle("hidden",!bestiaryActive);
  $("#forge-view").classList.toggle("hidden",!forgeActive);
  $("#room").classList.toggle("map-fullscreen",mapActive);
  $("#room").classList.toggle("bestiary-active",bestiaryActive);
  $("#room").classList.toggle("forge-active",forgeActive);
  document.body.classList.toggle("vtt-active",mapActive);
  $("#roll-peek")?.classList.toggle("hidden",state.currentView==="dice"||bestiaryActive||forgeActive);
  if (mapActive) renderMap();
  else {
    window.TT_VTT?.deactivate?.();
    if (bestiaryActive) renderBestiary();
    else if (forgeActive) renderForge();
    else if (state.currentView==="dice") window.TT_DICE_PHYSICS?.activate?.(roomDiceColors());
  }
}
$$('[data-view]').forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#roll-peek").addEventListener("click", () => switchView("dice"));
$("#own-sheet").addEventListener("click", () => { state.selectedId = state.clientId; renderAll(); switchView("sheet"); });
$("#help-tour")?.addEventListener("click", () => openQuickGuide(false));
$("#copy-code").addEventListener("click", async () => { await navigator.clipboard.writeText(state.room.code); toast("Код скопирован"); });
$("#leave").addEventListener("click", () => {
  document.body.classList.remove("vtt-active");
  $("#room")?.classList.remove("map-fullscreen");
  window.TT_VTT?.deactivate?.();
  localStorage.removeItem("tabaxi-session");
  location.href = location.pathname;
});
$("#modal-close").addEventListener("click", closeModal);
$("#game-modal").addEventListener("click", event => {
  if (event.target === $("#game-modal")) closeModal();
});
$("#game-modal").addEventListener("close", () => $("#game-modal").classList.remove("library-open", "builder-modal", "catalog-modal"));


const hashCode = location.hash.slice(1).toUpperCase();
if (/^[A-Z0-9]{6}$/.test(hashCode)) {
  $('[data-lobby-tab="join"]').click();
  $('#join-form [name="code"]').value = hashCode;
}
