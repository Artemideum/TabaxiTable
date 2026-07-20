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
  return new Promise(resolve => {
    const handler = value => {
      if (predicate(value)) resolve(value);
      else socket.once(event, handler);
    };
    socket.once(event, handler);
  });
}

test("комната, лист, броски, история и резервная копия работают вместе", async () => {
  const dm = await connect();
  let player = await connect();
  try {
    const health = await fetch(`http://127.0.0.1:${PORT}/health`).then(response => response.json());
    assert.deepEqual(health, { ok:true });
    const index = await fetch(`http://127.0.0.1:${PORT}/`).then(response => response.text());
    assert.match(index, /TabaxiTable/);
    assert.match(index, /roll-peek[^>]*>[\s\S]*?<small>/);
    const catalog = await fetch(`http://127.0.0.1:${PORT}/spells-5e.json`).then(response => response.json());
    assert.equal(catalog.length, 120);
    const itemCatalogScript = await fetch(`http://127.0.0.1:${PORT}/items-5e.js`).then(response => response.text());
    assert.match(itemCatalogScript, /TT_ITEMS_2014/);
    assert.ok(itemCatalogScript.length > 200000);
    const itemSystemScript = await fetch(`http://127.0.0.1:${PORT}/item-system.js`).then(response => response.text());
    assert.match(itemSystemScript, /TT_ITEM_SYSTEM/);

    const created = await emit(dm, "room:create", { name:"Мастер", title:"Тестовая кампания", clientId:"test-dm" });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z2-9]{6}$/);
    assert.equal(created.room.players["test-dm"].sheet.schemaVersion, 8);
    assert.equal(created.room.scene.grid.columns, 24);
    assert.equal(created.room.scene.tokens.length, 0);
    assert.equal(created.room.players["test-dm"].sheet.autoProficiency, true);
    assert.equal(created.room.players["test-dm"].sheet.autoSpellSlots, true);
    assert.equal(created.room.players["test-dm"].sheet.autoArmorClass, true);
    assert.equal(created.room.players["test-dm"].sheet.passivePerceptionBonus, 0);
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

    const partySceneUpdate = waitFor(player, "room:state", room => room.scene.tokens.some(token => token.playerId === "test-player"));
    const partyAdded = await emit(dm, "scene:party-add", {});
    assert.equal(partyAdded.ok, true);
    assert.equal(partyAdded.added, 2);
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
  } finally {
    dm.disconnect();
    player.disconnect();
  }
});
