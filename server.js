const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const cliPortIndex = process.argv.indexOf("--port");
const cliPort = cliPortIndex >= 0 ? Number(process.argv[cliPortIndex + 1]) : 0;
const START_PORT = Number(process.env.PORT) || cliPort || 31777;
const STRICT_PORT = process.argv.includes("--strictPort");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function readRooms() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

const rooms = readRooms();
let saveTimer;
function saveRooms() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const temporary = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(rooms, null, 2));
    fs.renameSync(temporary, DATA_FILE);
  }, 150);
}

function id() {
  return crypto.randomUUID();
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms[code]);
  return code;
}

function cleanText(value, max = 80) {
  return String(value ?? "").trim().slice(0, max);
}

function defaultSheet(playerName) {
  return {
    schemaVersion: 2,
    characterName: playerName,
    classKey: "",
    raceKey: "",
    className: "",
    subclass: "",
    level: 1,
    race: "",
    ancestryTraits: "",
    size: "Средний",
    background: "",
    alignment: "",
    xp: 0,
    proficiency: 2,
    autoProficiency: true,
    autoSpellSlots: true,
    autoArmorClass: true,
    inspiration: false,
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProficiencies: [],
    skillProficiencies: [],
    expertise: [],
    ac: 10,
    initiativeBonus: 0,
    initiativeAdvantage: false,
    speed: 30,
    hpMax: 10,
    hpCurrent: 10,
    hpTemp: 0,
    hitDice: "1к8",
    hitDieSize: 8,
    hitDiceMax: 1,
    hitDiceCurrent: 1,
    deathSuccess: 0,
    deathFail: 0,
    exhaustion: 0,
    conditions: [],
    concentrationSpellId: "",
    concentrationSpellName: "",
    darkvision: 0,
    blindsight: 0,
    tremorsense: 0,
    truesight: 0,
    resistances: "",
    immunities: "",
    vulnerabilities: "",
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    attacksList: [],
    resources: [],
    inventoryList: [],
    spellcastingAbility: "",
    spellSlots: Array.from({ length: 9 }, (_, index) => ({ level: index + 1, total: 0, used: 0 })),
    spellsList: [],
    portraitUrl: "",
    tokenImageUrl: "",
    tokenColor: "#9f7842",
    tokenVision: 60,
    tokenScale: 1,
    age: "",
    height: "",
    weight: "",
    eyes: "",
    skin: "",
    hair: "",
    appearance: "",
    backstory: "",
    allies: "",
    goalsList: [],
    notesList: [],
    armorProficiencies: "",
    weaponProficiencies: "",
    toolProficiencies: "",
    languages: "",
    jumpHigh: "",
    jumpLong: "",
    attacks: "",
    equipment: "",
    features: "",
    personality: "",
    ideals: "",
    bonds: "",
    flaws: "",
    spells: "",
    notes: ""
  };
}

function normalizeSheet(sheet, playerName) {
  const base = defaultSheet(playerName);
  const incoming = sheet && typeof sheet === "object" ? sheet : {};
  const normalizedSlots = base.spellSlots.map(slot => {
    const saved = Array.isArray(incoming.spellSlots) ? incoming.spellSlots.find(item => Number(item.level) === slot.level) : null;
    return { ...slot, ...(saved || {}) };
  });
  const normalized = {
    ...base,
    ...incoming,
    stats: { ...base.stats, ...(incoming.stats || {}) },
    coins: { ...base.coins, ...(incoming.coins || {}) },
    conditions: Array.isArray(incoming.conditions) ? incoming.conditions : [],
    attacksList: Array.isArray(incoming.attacksList) ? incoming.attacksList : [],
    resources: Array.isArray(incoming.resources) ? incoming.resources : [],
    inventoryList: Array.isArray(incoming.inventoryList) ? incoming.inventoryList : [],
    spellsList: Array.isArray(incoming.spellsList) ? incoming.spellsList : [],
    goalsList: Array.isArray(incoming.goalsList) ? incoming.goalsList : [],
    notesList: Array.isArray(incoming.notesList) ? incoming.notesList : [],
    spellSlots: normalizedSlots
  };
  normalized.schemaVersion = 2;
  if (!("autoProficiency" in incoming)) normalized.autoProficiency = false;
  if (!("autoSpellSlots" in incoming)) normalized.autoSpellSlots = false;
  if (!("autoArmorClass" in incoming)) normalized.autoArmorClass = false;
  if (!("hitDiceMax" in incoming)) normalized.hitDiceMax = Math.max(1, Number(normalized.level || 1));
  if (!("hitDiceCurrent" in incoming)) normalized.hitDiceCurrent = normalized.hitDiceMax;
  return normalized;
}

function publicRoom(room) {
  const players = {};
  Object.entries(room.players).forEach(([playerId, player]) => {
    player.sheet = normalizeSheet(player.sheet, player.name);
    const { sheetHistory: _privateHistory, ...publicPlayer } = player;
    players[playerId] = publicPlayer;
  });
  return {
    code: room.code,
    title: room.title,
    dmId: room.dmId,
    players,
    rollLog: room.rollLog.slice(-30)
  };
}

function emitRoom(code) {
  const room = rooms[code];
  if (room) io.to(code).emit("room:state", publicRoom(room));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, title, clientId }, reply = () => {}) => {
    name = cleanText(name, 40);
    title = cleanText(title, 60) || "Новая кампания";
    clientId = cleanText(clientId, 80) || id();
    if (!name) return reply({ ok: false, error: "Укажи имя ведущего" });

    const code = roomCode();
    rooms[code] = {
      code,
      title,
      dmId: clientId,
      players: {
        [clientId]: { id: clientId, name, role: "dm", online: true, sheet: defaultSheet(name), sheetHistory: [] }
      },
      rollLog: [],
      createdAt: Date.now()
    };
    socket.join(code);
    socket.data = { code, clientId };
    saveRooms();
    reply({ ok: true, code, clientId, room: publicRoom(rooms[code]) });
    emitRoom(code);
  });

  socket.on("room:join", ({ code, name, clientId }, reply = () => {}) => {
    code = cleanText(code, 8).toUpperCase();
    name = cleanText(name, 40);
    clientId = cleanText(clientId, 80) || id();
    const room = rooms[code];
    if (!room) return reply({ ok: false, error: "Комната с таким кодом не найдена" });
    if (!name) return reply({ ok: false, error: "Укажи имя игрока" });

    const existing = room.players[clientId];
    if (existing) {
      existing.name = name;
      existing.online = true;
    } else {
      room.players[clientId] = { id: clientId, name, role: "player", online: true, sheet: defaultSheet(name), sheetHistory: [] };
    }
    socket.join(code);
    socket.data = { code, clientId };
    saveRooms();
    reply({ ok: true, code, clientId, room: publicRoom(room) });
    emitRoom(code);
  });

  socket.on("sheet:update", ({ sheet, reason }, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const player = rooms[code]?.players?.[clientId];
    if (!player || !sheet || typeof sheet !== "object") return reply({ ok: false });
    player.sheetHistory = Array.isArray(player.sheetHistory) ? player.sheetHistory : [];
    const last = player.sheetHistory.at(-1);
    if (cleanText(reason, 80) || !last || Date.now() - Number(last.at || 0) > 60000) {
      player.sheetHistory.push({ id: id(), at: Date.now(), label: cleanText(reason, 80) || "Автосохранение", sheet: normalizeSheet(player.sheet, player.name) });
      player.sheetHistory = player.sheetHistory.slice(-20);
    }
    player.sheet = normalizeSheet({ ...sheet, characterName: cleanText(sheet.characterName, 60) }, player.name);
    saveRooms();
    emitRoom(code);
    reply({ ok: true });
  });

  socket.on("sheet:history", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const player = rooms[code]?.players?.[clientId];
    if (!player) return reply({ ok: false });
    const history = (player.sheetHistory || []).map(({ id, at, label, sheet }) => ({ id, at, label, characterName: sheet?.characterName || player.name, level: sheet?.level || 1 }));
    reply({ ok: true, history: history.reverse() });
  });

  socket.on("sheet:restore", ({ revisionId }, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const player = rooms[code]?.players?.[clientId];
    const revision = player?.sheetHistory?.find(item => item.id === cleanText(revisionId, 80));
    if (!player || !revision) return reply({ ok: false, error: "Версия не найдена" });
    player.sheetHistory.push({ id: id(), at: Date.now(), label: "Перед восстановлением", sheet: normalizeSheet(player.sheet, player.name) });
    player.sheetHistory = player.sheetHistory.slice(-20);
    player.sheet = normalizeSheet(revision.sheet, player.name);
    saveRooms(); emitRoom(code); reply({ ok: true, sheet: player.sheet });
  });

  socket.on("room:backup", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok: false, error: "Только ведущий может сохранить кампанию" });
    const backup = structuredClone(room);
    Object.values(backup.players).forEach(player => { delete player.sheetHistory; player.online = false; });
    reply({ ok: true, backup });
  });

  socket.on("room:restore-backup", ({ backup }, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий может восстановить кампанию" });
    if (!backup || typeof backup !== "object" || !backup.players || typeof backup.players !== "object") return reply({ ok:false, error:"Неверный файл копии" });
    const candidates = Object.entries(backup.players).slice(0, 50);
    if (!candidates.length) return reply({ ok:false, error:"В копии нет игроков" });
    const restoredPlayers = Object.create(null);
    for (const [rawPlayerId, candidate] of candidates) {
      const playerId = cleanText(rawPlayerId, 80);
      if (!playerId || ["__proto__","prototype","constructor"].includes(playerId) || !candidate || typeof candidate !== "object") continue;
      const existing = room.players[playerId];
      const name = cleanText(candidate.name, 40) || existing?.name || "Игрок";
      const history = Array.isArray(existing?.sheetHistory) ? existing.sheetHistory.slice(-19) : [];
      if (existing?.sheet) history.push({ id:id(), at:Date.now(), label:"Перед восстановлением кампании", sheet:normalizeSheet(existing.sheet, existing.name) });
      restoredPlayers[playerId] = { id:playerId, name, role:playerId === clientId ? "dm" : "player", online:playerId === clientId, sheet:normalizeSheet(candidate.sheet, name), sheetHistory:history.slice(-20) };
    }
    if (!restoredPlayers[clientId]) {
      const current = room.players[clientId];
      restoredPlayers[clientId] = { ...current, role:"dm", online:true, sheetHistory:Array.isArray(current.sheetHistory) ? current.sheetHistory.slice(-20) : [] };
    }
    room.title = cleanText(backup.title, 60) || room.title;
    room.players = restoredPlayers;
    room.dmId = clientId;
    room.rollLog = Array.isArray(backup.rollLog) ? backup.rollLog.slice(-30).map(entry => ({
      id:id(), player:cleanText(entry?.player, 40) || "Игрок", label:cleanText(entry?.label, 80), activity:cleanText(entry?.activity, 120),
      formula:cleanText(entry?.formula, 100), dice:Array.isArray(entry?.dice) ? entry.dice.slice(0,100).map(Number) : [], modifier:Number(entry?.modifier || 0),
      total:entry?.total === null ? null : Number(entry?.total || 0), mode:["advantage","disadvantage"].includes(entry?.mode) ? entry.mode : "normal", natural:Number(entry?.natural || 0) || null, at:Number(entry?.at || Date.now())
    })) : [];
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("dice:roll", ({ formula, label, mode }, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    const player = room?.players?.[clientId];
    if (!room || !player) return reply({ ok: false, error: "Игрок не подключён" });
    const parsed = parseDiceFormula(formula, mode);
    if (!parsed.ok) return reply({ ok: false, error: parsed.error });
    room.rollLog.push({ id: id(), player: player.name, label: cleanText(label, 60) || parsed.formula, formula: parsed.formula, dice: parsed.dice, detail: parsed.detail, modifier: parsed.modifier, total: parsed.total, mode: parsed.mode, natural: parsed.natural, at: Date.now() });
    room.rollLog = room.rollLog.slice(-30);
    saveRooms();
    emitRoom(code);
    reply({ ok: true, total: parsed.total, dice: parsed.dice, detail: parsed.detail, mode: parsed.mode, natural: parsed.natural });
  });

  socket.on("activity:log", ({ label, detail }, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    const player = room?.players?.[clientId];
    if (!room || !player) return reply({ ok: false });
    room.rollLog.push({ id: id(), player: player.name, label: cleanText(label, 80), activity: cleanText(detail, 120), total: null, at: Date.now() });
    room.rollLog = room.rollLog.slice(-30);
    saveRooms(); emitRoom(code); reply({ ok: true });
  });

  socket.on("disconnect", () => {
    const { code, clientId } = socket.data || {};
    const player = rooms[code]?.players?.[clientId];
    if (player) {
      player.online = false;
      saveRooms();
      emitRoom(code);
    }
  });
});

function parseDiceFormula(value, requestedMode = "normal") {
  const formula = String(value || "").toLowerCase().replace(/d/g, "к").replace(/\s/g, "");
  if (!formula || formula.length > 100) return { ok: false, error: "Формат броска: 1к20+5 или 1d8+5d6+7" };
  const tokens = formula.match(/[+-]?(?:\d*к\d+|\d+)/g);
  if (!tokens || tokens.join("") !== formula) return { ok: false, error: "Не понимаю формулу броска" };
  let total = 0;
  let modifier = 0;
  let diceCount = 0;
  const dice = [];
  const detail = [];
  for (const token of tokens) {
    const sign = token.startsWith("-") ? -1 : 1;
    const body = token.replace(/^[+-]/, "");
    if (!body.includes("к")) {
      const number = Number(body) * sign;
      if (!Number.isSafeInteger(number) || Math.abs(number) > 100000) return { ok: false, error: "Слишком большой модификатор" };
      modifier += number;
      total += number;
      continue;
    }
    const [rawCount, rawSides] = body.split("к");
    const count = Number(rawCount || 1);
    const sides = Number(rawSides);
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(sides) || sides < 2 || sides > 1000 || diceCount + count > 100) {
      return { ok: false, error: "Слишком много или слишком странные кости" };
    }
    const rolls = Array.from({ length: count }, () => crypto.randomInt(1, sides + 1));
    diceCount += count;
    rolls.forEach(roll => dice.push(roll * sign));
    const subtotal = rolls.reduce((sum, roll) => sum + roll, 0) * sign;
    total += subtotal;
    detail.push({ count, sides, sign, rolls, subtotal });
  }
  let mode = ["advantage", "disadvantage"].includes(requestedMode) ? requestedMode : "normal";
  const d20 = detail.find(entry => entry.sign === 1 && entry.count === 1 && entry.sides === 20);
  let natural = d20?.rolls?.[0] ?? null;
  if (mode !== "normal" && d20) {
    const first = d20.rolls[0];
    const second = crypto.randomInt(1, 21);
    const kept = mode === "advantage" ? Math.max(first, second) : Math.min(first, second);
    total += kept - first;
    d20.rolls = [first, second];
    d20.kept = kept;
    d20.subtotal = kept;
    dice.push(second);
    natural = kept;
  } else if (!d20) mode = "normal";
  return { ok: true, formula, dice, detail, modifier, total, mode, natural };
}

function openBrowser(url) {
  if (process.env.AUTO_OPEN !== "1" || process.platform !== "win32") return;
  const opener = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  opener.unref();
}

function startServer(port, attemptsLeft = 20) {
  server.once("error", error => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`Порт ${port} занят. Пробую ${port + 1}...`);
      startServer(port + 1, attemptsLeft - 1);
      return;
    }
    console.error("Не удалось запустить TabaxiTable:", error.message);
    process.exit(1);
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`TabaxiTable запущен: ${url}`);
    openBrowser(url);
  });
}

startServer(START_PORT, STRICT_PORT ? 0 : 20);

function shutdown() {
  clearTimeout(saveTimer);
  fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
