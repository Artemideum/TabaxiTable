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
const tokenForge = fs.readFileSync("public/token-forge.js", "utf8");
const tokenForgeCss = fs.readFileSync("public/token-forge.css", "utf8");
const bestiaryClient = fs.readFileSync("public/bestiary.js", "utf8");

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
  assert.match(app, /const SHEET_SCHEMA_VERSION = 13;/);
  assert.match(app, /sheet\.schemaVersion = SHEET_SCHEMA_VERSION;/);
  assert.doesNotMatch(app, /sheet\.schemaVersion = 8;/);
  assert.match(server, /const SHEET_SCHEMA_VERSION = 13;/);
  assert.match(server, /const SCENE_SCHEMA_VERSION = 12;/);
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


test("Кузница токенов является отдельной вкладкой и поддерживает облики", () => {
  assert.ok(indexHtml.indexOf('/token-forge.js') > -1);
  assert.ok(indexHtml.indexOf('/token-forge.js') < indexHtml.indexOf('/vtt.js'));
  assert.ok(indexHtml.includes('/token-forge.css'));
  assert.match(indexHtml, /data-view="forge"/);
  assert.match(indexHtml, /id="forge-view"/);
  assert.doesNotMatch(vtt, /data-vtt-panel-left="forge"/);
  assert.match(app, /function renderForge\(/);
  assert.match(app, /\["sheet","dice","map","bestiary","forge"\]/);
  assert.match(tokenForge, /Без рамки/);
  assert.match(tokenForge, /data-frame-preset/);
  assert.match(tokenForge, /shapeButton\("raw"/);
  assert.match(tokenForge, /Сохранить новым обликом/);
  assert.match(tokenForge, /data-appearance-activate/);
  assert.match(tokenForge, /character-appearances/);
  assert.match(tokenForge, /replaceAssetId:state\.editingAssetId/);
  assert.match(tokenForgeCss, /\.token-frame-presets/);
  assert.match(tokenForgeCss, /\.token-appearance-card/);
  assert.match(server, /function normalizeTokenRecipe/);
  assert.match(server, /function normalizeTokenAppearance/);
  assert.match(server, /character-appearances/);
  assert.match(server, /syncPlayerTokenVisuals/);
  assert.match(vtt, /appearances/);
});


test("модуль VTT экспортируется без обращения к локальной функции render", () => {
  assert.match(vtt, /let currentCameraCenterGrid = \(\) => \(\{ x:0, y:0 \}\);/);
  assert.match(vtt, /const cameraCenterGrid = \(\) => currentCameraCenterGrid\(\);/);
  assert.match(vtt, /window\.TT_VTT = \{ render, deactivate, cameraCenterGrid \};/);
  assert.doesNotMatch(vtt, /window\.TT_VTT = \{ render, deactivate, currentCameraCenterGrid \};/);
});


test("Кузница явно разделяет новые и обновляемые облики и использует папки библиотеки", () => {
  assert.match(tokenForge, /data-appearance-new/);
  assert.match(tokenForge, /data-forge-appearance-update/);
  assert.match(tokenForge, /saveCharacter\(ctx,helpers,"new"\)/);
  assert.match(tokenForge, /saveCharacter\(ctx,helpers,"update"\)/);
  assert.doesNotMatch(tokenForge, /Новый рецепт/);
  assert.doesNotMatch(tokenForge, /data-forge-reset>/);
  assert.match(tokenForge, /token-forge-folder-select/);
  assert.match(tokenForge, /＋ Создать новую/);
  assert.match(vtt, /id="vtt-folder-new"/);
  assert.match(vtt, /id="vtt-asset-folder-new"/);
});

test("выкованный NPC полностью редактируется на карте одним обновлением", () => {
  assert.match(vtt, /id="vtt-token-ac"/);
  assert.match(vtt, /id="vtt-token-disposition"/);
  assert.match(vtt, /scene:token-update",\{\.\.\.common,\.\.\.hpPayload/);
  assert.match(server, /payload\.disposition/);
  assert.match(server, /has\("ac"\)/);
});


test("Бестиарий подключён отдельным модулем и открывается из VTT", () => {
  assert.ok(indexHtml.includes('/bestiary.css'));
  assert.ok(indexHtml.indexOf('/bestiary.js') > -1);
  assert.ok(indexHtml.indexOf('/bestiary.js') < indexHtml.indexOf('/vtt.js'));
  assert.match(indexHtml, /data-view="bestiary"/);
  assert.match(indexHtml, /id="bestiary-view"/);
  assert.match(app, /function renderBestiary\(/);
  assert.match(app, /\["sheet","dice","map","bestiary","forge"\]/);
  assert.match(vtt, /open-bestiary/);
  assert.match(vtt, /data-vtt-open-bestiary/);
  assert.match(server, /app\.get\("\/api\/bestiary\/catalog"/);
  assert.match(server, /socket\.on\("bestiary:place"/);
});

test("Бестиарий открывает портрет в Кузнице и сохраняет визуал по ключу существа",()=>{
  assert.match(bestiaryClient,/data-bestiary-forge/);
  assert.match(bestiaryClient,/helpers\.openForge/);
  assert.match(app,/function openBestiaryForge\(/);
  assert.match(app,/bestiary\/\$\{encodeURIComponent\(monster\.key\)\}\/source/);
  assert.match(tokenForge,/function openBestiary\(/);
  assert.match(tokenForge,/bestiaryKey:state\.bestiaryKey/);
  assert.match(tokenForge,/state\.bestiaryKey\?"Сохранить токен существа"/);
  assert.match(server,/function syncBestiaryAssetVisuals\(/);
  assert.match(server,/bestiaryVisualAsset\(room,monster\.key\)/);
});
