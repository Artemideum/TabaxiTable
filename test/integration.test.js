const test = require("node:test");
const assert = require("node:assert/strict");
const { io } = require("socket.io-client");
const { spawn } = require("node:child_process");

const PORT = 3101;
let server;

test.before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
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

test.after(() => server?.kill("SIGTERM"));

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${PORT}`, { transports: ["websocket"], forceNew: true });
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

test("ведущий создаёт комнату, игрок входит и бросает кость", async () => {
  const dm = await connect();
  let player = await connect();
  try {
    const created = await emit(dm, "room:create", { name: "Мастер", title: "Тестовая кампания", clientId: "test-dm" });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z2-9]{6}$/);

    const joined = await emit(player, "room:join", { code: created.code, name: "Плут", clientId: "test-player" });
    assert.equal(joined.ok, true);
    assert.equal(Object.keys(joined.room.players).length, 2);

    const sheet = joined.room.players["test-player"].sheet;
    sheet.characterName = "Шёпот";
    sheet.stats.dex = 18;
    sheet.coins.gp = 458;
    sheet.attacksList.push({ id: "bow", name: "Длинный лук +1", bonus: "[DEX]+[PROF]+1", damage: "1d8+[DEX]+1+5d6", damageType: "колющий" });
    sheet.resources.push({ id: "arrows", name: "Стрелы", current: 19, max: 20, reset: "none" });
    sheet.inventoryList.push({ id: "cloak", name: "Плащ летучей мыши", quantity: 1, weight: 3, equipped: true, attuned: true, magical: true });
    sheet.spellsList.push({ id: "acid", name: "Брызги кислоты", level: 0, prepared: true, damage: "2d6" });
    sheet.goalsList.push({ id: "goal", text: "Добраться до крепости", done: false });
    sheet.notesList.push({ id: "note", title: "Контакт", text: "Варус" });
    sheet.expertise.push("stealth");
    sheet.spellSlots[0] = { level: 1, total: 4, used: 1 };
    const roomUpdate = waitFor(dm, "room:state", room => room.players["test-player"]?.sheet?.coins?.gp === 458);
    const saved = await emit(player, "sheet:update", { sheet });
    assert.equal(saved.ok, true);
    const updatedRoom = await roomUpdate;
    assert.equal(updatedRoom.players["test-player"].sheet.coins.gp, 458);
    assert.equal(updatedRoom.players["test-player"].sheet.attacksList[0].name, "Длинный лук +1");
    assert.equal(updatedRoom.players["test-player"].sheet.resources[0].current, 19);
    assert.equal(updatedRoom.players["test-player"].sheet.inventoryList[0].attuned, true);
    assert.equal(updatedRoom.players["test-player"].sheet.spellsList[0].damage, "2d6");
    assert.deepEqual(updatedRoom.players["test-player"].sheet.expertise, ["stealth"]);

    const rolled = await emit(player, "dice:roll", { formula: "1d8+7+5d6", label: "Скрытая атака" });
    assert.equal(rolled.ok, true);
    assert.ok(rolled.total >= 13 && rolled.total <= 45);

    const activity = await emit(player, "activity:log", { label: "Сотворено: Брызги кислоты", detail: "Заговор" });
    assert.equal(activity.ok, true);

    player.disconnect();
    player = await connect();
    const resumed = await emit(player, "room:join", { code: created.code, name: "Плут", clientId: "test-player" });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.room.players["test-player"].sheet.characterName, "Шёпот");
    assert.equal(resumed.room.players["test-player"].sheet.coins.gp, 458);
    assert.equal(resumed.room.players["test-player"].sheet.spellsList[0].name, "Брызги кислоты");
  } finally {
    dm.disconnect();
    player.disconnect();
  }
});
