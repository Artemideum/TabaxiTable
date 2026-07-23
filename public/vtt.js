(() => {
  "use strict";

  const WORLD_WIDTH = 16000;
  const WORLD_HEIGHT = 12000;
  const ORIGIN_X = WORLD_WIDTH / 2;
  const ORIGIN_Y = WORLD_HEIGHT / 2;
  const SQRT3_OVER_2 = Math.sqrt(3) / 2;

  const cameraByScene = new Map();
  const selectionByScene = new Map();
  const measurementByScene = new Map();
  const UI_STORAGE_KEY = "tt-vtt-ui";
  let savedUi = {};
  try { savedUi = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || "{}"); } catch {}
  const ui = {
    leftPanel: null,
    rightPanel: ["character","inspector","initiative"].includes(savedUi.rightPanel) ? savedUi.rightPanel : null,
    tool: "select",
    color: "#f4c875",
    fill: "#b94b42",
    fillOpacity: 0.18,
    strokeWidth: 3,
    characterPlayerId: null,
    characterPage: ["overview","combat","checks","spells","notes"].includes(savedUi.characterPage) ? savedUi.characterPage : "overview",
    characterChecksPage: ["saves","skills-a","skills-b"].includes(savedUi.characterChecksPage) ? savedUi.characterChecksPage : "saves",
    fogShape: ["rect","circle","draw"].includes(savedUi.fogShape) ? savedUi.fogShape : "rect",
    diceFormula: "3d6+1",
    movementSnap: typeof savedUi.movementSnap === "boolean" ? savedUi.movementSnap : null,
    transformRef: null,
    contextMenu: null
  };
  let assetFilter = "all";
  let assetSearch = "";
  let assetFolder = "all";
  const customAssetFolders = new Set();
  let sceneSearch = "";
  let encounterSearch = "";
  let clipboard = null;
  let controller = null;
  let spaceHeld = false;
  let active = false;
  let currentCameraCenterGrid = () => ({ x:0, y:0 });

  const cameraCenterGrid = () => currentCameraCenterGrid();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const roundTenth = value => Math.round((Number(value) || 0) * 10) / 10;
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const bonusText = value => `${Number(value) >= 0 ? "+" : ""}${Number(value) || 0}`;
  const saveUiState = () => { try { localStorage.setItem(UI_STORAGE_KEY,JSON.stringify({ rightPanel:ui.rightPanel, characterPage:ui.characterPage, characterChecksPage:ui.characterChecksPage, fogShape:ui.fogShape, movementSnap:ui.movementSnap !== false })); } catch {} };
  const sceneKey = room => `${room.code}:${room.scene?.id || room.activeSceneId || "main"}`;
  const refKey = ref => `${ref.kind}:${ref.id}`;
  const uniqueRefs = refs => [...new Map((refs || []).filter(ref => ref?.kind && ref?.id).map(ref => [refKey(ref), { kind:ref.kind, id:ref.id }])).values()];
  const NPC_ABILITY_LABELS = { str:"Сила", dex:"Ловкость", con:"Телосложение", int:"Интеллект", wis:"Мудрость", cha:"Харизма" };
  const npcModifier = value => Math.floor((Number(value || 10) - 10) / 2);
  const npcStatFormula = value => `1d20${npcModifier(value) >= 0 ? "+" : ""}${npcModifier(value)}`;

  function getCamera(room) {
    const key = sceneKey(room);
    if (!cameraByScene.has(key)) cameraByScene.set(key, { zoom:0.82, panX:null, panY:null });
    return cameraByScene.get(key);
  }

  function getSelection(room) {
    return selectionByScene.get(sceneKey(room)) || [];
  }

  function setSelection(room, refs) {
    selectionByScene.set(sceneKey(room), uniqueRefs(refs));
  }

  function getMeasurement(room) {
    return measurementByScene.get(sceneKey(room)) || null;
  }

  function measurementFeet(grid, start, end) {
    const dx = Math.abs(Number(end.x) - Number(start.x));
    const dy = Math.abs(Number(end.y) - Number(start.y));
    if (grid?.snap === false) return Math.round(Math.hypot(dx,dy) * 50) / 10;
    const type = ["square","hex-row","hex-column","isometric"].includes(grid?.type) ? grid.type : "square";
    if (type === "hex-row" || type === "hex-column") {
      const cells = (dx + dy + Math.abs((Number(end.x)-Number(start.x)) + (Number(end.y)-Number(start.y)))) / 2;
      return Math.round(cells) * 5;
    }
    // D&D 5e: horizontal, vertical and diagonal grid steps each cost 5 feet.
    return Math.round(Math.max(dx,dy)) * 5;
  }

  function sceneOrder(scene) {
    return (scene.tokens || [])
      .filter(token => token.initiative !== null && token.initiative !== undefined)
      .sort((a, b) => Number(b.initiative) - Number(a.initiative) || String(a.name).localeCompare(String(b.name), "ru"));
  }

  function emit(ctx, event, payload = {}, success = "") {
    return new Promise(resolve => {
      ctx.socket.emit(event, payload, response => {
        const result = response || { ok:false };
        if (!result.ok) ctx.toast(result.error || "Не удалось изменить сцену");
        else if (success) ctx.toast(success);
        resolve(result);
      });
    });
  }

  function axialRound(q, r) {
    let x = q;
    let z = r;
    let y = -x - z;
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const xDiff = Math.abs(rx - x);
    const yDiff = Math.abs(ry - y);
    const zDiff = Math.abs(rz - z);
    if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
    else if (yDiff > zDiff) ry = -rx - rz;
    else rz = -rx - ry;
    return { x:rx, y:rz };
  }

  function gridMetrics(grid = {}, cell = 52) {
    const type = ["square", "hex-row", "hex-column", "isometric"].includes(grid.type) ? grid.type : "square";
    const originX = ORIGIN_X + Number(grid.offsetX || 0);
    const originY = ORIGIN_Y + Number(grid.offsetY || 0);

    const toWorld = (x, y) => {
      const gx = Number(x) || 0;
      const gy = Number(y) || 0;
      if (type === "hex-row") return { x:originX + gx * cell * 0.75, y:originY + (gy + gx * 0.5) * cell * SQRT3_OVER_2 };
      if (type === "hex-column") return { x:originX + (gx + gy * 0.5) * cell * SQRT3_OVER_2, y:originY + gy * cell * 0.75 };
      if (type === "isometric") return { x:originX + (gx - gy) * cell * 0.5, y:originY + (gx + gy) * cell * 0.25 };
      return { x:originX + gx * cell, y:originY + gy * cell };
    };

    const fromWorldRaw = (worldX, worldY) => {
      const dx = worldX - originX;
      const dy = worldY - originY;
      if (type === "hex-row") {
        const x = dx / (cell * 0.75);
        return { x, y:dy / (cell * SQRT3_OVER_2) - x * 0.5 };
      }
      if (type === "hex-column") {
        const y = dy / (cell * 0.75);
        return { x:dx / (cell * SQRT3_OVER_2) - y * 0.5, y };
      }
      if (type === "isometric") {
        const a = 2 * dx / cell;
        const b = 4 * dy / cell;
        return { x:(a + b) / 2, y:(b - a) / 2 };
      }
      return { x:dx / cell, y:dy / cell };
    };

    const snap = (point, mode = "intersection") => {
      if (mode === "raw" || grid.snap === false) return { x:roundTenth(point.x), y:roundTenth(point.y) };
      if (type === "hex-row" || type === "hex-column") return axialRound(point.x, point.y);
      if (mode === "cell") return { x:Math.floor(point.x), y:Math.floor(point.y) };
      if (mode === "center") return { x:Math.floor(point.x) + 0.5, y:Math.floor(point.y) + 0.5 };
      return { x:Math.round(point.x), y:Math.round(point.y) };
    };

    return { type, cell, originX, originY, toWorld, fromWorldRaw, snap };
  }

  function itemPosition(metrics, x, y, widthCells = 1, heightCells = 1) {
    const point = metrics.toWorld(x, y);
    if (metrics.type === "hex-row" || metrics.type === "hex-column" || metrics.type === "isometric") {
      return { left:point.x - widthCells * metrics.cell / 2, top:point.y - heightCells * metrics.cell / 2 };
    }
    return { left:point.x, top:point.y };
  }

  function resolveRef(scene, ref) {
    if (!ref) return null;
    if (ref.kind === "token") {
      const value = (scene.tokens || []).find(entry => entry.id === ref.id);
      return value ? { kind:"token", value } : null;
    }
    if (ref.kind === "object") {
      const value = (scene.objects || []).find(entry => entry.id === ref.id);
      return value ? { kind:"object", value } : null;
    }
    if (ref.kind === "annotation") {
      const value = (scene.annotations || []).find(entry => entry.id === ref.id);
      return value ? { kind:"annotation", value } : null;
    }
    return null;
  }

  function selectedEntries(room) {
    return getSelection(room).map(ref => resolveRef(room.scene, ref)).filter(Boolean);
  }

  function selectionHas(selection, kind, id) {
    return selection.some(ref => ref.kind === kind && ref.id === id);
  }

  function transformRefMatches(kind, id) {
    return ui.transformRef?.kind === kind && ui.transformRef?.id === id;
  }

  function clearTransformMode() {
    ui.transformRef = null;
  }

  function closeContextMenu() {
    ui.contextMenu = null;
  }

  function movementSnaps() {
    return ui.movementSnap !== false;
  }

  function assetCard(asset) {
    const categoryLabel = { token:"Токен", map:"Карта", prop:"Объект", source:"Исходник" }[asset.category] || "Ресурс";
    return `<article class="vtt-asset-card" draggable="${asset.category === "source" ? "false" : "true"}" data-vtt-asset="${esc(asset.id)}">
      <div class="vtt-asset-preview"><img src="${esc(asset.url)}" alt=""><span>${categoryLabel}</span></div>
      <div class="vtt-asset-info"><strong title="${esc(asset.name)}">${esc(asset.name)}</strong><small>${asset.folder ? `▤ ${esc(asset.folder)} · ` : ""}${asset.usageCount ? `На сценах: ${Number(asset.usageCount)}` : "Ещё не размещён"}</small></div>
      <div class="vtt-asset-actions">${asset.category === "token" && asset.tokenRecipe ? `<button type="button" data-vtt-forge-edit="${esc(asset.id)}" title="Открыть рецепт в Кузнице">✦</button>` : ""}${asset.category !== "source" ? `<button type="button" data-vtt-place="${esc(asset.id)}" title="Поставить в центр">＋</button>` : ""}<button type="button" data-vtt-asset-edit="${esc(asset.id)}" title="Настроить">⋮</button></div>
    </article>`;
  }

  function transformHandlesMarkup(kind, id, enabled) {
    if (!enabled) return "";
    const edges = kind === "object" ? ["nw","n","ne","e","se","s","sw","w"] : ["nw","ne","se","sw"];
    return `<span class="vtt-transform-handles" aria-hidden="true">${edges.map(edge => `<span class="vtt-transform-handle is-${edge}" data-vtt-resize-handle="${edge}" data-vtt-transform-kind="${kind}" data-vtt-transform-id="${esc(id)}"></span>`).join("")}<span class="vtt-rotate-line"></span><span class="vtt-rotate-handle" data-vtt-rotate-handle data-vtt-transform-kind="${kind}" data-vtt-transform-id="${esc(id)}">↻</span></span>`;
  }

  function objectMarkup(object, metrics, selection, isDm) {
    const position = itemPosition(metrics, object.x, object.y, object.width, object.height);
    const movable = isDm && !object.locked;
    const selected = selectionHas(selection, "object", object.id);
    const transforming = transformRefMatches("object",object.id);
    return `<button type="button" class="vtt-scene-object ${object.type === "map" ? "is-map" : "is-prop"} ${object.hidden ? "is-hidden" : ""} ${object.locked ? "is-locked" : ""} ${selected ? "is-selected" : ""} ${transforming ? "is-transforming" : ""}"
      data-vtt-object="${esc(object.id)}" data-vtt-movable="${movable ? "1" : "0"}"
      style="left:${position.left}px;top:${position.top}px;width:${Number(object.width || 1) * metrics.cell}px;height:${Number(object.height || 1) * metrics.cell}px;--rotation:${Number(object.rotation) || 0}deg;--opacity:${Number(object.opacity) || 1};--z:${Number(object.z) || 0}"
      title="${esc(object.name)}">
      ${object.imageUrl ? `<img src="${esc(object.imageUrl)}" alt="">` : `<span>${esc(object.name)}</span>`}
      <strong>${esc(object.name)}</strong>
      ${transformHandlesMarkup("object",object.id,selected&&isDm&&ui.tool==="select"&&transformRefMatches("object",object.id))}
    </button>`;
  }

  function tokenMarkup(token, metrics, selection, currentId, isDm, clientId) {
    const size = Number(token.size) || 1;
    const position = itemPosition(metrics, token.x, token.y, size, size);
    const movable = isDm || token.playerId === clientId;
    const hpMax = Math.max(1, Number(token.hpMax) || 1);
    const hp = Math.max(0, Math.min(hpMax, Number(token.hp) || 0));
    const tempHp = Math.max(0, Number(token.tempHp) || 0);
    const hpPercent = Math.max(0, Math.min(100, hp / hpMax * 100));
    const badge = String(token.badge || "").trim();
    const selected = selectionHas(selection, "token", token.id);
    const canTransform = isDm;
    const transforming = transformRefMatches("token",token.id);
    return `<button type="button" class="vtt-token ${token.forged ? "is-forged" : ""} token-shape-${esc(token.tokenShape || "circle")} disposition-${esc(token.disposition || "neutral")} ${token.hidden ? "is-hidden" : ""} ${token.locked ? "is-locked" : ""} ${selected ? "is-selected" : ""} ${transforming ? "is-transforming" : ""} ${token.id === currentId ? "is-current" : ""} ${hp <= 0 ? "is-down" : ""}"
      data-vtt-token="${esc(token.id)}" data-vtt-movable="${movable && (!token.locked || isDm) ? "1" : "0"}"
      style="left:${position.left}px;top:${position.top}px;width:${size * metrics.cell}px;height:${size * metrics.cell}px;--rotation:${Number(token.rotation) || 0}deg;--opacity:${Number(token.opacity) || 1};--z:${Number(token.z) || 100};--color:${esc(token.color || "#9f7842")};--badge-color:${esc(token.badgeColor || "#f4c875")}"
      title="${esc(token.name)} · HP ${hp}/${hpMax}${tempHp ? ` +${tempHp}` : ""} · КД ${Number(token.ac || 0)}">
      ${badge ? `<em class="vtt-token-badge">${esc(badge)}</em>` : ""}
      ${token.showName !== false ? `<strong class="vtt-token-name">${esc(token.name)}</strong>` : ""}
      <i>${token.imageUrl ? `<img src="${esc(token.imageUrl)}" alt="">` : `<span>${esc((token.name || "?")[0].toUpperCase())}</span>`}</i>
      ${token.showHp !== false ? `<span class="vtt-token-hp"><i style="width:${hpPercent}%"></i><em>${hp}/${hpMax}${tempHp ? ` +${tempHp}` : ""}</em></span>` : ""}
      ${token.showAc ? `<span class="vtt-token-ac" title="Класс доспеха">◈ ${Number(token.ac || 0)}</span>` : ""}
      ${token.initiative !== null && token.initiative !== undefined ? `<b>${Number(token.initiative)}</b>` : ""}
      ${transformHandlesMarkup("token",token.id,selected&&canTransform&&ui.tool==="select"&&transformRefMatches("token",token.id))}
    </button>`;
  }

  function tokenQuickHpMarkup(scene, metrics, selection, isDm, clientId) {
    if (!Array.isArray(selection) || selection.length !== 1 || selection[0].kind !== "token" || ui.tool !== "select" || ui.transformRef) return "";
    const token=(scene.tokens||[]).find(item=>item.id===selection[0].id);
    if (!token || !(isDm || token.playerId===clientId)) return "";
    const size=Number(token.size)||1, position=itemPosition(metrics,token.x,token.y,size,size);
    const left=position.left+size*metrics.cell/2, top=position.top-10;
    const hp=Number(token.hp||0), hpMax=Number(token.hpMax||1);
    const death=hp<=0?`<div class="vtt-token-death-saves"><span title="Успехи">${[0,1,2].map(index=>`<i class="${index<Number(token.deathSuccess||0)?"filled":""}"></i>`).join("")}</span><button type="button" data-vtt-token-death-save="${esc(token.id)}" title="Спасбросок от смерти">🎲</button><span class="fails" title="Провалы">${[0,1,2].map(index=>`<i class="${index<Number(token.deathFail||0)?"filled":""}"></i>`).join("")}</span></div>`:"";
    return `<div class="vtt-token-quick-hp" style="left:${left}px;top:${top}px" data-vtt-token-quick-hp="${esc(token.id)}"><div class="vtt-token-hp-actions"><button type="button" data-vtt-token-hp-delta="-1" title="Урон 1 · Shift: 5">−</button><button type="button" data-vtt-token-hp-prompt title="Ввести урон или лечение"><strong><span>${hp}</span><i>/</i><span>${hpMax}</span></strong></button><button type="button" data-vtt-token-hp-delta="1" title="Лечение 1 · Shift: 5">＋</button></div>${death}</div>`;
  }

  function contextMenuMarkup(room, isDm, clientId) {
    const menu = ui.contextMenu;
    if (!menu) return "";
    const refs = uniqueRefs(Array.isArray(menu.refs) && menu.refs.length ? menu.refs : menu.ref ? [menu.ref] : []);
    const groupEntries = refs.map(ref => resolveRef(room.scene,ref)).filter(Boolean);
    const entry = menu.ref ? resolveRef(room.scene, menu.ref) : null;
    const button = (action, label, extra = "") => `<button type="button" data-vtt-context-action="${action}" ${extra}>${label}</button>`;
    let content = "";
    if (groupEntries.length > 1) {
      const tokensOnly = groupEntries.every(item => item.kind === "token");
      content = `<div class="vtt-context-title"><small>Группа</small><strong>Выбрано: ${groupEntries.length}</strong></div>
        ${tokensOnly && isDm ? button("group-settings","⚙ Параметры токенов") + button("group-initiative","⚔ Бросить инициативу") : ""}
        ${button("inspector","◆ Открыть инспектор")}
        ${isDm ? button("duplicate","⧉ Дублировать группу") + button("delete","Удалить группу",'class="danger-action"') : ""}`;
    } else if (!entry) {
      content = `<div class="vtt-context-title"><small>Игровое поле</small><strong>Быстрые действия</strong></div>
        ${button("toggle-snap", movementSnaps() ? "◫ Движение по сетке" : "⌁ Свободное движение")}
        ${button("measure", "↗ Начать измерение")}${button("ping", "◎ Поставить указатель")}
        ${button("tools", "⌘ Открыть инструменты")}${isDm ? button("library", "▧ Открыть ресурсы") : ""}`;
    } else if (entry.kind === "token") {
      const token = entry.value;
      const canEdit = isDm || token.playerId === clientId;
      content = `<div class="vtt-context-title"><small>${token.playerId ? "Персонаж" : "NPC"}</small><strong>${esc(token.name)}</strong></div>
        ${token.playerId ? button("open-character", "☷ Быстрый лист") : button("open-npc", "☷ Лист NPC")}
        ${token.bestiaryKey ? button("open-bestiary", "♜ Открыть в бестиарии") : ""}
        ${canEdit ? button("initiative", "⚔ Бросить инициативу") : ""}
        ${isDm ? button("transform", "⌖ Трансформировать") + button("attach", token.attachment ? "⛓ Изменить привязку" : "⛓ Прикрепить к…") + (token.attachment ? button("detach","Разорвать привязку") : "") : ""}
        ${canEdit ? button("settings", "⚙ Настроить") : ""}
        ${token.playerId===clientId ? button("appearances", "⬡ Облики персонажа") : ""}
        ${canEdit ? `<div class="vtt-context-submenu">${button("toggle-name", token.showName !== false ? "Скрыть имя" : "Показать имя")}${button("toggle-hp", token.showHp !== false ? "Скрыть HP" : "Показать HP")}${button("toggle-ac", token.showAc ? "Скрыть КД" : "Показать КД")}</div>` : ""}
        ${isDm ? `<div class="vtt-context-submenu">${button("toggle-hidden", token.hidden ? "Показать токен" : "Скрыть токен")}${button("toggle-locked", token.locked ? "Разблокировать" : "Заблокировать")}</div>${button("duplicate", "⧉ Дублировать")}${button("delete", "Удалить", 'class="danger-action"')}` : ""}`;
    } else if (entry.kind === "object") {
      const object = entry.value;
      content = `<div class="vtt-context-title"><small>${object.type === "map" ? "Карта" : "Объект"}</small><strong>${esc(object.name)}</strong></div>
        <div class="vtt-context-submenu">${button("toggle-snap", movementSnaps() ? "◫ По сетке" : "⌁ Свободно")}${button("measure", "↗ Линейка")}${button("ping", "◎ Указатель")}${button("tools", "⌘ Инструменты")}</div>
        ${isDm ? `${button("transform", "⌖ Трансформировать")}${button("attach", object.attachment ? "⛓ Изменить привязку" : "⛓ Прикрепить к…")}${object.attachment ? button("detach","Разорвать привязку") : ""}${button("settings", "⚙ Настроить")}
        <div class="vtt-context-submenu">${button("toggle-hidden", object.hidden ? "Показать" : "Скрыть")}${button("toggle-locked", object.locked ? "Разблокировать" : "Заблокировать")}</div>
        ${button("duplicate", "⧉ Дублировать")}${button("delete", "Удалить", 'class="danger-action"')}` : ""}`;
    } else {
      const annotation = entry.value;
      const canEdit = isDm || annotation.ownerId === clientId;
      content = `<div class="vtt-context-title"><small>Рисунок</small><strong>${esc(annotation.name || annotation.kind || "Объект")}</strong></div>
        <div class="vtt-context-submenu">${button("toggle-snap", movementSnaps() ? "◫ По сетке" : "⌁ Свободно")}${button("measure", "↗ Линейка")}${button("ping", "◎ Указатель")}${button("tools", "⌘ Инструменты")}</div>
        ${isDm ? `${button("attach", annotation.attachment ? "⛓ Изменить привязку" : "⛓ Прикрепить к…")}${annotation.attachment ? button("detach","Разорвать привязку") : ""}` : ""}
        ${canEdit ? button("settings", "⚙ Настроить") : ""}
        ${isDm ? `<div class="vtt-context-submenu">${button("toggle-hidden", annotation.hidden ? "Показать" : "Скрыть")}${button("toggle-locked", annotation.locked ? "Разблокировать" : "Заблокировать")}</div>
        ${button("duplicate", "⧉ Дублировать")}${button("delete", "Удалить", 'class="danger-action"')}` : ""}`;
    }
    const left = clamp(menu.x,8,Math.max(8,window.innerWidth-270));
    const top = clamp(menu.y,8,Math.max(8,window.innerHeight-540));
    return `<div class="vtt-context-menu" role="menu" style="left:${Math.round(left)}px;top:${Math.round(top)}px" data-vtt-context-menu>${content}</div>`;
  }

  function annotationPoints(annotation, metrics) {
    const start = metrics.toWorld(annotation.x, annotation.y);
    const end = metrics.toWorld(annotation.x2, annotation.y2);
    const points = (annotation.points || []).map(point => metrics.toWorld(point.x, point.y));
    return { start, end, points };
  }

  function conePolygon(start, end) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const spread = Math.PI / 6;
    const left = { x:start.x + Math.cos(angle - spread) * length, y:start.y + Math.sin(angle - spread) * length };
    const right = { x:start.x + Math.cos(angle + spread) * length, y:start.y + Math.sin(angle + spread) * length };
    return `${start.x},${start.y} ${left.x},${left.y} ${right.x},${right.y}`;
  }

  function annotationMarkup(annotation, metrics, selection) {
    const { start, end, points } = annotationPoints(annotation, metrics);
    const selected = selectionHas(selection, "annotation", annotation.id);
    const common = `class="vtt-annotation-shape ${selected ? "is-selected" : ""}" data-vtt-annotation="${esc(annotation.id)}" data-vtt-movable="${annotation.locked ? "0" : "1"}" stroke="${esc(annotation.color || "#f4c875")}" stroke-width="${Number(annotation.strokeWidth || 3)}" opacity="${Number(annotation.opacity || 1)}" vector-effect="non-scaling-stroke"`;
    const fill = esc(annotation.fill || "#b94b42");
    const fillOpacity = Number(annotation.fillOpacity || 0.18);
    let shape = "";
    if (annotation.kind === "rect") {
      shape = `<rect ${common} x="${Math.min(start.x, end.x)}" y="${Math.min(start.y, end.y)}" width="${Math.abs(end.x - start.x)}" height="${Math.abs(end.y - start.y)}" fill="${fill}" fill-opacity="${fillOpacity}"/>`;
    } else if (annotation.kind === "circle") {
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      shape = `<circle ${common} cx="${start.x}" cy="${start.y}" r="${radius}" fill="${fill}" fill-opacity="${fillOpacity}"/>`;
    } else if (annotation.kind === "cone") {
      shape = `<polygon ${common} points="${conePolygon(start, end)}" fill="${fill}" fill-opacity="${fillOpacity}" stroke-linejoin="round"/>`;
    } else if (annotation.kind === "draw") {
      shape = `<polyline ${common} points="${points.map(point => `${point.x},${point.y}`).join(" ")}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (annotation.kind === "text") {
      shape = `<text class="vtt-annotation-text ${selected ? "is-selected" : ""}" data-vtt-annotation="${esc(annotation.id)}" data-vtt-movable="${annotation.locked ? "0" : "1"}" x="${start.x}" y="${start.y}" fill="${esc(annotation.color || "#f4c875")}" opacity="${Number(annotation.opacity || 1)}">${esc(annotation.text || annotation.name || "Текст")}</text>`;
    } else {
      shape = `<line ${common} x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke-linecap="round"/>`;
    }
    return `<g class="vtt-annotation ${annotation.hidden ? "is-hidden" : ""} ${annotation.locked ? "is-locked" : ""}" data-vtt-annotation-group="${esc(annotation.id)}">${shape}</g>`;
  }

  function gridSvgMarkup(grid, metrics) {
    if (grid.visible === false) return "";
    const cell = metrics.cell;
    const color = esc(grid.color || "#d3ad6e");
    const opacity = Number(grid.opacity || 0.22);
    const id = `grid-${Math.random().toString(36).slice(2)}`;
    let pattern = "";
    if (metrics.type === "hex-row") {
      const height = cell * SQRT3_OVER_2;
      const points = `${cell * .25},0 ${cell * .75},0 ${cell},${height / 2} ${cell * .75},${height} ${cell * .25},${height} 0,${height / 2}`;
      pattern = `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${metrics.originX}" y="${metrics.originY}" width="${cell * 1.5}" height="${height * 2}"><polygon points="${points}"/><polygon points="${points}" transform="translate(${cell * .75} ${height})"/></pattern>`;
    } else if (metrics.type === "hex-column") {
      const width = cell * SQRT3_OVER_2;
      const points = `${width / 2},0 ${width},${cell * .25} ${width},${cell * .75} ${width / 2},${cell} 0,${cell * .75} 0,${cell * .25}`;
      pattern = `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${metrics.originX}" y="${metrics.originY}" width="${width * 2}" height="${cell * 1.5}"><polygon points="${points}"/><polygon points="${points}" transform="translate(${width} ${cell * .75})"/></pattern>`;
    } else if (metrics.type === "isometric") {
      pattern = `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${metrics.originX}" y="${metrics.originY}" width="${cell}" height="${cell * .5}"><path d="M0 ${cell * .25} L${cell * .5} 0 L${cell} ${cell * .25} L${cell * .5} ${cell * .5} Z"/></pattern>`;
    } else {
      pattern = `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${metrics.originX}" y="${metrics.originY}" width="${cell}" height="${cell}"><path d="M${cell} 0H0V${cell}"/></pattern>`;
    }
    return `<svg class="vtt-grid-layer" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}" aria-hidden="true" style="color:${color};opacity:${opacity}"><defs>${pattern}</defs><rect width="${WORLD_WIDTH}" height="${WORLD_HEIGHT}" fill="url(#${id})" stroke="none"/></svg>`;
  }

  function measurementMarkup(room, metrics) {
    const measurement = getMeasurement(room);
    if (!measurement) return "";
    const start = metrics.toWorld(measurement.x, measurement.y);
    const end = metrics.toWorld(measurement.x2, measurement.y2);
    const feet = measurementFeet(room.scene?.grid || {}, measurement, { x:measurement.x2, y:measurement.y2 });
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    return `<svg class="vtt-measure-layer" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}" aria-hidden="true"><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/><circle cx="${start.x}" cy="${start.y}" r="5"/><circle cx="${end.x}" cy="${end.y}" r="5"/><g transform="translate(${midX} ${midY})"><rect x="-42" y="-15" width="84" height="30" rx="8"/><text text-anchor="middle" dominant-baseline="central">${feet} фт.</text></g></svg>`;
  }

  function pingMarkup(scene, metrics) {
    if (!scene.ping || Date.now() - Number(scene.ping.at || 0) > 5000) return "";
    const point = metrics.toWorld(scene.ping.x, scene.ping.y);
    return `<div class="vtt-ping" style="left:${point.x}px;top:${point.y}px;--ping-color:${esc(scene.ping.color || "#f4c875")}"><i></i><strong>${esc(scene.ping.by || "Игрок")}</strong></div>`;
  }


  function fogMarkup(scene, metrics, isDm) {
    const fog = scene.fog || {};
    const operations = Array.isArray(fog.operations) ? fog.operations : [];
    if (fog.enabled === false || !operations.length) return "";
    const maskId = `fog-${String(scene.id || "scene").replace(/[^a-z0-9_-]/gi,"")}`;
    const shape = operation => {
      const fill = operation.mode === "reveal" ? "black" : "white";
      if (operation.kind === "draw") {
        const points=(operation.points||[]).map(point=>metrics.toWorld(point.x,point.y)).map(point=>`${point.x},${point.y}`).join(" ");
        return `<polyline points="${points}" fill="none" stroke="${fill}" stroke-width="${Math.max(8,Number(operation.strokeWidth||2)*metrics.cell)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      const start=metrics.toWorld(operation.x,operation.y), end=metrics.toWorld(operation.x2,operation.y2);
      if (operation.kind === "circle") return `<circle cx="${start.x}" cy="${start.y}" r="${Math.hypot(end.x-start.x,end.y-start.y)}" fill="${fill}"/>`;
      return `<rect x="${Math.min(start.x,end.x)}" y="${Math.min(start.y,end.y)}" width="${Math.abs(end.x-start.x)}" height="${Math.abs(end.y-start.y)}" fill="${fill}"/>`;
    };
    return `<svg class="vtt-fog-layer ${isDm ? "is-dm" : ""}" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}" aria-hidden="true"><defs><mask id="${maskId}"><rect width="100%" height="100%" fill="black"/>${operations.map(shape).join("")}</mask></defs><rect width="100%" height="100%" fill="#050403" fill-opacity="${Number(fog.opacity||.94)}" mask="url(#${maskId})"/></svg>`;
  }

  function boundsForEntry(entry) {
    const value = entry.value;
    if (entry.kind === "token") return { left:Number(value.x), top:Number(value.y), right:Number(value.x) + Number(value.size || 1), bottom:Number(value.y) + Number(value.size || 1) };
    if (entry.kind === "object") return { left:Number(value.x), top:Number(value.y), right:Number(value.x) + Number(value.width || 1), bottom:Number(value.y) + Number(value.height || 1) };
    const xs = [Number(value.x), Number(value.x2), ...(value.points || []).map(point => Number(point.x))];
    const ys = [Number(value.y), Number(value.y2), ...(value.points || []).map(point => Number(point.y))];
    if (value.kind === "circle") {
      const radius = Math.hypot(Number(value.x2) - Number(value.x), Number(value.y2) - Number(value.y));
      return { left:Number(value.x) - radius, top:Number(value.y) - radius, right:Number(value.x) + radius, bottom:Number(value.y) + radius };
    }
    return { left:Math.min(...xs), top:Math.min(...ys), right:Math.max(...xs), bottom:Math.max(...ys) };
  }

  function inspectorMarkup(entries, isDm, clientId) {
    if (!entries.length) return `<div class="vtt-empty-side"><span>◇</span><strong>Ничего не выбрано</strong><p>Инструментом выбора нажми на токен, карту, объект или рисунок.</p>${isDm ? `<div class="vtt-empty-actions"><button data-vtt-select-set="party">Персонажи</button><button data-vtt-select-set="npc">Все NPC</button><button data-vtt-select-set="tokens">Все токены</button></div>` : ""}</div>`;
    if (entries.length > 1) {
      const tokenCount=entries.filter(entry=>entry.kind==="token").length, objectCount=entries.filter(entry=>entry.kind==="object").length, annotationCount=entries.filter(entry=>entry.kind==="annotation").length;
      return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-object-symbol">${entries.length}</span><div><small>Групповое выделение</small><strong>${entries.length} объектов</strong></div></div>
        <div class="vtt-selection-summary">${tokenCount?`<span>● ${tokenCount} ток.</span>`:""}${objectCount?`<span>▧ ${objectCount} об.</span>`:""}${annotationCount?`<span>✎ ${annotationCount} рис.</span>`:""}</div>
        <div class="vtt-align-grid"><button data-vtt-align="left" title="По левому краю">⇤</button><button data-vtt-align="h-center" title="Центр по горизонтали">↔</button><button data-vtt-align="right" title="По правому краю">⇥</button><button data-vtt-align="top" title="По верхнему краю">⇡</button><button data-vtt-align="v-center" title="Центр по вертикали">↕</button><button data-vtt-align="bottom" title="По нижнему краю">⇣</button><button data-vtt-align="distribute-h" title="Распределить горизонтально">⋯</button><button data-vtt-align="distribute-v" title="Распределить вертикально">⋮</button></div>
        ${isDm?`<div class="vtt-inspector-actions">${tokenCount?`<button class="primary" data-vtt-group-token-settings>Общие параметры</button><button data-vtt-group-roll-initiative>Инициатива группе</button><button data-vtt-encounter-save>Сохранить группу NPC</button>`:""}<button data-vtt-copy-to-scene>На другую сцену</button><button data-vtt-group-duplicate>Дублировать</button><button class="danger-action" data-vtt-group-remove>Удалить</button></div>`:""}</div>`;
    }
    const entry=entries[0], value=entry.value;
    if(entry.kind==="token"){
      const canEdit=isDm||value.playerId===clientId;
      return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-color-dot" style="background:${esc(value.color||"#9f7842")}"></span><div><small>${value.playerId?"Персонаж":"Токен"}</small><strong>${esc(value.name)}</strong></div></div><div class="vtt-stat-grid"><span><small>X / Y</small><b>${Number(value.x)} / ${Number(value.y)}</b></span><span><small>Размер</small><b>${Number(value.size)}</b></span><span><small>HP</small><b>${Number(value.hp||0)}/${Number(value.hpMax||0)}</b></span><span><small>Инициатива</small><b>${value.initiative??"—"}</b></span></div><div class="vtt-inspector-actions">${canEdit?`<button data-vtt-edit-token="${esc(value.id)}">Настроить</button>`:""}${!value.playerId&&(isDm||npcSheetHasData(value.npcSheet))?`<button data-vtt-open-npc="${esc(value.id)}">Лист NPC</button>`:""}${value.bestiaryKey?`<button data-vtt-open-bestiary="${esc(value.bestiaryKey)}">Бестиарий</button>`:""}<button data-vtt-roll="${esc(value.id)}" ${canEdit?"":"disabled"}>Инициатива</button>${isDm?`<button data-vtt-duplicate-selected>Копировать</button><button class="danger-action" data-vtt-remove-selected>Удалить</button>`:""}</div></div>`;
    }
    if(entry.kind==="object") return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-object-symbol">${value.type==="map"?"▦":"◆"}</span><div><small>${value.type==="map"?"Карта":"Объект"}</small><strong>${esc(value.name)}</strong></div></div><div class="vtt-stat-grid"><span><small>X / Y</small><b>${Number(value.x)} / ${Number(value.y)}</b></span><span><small>Размер</small><b>${Number(value.width)} × ${Number(value.height)}</b></span><span><small>Поворот</small><b>${Number(value.rotation||0)}°</b></span><span><small>Слой</small><b>${Number(value.z||0)}</b></span></div>${isDm?`<div class="vtt-inspector-actions"><button data-vtt-edit-object="${esc(value.id)}">Настроить</button><button data-vtt-duplicate-selected>Копировать</button><button class="danger-action" data-vtt-remove-selected>Удалить</button></div>`:""}</div>`;
    return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-object-symbol">✎</span><div><small>Рисунок · ${esc(value.kind)}</small><strong>${esc(value.name||value.text||"Без названия")}</strong></div></div>${isDm?`<div class="vtt-inspector-actions"><button data-vtt-edit-annotation="${esc(value.id)}">Настроить</button><button data-vtt-duplicate-selected>Копировать</button><button class="danger-action" data-vtt-remove-selected>Удалить</button></div>`:""}</div>`;
  }

  function scenesPanel(room, isDm) {
    const filtered=(room.scenes||[]).filter(scene=>!sceneSearch||`${scene.name} ${scene.folder||""} ${(scene.tags||[]).join(" ")}`.toLowerCase().includes(sceneSearch.toLowerCase()));
    const groups=new Map(); filtered.forEach(scene=>{const folder=scene.folder||"Без папки"; if(!groups.has(folder))groups.set(folder,[]); groups.get(folder).push(scene);});
    const markup=[...groups.entries()].map(([folder,scenes])=>`<section class="vtt-scene-folder"><h4>${esc(folder)} <small>${scenes.length}</small></h4>${scenes.map(summary=>`<button type="button" class="vtt-scene-card ${summary.active?"active":""} ${summary.published===false?"draft":""}" data-vtt-scene="${esc(summary.id)}"><span><strong>${esc(summary.name)}</strong><small>${Number(summary.tokenCount)} ток. · ${Number(summary.objectCount)} об.${(summary.tags||[]).length?` · ${(summary.tags||[]).map(tag=>`#${esc(tag)}`).join(" ")}`:""}</small></span>${summary.active?`<b>В эфире</b>`:summary.published===false?`<b>Черновик</b>`:""}</button>`).join("")}</section>`).join("");
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Кампания</span><h3>Сцены</h3></div><b>${Number(room.scenes?.length||0)}</b></div><input id="vtt-scene-search" type="search" value="${esc(sceneSearch)}" placeholder="Название, папка или тег…"><div class="vtt-scene-list">${markup||`<div class="vtt-empty-side">Сцены не найдены.</div>`}</div>${isDm?`<div class="vtt-panel-actions"><button id="vtt-scene-new">＋ Новая</button><button id="vtt-scene-copy">⧉ Копия</button><button class="danger-action" id="vtt-scene-delete">Удалить</button></div>`:""}`;
  }

  function libraryFolderNames(room) {
    return [...new Set([...(room.assets||[]).map(asset=>String(asset.folder||"").trim()).filter(Boolean),...customAssetFolders])].sort((a,b)=>a.localeCompare(b,"ru"));
  }

  function libraryPanel(room, assets) {
    const folders=libraryFolderNames(room);
    const selectedFolder=assetFolder!=="all"&&!folders.includes(assetFolder)?assetFolder:assetFolder;
    return `<div class="vtt-panel-head"><div><span class="eyebrow">С компьютера</span><h3>Ресурсы</h3></div><b>${Number(room.assets?.length||0)}</b></div><div class="vtt-upload-grid"><button data-vtt-upload="token">＋ Токены</button><button data-vtt-upload="map">＋ Карты</button><button data-vtt-upload="prop">＋ Объекты</button></div><div class="vtt-library-search"><input id="vtt-asset-search" type="search" value="${esc(assetSearch)}" placeholder="Поиск…"><select id="vtt-asset-folder"><option value="all">Все папки</option><option value="Без папки" ${assetFolder==="Без папки"?"selected":""}>Без папки</option>${folders.map(folder=>`<option value="${esc(folder)}" ${selectedFolder===folder?"selected":""}>${esc(folder)}</option>`).join("")}</select><button id="vtt-folder-new" type="button" title="Создать папку">＋</button></div><div class="vtt-asset-filters"><button data-vtt-asset-filter="all" class="${assetFilter==="all"?"active":""}">Все</button><button data-vtt-asset-filter="token" class="${assetFilter==="token"?"active":""}">Токены</button><button data-vtt-asset-filter="map" class="${assetFilter==="map"?"active":""}">Карты</button><button data-vtt-asset-filter="prop" class="${assetFilter==="prop"?"active":""}">Объекты</button><button data-vtt-asset-filter="source" class="${assetFilter==="source"?"active":""}">Исходники</button></div><div class="vtt-asset-list">${assets.length?assets.map(assetCard).join(""):`<div class="vtt-library-empty"><span>▧</span><strong>${room.assets?.length?"Ничего не найдено":"Библиотека пуста"}</strong><p>Выбери существующую папку или создай новую перед загрузкой.</p></div>`}</div>`;
  }

  function encounterPanel(room) {
    const templates=(room.encounterTemplates||[]).filter(template=>!encounterSearch||`${template.name} ${(template.tags||[]).join(" ")}`.toLowerCase().includes(encounterSearch.toLowerCase()));
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Готовые группы</span><h3>Столкновения</h3></div><b>${(room.encounterTemplates||[]).length}</b></div><input id="vtt-encounter-search" type="search" value="${esc(encounterSearch)}" placeholder="Поиск группы…"><div class="vtt-encounter-list">${templates.length?templates.map(template=>`<article><div><strong>${esc(template.name)}</strong><small>${template.tokens.length} NPC${(template.tags||[]).length?` · ${(template.tags||[]).map(tag=>`#${esc(tag)}`).join(" ")}`:""}</small></div><button data-vtt-encounter-place="${esc(template.id)}">Поставить</button><button class="danger-action" data-vtt-encounter-delete="${esc(template.id)}">×</button></article>`).join(""):`<div class="vtt-empty-side"><span>⚔</span><strong>Нет сохранённых групп</strong><p>Выдели NPC рамкой и сохрани их через инспектор.</p></div>`}</div>`;
  }

  function toolsPanel(grid, selectionCount, isDm, diceColor = "#d3ad6e") {
    const tray = window.TT_DICE_TRAY;
    const diceBuilder = tray ? `<div class="vtt-dice-picker"><div class="vtt-dice-picker-head"><span>Горсть кубиков</span><label>Мой цвет<input id="vtt-dice-color" type="color" value="${esc(diceColor)}"></label></div><div class="vtt-dice-steppers">${tray.SIDES.map(sides => { const count = Number(tray.state.counts[sides] || 0); return `<article class="${count ? "active" : ""}"><strong>к${sides}</strong><div><button type="button" data-vtt-die-sub="${sides}" ${count ? "" : "disabled"}>−</button><b>${count}</b><button type="button" data-vtt-die-add="${sides}" ${tray.totalCount() >= tray.MAX_DICE ? "disabled" : ""}>＋</button></div></article>`; }).join("")}</div><div class="vtt-dice-total"><span><small>Бросок</small><strong>${esc(tray.formula())}</strong></span><label>Мод.<input id="vtt-dice-modifier" type="number" min="-999" max="999" value="${Number(tray.state.modifier || 0)}"></label></div><form class="vtt-dice-formula" id="vtt-dice-formula-form"><input id="vtt-dice-formula-input" name="formula" value="${esc(ui.diceFormula)}" placeholder="3d6+1"><button class="primary" type="submit">Бросить формулу</button></form><div class="vtt-dice-actions"><button id="vtt-dice-visibility" type="button" aria-pressed="${String(tray.state.visibility === "private")}" class="${tray.state.visibility === "private" ? "active" : ""}">${tray.state.visibility === "private" ? "🔒 Закрыто" : "🌐 Всем"}</button><button id="vtt-dice-reset" type="button">к20</button><button id="vtt-dice-clear" type="button">Очистить</button></div><small>${tray.state.visibility === "private" ? "Закрытый бросок видят только ты и ГМ." : "Набери набор и нажми на поле либо введи формулу."}</small></div>` : "";
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Стол</span><h3>Инструменты</h3></div><b>${movementSnaps() ? "сетка" : "свободно"}</b></div>
      <button id="vtt-movement-mode" class="vtt-movement-mode ${movementSnaps() ? "active" : ""}" type="button"><span>${movementSnaps() ? "◫" : "⌁"}</span><div><strong>${movementSnaps() ? "Движение по сетке" : "Свободное движение"}</strong><small>Переключает только перемещение и трансформацию</small></div></button>
      <div class="vtt-tool-options"><label>Цвет<input id="vtt-tool-color" type="color" value="${esc(ui.color)}"></label><label>Заливка<input id="vtt-tool-fill" type="color" value="${esc(ui.fill)}"></label><label>Толщина<input id="vtt-tool-width" type="number" min="1" max="20" value="${Number(ui.strokeWidth)}"></label></div>
      <div class="vtt-tool-help"><strong>${toolLabel(ui.tool)}</strong><p>${toolHelp(ui.tool)}</p></div>
      ${ui.tool === "dice" ? diceBuilder : ""}
      ${isDm && ["fog-cover","fog-reveal"].includes(ui.tool) ? `<div class="vtt-panel-subtitle">Форма тумана</div><div class="vtt-fog-shape-picker"><button data-vtt-fog-shape="rect" class="${ui.fogShape === "rect" ? "active" : ""}">▭ Область</button><button data-vtt-fog-shape="circle" class="${ui.fogShape === "circle" ? "active" : ""}">○ Круг</button><button data-vtt-fog-shape="draw" class="${ui.fogShape === "draw" ? "active" : ""}">✎ Кисть</button></div>` : ""}
      ${isDm ? `<div class="vtt-history-actions"><button id="vtt-undo">↶ Отменить</button><button id="vtt-redo">↷ Повторить</button></div>` : ""}
      ${selectionCount > 1 && isDm ? `<div class="vtt-panel-subtitle">Выравнивание</div><div class="vtt-align-grid"><button data-vtt-align="left">⇤</button><button data-vtt-align="h-center">↔</button><button data-vtt-align="right">⇥</button><button data-vtt-align="top">⇡</button><button data-vtt-align="v-center">↕</button><button data-vtt-align="bottom">⇣</button><button data-vtt-align="distribute-h">⋯</button><button data-vtt-align="distribute-v">⋮</button></div>` : ""}
      ${isDm ? `<div class="vtt-fog-actions"><button id="vtt-fog-undo">Убрать последнюю область</button><button class="danger-action" id="vtt-fog-clear">Очистить туман</button></div>` : ""}
      <div class="vtt-shortcuts"><span><kbd>V</kbd> выбор</span><span><kbd>ПКМ</kbd> меню</span><span><kbd>H</kbd> рука</span><span><kbd>M</kbd> линейка</span><span><kbd>Del</kbd> удалить</span><span><kbd>Ctrl D</kbd> копия</span><span><kbd>K</kbd> кубик</span><span><kbd>Shift S</kbd> лист</span>${isDm ? `<span><kbd>Ctrl Z</kbd> отмена</span>` : ""}</div>`;
  }

  function toolLabel(tool) {
    return ({ select:"Выбор", pan:"Рука", measure:"Линейка", line:"Линия", rect:"Прямоугольник", circle:"Круг", cone:"Конус", draw:"Карандаш", text:"Текст", ping:"Указатель", dice:"Кубик на столе", "fog-cover":"Скрыть область", "fog-reveal":"Открыть область" })[tool] || "Выбор";
  }

  function toolHelp(tool) {
    return ({
      select:"Клик — выбрать и двигать. ПКМ — быстрые действия. ПКМ → Трансформировать включает размер и поворот.",
      pan:"Тяни поле мышью. Средняя кнопка и Пробел работают в любом режиме.",
      measure:"Проведи между точками — получишь расстояние в футах.",
      line:"Проведи постоянную линию на сцене.", rect:"Растяни прямоугольную область.", circle:"Начни из центра и задай радиус.", cone:"Начни из вершины и укажи направление.", draw:"Рисуй свободной линией.", text:"Нажми на поле и введи подпись.", ping:"Нажми на поле, чтобы показать точку всей партии.", dice:"Выбери многогранник и брось его кликом прямо на игровое поле.", "fog-cover":"Скрой область прямоугольником, кругом или свободной кистью.", "fog-reveal":"Открой область прямоугольником, кругом или свободной кистью."
    })[tool] || "";
  }

  function toolRailMarkup(isDm) {
    const tools=[["select","⌖","Выбор (V)"],["pan","✋","Рука (H)"],["measure","↗","Линейка (M)"],["line","╱","Линия"],["rect","□","Область"],["circle","○","Круг"],["cone","◁","Конус"],["draw","✎","Карандаш"],["text","T","Текст"],["ping","◎","Указатель (P)"],["dice","🎲","Кубик (K)"]];
    if(isDm) tools.push(["fog-cover","▰","Скрыть туманом (F)"],["fog-reveal","▱","Открыть туман (Shift F)"]);
    return tools.map(([key,icon,title])=>`<button type="button" data-vtt-tool="${key}" class="${ui.tool===key?"active":""}" title="${title}"><span>${icon}</span></button>`).join("");
  }

  function render(root, ctx) {
    if (!root || !ctx.room?.scene) return;
    active = true;
    if (controller) controller.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const room = ctx.room;
    const scene = room.scene;
    const grid = scene.grid || {};
    if (ui.movementSnap === null) ui.movementSnap = grid.snap !== false;
    const cell = Number(grid.cellSize || 52);
    const metrics = gridMetrics(grid, cell);
    const isDm = room.dmId === ctx.clientId;
    const validSelection = getSelection(room).filter(ref => resolveRef(scene, ref));
    setSelection(room, validSelection);
    const selection = getSelection(room);
    if (ui.transformRef && !resolveRef(scene, ui.transformRef)) ui.transformRef = null;
    if (ui.contextMenu?.ref && !resolveRef(scene, ui.contextMenu.ref)) ui.contextMenu = null;
    const entries = selectedEntries(room);
    const order = sceneOrder(scene);
    const current = order.find(token => token.id === scene.initiative?.currentTokenId);
    const assets = (room.assets || []).filter(asset => assetFilter === "source" ? asset.category === "source" : asset.category !== "source" && (assetFilter === "all" || asset.category === assetFilter))
      .filter(asset => assetFolder === "all" || (asset.folder || "Без папки") === assetFolder)
      .filter(asset => !assetSearch || `${asset.name} ${asset.folder || ""} ${(asset.tags || []).join(" ")}`.toLowerCase().includes(assetSearch.toLowerCase()));
    const ownToken = (scene.tokens || []).find(token => token.playerId === ctx.clientId);
    const diceColor = room.players?.[ctx.clientId]?.sheet?.diceColor || "#d3ad6e";
    const diceColors = [diceColor, ...Object.values(room.players || {}).map(player => player?.sheet?.diceColor).filter(Boolean), diceColor];
    window.TT_DICE_PHYSICS?.activate?.(diceColors);
    const linkedCharacterId = entries.find(entry => entry.kind === "token" && entry.value.playerId)?.value.playerId;
    const selectedNpc = entries.length === 1 && entries[0].kind === "token" && !entries[0].value.playerId ? entries[0].value : null;
    if (linkedCharacterId && ui.rightPanel === "character") ui.characterPlayerId = linkedCharacterId;
    const characterId = ui.characterPlayerId && ctx.characters?.[ui.characterPlayerId] ? ui.characterPlayerId : ctx.characters?.[ctx.clientId] ? ctx.clientId : Object.keys(ctx.characters || {})[0];
    const leftContent = ui.leftPanel === "library" && isDm ? libraryPanel(room, assets) : ui.leftPanel === "scenes" ? scenesPanel(room, isDm) : ui.leftPanel === "tools" ? toolsPanel(grid, entries.length, isDm, diceColor) : ui.leftPanel === "encounters" && isDm ? encounterPanel(room) : "";
    const rightContent = ui.rightPanel === "inspector" ? inspectorMarkup(entries, isDm, ctx.clientId) : ui.rightPanel === "initiative" ? initiativePanelMarkup(scene, order, isDm) : ui.rightPanel === "character" ? (selectedNpc ? npcCharacterPanelMarkup(selectedNpc,isDm) : characterPanelMarkup(ctx.characters || {}, characterId, isDm, ctx.clientId, scene)) : "";

    root.innerHTML = `<div class="vtt-shell ${isDm ? "is-dm" : "is-player"}">
      <div id="vtt-viewport" class="vtt-viewport" tabindex="0">
        <div id="vtt-world" class="vtt-world" style="width:${WORLD_WIDTH}px;height:${WORLD_HEIGHT}px;background-color:${esc(scene.backgroundColor || "#17120e")};${scene.backgroundUrl ? `background-image:linear-gradient(#09070544,#09070544),url(&quot;${esc(scene.backgroundUrl)}&quot;);` : ""}">
          ${gridSvgMarkup(grid, metrics)}
          <div class="vtt-origin" style="left:${metrics.originX}px;top:${metrics.originY}px"></div>
          ${(scene.objects || []).sort((a,b)=>Number(a.z||0)-Number(b.z||0)).map(object => objectMarkup(object, metrics, selection, isDm)).join("")}
          <svg class="vtt-annotation-layer" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}">${(scene.annotations || []).sort((a,b)=>Number(a.z||50)-Number(b.z||50)).map(annotation => annotationMarkup(annotation, metrics, selection)).join("")}</svg>
          ${(scene.tokens || []).sort((a,b)=>Number(a.z||100)-Number(b.z||100)).map(token => tokenMarkup(token, metrics, selection, scene.initiative?.currentTokenId, isDm, ctx.clientId)).join("")}
          ${tokenQuickHpMarkup(scene,metrics,selection,isDm,ctx.clientId)}
          ${fogMarkup(scene,metrics,isDm)}
          ${measurementMarkup(room, metrics)}
          <svg id="vtt-draft-layer" class="vtt-draft-layer" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}"></svg>
          ${pingMarkup(scene, metrics)}
          ${!(scene.tokens || []).length && !(scene.objects || []).length && !(scene.annotations || []).length ? `<div class="vtt-stage-empty" style="left:${metrics.originX}px;top:${metrics.originY}px"><span>◇</span><strong>Пустая сцена</strong><p>${isDm ? "Открой ресурсы и перетащи карту или токен." : "Ведущий ещё ничего не разместил."}</p></div>` : ""}
        </div>
        <div id="vtt-marquee" class="vtt-marquee hidden"></div>
      </div>

      <header class="vtt-top-dock">
        <div class="vtt-global-nav"><button data-vtt-view="sheet">Лист</button><button data-vtt-view="dice">Кости</button><button data-vtt-panel-left="scenes" class="${ui.leftPanel === "scenes" ? "active" : ""}"><span>▤</span>${esc(scene.name)}</button></div>
        <div class="vtt-scene-status"><strong>${esc(scene.name)}</strong><small>${current ? `Раунд ${Number(scene.initiative.round || 1)} · ${esc(current.name)}` : "Сцена сохраняется автоматически"}</small></div>
        <div class="vtt-top-actions">${ownToken ? `<button id="vtt-focus-own" title="Вернуться к своему токену">◎</button>` : ""}<button id="vtt-quick-d20" title="Бросить к20 в центре экрана">🎲 к20</button>${ownToken ? `<button class="primary" id="vtt-own-initiative">Инициатива</button>` : ""}${isDm ? `<button id="vtt-add-party">＋ Партия</button><button id="vtt-diagnostics" title="Диагностика">◫</button><button id="vtt-scene-settings">⚙</button>` : ""}</div>
      </header>

      <nav class="vtt-left-rail">
        ${isDm ? `<button data-vtt-panel-left="library" class="${ui.leftPanel === "library" ? "active" : ""}" title="Ресурсы"><span>▧</span></button><button data-vtt-panel-left="encounters" class="${ui.leftPanel === "encounters" ? "active" : ""}" title="Группы противников"><span>⚔</span></button>` : ""}
        <button data-vtt-panel-left="scenes" class="${ui.leftPanel === "scenes" ? "active" : ""}" title="Сцены"><span>▤</span></button>
        <button data-vtt-panel-left="tools" class="${ui.leftPanel === "tools" ? "active" : ""}" title="Инструменты"><span>⌘</span></button>
        <i></i>${toolRailMarkup(isDm)}
      </nav>

      <nav class="vtt-right-rail"><button data-vtt-panel-right="character" class="${ui.rightPanel === "character" ? "active" : ""}" title="Мини-лист персонажа"><span>☷</span></button><button data-vtt-panel-right="inspector" class="${ui.rightPanel === "inspector" ? "active" : ""}" title="Инспектор"><span>◆</span>${entries.length ? `<b>${entries.length}</b>` : ""}</button><button data-vtt-panel-right="initiative" class="${ui.rightPanel === "initiative" ? "active" : ""}" title="Инициатива"><span>⚔</span>${order.length ? `<b>${order.length}</b>` : ""}</button></nav>

      ${leftContent ? `<aside class="vtt-floating-panel vtt-panel-left">${leftContent}</aside>` : ""}
      ${rightContent ? `<aside class="vtt-floating-panel vtt-panel-right ${ui.rightPanel === "initiative" ? "vtt-initiative-panel" : ui.rightPanel === "character" ? "vtt-character-panel" : ""}">${rightContent}</aside>` : ""}
      ${contextMenuMarkup(room,isDm,ctx.clientId)}

      <footer class="vtt-bottom-dock"><div><button id="vtt-zoom-out">−</button><button id="vtt-zoom-value">82%</button><button id="vtt-zoom-in">＋</button><button id="vtt-camera-reset" title="К центру">⌂</button></div><div><button id="vtt-clear-measure" class="${getMeasurement(room) ? "active" : ""}" title="Очистить линейку">↗</button><button id="vtt-movement-snap" class="${movementSnaps() ? "active" : ""}" type="button" title="Переключить свободное движение и привязку">${movementSnaps() ? `◫ Сетка · ${cell}px` : "⌁ Свободно"}</button><span id="vtt-cursor-position">0 : 0</span></div></footer>
      <input id="vtt-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
    </div>`;

    bind(root, ctx, signal, metrics);
  }

  function initiativePanelMarkup(scene, order, isDm) {
    const cards = order.map((token,index) => {
      const active = token.id === scene.initiative?.currentTokenId;
      const portrait = token.imageUrl ? `<img src="${esc(token.imageUrl)}" alt="">` : `<span>${esc((token.name || "?")[0].toUpperCase())}</span>`;
      return `<article class="vtt-initiative-card ${active ? "active" : ""}">
        <button type="button" data-vtt-focus-token="${esc(token.id)}">
          <small>${index+1}</small><i>${portrait}</i><span><strong>${esc(token.name)}</strong><em>${active ? "Сейчас ходит" : token.playerId ? "Персонаж" : "NPC"}</em></span>
        </button>
        ${isDm ? `<label title="Инициатива"><input data-vtt-initiative="${esc(token.id)}" type="number" value="${Number(token.initiative)}"></label>` : `<b>${Number(token.initiative)}</b>`}
      </article>`;
    }).join("");
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Порядок боя</span><h3>Инициатива</h3></div>${scene.initiative?.active ? `<b>Раунд ${Number(scene.initiative.round || 1)}</b>` : ""}</div>
      <div class="vtt-initiative-list">${cards || `<div class="vtt-empty-side"><span>⚔</span><strong>Очередь пуста</strong><p>Добавь инициативу персонажам или NPC.</p></div>`}</div>
      ${isDm ? `<div class="vtt-initiative-actions"><button class="primary" id="vtt-next-turn" ${order.length ? "" : "disabled"}>Следующий ход</button><button id="vtt-clear-initiative" ${order.length ? "" : "disabled"}>Сбросить</button></div>` : ""}`;
  }


  function npcSheetHasData(sheet) {
    if (!sheet || typeof sheet !== "object") return false;
    return Object.keys(sheet.stats || {}).length > 0 || ["saves","checks","attacks","formulas"].some(key => Array.isArray(sheet[key]) && sheet[key].length);
  }

  function npcCharacterPanelMarkup(token, isDm) {
    const sheet=token?.npcSheet||{};
    const stats=Object.entries(sheet.stats||{});
    const badge=entry=>isDm?`<small class="vtt-npc-visibility">${entry.public?"🌐":"🔒"}</small>`:"";
    const roll=(formula,label,content,entry={public:true},className="")=>`<button type="button" class="${className}" data-vtt-npc-formula="${esc(formula)}" data-vtt-npc-label="${esc(label)}" data-vtt-npc-visibility="${entry.public?"public":"private"}" ${isDm?"":"disabled"}>${content}</button>`;
    const statMarkup=stats.map(([key,entry])=>roll(npcStatFormula(entry.value),`NPC ${token.name}: ${NPC_ABILITY_LABELS[key]||key}`,`<small>${esc(key.toUpperCase())}</small><strong>${Number(entry.value)}</strong><b>${bonusText(npcModifier(entry.value))}</b>${badge(entry)}`,entry,"vtt-character-ability")).join("");
    const listMarkup=(items,prefix)=>items.map(entry=>roll(entry.formula,`${prefix}: ${token.name} · ${entry.name}`,`<i>${entry.public?"◆":"◇"}</i><em>${esc(entry.name)}</em><b>${esc(entry.formula)}</b>${badge(entry)}`,entry)).join("");
    const attacks=(sheet.attacks||[]).map(entry=>`<article><div><strong>${esc(entry.name)}</strong><small>${esc(entry.damageType||"Атака")}${isDm?` · ${entry.public?"публично":"скрыто"}`:""}</small></div>${entry.attackFormula?roll(entry.attackFormula,`Атака NPC: ${token.name} · ${entry.name}`,esc(entry.attackFormula),entry,"vtt-formula-button"):""}${entry.damageFormula?roll(entry.damageFormula,`Урон NPC: ${token.name} · ${entry.name}`,esc(entry.damageFormula),entry,"vtt-formula-button damage"):""}</article>`).join("");
    const formulas=listMarkup(sheet.formulas||[],"Формула NPC");
    const saves=listMarkup(sheet.saves||[],"Спасбросок NPC");
    const checks=listMarkup(sheet.checks||[],"Проверка NPC");
    if(!isDm&&!npcSheetHasData(sheet))return `<div class="vtt-empty-side"><span>☷</span><strong>Данные NPC скрыты</strong><p>Ведущий не сделал характеристики и формулы этого токена публичными.</p></div>`;
    return `<div class="vtt-character-sheet vtt-npc-sheet"><div class="vtt-panel-head"><div><span class="eyebrow">Быстрый просмотр</span><h3>Лист NPC</h3></div>${isDm?`<button data-vtt-npc-edit="${esc(token.id)}" title="Настроить NPC">⚙</button>`:""}</div><header class="vtt-character-hero">${token.imageUrl?`<img src="${esc(token.imageUrl)}">`:`<span>${esc((token.name||"?")[0])}</span>`}<div><strong>${esc(token.name)}</strong><small>NPC · ${Number(token.hp||0)}/${Number(token.hpMax||1)} HP</small></div></header><div class="vtt-character-page"><section class="vtt-character-section"><h4>Характеристики</h4><div class="vtt-character-abilities">${statMarkup||`<div class="vtt-empty-side">Характеристики скрыты.</div>`}</div></section>${saves?`<section class="vtt-character-section"><h4>Спасброски</h4><div class="vtt-character-checks">${saves}</div></section>`:""}${checks?`<section class="vtt-character-section"><h4>Проверки</h4><div class="vtt-character-checks skills">${checks}</div></section>`:""}${attacks?`<section class="vtt-character-section"><h4>Атаки и урон</h4><div class="vtt-character-attacks">${attacks}</div></section>`:""}${formulas?`<section class="vtt-character-section"><h4>Свои формулы</h4><div class="vtt-character-checks">${formulas}</div></section>`:""}${!isDm?`<p class="vtt-character-readonly">Броски NPC выполняет ведущий.</p>`:""}</div><div class="vtt-character-actions"><button data-vtt-character-focus="${esc(token.id)}">◎ Найти токен</button>${isDm?`<button class="primary" data-vtt-npc-edit="${esc(token.id)}">Настроить NPC</button>`:""}</div></div>`;
  }

  function characterPanelMarkup(characters, selectedId, isDm, clientId, scene) {
    const list=Object.values(characters||{}).filter(Boolean).filter(character=>isDm||character.playerId===clientId);
    const character=list.find(entry=>entry.playerId===selectedId)||list.find(entry=>entry.playerId===clientId)||list[0];
    if(!character) return `<div class="vtt-empty-side"><span>☷</span><strong>Лист недоступен</strong><p>Подключи персонажа к комнате.</p></div>`;
    const token=(scene.tokens||[]).find(entry=>entry.playerId===character.playerId), canRoll=character.playerId===clientId;
    const prefs=character.quickSheet||{sections:["overview","combat","checks","spells"]};
    const sections=(prefs.sections||[]).filter(value=>["overview","combat","checks","spells","notes"].includes(value));
    const page=sections.includes(ui.characterPage)?ui.characterPage:sections[0]||"overview";
    const rollButton=(formula,label,content,className="")=>formula?`<button type="button" class="${className}" data-vtt-character-formula="${esc(formula)}" data-vtt-character-label="${esc(label)}" ${canRoll?"":"disabled"}>${content}</button>`:`<div class="${className} is-readonly">${content}</div>`;
    const abilities=(character.abilities||[]).map(entry=>rollButton(entry.formula,`Проверка: ${entry.name}`,`<small>${esc(String(entry.key).toUpperCase())}</small><strong>${Number(entry.value)}</strong><b>${bonusText(entry.modifier)}</b>`,`vtt-character-ability`)).join("");
    const saves=[...(character.saves||[])].sort((a,b)=>(prefs.pinnedSaves||[]).includes(b.key)-(prefs.pinnedSaves||[]).includes(a.key));
    const skills=[...(character.skills||[])].sort((a,b)=>(prefs.pinnedSkills||[]).includes(b.key)-(prefs.pinnedSkills||[]).includes(a.key));
    const attacks=[...(character.attacks||[])].sort((a,b)=>(prefs.pinnedAttacks||[]).includes(b.id)-(prefs.pinnedAttacks||[]).includes(a.id));
    const spells=[...(character.spells||[])].sort((a,b)=>(prefs.pinnedSpells||[]).includes(b.id)-(prefs.pinnedSpells||[]).includes(a.id)||Number(a.level)-Number(b.level));
    const saveMarkup=saves.map(entry=>rollButton(entry.formula,`Спасбросок: ${entry.name}`,`<i>${(prefs.pinnedSaves||[]).includes(entry.key)?"★":entry.proficient?"◆":"·"}</i><em>${esc(entry.name)}</em><b>${bonusText(entry.bonus)}</b>`,entry.proficient?"proficient":"")).join("");
    const skillRow=entry=>rollButton(entry.formula,`Навык: ${entry.name}`,`<i>${(prefs.pinnedSkills||[]).includes(entry.key)?"★":entry.expertise?"✦":entry.proficient?"◆":"·"}</i><em>${esc(entry.name)}</em><small>${esc(String(entry.ability||"").toUpperCase())}</small><b>${bonusText(entry.bonus)}</b>`,entry.expertise?"expertise":entry.proficient?"proficient":"");
    const attackMarkup=attacks.map(attack=>`<article><div><strong>${(prefs.pinnedAttacks||[]).includes(attack.id)?"★ ":""}${esc(attack.name)}</strong><small>${esc(attack.damageType||"Атака")}</small></div>${rollButton(attack.attackFormula,`Атака: ${attack.name}`,esc(attack.attackFormula),"vtt-formula-button")}${attack.damageFormula?rollButton(attack.damageFormula,`Урон: ${attack.name}`,esc(attack.damageFormula),"vtt-formula-button damage"):""}</article>`).join("");
    const equipment=(character.equipment||[]).map(item=>`<article><span>${esc(item.icon||"◇")}</span><div><small>${esc(item.slotLabel)}</small><strong>${esc(item.name)}</strong></div>${Number(item.quantity)>1?`<b>${Number(item.quantity)}</b>`:""}</article>`).join("");
    const consumables=(character.consumables||[]).map(item=>`<article class="vtt-character-consumable"><span>${esc(item.icon||"✚")}</span><div><strong>${esc(item.name)}</strong><small>${Number(item.quantity)} шт.${item.useFormula?` · ${esc(item.useFormula)}`:""}</small></div><button type="button" data-vtt-use-item="${esc(item.id)}" ${canRoll&&Number(item.quantity)>0?"":"disabled"}>Использовать</button></article>`).join("");
    const resources=(character.resources||[]).map(item=>`<article class="vtt-character-resource"><div><strong>${esc(item.name)}</strong><small>${Number(item.current)}/${Number(item.max)}</small></div><button type="button" data-vtt-resource-change="${esc(item.id)}" data-delta="-1" ${canRoll&&Number(item.current)>0?"":"disabled"}>−</button><progress max="${Math.max(1,Number(item.max))}" value="${Number(item.current)}"></progress><button type="button" data-vtt-resource-change="${esc(item.id)}" data-delta="1" ${canRoll&&Number(item.current)<Number(item.max)?"":"disabled"}>＋</button></article>`).join("");
    const features=(character.combatFeatures||[]).map(item=>rollButton(item.formula,item.name,`<i>✦</i><em>${esc(item.name)}</em><small>${esc(item.note||"")}</small><b>${esc(item.formula)}</b>`,`vtt-character-spell`)).join("");
    const companionMarkup=(character.companions||[]).map(item=>`<article class="vtt-character-companion"><span>♙</span><div><strong>${esc(item.name)}</strong><small>${esc(item.kind||"Спутник")} · ${Number(item.hpMax||1)} HP · КД ${Number(item.ac||10)}</small><p>${esc(item.note||"")}</p></div>${isDm?`<button type="button" data-vtt-place-companion="${esc(item.id)}" data-player-id="${esc(character.playerId)}">＋ На карту</button>`:""}</article>`).join("");
    const slots=[...(character.spellSlots||[]),...(character.pactSlots?[{...character.pactSlots,pact:true}]:[])].map(slot=>`<article class="vtt-character-slot"><strong>${slot.pact?`Д${Number(slot.level)}`:Number(slot.level)}</strong><div>${Array.from({length:Number(slot.total)},(_,index)=>`<i class="${index<Number(slot.used)?"used":""}"></i>`).join("")}</div><small>${Number(slot.remaining)} осталось</small>${canRoll?`<button data-vtt-slot-change="${Number(slot.level)}" data-delta="-1" ${slot.used>0?"":"disabled"} ${slot.pact?'data-pact="1"':''}>−</button><button data-vtt-slot-change="${Number(slot.level)}" data-delta="1" ${slot.remaining>0?"":"disabled"} ${slot.pact?'data-pact="1"':''}>＋</button>`:""}</article>`).join("");
    const spellMarkup=spells.map(spell=>`<article class="vtt-character-spell-row ${spell.summon?"is-summon":""}"><div><i>${(prefs.pinnedSpells||[]).includes(spell.id)?"★":spell.summon?"♙":spell.concentration?"◉":"✧"}</i><span><strong>${esc(spell.name)}</strong><small>${spell.level?`${spell.level} ур.`:"заговор"}${spell.ritual?" · ритуал":""}${spell.sourceId==="xgte"?" · XGtE":spell.sourceId==="tcoe"?" · TCoE":""}${spell.summon?" · призыв":""}</small></span></div><div class="vtt-character-spell-actions">${spell.formula?rollButton(spell.formula,`${spell.kind==="healing"?"Лечение":"Заклинание"}: ${spell.name}`,esc(spell.formula),"vtt-formula-button"):""}<button type="button" data-vtt-cast-spell="${esc(spell.id)}" ${canRoll?"":"disabled"}>Сотворить</button>${isDm&&spell.summon?`<button type="button" class="vtt-summon-marker" data-vtt-place-summon="${esc(spell.id)}" data-player-id="${esc(character.playerId)}" title="Поставить редактируемый маркер рядом с токеном заклинателя">＋ Маркер</button>`:""}</div></article>`).join("");
    const tabs=sections.map(section=>`<button type="button" data-vtt-character-page="${section}" class="${page===section?"active":""}">${({overview:"Обзор",combat:"Бой",checks:"Проверки",spells:"Магия",notes:"Заметки"})[section]}</button>`).join("");
    const death=Number(character.hp)<=0?`<section class="vtt-character-section vtt-death-saves"><h4>Спасброски от смерти</h4><div><span>Успехи</span>${Array.from({length:3},(_,i)=>`<i class="success ${i<Number(character.deathSuccess)?"filled":""}">✓</i>`).join("")}<span>Провалы</span>${Array.from({length:3},(_,i)=>`<i class="fail ${i<Number(character.deathFail)?"filled":""}">×</i>`).join("")}</div><button type="button" data-vtt-death-save="${esc(token?.id||"")}" ${canRoll&&token&&!character.stable?"":"disabled"}>🎲 Спасбросок${character.stable?" · стабилен":""}</button></section>`:"";
    const overview=`<div class="vtt-character-vitals"><article><small>HP</small><strong>${Number(character.hp)}/${Number(character.hpMax)}${Number(character.tempHp)?` +${Number(character.tempHp)}`:""}</strong></article><article><small>КД</small><strong>${Number(character.ac)}</strong></article><article><small>Скорость</small><strong>${Number(character.speed)} фт.</strong></article><article><small>Инициатива</small><strong>${bonusText(character.initiativeBonus)}</strong></article><article><small>Мастерство</small><strong>${bonusText(character.proficiency)}</strong></article><article><small>Пассивка</small><strong>${Number(character.passivePerception)}</strong></article></div><div class="vtt-character-abilities">${abilities}</div>${death}`;
    const combat=`${companionMarkup?`<section class="vtt-character-section"><h4>Спутники и создаваемые существа</h4><div class="vtt-character-companions">${companionMarkup}</div></section>`:""}${attackMarkup?`<section class="vtt-character-section"><h4>Атаки и формулы</h4><div class="vtt-character-attacks">${attackMarkup}</div></section>`:""}${features?`<section class="vtt-character-section"><h4>Боевые особенности</h4><div class="vtt-character-checks spells">${features}</div></section>`:""}${resources?`<section class="vtt-character-section"><h4>Ресурсы и заряды</h4><div class="vtt-character-resources">${resources}</div></section>`:""}${consumables?`<section class="vtt-character-section"><h4>Расходники</h4><div class="vtt-character-consumables">${consumables}</div></section>`:""}${equipment?`<section class="vtt-character-section"><h4>${esc(character.combatSetName||"Боевой комплект")}</h4><div class="vtt-character-equipment">${equipment}</div></section>`:""}`;
    const checkPage=["saves","skills-a","skills-b"].includes(ui.characterChecksPage)?ui.characterChecksPage:"saves", skillMiddle=Math.ceil(skills.length/2);
    const checkTabs=`<nav class="vtt-character-check-tabs"><button data-vtt-character-checks-page="saves" class="${checkPage==="saves"?"active":""}">Спасы</button><button data-vtt-character-checks-page="skills-a" class="${checkPage==="skills-a"?"active":""}">Навыки 1</button><button data-vtt-character-checks-page="skills-b" class="${checkPage==="skills-b"?"active":""}">Навыки 2</button></nav>`;
    const checkContent=checkPage==="saves"?`<section class="vtt-character-section"><h4>Спасброски</h4><div class="vtt-character-checks">${saveMarkup}</div></section>`:`<section class="vtt-character-section"><h4>Навыки</h4><div class="vtt-character-checks skills">${(checkPage==="skills-a"?skills.slice(0,skillMiddle):skills.slice(skillMiddle)).map(skillRow).join("")}</div></section>`;
    const magic=`${slots?`<section class="vtt-character-section"><h4>Ячейки заклинаний</h4><div class="vtt-character-slots">${slots}</div></section>`:""}<section class="vtt-character-section"><h4>Подготовленные заклинания</h4><div class="vtt-character-spells">${spellMarkup||`<div class="vtt-empty-side">Подготовленных заклинаний нет.</div>`}</div></section>`;
    const notes=`<section class="vtt-character-section"><h4>Цели</h4><div class="vtt-character-notes">${(character.goals||[]).map(item=>`<article><strong>${esc(item.title)}</strong><p>${esc(item.text||"")}</p></article>`).join("")||"—"}</div></section><section class="vtt-character-section"><h4>Заметки</h4><div class="vtt-character-notes">${(character.notes||[]).map(item=>`<article><strong>${esc(item.title)}</strong><p>${esc(item.text||"")}</p></article>`).join("")||"—"}</div></section>`;
    const content={overview,combat,checks:`${checkTabs}${checkContent}`,spells:magic,notes}[page]||overview;
    return `<div class="vtt-character-sheet"><div class="vtt-panel-head"><div><span class="eyebrow">Быстрый просмотр</span><h3>Лист персонажа</h3></div><div class="vtt-character-head-actions"><b>${Number(character.level||1)} ур.</b>${canRoll?`<button data-vtt-character-settings title="Настроить быстрый лист">⚙</button>`:""}</div></div>${isDm&&list.length>1?`<div class="vtt-character-switcher">${list.map(entry=>`<button data-vtt-character-player="${esc(entry.playerId)}" class="${entry.playerId===character.playerId?"active":""}">${entry.portraitUrl?`<img src="${esc(entry.portraitUrl)}">`:`<span>${esc((entry.name||"?")[0])}</span>`}</button>`).join("")}</div>`:""}<header class="vtt-character-hero">${character.portraitUrl?`<img src="${esc(character.portraitUrl)}">`:`<span>${esc((character.name||"?")[0])}</span>`}<div><strong>${esc(character.name)}</strong><small>${esc(character.classSummary||"Искатель приключений")}</small></div></header><nav class="vtt-character-tabs">${tabs}</nav><div class="vtt-character-page" data-page="${page}">${content}${!canRoll?`<p class="vtt-character-readonly">Броски доступны владельцу персонажа.</p>`:""}</div><div class="vtt-character-actions">${token?`<button data-vtt-character-focus="${esc(token.id)}">◎ Найти токен</button>`:""}<button class="primary" data-vtt-open-full-sheet="${esc(character.playerId)}">Открыть полный лист</button></div></div>`;
  }

  function bind(root, ctx, signal, metrics) {
    const room = ctx.room;
    const scene = room.scene;
    const grid = scene.grid || {};
    const cell = metrics.cell;
    const isDm = room.dmId === ctx.clientId;
    const viewport = root.querySelector("#vtt-viewport");
    const world = root.querySelector("#vtt-world");
    const zoomValue = root.querySelector("#vtt-zoom-value");
    const draftLayer = root.querySelector("#vtt-draft-layer");
    const camera = getCamera(room);

    const applyCamera = () => {
      world.style.transform = `translate(${camera.panX || 0}px,${camera.panY || 0}px) scale(${camera.zoom})`;
      if (zoomValue) zoomValue.textContent = `${Math.round(camera.zoom * 100)}%`;
    };

    const centerCamera = (x = 0, y = 0, zoom = camera.zoom) => {
      const point = metrics.toWorld(x, y);
      camera.zoom = clamp(zoom, 0.15, 4);
      camera.panX = viewport.clientWidth / 2 - point.x * camera.zoom;
      camera.panY = viewport.clientHeight / 2 - point.y * camera.zoom;
      applyCamera();
    };

    const screenToWorld = (clientX, clientY) => {
      const rect = viewport.getBoundingClientRect();
      return {
        x:(clientX - rect.left - camera.panX) / camera.zoom,
        y:(clientY - rect.top - camera.panY) / camera.zoom
      };
    };

    const screenToGrid = (clientX, clientY, mode = "intersection") => {
      const point = screenToWorld(clientX, clientY);
      return metrics.snap(metrics.fromWorldRaw(point.x, point.y), mode);
    };

    const screenToGridRaw = (clientX, clientY) => {
      const point = screenToWorld(clientX, clientY);
      return metrics.fromWorldRaw(point.x, point.y);
    };

    currentCameraCenterGrid = () => {
      const rect = viewport.getBoundingClientRect();
      return screenToGrid(rect.left + rect.width / 2, rect.top + rect.height / 2, "cell");
    };

    if (camera.panX === null || camera.panY === null) requestAnimationFrame(() => centerCamera(0, 0, 0.82));
    else applyCamera();

    root.querySelectorAll("[data-vtt-view]").forEach(button => button.addEventListener("click", () => {
      if (typeof ctx.switchView === "function") ctx.switchView(button.dataset.vttView);
      else document.querySelector(`.room-nav [data-view="${button.dataset.vttView}"]`)?.click();
    }, { signal }));

    root.querySelectorAll("[data-vtt-panel-left]").forEach(button => button.addEventListener("click", () => {
      const panel = button.dataset.vttPanelLeft;
      ui.leftPanel = ui.leftPanel === panel ? null : panel;
      render(root, ctx);
    }, { signal }));
    root.querySelectorAll("[data-vtt-panel-right]").forEach(button => button.addEventListener("click", () => {
      const panel = button.dataset.vttPanelRight;
      ui.rightPanel = ui.rightPanel === panel ? null : panel;
      saveUiState();
      render(root, ctx);
    }, { signal }));
    root.querySelectorAll("[data-vtt-character-player]").forEach(button => button.addEventListener("click", () => {
      ui.characterPlayerId = button.dataset.vttCharacterPlayer;
      render(root, ctx);
    }, { signal }));
    root.querySelectorAll("[data-vtt-character-page]").forEach(button => button.addEventListener("click", () => {
      ui.characterPage = button.dataset.vttCharacterPage;
      saveUiState();
      render(root,ctx);
    }, { signal }));
    root.querySelectorAll("[data-vtt-character-checks-page]").forEach(button => button.addEventListener("click", () => {
      ui.characterChecksPage = button.dataset.vttCharacterChecksPage;
      saveUiState();
      render(root,ctx);
    }, { signal }));
    root.querySelectorAll(".vtt-character-page").forEach(page => {
      page.addEventListener("wheel", event => {
        event.stopPropagation();
      }, { signal, passive:true });
      page.addEventListener("pointerdown", event => event.stopPropagation(), { signal });
    });
    root.querySelector("[data-vtt-open-full-sheet]")?.addEventListener("click", event => ctx.actions?.openSheet?.(event.currentTarget.dataset.vttOpenFullSheet), { signal });
    root.querySelector("[data-vtt-character-settings]")?.addEventListener("click",()=>openQuickSheetSettings(ctx,ctx.characters?.[ctx.clientId]),{signal});
    root.querySelectorAll("[data-vtt-character-formula]").forEach(button => button.addEventListener("click", () => {
      if (button.disabled) return;
      const visibility = window.TT_DICE_TRAY?.state?.visibility === "private" ? "private" : "public";
      ctx.actions?.roll?.(button.dataset.vttCharacterFormula,button.dataset.vttCharacterLabel || button.dataset.vttCharacterFormula,visibility,"normal");
    }, { signal }));
    root.querySelectorAll("[data-vtt-use-item]").forEach(button=>button.addEventListener("click",()=>{if(button.disabled)return;const visibility=window.TT_DICE_TRAY?.state?.visibility==="private"?"private":"public";const own=(scene.tokens||[]).find(token=>token.playerId===ctx.clientId);ctx.actions?.useItem?.(button.dataset.vttUseItem,own?.id||"",visibility);},{signal}));
    root.querySelectorAll("[data-vtt-resource-change]").forEach(button=>button.addEventListener("click",()=>ctx.actions?.changeResource?.(button.dataset.vttResourceChange,Number(button.dataset.delta)||0),{signal}));
    root.querySelectorAll("[data-vtt-slot-change]").forEach(button=>button.addEventListener("click",()=>ctx.actions?.changeSpellSlot?.(Number(button.dataset.vttSlotChange),Number(button.dataset.delta)||0,button.dataset.pact==="1"),{signal}));
    root.querySelectorAll("[data-vtt-cast-spell]").forEach(button=>button.addEventListener("click",()=>{if(!button.disabled)ctx.actions?.castSpell?.(button.dataset.vttCastSpell);},{signal}));
    root.querySelectorAll("[data-vtt-place-summon]").forEach(button=>button.addEventListener("click",()=>ctx.actions?.placeSummon?.(button.dataset.vttPlaceSummon,button.dataset.playerId),{signal}));
    root.querySelectorAll("[data-vtt-place-companion]").forEach(button=>button.addEventListener("click",()=>ctx.actions?.placeCompanion?.(button.dataset.vttPlaceCompanion,button.dataset.playerId),{signal}));
    root.querySelectorAll("[data-vtt-death-save]").forEach(button=>button.addEventListener("click",()=>{if(button.disabled)return;const visibility=window.TT_DICE_TRAY?.state?.visibility==="private"?"private":"public";ctx.actions?.deathSave?.(button.dataset.vttDeathSave,visibility);},{signal}));
    root.querySelectorAll("[data-vtt-npc-edit]").forEach(button=>button.addEventListener("click",()=>{const token=(scene.tokens||[]).find(entry=>entry.id===button.dataset.vttNpcEdit);openNpcSheetEditor(ctx,token);},{signal}));
    root.querySelectorAll("[data-vtt-open-npc]").forEach(button=>button.addEventListener("click",()=>{ui.rightPanel="character";saveUiState();render(root,ctx);},{signal}));
    root.querySelectorAll("[data-vtt-open-bestiary]").forEach(button=>button.addEventListener("click",()=>{window.TT_BESTIARY?.open?.(button.dataset.vttOpenBestiary);ctx.switchView?.("bestiary");},{signal}));
    root.querySelectorAll("[data-vtt-npc-formula]").forEach(button=>button.addEventListener("click",()=>{if(button.disabled)return;const point=cameraCenterGrid();emit(ctx,"scene:dice-roll",{...point,formula:button.dataset.vttNpcFormula,label:button.dataset.vttNpcLabel,visibility:button.dataset.vttNpcVisibility==="public"?"public":"private"}).then(response=>{if(response.ok&&response.roll)window.TT_DICE_PHYSICS?.play?.(response.roll);});},{signal}));
    root.querySelectorAll("[data-vtt-tool]").forEach(button => button.addEventListener("click", () => {
      const nextTool = button.dataset.vttTool;
      clearTransformMode();
      closeContextMenu();
      ui.tool = nextTool === "ping" && ui.tool === "ping" ? "select" : nextTool;
      if (["dice","fog-cover","fog-reveal"].includes(ui.tool)) ui.leftPanel = "tools";
      render(root, ctx);
    }, { signal }));
    const toggleMovementSnap = () => { ui.movementSnap = !movementSnaps(); saveUiState(); closeContextMenu(); render(root,ctx); };
    root.querySelector("#vtt-movement-mode")?.addEventListener("click", toggleMovementSnap, { signal });
    root.querySelector("#vtt-movement-snap")?.addEventListener("click", toggleMovementSnap, { signal });

    root.querySelectorAll("[data-vtt-die-add]").forEach(button => button.addEventListener("click", () => { window.TT_DICE_TRAY?.add(button.dataset.vttDieAdd,1); render(root,ctx); }, { signal }));
    root.querySelectorAll("[data-vtt-die-sub]").forEach(button => button.addEventListener("click", () => { window.TT_DICE_TRAY?.add(button.dataset.vttDieSub,-1); render(root,ctx); }, { signal }));
    root.querySelector("#vtt-dice-modifier")?.addEventListener("change", event => { window.TT_DICE_TRAY?.setModifier(event.currentTarget.value); render(root,ctx); }, { signal });
    root.querySelector("#vtt-dice-visibility")?.addEventListener("click", () => { window.TT_DICE_TRAY?.setVisibility(window.TT_DICE_TRAY?.state?.visibility === "private" ? "public" : "private"); render(root,ctx); }, { signal });
    root.querySelector("#vtt-dice-reset")?.addEventListener("click", () => { window.TT_DICE_TRAY?.reset(); render(root,ctx); }, { signal });
    root.querySelector("#vtt-dice-clear")?.addEventListener("click", () => { window.TT_DICE_TRAY?.clear(); render(root,ctx); }, { signal });
    root.querySelector("#vtt-dice-color")?.addEventListener("change", async event => { await ctx.actions?.savePreferences?.({ diceColor:event.currentTarget.value }); render(root,ctx); }, { signal });
    root.querySelector("#vtt-dice-formula-input")?.addEventListener("input", event => { ui.diceFormula = event.currentTarget.value; }, { signal });
    root.querySelector("#vtt-dice-formula-form")?.addEventListener("submit", event => {
      event.preventDefault();
      const formula = String(new FormData(event.currentTarget).get("formula") || "").trim();
      if (!formula) return ctx.toast("Введи формулу, например 3d6+1");
      ui.diceFormula = formula;
      const point = cameraCenterGrid();
      emit(ctx,"scene:dice-roll",{ ...point, formula, visibility:window.TT_DICE_TRAY?.state?.visibility === "private" ? "private" : "public" }).then(response => {
        if (response.ok && response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
      });
    }, { signal });

    root.querySelectorAll("[data-vtt-context-action]").forEach(button => button.addEventListener("click", async () => {
      const action = button.dataset.vttContextAction;
      const ref = ui.contextMenu?.ref || null;
      const refs = uniqueRefs(Array.isArray(ui.contextMenu?.refs) && ui.contextMenu.refs.length ? ui.contextMenu.refs : ref ? [ref] : []);
      const entry = ref ? resolveRef(scene,ref) : null;
      const finish = () => { closeContextMenu(); render(root,ctx); };
      if (action === "toggle-snap") return toggleMovementSnap();
      if (action === "inspector") { ui.rightPanel="inspector"; closeContextMenu(); saveUiState(); return render(root,ctx); }
      if (action === "group-settings" && isDm) { closeContextMenu(); root.querySelector("[data-vtt-context-menu]")?.remove(); return openGroupTokenEditor(ctx,refs.filter(item=>item.kind==="token").map(item=>item.id)); }
      if (action === "group-initiative" && isDm) { closeContextMenu(); root.querySelector("[data-vtt-context-menu]")?.remove(); return emit(ctx,"scene:tokens-batch-update",{tokenIds:refs.filter(item=>item.kind==="token").map(item=>item.id),rollInitiative:true},"Инициатива группы брошена"); }
      if (action === "measure" || action === "ping") { ui.tool = action === "measure" ? "measure" : "ping"; closeContextMenu(); return render(root,ctx); }
      if (action === "tools") { ui.leftPanel = "tools"; closeContextMenu(); return render(root,ctx); }
      if (action === "library" && isDm) { ui.leftPanel = "library"; closeContextMenu(); return render(root,ctx); }
      if (!entry) return finish();
      if (action === "transform" && isDm && ["token","object"].includes(entry.kind)) {
        setSelection(room,[ref]); ui.tool = "select"; ui.transformRef = { ...ref }; closeContextMenu(); return render(root,ctx);
      }
      if (action === "attach" && isDm) { closeContextMenu(); root.querySelector("[data-vtt-context-menu]")?.remove(); return openAttachmentPicker(ctx,ref); }
      if (action === "detach" && isDm) { closeContextMenu(); await emit(ctx,"scene:item-attach",{childKind:ref.kind,childId:ref.id},"Привязка снята"); return; }
      if (action === "settings") {
        closeContextMenu();
        root.querySelector("[data-vtt-context-menu]")?.remove();
        if (entry.kind === "token") return openTokenEditor(ctx,entry.value);
        if (entry.kind === "object") return openObjectEditor(ctx,entry.value);
        return openAnnotationEditor(ctx,entry.value);
      }
      if (action === "appearances" && entry.kind === "token" && entry.value.playerId===ctx.clientId) {
        closeContextMenu(); ctx.switchView?.("forge"); return;
      }
      if (action === "open-character" && entry.kind === "token" && entry.value.playerId) {
        ui.characterPlayerId = entry.value.playerId; ui.rightPanel = "character"; closeContextMenu(); saveUiState(); return render(root,ctx);
      }
      if (action === "open-npc" && entry.kind === "token") { setSelection(room,[ref]); ui.rightPanel = "character"; closeContextMenu(); saveUiState(); return render(root,ctx); }
      if (action === "open-bestiary" && entry.kind === "token" && entry.value.bestiaryKey) { closeContextMenu(); window.TT_BESTIARY?.open?.(entry.value.bestiaryKey); ctx.switchView?.("bestiary"); return; }
      if (action === "initiative" && entry.kind === "token") { closeContextMenu(); root.querySelector("[data-vtt-context-menu]")?.remove(); const response=await emit(ctx,"initiative:roll",{tokenId:entry.value.id}); if(response.ok&&response.roll)window.TT_DICE_PHYSICS?.play?.(response.roll); return; }
      if (action === "duplicate" && isDm) { closeContextMenu(); await duplicateRefs(root,ctx,refs); return render(root,ctx); }
      if (action === "delete" && isDm) { closeContextMenu(); await removeRefs(root,ctx,refs); return render(root,ctx); }
      const patch = {};
      if (action === "toggle-name" && entry.kind === "token") patch.showName = entry.value.showName === false;
      if (action === "toggle-hp" && entry.kind === "token") patch.showHp = entry.value.showHp === false;
      if (action === "toggle-ac" && entry.kind === "token") patch.showAc = !entry.value.showAc;
      if (action === "toggle-hidden") patch.hidden = !entry.value.hidden;
      if (action === "toggle-locked") patch.locked = !entry.value.locked;
      if (Object.keys(patch).length) {
        closeContextMenu();
        if (entry.kind === "token") await emit(ctx,"scene:token-update",{tokenId:entry.value.id,...patch});
        else if (entry.kind === "object") await emit(ctx,"scene:object-update",{objectId:entry.value.id,...patch});
        else await emit(ctx,"scene:annotation-update",{annotationId:entry.value.id,...patch});
        return;
      }
      finish();
    }, { signal }));

    root.querySelector("[data-vtt-token-quick-hp]")?.addEventListener("pointerdown",event=>event.stopPropagation(),{signal});
    root.querySelectorAll("[data-vtt-token-hp-delta]").forEach(button=>button.addEventListener("click",event=>{event.stopPropagation();const host=button.closest("[data-vtt-token-quick-hp]"),amount=event.shiftKey?5:1,delta=Number(button.dataset.vttTokenHpDelta);ctx.actions?.applyCombat?.(host?.dataset.vttTokenQuickHp,delta<0?"damage":"healing",amount,delta<0?"Быстрый урон":"Быстрое лечение","public");},{signal}));
    root.querySelector("[data-vtt-token-hp-prompt]")?.addEventListener("click",event=>{event.stopPropagation();const host=event.currentTarget.closest("[data-vtt-token-quick-hp]"),raw=prompt("Изменение HP: отрицательное — урон, положительное — лечение","-1"),amount=Number(raw);if(!amount)return;ctx.actions?.applyCombat?.(host?.dataset.vttTokenQuickHp,amount<0?"damage":"healing",Math.abs(amount),amount<0?"Изменение HP · урон":"Изменение HP · лечение","public");},{signal});
    root.querySelector("[data-vtt-token-death-save]")?.addEventListener("click",event=>{event.stopPropagation();const visibility=window.TT_DICE_TRAY?.state?.visibility==="private"?"private":"public";ctx.actions?.deathSave?.(event.currentTarget.dataset.vttTokenDeathSave,visibility);},{signal});

    root.querySelector("#vtt-zoom-in")?.addEventListener("click", () => { const point = cameraCenterGrid(); centerCamera(point.x, point.y, camera.zoom * 1.2); }, { signal });
    root.querySelector("#vtt-zoom-out")?.addEventListener("click", () => { const point = cameraCenterGrid(); centerCamera(point.x, point.y, camera.zoom / 1.2); }, { signal });
    root.querySelector("#vtt-zoom-value")?.addEventListener("click", () => centerCamera(0, 0, 1), { signal });
    root.querySelector("#vtt-camera-reset")?.addEventListener("click", () => centerCamera(0, 0, 0.82), { signal });
    root.querySelector("#vtt-focus-own")?.addEventListener("click", () => { if (ownToken) centerCamera(ownToken.x, ownToken.y, Math.max(camera.zoom,0.82)); }, { signal });
    root.querySelectorAll("[data-vtt-character-focus]").forEach(button => button.addEventListener("click", () => {
      const token = (scene.tokens || []).find(entry => entry.id === button.dataset.vttCharacterFocus);
      if (token) centerCamera(token.x, token.y, Math.max(camera.zoom,0.82));
    }, { signal }));
    root.querySelector("#vtt-clear-measure")?.addEventListener("click", () => { measurementByScene.delete(sceneKey(room)); render(root, ctx); }, { signal });
    root.querySelector("#vtt-quick-d20")?.addEventListener("click", () => {
      const point = cameraCenterGrid();
      emit(ctx, "scene:dice-roll", { x:point.x, y:point.y, dice:[{ sides:20, count:1 }], modifier:0, visibility:window.TT_DICE_TRAY?.state?.visibility === "private" ? "private" : "public" }).then(response => {
        if (response.ok && response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
      });
    }, { signal });

    viewport.addEventListener("wheel", event => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const worldX = (pointerX - camera.panX) / camera.zoom;
      const worldY = (pointerY - camera.panY) / camera.zoom;
      const nextZoom = clamp(camera.zoom * (event.deltaY < 0 ? 1.12 : 0.89), 0.15, 4);
      camera.panX = pointerX - worldX * nextZoom;
      camera.panY = pointerY - worldY * nextZoom;
      camera.zoom = nextZoom;
      applyCamera();
    }, { signal, passive:false });

    const beginPan = event => {
      const startX = event.clientX;
      const startY = event.clientY;
      const startPanX = camera.panX;
      const startPanY = camera.panY;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
      const move = pointer => {
        camera.panX = startPanX + pointer.clientX - startX;
        camera.panY = startPanY + pointer.clientY - startY;
        applyCamera();
      };
      const up = pointer => {
        if (viewport.hasPointerCapture(pointer.pointerId)) viewport.releasePointerCapture(pointer.pointerId);
        viewport.classList.remove("is-panning");
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerup", up);
        viewport.removeEventListener("pointercancel", up);
      };
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", up, { once:true });
      viewport.addEventListener("pointercancel", up, { once:true });
      event.preventDefault();
    };

    window.addEventListener("keydown", event => handleKeydown(event, root, ctx, viewport, centerCamera), { signal, capture:true });
    window.addEventListener("keyup", event => {
      if (event.code === "Space") {
        spaceHeld = false;
        viewport.classList.remove("is-pan-ready");
      }
    }, { signal, capture:true });

    viewport.addEventListener("pointermove", event => {
      const point = screenToGrid(event.clientX, event.clientY, "cell");
      const label = root.querySelector("#vtt-cursor-position");
      if (label) label.textContent = `${point.x} : ${point.y}`;
    }, { signal });

    viewport.addEventListener("contextmenu", event => {
      if (event.target.closest("[data-vtt-token],[data-vtt-object],[data-vtt-annotation]")) return;
      event.preventDefault();
      clearTransformMode();
      ui.contextMenu = { ref:null, refs:[], x:event.clientX, y:event.clientY };
      render(root,ctx);
    }, { signal });

    viewport.addEventListener("pointerdown", event => {
      if (event.button === 1 || event.button === 0 && (spaceHeld || ui.tool === "pan")) return beginPan(event);
      if (event.button !== 0) return;
      const overSceneItem=event.target.closest("[data-vtt-token],[data-vtt-object],[data-vtt-annotation]");
      if (ui.contextMenu && !event.target.closest("[data-vtt-context-menu]")) {
        closeContextMenu();
        if (!overSceneItem) { clearTransformMode(); setSelection(room,[]); render(root,ctx); event.preventDefault(); return; }
      }
      if (ui.tool === "select") {
        if (overSceneItem) return;
        if (ui.transformRef) { clearTransformMode(); setSelection(room,[]); render(root,ctx); event.preventDefault(); return; }
        return beginMarquee(event, root, ctx, viewport);
      }
      if (ui.tool === "ping") {
        const point = screenToGridRaw(event.clientX,event.clientY);
        emit(ctx, "scene:ping", { ...point, color:ui.color });
        return;
      }
      if (ui.tool === "dice") {
        const point = movementSnaps() ? screenToGrid(event.clientX, event.clientY, "cell") : screenToGridRaw(event.clientX,event.clientY);
        const dice = window.TT_DICE_TRAY?.selection?.() || [];
        if (!dice.length) return ctx.toast("Добавь хотя бы один кубик");
        emit(ctx, "scene:dice-roll", { ...point, dice, modifier:Number(window.TT_DICE_TRAY?.state?.modifier) || 0, visibility:window.TT_DICE_TRAY?.state?.visibility === "private" ? "private" : "public" }).then(response => {
          if (response.ok && response.roll) window.TT_DICE_PHYSICS?.play?.(response.roll);
        });
        return;
      }
      if (ui.tool === "text") {
        const point = screenToGrid(event.clientX, event.clientY, "intersection");
        const text = prompt("Текст на карте:", "");
        if (text?.trim()) emit(ctx, "scene:annotation-add", { kind:"text", ...point, x2:point.x, y2:point.y, text:text.trim(), name:text.trim().slice(0,80), color:ui.color, strokeWidth:ui.strokeWidth });
        return;
      }
      if (["fog-cover","fog-reveal"].includes(ui.tool) && isDm) return beginFogDrawing(event,root,ctx,viewport,draftLayer,metrics,screenToGrid);
      if (["measure", "line", "rect", "circle", "cone", "draw"].includes(ui.tool)) beginDrawing(event, root, ctx, viewport, draftLayer, metrics, screenToGrid, screenToGridRaw);
    }, { signal });

    if (isDm) {
      viewport.addEventListener("dragover", event => { event.preventDefault(); viewport.classList.add("is-drag-over"); }, { signal });
      viewport.addEventListener("dragleave", () => viewport.classList.remove("is-drag-over"), { signal });
      viewport.addEventListener("drop", event => {
        event.preventDefault();
        viewport.classList.remove("is-drag-over");
        const assetId = event.dataTransfer.getData("text/tabaxi-asset");
        const asset = (room.assets || []).find(entry => entry.id === assetId);
        if (!asset) return;
        const point = screenToGrid(event.clientX, event.clientY, asset.category === "token" ? "cell" : "intersection");
        if ((asset.category === "map" || asset.category === "prop") && metrics.type === "square") {
          const width = Number(asset.defaultSize || (asset.category === "map" ? 20 : 1));
          const ratio = asset.width && asset.height ? asset.height / asset.width : asset.category === "map" ? 0.6 : 1;
          point.x = grid.snap === false ? roundTenth(point.x - width / 2) : Math.round(point.x - width / 2);
          point.y = grid.snap === false ? roundTenth(point.y - width * ratio / 2) : Math.round(point.y - width * ratio / 2);
        }
        emit(ctx, "scene:asset-place", { assetId, x:point.x, y:point.y }, "Ресурс размещён");
      }, { signal });
    }

    bindSceneItems(root, ctx, viewport, metrics, screenToGridRaw, signal);
    bindPanels(root, ctx, metrics, centerCamera, currentCameraCenterGrid, signal);
    window.TT_DICE_PHYSICS?.play(scene.diceRolls?.length ? scene.diceRolls : scene.diceRoll);
  }

  function handleKeydown(event, root, ctx, viewport) {
    const target = event.target;
    if (!active || target?.closest?.("input,textarea,select,[contenteditable=true]") || event.isComposing) return;
    if (event.code === "Space") {
      spaceHeld = true;
      viewport.classList.add("is-pan-ready");
      event.preventDefault();
      return;
    }
    if (event.code === "Escape") {
      setSelection(ctx.room, []);
      clearTransformMode();
      closeContextMenu();
      measurementByScene.delete(sceneKey(ctx.room));
      ui.tool = "select";
      render(root, ctx);
      return;
    }
    if (event.code === "Enter" && ui.transformRef) {
      clearTransformMode();
      closeContextMenu();
      render(root,ctx);
      event.preventDefault();
      return;
    }
    if (event.shiftKey && event.code === "KeyS") {
      ui.rightPanel = ui.rightPanel === "character" ? null : "character";
      saveUiState();
      render(root, ctx);
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.code === "KeyC") {
        const refs = getSelection(ctx.room);
        if (refs.length) clipboard = { sceneId:ctx.room.scene.id, refs:structuredClone(refs) };
        event.preventDefault();
      } else if (event.code === "KeyV") {
        if (clipboard?.sceneId === ctx.room.scene.id && clipboard.refs.length) duplicateRefs(root, ctx, clipboard.refs);
        event.preventDefault();
      } else if (event.code === "KeyD") {
        duplicateRefs(root, ctx, getSelection(ctx.room));
        event.preventDefault();
      } else if ((event.code === "KeyZ" && event.shiftKey) || event.code === "KeyY") {
        emit(ctx, "scene:history-redo");
        setSelection(ctx.room, []);
        event.preventDefault();
      } else if (event.code === "KeyZ") {
        emit(ctx, "scene:history-undo");
        setSelection(ctx.room, []);
        event.preventDefault();
      }
      return;
    }
    if (event.code === "Delete" || event.code === "Backspace") {
      removeRefs(root, ctx, getSelection(ctx.room));
      event.preventDefault();
      return;
    }
    const toolByCode = { KeyV:"select", KeyH:"pan", KeyM:"measure", KeyP:"ping", KeyR:"rect", KeyC:"circle", KeyN:"cone", KeyL:"line", KeyD:"draw", KeyT:"text", KeyK:"dice", KeyF:event.shiftKey?"fog-reveal":"fog-cover" };
    const nextTool = toolByCode[event.code];
    if (!nextTool || event.repeat) return;
    clearTransformMode();
    closeContextMenu();
    ui.tool = nextTool === "ping" && ui.tool === "ping" ? "select" : nextTool;
    if (ui.tool === "dice") ui.leftPanel = "tools";
    render(root, ctx);
    event.preventDefault();
  }

  function beginMarquee(event, root, ctx, viewport) {
    const room = ctx.room;
    const marquee = root.querySelector("#vtt-marquee");
    const rect = viewport.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    marquee.classList.remove("hidden");

    const update = pointer => {
      const x = pointer.clientX - rect.left;
      const y = pointer.clientY - rect.top;
      marquee.style.left = `${Math.min(startX, x)}px`;
      marquee.style.top = `${Math.min(startY, y)}px`;
      marquee.style.width = `${Math.abs(x - startX)}px`;
      marquee.style.height = `${Math.abs(y - startY)}px`;
    };

    const finish = pointer => {
      update(pointer);
      const box = marquee.getBoundingClientRect();
      const refs = [];
      root.querySelectorAll("[data-vtt-token],[data-vtt-object],[data-vtt-annotation]").forEach(element => {
        const item = element.getBoundingClientRect();
        if (item.right < box.left || item.left > box.right || item.bottom < box.top || item.top > box.bottom) return;
        if (element.dataset.vttToken) refs.push({ kind:"token", id:element.dataset.vttToken });
        else if (element.dataset.vttObject) refs.push({ kind:"object", id:element.dataset.vttObject });
        else if (element.dataset.vttAnnotation) refs.push({ kind:"annotation", id:element.dataset.vttAnnotation });
      });
      if (pointer.shiftKey || pointer.ctrlKey || pointer.metaKey) setSelection(room, [...getSelection(room), ...refs]);
      else setSelection(room, refs);
      marquee.classList.add("hidden");
      viewport.removeEventListener("pointermove", update);
      viewport.removeEventListener("pointerup", finish);
      viewport.removeEventListener("pointercancel", finish);
      render(root, ctx);
    };

    viewport.addEventListener("pointermove", update);
    viewport.addEventListener("pointerup", finish, { once:true });
    viewport.addEventListener("pointercancel", finish, { once:true });
    event.preventDefault();
  }

  function beginDrawing(event, root, ctx, viewport, draftLayer, metrics, screenToGrid, screenToGridRaw) {
    const tool = ui.tool;
    const start = tool === "measure" ? screenToGrid(event.clientX, event.clientY, "center") : tool === "draw" ? screenToGridRaw(event.clientX, event.clientY) : screenToGrid(event.clientX, event.clientY, "intersection");
    let end = { ...start };
    const points = [{ ...start }];
    viewport.setPointerCapture(event.pointerId);

    const updateDraft = () => {
      const annotation = { kind:tool === "measure" ? "line" : tool, x:start.x, y:start.y, x2:end.x, y2:end.y, points, color:ui.color, fill:ui.fill, fillOpacity:ui.fillOpacity, strokeWidth:ui.strokeWidth, opacity:1 };
      draftLayer.innerHTML = annotationMarkup(annotation, metrics, []);
      if (tool === "measure") {
        const startPx = metrics.toWorld(start.x, start.y);
        const endPx = metrics.toWorld(end.x, end.y);
        const feet = measurementFeet(ctx.room.scene?.grid || {}, start, end);
        draftLayer.insertAdjacentHTML("beforeend", `<g class="vtt-draft-label" transform="translate(${(startPx.x + endPx.x)/2} ${(startPx.y + endPx.y)/2})"><rect x="-40" y="-14" width="80" height="28" rx="8"/><text text-anchor="middle" dominant-baseline="central">${feet} фт.</text></g>`);
      }
    };

    const move = pointer => {
      end = tool === "measure" ? screenToGrid(pointer.clientX, pointer.clientY, "center") : tool === "draw" ? screenToGridRaw(pointer.clientX, pointer.clientY) : screenToGrid(pointer.clientX, pointer.clientY, "intersection");
      if (tool === "draw") {
        const previous = points[points.length - 1];
        if (Math.hypot(end.x - previous.x, end.y - previous.y) > 0.08) points.push({ ...end });
      }
      updateDraft();
    };

    const up = async pointer => {
      if (viewport.hasPointerCapture(pointer.pointerId)) viewport.releasePointerCapture(pointer.pointerId);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", up);
      draftLayer.innerHTML = "";
      if (tool === "measure") {
        measurementByScene.set(sceneKey(ctx.room), { x:start.x, y:start.y, x2:end.x, y2:end.y });
        render(root, ctx);
        return;
      }
      if ((tool === "draw" && points.length < 2) || (tool !== "draw" && start.x === end.x && start.y === end.y)) return;
      await emit(ctx, "scene:annotation-add", { kind:tool, x:start.x, y:start.y, x2:end.x, y2:end.y, points:tool === "draw" ? points : [], color:ui.color, fill:ui.fill, fillOpacity:ui.fillOpacity, strokeWidth:ui.strokeWidth, opacity:1 }, "Рисунок добавлен");
    };

    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up, { once:true });
    viewport.addEventListener("pointercancel", up, { once:true });
    updateDraft();
    event.preventDefault();
  }

  function beginFogDrawing(event,root,ctx,viewport,draftLayer,metrics,screenToGrid) {
    const shape = ["rect","circle","draw"].includes(ui.fogShape) ? ui.fogShape : "rect";
    const start = screenToGrid(event.clientX,event.clientY,"intersection");
    let end = { ...start };
    const points = [{ ...start }];
    viewport.setPointerCapture(event.pointerId);
    const draw = () => {
      const a=metrics.toWorld(start.x,start.y), b=metrics.toWorld(end.x,end.y);
      if (shape === "circle") {
        draftLayer.innerHTML=`<circle class="vtt-fog-draft" cx="${a.x}" cy="${a.y}" r="${Math.hypot(b.x-a.x,b.y-a.y)}"/>`;
      } else if (shape === "draw") {
        const line=points.map(point=>metrics.toWorld(point.x,point.y)).map(point=>`${point.x},${point.y}`).join(" ");
        draftLayer.innerHTML=`<polyline class="vtt-fog-draft-line" points="${line}"/>`;
      } else {
        draftLayer.innerHTML=`<rect class="vtt-fog-draft" x="${Math.min(a.x,b.x)}" y="${Math.min(a.y,b.y)}" width="${Math.abs(a.x-b.x)}" height="${Math.abs(a.y-b.y)}"/>`;
      }
    };
    const move = pointer => {
      end=screenToGrid(pointer.clientX,pointer.clientY,"intersection");
      if (shape === "draw") {
        const last=points.at(-1);
        if (!last || last.x !== end.x || last.y !== end.y) points.push({ ...end });
      }
      draw();
    };
    const up = async pointer => {
      if(viewport.hasPointerCapture(pointer.pointerId)) viewport.releasePointerCapture(pointer.pointerId);
      viewport.removeEventListener("pointermove",move);
      draftLayer.innerHTML="";
      const mode=ui.tool === "fog-reveal" ? "reveal" : "cover";
      if (shape === "draw") {
        if (points.length > 1) await emit(ctx,"scene:fog-add",{ mode,kind:"draw",points,strokeWidth:Math.max(1,Number(ui.strokeWidth)||3) });
      } else if(start.x!==end.x||start.y!==end.y) {
        await emit(ctx,"scene:fog-add",{ mode,kind:shape,x:start.x,y:start.y,x2:end.x,y2:end.y });
      }
    };
    viewport.addEventListener("pointermove",move);
    viewport.addEventListener("pointerup",up,{once:true});
    viewport.addEventListener("pointercancel",up,{once:true});
    draw(); event.preventDefault();
  }

  function bindTransformHandles(root,ctx,metrics,screenToGridRaw,signal) {
    const scene=ctx.room.scene;
    const resolve=(kind,id)=>kind==="object"?(scene.objects||[]).find(item=>item.id===id):(scene.tokens||[]).find(item=>item.id===id);
    const elementFor=(kind,id)=>root.querySelector(kind==="object"?`[data-vtt-object="${CSS.escape(id)}"]`:`[data-vtt-token="${CSS.escape(id)}"]`);
    const snapValue=value=>movementSnaps()?Math.round(value):roundTenth(value);
    root.querySelectorAll("[data-vtt-resize-handle]").forEach(handle=>handle.addEventListener("pointerdown",event=>{
      if(event.button!==0)return;
      event.stopPropagation(); event.preventDefault();
      const kind=handle.dataset.vttTransformKind,id=handle.dataset.vttTransformId,edge=handle.dataset.vttResizeHandle;
      const value=resolve(kind,id),element=elementFor(kind,id); if(!value||!element)return;
      const start=screenToGridRaw(event.clientX,event.clientY),rotation=Number(value.rotation)||0,rad=rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
      const width=kind==="token"?Number(value.size||1):Number(value.width||1),height=kind==="token"?Number(value.size||1):Number(value.height||1);
      const center={x:Number(value.x||0)+width/2,y:Number(value.y||0)+height/2};
      let result={x:Number(value.x||0),y:Number(value.y||0),width,height,size:width,rotation};
      handle.setPointerCapture(event.pointerId);
      const move=pointer=>{
        const current=screenToGridRaw(pointer.clientX,pointer.clientY),dx=current.x-start.x,dy=current.y-start.y;
        const localDx=dx*cos+dy*sin,localDy=-dx*sin+dy*cos;
        if(kind==="token"){
          const signX=edge.includes("e")?1:-1,signY=edge.includes("s")?1:-1;
          const fixed={x:-signX*width/2,y:-signY*height/2};
          const dragged={x:signX*width/2+localDx,y:signY*height/2+localDy};
          const nextSize=Math.max(.25,Math.max(Math.abs(dragged.x-fixed.x),Math.abs(dragged.y-fixed.y)));
          const adjusted={x:fixed.x+signX*nextSize,y:fixed.y+signY*nextSize};
          const shift={x:(fixed.x+adjusted.x)/2,y:(fixed.y+adjusted.y)/2};
          const worldShift={x:shift.x*cos-shift.y*sin,y:shift.x*sin+shift.y*cos};
          result={...result,size:nextSize,width:nextSize,height:nextSize,x:center.x+worldShift.x-nextSize/2,y:center.y+worldShift.y-nextSize/2};
        }else{
          let left=-width/2,right=width/2,top=-height/2,bottom=height/2;
          if(edge.includes("w"))left+=localDx;if(edge.includes("e"))right+=localDx;if(edge.includes("n"))top+=localDy;if(edge.includes("s"))bottom+=localDy;
          if(right-left<.25){if(edge.includes("w"))left=right-.25;else right=left+.25;}
          if(bottom-top<.25){if(edge.includes("n"))top=bottom-.25;else bottom=top+.25;}
          const nextWidth=right-left,nextHeight=bottom-top,shift={x:(left+right)/2,y:(top+bottom)/2};
          const worldShift={x:shift.x*cos-shift.y*sin,y:shift.x*sin+shift.y*cos};
          result={...result,width:nextWidth,height:nextHeight,x:center.x+worldShift.x-nextWidth/2,y:center.y+worldShift.y-nextHeight/2};
        }
        const position=itemPosition(metrics,result.x,result.y,result.width,result.height);
        element.style.left=`${position.left}px`;element.style.top=`${position.top}px`;element.style.width=`${result.width*metrics.cell}px`;element.style.height=`${result.height*metrics.cell}px`;
      };
      const up=async pointer=>{if(handle.hasPointerCapture(pointer.pointerId))handle.releasePointerCapture(pointer.pointerId);handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",up);handle.removeEventListener("pointercancel",up);await emit(ctx,"scene:item-transform-update",{kind,id,x:snapValue(result.x),y:snapValue(result.y),width:result.width,height:result.height,size:result.size,snap:movementSnaps()});};
      handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",up,{once:true});handle.addEventListener("pointercancel",up,{once:true});
    },{signal}));
    root.querySelectorAll("[data-vtt-rotate-handle]").forEach(handle=>handle.addEventListener("pointerdown",event=>{
      if(event.button!==0)return;
      event.stopPropagation();event.preventDefault();
      const kind=handle.dataset.vttTransformKind,id=handle.dataset.vttTransformId,value=resolve(kind,id),element=elementFor(kind,id);if(!value||!element)return;
      const width=kind==="token"?Number(value.size||1):Number(value.width||1),height=kind==="token"?Number(value.size||1):Number(value.height||1),center={x:Number(value.x||0)+width/2,y:Number(value.y||0)+height/2};
      const start=screenToGridRaw(event.clientX,event.clientY),startAngle=Math.atan2(start.y-center.y,start.x-center.x),base=Number(value.rotation)||0;let rotation=base;
      handle.setPointerCapture(event.pointerId);
      const move=pointer=>{const current=screenToGridRaw(pointer.clientX,pointer.clientY),angle=Math.atan2(current.y-center.y,current.x-center.x);rotation=base+(angle-startAngle)*180/Math.PI;if(pointer.shiftKey)rotation=Math.round(rotation/15)*15;element.style.setProperty("--rotation",`${rotation}deg`);};
      const up=async pointer=>{if(handle.hasPointerCapture(pointer.pointerId))handle.releasePointerCapture(pointer.pointerId);handle.removeEventListener("pointermove",move);handle.removeEventListener("pointerup",up);handle.removeEventListener("pointercancel",up);await emit(ctx,"scene:item-transform-update",{kind,id,rotation,snap:movementSnaps()});};
      handle.addEventListener("pointermove",move);handle.addEventListener("pointerup",up,{once:true});handle.addEventListener("pointercancel",up,{once:true});
    },{signal}));
  }

  function bindSceneItems(root, ctx, viewport, metrics, screenToGridRaw, signal) {
    const room = ctx.room;
    const scene = room.scene;
    const isDm = room.dmId === ctx.clientId;
    const movementMetrics = gridMetrics({ ...(scene.grid || {}), snap:true }, metrics.cell);

    bindTransformHandles(root,ctx,metrics,screenToGridRaw,signal);

    const itemData = (kind, id) => resolveRef(scene, { kind, id });
    const itemElement = ref => root.querySelector(ref.kind === "token" ? `[data-vtt-token="${CSS.escape(ref.id)}"]` : ref.kind === "object" ? `[data-vtt-object="${CSS.escape(ref.id)}"]` : `[data-vtt-annotation="${CSS.escape(ref.id)}"]`);

    const refreshSelectionClasses = () => {
      const selection = getSelection(room);
      root.querySelectorAll("[data-vtt-token]").forEach(element => element.classList.toggle("is-selected", selectionHas(selection, "token", element.dataset.vttToken)));
      root.querySelectorAll("[data-vtt-object]").forEach(element => element.classList.toggle("is-selected", selectionHas(selection, "object", element.dataset.vttObject)));
      root.querySelectorAll("[data-vtt-annotation]").forEach(element => element.classList.toggle("is-selected", selectionHas(selection, "annotation", element.dataset.vttAnnotation)));
    };

    const canMove = entry => {
      if (!entry) return false;
      if (entry.kind === "token") return (isDm || entry.value.playerId === ctx.clientId) && (!entry.value.locked || isDm);
      return isDm && !entry.value.locked;
    };

    const bindItem = (element, kind, id) => {
      element.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        const ref = { kind, id };
        const current = getSelection(room);
        const refs = selectionHas(current,kind,id) && current.length > 1 ? current : [ref];
        setSelection(room,refs);
        if (!transformRefMatches(kind,id)) clearTransformMode();
        ui.contextMenu = { ref, refs, x:event.clientX, y:event.clientY };
        render(root,ctx);
      }, { signal });
      element.addEventListener("pointerdown", event => {
        if (event.target.closest("[data-vtt-resize-handle],[data-vtt-rotate-handle]")) return;
        if (event.button !== 0 || spaceHeld || ui.tool !== "select") return;
        event.stopPropagation();
        closeContextMenu();
        if (ui.transformRef && !transformRefMatches(kind,id)) clearTransformMode();
        const current = getSelection(room);
        const already = selectionHas(current, kind, id);
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          setSelection(room, already ? current.filter(ref => !(ref.kind === kind && ref.id === id)) : [...current, { kind, id }]);
          refreshSelectionClasses();
          event.preventDefault();
          return;
        }
        if (!already) {
          setSelection(room, [{ kind, id }]);
          refreshSelectionClasses();
        }
        const selected = getSelection(room);
        const movable = selected.map(ref => ({ ref, entry:itemData(ref.kind, ref.id) })).filter(item => canMove(item.entry));
        if (!movable.some(item => item.ref.kind === kind && item.ref.id === id)) {
          render(root, ctx);
          return;
        }

        const startPointer = screenToGridRaw(event.clientX, event.clientY);
        const originals = movable.map(item => ({ ...item, x:Number(item.entry.value.x || 0), y:Number(item.entry.value.y || 0) }));
        let dx = 0;
        let dy = 0;
        let moved = false;
        element.setPointerCapture(event.pointerId);

        const move = pointer => {
          const currentPointer = screenToGridRaw(pointer.clientX, pointer.clientY);
          const rawDx = currentPointer.x - startPointer.x;
          const rawDy = currentPointer.y - startPointer.y;
          const snappedDelta = movementSnaps() ? movementMetrics.snap({ x:rawDx, y:rawDy }, "intersection") : { x:roundTenth(rawDx), y:roundTenth(rawDy) };
          dx = snappedDelta.x;
          dy = snappedDelta.y;
          moved = moved || Math.abs(dx) > 0 || Math.abs(dy) > 0;
          originals.forEach(item => {
            const target = itemElement(item.ref);
            if (!target) return;
            if (item.ref.kind === "annotation") {
              const startPx = metrics.toWorld(0, 0);
              const endPx = metrics.toWorld(dx, dy);
              target.closest("[data-vtt-annotation-group]")?.setAttribute("transform", `translate(${endPx.x - startPx.x} ${endPx.y - startPx.y})`);
            } else {
              const value = item.entry.value;
              const width = item.ref.kind === "token" ? Number(value.size || 1) : Number(value.width || 1);
              const height = item.ref.kind === "token" ? Number(value.size || 1) : Number(value.height || 1);
              const position = itemPosition(metrics, item.x + dx, item.y + dy, width, height);
              target.style.left = `${position.left}px`;
              target.style.top = `${position.top}px`;
            }
          });
        };

        const up = async pointer => {
          if (element.hasPointerCapture(pointer.pointerId)) element.releasePointerCapture(pointer.pointerId);
          element.removeEventListener("pointermove", move);
          element.removeEventListener("pointerup", up);
          element.removeEventListener("pointercancel", up);
          if (moved) await emit(ctx, "scene:items-transform", { moves:originals.map(item => ({ kind:item.ref.kind, id:item.ref.id, dx, dy })), snap:movementSnaps() });
          else render(root, ctx);
        };

        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", up, { once:true });
        element.addEventListener("pointercancel", up, { once:true });
        event.preventDefault();
      }, { signal });
    };

    root.querySelectorAll("[data-vtt-token]").forEach(element => bindItem(element, "token", element.dataset.vttToken));
    root.querySelectorAll("[data-vtt-object]").forEach(element => bindItem(element, "object", element.dataset.vttObject));
    root.querySelectorAll("[data-vtt-annotation]").forEach(element => bindItem(element, "annotation", element.dataset.vttAnnotation));
  }

  function bindPanels(root, ctx, metrics, centerCamera, cameraCenterGrid, signal) {
    const room = ctx.room;
    const scene = room.scene;
    const isDm = room.dmId === ctx.clientId;

    root.querySelectorAll("[data-vtt-scene]").forEach(button => button.addEventListener("click", () => {
      if (!button.classList.contains("active") && isDm) emit(ctx, "scene:activate", { sceneId:button.dataset.vttScene }, "Сцена показана игрокам");
    }, { signal }));
    root.querySelector("#vtt-scene-new")?.addEventListener("click", () => openSceneCreate(ctx), { signal });
    root.querySelector("#vtt-scene-copy")?.addEventListener("click", () => emit(ctx, "scene:duplicate", { sceneId:scene.id }, "Сцена скопирована"), { signal });
    root.querySelector("#vtt-scene-delete")?.addEventListener("click", () => { if (confirm(`Удалить сцену «${scene.name}»?`)) emit(ctx, "scene:remove", { sceneId:scene.id }, "Сцена удалена"); }, { signal });
    root.querySelector("#vtt-scene-settings")?.addEventListener("click", () => openSceneSettings(ctx), { signal });
    root.querySelector("#vtt-diagnostics")?.addEventListener("click",()=>openDiagnostics(ctx),{signal});
    root.querySelector("#vtt-scene-search")?.addEventListener("input",event=>{sceneSearch=event.target.value;render(root,ctx);requestAnimationFrame(()=>root.querySelector("#vtt-scene-search")?.focus());},{signal});
    root.querySelector("#vtt-add-party")?.addEventListener("click", () => emit(ctx, "scene:party-add", {}, "Токены партии добавлены"), { signal });
    root.querySelector("#vtt-own-initiative")?.addEventListener("click", () => {
      const token = (scene.tokens || []).find(entry => entry.playerId === ctx.clientId);
      if (token) emit(ctx, "initiative:roll", { tokenId:token.id }).then(response=>{if(response.ok&&response.roll)window.TT_DICE_PHYSICS?.play?.(response.roll);});
    }, { signal });

    root.querySelectorAll("[data-vtt-asset-filter]").forEach(button => button.addEventListener("click", () => { assetFilter = button.dataset.vttAssetFilter; render(root, ctx); }, { signal }));
    root.querySelector("#vtt-asset-folder")?.addEventListener("change",event=>{assetFolder=event.target.value;render(root,ctx);},{signal});
    root.querySelector("#vtt-folder-new")?.addEventListener("click",()=>{const name=String(prompt("Название новой папки")||"").trim().slice(0,60);if(!name)return;customAssetFolders.add(name);assetFolder=name;render(root,ctx);},{signal});
    root.querySelector("#vtt-asset-search")?.addEventListener("input", event => {
      const position = event.target.selectionStart;
      assetSearch = event.target.value;
      render(root, ctx);
      requestAnimationFrame(() => {
        const next = root.querySelector("#vtt-asset-search");
        if (next) { next.focus(); next.setSelectionRange(position, position); }
      });
    }, { signal });
    root.querySelectorAll('[data-vtt-asset][draggable="true"]').forEach(card => card.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/tabaxi-asset", card.dataset.vttAsset);
      event.dataTransfer.effectAllowed = "copy";
    }, { signal }));
    root.querySelectorAll("[data-vtt-place]").forEach(button => button.addEventListener("click", () => {
      const asset = (room.assets || []).find(entry => entry.id === button.dataset.vttPlace);
      const point = cameraCenterGrid();
      if ((asset?.category === "map" || asset?.category === "prop") && metrics.type === "square") {
        const width = Number(asset.defaultSize || 1);
        const ratio = asset.width && asset.height ? asset.height / asset.width : asset.category === "map" ? 0.6 : 1;
        point.x = scene.grid.snap === false ? roundTenth(point.x - width / 2) : Math.round(point.x - width / 2);
        point.y = scene.grid.snap === false ? roundTenth(point.y - width * ratio / 2) : Math.round(point.y - width * ratio / 2);
      }
      emit(ctx, "scene:asset-place", { assetId:button.dataset.vttPlace, x:point.x, y:point.y }, "Ресурс размещён");
    }, { signal }));
    root.querySelectorAll("[data-vtt-asset-edit]").forEach(button => button.addEventListener("click", () => openAssetEditor(ctx, (room.assets || []).find(asset => asset.id === button.dataset.vttAssetEdit)), { signal }));
    root.querySelectorAll("[data-vtt-forge-edit]").forEach(button => button.addEventListener("click", () => {
      const asset=(room.assets||[]).find(entry=>entry.id===button.dataset.vttForgeEdit);
      window.TT_TOKEN_FORGE?.openAsset?.(asset,room);
      ctx.switchView?.("forge");
    }, { signal }));

    let uploadCategory = "token";
    const input = root.querySelector("#vtt-file-input");
    root.querySelectorAll("[data-vtt-upload]").forEach(button => button.addEventListener("click", () => { uploadCategory = button.dataset.vttUpload; input.click(); }, { signal }));
    input?.addEventListener("change", async () => {
      const files = [...input.files];
      input.value = "";
      for (const file of files) await uploadAsset(ctx, file, uploadCategory);
    }, { signal });

    root.querySelector("#vtt-tool-color")?.addEventListener("input", event => { ui.color = event.target.value; }, { signal });
    root.querySelector("#vtt-tool-fill")?.addEventListener("input", event => { ui.fill = event.target.value; }, { signal });
    root.querySelector("#vtt-tool-width")?.addEventListener("change", event => { ui.strokeWidth = clamp(event.target.value, 1, 20); }, { signal });
    root.querySelector("#vtt-undo")?.addEventListener("click", () => { setSelection(room, []); emit(ctx, "scene:history-undo"); }, { signal });
    root.querySelector("#vtt-redo")?.addEventListener("click", () => { setSelection(room, []); emit(ctx, "scene:history-redo"); }, { signal });
    root.querySelector("#vtt-fog-undo")?.addEventListener("click",()=>emit(ctx,"scene:fog-clear",{mode:"last"}),{signal});
    root.querySelector("#vtt-fog-clear")?.addEventListener("click",()=>{if(confirm("Удалить весь ручной туман на сцене?"))emit(ctx,"scene:fog-clear",{mode:"all"});},{signal});
    root.querySelectorAll("[data-vtt-fog-shape]").forEach(button=>button.addEventListener("click",()=>{ui.fogShape=button.dataset.vttFogShape;saveUiState();render(root,ctx);},{signal}));
    root.querySelector("#vtt-encounter-search")?.addEventListener("input",event=>{encounterSearch=event.target.value;render(root,ctx);requestAnimationFrame(()=>root.querySelector("#vtt-encounter-search")?.focus());},{signal});
    root.querySelectorAll("[data-vtt-encounter-place]").forEach(button=>button.addEventListener("click",()=>{const point=cameraCenterGrid();emit(ctx,"scene:encounter-place",{templateId:button.dataset.vttEncounterPlace,...point},"Группа размещена");},{signal}));
    root.querySelectorAll("[data-vtt-encounter-delete]").forEach(button=>button.addEventListener("click",()=>{if(confirm("Удалить шаблон группы?"))emit(ctx,"scene:encounter-delete",{templateId:button.dataset.vttEncounterDelete});},{signal}));

    root.querySelectorAll("[data-vtt-focus-token]").forEach(button => button.addEventListener("click", () => {
      const token = (scene.tokens || []).find(entry => entry.id === button.dataset.vttFocusToken);
      if (!token) return;
      setSelection(room, [{ kind:"token", id:token.id }]);
      centerCamera(token.x, token.y, Math.max(getCamera(room).zoom, 0.85));
      ui.rightPanel = "inspector";
      render(root, ctx);
    }, { signal }));
    root.querySelectorAll("[data-vtt-initiative]").forEach(input => input.addEventListener("change", () => emit(ctx, "initiative:set", { tokenId:input.dataset.vttInitiative, value:input.value }), { signal }));
    root.querySelector("#vtt-next-turn")?.addEventListener("click", () => emit(ctx, "initiative:next"), { signal });
    root.querySelector("#vtt-clear-initiative")?.addEventListener("click", () => { if (confirm("Сбросить инициативу?")) emit(ctx, "initiative:clear"); }, { signal });

    root.querySelectorAll("[data-vtt-select-set]").forEach(button => button.addEventListener("click", () => {
      const mode = button.dataset.vttSelectSet;
      const tokens = (scene.tokens || []).filter(token => mode === "tokens" || mode === "party" && token.playerId || mode === "npc" && !token.playerId);
      setSelection(room,tokens.map(token => ({ kind:"token", id:token.id })));
      render(root,ctx);
    }, { signal }));
    root.querySelector("[data-vtt-group-token-settings]")?.addEventListener("click", () => openGroupTokenEditor(ctx,getSelection(room).filter(ref => ref.kind === "token").map(ref => ref.id)), { signal });
    root.querySelector("[data-vtt-encounter-save]")?.addEventListener("click",()=>{const tokenIds=getSelection(room).filter(ref=>ref.kind==="token").map(ref=>ref.id);const name=prompt("Название группы","Новая группа");if(name)emit(ctx,"scene:encounter-save",{tokenIds,name},"Группа сохранена");},{signal});
    root.querySelector("[data-vtt-copy-to-scene]")?.addEventListener("click",()=>{const options=(room.scenes||[]).filter(item=>!item.active);if(!options.length)return ctx.toast("Нет другой сцены");const title=prompt(`Куда копировать?\n${options.map((item,index)=>`${index+1}. ${item.name}`).join("\n")}`,"1");const target=options[Number(title)-1];if(target)emit(ctx,"scene:items-copy-to-scene",{refs:getSelection(room),targetSceneId:target.id},"Скопировано на другую сцену");},{signal});
    root.querySelector("[data-vtt-group-roll-initiative]")?.addEventListener("click", () => {
      const tokenIds = getSelection(room).filter(ref => ref.kind === "token").map(ref => ref.id);
      emit(ctx,"scene:tokens-batch-update",{ tokenIds, rollInitiative:true },`Инициатива брошена: ${tokenIds.length}`);
    }, { signal });

    root.querySelectorAll("[data-vtt-edit-token]").forEach(button => button.addEventListener("click", () => openTokenEditor(ctx, (scene.tokens || []).find(token => token.id === button.dataset.vttEditToken)), { signal }));
    root.querySelectorAll("[data-vtt-roll]").forEach(button => button.addEventListener("click", () => emit(ctx, "initiative:roll", { tokenId:button.dataset.vttRoll }).then(response=>{if(response.ok&&response.roll)window.TT_DICE_PHYSICS?.play?.(response.roll);}), { signal }));
    root.querySelectorAll("[data-vtt-edit-object]").forEach(button => button.addEventListener("click", () => openObjectEditor(ctx, (scene.objects || []).find(object => object.id === button.dataset.vttEditObject)), { signal }));
    root.querySelectorAll("[data-vtt-edit-annotation]").forEach(button => button.addEventListener("click", () => openAnnotationEditor(ctx, (scene.annotations || []).find(annotation => annotation.id === button.dataset.vttEditAnnotation)), { signal }));
    root.querySelectorAll("[data-vtt-duplicate-selected],[data-vtt-group-duplicate]").forEach(button => button.addEventListener("click", () => duplicateRefs(root, ctx, getSelection(room)), { signal }));
    root.querySelectorAll("[data-vtt-remove-selected],[data-vtt-group-remove]").forEach(button => button.addEventListener("click", () => removeRefs(root, ctx, getSelection(room)), { signal }));
    root.querySelectorAll("[data-vtt-align]").forEach(button => button.addEventListener("click", () => alignRefs(ctx, button.dataset.vttAlign), { signal }));
  }

  async function duplicateRefs(root, ctx, refs) {
    if (!refs?.length || ctx.room.dmId !== ctx.clientId) return;
    const response = await emit(ctx, "scene:items-duplicate", { refs, offsetX:1, offsetY:1 }, "Копия создана");
    if (response.ok && response.created) setSelection(ctx.room, response.created);
  }

  async function removeRefs(root, ctx, refs) {
    if (!refs?.length || ctx.room.dmId !== ctx.clientId) return;
    if (!confirm(`Удалить выбранные объекты: ${refs.length}?`)) return;
    const response = await emit(ctx, "scene:items-remove", { refs }, "Удалено");
    if (response.ok) setSelection(ctx.room, []);
  }

  function alignRefs(ctx, mode) {
    const entries=selectedEntries(ctx.room); if(entries.length<2||ctx.room.dmId!==ctx.clientId)return;
    const bounds=entries.map(entry=>({entry,bounds:boundsForEntry(entry)}));
    const group={left:Math.min(...bounds.map(i=>i.bounds.left)),top:Math.min(...bounds.map(i=>i.bounds.top)),right:Math.max(...bounds.map(i=>i.bounds.right)),bottom:Math.max(...bounds.map(i=>i.bounds.bottom))};
    let ordered=bounds;
    if(mode==="distribute-h") ordered=[...bounds].sort((a,b)=>a.bounds.left-b.bounds.left);
    if(mode==="distribute-v") ordered=[...bounds].sort((a,b)=>a.bounds.top-b.bounds.top);
    const moves=ordered.map((item,index)=>{let dx=0,dy=0;
      if(mode==="left")dx=group.left-item.bounds.left;if(mode==="right")dx=group.right-item.bounds.right;if(mode==="h-center")dx=(group.left+group.right)/2-(item.bounds.left+item.bounds.right)/2;
      if(mode==="top")dy=group.top-item.bounds.top;if(mode==="bottom")dy=group.bottom-item.bounds.bottom;if(mode==="v-center")dy=(group.top+group.bottom)/2-(item.bounds.top+item.bounds.bottom)/2;
      if(mode==="distribute-h"&&ordered.length>2){const target=group.left+(group.right-group.left)*index/(ordered.length-1);dx=target-item.bounds.left;}
      if(mode==="distribute-v"&&ordered.length>2){const target=group.top+(group.bottom-group.top)*index/(ordered.length-1);dy=target-item.bounds.top;}
      return {kind:item.entry.kind,id:item.entry.value.id,dx,dy};});
    emit(ctx,"scene:items-transform",{moves},mode.startsWith("distribute")?"Объекты распределены":"Объекты выровнены");
  }

  function openGroupTokenEditor(ctx, tokenIds) {
    const ids=[...new Set((tokenIds||[]).filter(Boolean))]; if(!ids.length||ctx.room.dmId!==ctx.clientId)return;
    ctx.openModal("Параметры группы",`<div class="vtt-modal-form"><p class="read-only">Изменятся только заполненные поля. Выбрано токенов: ${ids.length}.</p><div class="three-col"><label>Инициатива<input id="vtt-group-initiative" type="number" placeholder="—"></label><label>HP<input id="vtt-group-hp" type="number" min="0" placeholder="—"></label><label>Макс. HP<input id="vtt-group-hp-max" type="number" min="1" placeholder="—"></label></div><div class="three-col"><label>Размер<input id="vtt-group-size" type="number" min=".25" max="12" step=".25" placeholder="—"></label><label>Прозрачность<input id="vtt-group-opacity" type="number" min=".05" max="1" step=".05" placeholder="—"></label><label>Поворот<input id="vtt-group-rotation" type="number" placeholder="—"></label></div><div class="three-col"><label>Зрение<input id="vtt-group-vision" type="number" min="0" placeholder="—"></label><label>Цвет рамки<input id="vtt-group-color" type="color" value="#9f7842"></label><label class="condition-chip"><input id="vtt-group-color-enable" type="checkbox">Применить цвет</label></div><div class="two-col"><label>Видимость<select id="vtt-group-hidden"><option value="keep">Не менять</option><option value="show">Показать</option><option value="hide">Скрыть</option></select></label><label>Блокировка<select id="vtt-group-locked"><option value="keep">Не менять</option><option value="unlock">Разблокировать</option><option value="lock">Заблокировать</option></select></label></div><div class="modal-actions"><button id="vtt-group-apply" class="primary">Применить</button><button id="vtt-group-roll">Бросить инициативу</button><button id="vtt-group-clear-init">Убрать инициативу</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    const read=id=>{const el=document.querySelector(id);return el&&String(el.value).trim()!==""?Number(el.value):undefined;};
    document.querySelector("#vtt-group-apply")?.addEventListener("click",async()=>{const patch={};for(const [key,id] of [["initiative","#vtt-group-initiative"],["hp","#vtt-group-hp"],["hpMax","#vtt-group-hp-max"],["size","#vtt-group-size"],["opacity","#vtt-group-opacity"],["rotation","#vtt-group-rotation"],["vision","#vtt-group-vision"]]){const value=read(id);if(value!==undefined)patch[key]=value;}if(document.querySelector("#vtt-group-color-enable")?.checked)patch.color=document.querySelector("#vtt-group-color").value;const hidden=document.querySelector("#vtt-group-hidden").value;if(hidden!=="keep")patch.hidden=hidden==="hide";const locked=document.querySelector("#vtt-group-locked").value;if(locked!=="keep")patch.locked=locked==="lock";await emit(ctx,"scene:tokens-batch-update",{tokenIds:ids,patch},`Обновлено: ${ids.length}`);ctx.closeModal();});
    document.querySelector("#vtt-group-roll")?.addEventListener("click",async()=>{await emit(ctx,"scene:tokens-batch-update",{tokenIds:ids,rollInitiative:true});ctx.closeModal();});document.querySelector("#vtt-group-clear-init")?.addEventListener("click",async()=>{await emit(ctx,"scene:tokens-batch-update",{tokenIds:ids,clearInitiative:true});ctx.closeModal();});document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function openSceneCreate(ctx) {
    ctx.openModal("Новая сцена", `<div class="vtt-modal-form"><label>Название<input id="vtt-new-scene-name" value="Новая сцена"></label><label class="toggle-row"><span><strong>Сразу показать игрокам</strong><small>Сделает сцену активной</small></span><input id="vtt-new-scene-active" type="checkbox" checked><i></i></label><div class="modal-actions"><button id="vtt-new-scene-save" class="primary">Создать</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-new-scene-save")?.addEventListener("click", () => { emit(ctx, "scene:create", { name:document.querySelector("#vtt-new-scene-name").value, activate:document.querySelector("#vtt-new-scene-active").checked }, "Сцена создана"); ctx.closeModal(); });
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  function openSceneSettings(ctx) {
    const scene=ctx.room.scene,grid=scene.grid||{};
    ctx.openModal("Настройки сцены",`<div class="vtt-modal-form"><label>Название<input id="vtt-scene-name" value="${esc(scene.name)}"></label><div class="two-col"><label>Папка<input id="vtt-scene-folder" value="${esc(scene.folder||"")}" placeholder="Например: Подземелье"></label><label>Теги<input id="vtt-scene-tags" value="${esc((scene.tags||[]).join(", "))}"></label></div><div class="two-col"><label>Цвет поля<input id="vtt-scene-color" type="color" value="${esc(scene.backgroundColor||"#17120e")}"></label><label>Размер клетки<input id="vtt-scene-cell" type="number" min="20" max="160" value="${Number(grid.cellSize||52)}"></label></div><div class="two-col"><label>Тип сетки<select id="vtt-grid-type"><option value="square" ${grid.type==="square"?"selected":""}>Квадратная</option><option value="hex-row" ${grid.type==="hex-row"?"selected":""}>Гексы горизонтальные</option><option value="hex-column" ${grid.type==="hex-column"?"selected":""}>Гексы вертикальные</option><option value="isometric" ${grid.type==="isometric"?"selected":""}>Изометрическая</option></select></label><label>Прозрачность<input id="vtt-grid-opacity" type="number" min=".03" max="1" step=".01" value="${Number(grid.opacity||.22)}"></label></div><div class="item-toggle-grid"><label class="toggle-row"><span><strong>Показывать сетку</strong></span><input id="vtt-grid-visible" type="checkbox" ${grid.visible!==false?"checked":""}><i></i></label><label class="toggle-row"><span><strong>Привязка</strong></span><input id="vtt-grid-snap" type="checkbox" ${grid.snap!==false?"checked":""}><i></i></label></div><div class="modal-actions"><button id="vtt-scene-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-scene-save")?.addEventListener("click",async()=>{await emit(ctx,"scene:rename",{sceneId:scene.id,name:document.querySelector("#vtt-scene-name").value,folder:document.querySelector("#vtt-scene-folder").value,tags:document.querySelector("#vtt-scene-tags").value.split(",").map(v=>v.trim()).filter(Boolean)});await emit(ctx,"scene:settings",{backgroundColor:document.querySelector("#vtt-scene-color").value,grid:{cellSize:Number(document.querySelector("#vtt-scene-cell").value),type:document.querySelector("#vtt-grid-type").value,opacity:Number(document.querySelector("#vtt-grid-opacity").value),visible:document.querySelector("#vtt-grid-visible").checked,snap:document.querySelector("#vtt-grid-snap").checked}},"Сцена обновлена");ctx.closeModal();});document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function npcEditorRow(kind,entry={}) {
    const id=esc(entry.id||crypto.randomUUID());
    const visible=entry.public?"checked":"";
    if(kind==="attack")return `<article class="vtt-npc-editor-row attack" data-npc-row data-kind="attack" data-id="${id}"><input data-npc-name value="${esc(entry.name||"Новая атака")}" placeholder="Название"><input data-npc-attack value="${esc(entry.attackFormula||"1d20+0")}" placeholder="Атака: 1d20+4"><input data-npc-damage value="${esc(entry.damageFormula||"1d6+2")}" placeholder="Урон: 1d6+2"><input data-npc-damage-type value="${esc(entry.damageType||"")}" placeholder="Тип урона"><label title="Показывать игрокам"><input data-npc-public type="checkbox" ${visible}>🌐</label><button type="button" data-npc-remove>×</button></article>`;
    return `<article class="vtt-npc-editor-row" data-npc-row data-kind="${kind}" data-id="${id}"><input data-npc-name value="${esc(entry.name||({save:"Новый спасбросок",check:"Новая проверка",formula:"Новая формула"})[kind]||"Формула")}" placeholder="Название"><input data-npc-formula value="${esc(entry.formula||"1d20+0")}" placeholder="Формула"><label title="Показывать игрокам"><input data-npc-public type="checkbox" ${visible}>🌐</label><button type="button" data-npc-remove>×</button></article>`;
  }

  function openAttachmentPicker(ctx,ref) {
    const scene=ctx.room.scene, child=resolveRef(scene,ref)?.value;
    if (!child) return;
    const options=[...(scene.tokens||[]).map(item=>({kind:"token",id:item.id,name:item.name,type:item.playerId?"Персонаж":"NPC"})),...(scene.objects||[]).map(item=>({kind:"object",id:item.id,name:item.name,type:item.type==="map"?"Карта":"Объект"}))].filter(item=>!(item.kind===ref.kind&&item.id===ref.id));
    ctx.openModal("Прикрепить элемент",`<p class="read-only">«${esc(child.name||"Элемент") }» будет двигаться и поворачиваться вместе с выбранным родителем.</p><input id="vtt-attach-search" placeholder="Поиск токена или объекта"><div class="vtt-attach-list">${options.map(item=>`<button type="button" data-vtt-attach-parent="${esc(item.kind)}:${esc(item.id)}" data-search="${esc(`${item.name} ${item.type}`.toLowerCase())}"><span>${item.kind==="token"?"●":"◆"}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.type)}</small></div></button>`).join("")||`<div class="read-only">На сцене нет подходящих родителей.</div>`}</div><button id="vtt-attach-cancel" class="secondary">Отмена</button>`);
    const filter=()=>{const query=String(document.querySelector("#vtt-attach-search")?.value||"").toLowerCase();document.querySelectorAll("[data-vtt-attach-parent]").forEach(button=>button.hidden=Boolean(query&&!button.dataset.search.includes(query)));};
    document.querySelector("#vtt-attach-search")?.addEventListener("input",filter);
    document.querySelectorAll("[data-vtt-attach-parent]").forEach(button=>button.addEventListener("click",async()=>{const split=button.dataset.vttAttachParent.indexOf(":"),parentKind=button.dataset.vttAttachParent.slice(0,split),parentId=button.dataset.vttAttachParent.slice(split+1);const response=await emit(ctx,"scene:item-attach",{childKind:ref.kind,childId:ref.id,parentKind,parentId},"Элемент прикреплён");if(response.ok)ctx.closeModal();}));
    document.querySelector("#vtt-attach-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function openNpcSheetEditor(ctx,token) {
    if(!token||token.playerId||ctx.room.dmId!==ctx.clientId)return;
    const sheet=token.npcSheet||{stats:{},saves:[],checks:[],attacks:[],formulas:[]};
    const stats=Object.entries(NPC_ABILITY_LABELS).map(([key,label])=>{const entry=sheet.stats?.[key]||{value:10,public:false};return `<label class="vtt-npc-stat-edit"><span>${label}</span><input data-npc-stat="${key}" type="number" min="1" max="30" value="${Number(entry.value||10)}"><label title="Показывать игрокам"><input data-npc-stat-public="${key}" type="checkbox" ${entry.public?"checked":""}>🌐</label></label>`;}).join("");
    const section=(kind,title,items)=>`<section class="vtt-npc-editor-section"><div class="panel-heading"><h3>${title}</h3><button type="button" data-npc-add="${kind}">＋ Добавить</button></div><div data-npc-list="${kind}">${(items||[]).map(entry=>npcEditorRow(kind,entry)).join("")}</div></section>`;
    ctx.openModal(`Лист NPC · ${token.name}`,`<div class="vtt-modal-form vtt-npc-editor"><p class="read-only">🌐 — данные увидят игроки. Без отметки поля и формулы остаются только у ведущего, а броски выполняются в закрытую.</p><section class="vtt-npc-editor-section"><div class="panel-heading"><h3>Характеристики</h3><small>клик по стату бросает 1d20 + модификатор</small></div><div class="vtt-npc-stat-editor">${stats}</div></section>${section("save","Спасброски",sheet.saves)}${section("check","Проверки и навыки",sheet.checks)}${section("attack","Оружие, атака и урон",sheet.attacks)}${section("formula","Свои формулы",sheet.formulas)}<div class="modal-actions"><button id="vtt-npc-save" class="primary">Сохранить NPC</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    const bindRows=()=>{document.querySelectorAll("[data-npc-remove]").forEach(button=>button.onclick=()=>button.closest("[data-npc-row]")?.remove());};bindRows();
    document.querySelectorAll("[data-npc-add]").forEach(button=>button.addEventListener("click",()=>{const kind=button.dataset.npcAdd;document.querySelector(`[data-npc-list="${kind}"]`)?.insertAdjacentHTML("beforeend",npcEditorRow(kind));bindRows();}));
    document.querySelector("#vtt-npc-save")?.addEventListener("click",async()=>{const stats=Object.fromEntries(Object.keys(NPC_ABILITY_LABELS).map(key=>[key,{value:Number(document.querySelector(`[data-npc-stat="${key}"]`)?.value)||10,public:Boolean(document.querySelector(`[data-npc-stat-public="${key}"]`)?.checked)}]));const lists={saves:[],checks:[],attacks:[],formulas:[]};document.querySelectorAll("[data-npc-row]").forEach(row=>{const kind=row.dataset.kind;const base={id:row.dataset.id,name:row.querySelector("[data-npc-name]")?.value,public:Boolean(row.querySelector("[data-npc-public]")?.checked)};if(kind==="attack")lists.attacks.push({...base,attackFormula:row.querySelector("[data-npc-attack]")?.value,damageFormula:row.querySelector("[data-npc-damage]")?.value,damageType:row.querySelector("[data-npc-damage-type]")?.value});else lists[kind==="save"?"saves":kind==="check"?"checks":"formulas"].push({...base,formula:row.querySelector("[data-npc-formula]")?.value});});await emit(ctx,"scene:token-update",{tokenId:token.id,npcSheet:{stats,...lists}},"Лист NPC сохранён");ctx.closeModal();});
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function openTokenEditor(ctx, token) {
    if (!token) return;
    const isDm = ctx.room.dmId === ctx.clientId;
    const canControl = isDm || token.playerId === ctx.clientId;
    if (!canControl) return ctx.toast("Можно менять только свой токен");
    const npc = !token.playerId;
    const hpMax = Math.max(1, Number(token.hpMax) || 1);
    const hp = Math.max(0, Math.min(hpMax, Number(token.hp) || 0));
    const tempHp = Math.max(0, Number(token.tempHp) || 0);
    const npcFields = npc ? `<label>Имя<input id="vtt-token-name" value="${esc(token.name)}"></label><div class="two-col"><label>Цвет рамки<input id="vtt-token-color" type="color" value="${esc(token.color || "#9f7842")}"></label><label>Размер<input id="vtt-token-size" type="number" min="0.25" max="12" step="0.25" value="${Number(token.size || 1)}"></label></div><div class="three-col"><label>КД<input id="vtt-token-ac" type="number" min="0" max="1000" value="${Math.max(0,Number(token.ac)||0)}"></label><label>Зрение<input id="vtt-token-vision" type="number" min="0" value="${Number(token.vision || 0)}"></label><label>Бонус инициативы<input id="vtt-token-init" type="number" value="${Number(token.initiativeBonus || 0)}"></label></div><div class="two-col"><label>Отношение<select id="vtt-token-disposition"><option value="friendly" ${token.disposition==="friendly"?"selected":""}>Союзник</option><option value="neutral" ${token.disposition==="neutral"?"selected":""}>Нейтральный</option><option value="hostile" ${token.disposition==="hostile"?"selected":""}>Противник</option></select></label><label>Прозрачность<input id="vtt-token-opacity" type="number" min="0.05" max="1" step="0.05" value="${Number(token.opacity || 1)}"></label></div><label>Поворот<input id="vtt-token-rotation" type="number" value="${Number(token.rotation || 0)}"></label>` : `<div class="read-only">Изображение связано с обликом персонажа. HP меняются здесь и сохраняются в лист; остальные характеристики редактируются в полном листе.</div>`;
    ctx.openModal("Настройки токена", `<div class="vtt-modal-form">${npcFields}<div class="three-col"><label>HP<input id="vtt-token-hp" type="number" min="0" value="${hp}"></label><label>Макс. HP<input id="vtt-token-hp-max" type="number" min="1" value="${hpMax}"></label><label>Врем. HP<input id="vtt-token-temp" type="number" min="0" value="${tempHp}"></label></div><div class="two-col"><label>Метка над токеном<input id="vtt-token-badge" maxlength="32" value="${esc(token.badge || "")}" placeholder="Напр. Скрыт, Горит, +2 КД"></label><label>Цвет метки<input id="vtt-token-badge-color" type="color" value="${esc(token.badgeColor || "#f4c875")}"></label></div><div class="item-toggle-grid token-display-toggles"><label class="toggle-row"><span><strong>Имя</strong><small>Компактная подпись над токеном</small></span><input id="vtt-token-show-name" type="checkbox" ${token.showName !== false ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>HP</strong><small>Полоска здоровья под токеном</small></span><input id="vtt-token-show-hp" type="checkbox" ${token.showHp !== false ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>КД</strong><small>Небольшой значок класса доспеха</small></span><input id="vtt-token-show-ac" type="checkbox" ${token.showAc ? "checked" : ""}><i></i></label></div>${isDm ? `<div class="item-toggle-grid"><label class="toggle-row"><span><strong>Скрытый</strong><small>Не передаётся игрокам</small></span><input id="vtt-token-hidden" type="checkbox" ${token.hidden ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Заблокирован</strong><small>Не двигается случайно</small></span><input id="vtt-token-locked" type="checkbox" ${token.locked ? "checked" : ""}><i></i></label></div>` : ""}<div class="modal-actions"><button id="vtt-token-save" class="primary">Сохранить</button>${npc&&isDm?`<button id="vtt-token-npc-sheet">Лист NPC</button>`:""}<button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-token-save")?.addEventListener("click", async () => {
      const hpPayload={ tokenId:token.id, hp:Number(document.querySelector("#vtt-token-hp")?.value), hpMax:Number(document.querySelector("#vtt-token-hp-max")?.value), tempHp:Number(document.querySelector("#vtt-token-temp")?.value) };
      const common={ tokenId:token.id, badge:document.querySelector("#vtt-token-badge")?.value, badgeColor:document.querySelector("#vtt-token-badge-color")?.value, showName:document.querySelector("#vtt-token-show-name")?.checked, showHp:document.querySelector("#vtt-token-show-hp")?.checked, showAc:document.querySelector("#vtt-token-show-ac")?.checked, hidden:document.querySelector("#vtt-token-hidden")?.checked, locked:document.querySelector("#vtt-token-locked")?.checked };
      if (npc) {
        const response=await emit(ctx,"scene:token-update",{...common,...hpPayload,name:document.querySelector("#vtt-token-name")?.value,color:document.querySelector("#vtt-token-color")?.value,size:Number(document.querySelector("#vtt-token-size")?.value),rotation:Number(document.querySelector("#vtt-token-rotation")?.value),opacity:Number(document.querySelector("#vtt-token-opacity")?.value),vision:Number(document.querySelector("#vtt-token-vision")?.value),initiativeBonus:Number(document.querySelector("#vtt-token-init")?.value),ac:Number(document.querySelector("#vtt-token-ac")?.value),disposition:document.querySelector("#vtt-token-disposition")?.value},"Токен обновлён");
        if (!response.ok) return;
      } else {
        const hpResponse=await emit(ctx,"scene:token-hp",hpPayload);
        if (!hpResponse.ok) return;
        const visualResponse=await emit(ctx,"scene:token-update",common,"Токен обновлён");
        if (!visualResponse.ok) return;
      }
      ctx.closeModal();
    });
    document.querySelector("#vtt-token-npc-sheet")?.addEventListener("click",()=>{ctx.closeModal();openNpcSheetEditor(ctx,token);});
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  function openObjectEditor(ctx, object) {
    if (!object) return;
    ctx.openModal("Настройки объекта", `<div class="vtt-modal-form"><label>Название<input id="vtt-object-name" value="${esc(object.name)}"></label><div class="two-col"><label>Ширина, клеток<input id="vtt-object-width" type="number" min="0.25" max="200" step="0.25" value="${Number(object.width)}"></label><label>Высота, клеток<input id="vtt-object-height" type="number" min="0.25" max="200" step="0.25" value="${Number(object.height)}"></label></div><div class="two-col"><label>Поворот<input id="vtt-object-rotation" type="number" value="${Number(object.rotation || 0)}"></label><label>Прозрачность<input id="vtt-object-opacity" type="number" min="0.03" max="1" step="0.05" value="${Number(object.opacity || 1)}"></label></div><label>Слой<input id="vtt-object-z" type="number" min="-1000" max="1000" value="${Number(object.z || 0)}"></label><div class="item-toggle-grid"><label class="toggle-row"><span><strong>Скрытый</strong><small>Виден только ведущему</small></span><input id="vtt-object-hidden" type="checkbox" ${object.hidden ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Заблокирован</strong><small>Защита от случайного движения</small></span><input id="vtt-object-locked" type="checkbox" ${object.locked ? "checked" : ""}><i></i></label></div><div class="modal-actions"><button id="vtt-object-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-object-save")?.addEventListener("click", () => { emit(ctx, "scene:object-update", { objectId:object.id, name:document.querySelector("#vtt-object-name").value, width:Number(document.querySelector("#vtt-object-width").value), height:Number(document.querySelector("#vtt-object-height").value), rotation:Number(document.querySelector("#vtt-object-rotation").value), opacity:Number(document.querySelector("#vtt-object-opacity").value), z:Number(document.querySelector("#vtt-object-z").value), hidden:document.querySelector("#vtt-object-hidden").checked, locked:document.querySelector("#vtt-object-locked").checked }, "Объект обновлён"); ctx.closeModal(); });
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  function openAnnotationEditor(ctx, annotation) {
    if (!annotation) return;
    const isDm = ctx.room.dmId === ctx.clientId;
    if (!isDm && annotation.ownerId !== ctx.clientId) return ctx.toast("Можно менять только свои рисунки");
    ctx.openModal("Настройки рисунка", `<div class="vtt-modal-form">${annotation.kind === "text" ? `<label>Текст<textarea id="vtt-annotation-text">${esc(annotation.text || "")}</textarea></label>` : ""}<div class="two-col"><label>Цвет<input id="vtt-annotation-color" type="color" value="${esc(annotation.color || "#f4c875")}"></label><label>Заливка<input id="vtt-annotation-fill" type="color" value="${esc(annotation.fill || "#b94b42")}"></label></div><div class="two-col"><label>Толщина<input id="vtt-annotation-width" type="number" min="1" max="20" value="${Number(annotation.strokeWidth || 3)}"></label><label>Прозрачность<input id="vtt-annotation-opacity" type="number" min="0.05" max="1" step="0.05" value="${Number(annotation.opacity || 1)}"></label></div><label>Слой<input id="vtt-annotation-z" type="number" min="-1000" max="1000" value="${Number(annotation.z || 50)}"></label><div class="item-toggle-grid"><label class="toggle-row"><span><strong>Скрытый</strong><small>Виден только ведущему</small></span><input id="vtt-annotation-hidden" type="checkbox" ${annotation.hidden ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Заблокирован</strong><small>Не двигается случайно</small></span><input id="vtt-annotation-locked" type="checkbox" ${annotation.locked ? "checked" : ""}><i></i></label></div><div class="modal-actions"><button id="vtt-annotation-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-annotation-save")?.addEventListener("click", () => { emit(ctx, "scene:annotation-update", { annotationId:annotation.id, text:document.querySelector("#vtt-annotation-text")?.value, color:document.querySelector("#vtt-annotation-color").value, fill:document.querySelector("#vtt-annotation-fill").value, strokeWidth:Number(document.querySelector("#vtt-annotation-width").value), opacity:Number(document.querySelector("#vtt-annotation-opacity").value), z:Number(document.querySelector("#vtt-annotation-z").value), hidden:document.querySelector("#vtt-annotation-hidden").checked, locked:document.querySelector("#vtt-annotation-locked").checked }, "Рисунок обновлён"); ctx.closeModal(); });
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  function openAssetEditor(ctx, asset) {
    if (!asset) return;
    const folders=libraryFolderNames(ctx.room),currentFolder=String(asset.folder||""),folderKnown=folders.includes(currentFolder),folderMode=!currentFolder?"":folderKnown?currentFolder:"__new__";
    const options=folders.map(folder=>`<option value="${esc(folder)}" ${folderMode===folder?"selected":""}>${esc(folder)}</option>`).join("");
    ctx.openModal("Ресурс библиотеки", `<div class="vtt-modal-form"><div class="vtt-asset-large"><img src="${esc(asset.url)}" alt=""></div><label>Название<input id="vtt-asset-name" value="${esc(asset.name)}"></label><div class="two-col"><label>Категория<select id="vtt-asset-category"><option value="token" ${asset.category === "token" ? "selected" : ""}>Токен</option><option value="map" ${asset.category === "map" ? "selected" : ""}>Карта</option><option value="prop" ${asset.category === "prop" ? "selected" : ""}>Объект</option><option value="source" ${asset.category === "source" ? "selected" : ""}>Исходник Кузницы</option></select></label><label>Размер по умолчанию<input id="vtt-asset-size" type="number" min="0.25" max="30" step="0.25" value="${Number(asset.defaultSize || 1)}"></label></div><div class="two-col"><label>Папка<select id="vtt-asset-folder-edit"><option value="" ${folderMode===""?"selected":""}>Без папки</option>${options}<option value="__new__" ${folderMode==="__new__"?"selected":""}>＋ Создать новую…</option></select><input id="vtt-asset-folder-new" value="${folderMode==="__new__"?esc(currentFolder):""}" placeholder="Название новой папки" ${folderMode==="__new__"?"":"hidden"}></label><label>Теги через запятую<input id="vtt-asset-tags" value="${esc((asset.tags || []).join(", "))}"></label></div><div class="modal-actions"><button id="vtt-asset-save" class="primary">Сохранить</button><button id="vtt-asset-delete" class="danger-action">Удалить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    const folderSelect=document.querySelector("#vtt-asset-folder-edit"),folderNew=document.querySelector("#vtt-asset-folder-new");
    folderSelect?.addEventListener("change",()=>{folderNew.hidden=folderSelect.value!=="__new__";if(!folderNew.hidden)folderNew.focus();});
    document.querySelector("#vtt-asset-save")?.addEventListener("click", async () => {
      const folder=folderSelect?.value==="__new__"?String(folderNew?.value||"").trim():String(folderSelect?.value||"");
      if(folderSelect?.value==="__new__"&&!folder)return ctx.toast("Укажи название новой папки");
      if(folder)customAssetFolders.add(folder);
      const response = await fetch(`/api/rooms/${ctx.room.code}/assets/${asset.id}`, { method:"PATCH", headers:{ "content-type":"application/json", "x-client-id":ctx.clientId }, body:JSON.stringify({ name:document.querySelector("#vtt-asset-name").value, category:document.querySelector("#vtt-asset-category").value, defaultSize:Number(document.querySelector("#vtt-asset-size").value), folder, tags:document.querySelector("#vtt-asset-tags").value.split(",").map(value => value.trim()).filter(Boolean) }) }).then(response => response.json()).catch(() => ({ ok:false, error:"Сеть недоступна" }));
      if (!response.ok) ctx.toast(response.error); else { ctx.toast("Ресурс обновлён"); ctx.closeModal(); }
    });
    document.querySelector("#vtt-asset-delete")?.addEventListener("click", async () => {
      if (!confirm(`Удалить «${asset.name}» из библиотеки?`)) return;
      const url = `/api/rooms/${ctx.room.code}/assets/${asset.id}`;
      let response = await fetch(url, { method:"DELETE", headers:{ "x-client-id":ctx.clientId } }).then(result => result.json());
      if (!response.ok && response.usageCount && confirm(`${response.error}. Удалить также все экземпляры со сцен?`)) response = await fetch(`${url}?force=1`, { method:"DELETE", headers:{ "x-client-id":ctx.clientId } }).then(result => result.json());
      if (!response.ok) ctx.toast(response.error); else { ctx.toast("Ресурс удалён"); ctx.closeModal(); }
    });
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  async function uploadAsset(ctx, file, category) {
    if (!file.type.match(/^image\/(png|jpeg|webp|gif)$/)) return ctx.toast(`${file.name}: неподдерживаемый формат`);
    if (file.size > 15 * 1024 * 1024) return ctx.toast(`${file.name}: больше 15 МБ`);
    ctx.toast(`Загрузка: ${file.name}`);
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const dimensions = await new Promise(resolve => { const image = new Image(); image.onload = () => resolve({ width:image.naturalWidth, height:image.naturalHeight }); image.onerror = () => resolve({ width:0, height:0 }); image.src = dataUrl; });
    const response = await fetch(`/api/rooms/${ctx.room.code}/assets`, { method:"POST", headers:{ "content-type":"application/json", "x-client-id":ctx.clientId }, body:JSON.stringify({ name:file.name.replace(/\.[^.]+$/, ""), fileName:file.name, category, dataUrl, width:dimensions.width, height:dimensions.height, defaultSize:category === "map" ? 20 : 1, folder:assetFolder === "all" ? "" : assetFolder }) }).then(result => result.json()).catch(() => ({ ok:false, error:"Не удалось загрузить файл" }));
    if (!response.ok) ctx.toast(response.error); else ctx.toast(response.duplicate ? "Такой ресурс уже есть" : "Ресурс сохранён в библиотеке");
  }

  function openQuickSheetSettings(ctx, character) {
    if(!character)return;const prefs=character.quickSheet||{};const sections=["overview","combat","checks","spells","notes"];
    const choices=(items,pinned,key,label)=>items.map(item=>`<label class="condition-chip"><input type="checkbox" data-vtt-pin-${key}="${esc(item.id||item.key)}" ${(pinned||[]).includes(item.id||item.key)?"checked":""}>${esc(item.name)}</label>`).join("");
    ctx.openModal("Быстрый лист",`<div class="vtt-modal-form"><h3>Разделы</h3><div class="vtt-quick-settings">${sections.map(section=>`<label class="condition-chip"><input type="checkbox" data-vtt-section="${section}" ${(prefs.sections||[]).includes(section)?"checked":""}>${({overview:"Обзор",combat:"Бой",checks:"Проверки",spells:"Магия",notes:"Заметки"})[section]}</label>`).join("")}</div><h3>Любимые спасброски</h3><div class="vtt-quick-settings">${choices(character.saves||[],prefs.pinnedSaves,"save")}</div><h3>Любимые навыки</h3><div class="vtt-quick-settings">${choices(character.skills||[],prefs.pinnedSkills,"skill")}</div><h3>Атаки и заклинания</h3><div class="vtt-quick-settings">${choices(character.attacks||[],prefs.pinnedAttacks,"attack")}${choices(character.spells||[],prefs.pinnedSpells,"spell")}</div><div class="modal-actions"><button id="vtt-quick-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-quick-save")?.addEventListener("click",async()=>{const quickSheet={sections:[...document.querySelectorAll("[data-vtt-section]:checked")].map(input=>input.dataset.vttSection),pinnedSkills:[...document.querySelectorAll("[data-vtt-pin-skill]:checked")].map(input=>input.dataset.vttPinSkill),pinnedSaves:[...document.querySelectorAll("[data-vtt-pin-save]:checked")].map(input=>input.dataset.vttPinSave),pinnedAttacks:[...document.querySelectorAll("[data-vtt-pin-attack]:checked")].map(input=>input.dataset.vttPinAttack),pinnedSpells:[...document.querySelectorAll("[data-vtt-pin-spell]:checked")].map(input=>input.dataset.vttPinSpell)};await ctx.actions?.savePreferences?.({quickSheet});ctx.closeModal();});document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  async function openDiagnostics(ctx) {
    const response=await emit(ctx,"room:diagnostics");if(!response.ok)return;const d=response.diagnostics||{},dice=window.TT_DICE_PHYSICS?.status?.()||{};
    ctx.openModal("Диагностика стола",`<div class="vtt-diagnostics"><article><small>Комната</small><strong>${Math.round(Number(d.roomBytes||0)/1024)} КБ</strong><span>${d.players} игроков · ${d.online} онлайн</span></article><article><small>Сцены</small><strong>${d.scenes}</strong><span>${d.encounters} групп противников</span></article><article><small>Ресурсы</small><strong>${d.assets}</strong><span>${(Number(d.assetBytes||0)/1024/1024).toFixed(1)} МБ</span></article><article><small>3D-кубики</small><strong>${dice.healthy||0}/${dice.slots||0}</strong><span>${esc(dice.lastError||"контексты в норме")}</span></article></div><div class="two-col"><label>Качество кубиков<select id="vtt-dice-quality"><option value="low" ${dice.quality==="low"?"selected":""}>Низкое</option><option value="medium" ${dice.quality==="medium"?"selected":""}>Среднее</option><option value="high" ${dice.quality==="high"?"selected":""}>Высокое</option></select></label><label>Материал<select id="vtt-dice-material"><option value="none" ${dice.material==="none"?"selected":""}>Матовый пластик</option><option value="metal" ${dice.material==="metal"?"selected":""}>Металл</option><option value="wood" ${dice.material==="wood"?"selected":""}>Дерево</option><option value="glass" ${dice.material==="glass"?"selected":""}>Стекло</option></select></label></div><div class="modal-actions"><button id="vtt-dice-restart">Перезапустить кубики</button><button id="vtt-auto-restore" ${d.backupAvailable?"":"disabled"}>Восстановить автокопию</button><button id="vtt-modal-cancel">Закрыть</button></div>`);
    document.querySelector("#vtt-dice-quality")?.addEventListener("change",event=>window.TT_DICE_PHYSICS?.setQuality?.(event.target.value));document.querySelector("#vtt-dice-material")?.addEventListener("change",event=>window.TT_DICE_PHYSICS?.setMaterial?.(event.target.value));document.querySelector("#vtt-dice-restart")?.addEventListener("click",()=>window.TT_DICE_PHYSICS?.recover?.());document.querySelector("#vtt-auto-restore")?.addEventListener("click",()=>{if(confirm("Восстановить последнюю автоматическую копию комнаты?"))emit(ctx,"room:restore-auto-backup").then(result=>result.ok&&ctx.closeModal());});document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function deactivate() {
    active = false;
    spaceHeld = false;
    currentCameraCenterGrid = () => ({ x:0, y:0 });
    if (controller) controller.abort();
    controller = null;
    window.TT_DICE_PHYSICS?.deactivate();
  }

  window.TT_VTT = { render, deactivate, cameraCenterGrid };
})();
