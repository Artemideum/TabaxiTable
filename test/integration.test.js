const test = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 3101;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tabaxi-table-test-"));
let server;

test.before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", chunk => console.error(String(chunk)));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Сервер не запустился")), 5000);
    server.stdout.on("data", chunk => {
      if (String(chunk).includes("TabaxiTable запущен")) { clearTimeout(timeout); resolve(); }
    });
    server.once("exit", code => reject(new Error(`Сервер завершился с кодом ${code}`)));
  });
});

test.after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
  fs.rmSync(DATA_DIR, { recursive:true, force:true });
});

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${PORT}`, { transports:["websocket"], forceNew:true });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emit(socket, event, payload) {
  return new Promise(resolve => socket.emit(event, payload, resolve));
}

function waitFor(socket, event, predicate) {
  const origin = new Error(`waitFor ${event}`).stack;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for ${event}\n${origin}`)), 5000);
    const handler = value => {
      if (predicate(value)) { clearTimeout(timeout); resolve(value); }
      else socket.once(event, handler);
    };
    socket.once(event, handler);
  });
}

test("комната, лист, броски, история и резервная копия работают вместе", async () => {
  const dm = await connect();
  let player = await connect();
  let watcher = null;
  try {
    const health = await fetch(`http://127.0.0.1:${PORT}/health`).then(response => response.json());
    assert.deepEqual(health, { ok:true });
    const index = await fetch(`http://127.0.0.1:${PORT}/`).then(response => response.text());
    assert.match(index, /TabaxiTable/);
    assert.match(index, /roll-peek[^>]*>[\s\S]*?<small>/);
    assert.match(index, /vtt\.js/);
    assert.match(index, /vtt\.css/);
    const catalog = await fetch(`http://127.0.0.1:${PORT}/spells-5e.json`).then(response => response.json());
    assert.equal(catalog.length, 120);
    const itemCatalogScript = await fetch(`http://127.0.0.1:${PORT}/items-5e.js`).then(response => response.text());
    assert.match(itemCatalogScript, /TT_ITEMS_2014/);
    assert.ok(itemCatalogScript.length > 200000);
    const itemSystemScript = await fetch(`http://127.0.0.1:${PORT}/item-system.js`).then(response => response.text());
    assert.match(itemSystemScript, /TT_ITEM_SYSTEM/);
    const vttScript = await fetch(`http://127.0.0.1:${PORT}/vtt.js`).then(response => response.text());
    assert.match(vttScript, /TT_VTT/);
    assert.match(vttScript, /scene:asset-place/);
    assert.match(vttScript, /scene:annotation-add/);
    assert.match(vttScript, /scene:items-transform/);
    assert.match(vttScript, /scene:history-undo/);
    assert.match(vttScript, /beginMarquee/);
    assert.match(vttScript, /vtt-place-own/);
    assert.match(vttScript, /vtt-roll-visibility/);
    assert.match(vttScript, /vtt-combat-attacks/);
    assert.match(vttScript, /data-vtt-check-kind/);
    assert.match(vttScript, /data-vtt-target-token/);
    assert.match(vttScript, /data-vtt-request/);
    assert.match(vttScript, /data-vtt-rolls-tab/);
    assert.match(vttScript, /data-vtt-result-damage/);
    assert.match(vttScript, /vtt-target-select/);
    assert.match(vttScript, /vtt-token-menu/);
    assert.match(vttScript, /data-vtt-spend-action/);
    assert.match(vttScript, /vtt-end-battle/);
    assert.match(vttScript, /Атак доступно/);
    assert.match(vttScript, /ui\.leftPanel === panel \? null : panel/);
    const vttStyle = await fetch(`http://127.0.0.1:${PORT}/vtt.css`).then(response => response.text());
    assert.match(vttStyle, /vtt-viewport/);
    assert.match(vttStyle, /room\.map-fullscreen/);
    assert.match(vttStyle, /body\.vtt-active/);
    assert.match(vttStyle, /game-modal \.vtt-modal-form button/);
    assert.match(vttStyle, /vtt-token-hp/);
    assert.match(vttStyle, /vtt-roll-entry/);
    assert.match(vttStyle, /vtt-combat-quick/);
    assert.match(vttStyle, /vtt-target-card/);
    assert.match(vttStyle, /vtt-check-list/);
    assert.match(vttStyle, /vtt-attack-result/);
    assert.match(vttStyle, /vtt-token-life-state/);
    assert.match(vttStyle, /vtt-menu-result/);
    assert.match(vttStyle, /vtt-init-economy/);
    assert.doesNotMatch(vttStyle, /\.vtt-ping i::before/);

    const created = await emit(dm, "room:create", { name:"Мастер", title:"Тестовая кампания", clientId:"test-dm" });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z2-9]{6}$/);
    assert.equal(created.room.players["test-dm"].sheet.schemaVersion, 8);
    assert.equal(created.room.scene.grid.columns, 24);
    assert.equal(created.room.scene.schemaVersion, 5);
    assert.deepEqual(created.room.scene.annotations, []);
    assert.equal(created.room.scene.tokens.length, 0);
    assert.equal(created.room.scene.initiative.turnState, null);
    assert.deepEqual(created.room.scene.initiative.resources, {});
    assert.equal(created.room.scenes.length, 1);
    assert.equal(created.room.scenes[0].active, true);
    assert.deepEqual(created.room.assets, []);
    assert.equal(created.room.players["test-dm"].sheet.autoProficiency, true);
    assert.equal(created.room.players["test-dm"].sheet.autoSpellSlots, true);
    assert.equal(created.room.players["test-dm"].sheet.autoArmorClass, true);
    assert.equal(created.room.players["test-dm"].sheet.passivePerceptionBonus, 0);
    assert.equal(created.room.players["test-dm"].sheet.stable, false);
    assert.equal(created.room.players["test-dm"].sheet.combatLoadout.sets.length, 3);
    assert.equal(created.room.players["test-dm"].sheet.combatLoadout.sets[0].quickSlots.length, 5);
    assert.equal("sheetHistory" in created.room.players["test-dm"], false);

    const joined = await emit(player, "room:join", { code:created.code, name:"Плут", clientId:"test-player" });
    assert.equal(joined.ok, true);
    assert.equal(Object.keys(joined.room.players).length, 2);
    assert.equal("sheetHistory" in joined.room.players["test-player"], false);

    const sheet = joined.room.players["test-player"].sheet;
    sheet.characterName = "Шёпот";
    sheet.classKey = "rogue";
    sheet.raceKey = "tabaxi";
    sheet.stats.dex = 18;
    sheet.coins.gp = 458;
    sheet.xp = 6500;
    sheet.passivePerceptionBonus = 3;
    sheet.attacksList.push({ id:"bow", name:"Длинный лук +1", bonus:"[DEX]+[PROF]+1", damage:"1d8+[DEX]+1+5d6", damageType:"колющий", actionCost:"action", rollMode:"inherit", attackParts:[{ id:"dex", type:"ability", value:"dex" },{ id:"prof", type:"proficiency", value:"prof" },{ id:"magic", type:"flat", value:"1" }], damageParts:[{ id:"die", type:"dice", count:1, sides:8 },{ id:"damage-dex", type:"ability", value:"dex" },{ id:"sneak", type:"sneak" }] });
    sheet.resources.push({ id:"arrows", name:"Стрелы", current:19, max:20, reset:"none" });
    sheet.inventoryList.push({ id:"cloak", name:"Плащ летучей мыши", quantity:1, weight:3, equipped:true, attuned:true, magical:true });
    sheet.inventoryList.push({ id:"old-bow", catalogKey:"longbow", name:"Старый длинный лук", type:"weapon", quantity:1, weight:2, equipped:true, properties:"боеприпас, двуручное" });
    sheet.inventoryList.push({ id:"old-arrows", catalogKey:"arrows", name:"Стрелы, 20", type:"gear", quantity:1, weight:1, equipped:false });
    sheet.inventoryList.push({ id:"new-arrows", catalogKey:"arrow", name:"Стрелы, 20", type:"gear", catalogCategory:"ammo", combatKind:"ammo", quantity:5, weight:0.05, equipped:false });
    sheet.combatLoadout.sets[0].slots.ammo = "new-arrows";
    sheet.spellsList.push({ id:"acid", catalogKey:"acid-splash", name:"Брызги кислоты", level:0, prepared:true, damage:"2d6", rollKind:"damage", effectParts:[{ id:"acid-die", type:"dice", count:2, sides:6 }], upcastParts:[] });
    sheet.goalsList.push({ id:"goal", text:"Добраться до крепости", done:false });
    sheet.notesList.push({ id:"note", title:"Контакт", text:"Варус" });
    sheet.skillProficiencies.push("perception");
    sheet.saveProficiencies.push("dex");
    sheet.expertise.push("stealth");
    sheet.spellSlots[0] = { level:1, total:4, used:1 };
    sheet.schemaVersion = 4;
    sheet.spellsList.push({ id:"legacy-heal", catalogKey:"cure-wounds", name:"Старое лечение ран", level:1, prepared:true, damage:"1d8+[SPELL]" });
    sheet.attacksList.push({ id:"legacy-dagger", name:"Старый кинжал", bonus:"[DEX]+[PROF]", damage:"1d4+[DEX]" });

    const roomUpdate = waitFor(dm, "room:state", room => room.players["test-player"]?.sheet?.coins?.gp === 458);
    const saved = await emit(player, "sheet:update", { sheet, reason:"Первый полноценный лист" });
    assert.equal(saved.ok, true);
    const updatedRoom = await roomUpdate;
    assert.equal(updatedRoom.players["test-player"].sheet.characterName, "Шёпот");
    assert.equal(updatedRoom.players["test-player"].sheet.schemaVersion, 8);
    assert.equal(updatedRoom.players["test-player"].sheet.xp, 6500);
    assert.equal(updatedRoom.players["test-player"].sheet.passivePerceptionBonus, 3);
    assert.deepEqual(updatedRoom.players["test-player"].sheet.classes.map(entry => [entry.key, entry.level]), [["rogue",1]]);
    assert.equal(updatedRoom.players["test-player"].sheet.levelProgression.length, 1);
    assert.equal(updatedRoom.players["test-player"].sheet.inventoryList[0].attuned, true);
    assert.deepEqual(updatedRoom.players["test-player"].sheet.combatLoadout.attunementSlots, ["cloak"]);
    assert.equal(updatedRoom.players["test-player"].sheet.combatLoadout.sets[0].slots.mainHand, "old-bow");
    assert.equal(updatedRoom.players["test-player"].sheet.combatLoadout.sets[0].slots.ammo, "old-arrows");
    assert.equal(updatedRoom.players["test-player"].sheet.inventoryList[2].catalogKey, "arrow");
    assert.equal(updatedRoom.players["test-player"].sheet.inventoryList[2].quantity, 25);
    assert.equal(updatedRoom.players["test-player"].sheet.inventoryList.length, 3);
    assert.deepEqual(updatedRoom.players["test-player"].sheet.expertise, ["stealth"]);
    assert.deepEqual(updatedRoom.players["test-player"].sheet.attacksList[0].attackParts.map(part => part.type), ["ability","proficiency","flat"]);
    assert.deepEqual(updatedRoom.players["test-player"].sheet.attacksList[0].damageParts.map(part => part.type), ["dice","ability","sneak"]);
    assert.equal(updatedRoom.players["test-player"].sheet.attacksList[0].actionCost, "action");
    assert.equal(updatedRoom.players["test-player"].sheet.spellsList[0].rollKind, "damage");
    assert.deepEqual(updatedRoom.players["test-player"].sheet.spellsList[0].effectParts.map(part => part.type), ["dice"]);
    assert.equal(updatedRoom.players["test-player"].sheet.spellsList[1].damage, "1d8+[SPELL]");
    assert.deepEqual(updatedRoom.players["test-player"].sheet.spellsList[1].effectParts, []);
    assert.equal(updatedRoom.players["test-player"].sheet.attacksList[1].actionCost, "action");
    assert.equal("sheetHistory" in updatedRoom.players["test-player"], false);

    const multiclass = structuredClone(updatedRoom.players["test-player"].sheet);
    multiclass.classes = [
      { key:"rogue", name:"Плут", subclass:"Вор", level:2, hitDie:8 },
      { key:"wizard", name:"Волшебник", subclass:"Школа иллюзии", level:2, hitDie:6, spellAbility:"int" }
    ];
    multiclass.levelProgression = [
      { level:1, classKey:"rogue", classLevel:1 },
      { level:2, classKey:"rogue", classLevel:2 },
      { level:3, classKey:"wizard", classLevel:1 },
      { level:4, classKey:"wizard", classLevel:2 }
    ];
    multiclass.hitDicePools = [{ sides:8, total:2, current:1 }, { sides:6, total:2, current:2 }];
    const multiclassUpdate = waitFor(dm, "room:state", room => room.players["test-player"]?.sheet?.level === 4);
    assert.equal((await emit(player, "sheet:update", { sheet:multiclass, reason:"Проверка мультикласса" })).ok, true);
    const multiclassRoom = await multiclassUpdate;
    assert.equal(multiclassRoom.players["test-player"].sheet.level, 4);
    assert.deepEqual(multiclassRoom.players["test-player"].sheet.classes.map(entry => [entry.key, entry.level]), [["rogue",2],["wizard",2]]);
    assert.equal(multiclassRoom.players["test-player"].sheet.hitDiceCurrent, 3);

    const changed = structuredClone(multiclassRoom.players["test-player"].sheet);
    changed.characterName = "Случайно испорчено";
    assert.equal((await emit(player, "sheet:update", { sheet:changed, reason:"Перед изменением имени" })).ok, true);
    const history = await emit(player, "sheet:history", {});
    assert.equal(history.ok, true);
    const goodRevision = history.history.find(item => item.label === "Перед изменением имени");
    assert.ok(goodRevision);
    const restored = await emit(player, "sheet:restore", { revisionId:goodRevision.id });
    assert.equal(restored.ok, true);
    assert.equal(restored.sheet.characterName, "Шёпот");

    const combatSheet = structuredClone(restored.sheet);
    combatSheet.classes = [{ key:"fighter", name:"Воин", subclass:"Чемпион", level:5, hitDie:10 }];
    combatSheet.classKey = "fighter";
    combatSheet.className = "Воин";
    combatSheet.level = 5;
    combatSheet.levelProgression = Array.from({ length:5 }, (_,index) => ({ level:index+1, classKey:"fighter", classLevel:index+1 }));
    const fighterReady = waitFor(dm, "room:state", room => room.players["test-player"]?.sheet?.classes?.[0]?.key === "fighter" && room.players["test-player"].sheet.level === 5);
    assert.equal((await emit(player, "sheet:update", { sheet:combatSheet, reason:"Проверка экономики хода" })).ok, true);
    await fighterReady;

    const ownTokenForDm = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.playerId === "test-player"));
    const ownTokenPlaced = await emit(player, "scene:token-add", { playerId:"test-player" });
    assert.equal(ownTokenPlaced.ok, true);
    const ownTokenRoom = await ownTokenForDm;
    const ownPlacedToken = ownTokenRoom.scene.tokens.find(token => token.playerId === "test-player");
    assert.equal(ownPlacedToken.name, "Шёпот");
    assert.equal(ownPlacedToken.initiativeBonus, 4);
    assert.equal((await emit(player, "scene:token-add", { playerId:"test-dm" })).ok, false);

    const damagedOwnState = waitFor(dm, "room:state", room => room.players["test-player"].sheet.hpCurrent === 7);
    const damagedOwn = await emit(player, "combat:apply", { tokenId:ownPlacedToken.id, kind:"damage", amount:3, label:"Самопроверка" });
    assert.equal(damagedOwn.ok, true);
    assert.equal(damagedOwn.pending, false);
    assert.equal((await damagedOwnState).players["test-player"].sheet.hpCurrent, 7);
    const conditionState = waitFor(dm, "room:state", room => room.players["test-player"].sheet.conditions.includes("Отравлен"));
    assert.equal((await emit(player, "combat:condition", { tokenId:ownPlacedToken.id, condition:"Отравлен", active:true })).ok, true);
    assert.ok((await conditionState).players["test-player"].sheet.conditions.includes("Отравлен"));

    const advantage = await emit(player, "dice:roll", { formula:"1d20+7", label:"Скрытность", mode:"advantage" });
    assert.equal(advantage.ok, true);
    assert.equal(advantage.mode, "advantage");
    assert.equal(advantage.detail[0].rolls.length, 2);
    assert.equal(advantage.modifier, 7);
    assert.equal(advantage.natural, Math.max(...advantage.detail[0].rolls));
    assert.equal(advantage.total, advantage.natural + 7);

    const customDie = await emit(player, "dice:roll", { formula:"3d137+2", label:"Кастомный кубик" });
    assert.equal(customDie.ok, true);
    assert.equal(customDie.detail[0].count, 3);
    assert.equal(customDie.detail[0].sides, 137);
    assert.equal(customDie.detail[0].rolls.length, 3);
    assert.equal(customDie.modifier, 2);

    const invalidRoll = await emit(player, "dice:roll", { formula:"101d6", label:"Слишком много" });
    assert.equal(invalidRoll.ok, false);

    const partySceneUpdate = waitFor(player, "room:state", room => room.scene.tokens.some(token => token.playerId === "test-dm") && room.scene.tokens.some(token => token.playerId === "test-player"));
    const partyAdded = await emit(dm, "scene:party-add", {});
    assert.equal(partyAdded.ok, true);
    assert.equal(partyAdded.added, 1);
    const partyRoom = await partySceneUpdate;
    const playerToken = partyRoom.scene.tokens.find(token => token.playerId === "test-player");
    assert.ok(playerToken);
    assert.equal(playerToken.name, "Шёпот");
    assert.equal(playerToken.initiativeBonus, 4);

    const sceneSettingsUpdate = waitFor(player, "room:state", room => room.scene.name === "Подземелье" && room.scene.grid.snap === false);
    assert.equal((await emit(dm, "scene:settings", { name:"Подземелье", grid:{ columns:30, rows:20, cellSize:48, visible:true, snap:false } })).ok, true);
    await sceneSettingsUpdate;

    const movedUpdate = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.id === playerToken.id && token.x === 2.4 && token.y === 3.7));
    assert.equal((await emit(player, "scene:token-move", { tokenId:playerToken.id, x:2.4, y:3.7 })).ok, true);
    const movedRoom = await movedUpdate;
    assert.equal(movedRoom.scene.tokens.find(token => token.id === playerToken.id).x, 2.4);

    const initiativeUpdate = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.id === playerToken.id && token.initiative !== null));
    const initiative = await emit(player, "initiative:roll", { tokenId:playerToken.id });
    assert.equal(initiative.ok, true);
    assert.ok(initiative.total >= 5 && initiative.total <= 24);
    const initiativeRoom = await initiativeUpdate;
    assert.equal(initiativeRoom.scene.initiative.active, true);
    assert.equal(initiativeRoom.scene.initiative.currentTokenId, playerToken.id);
    assert.equal(initiativeRoom.scene.initiative.turnState.tokenId, playerToken.id);
    assert.equal(initiativeRoom.scene.initiative.turnState.actions, 1);
    assert.equal(initiativeRoom.scene.initiative.turnState.bonusActions, 1);
    assert.equal(initiativeRoom.scene.initiative.turnState.attacksPerAction, 2);
    assert.equal(initiativeRoom.scene.initiative.resources[playerToken.id].actionSurge, 1);

    const firstAttack = await emit(player, "combat:spend-action", { tokenId:playerToken.id, cost:"attack", label:"Первая атака" });
    assert.equal(firstAttack.ok, true);
    assert.equal(firstAttack.turnState.actions, 0);
    assert.equal(firstAttack.turnState.attacksRemaining, 1);
    const secondAttack = await emit(player, "combat:spend-action", { tokenId:playerToken.id, cost:"attack", label:"Дополнительная атака" });
    assert.equal(secondAttack.ok, true);
    assert.equal(secondAttack.turnState.attacksRemaining, 0);
    assert.equal((await emit(player, "combat:spend-action", { tokenId:playerToken.id, cost:"attack", label:"Лишняя атака" })).ok, false);
    const surge = await emit(player, "combat:action-surge", { tokenId:playerToken.id });
    assert.equal(surge.ok, true);
    assert.equal(surge.turnState.actions, 1);
    assert.equal(surge.resources.actionSurge, 0);
    assert.equal((await emit(player, "combat:spend-action", { tokenId:playerToken.id, cost:"bonus", label:"Второе дыхание" })).ok, true);
    assert.equal((await emit(player, "combat:spend-action", { tokenId:playerToken.id, cost:"bonus", label:"Ещё бонус" })).ok, false);

    const dmToken = partyRoom.scene.tokens.find(token => token.playerId === "test-dm");
    assert.ok(dmToken);
    assert.equal((await emit(dm, "initiative:set", { tokenId:dmToken.id, value:30 })).ok, true);
    assert.equal((await emit(dm, "initiative:next", {})).ok, true);
    const reactionWhileWaiting = await emit(player, "combat:spend-action", { tokenId:playerToken.id, cost:"reaction", label:"Провоцированная атака" });
    assert.equal(reactionWhileWaiting.ok, true);
    assert.equal(reactionWhileWaiting.turnState.tokenId, dmToken.id);
    assert.equal(reactionWhileWaiting.resources.reactionAvailable, false);
    assert.equal((await emit(player, "combat:spend-action", { tokenId:playerToken.id, cost:"action", label:"Не в свой ход" })).ok, false);

    const hiddenForDm = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.name === "Скрытый гоблин"));
    const hiddenForPlayer = waitFor(player, "room:state", room => room.scene.name === "Подземелье" && !room.scene.tokens.some(token => token.name === "Скрытый гоблин"));
    const hiddenAdded = await emit(dm, "scene:token-add", { name:"Скрытый гоблин", hidden:true, initiativeBonus:2 });
    assert.equal(hiddenAdded.ok, true);
    const hiddenToken = hiddenAdded.scene.tokens.find(token => token.name === "Скрытый гоблин");
    assert.ok(hiddenToken);
    assert.ok((await hiddenForDm).scene.tokens.some(token => token.name === "Скрытый гоблин"));
    assert.equal((await hiddenForPlayer).scene.tokens.some(token => token.name === "Скрытый гоблин"), false);

    const hiddenRollForDm = waitFor(dm, "room:state", room => room.rollLog.some(entry => entry.label === "Инициатива · Скрытый гоблин"));
    const hiddenRollForPlayer = waitFor(player, "room:state", room => room.scene.name === "Подземелье");
    assert.equal((await emit(dm, "initiative:roll", { tokenId:hiddenToken.id })).ok, true);
    assert.ok((await hiddenRollForDm).rollLog.some(entry => entry.label === "Инициатива · Скрытый гоблин"));
    assert.equal((await hiddenRollForPlayer).rollLog.some(entry => entry.label === "Инициатива · Скрытый гоблин"), false);

    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const assetState = waitFor(dm, "room:state", room => room.assets.some(asset => asset.name === "Красный гоблин"));
    const uploadedAsset = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${created.code}/assets`, {
      method:"POST",
      headers:{ "content-type":"application/json", "x-client-id":"test-dm" },
      body:JSON.stringify({ name:"Красный гоблин", fileName:"goblin.png", category:"token", dataUrl:tinyPng, width:1, height:1 })
    }).then(response => response.json());
    assert.equal(uploadedAsset.ok, true);
    assert.match(uploadedAsset.asset.url, new RegExp(`/assets/${created.code}/`));
    const assetRoom = await assetState;
    assert.equal(assetRoom.assets[0].usageCount, 0);
    const assetFile = await fetch(`http://127.0.0.1:${PORT}${uploadedAsset.asset.url}`);
    assert.equal(assetFile.status, 200);
    assert.equal(assetFile.headers.get("content-type"), "image/png");

    const placedState = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.assetId === uploadedAsset.asset.id));
    const placed = await emit(dm, "scene:asset-place", { assetId:uploadedAsset.asset.id, x:-2, y:4, count:3, initiativeBonus:2 });
    assert.equal(placed.ok, true);
    assert.equal(placed.createdIds.length, 3);
    const placedRoom = await placedState;
    assert.equal(placedRoom.scene.tokens.filter(token => token.assetId === uploadedAsset.asset.id).length, 3);
    assert.deepEqual(placedRoom.scene.tokens.filter(token => token.assetId === uploadedAsset.asset.id).map(token => token.name), ["Красный гоблин 1","Красный гоблин 2","Красный гоблин 3"]);
    assert.equal(placedRoom.assets.find(asset => asset.id === uploadedAsset.asset.id).usageCount, 3);
    const combatNpc = placedRoom.scene.tokens.find(token => token.assetId === uploadedAsset.asset.id);
    const npcReadyState = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.id === combatNpc.id && token.hpMax === 10 && token.hp === 10));
    assert.equal((await emit(dm, "scene:token-update", { tokenId:combatNpc.id, hpMax:10, hp:10, ac:13 })).ok, true);
    await npcReadyState;
    const hitForPlayer = await emit(player, "combat:resolve-hit", { targetId:combatNpc.id, total:13, natural:10 });
    assert.equal(hitForPlayer.ok, true);
    assert.equal(hitForPlayer.hit, true);
    assert.equal("targetAc" in hitForPlayer, false);
    const hitForDm = await emit(dm, "combat:resolve-hit", { targetId:combatNpc.id, total:12, natural:10 });
    assert.equal(hitForDm.ok, true);
    assert.equal(hitForDm.hit, false);
    assert.equal(hitForDm.targetAc, 13);
    const playerNpcView = await emit(player, "room:join", { code:created.code, name:"Плут", clientId:"test-player" });
    assert.equal("ac" in playerNpcView.room.scene.tokens.find(token => token.id === combatNpc.id), false);
    const requestForDm = waitFor(dm, "room:state", room => room.combatRequests.some(request => request.tokenId === combatNpc.id && request.amount === 4));
    const requestedDamage = await emit(player, "combat:apply", { tokenId:combatNpc.id, kind:"damage", amount:4, label:"Урон длинного лука" });
    assert.equal(requestedDamage.ok, true);
    assert.equal(requestedDamage.pending, true);
    const requestRoom = await requestForDm;
    const combatRequest = requestRoom.combatRequests.find(request => request.id === requestedDamage.requestId);
    assert.ok(combatRequest);
    const acceptedState = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.id === combatNpc.id && token.hp === 6) && !room.combatRequests.some(request => request.id === combatRequest.id));
    assert.equal((await emit(dm, "combat:request-resolve", { requestId:combatRequest.id, accept:true })).ok, true);
    assert.equal((await acceptedState).scene.tokens.find(token => token.id === combatNpc.id).hp, 6);

    const concentrationReady = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.id === combatNpc.id && token.concentration === "Тьма"));
    assert.equal((await emit(dm, "scene:token-update", { tokenId:combatNpc.id, concentration:"Тьма" })).ok, true);
    await concentrationReady;
    const concentrationDamageState = waitFor(dm, "room:state", room => room.scene.tokens.some(token => token.id === combatNpc.id && token.hp === 4));
    const concentrationDamage = await emit(dm, "combat:apply", { tokenId:combatNpc.id, kind:"damage", amount:2, label:"Проверка концентрации" });
    assert.equal(concentrationDamage.ok, true);
    assert.equal(concentrationDamage.result.applied, 2);
    assert.equal(concentrationDamage.result.concentrationDc, 10);
    assert.equal((await emit(player, "combat:end-battle", {})).ok, false);
    const endedBattleState = waitFor(player, "room:state", room => room.scene.initiative.active === false && room.scene.tokens.every(token => token.initiative === null));
    assert.equal((await emit(dm, "combat:end-battle", {})).ok, true);
    const endedBattleRoom = await endedBattleState;
    assert.equal(endedBattleRoom.scene.initiative.turnState, null);
    assert.deepEqual(endedBattleRoom.scene.initiative.resources, {});
    assert.equal((await concentrationDamageState).scene.tokens.find(token => token.id === combatNpc.id).hp, 4);

    const blockedDelete = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${created.code}/assets/${uploadedAsset.asset.id}`, { method:"DELETE", headers:{ "x-client-id":"test-dm" } });
    assert.equal(blockedDelete.status, 409);
    assert.equal((await blockedDelete.json()).usageCount, 3);

    const forbiddenUpload = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${created.code}/assets`, {
      method:"POST", headers:{ "content-type":"application/json", "x-client-id":"test-player" },
      body:JSON.stringify({ name:"Чужая карта", category:"map", dataUrl:tinyPng })
    });
    assert.equal(forbiddenUpload.status, 403);

    const mapAsset = await fetch(`http://127.0.0.1:${PORT}/api/rooms/${created.code}/assets`, {
      method:"POST", headers:{ "content-type":"application/json", "x-client-id":"test-dm" },
      body:JSON.stringify({ name:"Карта лаборатории", fileName:"map.png", category:"map", dataUrl:tinyPng, width:100, height:60, defaultSize:20 })
    }).then(response => response.json());
    assert.equal(mapAsset.ok, true);
    const mapPlacedState = waitFor(dm, "room:state", room => room.scene.objects.some(object => object.assetId === mapAsset.asset.id));
    const mapPlaced = await emit(dm, "scene:asset-place", { assetId:mapAsset.asset.id, x:-10, y:-6 });
    assert.equal(mapPlaced.ok, true);
    const mapRoom = await mapPlacedState;
    const mapObject = mapRoom.scene.objects.find(object => object.assetId === mapAsset.asset.id);
    assert.equal(mapObject.type, "map");
    assert.equal(mapObject.locked, true);
    assert.equal((await emit(dm, "scene:object-move", { objectId:mapObject.id, x:3, y:4 })).ok, false);
    assert.equal((await emit(dm, "scene:object-update", { objectId:mapObject.id, name:"Лаборатория снизу", width:24, height:14, rotation:15, opacity:.8, z:-50, hidden:false, locked:false })).ok, true);
    const movedMapState = waitFor(dm, "room:state", room => room.scene.objects.some(object => object.id === mapObject.id && object.x === 3 && object.y === 4));
    assert.equal((await emit(dm, "scene:object-move", { objectId:mapObject.id, x:3, y:4 })).ok, true);
    const movedMapRoom = await movedMapState;
    assert.equal(movedMapRoom.scene.objects.find(object => object.id === mapObject.id).rotation, 15);
    const duplicatedObject = await emit(dm, "scene:object-duplicate", { objectId:mapObject.id });
    assert.equal(duplicatedObject.ok, true);
    assert.ok(duplicatedObject.objectId);

    const snappingState = waitFor(dm, "room:state", room => room.scene.grid.snap === true && room.scene.grid.type === "square" && room.scene.grid.offsetX === 7);
    assert.equal((await emit(dm, "scene:settings", { grid:{ columns:30, rows:20, cellSize:48, visible:true, snap:true, type:"square", color:"#d3ad6e", opacity:.3, offsetX:7, offsetY:-5 } })).ok, true);
    await snappingState;

    const playerLineState = waitFor(dm, "room:state", room => room.scene.annotations.some(annotation => annotation.name === "Линия игрока"));
    const playerLine = await emit(player, "scene:annotation-add", { kind:"line", name:"Линия игрока", x:1, y:1, x2:4, y2:4, color:"#44ccff", strokeWidth:3 });
    assert.equal(playerLine.ok, true);
    const playerLineRoom = await playerLineState;
    const ownedLine = playerLineRoom.scene.annotations.find(annotation => annotation.id === playerLine.annotationId);
    assert.equal(ownedLine.ownerId, "test-player");
    assert.equal((await emit(player, "scene:annotation-update", { annotationId:ownedLine.id, color:"#33aaee", strokeWidth:5 })).ok, true);
    const playerLineCopy = await emit(player, "scene:items-duplicate", { refs:[{ kind:"annotation", id:ownedLine.id }], offsetX:1, offsetY:0 });
    assert.equal(playerLineCopy.ok, true);
    assert.equal(playerLineCopy.created.length, 1);
    assert.equal((await emit(player, "scene:items-remove", { refs:playerLineCopy.created })).ok, true);

    const drawState = waitFor(dm, "room:state", room => room.scene.annotations.some(annotation => annotation.name === "Свободный след"));
    const drawAdded = await emit(dm, "scene:annotation-add", { kind:"draw", name:"Свободный след", x:1.2, y:1.3, x2:2.7, y2:2.8, points:[{ x:1.2, y:1.3 },{ x:1.6, y:1.9 },{ x:2.7, y:2.8 }], color:"#f4c875", strokeWidth:4 });
    assert.equal(drawAdded.ok, true);
    const drawRoom = await drawState;
    const drawAnnotation = drawRoom.scene.annotations.find(annotation => annotation.id === drawAdded.annotationId);
    assert.deepEqual(drawAnnotation.points, [{ x:1.2, y:1.3 },{ x:1.6, y:1.9 },{ x:2.7, y:2.8 }]);

    const hiddenAnnotationForDm = waitFor(dm, "room:state", room => room.scene.annotations.some(annotation => annotation.name === "Секретная зона"));
    const hiddenAnnotationForPlayer = waitFor(player, "room:state", room => !room.scene.annotations.some(annotation => annotation.name === "Секретная зона"));
    const hiddenAnnotation = await emit(dm, "scene:annotation-add", { kind:"circle", name:"Секретная зона", x:5.4, y:5.4, x2:7.4, y2:5.4, hidden:true });
    assert.equal(hiddenAnnotation.ok, true);
    assert.ok((await hiddenAnnotationForDm).scene.annotations.some(annotation => annotation.name === "Секретная зона"));
    assert.equal((await hiddenAnnotationForPlayer).scene.annotations.some(annotation => annotation.name === "Секретная зона"), false);

    const transformState = waitFor(dm, "room:state", room => room.scene.objects.some(object => object.id === mapObject.id && object.x === 4 && object.y === 5) && room.scene.annotations.some(annotation => annotation.id === drawAdded.annotationId && annotation.x === 2.2));
    const transformed = await emit(dm, "scene:items-transform", { moves:[{ kind:"object", id:mapObject.id, dx:1, dy:1 },{ kind:"annotation", id:drawAdded.annotationId, dx:1, dy:0 }] });
    assert.equal(transformed.ok, true);
    assert.equal(transformed.moved, 2);
    const transformedRoom = await transformState;
    assert.deepEqual(transformedRoom.scene.annotations.find(annotation => annotation.id === drawAdded.annotationId).points, [{ x:2.2, y:1.3 },{ x:2.6, y:1.9 },{ x:3.7, y:2.8 }]);

    const batchDuplicateState = waitFor(dm, "room:state", room => room.scene.annotations.length >= 3 && room.scene.objects.length >= 3);
    const batchDuplicated = await emit(dm, "scene:items-duplicate", { refs:[{ kind:"object", id:mapObject.id },{ kind:"annotation", id:drawAdded.annotationId }], offsetX:2, offsetY:2 });
    assert.equal(batchDuplicated.ok, true);
    assert.equal(batchDuplicated.created.length, 2);
    await batchDuplicateState;

    const removeState = waitFor(dm, "room:state", room => !room.scene.annotations.some(annotation => annotation.id === batchDuplicated.created.find(ref => ref.kind === "annotation").id));
    assert.equal((await emit(dm, "scene:items-remove", { refs:batchDuplicated.created })).ok, true);
    await removeState;
    const undoState = waitFor(dm, "room:state", room => room.scene.annotations.some(annotation => annotation.id === batchDuplicated.created.find(ref => ref.kind === "annotation").id));
    assert.equal((await emit(dm, "scene:history-undo", {})).ok, true);
    await undoState;
    const redoState = waitFor(dm, "room:state", room => !room.scene.annotations.some(annotation => annotation.id === batchDuplicated.created.find(ref => ref.kind === "annotation").id));
    assert.equal((await emit(dm, "scene:history-redo", {})).ok, true);
    await redoState;

    const pingState = waitFor(player, "room:state", room => room.scene.ping?.by === "Мастер");
    assert.equal((await emit(dm, "scene:ping", { x:3, y:4, color:"#ffcc00" })).ok, true);
    assert.equal((await pingState).scene.ping.color, "#ffcc00");

    watcher = await connect();
    const watcherJoined = await emit(watcher, "room:join", { code:created.code, name:"Наблюдатель", clientId:"test-watcher" });
    assert.equal(watcherJoined.ok, true);
    const privateForDm = waitFor(dm, "room:state", room => room.rollLog.some(entry => entry.label === "Тихая проверка"));
    const privateForAuthor = waitFor(player, "room:state", room => room.rollLog.some(entry => entry.label === "Тихая проверка"));
    const privateHiddenFromWatcher = waitFor(watcher, "room:state", room => !room.rollLog.some(entry => entry.label === "Тихая проверка"));
    assert.equal((await emit(player, "dice:roll", { formula:"1d20+9", label:"Тихая проверка", visibility:"private" })).ok, true);
    assert.ok((await privateForDm).rollLog.some(entry => entry.label === "Тихая проверка" && entry.visibility === "private"));
    assert.ok((await privateForAuthor).rollLog.some(entry => entry.label === "Тихая проверка"));
    assert.equal((await privateHiddenFromWatcher).rollLog.some(entry => entry.label === "Тихая проверка"), false);

    const sceneCreatedState = waitFor(dm, "room:state", room => room.scenes.some(scene => scene.name === "Тайная лаборатория"));
    const sceneCreated = await emit(dm, "scene:create", { name:"Тайная лаборатория", activate:false });
    assert.equal(sceneCreated.ok, true);
    await sceneCreatedState;
    const activatedForPlayer = waitFor(player, "room:state", room => room.scene.name === "Тайная лаборатория");
    assert.equal((await emit(dm, "scene:activate", { sceneId:sceneCreated.scene.id })).ok, true);
    const laboratoryRoom = await activatedForPlayer;
    assert.equal(laboratoryRoom.scenes.length, 1);
    assert.equal(laboratoryRoom.assets.length, 0);
    assert.equal(laboratoryRoom.scene.tokens.length, 0);

    const copied = await emit(dm, "scene:duplicate", { sceneId:sceneCreated.scene.id, name:"Лаборатория — копия", activate:false });
    assert.equal(copied.ok, true);
    assert.equal(copied.scene.name, "Лаборатория — копия");
    const removedCopy = await emit(dm, "scene:remove", { sceneId:copied.scene.id });
    assert.equal(removedCopy.ok, true);

    const backup = await emit(dm, "room:backup", {});
    assert.equal(backup.ok, true);
    assert.equal("sheetHistory" in backup.backup.players["test-player"], false);
    const brokenAgain = structuredClone(restored.sheet);
    brokenAgain.characterName = "Опять испорчено";
    await emit(player, "sheet:update", { sheet:brokenAgain, reason:"Проверка копии" });
    const campaignRestored = await emit(dm, "room:restore-backup", { backup:backup.backup });
    assert.equal(campaignRestored.ok, true);

    const activity = await emit(player, "activity:log", { label:"Сотворено: Брызги кислоты", detail:"Заговор" });
    assert.equal(activity.ok, true);

    player.disconnect();
    player = await connect();
    const resumed = await emit(player, "room:join", { code:created.code, name:"Плут", clientId:"test-player" });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.room.players["test-player"].sheet.characterName, "Шёпот");
    assert.equal(resumed.room.players["test-player"].sheet.coins.gp, 458);
    assert.equal(resumed.room.players["test-player"].sheet.spellsList[0].name, "Брызги кислоты");

    await new Promise(resolve => setTimeout(resolve, 250));
    const persistedRooms = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "rooms.json"), "utf8"));
    assert.ok(persistedRooms[created.code].scenes.length >= 2);
    assert.equal(persistedRooms[created.code].assets[0].name, "Красный гоблин");
    assert.ok(fs.existsSync(path.join(DATA_DIR, "assets", created.code, persistedRooms[created.code].assets[0].filename)));
  } finally {
    dm.disconnect();
    player.disconnect();
    watcher?.disconnect();
  }
});
