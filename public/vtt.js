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
  const rollSeenByRoom = new Map();
  const ui = {
    leftPanel: null,
    rightPanel: null,
    tool: "select",
    color: "#f4c875",
    fill: "#b94b42",
    fillOpacity: 0.18,
    strokeWidth: 3,
    rollVisibility: "public"
  };
  let assetFilter = "all";
  let assetSearch = "";
  let clipboard = null;
  let controller = null;
  let spaceHeld = false;
  let active = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const roundTenth = value => Math.round((Number(value) || 0) * 10) / 10;
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const sceneKey = room => `${room.code}:${room.scene?.id || room.activeSceneId || "main"}`;
  const refKey = ref => `${ref.kind}:${ref.id}`;
  const uniqueRefs = refs => [...new Map((refs || []).filter(ref => ref?.kind && ref?.id).map(ref => [refKey(ref), { kind:ref.kind, id:ref.id }])).values()];

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

  function assetCard(asset) {
    const categoryLabel = { token:"Токен", map:"Карта", prop:"Объект" }[asset.category] || "Ресурс";
    return `<article class="vtt-asset-card" draggable="true" data-vtt-asset="${esc(asset.id)}">
      <div class="vtt-asset-preview"><img src="${esc(asset.url)}" alt=""><span>${categoryLabel}</span></div>
      <div class="vtt-asset-info"><strong title="${esc(asset.name)}">${esc(asset.name)}</strong><small>${asset.usageCount ? `На сценах: ${Number(asset.usageCount)}` : "Ещё не размещён"}</small></div>
      <div class="vtt-asset-actions"><button type="button" data-vtt-place="${esc(asset.id)}" title="Поставить в центр">＋</button><button type="button" data-vtt-asset-edit="${esc(asset.id)}" title="Настроить">⋮</button></div>
    </article>`;
  }

  function objectMarkup(object, metrics, selection, isDm) {
    const position = itemPosition(metrics, object.x, object.y, object.width, object.height);
    const movable = isDm && !object.locked;
    return `<button type="button" class="vtt-scene-object ${object.type === "map" ? "is-map" : "is-prop"} ${object.hidden ? "is-hidden" : ""} ${object.locked ? "is-locked" : ""} ${selectionHas(selection, "object", object.id) ? "is-selected" : ""}"
      data-vtt-object="${esc(object.id)}" data-vtt-movable="${movable ? "1" : "0"}"
      style="left:${position.left}px;top:${position.top}px;width:${Number(object.width || 1) * metrics.cell}px;height:${Number(object.height || 1) * metrics.cell}px;--rotation:${Number(object.rotation) || 0}deg;--opacity:${Number(object.opacity) || 1};--z:${Number(object.z) || 0}"
      title="${esc(object.name)}">
      ${object.imageUrl ? `<img src="${esc(object.imageUrl)}" alt="">` : `<span>${esc(object.name)}</span>`}
      <strong>${esc(object.name)}</strong>
    </button>`;
  }

  function tokenMarkup(token, metrics, selection, currentId, isDm, clientId, room, characters = {}) {
    const size = Number(token.size) || 1;
    const position = itemPosition(metrics, token.x, token.y, size, size);
    const movable = isDm || token.playerId === clientId;
    const sheet = token.playerId ? room.players?.[token.playerId]?.sheet : null;
    const character = token.playerId ? characters[token.playerId] : null;
    const hp = Number(character?.hp ?? sheet?.hpCurrent ?? 0);
    const hpMax = Math.max(0, Number(character?.hpMax ?? sheet?.hpMax ?? 0));
    const hpPercent = hpMax ? clamp(hp / hpMax * 100, 0, 100) : 0;
    const ac = Number(character?.ac ?? sheet?.ac ?? 0);
    const initiativeValue = token.initiative !== null && token.initiative !== undefined ? Number(token.initiative) : Number(token.initiativeBonus || 0);
    const initiativeLabel = token.initiative !== null && token.initiative !== undefined ? String(initiativeValue) : `${initiativeValue >= 0 ? "+" : ""}${initiativeValue}`;
    return `<button type="button" class="vtt-token ${token.hidden ? "is-hidden" : ""} ${token.locked ? "is-locked" : ""} ${selectionHas(selection, "token", token.id) ? "is-selected" : ""} ${token.id === currentId ? "is-current" : ""}"
      data-vtt-token="${esc(token.id)}" data-vtt-movable="${movable && (!token.locked || isDm) ? "1" : "0"}"
      style="left:${position.left}px;top:${position.top}px;width:${size * metrics.cell}px;height:${size * metrics.cell}px;--rotation:${Number(token.rotation) || 0}deg;--opacity:${Number(token.opacity) || 1};--z:${Number(token.z) || 100};--color:${esc(token.color || "#9f7842")}"
      title="${esc(token.name)}${sheet ? ` · HP ${hp}/${hpMax} · КД ${ac}` : ""} · Инициатива ${initiativeLabel}">
      <i>${token.imageUrl ? `<img src="${esc(token.imageUrl)}" alt="">` : `<span>${esc((token.name || "?")[0].toUpperCase())}</span>`}</i>
      <strong>${esc(token.name)}</strong>
      ${sheet && hpMax ? `<span class="vtt-token-hp"><i style="width:${hpPercent}%"></i><em>${hp}/${hpMax}</em></span><span class="vtt-token-ac" title="Класс доспеха">${ac}</span>` : ""}
      <b class="vtt-token-initiative ${token.initiative !== null && token.initiative !== undefined ? "rolled" : "bonus"}" title="${token.initiative !== null && token.initiative !== undefined ? "Результат инициативы" : "Бонус инициативы"}">${initiativeLabel}</b>
    </button>`;
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

  function annotationMarkup(annotation, metrics, selection, clientId = "", isDm = false) {
    const { start, end, points } = annotationPoints(annotation, metrics);
    const selected = selectionHas(selection, "annotation", annotation.id);
    const editable = isDm || annotation.ownerId === clientId;
    const common = `class="vtt-annotation-shape ${selected ? "is-selected" : ""} ${editable ? "is-owned" : ""}" data-vtt-annotation="${esc(annotation.id)}" data-vtt-movable="${editable && (!annotation.locked || isDm) ? "1" : "0"}" stroke="${esc(annotation.color || "#f4c875")}" stroke-width="${Number(annotation.strokeWidth || 3)}" opacity="${Number(annotation.opacity || 1)}" vector-effect="non-scaling-stroke"`;
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
      shape = `<text class="vtt-annotation-text ${selected ? "is-selected" : ""} ${editable ? "is-owned" : ""}" data-vtt-annotation="${esc(annotation.id)}" data-vtt-movable="${editable && (!annotation.locked || isDm) ? "1" : "0"}" x="${start.x}" y="${start.y}" fill="${esc(annotation.color || "#f4c875")}" opacity="${Number(annotation.opacity || 1)}">${esc(annotation.text || annotation.name || "Текст")}</text>`;
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
    const cells = Math.hypot(measurement.x2 - measurement.x, measurement.y2 - measurement.y);
    const feet = Math.round(cells * 5 * 10) / 10;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    return `<svg class="vtt-measure-layer" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}" aria-hidden="true"><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/><circle cx="${start.x}" cy="${start.y}" r="5"/><circle cx="${end.x}" cy="${end.y}" r="5"/><g transform="translate(${midX} ${midY})"><rect x="-42" y="-15" width="84" height="30" rx="8"/><text text-anchor="middle" dominant-baseline="central">${feet} фт.</text></g></svg>`;
  }

  function pingMarkup(scene, metrics) {
    if (!scene.ping || Date.now() - Number(scene.ping.at || 0) > 5000) return "";
    const point = metrics.toWorld(scene.ping.x, scene.ping.y);
    return `<div class="vtt-ping" data-vtt-ping-id="${esc(scene.ping.id || scene.ping.at)}" style="left:${point.x}px;top:${point.y}px;--ping-color:${esc(scene.ping.color || "#f4c875")}"><i></i><span></span><strong>${esc(scene.ping.by || "Игрок")}</strong></div>`;
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
    if (!entries.length) return `<div class="vtt-empty-side"><span>◇</span><strong>Ничего не выбрано</strong><p>Инструментом выбора нажми на токен, карту, объект или рисунок.</p></div>`;
    if (entries.length > 1) {
      const allEditable = entries.every(entry => isDm || entry.kind === "annotation" && entry.value.ownerId === clientId);
      return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-object-symbol">${entries.length}</span><div><small>Групповое выделение</small><strong>${entries.length} объектов</strong></div></div>
        ${allEditable ? `<div class="vtt-align-grid"><button data-vtt-align="left" title="По левому краю">⇤</button><button data-vtt-align="h-center" title="По центру горизонтально">↔</button><button data-vtt-align="right" title="По правому краю">⇥</button><button data-vtt-align="top" title="По верхнему краю">⇡</button><button data-vtt-align="v-center" title="По центру вертикально">↕</button><button data-vtt-align="bottom" title="По нижнему краю">⇣</button></div><div class="vtt-inspector-actions"><button data-vtt-group-duplicate>Дублировать</button><button class="danger-action" data-vtt-group-remove>Удалить</button></div>` : `<div class="vtt-empty-mini">Чужие объекты можно выделить, но нельзя изменять.</div>`}</div>`;
    }
    const entry = entries[0];
    const value = entry.value;
    if (entry.kind === "token") {
      const canEdit = isDm || value.playerId === clientId;
      return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-color-dot" style="background:${esc(value.color || "#9f7842")}"></span><div><small>${value.playerId ? "Персонаж" : "Токен"}</small><strong>${esc(value.name)}</strong></div></div>
        <div class="vtt-stat-grid"><span><small>X / Y</small><b>${Number(value.x)} / ${Number(value.y)}</b></span><span><small>Размер</small><b>${Number(value.size)}</b></span><span><small>Зрение</small><b>${Number(value.vision || 0)} фт.</b></span><span><small>Инициатива</small><b>${value.initiative === null || value.initiative === undefined ? `${Number(value.initiativeBonus || 0) >= 0 ? "+" : ""}${Number(value.initiativeBonus || 0)}` : Number(value.initiative)}</b></span></div>
        <div class="vtt-inspector-actions">${canEdit ? `<button type="button" data-vtt-edit-token="${esc(value.id)}">Настроить</button>` : ""}<button type="button" data-vtt-roll="${esc(value.id)}" ${canEdit ? "" : "disabled"}>Инициатива</button>${isDm ? `<button type="button" data-vtt-duplicate-selected>Копировать</button><button class="danger-action" type="button" data-vtt-remove-selected>Удалить</button>` : ""}</div></div>`;
    }
    if (entry.kind === "object") {
      return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-object-symbol">${value.type === "map" ? "▦" : "◆"}</span><div><small>${value.type === "map" ? "Карта" : "Объект"}</small><strong>${esc(value.name)}</strong></div></div>
        <div class="vtt-stat-grid"><span><small>X / Y</small><b>${Number(value.x)} / ${Number(value.y)}</b></span><span><small>Размер</small><b>${Number(value.width)} × ${Number(value.height)}</b></span><span><small>Поворот</small><b>${Number(value.rotation || 0)}°</b></span><span><small>Слой</small><b>${Number(value.z || 0)}</b></span></div>
        ${isDm ? `<div class="vtt-inspector-actions"><button type="button" data-vtt-edit-object="${esc(value.id)}">Настроить</button><button type="button" data-vtt-duplicate-selected>Копировать</button><button class="danger-action" type="button" data-vtt-remove-selected>Удалить</button></div>` : ""}</div>`;
    }
    const canEditAnnotation = isDm || value.ownerId === clientId;
    return `<div class="vtt-inspector-card"><div class="vtt-inspector-title"><span class="vtt-object-symbol">✎</span><div><small>Рисунок · ${esc(value.kind)}</small><strong>${esc(value.name || value.text || "Без названия")}</strong></div></div>
      <div class="vtt-stat-grid"><span><small>Цвет</small><b><i class="vtt-inline-color" style="background:${esc(value.color)}"></i></b></span><span><small>Толщина</small><b>${Number(value.strokeWidth || 3)} px</b></span><span><small>Автор</small><b>${value.ownerId === clientId ? "вы" : isDm ? "игрок" : "другой игрок"}</b></span><span><small>Состояние</small><b>${value.locked ? "заблокирован" : "свободен"}</b></span></div>
      ${canEditAnnotation ? `<div class="vtt-inspector-actions"><button type="button" data-vtt-edit-annotation="${esc(value.id)}">Настроить</button><button type="button" data-vtt-duplicate-selected>Копировать</button><button class="danger-action" type="button" data-vtt-remove-selected>Удалить</button></div>` : ""}</div>`;
  }

  function scenesPanel(room, isDm) {
    const tabs = (room.scenes || []).map(summary => `<button type="button" class="vtt-scene-card ${summary.active ? "active" : ""} ${summary.published === false ? "draft" : ""}" data-vtt-scene="${esc(summary.id)}"><span><strong>${esc(summary.name)}</strong><small>${Number(summary.tokenCount)} ток. · ${Number(summary.objectCount)} об. · ${Number(summary.annotationCount || 0)} рис.</small></span>${summary.active ? `<b>В эфире</b>` : summary.published === false ? `<b>Черновик</b>` : ""}</button>`).join("");
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Кампания</span><h3>Сцены</h3></div><b>${Number(room.scenes?.length || 0)}</b></div><div class="vtt-scene-list">${tabs}</div>${isDm ? `<div class="vtt-panel-actions"><button id="vtt-scene-new">＋ Новая</button><button id="vtt-scene-copy">⧉ Копия</button><button class="danger-action" id="vtt-scene-delete">Удалить</button></div>` : ""}`;
  }

  function libraryPanel(room, assets) {
    return `<div class="vtt-panel-head"><div><span class="eyebrow">С компьютера</span><h3>Ресурсы</h3></div><b>${Number(room.assets?.length || 0)}</b></div>
      <div class="vtt-upload-grid"><button type="button" data-vtt-upload="token">＋ Токены</button><button type="button" data-vtt-upload="map">＋ Карты</button><button type="button" data-vtt-upload="prop">＋ Объекты</button></div>
      <input id="vtt-asset-search" type="search" value="${esc(assetSearch)}" placeholder="Поиск ресурсов…">
      <div class="vtt-asset-filters"><button data-vtt-asset-filter="all" class="${assetFilter === "all" ? "active" : ""}">Все</button><button data-vtt-asset-filter="token" class="${assetFilter === "token" ? "active" : ""}">Токены</button><button data-vtt-asset-filter="map" class="${assetFilter === "map" ? "active" : ""}">Карты</button><button data-vtt-asset-filter="prop" class="${assetFilter === "prop" ? "active" : ""}">Объекты</button></div>
      <div class="vtt-asset-list">${assets.length ? assets.map(assetCard).join("") : `<div class="vtt-library-empty"><span>▧</span><strong>${room.assets?.length ? "Ничего не найдено" : "Библиотека пуста"}</strong><p>${room.assets?.length ? "Измени поиск или фильтр." : "Загрузи PNG, JPG, WebP или GIF с компьютера."}</p></div>`}</div>`;
  }

  function charactersPanel(room, isDm, clientId, characters = {}) {
    const sceneTokens = room.scene?.tokens || [];
    const players = Object.entries(room.players || {}).filter(([playerId]) => isDm || playerId === clientId);
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Связь с листами</span><h3>Персонажи</h3></div><b>${players.length}</b></div>
      <div class="vtt-character-list">${players.map(([playerId, player]) => {
        const token = sceneTokens.find(entry => entry.playerId === playerId);
        const character = characters[playerId] || {};
        const canPlace = isDm || playerId === clientId;
        return `<article><span class="vtt-character-avatar" style="--character-color:${esc(player.sheet?.tokenColor || "#9f7842")}">${player.sheet?.tokenImageUrl || player.sheet?.portraitUrl ? `<img src="${esc(player.sheet.tokenImageUrl || player.sheet.portraitUrl)}" alt="">` : esc((character.name || player.name || "?")[0].toUpperCase())}</span><div><strong>${esc(character.name || player.name)}</strong><small>HP ${Number(character.hp || 0)}/${Number(character.hpMax || 0)} · КД ${Number(character.ac || 0)} · инициатива ${Number(character.initiativeBonus || 0) >= 0 ? "+" : ""}${Number(character.initiativeBonus || 0)}</small></div>${token ? `<button type="button" data-vtt-focus-token="${esc(token.id)}" title="Показать на карте">⌖</button><button type="button" data-vtt-roll="${esc(token.id)}" title="Бросить инициативу">к20</button>` : canPlace ? `<button class="primary" type="button" data-vtt-character-place="${esc(playerId)}">Поставить</button>` : ""}</article>`;
      }).join("")}</div>`;
  }

  function toolsPanel(grid, selectionCount, isDm) {
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Стол</span><h3>Инструменты</h3></div><b>${grid.snap === false ? "свободно" : "сетка"}</b></div>
      <div class="vtt-tool-options"><label>Цвет<input id="vtt-tool-color" type="color" value="${esc(ui.color)}"></label><label>Заливка<input id="vtt-tool-fill" type="color" value="${esc(ui.fill)}"></label><label>Толщина<input id="vtt-tool-width" type="number" min="1" max="20" value="${Number(ui.strokeWidth)}"></label></div>
      <div class="vtt-tool-help"><strong>${toolLabel(ui.tool)}</strong><p>${toolHelp(ui.tool)}</p></div>
      ${isDm ? `<div class="vtt-history-actions"><button id="vtt-undo">↶ Отменить</button><button id="vtt-redo">↷ Повторить</button></div>` : ""}
      ${selectionCount > 1 && isDm ? `<div class="vtt-panel-subtitle">Выравнивание</div><div class="vtt-align-grid"><button data-vtt-align="left">⇤</button><button data-vtt-align="h-center">↔</button><button data-vtt-align="right">⇥</button><button data-vtt-align="top">⇡</button><button data-vtt-align="v-center">↕</button><button data-vtt-align="bottom">⇣</button></div>` : ""}
      <div class="vtt-shortcuts"><span><kbd>V</kbd> выбор</span><span><kbd>H</kbd> рука</span><span><kbd>M</kbd> линейка</span><span><kbd>Del</kbd> удалить</span><span><kbd>Ctrl D</kbd> копия</span>${isDm ? `<span><kbd>Ctrl Z</kbd> отмена</span>` : ""}</div>`;
  }

  function toolLabel(tool) {
    return ({ select:"Выбор", pan:"Рука", measure:"Линейка", line:"Линия", rect:"Прямоугольник", circle:"Круг", cone:"Конус", draw:"Карандаш", text:"Текст", ping:"Указатель" })[tool] || "Выбор";
  }

  function toolHelp(tool) {
    return ({
      select:"Клик — выбрать. Shift/Ctrl — добавить. Потяни по пустому месту — рамка выделения.",
      pan:"Тяни поле мышью. Средняя кнопка и Пробел работают в любом режиме.",
      measure:"Проведи между точками — получишь расстояние в футах.",
      line:"Проведи постоянную линию на сцене.", rect:"Растяни прямоугольную область.", circle:"Начни из центра и задай радиус.", cone:"Начни из вершины и укажи направление.", draw:"Рисуй свободной линией.", text:"Нажми на поле и введи подпись.", ping:"Нажми на поле, чтобы показать точку всей партии."
    })[tool] || "";
  }

  function toolRailMarkup(isDm) {
    const tools = [
      ["select", "⌖", "Выбор (V)"], ["pan", "✋", "Рука (H)"], ["measure", "↗", "Линейка (M)"],
      ["line", "╱", "Линия"], ["rect", "□", "Область"], ["circle", "○", "Круг"], ["cone", "◁", "Конус"], ["draw", "✎", "Карандаш"], ["text", "T", "Текст"],
      ["ping", "◎", "Указатель (P)"]
    ];
    return tools.map(([key, icon, title]) => `<button type="button" data-vtt-tool="${key}" class="${ui.tool === key ? "active" : ""}" title="${title}"><span>${icon}</span></button>`).join("");
  }

  function rollVisibilityMarkup(isDm) {
    return `<div class="vtt-roll-visibility" role="group" aria-label="Видимость броска"><button type="button" data-vtt-roll-visibility="public" class="${ui.rollVisibility === "public" ? "active" : ""}">Всем</button><button type="button" data-vtt-roll-visibility="private" class="${ui.rollVisibility === "private" ? "active" : ""}">🔒 Мне + ГМ</button>${isDm ? `<button type="button" data-vtt-roll-visibility="gm" class="${ui.rollVisibility === "gm" ? "active" : ""}">Только ГМ</button>` : ""}</div>`;
  }

  function rollEntryMarkup(item) {
    const locked = item.visibility === "private" || item.visibility === "gm" || item.privateToDm;
    const mode = item.mode === "advantage" ? " · преимущество" : item.mode === "disadvantage" ? " · помеха" : "";
    const dice = item.activity ? esc(item.activity) : `[${(item.dice || []).join(", ")}]${item.modifier ? ` ${Number(item.modifier) >= 0 ? "+" : ""}${Number(item.modifier)}` : ""}${mode}`;
    return `<article class="vtt-roll-entry ${item.natural === 20 ? "critical" : item.natural === 1 ? "fumble" : ""} ${locked ? "private" : ""}"><div><small>${locked ? "🔒 " : ""}${esc(item.player || "Игрок")}</small><strong>${esc(item.label || item.formula || "Бросок")}</strong><span>${dice}</span></div><b>${item.total === null ? "✦" : Number(item.total)}</b></article>`;
  }

  function rollsPanelMarkup(room, isDm) {
    const rolls = [...(room.rollLog || [])].sort((a,b) => Number(b.at || 0) - Number(a.at || 0));
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Общий журнал</span><h3>Броски</h3></div><b>${rolls.length}</b></div>
      ${rollVisibilityMarkup(isDm)}
      <div class="vtt-roll-compose"><div class="vtt-quick-dice">${[4,6,8,10,12,20,100].map(sides => `<button type="button" data-vtt-quick-die="1к${sides}">к${sides}</button>`).join("")}</div><form id="vtt-custom-roll"><input name="formula" value="1к20" aria-label="Формула броска"><button class="primary">Бросить</button></form></div>
      <div class="vtt-roll-list">${rolls.length ? rolls.map(rollEntryMarkup).join("") : `<div class="vtt-empty-side">Бросков пока нет.</div>`}</div>`;
  }

  function combatPanelMarkup(combat, isDm) {
    if (!combat) return `<div class="vtt-empty-side"><span>⚔</span><strong>Лист не найден</strong><p>Открой лист персонажа и сохрани его.</p></div>`;
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Быстрый бой</span><h3>${esc(combat.name)}</h3></div><b>КД ${Number(combat.ac)}</b></div>
      <div class="vtt-combat-vitals"><span><small>HP</small><strong>${Number(combat.hp)}/${Number(combat.hpMax)}</strong>${combat.tempHp ? `<em>+${Number(combat.tempHp)} врем.</em>` : ""}</span><span><small>Комплект</small><strong>${esc(combat.setName)}</strong><em>${combat.equipment.length ? combat.equipment.map(item => item.icon).join(" ") : "без предметов"}</em></span></div>
      ${rollVisibilityMarkup(isDm)}
      <div class="vtt-panel-subtitle">Атаки</div><div class="vtt-combat-attacks">${combat.attacks.length ? combat.attacks.map(attack => `<article><button type="button" data-vtt-combat-attack="${esc(attack.id)}"><span><strong>${esc(attack.name)}</strong><small>${esc(attack.actionCost)} · ${esc(attack.damageType)}</small></span><b>${esc(attack.bonus)}</b></button><button type="button" data-vtt-combat-damage="${esc(attack.id)}"><span>${esc(attack.damage)}</span><small>урон</small></button><button type="button" data-vtt-combat-critical="${esc(attack.id)}" title="Критический урон">✦</button></article>`).join("") : `<div class="vtt-empty-mini">В активном комплекте нет атак.</div>`}</div>
      <div class="vtt-panel-subtitle">Быстрые предметы</div><div class="vtt-combat-quick">${combat.quickSlots.map(item => `<button type="button" data-vtt-combat-quick="${item.index}" ${item.id && item.quantity > 0 ? "" : "disabled"}><span>${esc(item.icon)}</span><strong>${esc(item.name)}</strong><small>${item.id ? `${Number(item.quantity)} шт. · ${esc(item.summary)}` : "пусто"}</small></button>`).join("")}</div>`;
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
    const cell = Number(grid.cellSize || 52);
    const metrics = gridMetrics(grid, cell);
    const isDm = room.dmId === ctx.clientId;
    const validSelection = getSelection(room).filter(ref => resolveRef(scene, ref));
    setSelection(room, validSelection);
    const selection = getSelection(room);
    const entries = selectedEntries(room);
    const order = sceneOrder(scene);
    const current = order.find(token => token.id === scene.initiative?.currentTokenId);
    const assets = (room.assets || []).filter(asset => assetFilter === "all" || asset.category === assetFilter)
      .filter(asset => !assetSearch || `${asset.name} ${(asset.tags || []).join(" ")}`.toLowerCase().includes(assetSearch.toLowerCase()));
    const ownToken = (scene.tokens || []).find(token => token.playerId === ctx.clientId);
    const leftContent = ui.leftPanel === "library" && isDm ? libraryPanel(room, assets) : ui.leftPanel === "scenes" ? scenesPanel(room, isDm) : ui.leftPanel === "characters" ? charactersPanel(room, isDm, ctx.clientId, ctx.characters || {}) : ui.leftPanel === "tools" ? toolsPanel(grid, entries.length, isDm) : "";
    const rightContent = ui.rightPanel === "inspector" ? inspectorMarkup(entries, isDm, ctx.clientId) : ui.rightPanel === "initiative" ? initiativePanelMarkup(scene, order, isDm) : ui.rightPanel === "combat" ? combatPanelMarkup(ctx.combat, isDm) : ui.rightPanel === "rolls" ? rollsPanelMarkup(room, isDm) : "";
    const lastSeen = Number(rollSeenByRoom.get(room.code) || 0);
    const unreadRolls = (room.rollLog || []).filter(entry => Number(entry.at || 0) > lastSeen).length;
    if (ui.rightPanel === "rolls") rollSeenByRoom.set(room.code, Math.max(0, ...(room.rollLog || []).map(entry => Number(entry.at || 0))));

    root.innerHTML = `<div class="vtt-shell ${isDm ? "is-dm" : "is-player"}">
      <div id="vtt-viewport" class="vtt-viewport" tabindex="0">
        <div id="vtt-world" class="vtt-world" style="width:${WORLD_WIDTH}px;height:${WORLD_HEIGHT}px;background-color:${esc(scene.backgroundColor || "#17120e")};${scene.backgroundUrl ? `background-image:linear-gradient(#09070544,#09070544),url(&quot;${esc(scene.backgroundUrl)}&quot;);` : ""}">
          ${gridSvgMarkup(grid, metrics)}
          <div class="vtt-origin" style="left:${metrics.originX}px;top:${metrics.originY}px"></div>
          ${(scene.objects || []).sort((a,b)=>Number(a.z||0)-Number(b.z||0)).map(object => objectMarkup(object, metrics, selection, isDm)).join("")}
          <svg class="vtt-annotation-layer" viewBox="0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}">${(scene.annotations || []).sort((a,b)=>Number(a.z||50)-Number(b.z||50)).map(annotation => annotationMarkup(annotation, metrics, selection, ctx.clientId, isDm)).join("")}</svg>
          ${(scene.tokens || []).sort((a,b)=>Number(a.z||100)-Number(b.z||100)).map(token => tokenMarkup(token, metrics, selection, scene.initiative?.currentTokenId, isDm, ctx.clientId, room, ctx.characters || {})).join("")}
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
        <div class="vtt-top-actions">${ownToken ? `<button class="primary" id="vtt-own-initiative">Инициатива</button>` : `<button class="primary" id="vtt-place-own">＋ Мой герой</button>`}${isDm ? `<button id="vtt-add-party">＋ Партия</button><button id="vtt-scene-settings">⚙</button>` : ""}</div>
      </header>

      <nav class="vtt-left-rail">
        ${isDm ? `<button data-vtt-panel-left="library" class="${ui.leftPanel === "library" ? "active" : ""}" title="Ресурсы"><span>▧</span></button>` : ""}
        <button data-vtt-panel-left="scenes" class="${ui.leftPanel === "scenes" ? "active" : ""}" title="Сцены"><span>▤</span></button>
        <button data-vtt-panel-left="characters" class="${ui.leftPanel === "characters" ? "active" : ""}" title="Персонажи из листов"><span>♟</span></button>
        <button data-vtt-panel-left="tools" class="${ui.leftPanel === "tools" ? "active" : ""}" title="Инструменты"><span>⌘</span></button>
        <i></i>${toolRailMarkup(isDm)}
      </nav>

      <nav class="vtt-right-rail"><button data-vtt-panel-right="combat" class="${ui.rightPanel === "combat" ? "active" : ""}" title="Боевой комплект"><span>⚡</span></button><button data-vtt-panel-right="rolls" class="${ui.rightPanel === "rolls" ? "active" : ""}" title="Журнал бросков"><span>🎲</span>${unreadRolls && ui.rightPanel !== "rolls" ? `<b>${unreadRolls}</b>` : ""}</button><button data-vtt-panel-right="inspector" class="${ui.rightPanel === "inspector" ? "active" : ""}" title="Инспектор"><span>◆</span>${entries.length ? `<b>${entries.length}</b>` : ""}</button><button data-vtt-panel-right="initiative" class="${ui.rightPanel === "initiative" ? "active" : ""}" title="Инициатива"><span>⚔</span>${order.length ? `<b>${order.length}</b>` : ""}</button></nav>

      ${leftContent ? `<aside class="vtt-floating-panel vtt-panel-left">${leftContent}</aside>` : ""}
      ${rightContent ? `<aside class="vtt-floating-panel vtt-panel-right">${rightContent}</aside>` : ""}

      <footer class="vtt-bottom-dock"><div><button id="vtt-zoom-out">−</button><button id="vtt-zoom-value">82%</button><button id="vtt-zoom-in">＋</button><button id="vtt-camera-reset" title="К центру">⌂</button></div><div><button id="vtt-clear-measure" class="${getMeasurement(room) ? "active" : ""}" title="Очистить линейку">↗</button><span>${grid.snap === false ? "Свободное движение" : `Привязка · ${cell}px`}</span><span id="vtt-cursor-position">0 : 0</span></div></footer>
      <input id="vtt-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
    </div>`;

    bind(root, ctx, signal, metrics);
  }

  function initiativePanelMarkup(scene, order, isDm) {
    return `<div class="vtt-panel-head"><div><span class="eyebrow">Порядок боя</span><h3>Инициатива</h3></div>${scene.initiative?.active ? `<b>Раунд ${Number(scene.initiative.round || 1)}</b>` : ""}</div>
      <div class="vtt-initiative-list">${order.length ? order.map((token,index) => `<article class="${token.id === scene.initiative?.currentTokenId ? "active" : ""}"><button type="button" data-vtt-focus-token="${esc(token.id)}"><small>${index+1}</small><span><strong>${esc(token.name)}</strong><em>${token.playerId ? "персонаж" : "NPC"}</em></span></button>${isDm ? `<input data-vtt-initiative="${esc(token.id)}" type="number" value="${Number(token.initiative)}">` : `<b>${Number(token.initiative)}</b>`}</article>`).join("") : `<div class="vtt-empty-side">Броски инициативы появятся здесь.</div>`}</div>
      ${isDm ? `<div class="vtt-initiative-actions"><button class="primary" id="vtt-next-turn" ${order.length ? "" : "disabled"}>Следующий ход</button><button id="vtt-clear-initiative" ${order.length ? "" : "disabled"}>Сбросить</button></div>` : ""}`;
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

    const cameraCenterGrid = () => {
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
      render(root, ctx);
    }, { signal }));
    root.querySelectorAll("[data-vtt-tool]").forEach(button => button.addEventListener("click", () => {
      ui.tool = button.dataset.vttTool;
      render(root, ctx);
    }, { signal }));

    root.querySelector("#vtt-zoom-in")?.addEventListener("click", () => { const point = cameraCenterGrid(); centerCamera(point.x, point.y, camera.zoom * 1.2); }, { signal });
    root.querySelector("#vtt-zoom-out")?.addEventListener("click", () => { const point = cameraCenterGrid(); centerCamera(point.x, point.y, camera.zoom / 1.2); }, { signal });
    root.querySelector("#vtt-zoom-value")?.addEventListener("click", () => centerCamera(0, 0, 1), { signal });
    root.querySelector("#vtt-camera-reset")?.addEventListener("click", () => centerCamera(0, 0, 0.82), { signal });
    root.querySelector("#vtt-clear-measure")?.addEventListener("click", () => { measurementByScene.delete(sceneKey(room)); render(root, ctx); }, { signal });

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

    document.addEventListener("keydown", event => handleKeydown(event, root, ctx, viewport, centerCamera), { signal });
    document.addEventListener("keyup", event => {
      if (event.code === "Space") {
        spaceHeld = false;
        viewport.classList.remove("is-pan-ready");
      }
    }, { signal });

    viewport.addEventListener("pointermove", event => {
      const point = screenToGrid(event.clientX, event.clientY, "cell");
      const label = root.querySelector("#vtt-cursor-position");
      if (label) label.textContent = `${point.x} : ${point.y}`;
    }, { signal });

    viewport.addEventListener("pointerdown", event => {
      if (event.button === 1 || event.button === 0 && (spaceHeld || ui.tool === "pan")) return beginPan(event);
      if (event.button !== 0 || event.target.closest("[data-vtt-token],[data-vtt-object],[data-vtt-annotation]")) return;
      if (ui.tool === "select") return beginMarquee(event, root, ctx, viewport);
      if (ui.tool === "ping") {
        const point = screenToGrid(event.clientX, event.clientY, "cell");
        emit(ctx, "scene:ping", { ...point, color:ui.color });
        return;
      }
      if (ui.tool === "text") {
        const point = screenToGrid(event.clientX, event.clientY, "intersection");
        const text = prompt("Текст на карте:", "");
        if (text?.trim()) emit(ctx, "scene:annotation-add", { kind:"text", ...point, x2:point.x, y2:point.y, text:text.trim(), name:text.trim().slice(0,80), color:ui.color, strokeWidth:ui.strokeWidth });
        return;
      }
      if (["measure", "line", "rect", "circle", "cone", "draw"].includes(ui.tool)) {
        beginDrawing(event, root, ctx, viewport, draftLayer, metrics, screenToGrid, screenToGridRaw);
      }
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
    bindPanels(root, ctx, metrics, centerCamera, cameraCenterGrid, signal);
  }

  function handleKeydown(event, root, ctx, viewport) {
    if (!active || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.code === "Space") {
      spaceHeld = true;
      viewport.classList.add("is-pan-ready");
      event.preventDefault();
      return;
    }
    const key = event.key.toLowerCase();
    if (event.key === "Escape") {
      setSelection(ctx.room, []);
      measurementByScene.delete(sceneKey(ctx.room));
      ui.tool = "select";
      render(root, ctx);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (key === "c") {
        const refs = getSelection(ctx.room);
        if (refs.length) clipboard = { sceneId:ctx.room.scene.id, refs:structuredClone(refs) };
        event.preventDefault();
      } else if (key === "v") {
        if (clipboard?.sceneId === ctx.room.scene.id && clipboard.refs.length) duplicateRefs(root, ctx, clipboard.refs);
        event.preventDefault();
      } else if (key === "d") {
        duplicateRefs(root, ctx, getSelection(ctx.room));
        event.preventDefault();
      } else if (ctx.isDm && ((key === "z" && event.shiftKey) || key === "y")) {
        emit(ctx, "scene:history-redo");
        setSelection(ctx.room, []);
        event.preventDefault();
      } else if (ctx.isDm && key === "z") {
        emit(ctx, "scene:history-undo");
        setSelection(ctx.room, []);
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      removeRefs(root, ctx, getSelection(ctx.room));
      event.preventDefault();
      return;
    }
    if ({ v:"select", h:"pan", m:"measure", p:"ping", r:"rect", c:"circle", n:"cone", l:"line", d:"draw", t:"text" }[key]) {
      const next = { v:"select", h:"pan", m:"measure", p:"ping", r:"rect", c:"circle", n:"cone", l:"line", d:"draw", t:"text" }[key];
      ui.tool = next;
      render(root, ctx);
    }
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
        const feet = Math.round(Math.hypot(end.x - start.x, end.y - start.y) * 50) / 10;
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

  function bindSceneItems(root, ctx, viewport, metrics, screenToGridRaw, signal) {
    const room = ctx.room;
    const scene = room.scene;
    const isDm = room.dmId === ctx.clientId;

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
      if (entry.kind === "annotation") return (isDm || entry.value.ownerId === ctx.clientId) && (!entry.value.locked || isDm);
      return isDm && !entry.value.locked;
    };

    const bindItem = (element, kind, id) => {
      element.addEventListener("pointerdown", event => {
        if (event.button !== 0 || spaceHeld || ui.tool !== "select") return;
        event.stopPropagation();
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
          const snappedDelta = scene.grid.snap === false ? { x:roundTenth(rawDx), y:roundTenth(rawDy) } : metrics.snap({ x:rawDx, y:rawDy }, "intersection");
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
          if (moved) await emit(ctx, "scene:items-transform", { moves:originals.map(item => ({ kind:item.ref.kind, id:item.ref.id, dx, dy })) });
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
    root.querySelector("#vtt-add-party")?.addEventListener("click", () => emit(ctx, "scene:party-add", {}, "Токены партии добавлены"), { signal });
    root.querySelector("#vtt-place-own")?.addEventListener("click", () => emit(ctx, "scene:token-add", { playerId:ctx.clientId }, "Персонаж поставлен на карту"), { signal });
    root.querySelectorAll("[data-vtt-character-place]").forEach(button => button.addEventListener("click", () => emit(ctx, "scene:token-add", { playerId:button.dataset.vttCharacterPlace }, "Персонаж поставлен на карту"), { signal }));
    root.querySelector("#vtt-own-initiative")?.addEventListener("click", () => {
      const token = (scene.tokens || []).find(entry => entry.playerId === ctx.clientId);
      if (token) emit(ctx, "initiative:roll", { tokenId:token.id });
    }, { signal });

    root.querySelectorAll("[data-vtt-asset-filter]").forEach(button => button.addEventListener("click", () => { assetFilter = button.dataset.vttAssetFilter; render(root, ctx); }, { signal }));
    root.querySelector("#vtt-asset-search")?.addEventListener("input", event => {
      const position = event.target.selectionStart;
      assetSearch = event.target.value;
      render(root, ctx);
      requestAnimationFrame(() => {
        const next = root.querySelector("#vtt-asset-search");
        if (next) { next.focus(); next.setSelectionRange(position, position); }
      });
    }, { signal });
    root.querySelectorAll("[data-vtt-asset]").forEach(card => card.addEventListener("dragstart", event => {
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
    root.querySelectorAll("[data-vtt-roll-visibility]").forEach(button => button.addEventListener("click", () => { ui.rollVisibility = button.dataset.vttRollVisibility; render(root, ctx); }, { signal }));
    root.querySelectorAll("[data-vtt-quick-die]").forEach(button => button.addEventListener("click", () => ctx.actions?.roll?.(button.dataset.vttQuickDie, button.dataset.vttQuickDie, ui.rollVisibility), { signal }));
    root.querySelector("#vtt-custom-roll")?.addEventListener("submit", event => { event.preventDefault(); const formula = new FormData(event.currentTarget).get("formula"); ctx.actions?.roll?.(formula, formula, ui.rollVisibility); }, { signal });
    root.querySelectorAll("[data-vtt-combat-attack]").forEach(button => button.addEventListener("click", () => ctx.actions?.attack?.(button.dataset.vttCombatAttack, ui.rollVisibility), { signal }));
    root.querySelectorAll("[data-vtt-combat-damage]").forEach(button => button.addEventListener("click", () => ctx.actions?.damage?.(button.dataset.vttCombatDamage, false, ui.rollVisibility), { signal }));
    root.querySelectorAll("[data-vtt-combat-critical]").forEach(button => button.addEventListener("click", () => ctx.actions?.damage?.(button.dataset.vttCombatCritical, true, ui.rollVisibility), { signal }));
    root.querySelectorAll("[data-vtt-combat-quick]").forEach(button => button.addEventListener("click", () => ctx.actions?.useQuick?.(button.dataset.vttCombatQuick, ui.rollVisibility), { signal }));
    root.querySelector("#vtt-undo")?.addEventListener("click", () => { setSelection(room, []); emit(ctx, "scene:history-undo"); }, { signal });
    root.querySelector("#vtt-redo")?.addEventListener("click", () => { setSelection(room, []); emit(ctx, "scene:history-redo"); }, { signal });

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

    root.querySelectorAll("[data-vtt-edit-token]").forEach(button => button.addEventListener("click", () => openTokenEditor(ctx, (scene.tokens || []).find(token => token.id === button.dataset.vttEditToken)), { signal }));
    root.querySelectorAll("[data-vtt-roll]").forEach(button => button.addEventListener("click", () => emit(ctx, "initiative:roll", { tokenId:button.dataset.vttRoll }), { signal }));
    root.querySelectorAll("[data-vtt-edit-object]").forEach(button => button.addEventListener("click", () => openObjectEditor(ctx, (scene.objects || []).find(object => object.id === button.dataset.vttEditObject)), { signal }));
    root.querySelectorAll("[data-vtt-edit-annotation]").forEach(button => button.addEventListener("click", () => openAnnotationEditor(ctx, (scene.annotations || []).find(annotation => annotation.id === button.dataset.vttEditAnnotation)), { signal }));
    root.querySelectorAll("[data-vtt-duplicate-selected],[data-vtt-group-duplicate]").forEach(button => button.addEventListener("click", () => duplicateRefs(root, ctx, getSelection(room)), { signal }));
    root.querySelectorAll("[data-vtt-remove-selected],[data-vtt-group-remove]").forEach(button => button.addEventListener("click", () => removeRefs(root, ctx, getSelection(room)), { signal }));
    root.querySelectorAll("[data-vtt-align]").forEach(button => button.addEventListener("click", () => alignRefs(ctx, button.dataset.vttAlign), { signal }));
  }

  async function duplicateRefs(root, ctx, refs) {
    if (!refs?.length) return;
    const response = await emit(ctx, "scene:items-duplicate", { refs, offsetX:1, offsetY:1 }, "Копия создана");
    if (response.ok && response.created) setSelection(ctx.room, response.created);
  }

  async function removeRefs(root, ctx, refs) {
    if (!refs?.length) return;
    if (!confirm(`Удалить выбранные объекты: ${refs.length}?`)) return;
    const response = await emit(ctx, "scene:items-remove", { refs }, "Удалено");
    if (response.ok) setSelection(ctx.room, []);
  }

  function alignRefs(ctx, mode) {
    const entries = selectedEntries(ctx.room);
    const isDm = ctx.room.dmId === ctx.clientId;
    if (entries.length < 2 || !entries.every(entry => isDm || entry.kind === "annotation" && entry.value.ownerId === ctx.clientId)) return;
    const bounds = entries.map(entry => ({ entry, bounds:boundsForEntry(entry) }));
    const group = {
      left:Math.min(...bounds.map(item => item.bounds.left)),
      top:Math.min(...bounds.map(item => item.bounds.top)),
      right:Math.max(...bounds.map(item => item.bounds.right)),
      bottom:Math.max(...bounds.map(item => item.bounds.bottom))
    };
    const moves = bounds.map(item => {
      let dx = 0;
      let dy = 0;
      if (mode === "left") dx = group.left - item.bounds.left;
      if (mode === "right") dx = group.right - item.bounds.right;
      if (mode === "h-center") dx = (group.left + group.right) / 2 - (item.bounds.left + item.bounds.right) / 2;
      if (mode === "top") dy = group.top - item.bounds.top;
      if (mode === "bottom") dy = group.bottom - item.bounds.bottom;
      if (mode === "v-center") dy = (group.top + group.bottom) / 2 - (item.bounds.top + item.bounds.bottom) / 2;
      return { kind:item.entry.kind, id:item.entry.value.id, dx, dy };
    });
    emit(ctx, "scene:items-transform", { moves }, "Объекты выровнены");
  }

  function openSceneCreate(ctx) {
    ctx.openModal("Новая сцена", `<div class="vtt-modal-form"><label>Название<input id="vtt-new-scene-name" value="Новая сцена"></label><label class="toggle-row"><span><strong>Сразу показать игрокам</strong><small>Сделает сцену активной</small></span><input id="vtt-new-scene-active" type="checkbox" checked><i></i></label><div class="modal-actions"><button id="vtt-new-scene-save" class="primary">Создать</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-new-scene-save")?.addEventListener("click", () => { emit(ctx, "scene:create", { name:document.querySelector("#vtt-new-scene-name").value, activate:document.querySelector("#vtt-new-scene-active").checked }, "Сцена создана"); ctx.closeModal(); });
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  function openSceneSettings(ctx) {
    const scene = ctx.room.scene;
    const grid = scene.grid || {};
    ctx.openModal("Настройки сцены", `<div class="vtt-modal-form"><label>Название<input id="vtt-scene-name" value="${esc(scene.name)}"></label><div class="two-col"><label>Цвет поля<input id="vtt-scene-color" type="color" value="${esc(scene.backgroundColor || "#17120e")}"></label><label>Размер клетки<input id="vtt-scene-cell" type="number" min="20" max="160" value="${Number(grid.cellSize || 52)}"></label></div><div class="two-col"><label>Тип сетки<select id="vtt-grid-type"><option value="square" ${grid.type === "square" ? "selected" : ""}>Квадратная</option><option value="hex-row" ${grid.type === "hex-row" ? "selected" : ""}>Гексы горизонтальные</option><option value="hex-column" ${grid.type === "hex-column" ? "selected" : ""}>Гексы вертикальные</option><option value="isometric" ${grid.type === "isometric" ? "selected" : ""}>Изометрическая</option></select></label><label>Прозрачность<input id="vtt-grid-opacity" type="number" min="0.03" max="1" step="0.01" value="${Number(grid.opacity || .22)}"></label></div><div class="two-col"><label>Смещение X, px<input id="vtt-grid-offset-x" type="number" value="${Number(grid.offsetX || 0)}"></label><label>Смещение Y, px<input id="vtt-grid-offset-y" type="number" value="${Number(grid.offsetY || 0)}"></label></div><label>Цвет сетки<input id="vtt-grid-color" type="color" value="${esc(grid.color || "#d3ad6e")}"></label><div class="item-toggle-grid"><label class="toggle-row"><span><strong>Показывать сетку</strong><small>Можно скрыть поверх готовой карты</small></span><input id="vtt-grid-visible" type="checkbox" ${grid.visible !== false ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Привязка к сетке</strong><small>Объекты двигаются ровно по клеткам</small></span><input id="vtt-grid-snap" type="checkbox" ${grid.snap !== false ? "checked" : ""}><i></i></label></div><div class="modal-actions"><button id="vtt-scene-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-scene-save")?.addEventListener("click", () => {
      emit(ctx, "scene:settings", { name:document.querySelector("#vtt-scene-name").value, backgroundColor:document.querySelector("#vtt-scene-color").value, grid:{ cellSize:Number(document.querySelector("#vtt-scene-cell").value), type:document.querySelector("#vtt-grid-type").value, color:document.querySelector("#vtt-grid-color").value, opacity:Number(document.querySelector("#vtt-grid-opacity").value), offsetX:Number(document.querySelector("#vtt-grid-offset-x").value), offsetY:Number(document.querySelector("#vtt-grid-offset-y").value), visible:document.querySelector("#vtt-grid-visible").checked, snap:document.querySelector("#vtt-grid-snap").checked } }, "Сцена обновлена");
      ctx.closeModal();
    });
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  function openTokenEditor(ctx, token) {
    if (!token) return;
    const isDm = ctx.room.dmId === ctx.clientId;
    const npc = !token.playerId;
    ctx.openModal("Настройки токена", `<div class="vtt-modal-form">${npc ? `<label>Имя<input id="vtt-token-name" value="${esc(token.name)}"></label><div class="two-col"><label>Цвет рамки<input id="vtt-token-color" type="color" value="${esc(token.color || "#9f7842")}"></label><label>Размер<input id="vtt-token-size" type="number" min="0.25" max="12" step="0.25" value="${Number(token.size || 1)}"></label></div><div class="two-col"><label>Поворот<input id="vtt-token-rotation" type="number" value="${Number(token.rotation || 0)}"></label><label>Прозрачность<input id="vtt-token-opacity" type="number" min="0.05" max="1" step="0.05" value="${Number(token.opacity || 1)}"></label></div><div class="two-col"><label>Зрение<input id="vtt-token-vision" type="number" value="${Number(token.vision || 0)}"></label><label>Бонус инициативы<input id="vtt-token-init" type="number" value="${Number(token.initiativeBonus || 0)}"></label></div>` : `<div class="read-only">Имя и изображение связаны с листом персонажа.</div>`}${isDm ? `<div class="item-toggle-grid"><label class="toggle-row"><span><strong>Скрытый</strong><small>Не передаётся игрокам</small></span><input id="vtt-token-hidden" type="checkbox" ${token.hidden ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Заблокирован</strong><small>Не двигается случайно</small></span><input id="vtt-token-locked" type="checkbox" ${token.locked ? "checked" : ""}><i></i></label></div>` : ""}<div class="modal-actions"><button id="vtt-token-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-token-save")?.addEventListener("click", () => { emit(ctx, "scene:token-update", { tokenId:token.id, name:document.querySelector("#vtt-token-name")?.value, color:document.querySelector("#vtt-token-color")?.value, size:Number(document.querySelector("#vtt-token-size")?.value), rotation:Number(document.querySelector("#vtt-token-rotation")?.value), opacity:Number(document.querySelector("#vtt-token-opacity")?.value), vision:Number(document.querySelector("#vtt-token-vision")?.value), initiativeBonus:Number(document.querySelector("#vtt-token-init")?.value), hidden:document.querySelector("#vtt-token-hidden")?.checked, locked:document.querySelector("#vtt-token-locked")?.checked }, "Токен обновлён"); ctx.closeModal(); });
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
    ctx.openModal("Настройки рисунка", `<div class="vtt-modal-form">${annotation.kind === "text" ? `<label>Текст<textarea id="vtt-annotation-text">${esc(annotation.text || "")}</textarea></label>` : ""}<div class="two-col"><label>Цвет<input id="vtt-annotation-color" type="color" value="${esc(annotation.color || "#f4c875")}"></label><label>Заливка<input id="vtt-annotation-fill" type="color" value="${esc(annotation.fill || "#b94b42")}"></label></div><div class="two-col"><label>Толщина<input id="vtt-annotation-width" type="number" min="1" max="20" value="${Number(annotation.strokeWidth || 3)}"></label><label>Прозрачность<input id="vtt-annotation-opacity" type="number" min="0.05" max="1" step="0.05" value="${Number(annotation.opacity || 1)}"></label></div>${isDm ? `<label>Слой<input id="vtt-annotation-z" type="number" min="-1000" max="1000" value="${Number(annotation.z || 50)}"></label><div class="item-toggle-grid"><label class="toggle-row"><span><strong>Скрытый</strong><small>Виден только ведущему</small></span><input id="vtt-annotation-hidden" type="checkbox" ${annotation.hidden ? "checked" : ""}><i></i></label><label class="toggle-row"><span><strong>Заблокирован</strong><small>Не двигается случайно</small></span><input id="vtt-annotation-locked" type="checkbox" ${annotation.locked ? "checked" : ""}><i></i></label></div>` : ""}<div class="modal-actions"><button id="vtt-annotation-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-annotation-save")?.addEventListener("click", () => { emit(ctx, "scene:annotation-update", { annotationId:annotation.id, text:document.querySelector("#vtt-annotation-text")?.value, color:document.querySelector("#vtt-annotation-color").value, fill:document.querySelector("#vtt-annotation-fill").value, strokeWidth:Number(document.querySelector("#vtt-annotation-width").value), opacity:Number(document.querySelector("#vtt-annotation-opacity").value), z:Number(document.querySelector("#vtt-annotation-z")?.value), hidden:document.querySelector("#vtt-annotation-hidden")?.checked, locked:document.querySelector("#vtt-annotation-locked")?.checked }, "Рисунок обновлён"); ctx.closeModal(); });
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click", ctx.closeModal);
  }

  function openAssetEditor(ctx, asset) {
    if (!asset) return;
    ctx.openModal("Ресурс библиотеки", `<div class="vtt-modal-form"><div class="vtt-asset-large"><img src="${esc(asset.url)}" alt=""></div><label>Название<input id="vtt-asset-name" value="${esc(asset.name)}"></label><div class="two-col"><label>Категория<select id="vtt-asset-category"><option value="token" ${asset.category === "token" ? "selected" : ""}>Токен</option><option value="map" ${asset.category === "map" ? "selected" : ""}>Карта</option><option value="prop" ${asset.category === "prop" ? "selected" : ""}>Объект</option></select></label><label>Размер по умолчанию<input id="vtt-asset-size" type="number" min="0.25" max="30" step="0.25" value="${Number(asset.defaultSize || 1)}"></label></div><label>Теги через запятую<input id="vtt-asset-tags" value="${esc((asset.tags || []).join(", "))}"></label><div class="modal-actions"><button id="vtt-asset-save" class="primary">Сохранить</button><button id="vtt-asset-delete" class="danger-action">Удалить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-asset-save")?.addEventListener("click", async () => {
      const response = await fetch(`/api/rooms/${ctx.room.code}/assets/${asset.id}`, { method:"PATCH", headers:{ "content-type":"application/json", "x-client-id":ctx.clientId }, body:JSON.stringify({ name:document.querySelector("#vtt-asset-name").value, category:document.querySelector("#vtt-asset-category").value, defaultSize:Number(document.querySelector("#vtt-asset-size").value), tags:document.querySelector("#vtt-asset-tags").value.split(",").map(value => value.trim()).filter(Boolean) }) }).then(response => response.json()).catch(() => ({ ok:false, error:"Сеть недоступна" }));
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
    const response = await fetch(`/api/rooms/${ctx.room.code}/assets`, { method:"POST", headers:{ "content-type":"application/json", "x-client-id":ctx.clientId }, body:JSON.stringify({ name:file.name.replace(/\.[^.]+$/, ""), fileName:file.name, category, dataUrl, width:dimensions.width, height:dimensions.height, defaultSize:category === "map" ? 20 : 1 }) }).then(result => result.json()).catch(() => ({ ok:false, error:"Не удалось загрузить файл" }));
    if (!response.ok) ctx.toast(response.error); else ctx.toast(response.duplicate ? "Такой ресурс уже есть" : "Ресурс сохранён в библиотеке");
  }

  function deactivate() {
    active = false;
    spaceHeld = false;
    if (controller) controller.abort();
    controller = null;
  }

  window.TT_VTT = { render, deactivate };
})();
