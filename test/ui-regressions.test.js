const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("public/app.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");
const vtt = fs.readFileSync("public/vtt.js", "utf8");
const vttCss = fs.readFileSync("public/vtt.css", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");
const indexHtml = fs.readFileSync("public/index.html", "utf8");
const contentPacks = fs.readFileSync("public/content-packs.js", "utf8");

test("полный лист фильтрует вкладки до привязки игровых контролов", () => {
  const applyIndex = app.indexOf("applySheetTab();", app.indexOf("function renderSheet"));
  const bindIndex = app.indexOf("if (mine) bindGameControls();", app.indexOf("function renderSheet"));
  assert.ok(applyIndex > -1 && bindIndex > -1 && applyIndex < bindIndex);
  assert.doesNotMatch(app, /\$\$\('\[data-death-pip\]'\s*,\s*root\)/);
  assert.match(app, /\$\$\('\[data-death-pip\]'\s*,\s*\$\('#sheet-view'\)\)/);
});

test("каждая страница быстрого листа имеет собственную прокрутку", () => {
  assert.match(vtt, /querySelectorAll\("\.vtt-character-page"\)/);
  assert.match(vtt, /event\.stopPropagation\(\)/);
  assert.match(vttCss, /\.vtt-floating-panel\.vtt-character-panel[\s\S]*height:calc\(100dvh - 144px\)/);
  assert.match(vttCss, /\.vtt-floating-panel\.vtt-character-panel \.vtt-character-page[\s\S]*overflow-y:scroll/);
  assert.match(vttCss, /scrollbar-gutter:stable/);
});

test("быстрый HP использует единый кегль для текущего и максимального значения", () => {
  assert.match(vtt, /data-vtt-token-hp-prompt[\s\S]*<strong><span>\$\{hp\}<\/span><i>\/<\/i><span>\$\{hpMax\}<\/span><\/strong>/);
  assert.doesNotMatch(vtt, /data-vtt-token-hp-prompt[\s\S]{0,180}<small>\/\$\{hpMax\}<\/small>/);
  assert.match(vttCss, /\.vtt-token-hp-actions strong[\s\S]*font:800 14px\/1 Unbounded/);
});


test("используется только актуальный мастер персонажа", () => {
  assert.match(app, /function openCharacterBuilderV2\(/);
  assert.match(app, /#character-builder[\s\S]{0,120}openCharacterBuilderV2\(false\)/);
  assert.doesNotMatch(app, /function openCharacterBuilder\(\)/);
});

test("версии схем листа и сцены не размазаны магическими числами", () => {
  assert.match(app, /const SHEET_SCHEMA_VERSION = 12;/);
  assert.match(app, /sheet\.schemaVersion = SHEET_SCHEMA_VERSION;/);
  assert.doesNotMatch(app, /sheet\.schemaVersion = 8;/);
  assert.match(server, /const SHEET_SCHEMA_VERSION = 12;/);
  assert.match(server, /const SCENE_SCHEMA_VERSION = 10;/);
  assert.match(server, /normalized\.schemaVersion = SHEET_SCHEMA_VERSION;/);
});


test("контент-паки грузятся до правил и помечаются в интерфейсе", () => {
  assert.ok(indexHtml.indexOf('/content-packs.js') > -1);
  assert.ok(indexHtml.indexOf('/content-packs.js') < indexHtml.indexOf('/rules-5e.js'));
  assert.ok(indexHtml.indexOf('/subclass-spells-xgte-tcoe.js') < indexHtml.indexOf('/rules-5e.js'));
  assert.ok(indexHtml.indexOf('/items-xgte-tcoe.js') > indexHtml.indexOf('/items-5e.js'));
  assert.match(contentPacks, /id:"xgte"/);
  assert.match(contentPacks, /id:"tcoe"/);
  assert.match(app, /rules\.subclassOptions/);
  assert.match(app, /content-source-badge/);
});


test("быстрый лист карты поддерживает книжные призывы", () => {
  assert.match(app, /function vttPlaceSummon\(/);
  assert.match(app, /placeSummon:vttPlaceSummon/);
  assert.match(vtt, /data-vtt-place-summon/);
  assert.match(vtt, /spell\.sourceId==="xgte"/);
  assert.match(vttCss, /\.vtt-character-spell-row\.is-summon/);
});

test("мастер персонажа сохраняет полную настройку происхождения Таши", () => {
  assert.match(app, /builder-origin-language/);
  assert.match(app, /builder-origin-proficiency/);
  assert.match(app, /builder-lineage-feat-ability/);
  assert.match(server, /levelOneFeatAbility/);
  assert.match(server, /languageChoice/);
});


test("гримуар загружает PHB-поддержку и оба книжных каталога", () => {
  assert.match(app, /spells-phb-support-xgte-tcoe\.json/);
  assert.match(app, /spells-xgte-tcoe\.json/);
  assert.match(app, /const \[base, phbSupport, supplements\]/);
  assert.match(app, /const merged = \[\.\.\.subclassStubs, \.\.\.base\.map/);
  assert.match(app, /\.\.\.phbSupport, \.\.\.supplements/);
});

test("быстрый лист умеет ставить спутников и мигрировать старые листы", () => {
  assert.match(app, /function vttPlaceCompanion\(/);
  assert.match(app, /placeCompanion:vttPlaceCompanion/);
  assert.match(vtt, /data-vtt-place-companion/);
  assert.match(vttCss, /\.vtt-character-companion/);
  assert.match(app, /function syncOwnMechanicsOnLoad\(/);
  assert.match(app, /syncOwnMechanicsOnLoad\(\)/);
});

test("инфузии корректно меняют магический и заклинательный бонус", () => {
  assert.match(app, /baseSpellBonus/);
  assert.match(app, /infusion\.key === "enhanced-arcane-focus"/);
  assert.match(app, /if \(!infusion\) \{ item\.magical = Boolean\(item\.baseMagical \|\| item\.baseMagicBonus \|\| item\.baseSpellBonus\)/);
  assert.match(app, /if \(infusion\.key === "enhanced-arcane-focus"\) item\.spellBonus = Math\.max\(item\.spellBonus,improved\)/);
  assert.match(server, /baseSpellBonus/);
  assert.match(server, /baseMagical/);
});


test("контент-менеджеры и строки листа используют обновлённую карточную вёрстку", () => {
  assert.match(app, /class="section-action-buttons"/);
  assert.match(app, /class="resource-title"/);
  assert.match(app, /class="inventory-item-metrics"/);
  assert.match(app, /class="infusion-manager"/);
  assert.match(app, /content-manager-modal/);
  assert.match(app, /select\.disabled=!itemToggle\?\.checked \|\| !options\.length/);
  assert.match(css, /\.resource-controls \{ display:flex/);
  assert.match(css, /\.game-modal\.content-manager-modal/);
  assert.match(vttCss, /quick character sheet consistency/);
  assert.match(vttCss, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(vtt, /class="vtt-character-spell-actions"/);
  assert.match(vttCss, /\.vtt-character-spell-actions \{ display:flex/);
});
