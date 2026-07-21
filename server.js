const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const itemSystem = require("./public/item-system.js");

const cliPortIndex = process.argv.indexOf("--port");
const cliPort = cliPortIndex >= 0 ? Number(process.argv[cliPortIndex + 1]) : 0;
const START_PORT = Number(process.env.PORT) || cliPort || 31777;
const STRICT_PORT = process.argv.includes("--strictPort");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");
const ASSET_DIR = path.join(DATA_DIR, "assets");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ASSET_DIR, { recursive: true });

function readRooms() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

const rooms = readRooms();
let saveTimer;
const sceneHistories = new Map();
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

function imageSignatureMatches(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mimeType === "image/png") return buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/gif") return ["GIF87a","GIF89a"].includes(buffer.subarray(0,6).toString("ascii"));
  if (mimeType === "image/webp") return buffer.subarray(0,4).toString("ascii") === "RIFF" && buffer.subarray(8,12).toString("ascii") === "WEBP";
  return false;
}

function sheetHasFeat(sheet, featKey) {
  return (Array.isArray(sheet?.feats) ? sheet.feats : []).some(feat => cleanText(feat?.key || feat, 40) === featKey);
}

function sheetInitiativeBonus(sheet) {
  const dexterity = Number(sheet?.stats?.dex || 10);
  return Math.floor((dexterity - 10) / 2) + Number(sheet?.initiativeBonus || 0) + (sheetHasFeat(sheet, "alert") ? 5 : 0);
}

const COMBAT_SLOT_KEYS = ["head", "neck", "cloak", "body", "mainHand", "offHand", "belt", "feet", "ammo"];
const COMBAT_SET_IDS = ["a", "b", "c"];
const COMBAT_CONDITIONS = ["Скрыт", "Ослеплён", "Очарован", "Оглушён", "Отравлен", "Испуган", "Схвачен", "Недееспособен", "Невидим", "Парализован", "Окаменел", "Сбит с ног", "Опутан", "Без сознания", "Истощён", "Мёртв"];
const TABLE_DIE_SIDES = [4,6,8,10,12,20,100];
const MAX_TABLE_DICE = 24;
const MAX_ACTIVE_TABLE_ROLLS = 20;
const ACTIVE_TABLE_ROLL_MS = 20000;

function normalizeDiceColor(value, fallback = "#d3ad6e") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
}

function normalizeTableDiceSelection(source) {
  const entries = Array.isArray(source) ? source : [];
  let remaining = MAX_TABLE_DICE;
  return entries.slice(0, TABLE_DIE_SIDES.length * 2).map(entry => {
    const sides = TABLE_DIE_SIDES.includes(Number(entry?.sides)) ? Number(entry.sides) : 0;
    if (!sides || remaining <= 0) return null;
    const cost = sides === 100 ? 2 : 1;
    const count = Math.max(0, Math.min(Math.floor(remaining / cost), Number(entry?.count) || 0));
    if (!count) return null;
    remaining -= count * cost;
    return { sides, count };
  }).filter(Boolean);
}

function tableDiceFormula(sets, modifier = 0) {
  const dice = sets.map(set => `${Number(set.count) > 1 ? `${set.count}к` : `к`}${set.sides}`);
  const flat = Number(modifier) || 0;
  if (flat) dice.push(`${flat > 0 ? "+" : "−"}${Math.abs(flat)}`);
  return dice.join(" ") || "к20";
}

function normalizeSceneDiceRoll(source, coordinate = value => Math.max(-500, Math.min(500, Math.round((Number(value) || 0) * 10) / 10))) {
  if (!source || typeof source !== "object") return null;
  const at = Number(source.at) || Date.now();
  if (Date.now() - at >= ACTIVE_TABLE_ROLL_MS) return null;
  const legacySides = TABLE_DIE_SIDES.includes(Number(source.sides)) ? Number(source.sides) : 20;
  const rawSets = Array.isArray(source.sets) && source.sets.length
    ? source.sets
    : [{ sides:legacySides, values:[Math.max(1, Math.min(legacySides, Number(source.value) || 1))] }];
  let remaining = MAX_TABLE_DICE;
  const sets = rawSets.map(raw => {
    const sides = TABLE_DIE_SIDES.includes(Number(raw?.sides)) ? Number(raw.sides) : 0;
    if (!sides || remaining <= 0) return null;
    const values = (Array.isArray(raw?.values) ? raw.values : []).slice(0, remaining).map(value => Math.max(1, Math.min(sides, Number(value) || 1)));
    if (!values.length) return null;
    remaining -= values.length;
    return { sides, values };
  }).filter(Boolean);
  if (!sets.length) return null;
  const modifier = Math.max(-999, Math.min(999, Number(source.modifier) || 0));
  const total = sets.flatMap(set => set.values).reduce((sum, value) => sum + value, modifier);
  const visibility = ["private","gm"].includes(source.visibility) ? source.visibility : "public";
  return {
    id:cleanText(source.id,80) || id(),
    x:coordinate(source.x), y:coordinate(source.y),
    sets,
    modifier,
    total,
    formula:cleanText(source.formula,120) || tableDiceFormula(sets.map(set => ({ sides:set.sides, count:set.values.length })), modifier),
    color:normalizeDiceColor(source.color),
    at,
    by:cleanText(source.by,60),
    visibility,
    playerId: cleanText(source.playerId,80),
    privateToDm: Boolean(source.privateToDm)
  };
}


function emptyCombatSet(setId, index = 0) {
  return {
    id: setId,
    name: `Комплект ${String.fromCharCode(65 + index)}`,
    slots: Object.fromEntries(COMBAT_SLOT_KEYS.map(key => [key, ""])),
    quickSlots: Array(5).fill("")
  };
}

function defaultCombatLoadout() {
  return {
    initialized: false,
    activeSet: "a",
    autoAmmo: true,
    sets: COMBAT_SET_IDS.map(emptyCombatSet),
    attunementSlots: []
  };
}

function normalizeCombatLoadout(source, inventory, itemIdAliases = new Map()) {
  const base = defaultCombatLoadout();
  const incoming = source && typeof source === "object" ? source : {};
  const itemIds = new Set(inventory.map(item => cleanText(item?.id, 80)).filter(Boolean));
  const keepItemId = value => {
    const originalId = cleanText(value, 80);
    const itemId = itemIdAliases.get(originalId) || originalId;
    return itemIds.has(itemId) ? itemId : "";
  };
  const sourceSets = Array.isArray(incoming.sets) ? incoming.sets : Object.values(incoming.sets || {});
  const sets = COMBAT_SET_IDS.map((setId, index) => {
    const saved = sourceSets.find(set => set?.id === setId) || sourceSets[index] || {};
    const empty = emptyCombatSet(setId, index);
    return {
      id: setId,
      name: cleanText(saved.name, 40) || empty.name,
      slots: Object.fromEntries(COMBAT_SLOT_KEYS.map(key => [key, keepItemId(saved.slots?.[key])])),
      quickSlots: Array.from({ length:5 }, (_, slotIndex) => keepItemId(saved.quickSlots?.[slotIndex]))
    };
  });

  const hasAssignedItems = sets.some(set => Object.values(set.slots).some(Boolean) || set.quickSlots.some(Boolean));
  if (!hasAssignedItems || incoming.initialized !== true) {
    const active = sets[0];
    const equipped = inventory.filter(item => item?.equipped && itemIds.has(cleanText(item.id, 80)));
    const body = equipped.find(item => item.type === "armor" && item.armorType !== "shield");
    const shield = equipped.find(item => item.type === "armor" && item.armorType === "shield");
    const weapon = equipped.find(item => item.type === "weapon") || inventory.find(item => item?.type === "weapon");
    const ammo = inventory.find(item => /стрел|болт|боеприпас/i.test(`${item?.name || ""} ${item?.catalogKey || ""}`));
    const quick = inventory.find(item => /зель|potion|свиток/i.test(`${item?.name || ""} ${item?.catalogKey || ""}`));
    if (body && !active.slots.body) active.slots.body = body.id;
    if (shield && !active.slots.offHand) active.slots.offHand = shield.id;
    if (weapon && !active.slots.mainHand) active.slots.mainHand = weapon.id;
    if (ammo && !active.slots.ammo) active.slots.ammo = ammo.id;
    if (quick && !active.quickSlots[0]) active.quickSlots[0] = quick.id;
  }

  const savedAttunement = Array.isArray(incoming.attunementSlots) ? incoming.attunementSlots.map(keepItemId).filter(Boolean) : [];
  const legacyAttunement = inventory.filter(item => item?.attuned).map(item => keepItemId(item.id)).filter(Boolean);
  return {
    initialized: Boolean(incoming.initialized) || inventory.length > 0,
    activeSet: COMBAT_SET_IDS.includes(incoming.activeSet) ? incoming.activeSet : base.activeSet,
    autoAmmo: incoming.autoAmmo !== false,
    sets,
    attunementSlots: [...new Set([...savedAttunement, ...legacyAttunement])].slice(0, 20)
  };
}

function defaultScene(name = "Главная сцена") {
  return {
    schemaVersion: 6,
    id: id(),
    name: cleanText(name, 60) || "Главная сцена",
    published: true,
    backgroundUrl: "",
    backgroundColor: "#17120e",
    grid: {
      columns: 24,
      rows: 16,
      cellSize: 52,
      visible: true,
      snap: true,
      type: "square",
      color: "#d3ad6e",
      opacity: 0.22,
      offsetX: 0,
      offsetY: 0
    },
    tokens: [],
    objects: [],
    annotations: [],
    ping: null,
    diceRoll: null,
    diceRolls: [],
    combatSettings: { actionPolicy: "soft" },
    initiative: { active: false, round: 1, currentTokenId: "", turnState:null, resources:{} },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function normalizeScene(source, players = {}) {
  const base = defaultScene();
  const incoming = source && typeof source === "object" ? source : {};
  const gridSource = incoming.grid && typeof incoming.grid === "object" ? incoming.grid : {};
  const grid = {
    columns: Math.max(8, Math.min(200, Number(gridSource.columns) || base.grid.columns)),
    rows: Math.max(6, Math.min(200, Number(gridSource.rows) || base.grid.rows)),
    cellSize: Math.max(20, Math.min(160, Number(gridSource.cellSize) || base.grid.cellSize)),
    visible: gridSource.visible !== false,
    snap: gridSource.snap !== false,
    type: ["square", "hex-row", "hex-column", "isometric"].includes(gridSource.type) ? gridSource.type : "square",
    color: /^#[0-9a-f]{6}$/i.test(gridSource.color) ? gridSource.color : base.grid.color,
    opacity: Math.max(0.03, Math.min(1, Number(gridSource.opacity) || base.grid.opacity)),
    offsetX: Math.max(-1000, Math.min(1000, Number(gridSource.offsetX) || 0)),
    offsetY: Math.max(-1000, Math.min(1000, Number(gridSource.offsetY) || 0))
  };
  const normalizeFreeCoordinate = value => Math.max(-500, Math.min(500, Math.round((Number(value) || 0) * 10) / 10));
  const normalizeCoordinate = value => {
    const number = Number(value) || 0;
    const positioned = grid.snap ? Math.round(number) : Math.round(number * 10) / 10;
    return Math.max(-500, Math.min(500, positioned));
  };
  const seenIds = new Set();
  const tokens = (Array.isArray(incoming.tokens) ? incoming.tokens : []).slice(0, 500).map((raw, index) => {
    const tokenId = cleanText(raw?.id, 80) || id();
    if (seenIds.has(tokenId)) return null;
    seenIds.add(tokenId);
    const playerId = cleanText(raw?.playerId, 80);
    const player = players[playerId];
    const sheet = player?.sheet || {};
    const fallbackName = player ? cleanText(sheet.characterName || player.name, 60) : `Токен ${index + 1}`;
    const initiative = raw?.initiative === null || raw?.initiative === undefined || raw?.initiative === "" ? null : Math.max(-100, Math.min(200, Number(raw.initiative) || 0));
    return {
      id: tokenId,
      assetId: cleanText(raw?.assetId, 80),
      playerId: player ? playerId : "",
      name: cleanText(player ? (sheet.characterName || player.name) : raw?.name, 60) || fallbackName,
      x: normalizeCoordinate(raw?.x),
      y: normalizeCoordinate(raw?.y),
      size: Math.max(0.25, Math.min(12, Number(player ? sheet.tokenScale : raw?.size) || 1)),
      rotation: Math.max(-3600, Math.min(3600, Number(raw?.rotation) || 0)),
      opacity: Math.max(0.05, Math.min(1, Number(raw?.opacity) || 1)),
      color: /^#[0-9a-f]{6}$/i.test(player ? sheet.tokenColor : raw?.color) ? (player ? sheet.tokenColor : raw.color) : "#9f7842",
      imageUrl: cleanText(player ? (sheet.tokenImageUrl || sheet.portraitUrl) : raw?.imageUrl, 1000),
      vision: Math.max(0, Math.min(10000, Number(player ? sheet.tokenVision : raw?.vision) || 0)),
      hidden: Boolean(raw?.hidden),
      locked: Boolean(raw?.locked),
      z: Math.max(-1000, Math.min(1000, Number(raw?.z) || 100)),
      initiativeBonus: Math.max(-100, Math.min(100, Number(player ? sheetInitiativeBonus(sheet) : raw?.initiativeBonus) || 0)),
      initiativeAdvantage: Boolean(player ? sheet.initiativeAdvantage : raw?.initiativeAdvantage),
      initiative,
      badge: cleanText(raw?.badge, 32),
      badgeColor: /^#[0-9a-f]{6}$/i.test(raw?.badgeColor) ? raw.badgeColor : "#f4c875",
      hpMax: Math.max(1, Math.min(1000000, Number(player ? sheet.hpMax : raw?.hpMax) || 1)),
      hp: Math.max(0, Math.min(1000000, Number(player ? sheet.hpCurrent : raw?.hp) || 0)),
      tempHp: Math.max(0, Math.min(1000000, Number(player ? sheet.hpTemp : raw?.tempHp) || 0)),
      ac: Math.max(0, Math.min(1000, Number(player ? sheet.ac : raw?.ac) || 10)),
      conditions: player ? [] : (Array.isArray(raw?.conditions) ? [...new Set(raw.conditions.map(value => cleanText(value, 40)).filter(value => COMBAT_CONDITIONS.includes(value)))].slice(0, COMBAT_CONDITIONS.length) : []),
      concentration: player ? "" : cleanText(raw?.concentration, 120),
      deathSuccess: Math.max(0, Math.min(3, Number(player ? sheet.deathSuccess : raw?.deathSuccess) || 0)),
      deathFail: Math.max(0, Math.min(3, Number(player ? sheet.deathFail : raw?.deathFail) || 0)),
      stable: Boolean(raw?.stable)
    };
  }).filter(Boolean);
  const objectIds = new Set();
  const objects = (Array.isArray(incoming.objects) ? incoming.objects : []).slice(0, 1000).map((raw, index) => {
    const objectId = cleanText(raw?.id, 80) || id();
    if (objectIds.has(objectId) || seenIds.has(objectId)) return null;
    objectIds.add(objectId);
    const type = ["map", "prop", "note"].includes(raw?.type) ? raw.type : "prop";
    return {
      id: objectId,
      assetId: cleanText(raw?.assetId, 80),
      type,
      name: cleanText(raw?.name, 80) || `${type === "map" ? "Карта" : "Объект"} ${index + 1}`,
      imageUrl: cleanText(raw?.imageUrl, 1000),
      x: normalizeCoordinate(raw?.x),
      y: normalizeCoordinate(raw?.y),
      width: Math.max(0.25, Math.min(200, Number(raw?.width) || (type === "map" ? 20 : 1))),
      height: Math.max(0.25, Math.min(200, Number(raw?.height) || (type === "map" ? 12 : 1))),
      rotation: Math.max(-3600, Math.min(3600, Number(raw?.rotation) || 0)),
      opacity: Math.max(0.03, Math.min(1, Number(raw?.opacity) || 1)),
      hidden: Boolean(raw?.hidden),
      locked: raw?.locked === undefined ? type === "map" : Boolean(raw.locked),
      z: Math.max(-1000, Math.min(1000, Number(raw?.z) || (type === "map" ? -100 : 0)))
    };
  }).filter(Boolean);
  const annotationIds = new Set();
  const annotations = (Array.isArray(incoming.annotations) ? incoming.annotations : []).slice(0, 2000).map((raw, index) => {
    const annotationId = cleanText(raw?.id, 80) || id();
    if (annotationIds.has(annotationId) || seenIds.has(annotationId) || objectIds.has(annotationId)) return null;
    annotationIds.add(annotationId);
    const kind = ["line", "rect", "circle", "cone", "draw", "text"].includes(raw?.kind) ? raw.kind : "line";
    const coordinate = kind === "draw" ? normalizeFreeCoordinate : normalizeCoordinate;
    const points = Array.isArray(raw?.points) ? raw.points.slice(0, 1000).map(point => ({ x: coordinate(point?.x), y: coordinate(point?.y) })) : [];
    return {
      id: annotationId,
      ownerId: cleanText(raw?.ownerId, 80),
      kind,
      name: cleanText(raw?.name, 80) || `${kind === "text" ? "Текст" : "Рисунок"} ${index + 1}`,
      x: coordinate(raw?.x),
      y: coordinate(raw?.y),
      x2: coordinate(raw?.x2),
      y2: coordinate(raw?.y2),
      points,
      text: cleanText(raw?.text, 500),
      color: /^#[0-9a-f]{6}$/i.test(raw?.color) ? raw.color : "#f4c875",
      fill: /^#[0-9a-f]{6}$/i.test(raw?.fill) ? raw.fill : "#b94b42",
      fillOpacity: Math.max(0, Math.min(1, Number(raw?.fillOpacity) || 0.18)),
      opacity: Math.max(0.05, Math.min(1, Number(raw?.opacity) || 1)),
      strokeWidth: Math.max(1, Math.min(20, Number(raw?.strokeWidth) || 3)),
      hidden: Boolean(raw?.hidden),
      locked: Boolean(raw?.locked),
      z: Math.max(-1000, Math.min(1000, Number(raw?.z) || 50))
    };
  }).filter(Boolean);
  const pingSource = incoming.ping && typeof incoming.ping === "object" ? incoming.ping : null;
  const ping = pingSource && Date.now() - Number(pingSource.at || 0) < 10000 ? {
    id: cleanText(pingSource.id, 80) || `${Number(pingSource.at) || Date.now()}-${cleanText(pingSource.by, 20)}`,
    x: normalizeCoordinate(pingSource.x), y: normalizeCoordinate(pingSource.y),
    color: /^#[0-9a-f]{6}$/i.test(pingSource.color) ? pingSource.color : "#f4c875",
    at: Number(pingSource.at) || Date.now(), by: cleanText(pingSource.by, 60)
  } : null;
  const diceCandidates = Array.isArray(incoming.diceRolls) ? incoming.diceRolls : [];
  if (incoming.diceRoll && typeof incoming.diceRoll === "object") diceCandidates.push(incoming.diceRoll);
  const diceRolls = [...new Map(diceCandidates.map(source => normalizeSceneDiceRoll(source, normalizeCoordinate)).filter(Boolean).sort((a,b) => a.at-b.at).map(roll => [roll.id,roll])).values()].slice(-MAX_ACTIVE_TABLE_ROLLS);
  const diceRoll = diceRolls.at(-1) || null;
  const tokenIds = new Set(tokens.map(token => token.id));
  const initiativeSource = incoming.initiative && typeof incoming.initiative === "object" ? incoming.initiative : {};
  return {
    schemaVersion: 6,
    id: cleanText(incoming.id, 80) || base.id,
    name: cleanText(incoming.name, 60) || base.name,
    published: incoming.published !== false,
    backgroundUrl: cleanText(incoming.backgroundUrl, 1000),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(incoming.backgroundColor) ? incoming.backgroundColor : base.backgroundColor,
    grid,
    tokens,
    objects,
    annotations,
    ping,
    diceRoll,
    diceRolls,
    combatSettings: {
      actionPolicy: ["free","soft","strict"].includes(incoming.combatSettings?.actionPolicy) ? incoming.combatSettings.actionPolicy : "soft"
    },
    initiative: {
      active: Boolean(initiativeSource.active) && tokens.some(token => token.initiative !== null),
      round: Math.max(1, Math.min(999, Number(initiativeSource.round) || 1)),
      currentTokenId: tokenIds.has(cleanText(initiativeSource.currentTokenId, 80)) ? cleanText(initiativeSource.currentTokenId, 80) : "",
      turnState: initiativeSource.turnState && tokenIds.has(cleanText(initiativeSource.turnState.tokenId,80)) ? {
        tokenId:cleanText(initiativeSource.turnState.tokenId,80),
        actions:Math.max(0,Math.min(5,Number(initiativeSource.turnState.actions)||0)),
        bonusActions:Math.max(0,Math.min(3,Number(initiativeSource.turnState.bonusActions)||0)),
        reactionAvailable:initiativeSource.turnState.reactionAvailable !== false,
        attacksRemaining:Math.max(0,Math.min(10,Number(initiativeSource.turnState.attacksRemaining)||0)),
        attacksPerAction:Math.max(1,Math.min(10,Number(initiativeSource.turnState.attacksPerAction)||1)),
        startedAt:Math.max(0,Number(initiativeSource.turnState.startedAt)||Date.now())
      } : null,
      resources: Object.fromEntries(Object.entries(initiativeSource.resources && typeof initiativeSource.resources === "object" ? initiativeSource.resources : {}).filter(([tokenId])=>tokenIds.has(tokenId)).map(([tokenId,value])=>[tokenId,{
        reactionAvailable:value?.reactionAvailable !== false,
        actionSurge:Math.max(0,Math.min(2,Number(value?.actionSurge)||0))
      }]))
    },
    createdAt: Math.max(0, Number(incoming.createdAt) || Date.now()),
    updatedAt: Math.max(0, Number(incoming.updatedAt) || Date.now())
  };
}

function normalizeAsset(raw, roomCodeValue = "") {
  if (!raw || typeof raw !== "object") return null;
  const assetId = cleanText(raw.id, 80);
  const filename = cleanText(raw.filename, 160).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!assetId || !filename) return null;
  const category = ["token", "map", "prop"].includes(raw.category) ? raw.category : "token";
  return {
    id: assetId,
    name: cleanText(raw.name, 80) || "Безымянный ресурс",
    category,
    filename,
    url: `/assets/${cleanText(roomCodeValue, 8)}/${filename}`,
    mimeType: ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(raw.mimeType) ? raw.mimeType : "image/png",
    bytes: Math.max(0, Math.min(20 * 1024 * 1024, Number(raw.bytes) || 0)),
    width: Math.max(0, Math.min(20000, Number(raw.width) || 0)),
    height: Math.max(0, Math.min(20000, Number(raw.height) || 0)),
    defaultSize: Math.max(0.25, Math.min(30, Number(raw.defaultSize) || (category === "map" ? 20 : 1))),
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map(tag => cleanText(tag, 30)).filter(Boolean))].slice(0, 20) : [],
    hash: cleanText(raw.hash, 128),
    createdAt: Math.max(0, Number(raw.createdAt) || Date.now())
  };
}

function normalizeAssets(source, roomCodeValue = "") {
  const ids = new Set();
  return (Array.isArray(source) ? source : []).slice(0, 2000).map(raw => normalizeAsset(raw, roomCodeValue)).filter(asset => {
    if (!asset || ids.has(asset.id)) return false;
    ids.add(asset.id);
    return true;
  });
}

function ensureRoomVtt(room) {
  if (!room || typeof room !== "object") return;
  const legacyScene = normalizeScene(room.scene, room.players || {});
  const incomingScenes = Array.isArray(room.scenes) && room.scenes.length ? room.scenes : [legacyScene];
  const ids = new Set();
  room.scenes = incomingScenes.slice(0, 100).map(scene => normalizeScene(scene, room.players || {})).filter(scene => {
    if (ids.has(scene.id)) scene.id = id();
    ids.add(scene.id);
    return true;
  });
  if (!room.scenes.length) room.scenes = [defaultScene()];
  room.activeSceneId = ids.has(cleanText(room.activeSceneId, 80)) ? cleanText(room.activeSceneId, 80) : room.scenes[0].id;
  room.assets = normalizeAssets(room.assets, room.code);
  room.combatRequests = (Array.isArray(room.combatRequests) ? room.combatRequests : []).slice(-100).map(raw => ({
    id:cleanText(raw?.id,80) || id(), requesterId:cleanText(raw?.requesterId,80), tokenId:cleanText(raw?.tokenId,80),
    kind:["damage","healing","temp"].includes(raw?.kind) ? raw.kind : "damage", amount:Math.max(0,Math.min(1000000,Number(raw?.amount)||0)),
    label:cleanText(raw?.label,120), status:["pending","accepted","rejected"].includes(raw?.status) ? raw.status : "pending", at:Number(raw?.at)||Date.now()
  })).filter(request => request.requesterId && request.tokenId && request.amount > 0);
  room.combatCards = (Array.isArray(room.combatCards) ? room.combatCards : []).slice(-100).map(raw => ({
    id:cleanText(raw?.id,80) || id(),
    playerId:cleanText(raw?.playerId,80),
    player:cleanText(raw?.player,60),
    attackId:cleanText(raw?.attackId,80),
    attackName:cleanText(raw?.attackName,100) || "Атака",
    targetId:cleanText(raw?.targetId,80),
    targetName:cleanText(raw?.targetName,80),
    total:Math.max(-1000,Math.min(10000,Number(raw?.total)||0)),
    natural:Math.max(0,Math.min(20,Number(raw?.natural)||0)),
    hit:raw?.hit === null || raw?.hit === undefined ? null : Boolean(raw.hit),
    critical:Boolean(raw?.critical), fumble:Boolean(raw?.fumble),
    targetAc:Math.max(0,Math.min(1000,Number(raw?.targetAc)||0)),
    damageTotal:raw?.damageTotal === null || raw?.damageTotal === undefined ? null : Math.max(0,Math.min(1000000,Number(raw.damageTotal)||0)),
    damageApplied:Boolean(raw?.damageApplied),
    visibility:["private","gm"].includes(raw?.visibility) ? raw.visibility : "public",
    at:Math.max(0,Number(raw?.at)||Date.now())
  })).filter(card => card.playerId && card.attackId);
  room.scene = room.scenes.find(scene => scene.id === room.activeSceneId) || room.scenes[0];
}

function activeScene(room) {
  ensureRoomVtt(room);
  return normalizeScene(room.scenes.find(scene => scene.id === room.activeSceneId) || room.scenes[0], room.players || {});
}

function setActiveScene(room, scene) {
  ensureRoomVtt(room);
  const normalized = normalizeScene({ ...scene, id: room.activeSceneId, updatedAt: Date.now() }, room.players || {});
  const index = room.scenes.findIndex(entry => entry.id === room.activeSceneId);
  if (index >= 0) room.scenes[index] = normalized;
  else room.scenes.push(normalized);
  room.scene = normalized;
  return normalized;
}

function sceneHistoryKey(room, sceneId = room.activeSceneId) {
  return `${room.code}:${sceneId}`;
}

function sceneHistoryState(room, sceneId = room.activeSceneId) {
  const key = sceneHistoryKey(room, sceneId);
  if (!sceneHistories.has(key)) sceneHistories.set(key, { undo: [], redo: [] });
  return sceneHistories.get(key);
}

function rememberScene(room, scene) {
  const history = sceneHistoryState(room, scene.id);
  history.undo.push(structuredClone(scene));
  if (history.undo.length > 60) history.undo.shift();
  history.redo = [];
}

function restoreSceneFromHistory(room, direction) {
  const current = activeScene(room);
  const history = sceneHistoryState(room, current.id);
  const from = direction === "redo" ? history.redo : history.undo;
  const to = direction === "redo" ? history.undo : history.redo;
  const snapshot = from.pop();
  if (!snapshot) return null;
  to.push(structuredClone(current));
  if (to.length > 60) to.shift();
  return setActiveScene(room, { ...snapshot, id: current.id });
}

function sceneFreeCoordinate(value) {
  return Math.max(-500, Math.min(500, Math.round((Number(value) || 0) * 10) / 10));
}

function sceneCoordinate(scene, value) {
  const number = Number(value) || 0;
  const positioned = scene.grid.snap ? Math.round(number) : Math.round(number * 10) / 10;
  return Math.max(-500, Math.min(500, positioned));
}

function translateAnnotation(annotation, dx, dy, scene) {
  const moveX = Number(dx) || 0;
  const moveY = Number(dy) || 0;
  const coordinate = annotation.kind === "draw" ? sceneFreeCoordinate : value => sceneCoordinate(scene, value);
  annotation.x = coordinate(annotation.x + moveX);
  annotation.y = coordinate(annotation.y + moveY);
  annotation.x2 = coordinate(annotation.x2 + moveX);
  annotation.y2 = coordinate(annotation.y2 + moveY);
  annotation.points = (annotation.points || []).map(point => ({
    x: coordinate(point.x + moveX),
    y: coordinate(point.y + moveY)
  }));
}

function sceneSummaries(room, viewerId = "") {
  ensureRoomVtt(room);
  const isDm = viewerId === room.dmId;
  return room.scenes.filter(scene => isDm || scene.id === room.activeSceneId && scene.published !== false).map(scene => ({
    id: scene.id,
    name: scene.name,
    published: scene.published !== false,
    active: scene.id === room.activeSceneId,
    tokenCount: scene.tokens.filter(token => isDm || !token.hidden).length,
    objectCount: scene.objects.filter(object => isDm || !object.hidden).length,
    annotationCount: scene.annotations.filter(annotation => isDm || !annotation.hidden).length,
    updatedAt: scene.updatedAt
  }));
}

function assetUsageCount(room, assetId) {
  ensureRoomVtt(room);
  return room.scenes.reduce((sum, scene) => sum + scene.tokens.filter(token => token.assetId === assetId).length + scene.objects.filter(object => object.assetId === assetId).length, 0);
}

function nextScenePosition(scene) {
  const occupied = new Set(scene.tokens.map(token => `${token.x}:${token.y}`));
  for (let y = 0; y < scene.grid.rows; y += 1) {
    for (let x = 0; x < scene.grid.columns; x += 1) if (!occupied.has(`${x}:${y}`)) return { x, y };
  }
  return { x: 0, y: 0 };
}

function sceneTokenForPlayer(scene, playerId) {
  return scene.tokens.find(token => token.playerId === playerId);
}

function tokenCombatState(room, token) {
  const player = token?.playerId ? room.players?.[token.playerId] : null;
  const sheet = player?.sheet;
  if (sheet) return {
    hp:Math.max(0,Number(sheet.hpCurrent)||0), hpMax:Math.max(1,Number(sheet.hpMax)||1), tempHp:Math.max(0,Number(sheet.hpTemp)||0),
    ac:Math.max(0,Number(sheet.ac)||10), conditions:Array.isArray(sheet.conditions) ? sheet.conditions : [],
    concentration:cleanText(sheet.concentrationSpellName,120), deathSuccess:Math.max(0,Math.min(3,Number(sheet.deathSuccess)||0)),
    deathFail:Math.max(0,Math.min(3,Number(sheet.deathFail)||0)), stable:Boolean(sheet.stable)
  };
  return {
    hp:Math.max(0,Number(token?.hp)||0), hpMax:Math.max(1,Number(token?.hpMax)||1), tempHp:Math.max(0,Number(token?.tempHp)||0),
    ac:Math.max(0,Number(token?.ac)||10), conditions:Array.isArray(token?.conditions) ? token.conditions : [],
    concentration:cleanText(token?.concentration,120), deathSuccess:Math.max(0,Math.min(3,Number(token?.deathSuccess)||0)),
    deathFail:Math.max(0,Math.min(3,Number(token?.deathFail)||0)), stable:Boolean(token?.stable)
  };
}

function updateTokenCombatState(room, token, patch = {}) {
  const player = token?.playerId ? room.players?.[token.playerId] : null;
  const target = player?.sheet || token;
  if (!target) return null;
  const keys = player ? { hp:"hpCurrent", hpMax:"hpMax", tempHp:"hpTemp", conditions:"conditions", concentration:"concentrationSpellName", deathSuccess:"deathSuccess", deathFail:"deathFail", stable:"stable" }
    : { hp:"hp", hpMax:"hpMax", tempHp:"tempHp", conditions:"conditions", concentration:"concentration", deathSuccess:"deathSuccess", deathFail:"deathFail", stable:"stable" };
  if (patch.hpMax !== undefined) target[keys.hpMax] = Math.max(1,Math.min(1000000,Number(patch.hpMax)||1));
  const hpMax = Math.max(1,Number(target[keys.hpMax])||1);
  if (patch.hp !== undefined) target[keys.hp] = Math.max(0,Math.min(hpMax,Number(patch.hp)||0));
  if (patch.tempHp !== undefined) target[keys.tempHp] = Math.max(0,Math.min(1000000,Number(patch.tempHp)||0));
  if (patch.conditions !== undefined) target[keys.conditions] = [...new Set((Array.isArray(patch.conditions) ? patch.conditions : []).map(value => cleanText(value,40)).filter(value => COMBAT_CONDITIONS.includes(value)))];
  if (patch.concentration !== undefined) {
    target[keys.concentration] = cleanText(patch.concentration,120);
    if (player && !target[keys.concentration]) target.concentrationSpellId = "";
  }
  if (patch.deathSuccess !== undefined) target[keys.deathSuccess] = Math.max(0,Math.min(3,Number(patch.deathSuccess)||0));
  if (patch.deathFail !== undefined) target[keys.deathFail] = Math.max(0,Math.min(3,Number(patch.deathFail)||0));
  if (patch.stable !== undefined) target[keys.stable] = Boolean(patch.stable);
  if (player) player.sheet = normalizeSheet(target, player.name);
  return tokenCombatState(room, token);
}

function applyCombatAmount(room, token, kind, amount) {
  const state = tokenCombatState(room, token);
  amount = Math.max(0,Math.min(1000000,Number(amount)||0));
  if (!amount) return { state, before:state, applied:0, absorbed:0, hpDelta:0, concentrationDc:0 };
  if (kind === "temp") {
    const nextTemp = Math.max(state.tempHp, amount);
    const next = updateTokenCombatState(room, token, { tempHp:nextTemp });
    return { state:next, before:state, applied:nextTemp - state.tempHp, absorbed:0, hpDelta:0, concentrationDc:0 };
  }
  if (kind === "healing") {
    const nextHp = Math.min(state.hpMax, state.hp + amount);
    const patch = { hp:nextHp };
    if (nextHp > 0) Object.assign(patch,{ deathSuccess:0, deathFail:0, stable:false, conditions:state.conditions.filter(value => value !== "Без сознания") });
    const next = updateTokenCombatState(room, token, patch);
    return { state:next, before:state, applied:nextHp - state.hp, absorbed:0, hpDelta:nextHp - state.hp, concentrationDc:0 };
  }
  const absorbed = Math.min(state.tempHp, amount);
  const hpDamage = Math.max(0, amount - absorbed);
  const nextHp = Math.max(0, state.hp - hpDamage);
  const conditions = nextHp === 0 && !state.conditions.includes("Без сознания") ? [...state.conditions,"Без сознания"] : state.conditions;
  const actualHpDamage = state.hp - nextHp;
  const effectiveDamage = absorbed + actualHpDamage;
  const next = updateTokenCombatState(room, token, { hp:nextHp, tempHp:state.tempHp - absorbed, stable:false, conditions, ...(nextHp === 0 ? { concentration:"" } : {}) });
  return {
    state:next,
    before:state,
    applied:effectiveDamage,
    absorbed,
    hpDelta:-actualHpDamage,
    concentrationDc:state.concentration && nextHp > 0 && effectiveDamage > 0 ? Math.max(10,Math.floor(effectiveDamage / 2)) : 0,
    concentrationBroken:Boolean(state.concentration && nextHp === 0)
  };
}

function combatResultDetail(token, kind, requested, result) {
  const before = result.before || result.state;
  const after = result.state;
  if (kind === "damage") {
    const parts = [`${token.name} получает ${result.applied} урона`];
    if (result.absorbed) parts.push(`${result.absorbed} поглощено временными HP`);
    parts.push(`HP ${before.hp}/${before.hpMax} → ${after.hp}/${after.hpMax}${after.tempHp ? ` (+${after.tempHp})` : ""}`);
    if (requested > result.applied) parts.push(`из ${requested} заявленного`);
    if (result.concentrationDc) parts.push(`концентрация: СЛ ${result.concentrationDc}`);
    if (result.concentrationBroken) parts.push("концентрация прервана при 0 HP");
    return parts.join(" · ");
  }
  if (kind === "healing") return `${token.name} восстанавливает ${result.applied} HP · ${before.hp}/${before.hpMax} → ${after.hp}/${after.hpMax}`;
  return `${token.name} получает ${result.applied} временных HP · ${before.tempHp} → ${after.tempHp}`;
}

function appendActivity(room, playerId, label, detail, visibility = "public") {
  const player = room.players?.[playerId];
  room.rollLog.push({ id:id(), playerId, player:player?.name || "Ведущий", label:cleanText(label,80), activity:cleanText(detail,180), total:null, visibility:["private","gm"].includes(visibility) ? visibility : "public", at:Date.now() });
  room.rollLog = room.rollLog.slice(-100);
}

function sheetClassLevel(sheet, key) {
  const classes = Array.isArray(sheet?.classes) ? sheet.classes : [];
  const found = classes.find(entry => cleanText(entry?.key,30) === key);
  if (found) return Math.max(0,Number(found.level)||0);
  return cleanText(sheet?.classKey,30) === key ? Math.max(0,Number(sheet?.level)||0) : 0;
}

function attacksPerActionForSheet(sheet) {
  const fighter = sheetClassLevel(sheet,"fighter");
  if (fighter >= 20) return 4;
  if (fighter >= 11) return 3;
  if (fighter >= 5) return 2;
  if (["barbarian","monk","paladin","ranger"].some(key => sheetClassLevel(sheet,key) >= 5)) return 2;
  const bard = (Array.isArray(sheet?.classes) ? sheet.classes : []).find(entry => cleanText(entry?.key,30) === "bard");
  if (Number(bard?.level) >= 6 && /доблест|меч/i.test(cleanText(bard?.subclass,80))) return 2;
  return 1;
}

function actionSurgeMaxForSheet(sheet) {
  const level = sheetClassLevel(sheet,"fighter");
  return level >= 17 ? 2 : level >= 2 ? 1 : 0;
}

function ensureInitiativeResources(room, scene, token) {
  scene.initiative.resources ||= {};
  const sheet = token?.playerId ? room.players?.[token.playerId]?.sheet : null;
  const maxSurge = sheet ? actionSurgeMaxForSheet(sheet) : 0;
  const saved = scene.initiative.resources[token.id] || {};
  scene.initiative.resources[token.id] = {
    reactionAvailable:saved.reactionAvailable !== false,
    actionSurge:Math.max(0,Math.min(maxSurge,Number.isFinite(Number(saved.actionSurge)) ? Number(saved.actionSurge) : maxSurge))
  };
  return scene.initiative.resources[token.id];
}

function beginTurn(room, scene, token) {
  if (!token) {
    scene.initiative.currentTokenId = "";
    scene.initiative.turnState = null;
    return null;
  }
  const sheet = token.playerId ? room.players?.[token.playerId]?.sheet : null;
  const attacksPerAction = sheet ? attacksPerActionForSheet(sheet) : 1;
  const resources = ensureInitiativeResources(room,scene,token);
  resources.reactionAvailable = true;
  scene.initiative.currentTokenId = token.id;
  scene.initiative.turnState = { tokenId:token.id, actions:1, bonusActions:1, reactionAvailable:true, attacksRemaining:0, attacksPerAction, startedAt:Date.now() };
  return token;
}

function advanceInitiative(room, scene) {
  const order = initiativeOrder(scene);
  if (!order.length) return null;
  const currentIndex = order.findIndex(token => token.id === scene.initiative.currentTokenId);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % order.length;
  if (currentIndex >= 0 && nextIndex === 0) scene.initiative.round = Math.min(999,scene.initiative.round + 1);
  scene.initiative.active = true;
  return beginTurn(room,scene,order[nextIndex]);
}

function initiativeOrder(scene) {
  return scene.tokens.filter(token => token.initiative !== null).sort((a, b) => Number(b.initiative) - Number(a.initiative) || a.name.localeCompare(b.name, "ru"));
}

function defaultSheet(playerName) {
  return {
    schemaVersion: 10,
    characterName: playerName,
    diceColor: "#d3ad6e",
    vttUiMode: "veteran",
    vttHotbar: Array(10).fill(null),
    classKey: "",
    subclassKey: "",
    raceKey: "",
    backgroundKey: "",
    className: "",
    subclass: "",
    classes: [],
    levelProgression: [],
    abilityAdvancements: [],
    feats: [],
    level: 1,
    race: "",
    ancestryTraits: "",
    size: "Средний",
    background: "",
    creationMethod: "manual",
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
    passivePerceptionBonus: 0,
    speed: 30,
    hpMax: 10,
    hpCurrent: 10,
    hpTemp: 0,
    hitDice: "1к8",
    hitDieSize: 8,
    hitDiceMax: 1,
    hitDiceCurrent: 1,
    hitDicePools: [],
    deathSuccess: 0,
    deathFail: 0,
    stable: false,
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
    combatLoadout: defaultCombatLoadout(),
    spellcastingAbility: "",
    spellSlots: Array.from({ length: 9 }, (_, index) => ({ level: index + 1, total: 0, used: 0 })),
    pactSlots: { level: 0, total: 0, used: 0 },
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
  const legacyLevel = Math.max(1, Math.min(20, Number(incoming.level) || 1));
  const sourceClasses = Array.isArray(incoming.classes) && incoming.classes.length
    ? incoming.classes
    : (incoming.classKey ? [{ key: incoming.classKey, name: incoming.className, subclass: incoming.subclass, level: legacyLevel, hitDie: incoming.hitDieSize, spellAbility: incoming.spellcastingAbility }] : []);
  let remainingLevels = 20;
  const normalizedClasses = [];
  sourceClasses.forEach((entry, index) => {
    if (remainingLevels <= 0) return;
    const classLevel = Math.max(1, Math.min(remainingLevels, Number(entry?.level) || 1));
    remainingLevels -= classLevel;
    normalizedClasses.push({
      key: cleanText(entry?.key || entry?.classKey, 30),
      name: cleanText(entry?.name, 60),
      subclass: cleanText(entry?.subclass, 80),
      level: classLevel,
      hitDie: Math.max(4, Math.min(20, Number(entry?.hitDie) || (index === 0 ? Number(incoming.hitDieSize) || 8 : 8))),
      spellAbility: cleanText(entry?.spellAbility, 8)
    });
  });
  for (let index = normalizedClasses.length - 1; index >= 0; index -= 1) {
    if (!normalizedClasses[index].key || normalizedClasses[index].level <= 0) normalizedClasses.splice(index, 1);
  }
  const totalLevel = normalizedClasses.length ? normalizedClasses.reduce((sum, entry) => sum + entry.level, 0) : legacyLevel;
  const generatedProgression = normalizedClasses.flatMap(entry => Array.from({ length: entry.level }, (_, index) => ({
    level: 0,
    classKey: entry.key,
    classLevel: index + 1
  }))).map((entry, index) => ({ ...entry, level: index + 1 }));
  const savedProgression = Array.isArray(incoming.levelProgression) && incoming.levelProgression.length === totalLevel
    ? incoming.levelProgression.slice(0, 20).map((entry, index) => ({
        level: index + 1,
        classKey: cleanText(entry?.classKey, 30),
        classLevel: Math.max(1, Number(entry?.classLevel) || 1),
        choice: cleanText(entry?.choice, 80)
      }))
    : generatedProgression;
  const legacyPool = [{
    sides: Math.max(4, Math.min(20, Number(incoming.hitDieSize) || 8)),
    total: Math.max(1, Number(incoming.hitDiceMax) || totalLevel),
    current: Math.max(0, Number(incoming.hitDiceCurrent ?? incoming.hitDiceMax ?? totalLevel))
  }];
  const normalizedPools = (Array.isArray(incoming.hitDicePools) && incoming.hitDicePools.length ? incoming.hitDicePools : legacyPool)
    .map(pool => {
      const total = Math.max(0, Math.min(20, Number(pool?.total) || 0));
      return { sides: Math.max(4, Math.min(20, Number(pool?.sides) || 8)), total, current: Math.max(0, Math.min(total, Number(pool?.current) || 0)) };
    }).filter(pool => pool.total > 0);
  const normalizeParts = parts => Array.isArray(parts) ? parts.slice(0, 16).map(part => ({
    id: cleanText(part?.id, 80),
    type: cleanText(part?.type, 24),
    value: cleanText(part?.value, 24),
    count: Math.max(1, Math.min(100, Number(part?.count) || 1)),
    sides: Math.max(2, Math.min(1000, Number(part?.sides) || 6))
  })).filter(part => ["ability","proficiency","dice","flat","sneak","martial","rage","spell","smite","superiority"].includes(part.type)) : [];
  const inventoryIdRemap = new Map();
  const normalizedInventory = [];
  const stackIndexes = new Map();
  (Array.isArray(incoming.inventoryList) ? incoming.inventoryList : []).slice(0, 1000).forEach(rawItem => {
    const legacyCatalogKey = cleanText(rawItem?.catalogKey || rawItem?.key, 80);
    const canonical = itemSystem.canonicalizeInventoryItem(rawItem || {});
    const item = {
      ...rawItem,
      id: cleanText(rawItem?.id, 80) || id(),
      name: cleanText(canonical.name, 120),
      originalName: cleanText(rawItem?.originalName, 160),
      type: cleanText(rawItem?.type, 30),
      catalogKey: cleanText(canonical.catalogKey, 80),
      baseCatalogKey: cleanText(canonical.baseCatalogKey, 80),
      catalogCategory: cleanText(rawItem?.catalogCategory, 30),
      magicCategory: cleanText(rawItem?.magicCategory, 30),
      combatKind: cleanText(rawItem?.combatKind, 30),
      slotHint: COMBAT_SLOT_KEYS.includes(rawItem?.slotHint) ? rawItem.slotHint : "",
      quantity: Math.max(0, Math.min(999999, Number.isFinite(Number(rawItem?.quantity)) ? Number(rawItem.quantity) : 1)),
      weight: Math.max(0, Math.min(999999, Number(rawItem?.weight) || 0)),
      description: cleanText(rawItem?.description, 6000),
      properties: cleanText(rawItem?.properties, 600),
      damage: cleanText(rawItem?.damage, 80),
      damageType: cleanText(rawItem?.damageType, 40),
      ability: cleanText(rawItem?.ability, 20),
      useFormula: cleanText(rawItem?.useFormula, 100),
      useCondition: COMBAT_CONDITIONS.includes(cleanText(rawItem?.useCondition,40)) ? cleanText(rawItem?.useCondition,40) : "",
      useConcentration: Boolean(rawItem?.useConcentration),
      rarity: cleanText(rawItem?.rarity, 40),
      source: cleanText(rawItem?.source, 80),
      costUnit: cleanText(rawItem?.costUnit, 8),
      costValue: Math.max(0, Math.min(999999999, Number(rawItem?.costValue) || 0)),
      rangeNormal: Math.max(0, Math.min(100000, Number(rawItem?.rangeNormal) || 0)),
      rangeLong: Math.max(0, Math.min(100000, Number(rawItem?.rangeLong) || 0)),
      baseAc: Math.max(0, Math.min(100, Number(rawItem?.baseAc) || 0)),
      armorType: cleanText(rawItem?.armorType, 20),
      strengthMinimum: Math.max(0, Math.min(30, Number(rawItem?.strengthMinimum) || itemSystem.strengthRequirements[canonical.baseCatalogKey || canonical.catalogKey] || 0)),
      magicBonus: Math.max(-10, Math.min(10, Number(canonical.magicBonus) || 0)),
      equipped: Boolean(rawItem?.equipped),
      attuned: Boolean(rawItem?.attuned),
      magical: Boolean(rawItem?.magical),
      requiresAttunement: Boolean(rawItem?.requiresAttunement),
      stealthDisadvantage: Boolean(rawItem?.stealthDisadvantage)
    };
    if (["arrows","bolts"].includes(legacyCatalogKey) && Number(item.quantity) === 1) {
      item.quantity = 20;
      item.weight = item.catalogKey === "arrow" ? 0.05 : 0.075;
      item.name = item.catalogKey === "arrow" ? "Стрелы, 20" : "Арбалетные болты, 20";
      item.combatKind = "ammo";
      item.catalogCategory = "ammo";
    }
    if (item.catalogKey === "magic-potion-of-healing-common") {
      item.combatKind ||= "consumable";
      item.catalogCategory ||= "potion";
      item.useFormula ||= "2к4+2";
      item.magical = true;
    }
    const stackKey = item.catalogKey && itemSystem.isStackable(item) ? `${item.catalogKey}|${item.baseCatalogKey || ""}` : "";
    if (stackKey && stackIndexes.has(stackKey)) {
      const existing = normalizedInventory[stackIndexes.get(stackKey)];
      inventoryIdRemap.set(item.id, existing.id);
      existing.quantity = Math.min(999999, Number(existing.quantity || 0) + Number(item.quantity || 0));
      existing.equipped ||= item.equipped;
      existing.attuned ||= item.attuned;
      existing.magical ||= item.magical;
      existing.requiresAttunement ||= item.requiresAttunement;
      if (!existing.description && item.description) existing.description = item.description;
      if (!existing.useFormula && item.useFormula) existing.useFormula = item.useFormula;
      return;
    }
    if (stackKey) stackIndexes.set(stackKey, normalizedInventory.length);
    inventoryIdRemap.set(item.id, item.id);
    normalizedInventory.push(item);
  });
  const normalizedAttacks = (Array.isArray(incoming.attacksList) ? incoming.attacksList : []).slice(0, 100).map(attack => ({
    ...attack,
    id: cleanText(attack?.id, 80),
    sourceItemId: inventoryIdRemap.get(cleanText(attack?.sourceItemId, 80)) || cleanText(attack?.sourceItemId, 80),
    name: cleanText(attack?.name, 100),
    bonus: cleanText(attack?.bonus, 120),
    damage: cleanText(attack?.damage, 160),
    damageType: cleanText(attack?.damageType, 40),
    notes: cleanText(attack?.notes, 1000),
    actionCost: ["action","bonus","reaction","free"].includes(attack?.actionCost) ? attack.actionCost : "action",
    rollMode: ["inherit","normal","advantage","disadvantage"].includes(attack?.rollMode) ? attack.rollMode : "inherit",
    attackParts: normalizeParts(attack?.attackParts),
    damageParts: normalizeParts(attack?.damageParts)
  }));
  const normalizedSpells = (Array.isArray(incoming.spellsList) ? incoming.spellsList : []).slice(0, 500).map(spell => ({
    ...spell,
    id: cleanText(spell?.id, 80),
    name: cleanText(spell?.name, 120),
    catalogKey: cleanText(spell?.catalogKey, 80),
    sourceClassKey: cleanText(spell?.sourceClassKey, 30),
    school: cleanText(spell?.school, 80),
    castingTime: cleanText(spell?.castingTime, 100),
    range: cleanText(spell?.range, 100),
    duration: cleanText(spell?.duration, 100),
    damage: cleanText(spell?.damage, 180),
    description: cleanText(spell?.description, 6000),
    rollKind: ["damage","healing","none"].includes(spell?.rollKind) ? spell.rollKind : "",
    effectParts: normalizeParts(spell?.effectParts),
    upcastParts: normalizeParts(spell?.upcastParts)
  }));
  const normalized = {
    ...base,
    ...incoming,
    stats: { ...base.stats, ...(incoming.stats || {}) },
    coins: { ...base.coins, ...(incoming.coins || {}) },
    conditions: Array.isArray(incoming.conditions) ? incoming.conditions : [],
    attacksList: normalizedAttacks,
    resources: Array.isArray(incoming.resources) ? incoming.resources : [],
    inventoryList: normalizedInventory,
    combatLoadout: normalizeCombatLoadout(incoming.combatLoadout, normalizedInventory, inventoryIdRemap),
    spellsList: normalizedSpells,
    goalsList: Array.isArray(incoming.goalsList) ? incoming.goalsList : [],
    notesList: Array.isArray(incoming.notesList) ? incoming.notesList : [],
    classes: normalizedClasses,
    levelProgression: savedProgression,
    abilityAdvancements: Array.isArray(incoming.abilityAdvancements) ? incoming.abilityAdvancements.slice(0, 20) : [],
    feats: Array.isArray(incoming.feats) ? incoming.feats.slice(0, 30) : [],
    hitDicePools: normalizedPools,
    pactSlots: { ...base.pactSlots, ...(incoming.pactSlots || {}) },
    spellSlots: normalizedSlots
  };
  normalized.schemaVersion = 10;
  normalized.diceColor = normalizeDiceColor(incoming.diceColor, base.diceColor);
  normalized.vttUiMode = incoming.vttUiMode === "assistant" ? "assistant" : "veteran";
  normalized.vttHotbar = Array.from({ length:10 }, (_, index) => {
    const raw = Array.isArray(incoming.vttHotbar) ? incoming.vttHotbar[index] : null;
    if (!raw || typeof raw !== "object") return null;
    const kind = ["attack","quick","skill","save","ability","formula","action"].includes(raw.kind) ? raw.kind : "";
    if (!kind) return null;
    return {
      kind,
      id:cleanText(raw.id,80),
      key:cleanText(raw.key,40),
      label:cleanText(raw.label,60),
      formula:cleanText(raw.formula,100),
      icon:cleanText(raw.icon,8),
      actionCost:["action","bonus","reaction","free"].includes(raw.actionCost) ? raw.actionCost : "free"
    };
  });
  normalized.passivePerceptionBonus = Math.max(-100, Math.min(100, Number(incoming.passivePerceptionBonus) || 0));
  normalized.stable = Boolean(incoming.stable);
  normalized.xp = Math.max(0, Math.min(999999999, Number(incoming.xp) || 0));
  normalized.skillProficiencies = Array.isArray(incoming.skillProficiencies) ? [...new Set(incoming.skillProficiencies.map(value => cleanText(value, 30)).filter(Boolean))] : [];
  normalized.expertise = Array.isArray(incoming.expertise) ? [...new Set(incoming.expertise.map(value => cleanText(value, 30)).filter(Boolean))] : [];
  normalized.level = totalLevel;
  if (normalizedClasses.length) {
    const primary = normalizedClasses[0];
    normalized.classKey = primary.key;
    normalized.className = primary.name || normalized.className;
    normalized.subclass = primary.subclass || normalized.subclass;
    normalized.hitDieSize = primary.hitDie;
    normalized.hitDiceMax = normalizedPools.reduce((sum, pool) => sum + pool.total, 0);
    normalized.hitDiceCurrent = normalizedPools.reduce((sum, pool) => sum + pool.current, 0);
  }
  if (!("autoProficiency" in incoming)) normalized.autoProficiency = false;
  if (!("autoSpellSlots" in incoming)) normalized.autoSpellSlots = false;
  if (!("autoArmorClass" in incoming)) normalized.autoArmorClass = false;
  if (!("hitDiceMax" in incoming)) normalized.hitDiceMax = Math.max(1, Number(normalized.level || 1));
  if (!("hitDiceCurrent" in incoming)) normalized.hitDiceCurrent = normalized.hitDiceMax;
  return normalized;
}

function publicRoom(room, viewerId = "") {
  ensureRoomVtt(room);
  const players = {};
  Object.entries(room.players).forEach(([playerId, player]) => {
    player.sheet = normalizeSheet(player.sheet, player.name);
    const { sheetHistory: _privateHistory, ...publicPlayer } = player;
    players[playerId] = publicPlayer;
  });
  const scene = activeScene(room);
  const isDm = viewerId === room.dmId;
  const canSeeSceneRoll = roll => {
    const visibility = ["private","gm"].includes(roll?.visibility) ? roll.visibility : "public";
    if (roll?.privateToDm) return isDm;
    if (visibility === "gm") return isDm;
    if (visibility === "private") return isDm || cleanText(roll?.playerId,80) === viewerId;
    return true;
  };
  scene.diceRolls = (Array.isArray(scene.diceRolls) ? scene.diceRolls : []).filter(canSeeSceneRoll);
  scene.diceRoll = canSeeSceneRoll(scene.diceRoll) ? scene.diceRoll : scene.diceRolls.at(-1) || null;
  if (!isDm) {
    scene.tokens = scene.tokens.filter(token => !token.hidden).map(token => {
      if (token.playerId) return token;
      const { ac: _secretAc, ...publicToken } = token;
      return publicToken;
    });
    scene.objects = scene.objects.filter(object => !object.hidden);
    scene.annotations = scene.annotations.filter(annotation => !annotation.hidden);
    const visibleTokenIds = new Set(scene.tokens.map(token => token.id));
    if (!visibleTokenIds.has(scene.initiative.currentTokenId)) scene.initiative.currentTokenId = "";
    if (!visibleTokenIds.has(scene.initiative.turnState?.tokenId)) scene.initiative.turnState = null;
    scene.initiative.resources = Object.fromEntries(Object.entries(scene.initiative.resources || {}).filter(([tokenId]) => visibleTokenIds.has(tokenId)));
    scene.initiative.active = scene.tokens.some(token => token.initiative !== null);
  }
  return {
    code: room.code,
    title: room.title,
    dmId: room.dmId,
    players,
    rollLog: (Array.isArray(room.rollLog) ? room.rollLog : []).filter(entry => {
      const visibility = ["private","gm"].includes(entry?.visibility) ? entry.visibility : "public";
      if (entry?.privateToDm) return isDm;
      if (visibility === "gm") return isDm;
      if (visibility === "private") return isDm || cleanText(entry?.playerId, 80) === viewerId;
      return true;
    }).slice(-100),
    combatRequests: room.combatRequests.filter(request => request.status === "pending" && (isDm || request.requesterId === viewerId)),
    combatCards: room.combatCards.filter(card => {
      if (card.visibility === "gm") return isDm;
      if (card.visibility === "private") return isDm || card.playerId === viewerId;
      return true;
    }).map(card => isDm ? card : ({ ...card, targetAc:0 })).slice(-100),
    scene,
    activeSceneId: room.activeSceneId,
    scenes: sceneSummaries(room, viewerId),
    assets: isDm ? room.assets.map(asset => ({ ...asset, usageCount: assetUsageCount(room, asset.id) })) : []
  };
}

async function emitRoom(code) {
  const room = rooms[code];
  if (!room) return;
  try {
    const sockets = await io.in(code).fetchSockets();
    sockets.forEach(roomSocket => roomSocket.emit("room:state", publicRoom(room, roomSocket.data?.clientId)));
  } catch (error) {
    console.error("Не удалось синхронизировать комнату:", error.message);
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.json({ limit: "22mb" }));
app.use("/assets", express.static(ASSET_DIR, { fallthrough: false, dotfiles: "deny", maxAge: "1h" }));

app.post("/api/rooms/:code/assets", async (req, res) => {
  const code = cleanText(req.params.code, 8).toUpperCase();
  const clientId = cleanText(req.get("x-client-id"), 80);
  const room = rooms[code];
  if (!room || room.dmId !== clientId) return res.status(403).json({ ok:false, error:"Только ведущий загружает ресурсы" });
  ensureRoomVtt(room);
  const category = ["token", "map", "prop"].includes(req.body?.category) ? req.body.category : "token";
  const dataUrl = String(req.body?.dataUrl || "");
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return res.status(400).json({ ok:false, error:"Поддерживаются PNG, JPG, WebP и GIF" });
  let buffer;
  try { buffer = Buffer.from(match[2], "base64"); } catch { return res.status(400).json({ ok:false, error:"Не удалось прочитать изображение" }); }
  if (!buffer.length || buffer.length > 15 * 1024 * 1024) return res.status(413).json({ ok:false, error:"Файл должен быть меньше 15 МБ" });
  const mimeType = match[1];
  if (!imageSignatureMatches(buffer, mimeType)) return res.status(400).json({ ok:false, error:"Содержимое файла не соответствует формату изображения" });
  const extension = { "image/png":"png", "image/jpeg":"jpg", "image/webp":"webp", "image/gif":"gif" }[mimeType];
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const duplicate = room.assets.find(asset => asset.hash === hash && asset.category === category);
  if (duplicate) return res.json({ ok:true, asset:{ ...duplicate, usageCount:assetUsageCount(room, duplicate.id) }, duplicate:true });
  const assetId = id();
  const filename = `${assetId}.${extension}`;
  const directory = path.join(ASSET_DIR, code);
  fs.mkdirSync(directory, { recursive:true });
  fs.writeFileSync(path.join(directory, filename), buffer);
  const asset = normalizeAsset({
    id:assetId,
    name:cleanText(req.body?.name, 80) || cleanText(req.body?.fileName, 80).replace(/\.[^.]+$/, "") || "Новый ресурс",
    category,
    filename,
    mimeType,
    bytes:buffer.length,
    width:Number(req.body?.width) || 0,
    height:Number(req.body?.height) || 0,
    defaultSize:Number(req.body?.defaultSize) || (category === "map" ? 20 : 1),
    tags:Array.isArray(req.body?.tags) ? req.body.tags : [],
    hash,
    createdAt:Date.now()
  }, code);
  room.assets.push(asset);
  saveRooms();
  await emitRoom(code);
  res.json({ ok:true, asset:{ ...asset, usageCount:0 } });
});

app.patch("/api/rooms/:code/assets/:assetId", async (req, res) => {
  const code = cleanText(req.params.code, 8).toUpperCase();
  const clientId = cleanText(req.get("x-client-id"), 80);
  const room = rooms[code];
  if (!room || room.dmId !== clientId) return res.status(403).json({ ok:false, error:"Только ведущий меняет библиотеку" });
  ensureRoomVtt(room);
  const asset = room.assets.find(entry => entry.id === cleanText(req.params.assetId, 80));
  if (!asset) return res.status(404).json({ ok:false, error:"Ресурс не найден" });
  asset.name = cleanText(req.body?.name ?? asset.name, 80) || asset.name;
  asset.category = ["token", "map", "prop"].includes(req.body?.category) ? req.body.category : asset.category;
  asset.defaultSize = Math.max(0.25, Math.min(30, Number(req.body?.defaultSize) || asset.defaultSize));
  asset.tags = Array.isArray(req.body?.tags) ? [...new Set(req.body.tags.map(tag => cleanText(tag,30)).filter(Boolean))].slice(0,20) : asset.tags;
  saveRooms();
  await emitRoom(code);
  res.json({ ok:true, asset:{ ...asset, usageCount:assetUsageCount(room, asset.id) } });
});

app.delete("/api/rooms/:code/assets/:assetId", async (req, res) => {
  const code = cleanText(req.params.code, 8).toUpperCase();
  const clientId = cleanText(req.get("x-client-id"), 80);
  const room = rooms[code];
  if (!room || room.dmId !== clientId) return res.status(403).json({ ok:false, error:"Только ведущий удаляет ресурсы" });
  ensureRoomVtt(room);
  const assetId = cleanText(req.params.assetId, 80);
  const asset = room.assets.find(entry => entry.id === assetId);
  if (!asset) return res.status(404).json({ ok:false, error:"Ресурс не найден" });
  const usageCount = assetUsageCount(room, assetId);
  const force = req.query.force === "1";
  if (usageCount && !force) return res.status(409).json({ ok:false, error:`Ресурс используется на сценах: ${usageCount}`, usageCount });
  if (force) {
    room.scenes.forEach(scene => {
      scene.tokens = scene.tokens.filter(token => token.assetId !== assetId);
      scene.objects = scene.objects.filter(object => object.assetId !== assetId);
    });
  }
  room.assets = room.assets.filter(entry => entry.id !== assetId);
  const filepath = path.join(ASSET_DIR, code, asset.filename);
  try { fs.rmSync(filepath, { force:true }); } catch {}
  ensureRoomVtt(room);
  saveRooms();
  await emitRoom(code);
  res.json({ ok:true });
});

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
      combatRequests: [],
      scene: defaultScene(),
      scenes: [],
      activeSceneId: "",
      assets: [],
      createdAt: Date.now()
    };
    ensureRoomVtt(rooms[code]);
    socket.join(code);
    socket.data = { code, clientId };
    saveRooms();
    reply({ ok: true, code, clientId, room: publicRoom(rooms[code], clientId) });
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
    reply({ ok: true, code, clientId, room: publicRoom(room, clientId) });
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
    room.scenes = Array.isArray(backup.scenes) ? backup.scenes.map(scene => normalizeScene(scene, restoredPlayers)) : [normalizeScene(backup.scene, restoredPlayers)];
    room.activeSceneId = cleanText(backup.activeSceneId, 80) || room.scenes[0]?.id || "";
    room.assets = normalizeAssets(backup.assets || room.assets, room.code);
    room.combatRequests = Array.isArray(backup.combatRequests) ? backup.combatRequests : [];
    ensureRoomVtt(room);
    room.rollLog = Array.isArray(backup.rollLog) ? backup.rollLog.slice(-100).map(entry => ({
      id:id(), playerId:cleanText(entry?.playerId, 80), player:cleanText(entry?.player, 40) || "Игрок", label:cleanText(entry?.label, 80), activity:cleanText(entry?.activity, 120),
      formula:cleanText(entry?.formula, 100), dice:Array.isArray(entry?.dice) ? entry.dice.slice(0,100).map(Number) : [], modifier:Number(entry?.modifier || 0),
      total:entry?.total === null ? null : Number(entry?.total || 0), mode:["advantage","disadvantage"].includes(entry?.mode) ? entry.mode : "normal", natural:Number(entry?.natural || 0) || null,
      visibility:["private","gm"].includes(entry?.visibility) ? entry.visibility : "public", privateToDm:Boolean(entry?.privateToDm), at:Number(entry?.at || Date.now())
    })) : [];
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:create", ({ name, activate = true } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий создаёт сцены" });
    ensureRoomVtt(room);
    if (room.scenes.length >= 100) return reply({ ok:false, error:"Достигнут лимит сцен" });
    const scene = defaultScene(cleanText(name, 60) || `Сцена ${room.scenes.length + 1}`);
    scene.published = Boolean(activate);
    room.scenes.push(scene);
    if (activate) {
      room.activeSceneId = scene.id;
      room.scene = scene;
    }
    saveRooms(); emitRoom(code); reply({ ok:true, scene });
  });

  socket.on("scene:duplicate", ({ sceneId, name, activate = true } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий копирует сцены" });
    ensureRoomVtt(room);
    const source = room.scenes.find(entry => entry.id === cleanText(sceneId,80)) || activeScene(room);
    if (!source) return reply({ ok:false, error:"Сцена не найдена" });
    const copy = structuredClone(source);
    copy.id = id();
    copy.name = cleanText(name,60) || `${source.name} — копия`;
    copy.tokens = copy.tokens.map(token => ({ ...token, id:id(), initiative:null }));
    copy.objects = copy.objects.map(object => ({ ...object, id:id() }));
    copy.annotations = (copy.annotations || []).map(annotation => ({ ...annotation, id:id() }));
    copy.initiative = { active:false, round:1, currentTokenId:"" };
    copy.published = Boolean(activate);
    copy.createdAt = Date.now(); copy.updatedAt = Date.now();
    const normalized = normalizeScene(copy, room.players);
    room.scenes.push(normalized);
    if (activate) { room.activeSceneId = normalized.id; room.scene = normalized; }
    saveRooms(); emitRoom(code); reply({ ok:true, scene:normalized });
  });

  socket.on("scene:activate", ({ sceneId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий переключает общую сцену" });
    ensureRoomVtt(room);
    const scene = room.scenes.find(entry => entry.id === cleanText(sceneId,80));
    if (!scene) return reply({ ok:false, error:"Сцена не найдена" });
    room.activeSceneId = scene.id;
    scene.published = true;
    scene.updatedAt = Date.now();
    room.scene = scene;
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:rename", ({ sceneId, name, published } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий меняет сцены" });
    ensureRoomVtt(room);
    const scene = room.scenes.find(entry => entry.id === cleanText(sceneId,80));
    if (!scene) return reply({ ok:false, error:"Сцена не найдена" });
    scene.name = cleanText(name,60) || scene.name;
    if (scene.id !== room.activeSceneId && published !== undefined) scene.published = Boolean(published);
    scene.updatedAt = Date.now();
    if (scene.id === room.activeSceneId) room.scene = scene;
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:remove", ({ sceneId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий удаляет сцены" });
    ensureRoomVtt(room);
    if (room.scenes.length <= 1) return reply({ ok:false, error:"Последнюю сцену удалить нельзя" });
    const targetId = cleanText(sceneId,80);
    if (!room.scenes.some(scene => scene.id === targetId)) return reply({ ok:false, error:"Сцена не найдена" });
    room.scenes = room.scenes.filter(scene => scene.id !== targetId);
    if (room.activeSceneId === targetId) room.activeSceneId = room.scenes[0].id;
    room.scene = room.scenes.find(scene => scene.id === room.activeSceneId) || room.scenes[0];
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:asset-place", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий размещает ресурсы" });
    ensureRoomVtt(room);
    const asset = room.assets.find(entry => entry.id === cleanText(payload.assetId,80));
    if (!asset) return reply({ ok:false, error:"Ресурс не найден в библиотеке" });
    const scene = activeScene(room);
    rememberScene(room, scene);
    const snap = value => scene.grid.snap ? Math.round(Number(value)||0) : Math.round((Number(value)||0)*10)/10;
    const x = Math.max(-500,Math.min(500,snap(payload.x)));
    const y = Math.max(-500,Math.min(500,snap(payload.y)));
    const count = Math.max(1,Math.min(50,Number(payload.count)||1));
    const createdIds = [];
    if (asset.category === "token") {
      const baseName = cleanText(payload.name,60) || asset.name;
      const existing = scene.tokens.filter(token => token.assetId === asset.id).length;
      for (let index=0; index<count; index+=1) {
        const tokenId = id(); createdIds.push(tokenId);
        scene.tokens.push({
          id:tokenId, assetId:asset.id, playerId:"",
          name:count > 1 || existing ? `${baseName} ${existing + index + 1}` : baseName,
          x:x + index, y, size:Math.max(.25,Math.min(12,Number(payload.size)||asset.defaultSize||1)), rotation:0, opacity:1,
          color:/^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : "#9f7842", imageUrl:asset.url,
          vision:Math.max(0,Math.min(10000,Number(payload.vision)||60)), hidden:Boolean(payload.hidden), locked:false, z:100,
          initiativeBonus:Math.max(-100,Math.min(100,Number(payload.initiativeBonus)||0)), initiativeAdvantage:false, initiative:null
        });
      }
    } else {
      const objectId = id(); createdIds.push(objectId);
      const ratio = asset.width && asset.height ? asset.height / asset.width : asset.category === "map" ? 0.6 : 1;
      const width = Math.max(.25,Math.min(200,Number(payload.width)||asset.defaultSize||(asset.category === "map" ? 20 : 1)));
      scene.objects.push({
        id:objectId, assetId:asset.id, type:asset.category, name:cleanText(payload.name,80)||asset.name, imageUrl:asset.url,
        x, y, width, height:Math.max(.25,Math.min(200,Number(payload.height)||width*ratio)), rotation:0, opacity:1,
        hidden:Boolean(payload.hidden), locked:payload.locked === undefined ? asset.category === "map" : Boolean(payload.locked),
        z:asset.category === "map" ? -100 : 0
      });
    }
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true, createdIds });
  });

  socket.on("scene:object-move", ({ objectId, x, y } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий двигает объекты" });
    const scene = activeScene(room);
    const object = scene.objects.find(entry => entry.id === cleanText(objectId,80));
    if (!object) return reply({ ok:false, error:"Объект не найден" });
    if (object.locked) return reply({ ok:false, error:"Сначала разблокируй объект" });
    rememberScene(room, scene);
    const position = value => scene.grid.snap ? Math.round(Number(value)||0) : Math.round((Number(value)||0)*10)/10;
    object.x = Math.max(-500,Math.min(500,position(x)));
    object.y = Math.max(-500,Math.min(500,position(y)));
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:object-update", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий меняет объекты" });
    const scene = activeScene(room);
    const object = scene.objects.find(entry => entry.id === cleanText(payload.objectId,80));
    if (!object) return reply({ ok:false, error:"Объект не найден" });
    rememberScene(room, scene);
    object.name = cleanText(payload.name ?? object.name,80) || object.name;
    object.width = Math.max(.25,Math.min(200,Number(payload.width)||object.width));
    object.height = Math.max(.25,Math.min(200,Number(payload.height)||object.height));
    object.rotation = Math.max(-3600,Math.min(3600,Number(payload.rotation)||0));
    object.opacity = Math.max(.03,Math.min(1,Number(payload.opacity)||1));
    object.hidden = Boolean(payload.hidden);
    object.locked = Boolean(payload.locked);
    object.z = Math.max(-1000,Math.min(1000,Number(payload.z)||0));
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:object-duplicate", ({ objectId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий копирует объекты" });
    const scene = activeScene(room);
    const object = scene.objects.find(entry => entry.id === cleanText(objectId,80));
    if (!object) return reply({ ok:false, error:"Объект не найден" });
    rememberScene(room, scene);
    const copy = { ...object, id:id(), name:`${object.name} — копия`, x:object.x+1, y:object.y+1, locked:false };
    scene.objects.push(copy);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, objectId:copy.id });
  });

  socket.on("scene:object-remove", ({ objectId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий удаляет объекты" });
    const scene = activeScene(room);
    const targetId = cleanText(objectId,80);
    rememberScene(room, scene);
    scene.objects = scene.objects.filter(object => object.id !== targetId);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:token-duplicate", ({ tokenId, count = 1 } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий копирует токены" });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    rememberScene(room, scene);
    const copies = Math.max(1,Math.min(50,Number(count)||1));
    const baseName = token.name.replace(/\s+\d+$/, "");
    const sameCount = scene.tokens.filter(entry => entry.assetId && entry.assetId === token.assetId || entry.name.replace(/\s+\d+$/, "") === baseName).length;
    for (let index=0; index<copies; index+=1) scene.tokens.push({ ...token, id:id(), playerId:"", name:`${baseName} ${sameCount+index+1}`, x:token.x+index+1, initiative:null, locked:false });
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:settings", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий меняет сцену" });
    const current = activeScene(room);
    rememberScene(room, current);
    const updated = setActiveScene(room, {
      ...current,
      name: payload.name ?? current.name,
      published: payload.published ?? current.published,
      backgroundUrl: payload.backgroundUrl ?? current.backgroundUrl,
      backgroundColor: payload.backgroundColor ?? current.backgroundColor,
      grid: { ...current.grid, ...(payload.grid || {}) }
    });
    saveRooms(); emitRoom(code); reply({ ok:true, scene:updated });
  });

  socket.on("scene:token-add", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const isDm = room.dmId === clientId;
    const requestedPlayerId = cleanText(payload.playerId, 80);
    const playerId = isDm ? requestedPlayerId : clientId;
    const player = room.players[playerId];
    if (!isDm && !player) return reply({ ok:false, error:"Персонаж не найден" });
    if (!isDm && requestedPlayerId && requestedPlayerId !== clientId) return reply({ ok:false, error:"Можно поставить только своего персонажа" });
    const scene = activeScene(room);
    if (player && sceneTokenForPlayer(scene, playerId)) return reply({ ok:false, error:"Токен этого персонажа уже на сцене" });
    rememberScene(room, scene);
    const position = nextScenePosition(scene);
    const sheet = player?.sheet || {};
    scene.tokens.push({
      id:id(), assetId:cleanText(payload.assetId,80), playerId:player ? playerId : "",
      name:cleanText(player ? (sheet.characterName || player.name) : payload.name, 60) || "Безымянный противник",
      x:payload.x === undefined ? position.x : Number(payload.x)||0, y:payload.y === undefined ? position.y : Number(payload.y)||0,
      size:Math.max(0.25, Math.min(12, Number(player ? sheet.tokenScale : payload.size) || 1)), rotation:Number(payload.rotation)||0, opacity:Number(payload.opacity)||1,
      color:/^#[0-9a-f]{6}$/i.test(player ? sheet.tokenColor : payload.color) ? (player ? sheet.tokenColor : payload.color) : "#9f7842",
      imageUrl:cleanText(player ? (sheet.tokenImageUrl || sheet.portraitUrl) : payload.imageUrl, 1000),
      vision:Math.max(0, Math.min(10000, Number(player ? sheet.tokenVision : payload.vision) || 0)),
      hidden:isDm ? Boolean(payload.hidden) : false, locked:isDm ? Boolean(payload.locked) : false, z:100,
      initiativeBonus:Math.max(-100, Math.min(100, Number(player ? sheetInitiativeBonus(sheet) : payload.initiativeBonus) || 0)),
      initiativeAdvantage:Boolean(player ? sheet.initiativeAdvantage : payload.initiativeAdvantage),
      initiative:null,
      hpMax:Math.max(1,Math.min(1000000,Number(player ? sheet.hpMax : payload.hpMax)||1)), hp:Math.max(0,Math.min(1000000,Number(player ? sheet.hpCurrent : payload.hp)||0)),
      tempHp:Math.max(0,Math.min(1000000,Number(player ? sheet.hpTemp : payload.tempHp)||0)), ac:Math.max(0,Math.min(1000,Number(player ? sheet.ac : payload.ac)||10)),
      conditions:[], concentration:"", deathSuccess:0, deathFail:0, stable:false
    });
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true, scene:activeScene(room) });
  });

  socket.on("scene:party-add", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий добавляет токены" });
    const scene = activeScene(room);
    rememberScene(room, scene);
    let added = 0;
    Object.entries(room.players).forEach(([playerId, player]) => {
      if (sceneTokenForPlayer(scene, playerId)) return;
      const position = nextScenePosition(scene), sheet = player.sheet || {};
      scene.tokens.push({ id:id(), playerId, name:cleanText(sheet.characterName || player.name,60), x:position.x, y:position.y, size:Number(sheet.tokenScale)||1, color:sheet.tokenColor||"#9f7842", imageUrl:cleanText(sheet.tokenImageUrl || sheet.portraitUrl,1000), vision:Number(sheet.tokenVision)||0, hidden:false, locked:false, initiativeBonus:sheetInitiativeBonus(sheet), initiativeAdvantage:Boolean(sheet.initiativeAdvantage), initiative:null, hpMax:Math.max(1,Number(sheet.hpMax)||1), hp:Math.max(0,Number(sheet.hpCurrent)||0), tempHp:Math.max(0,Number(sheet.hpTemp)||0), ac:Math.max(0,Number(sheet.ac)||10), conditions:[], concentration:"", deathSuccess:Number(sheet.deathSuccess)||0, deathFail:Number(sheet.deathFail)||0, stable:false });
      added += 1;
    });
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true, added });
  });

  socket.on("scene:token-move", ({ tokenId, x, y } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    const allowed = room.dmId === clientId || token.playerId === clientId;
    if (!allowed || token.locked && room.dmId !== clientId) return reply({ ok:false, error:"Этот токен нельзя двигать" });
    rememberScene(room, scene);
    const positionValue = value => scene.grid.snap ? Math.round(Number(value) || 0) : Math.round((Number(value) || 0) * 10) / 10;
    token.x = Math.max(-500, Math.min(500, positionValue(x)));
    token.y = Math.max(-500, Math.min(500, positionValue(y)));
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:token-update", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(payload.tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && token.playerId !== clientId) return reply({ ok:false, error:"Нет доступа к токену" });
    rememberScene(room, scene);
    if (payload.badge !== undefined) token.badge = cleanText(payload.badge, 32);
    if (/^#[0-9a-f]{6}$/i.test(payload.badgeColor)) token.badgeColor = payload.badgeColor;
    if (!token.playerId) {
      token.name = cleanText(payload.name ?? token.name,60) || token.name;
      token.imageUrl = cleanText(payload.imageUrl ?? token.imageUrl,1000);
      token.color = /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : token.color;
      token.size = Math.max(0.25,Math.min(12,Number(payload.size)||token.size));
      token.rotation = Math.max(-3600,Math.min(3600,Number(payload.rotation)||0));
      token.opacity = Math.max(.05,Math.min(1,Number(payload.opacity)||1));
      token.vision = Math.max(0,Math.min(10000,Number(payload.vision)||0));
      token.initiativeBonus = Math.max(-100,Math.min(100,Number(payload.initiativeBonus)||0));
      if (payload.hpMax !== undefined) token.hpMax = Math.max(1,Math.min(1000000,Number(payload.hpMax)||1));
      if (payload.hp !== undefined) token.hp = Math.max(0,Math.min(token.hpMax,Number(payload.hp)||0));
      if (payload.tempHp !== undefined) token.tempHp = Math.max(0,Math.min(1000000,Number(payload.tempHp)||0));
      if (payload.ac !== undefined) token.ac = Math.max(0,Math.min(1000,Number(payload.ac)||10));
      if (payload.concentration !== undefined) token.concentration = cleanText(payload.concentration,120);
      if (Array.isArray(payload.conditions)) token.conditions = [...new Set(payload.conditions.map(value => cleanText(value,40)).filter(value => COMBAT_CONDITIONS.includes(value)))];
    }
    if (isDm) { token.hidden = Boolean(payload.hidden); token.locked = Boolean(payload.locked); }
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:tokens-batch-update", ({ tokenIds, patch = {}, rollInitiative, clearInitiative } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий меняет группу токенов" });
    const scene = activeScene(room);
    const ids = [...new Set((Array.isArray(tokenIds) ? tokenIds : []).map(value => cleanText(value,80)).filter(Boolean))].slice(0,100);
    const tokens = scene.tokens.filter(token => ids.includes(token.id));
    if (!tokens.length) return reply({ ok:false, error:"В группе нет токенов" });
    rememberScene(room, scene);
    const has = key => Object.prototype.hasOwnProperty.call(patch || {}, key);
    for (const token of tokens) {
      if (rollInitiative) token.initiative = crypto.randomInt(1,21) + Number(token.initiativeBonus || 0);
      else if (clearInitiative) token.initiative = null;
      else if (has("initiative")) token.initiative = Math.max(-1000,Math.min(1000,Number(patch.initiative)||0));
      if (has("hidden")) token.hidden = Boolean(patch.hidden);
      if (has("locked")) token.locked = Boolean(patch.locked);
      if (has("badge")) token.badge = cleanText(patch.badge,40);
      if (has("badgeColor") && /^#[0-9a-f]{6}$/i.test(String(patch.badgeColor || ""))) token.badgeColor = patch.badgeColor;
      if (has("hpMax")) token.hpMax = Math.max(1,Math.min(1000000,Number(patch.hpMax)||1));
      if (has("hp")) token.hp = Math.max(0,Math.min(Number(token.hpMax)||1,Number(patch.hp)||0));
      if (has("tempHp")) token.tempHp = Math.max(0,Math.min(1000000,Number(patch.tempHp)||0));
      if (token.playerId && room.players?.[token.playerId]?.sheet && (has("hp") || has("hpMax") || has("tempHp"))) {
        const sheet = room.players[token.playerId].sheet;
        sheet.hpMax = token.hpMax;
        sheet.hpCurrent = token.hp;
        sheet.hpTemp = token.tempHp;
        room.players[token.playerId].sheet = normalizeSheet(sheet, room.players[token.playerId].name);
      }
    }
    const order = initiativeOrder(scene);
    scene.initiative.active = order.length > 0;
    if (!scene.initiative.active) {
      scene.initiative.currentTokenId = "";
      scene.initiative.round = 1;
    } else if (!order.some(token => token.id === scene.initiative.currentTokenId)) {
      scene.initiative.currentTokenId = order[0].id;
      scene.initiative.round = Math.max(1,Number(scene.initiative.round || 1));
    }
    setActiveScene(room,scene); saveRooms(); emitRoom(code);
    reply({ ok:true, updated:tokens.length });
  });

  socket.on("scene:token-hp", ({ tokenId, hp, hpMax, tempHp } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && token.playerId !== clientId) return reply({ ok:false, error:"Можно менять только HP своего персонажа" });
    rememberScene(room, scene);
    if (token.playerId && room.players?.[token.playerId]?.sheet) {
      const sheet = room.players[token.playerId].sheet;
      if (hpMax !== undefined) sheet.hpMax = Math.max(1, Math.min(1000000, Number(hpMax) || 1));
      if (hp !== undefined) sheet.hpCurrent = Math.max(0, Math.min(Number(sheet.hpMax) || 1, Number(hp) || 0));
      if (tempHp !== undefined) sheet.hpTemp = Math.max(0, Math.min(1000000, Number(tempHp) || 0));
      room.players[token.playerId].sheet = normalizeSheet(sheet, room.players[token.playerId].name);
      token.hpMax = room.players[token.playerId].sheet.hpMax;
      token.hp = room.players[token.playerId].sheet.hpCurrent;
      token.tempHp = room.players[token.playerId].sheet.hpTemp;
    } else {
      if (hpMax !== undefined) token.hpMax = Math.max(1, Math.min(1000000, Number(hpMax) || 1));
      if (hp !== undefined) token.hp = Math.max(0, Math.min(Number(token.hpMax) || 1, Number(hp) || 0));
      if (tempHp !== undefined) token.tempHp = Math.max(0, Math.min(1000000, Number(tempHp) || 0));
    }
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:dice-roll", ({ x, y, sides, dice, modifier, visibility, formula:customFormula } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    const player = room?.players?.[clientId];
    if (!room || !player) return reply({ ok:false, error:"Игрок не подключён" });
    const scene = activeScene(room);
    const safeVisibility = ["private","gm"].includes(visibility) ? visibility : "public";

    let sets;
    let flat;
    let formula;
    let detail;
    let natural;
    if (String(customFormula || "").trim()) {
      const parsed = parseDiceFormula(customFormula, "normal");
      if (!parsed.ok) return reply(parsed);
      if (parsed.detail.some(entry => Number(entry.sign) < 0 || !TABLE_DIE_SIDES.includes(Number(entry.sides)))) {
        return reply({ ok:false, error:"Физический дайстрей поддерживает к4, к6, к8, к10, к12, к20 и к100 без вычитания костей" });
      }
      const physicalCount = parsed.detail.reduce((sum, entry) => sum + Number(entry.count || 0) * (Number(entry.sides) === 100 ? 2 : 1), 0);
      if (physicalCount > MAX_TABLE_DICE) return reply({ ok:false, error:`На физическом столе помещается не больше ${MAX_TABLE_DICE} костей` });
      sets = parsed.detail.map(entry => ({ sides:Number(entry.sides), values:[...(entry.rolls || [])].map(Number) }));
      flat = Math.max(-999, Math.min(999, Number(parsed.modifier) || 0));
      formula = tableDiceFormula(sets.map(set => ({ sides:set.sides, count:set.values.length })), flat);
      detail = parsed.detail;
      natural = parsed.natural;
    } else {
      const selection = normalizeTableDiceSelection(Array.isArray(dice) && dice.length ? dice : [{ sides:Number(sides) || 20, count:1 }]);
      if (!selection.length) return reply({ ok:false, error:"Добавь хотя бы один кубик" });
      flat = Math.max(-999, Math.min(999, Number(modifier) || 0));
      sets = selection.map(set => ({ sides:set.sides, values:Array.from({ length:set.count }, () => crypto.randomInt(1, set.sides + 1)) }));
      formula = tableDiceFormula(selection, flat);
      detail = sets.map(set => ({ count:set.values.length, sides:set.sides, sign:1, rolls:set.values, subtotal:set.values.reduce((sum,value)=>sum+value,0) }));
      natural = sets.length === 1 && sets[0].sides === 20 && sets[0].values.length === 1 ? sets[0].values[0] : null;
    }

    const allValues = sets.flatMap(set => set.values);
    const total = allValues.reduce((sum, value) => sum + value, flat);
    const physicalRoll = {
      id:id(),
      x:sceneCoordinate(scene,x), y:sceneCoordinate(scene,y),
      sets, modifier:flat, total, formula,
      color:normalizeDiceColor(player.sheet?.diceColor),
      by:cleanText(player.name,60), at:Date.now(),
      visibility:safeVisibility,
      playerId:clientId,
      privateToDm:false
    };
    scene.diceRoll = physicalRoll;
    scene.diceRolls = (Array.isArray(scene.diceRolls) ? scene.diceRolls : [])
      .map(source => normalizeSceneDiceRoll(source))
      .filter(Boolean)
      .concat(physicalRoll)
      .slice(-MAX_ACTIVE_TABLE_ROLLS);
    room.rollLog.push({ id:id(), playerId:clientId, player:player.name, label:`${safeVisibility === "private" ? "Закрытый" : "Бросок"} на столе · ${formula}`, formula, dice:allValues, detail, modifier:flat, total, natural, mode:"normal", visibility:safeVisibility, at:Date.now() });
    room.rollLog = room.rollLog.slice(-100);
    setActiveScene(room, scene); saveRooms(); emitRoom(code);
    reply({ ok:true, sets, modifier:flat, total, formula, detail, rollId:physicalRoll.id, visibility:safeVisibility, by:player.name, natural });
  });

  socket.on("scene:token-remove", ({ tokenId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий удаляет токены" });
    const scene = activeScene(room);
    const idToRemove = cleanText(tokenId,80);
    rememberScene(room, scene);
    scene.tokens = scene.tokens.filter(token => token.id !== idToRemove);
    if (scene.initiative.currentTokenId === idToRemove) scene.initiative.currentTokenId = "";
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:annotation-add", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || !room.players?.[clientId]) return reply({ ok:false, error:"Игрок не подключён" });
    const isDm = room.dmId === clientId;
    const scene = activeScene(room);
    rememberScene(room, scene);
    const annotationId = id();
    scene.annotations.push({
      id:annotationId,
      ownerId:clientId,
      kind:["line","rect","circle","cone","draw","text"].includes(payload.kind) ? payload.kind : "line",
      name:cleanText(payload.name,80),
      x:payload.x, y:payload.y, x2:payload.x2, y2:payload.y2,
      points:Array.isArray(payload.points) ? payload.points : [],
      text:cleanText(payload.text,500), color:payload.color, fill:payload.fill,
      fillOpacity:payload.fillOpacity, opacity:payload.opacity, strokeWidth:payload.strokeWidth,
      hidden:isDm ? Boolean(payload.hidden) : false, locked:isDm ? Boolean(payload.locked) : false, z:Number(payload.z) || 50
    });
    const updated = setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true, annotationId, annotation:updated.annotations.find(entry => entry.id === annotationId) });
  });

  socket.on("scene:annotation-update", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const scene = activeScene(room);
    const annotation = scene.annotations.find(entry => entry.id === cleanText(payload.annotationId,80));
    if (!annotation) return reply({ ok:false, error:"Рисунок не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && annotation.ownerId !== clientId) return reply({ ok:false, error:"Можно менять только свои рисунки" });
    rememberScene(room, scene);
    if (payload.name !== undefined) annotation.name = cleanText(payload.name,80) || annotation.name;
    if (payload.text !== undefined) annotation.text = cleanText(payload.text,500);
    if (/^#[0-9a-f]{6}$/i.test(payload.color)) annotation.color = payload.color;
    if (/^#[0-9a-f]{6}$/i.test(payload.fill)) annotation.fill = payload.fill;
    if (payload.fillOpacity !== undefined) annotation.fillOpacity = Math.max(0,Math.min(1,Number(payload.fillOpacity)||0));
    if (payload.opacity !== undefined) annotation.opacity = Math.max(.05,Math.min(1,Number(payload.opacity)||1));
    if (payload.strokeWidth !== undefined) annotation.strokeWidth = Math.max(1,Math.min(20,Number(payload.strokeWidth)||3));
    if (isDm && payload.hidden !== undefined) annotation.hidden = Boolean(payload.hidden);
    if (isDm && payload.locked !== undefined) annotation.locked = Boolean(payload.locked);
    if (isDm && payload.z !== undefined) annotation.z = Math.max(-1000,Math.min(1000,Number(payload.z)||50));
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:annotation-remove", ({ annotationId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const scene = activeScene(room);
    const targetId = cleanText(annotationId,80);
    const annotation = scene.annotations.find(entry => entry.id === targetId);
    if (!annotation) return reply({ ok:false, error:"Рисунок не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && annotation.ownerId !== clientId) return reply({ ok:false, error:"Можно удалять только свои рисунки" });
    rememberScene(room, scene);
    scene.annotations = scene.annotations.filter(entry => entry.id !== targetId);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:items-transform", ({ moves } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    const isDm = room.dmId === clientId;
    const safeMoves = Array.isArray(moves) ? moves.slice(0,500) : [];
    const applicable = safeMoves.filter(move => {
      if (move?.kind === "token") {
        const token = scene.tokens.find(entry => entry.id === cleanText(move.id,80));
        return token && (isDm || token.playerId === clientId) && (!token.locked || isDm);
      }
      if (move?.kind === "object") return isDm && scene.objects.some(entry => entry.id === cleanText(move.id,80) && !entry.locked);
      if (move?.kind === "annotation") {
        const annotation = scene.annotations.find(entry => entry.id === cleanText(move.id,80));
        return annotation && (isDm || annotation.ownerId === clientId) && (!annotation.locked || isDm);
      }
      return false;
    });
    if (!applicable.length) return reply({ ok:false, error:"Нет объектов, которые можно переместить" });
    rememberScene(room, scene);
    applicable.forEach(move => {
      const dx = Number(move.dx) || 0, dy = Number(move.dy) || 0;
      if (move.kind === "token") {
        const token = scene.tokens.find(entry => entry.id === cleanText(move.id,80));
        token.x = sceneCoordinate(scene, move.x === undefined ? token.x + dx : move.x);
        token.y = sceneCoordinate(scene, move.y === undefined ? token.y + dy : move.y);
      } else if (move.kind === "object") {
        const object = scene.objects.find(entry => entry.id === cleanText(move.id,80));
        object.x = sceneCoordinate(scene, move.x === undefined ? object.x + dx : move.x);
        object.y = sceneCoordinate(scene, move.y === undefined ? object.y + dy : move.y);
      } else {
        const annotation = scene.annotations.find(entry => entry.id === cleanText(move.id,80));
        translateAnnotation(annotation, dx, dy, scene);
      }
    });
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, moved:applicable.length });
  });

  socket.on("scene:items-duplicate", ({ refs, offsetX = 1, offsetY = 1 } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const isDm = room.dmId === clientId;
    const scene = activeScene(room);
    const safeRefs = Array.isArray(refs) ? refs.slice(0,500) : [];
    if (!safeRefs.length) return reply({ ok:false, error:"Нечего копировать" });
    rememberScene(room, scene);
    const created = [];
    safeRefs.forEach(ref => {
      const refId = cleanText(ref?.id,80);
      if (ref?.kind === "token") {
        const source = scene.tokens.find(entry => entry.id === refId);
        if (!source || !isDm) return;
        const copy = { ...source, id:id(), playerId:"", name:`${source.name.replace(/\s+— копия(?: \d+)?$/, "")} — копия`, x:sceneCoordinate(scene, source.x + Number(offsetX || 0)), y:sceneCoordinate(scene, source.y + Number(offsetY || 0)), initiative:null, locked:false };
        scene.tokens.push(copy); created.push({ kind:"token", id:copy.id });
      } else if (ref?.kind === "object") {
        const source = scene.objects.find(entry => entry.id === refId);
        if (!source || !isDm) return;
        const copy = { ...source, id:id(), name:`${source.name.replace(/\s+— копия(?: \d+)?$/, "")} — копия`, x:sceneCoordinate(scene, source.x + Number(offsetX || 0)), y:sceneCoordinate(scene, source.y + Number(offsetY || 0)), locked:false };
        scene.objects.push(copy); created.push({ kind:"object", id:copy.id });
      } else if (ref?.kind === "annotation") {
        const source = scene.annotations.find(entry => entry.id === refId);
        if (!source || !isDm && source.ownerId !== clientId) return;
        const copy = structuredClone(source); copy.id=id(); copy.ownerId=clientId; copy.name=`${source.name || "Рисунок"} — копия`; copy.locked=false; copy.hidden=false;
        translateAnnotation(copy, Number(offsetX || 0), Number(offsetY || 0), scene);
        scene.annotations.push(copy); created.push({ kind:"annotation", id:copy.id });
      }
    });
    if (!created.length) {
      const history = sceneHistoryState(room, scene.id); history.undo.pop();
      return reply({ ok:false, error:"Объекты не найдены" });
    }
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, created });
  });

  socket.on("scene:items-remove", ({ refs } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const scene = activeScene(room);
    const isDm = room.dmId === clientId;
    const safeRefs = Array.isArray(refs) ? refs.slice(0,500) : [];
    const tokenIds = new Set(safeRefs.filter(ref => ref?.kind === "token" && isDm).map(ref => cleanText(ref.id,80)));
    const objectIds = new Set(safeRefs.filter(ref => ref?.kind === "object" && isDm).map(ref => cleanText(ref.id,80)));
    const annotationIds = new Set(safeRefs.filter(ref => {
      if (ref?.kind !== "annotation") return false;
      const annotation = scene.annotations.find(entry => entry.id === cleanText(ref.id,80));
      return annotation && (isDm || annotation.ownerId === clientId);
    }).map(ref => cleanText(ref.id,80)));
    const removed = scene.tokens.filter(entry => tokenIds.has(entry.id)).length + scene.objects.filter(entry => objectIds.has(entry.id)).length + scene.annotations.filter(entry => annotationIds.has(entry.id)).length;
    if (!removed) return reply({ ok:false, error:"Нечего удалять" });
    rememberScene(room, scene);
    scene.tokens = scene.tokens.filter(entry => !tokenIds.has(entry.id));
    scene.objects = scene.objects.filter(entry => !objectIds.has(entry.id));
    scene.annotations = scene.annotations.filter(entry => !annotationIds.has(entry.id));
    if (tokenIds.has(scene.initiative.currentTokenId)) scene.initiative.currentTokenId = "";
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, removed });
  });

  socket.on("scene:history-undo", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий отменяет изменения" });
    const restored = restoreSceneFromHistory(room, "undo");
    if (!restored) return reply({ ok:false, error:"Нечего отменять" });
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:history-redo", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий повторяет изменения" });
    const restored = restoreSceneFromHistory(room, "redo");
    if (!restored) return reply({ ok:false, error:"Нечего повторять" });
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:ping", ({ x, y, color } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    const player = room?.players?.[clientId];
    if (!room || !player) return reply({ ok:false });
    const scene = activeScene(room);
    scene.ping = { id:id(), x:sceneCoordinate(scene,x), y:sceneCoordinate(scene,y), color:/^#[0-9a-f]{6}$/i.test(color) ? color : "#f4c875", at:Date.now(), by:cleanText(player.name,60) };
    setActiveScene(room, scene); emitRoom(code); reply({ ok:true });
  });

  socket.on("combat:apply", ({ tokenId, kind, amount, label, visibility } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || !room.players?.[clientId]) return reply({ ok:false, error:"Игрок не подключён" });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Цель не найдена" });
    const safeKind = ["damage","healing","temp"].includes(kind) ? kind : "damage";
    const safeAmount = Math.max(0,Math.min(1000000,Number(amount)||0));
    if (!safeAmount) return reply({ ok:false, error:"Укажи количество" });
    const isDm = room.dmId === clientId;
    const ownsTarget = token.playerId === clientId;
    const currentToken = scene.tokens.find(entry => entry.id === scene.initiative?.currentTokenId);
    const canApplyNpcDamage = safeKind === "damage" && !token.playerId && (!scene.initiative?.active || currentToken?.playerId === clientId);
    if (!isDm && !ownsTarget && !canApplyNpcDamage) {
      const request = { id:id(), requesterId:clientId, tokenId:token.id, kind:safeKind, amount:safeAmount, label:cleanText(label,120), status:"pending", at:Date.now() };
      room.combatRequests.push(request);
      room.combatRequests = room.combatRequests.slice(-100);
      appendActivity(room, clientId, "Запрос ведущему", `${room.players[clientId].name}: ${safeKind === "damage" ? "урон" : safeKind === "healing" ? "лечение" : "временные HP"} ${safeAmount} → ${token.name}`, "private");
      saveRooms(); emitRoom(code); return reply({ ok:true, pending:true, requestId:request.id });
    }
    const result = applyCombatAmount(room, token, safeKind, safeAmount);
    appendActivity(room, clientId, cleanText(label,80) || "Бой", combatResultDetail(token, safeKind, safeAmount, result), visibility);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, pending:false, state:result.state, result });
  });

  socket.on("combat:request-resolve", ({ requestId, accept } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий подтверждает применение" });
    const scene = activeScene(room);
    const request = room.combatRequests.find(entry => entry.id === cleanText(requestId,80) && entry.status === "pending");
    if (!request) return reply({ ok:false, error:"Запрос уже обработан" });
    const token = scene.tokens.find(entry => entry.id === request.tokenId);
    request.status = accept ? "accepted" : "rejected";
    if (!accept || !token) {
      appendActivity(room, clientId, "Запрос отклонён", request.label || "Изменение HP", "private");
      saveRooms(); emitRoom(code); return reply({ ok:true, accepted:false });
    }
    const result = applyCombatAmount(room, token, request.kind, request.amount);
    const requester = room.players?.[request.requesterId]?.name || "Игрок";
    appendActivity(room, clientId, request.label || "Бой", `${requester} · ${combatResultDetail(token, request.kind, request.amount, result)}`);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, accepted:true, state:result.state, result });
  });

  socket.on("combat:condition", ({ tokenId, condition, active:enabled } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    const safeCondition = cleanText(condition,40);
    if (!token || !COMBAT_CONDITIONS.includes(safeCondition)) return reply({ ok:false, error:"Состояние не найдено" });
    const isDm = room.dmId === clientId;
    if (!isDm && token.playerId !== clientId) return reply({ ok:false, error:"Можно менять состояния только своего персонажа" });
    const state = tokenCombatState(room, token);
    const conditions = new Set(state.conditions);
    if (enabled === false || conditions.has(safeCondition)) conditions.delete(safeCondition); else conditions.add(safeCondition);
    const next = updateTokenCombatState(room, token, { conditions:[...conditions] });
    appendActivity(room, clientId, enabled === false ? "Состояние снято" : "Состояние", `${token.name}: ${safeCondition}`);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, state:next });
  });

  socket.on("combat:concentration", ({ tokenId, name } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && token.playerId !== clientId) return reply({ ok:false, error:"Можно менять концентрацию только своего персонажа" });
    const concentration = cleanText(name,120);
    const next = updateTokenCombatState(room, token, { concentration });
    appendActivity(room, clientId, concentration ? "Концентрация" : "Концентрация завершена", concentration ? `${token.name}: ${concentration}` : token.name);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, state:next });
  });

  socket.on("combat:death-save", ({ tokenId, visibility } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80)) || sceneTokenForPlayer(scene,clientId);
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && token.playerId !== clientId) return reply({ ok:false, error:"Можно бросать только за своего персонажа" });
    const state = tokenCombatState(room, token);
    if (state.hp > 0) return reply({ ok:false, error:"Персонаж ещё в сознании" });
    if (state.conditions.includes("Мёртв")) return reply({ ok:false, error:"Персонаж мёртв — обычный спасбросок уже не поможет" });
    if (state.stable) return reply({ ok:false, error:"Персонаж уже стабилен" });
    const natural = crypto.randomInt(1,21);
    let patch = { stable:false };
    if (natural === 20) patch = { hp:1, deathSuccess:0, deathFail:0, stable:false, conditions:state.conditions.filter(value => value !== "Без сознания") };
    else if (natural === 1) patch.deathFail = Math.min(3,state.deathFail + 2);
    else if (natural >= 10) patch.deathSuccess = Math.min(3,state.deathSuccess + 1);
    else patch.deathFail = Math.min(3,state.deathFail + 1);
    if (Number(patch.deathSuccess ?? state.deathSuccess) >= 3) patch.stable = true;
    if (Number(patch.deathFail ?? state.deathFail) >= 3) patch.conditions = [...new Set([...(patch.conditions || state.conditions),"Мёртв"])];
    const next = updateTokenCombatState(room, token, patch);
    let safeVisibility = ["private","gm"].includes(visibility) ? visibility : "public";
    if (safeVisibility === "gm" && !isDm) safeVisibility = "private";
    room.rollLog.push({ id:id(), playerId:clientId, player:room.players[clientId]?.name || token.name, label:`Спасбросок от смерти · ${token.name}`, formula:"1к20", dice:[natural], detail:[{ count:1,sides:20,sign:1,rolls:[natural],subtotal:natural }], modifier:0, total:natural, mode:"normal", natural, visibility:safeVisibility, at:Date.now() });
    room.rollLog = room.rollLog.slice(-100);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, natural, state:next });
  });

  socket.on("combat:resolve-hit", ({ targetId, total, natural } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || !room.players?.[clientId]) return reply({ ok:false, error:"Игрок не подключён" });
    const scene = activeScene(room);
    const target = scene.tokens.find(token => token.id === cleanText(targetId,80));
    if (!target || target.hidden && room.dmId !== clientId) return reply({ ok:false, error:"Цель не найдена" });
    const rollTotal = Math.max(-1000,Math.min(10000,Number(total)||0));
    const die = Math.max(1,Math.min(20,Number(natural)||1));
    const ac = tokenCombatState(room,target).ac;
    const critical = die === 20;
    const fumble = die === 1;
    const hit = critical || !fumble && rollTotal >= ac;
    reply({ ok:true, hit, critical, fumble, ...(room.dmId === clientId ? { targetAc:ac } : {}) });
  });

  socket.on("combat:spend-action", ({ tokenId, cost, label, force } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && token.playerId !== clientId) return reply({ ok:false, error:"Можно расходовать действия только своего персонажа" });
    const safeCost = ["action","attack","bonus","reaction","free"].includes(cost) ? cost : "action";
    const safeLabel = cleanText(label,100) || safeCost;
    const actionPolicy = ["free","soft","strict"].includes(scene.combatSettings?.actionPolicy) ? scene.combatSettings.actionPolicy : "soft";

    if (actionPolicy === "free") {
      appendActivity(room,clientId,"Действие",`${token.name}: ${safeLabel}`);
      saveRooms(); emitRoom(code);
      return reply({ ok:true, freeMode:true, actionPolicy, turnState:scene.initiative.turnState, resources:ensureInitiativeResources(room,scene,token) });
    }

    // Вне инициативы действие разрешено, но не создаёт скрытый счётчик хода.
    if (!scene.initiative.active) {
      appendActivity(room,clientId,"Действие",`${token.name}: ${safeLabel}`);
      saveRooms(); emitRoom(code);
      return reply({ ok:true, freeMode:true, turnState:null, resources:ensureInitiativeResources(room,scene,token) });
    }

    const isCurrent = scene.initiative.currentTokenId === token.id;
    const resources = ensureInitiativeResources(room,scene,token);

    // Реакция принадлежит персонажу, а не текущему ходу, поэтому не должна
    // перезаписывать turnState активного участника.
    if (safeCost === "reaction") {
      if (!resources.reactionAvailable) {
        if (actionPolicy === "strict") return reply({ ok:false, error:"Реакция уже потрачена" });
        if (!force) return reply({ ok:false, needsConfirm:true, error:"Реакция уже потрачена. Выполнить всё равно?" });
      } else resources.reactionAvailable = false;
      if (isCurrent && scene.initiative.turnState?.tokenId === token.id) scene.initiative.turnState.reactionAvailable = false;
      appendActivity(room,clientId,"Реакция",`${token.name}: ${safeLabel}`);
      setActiveScene(room,scene); saveRooms(); emitRoom(code);
      return reply({ ok:true, turnState:scene.initiative.turnState, resources });
    }

    if (!isCurrent) {
      if (actionPolicy === "strict") return reply({ ok:false, error:"Сейчас не ход этого персонажа" });
      if (!force) return reply({ ok:false, needsConfirm:true, error:"Сейчас не ход этого персонажа. Выполнить всё равно?" });
      appendActivity(room,clientId,"Действие вне хода",`${token.name}: ${safeLabel}`);
      saveRooms(); emitRoom(code);
      return reply({ ok:true, override:true, actionPolicy, turnState:scene.initiative.turnState, resources });
    }
    if (!scene.initiative.turnState || scene.initiative.turnState.tokenId !== token.id) beginTurn(room,scene,token);
    const state = scene.initiative.turnState;

    if (safeCost === "attack") {
      if (state.attacksRemaining > 0) state.attacksRemaining -= 1;
      else {
        if (state.actions < 1) {
          if (actionPolicy === "strict") return reply({ ok:false, error:"Действие уже потрачено" });
          if (!force) return reply({ ok:false, needsConfirm:true, error:"Действие уже потрачено. Выполнить всё равно?" });
        } else state.actions -= 1;
        state.attacksRemaining = Math.max(0,state.attacksPerAction - 1);
      }
    } else if (safeCost === "action") {
      if (state.actions < 1) {
        if (actionPolicy === "strict") return reply({ ok:false, error:"Действие уже потрачено" });
        if (!force) return reply({ ok:false, needsConfirm:true, error:"Действие уже потрачено. Выполнить всё равно?" });
      } else state.actions -= 1;
    } else if (safeCost === "bonus") {
      if (state.bonusActions < 1) {
        if (actionPolicy === "strict") return reply({ ok:false, error:"Бонусное действие уже потрачено" });
        if (!force) return reply({ ok:false, needsConfirm:true, error:"Бонусное действие уже потрачено. Выполнить всё равно?" });
      } else state.bonusActions -= 1;
    }

    appendActivity(room,clientId,safeCost === "bonus" ? "Бонусное действие" : safeCost === "free" ? "Свободное действие" : "Действие",`${token.name}: ${safeLabel}`);
    setActiveScene(room,scene); saveRooms(); emitRoom(code); reply({ ok:true, turnState:state, resources });
  });

  socket.on("combat:settings", ({ actionPolicy } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий меняет режим боя" });
    const scene = activeScene(room);
    scene.combatSettings ||= {};
    scene.combatSettings.actionPolicy = ["free","soft","strict"].includes(actionPolicy) ? actionPolicy : "soft";
    setActiveScene(room,scene); saveRooms(); emitRoom(code); reply({ ok:true, actionPolicy:scene.combatSettings.actionPolicy });
  });

  socket.on("combat:card-create", (payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    const player = room?.players?.[clientId];
    if (!room || !player) return reply({ ok:false, error:"Игрок не подключён" });
    const scene = activeScene(room);
    const target = scene.tokens.find(token => token.id === cleanText(payload.targetId,80));
    let visibility = ["private","gm"].includes(payload.visibility) ? payload.visibility : "public";
    if (visibility === "gm" && room.dmId !== clientId) visibility = "private";
    const card = {
      id:id(), playerId:clientId, player:cleanText(player.name,60),
      attackId:cleanText(payload.attackId,80), attackName:cleanText(payload.attackName,100) || "Атака",
      targetId:target?.id || "", targetName:target?.name || cleanText(payload.targetName,80),
      total:Math.max(-1000,Math.min(10000,Number(payload.total)||0)), natural:Math.max(0,Math.min(20,Number(payload.natural)||0)),
      hit:payload.hit === null || payload.hit === undefined ? null : Boolean(payload.hit),
      critical:Boolean(payload.critical), fumble:Boolean(payload.fumble),
      targetAc:target ? tokenCombatState(room,target).ac : Math.max(0,Math.min(1000,Number(payload.targetAc)||0)),
      damageTotal:null, damageApplied:false, visibility, at:Date.now()
    };
    if (!card.attackId) return reply({ ok:false, error:"Атака не найдена" });
    room.combatCards.push(card); room.combatCards = room.combatCards.slice(-100);
    saveRooms(); emitRoom(code); reply({ ok:true, cardId:card.id });
  });

  socket.on("combat:card-damage", ({ cardId, total, applied } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const card = room.combatCards.find(entry => entry.id === cleanText(cardId,80));
    if (!card) return reply({ ok:false, error:"Карточка атаки не найдена" });
    if (room.dmId !== clientId && card.playerId !== clientId) return reply({ ok:false, error:"Нет доступа к карточке" });
    card.damageTotal = Math.max(0,Math.min(1000000,Number(total)||0));
    card.damageApplied = Boolean(applied);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("combat:action-surge", ({ tokenId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false, error:"Комната не найдена" });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    const isDm = room.dmId === clientId;
    if (!isDm && token.playerId !== clientId) return reply({ ok:false, error:"Нет доступа к персонажу" });
    if (!scene.initiative.active) return reply({ ok:false, error:"Сначала запусти инициативу" });
    if (scene.initiative.currentTokenId !== token.id) return reply({ ok:false, error:"Всплеск действий используется в свой ход" });
    const resources = ensureInitiativeResources(room,scene,token);
    if (resources.actionSurge < 1) return reply({ ok:false, error:"Всплески действий закончились" });
    if (!scene.initiative.turnState || scene.initiative.turnState.tokenId !== token.id) beginTurn(room,scene,token);
    resources.actionSurge -= 1;
    scene.initiative.turnState.actions = Math.min(5,scene.initiative.turnState.actions + 1);
    appendActivity(room,clientId,"Всплеск действий",`${token.name} получает дополнительное действие`);
    setActiveScene(room,scene); saveRooms(); emitRoom(code); reply({ ok:true, turnState:scene.initiative.turnState, resources });
  });

  socket.on("combat:end-battle", (_payload = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий завершает бой" });
    const scene = activeScene(room);
    scene.tokens.forEach(token => { token.initiative = null; });
    scene.initiative = { active:false, round:1, currentTokenId:"", turnState:null, resources:{} };
    room.combatRequests = room.combatRequests.filter(request => request.status !== "pending");
    appendActivity(room,clientId,"Бой завершён",scene.name);
    setActiveScene(room,scene); saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("combat:end-turn", ({ tokenId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    const current = scene.tokens.find(token => token.id === scene.initiative.currentTokenId);
    if (!current) return reply({ ok:false, error:"Сейчас нет активного хода" });
    const isDm = room.dmId === clientId;
    if (!isDm && current.playerId !== clientId) return reply({ ok:false, error:"Сейчас не твой ход" });
    if (tokenId && cleanText(tokenId,80) !== current.id) return reply({ ok:false, error:"Активный токен изменился" });
    const next = advanceInitiative(room,scene);
    appendActivity(room, clientId, "Ход завершён", `${current.name} → ${next?.name || "—"}`);
    setActiveScene(room, scene); saveRooms(); emitRoom(code); reply({ ok:true, currentTokenId:next?.id || "" });
  });

  socket.on("initiative:roll", ({ tokenId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room) return reply({ ok:false });
    const scene = activeScene(room);
    let token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) token = sceneTokenForPlayer(scene, clientId);
    if (!token) return reply({ ok:false, error:"Сначала добавь токен на карту" });
    if (room.dmId !== clientId && token.playerId !== clientId) return reply({ ok:false, error:"Можно бросать только за своего персонажа" });
    const dice = token.initiativeAdvantage ? [crypto.randomInt(1,21),crypto.randomInt(1,21)] : [crypto.randomInt(1,21)];
    const natural = Math.max(...dice);
    token.initiative = natural + Number(token.initiativeBonus || 0);
    scene.initiative.active = true;
    const order = initiativeOrder(scene);
    if (!scene.initiative.currentTokenId || !order.some(entry => entry.id === scene.initiative.currentTokenId)) beginTurn(room,scene,order[0]);
    else if (!scene.initiative.turnState || scene.initiative.turnState.tokenId !== scene.initiative.currentTokenId) beginTurn(room,scene,order.find(entry=>entry.id===scene.initiative.currentTokenId));
    setActiveScene(room, scene);
    room.rollLog.push({ id:id(), playerId:clientId, player:room.players[clientId]?.name || token.name, label:`Инициатива · ${token.name}`, formula:`1к20${Number(token.initiativeBonus)>=0?"+":""}${Number(token.initiativeBonus)||0}`, dice, modifier:Number(token.initiativeBonus)||0, total:token.initiative, mode:token.initiativeAdvantage?"advantage":"normal", natural, visibility:"public", privateToDm:Boolean(token.hidden), at:Date.now() });
    room.rollLog = room.rollLog.slice(-100);
    saveRooms(); emitRoom(code); reply({ ok:true, natural, total:token.initiative });
  });

  socket.on("initiative:set", ({ tokenId, value } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий меняет инициативу вручную" });
    const scene = activeScene(room);
    const token = scene.tokens.find(entry => entry.id === cleanText(tokenId,80));
    if (!token) return reply({ ok:false, error:"Токен не найден" });
    token.initiative = value === null || value === "" ? null : Math.max(-100,Math.min(200,Number(value)||0));
    scene.initiative.active = scene.tokens.some(entry => entry.initiative !== null);
    const order = initiativeOrder(scene);
    if (!order.length) beginTurn(room,scene,null);
    else if (!order.some(entry => entry.id === scene.initiative.currentTokenId)) beginTurn(room,scene,order[0]);
    else if (!scene.initiative.turnState || scene.initiative.turnState.tokenId !== scene.initiative.currentTokenId) beginTurn(room,scene,order.find(entry=>entry.id===scene.initiative.currentTokenId));
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("initiative:next", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий переключает ход" });
    const scene = activeScene(room), order = initiativeOrder(scene);
    if (!order.length) return reply({ ok:false, error:"Инициатива ещё не брошена" });
    advanceInitiative(room,scene);
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("initiative:clear", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий очищает инициативу" });
    const scene = activeScene(room);
    scene.tokens.forEach(token => { token.initiative = null; });
    scene.initiative = { active:false, round:1, currentTokenId:"", turnState:null, resources:{} };
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("dice:roll", ({ formula, label, mode, visibility, silent }, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    const player = room?.players?.[clientId];
    if (!room || !player) return reply({ ok: false, error: "Игрок не подключён" });
    const parsed = parseDiceFormula(formula, mode);
    if (!parsed.ok) return reply({ ok: false, error: parsed.error });
    let safeVisibility = ["private","gm"].includes(visibility) ? visibility : "public";
    if (safeVisibility === "gm" && room.dmId !== clientId) safeVisibility = "private";
    if (!silent) {
      room.rollLog.push({ id: id(), playerId:clientId, player: player.name, label: cleanText(label, 60) || parsed.formula, formula: parsed.formula, dice: parsed.dice, detail: parsed.detail, modifier: parsed.modifier, total: parsed.total, mode: parsed.mode, natural: parsed.natural, visibility:safeVisibility, at: Date.now() });
      room.rollLog = room.rollLog.slice(-100);
      saveRooms();
      emitRoom(code);
    }
    reply({ ok: true, formula:parsed.formula, total: parsed.total, dice: parsed.dice, detail: parsed.detail, modifier:parsed.modifier, mode: parsed.mode, natural: parsed.natural });
  });

  socket.on("activity:log", ({ label, detail }, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    const player = room?.players?.[clientId];
    if (!room || !player) return reply({ ok: false });
    room.rollLog.push({ id: id(), playerId:clientId, player: player.name, label: cleanText(label, 80), activity: cleanText(detail, 120), total: null, visibility:"public", at: Date.now() });
    room.rollLog = room.rollLog.slice(-100);
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
