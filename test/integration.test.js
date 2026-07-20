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
    const catalog = await fetch(`http://127.0.0.1:${PORT}/spells-5e.json`).then(response => response.json());
    assert.equal(catalog.length, 120);

    const created = await emit(dm, "room:create", { name:"Мастер", title:"Тестовая кампания", clientId:"test-dm" });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z2-9]{6}$/);
    assert.equal(created.room.players["test-dm"].sheet.schemaVersion, 3);
    assert.equal(created.room.players["test-dm"].sheet.autoProficiency, true);
    assert.equal(created.room.players["test-dm"].sheet.autoSpellSlots, true);
    assert.equal(created.room.players["test-dm"].sheet.autoArmorClass, true);
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
    sheet.attacksList.push({ id:"bow", name:"Длинный лук +1", bonus:"[DEX]+[PROF]+1", damage:"1d8+[DEX]+1+5d6", damageType:"колющий" });
    sheet.resources.push({ id:"arrows", name:"Стрелы", current:19, max:20, reset:"none" });
    sheet.inventoryList.push({ id:"cloak", name:"Плащ летучей мыши", quantity:1, weight:3, equipped:true, attuned:true, magical:true });
    sheet.spellsList.push({ id:"acid", catalogKey:"acid-splash", name:"Брызги кислоты", level:0, prepared:true, damage:"2d6" });
    sheet.goalsList.push({ id:"goal", text:"Добраться до крепости", done:false });
    sheet.notesList.push({ id:"note", title:"Контакт", text:"Варус" });
    sheet.expertise.push("stealth");
    sheet.spellSlots[0] = { level:1, total:4, used:1 };

    const roomUpdate = waitFor(dm, "room:state", room => room.players["test-player"]?.sheet?.coins?.gp === 458);
    const saved = await emit(player, "sheet:update", { sheet, reason:"Первый полноценный лист" });
    assert.equal(saved.ok, true);
    const updatedRoom = await roomUpdate;
    assert.equal(updatedRoom.players["test-player"].sheet.characterName, "Шёпот");
    assert.equal(updatedRoom.players["test-player"].sheet.schemaVersion, 3);
    assert.deepEqual(updatedRoom.players["test-player"].sheet.classes.map(entry => [entry.key, entry.level]), [["rogue",1]]);
    assert.equal(updatedRoom.players["test-player"].sheet.levelProgression.length, 1);
    assert.equal(updatedRoom.players["test-player"].sheet.inventoryList[0].attuned, true);
    assert.deepEqual(updatedRoom.players["test-player"].sheet.expertise, ["stealth"]);
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
    assert.equal(advantage.natural, Math.max(...advantage.detail[0].rolls));
    assert.equal(advantage.total, advantage.natural + 7);

    const invalidRoll = await emit(player, "dice:roll", { formula:"101d6", label:"Слишком много" });
    assert.equal(invalidRoll.ok, false);

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
