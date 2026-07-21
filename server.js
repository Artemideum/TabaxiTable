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
    schemaVersion: 2,
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
    initiative: { active: false, round: 1, currentTokenId: "" },
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
      initiative
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
  const tokenIds = new Set(tokens.map(token => token.id));
  const initiativeSource = incoming.initiative && typeof incoming.initiative === "object" ? incoming.initiative : {};
  return {
    schemaVersion: 2,
    id: cleanText(incoming.id, 80) || base.id,
    name: cleanText(incoming.name, 60) || base.name,
    published: incoming.published !== false,
    backgroundUrl: cleanText(incoming.backgroundUrl, 1000),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(incoming.backgroundColor) ? incoming.backgroundColor : base.backgroundColor,
    grid,
    tokens,
    objects,
    initiative: {
      active: Boolean(initiativeSource.active) && tokens.some(token => token.initiative !== null),
      round: Math.max(1, Math.min(999, Number(initiativeSource.round) || 1)),
      currentTokenId: tokenIds.has(cleanText(initiativeSource.currentTokenId, 80)) ? cleanText(initiativeSource.currentTokenId, 80) : ""
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

function initiativeOrder(scene) {
  return scene.tokens.filter(token => token.initiative !== null).sort((a, b) => Number(b.initiative) - Number(a.initiative) || a.name.localeCompare(b.name, "ru"));
}

function defaultSheet(playerName) {
  return {
    schemaVersion: 8,
    characterName: playerName,
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
  normalized.schemaVersion = 8;
  normalized.passivePerceptionBonus = Math.max(-100, Math.min(100, Number(incoming.passivePerceptionBonus) || 0));
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
  if (!isDm) {
    scene.tokens = scene.tokens.filter(token => !token.hidden);
    scene.objects = scene.objects.filter(object => !object.hidden);
    if (!scene.tokens.some(token => token.id === scene.initiative.currentTokenId)) scene.initiative.currentTokenId = "";
    scene.initiative.active = scene.tokens.some(token => token.initiative !== null);
  }
  return {
    code: room.code,
    title: room.title,
    dmId: room.dmId,
    players,
    rollLog: room.rollLog.filter(entry => !entry.privateToDm || isDm).slice(-30),
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
    ensureRoomVtt(room);
    room.rollLog = Array.isArray(backup.rollLog) ? backup.rollLog.slice(-30).map(entry => ({
      id:id(), player:cleanText(entry?.player, 40) || "Игрок", label:cleanText(entry?.label, 80), activity:cleanText(entry?.activity, 120),
      formula:cleanText(entry?.formula, 100), dice:Array.isArray(entry?.dice) ? entry.dice.slice(0,100).map(Number) : [], modifier:Number(entry?.modifier || 0),
      total:entry?.total === null ? null : Number(entry?.total || 0), mode:["advantage","disadvantage"].includes(entry?.mode) ? entry.mode : "normal", natural:Number(entry?.natural || 0) || null, at:Number(entry?.at || Date.now())
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
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий добавляет токены" });
    const scene = activeScene(room);
    const playerId = cleanText(payload.playerId, 80);
    const player = room.players[playerId];
    if (player && sceneTokenForPlayer(scene, playerId)) return reply({ ok:false, error:"Токен этого персонажа уже на сцене" });
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
      hidden:Boolean(payload.hidden), locked:Boolean(payload.locked), z:100,
      initiativeBonus:Math.max(-100, Math.min(100, Number(player ? sheetInitiativeBonus(sheet) : payload.initiativeBonus) || 0)),
      initiativeAdvantage:Boolean(player ? sheet.initiativeAdvantage : payload.initiativeAdvantage),
      initiative:null
    });
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true, scene:activeScene(room) });
  });

  socket.on("scene:party-add", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий добавляет токены" });
    const scene = activeScene(room);
    let added = 0;
    Object.entries(room.players).forEach(([playerId, player]) => {
      if (sceneTokenForPlayer(scene, playerId)) return;
      const position = nextScenePosition(scene), sheet = player.sheet || {};
      scene.tokens.push({ id:id(), playerId, name:cleanText(sheet.characterName || player.name,60), x:position.x, y:position.y, size:Number(sheet.tokenScale)||1, color:sheet.tokenColor||"#9f7842", imageUrl:cleanText(sheet.tokenImageUrl || sheet.portraitUrl,1000), vision:Number(sheet.tokenVision)||0, hidden:false, locked:false, initiativeBonus:sheetInitiativeBonus(sheet), initiativeAdvantage:Boolean(sheet.initiativeAdvantage), initiative:null });
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
    if (!token.playerId) {
      token.name = cleanText(payload.name ?? token.name,60) || token.name;
      token.imageUrl = cleanText(payload.imageUrl ?? token.imageUrl,1000);
      token.color = /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : token.color;
      token.size = Math.max(0.25,Math.min(12,Number(payload.size)||token.size));
      token.rotation = Math.max(-3600,Math.min(3600,Number(payload.rotation)||0));
      token.opacity = Math.max(.05,Math.min(1,Number(payload.opacity)||1));
      token.vision = Math.max(0,Math.min(10000,Number(payload.vision)||0));
      token.initiativeBonus = Math.max(-100,Math.min(100,Number(payload.initiativeBonus)||0));
    }
    if (isDm) { token.hidden = Boolean(payload.hidden); token.locked = Boolean(payload.locked); }
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("scene:token-remove", ({ tokenId } = {}, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий удаляет токены" });
    const scene = activeScene(room);
    const idToRemove = cleanText(tokenId,80);
    scene.tokens = scene.tokens.filter(token => token.id !== idToRemove);
    if (scene.initiative.currentTokenId === idToRemove) scene.initiative.currentTokenId = "";
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
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
    if (!scene.initiative.currentTokenId || !order.some(entry => entry.id === scene.initiative.currentTokenId)) scene.initiative.currentTokenId = order[0]?.id || "";
    setActiveScene(room, scene);
    room.rollLog.push({ id:id(), player:room.players[clientId]?.name || token.name, label:`Инициатива · ${token.name}`, formula:`1к20${Number(token.initiativeBonus)>=0?"+":""}${Number(token.initiativeBonus)||0}`, dice, modifier:Number(token.initiativeBonus)||0, total:token.initiative, mode:token.initiativeAdvantage?"advantage":"normal", natural, privateToDm:Boolean(token.hidden), at:Date.now() });
    room.rollLog = room.rollLog.slice(-30);
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
    if (!order.some(entry => entry.id === scene.initiative.currentTokenId)) scene.initiative.currentTokenId = order[0]?.id || "";
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("initiative:next", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий переключает ход" });
    const scene = activeScene(room), order = initiativeOrder(scene);
    if (!order.length) return reply({ ok:false, error:"Инициатива ещё не брошена" });
    const currentIndex = order.findIndex(token => token.id === scene.initiative.currentTokenId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % order.length;
    if (currentIndex >= 0 && nextIndex === 0) scene.initiative.round = Math.min(999,scene.initiative.round + 1);
    scene.initiative.active = true;
    scene.initiative.currentTokenId = order[nextIndex].id;
    setActiveScene(room, scene);
    saveRooms(); emitRoom(code); reply({ ok:true });
  });

  socket.on("initiative:clear", (_payload, reply = () => {}) => {
    const { code, clientId } = socket.data || {};
    const room = rooms[code];
    if (!room || room.dmId !== clientId) return reply({ ok:false, error:"Только ведущий очищает инициативу" });
    const scene = activeScene(room);
    scene.tokens.forEach(token => { token.initiative = null; });
    scene.initiative = { active:false, round:1, currentTokenId:"" };
    setActiveScene(room, scene);
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
    reply({ ok: true, formula:parsed.formula, total: parsed.total, dice: parsed.dice, detail: parsed.detail, modifier:parsed.modifier, mode: parsed.mode, natural: parsed.natural });
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
