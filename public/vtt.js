(() => {
  "use strict";

  const WORLD_WIDTH = 12000;
  const WORLD_HEIGHT = 8000;
  const ORIGIN_X = WORLD_WIDTH / 2;
  const ORIGIN_Y = WORLD_HEIGHT / 2;
  const cameraByScene = new Map();
  const selectionByScene = new Map();
  let assetFilter = "all";
  let assetSearch = "";
  let controller = null;
  let spaceHeld = false;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]);
  const safeCssUrl = value => String(value || "").replace(/["\\\n\r]/g, match => `\\${match}`);
  const sceneKey = room => `${room.code}:${room.scene?.id || room.activeSceneId || "main"}`;
  const getCamera = room => {
    const key = sceneKey(room);
    if (!cameraByScene.has(key)) cameraByScene.set(key, { zoom:0.85, panX:null, panY:null });
    return cameraByScene.get(key);
  };
  const getSelection = room => selectionByScene.get(sceneKey(room)) || null;
  const setSelection = (room, selection) => selectionByScene.set(sceneKey(room), selection);
  const sceneOrder = scene => (scene.tokens || []).filter(token => token.initiative !== null && token.initiative !== undefined)
    .sort((a,b) => Number(b.initiative) - Number(a.initiative) || String(a.name).localeCompare(String(b.name), "ru"));

  function emit(ctx, event, payload = {}, success = "") {
    return new Promise(resolve => {
      ctx.socket.emit(event, payload, response => {
        if (!response?.ok) ctx.toast(response?.error || "Не удалось изменить сцену");
        else if (success) ctx.toast(success);
        resolve(response || { ok:false });
      });
    });
  }

  function selectedEntry(room) {
    const selected = getSelection(room);
    if (!selected) return null;
    if (selected.kind === "token") {
      const value = (room.scene?.tokens || []).find(entry => entry.id === selected.id);
      return value ? { kind:"token", value } : null;
    }
    const value = (room.scene?.objects || []).find(entry => entry.id === selected.id);
    return value ? { kind:"object", value } : null;
  }

  function assetCard(asset) {
    const categoryLabel = { token:"Токен", map:"Карта", prop:"Объект" }[asset.category] || "Ресурс";
    return `<article class="vtt-asset-card" draggable="true" data-vtt-asset="${esc(asset.id)}">
      <div class="vtt-asset-preview"><img src="${esc(asset.url)}" alt=""><span>${categoryLabel}</span></div>
      <div class="vtt-asset-info"><strong title="${esc(asset.name)}">${esc(asset.name)}</strong><small>${asset.usageCount ? `На сценах: ${Number(asset.usageCount)}` : "Ещё не размещён"}</small></div>
      <div class="vtt-asset-actions"><button type="button" data-vtt-place="${esc(asset.id)}" title="Поставить в центр">＋</button><button type="button" data-vtt-asset-edit="${esc(asset.id)}" title="Настроить">⋮</button></div>
    </article>`;
  }

  function objectMarkup(object, cell, selected, isDm) {
    const movable = isDm && !object.locked;
    return `<button type="button" class="vtt-scene-object ${object.type === "map" ? "is-map" : "is-prop"} ${object.hidden ? "is-hidden" : ""} ${object.locked ? "is-locked" : ""} ${selected?.kind === "object" && selected.id === object.id ? "is-selected" : ""}"
      data-vtt-object="${esc(object.id)}" data-vtt-movable="${movable ? "1" : "0"}"
      style="--x:${Number(object.x)||0};--y:${Number(object.y)||0};--w:${Number(object.width)||1};--h:${Number(object.height)||1};--rotation:${Number(object.rotation)||0}deg;--opacity:${Number(object.opacity)||1};--z:${Number(object.z)||0};--cell:${cell}px"
      title="${esc(object.name)}">
      ${object.imageUrl ? `<img src="${esc(object.imageUrl)}" alt="">` : `<span>${esc(object.name)}</span>`}
      <strong>${esc(object.name)}</strong>
    </button>`;
  }

  function tokenMarkup(token, cell, selected, currentId, isDm, clientId) {
    const movable = isDm || token.playerId === clientId;
    return `<button type="button" class="vtt-token ${token.hidden ? "is-hidden" : ""} ${token.locked ? "is-locked" : ""} ${selected?.kind === "token" && selected.id === token.id ? "is-selected" : ""} ${token.id === currentId ? "is-current" : ""}"
      data-vtt-token="${esc(token.id)}" data-vtt-movable="${movable && (!token.locked || isDm) ? "1" : "0"}"
      style="--x:${Number(token.x)||0};--y:${Number(token.y)||0};--size:${Number(token.size)||1};--rotation:${Number(token.rotation)||0}deg;--opacity:${Number(token.opacity)||1};--z:${Number(token.z)||100};--color:${esc(token.color || "#9f7842")};--cell:${cell}px"
      title="${esc(token.name)}">
      <i>${token.imageUrl ? `<img src="${esc(token.imageUrl)}" alt="">` : `<span>${esc((token.name || "?")[0].toUpperCase())}</span>`}</i>
      <strong>${esc(token.name)}</strong>
      ${token.initiative !== null && token.initiative !== undefined ? `<b>${Number(token.initiative)}</b>` : ""}
    </button>`;
  }

  function inspectorMarkup(entry, isDm, clientId) {
    if (!entry) return `<div class="vtt-empty-side"><span>◇</span><strong>Ничего не выбрано</strong><p>Нажми на токен, карту или объект.</p></div>`;
    const value = entry.value;
    if (entry.kind === "token") {
      const canEdit = isDm || value.playerId === clientId;
      return `<div class="vtt-inspector-card">
        <div class="vtt-inspector-title"><span class="vtt-color-dot" style="background:${esc(value.color || "#9f7842")}"></span><div><small>${value.playerId ? "Персонаж" : "Токен"}</small><strong>${esc(value.name)}</strong></div></div>
        <div class="vtt-stat-grid"><span><small>X / Y</small><b>${Number(value.x)} / ${Number(value.y)}</b></span><span><small>Размер</small><b>${Number(value.size)}</b></span><span><small>Зрение</small><b>${Number(value.vision || 0)} фт.</b></span><span><small>Слой</small><b>${Number(value.z || 100)}</b></span></div>
        <div class="vtt-inspector-actions">${canEdit ? `<button type="button" data-vtt-edit-token="${esc(value.id)}">Настроить</button>` : ""}<button type="button" data-vtt-roll="${esc(value.id)}" ${canEdit ? "" : "disabled"}>Инициатива</button>${isDm ? `<button type="button" data-vtt-duplicate-token="${esc(value.id)}">Копировать</button><button class="danger-action" type="button" data-vtt-remove-token="${esc(value.id)}">Удалить</button>` : ""}</div>
      </div>`;
    }
    return `<div class="vtt-inspector-card">
      <div class="vtt-inspector-title"><span class="vtt-object-symbol">${value.type === "map" ? "▦" : "◆"}</span><div><small>${value.type === "map" ? "Карта" : "Объект"}</small><strong>${esc(value.name)}</strong></div></div>
      <div class="vtt-stat-grid"><span><small>X / Y</small><b>${Number(value.x)} / ${Number(value.y)}</b></span><span><small>Размер</small><b>${Number(value.width)} × ${Number(value.height)}</b></span><span><small>Поворот</small><b>${Number(value.rotation || 0)}°</b></span><span><small>Слой</small><b>${Number(value.z || 0)}</b></span></div>
      ${isDm ? `<div class="vtt-inspector-actions"><button type="button" data-vtt-edit-object="${esc(value.id)}">Настроить</button><button type="button" data-vtt-duplicate-object="${esc(value.id)}">Копировать</button><button class="danger-action" type="button" data-vtt-remove-object="${esc(value.id)}">Удалить</button></div>` : ""}
    </div>`;
  }

  function render(root, ctx) {
    if (!root || !ctx.room?.scene) return;
    if (controller) controller.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const room = ctx.room;
    const scene = room.scene;
    const grid = scene.grid || {};
    const cell = Number(grid.cellSize || 52);
    const isDm = room.dmId === ctx.clientId;
    const selected = getSelection(room);
    const selectedResolved = selectedEntry(room);
    if (selected && !selectedResolved) setSelection(room, null);
    const order = sceneOrder(scene);
    const current = order.find(token => token.id === scene.initiative?.currentTokenId);
    const assets = (room.assets || []).filter(asset => assetFilter === "all" || asset.category === assetFilter)
      .filter(asset => !assetSearch || `${asset.name} ${(asset.tags || []).join(" ")}`.toLowerCase().includes(assetSearch.toLowerCase()));
    const ownToken = (scene.tokens || []).find(token => token.playerId === ctx.clientId);
    const sceneTabs = (room.scenes || []).map(summary => `<button type="button" class="${summary.active ? "active" : ""} ${summary.published === false ? "draft" : ""}" data-vtt-scene="${esc(summary.id)}"><strong>${esc(summary.name)}</strong><small>${Number(summary.tokenCount)} ток. · ${Number(summary.objectCount)} об.</small></button>`).join("");

    root.innerHTML = `<div class="vtt-shell">
      <header class="vtt-header">
        <div><span class="eyebrow">Виртуальный стол</span><h2>${esc(scene.name)}</h2><p>${current ? `Раунд ${Number(scene.initiative.round || 1)} · ходит ${esc(current.name)}` : "Карты и токены из локальной библиотеки сохраняются на этом сервере."}</p></div>
        <div class="vtt-header-actions">${ownToken ? `<button class="primary" type="button" id="vtt-own-initiative">Инициатива</button>` : ""}${isDm ? `<button type="button" id="vtt-add-party">Добавить партию</button><button type="button" id="vtt-scene-settings">Настройки</button>` : ""}</div>
      </header>
      <div class="vtt-scene-strip"><div class="vtt-scene-tabs">${sceneTabs}</div>${isDm ? `<div class="vtt-scene-actions"><button type="button" id="vtt-scene-new" title="Новая сцена">＋</button><button type="button" id="vtt-scene-copy" title="Копировать сцену">⧉</button><button type="button" id="vtt-scene-delete" title="Удалить сцену">×</button></div>` : ""}</div>
      <div class="vtt-layout ${isDm ? "is-dm" : "is-player"}">
        ${isDm ? `<aside class="vtt-library">
          <div class="vtt-panel-head"><div><span class="eyebrow">С компьютера</span><h3>Ресурсы</h3></div><b>${Number(room.assets?.length || 0)}</b></div>
          <div class="vtt-upload-grid"><button type="button" data-vtt-upload="token">＋ Токены</button><button type="button" data-vtt-upload="map">＋ Карты</button><button type="button" data-vtt-upload="prop">＋ Объекты</button></div>
          <input id="vtt-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
          <input id="vtt-asset-search" type="search" value="${esc(assetSearch)}" placeholder="Поиск ресурсов…">
          <div class="vtt-asset-filters"><button data-vtt-asset-filter="all" class="${assetFilter === "all" ? "active" : ""}">Все</button><button data-vtt-asset-filter="token" class="${assetFilter === "token" ? "active" : ""}">Токены</button><button data-vtt-asset-filter="map" class="${assetFilter === "map" ? "active" : ""}">Карты</button><button data-vtt-asset-filter="prop" class="${assetFilter === "prop" ? "active" : ""}">Объекты</button></div>
          <div class="vtt-asset-list">${assets.length ? assets.map(assetCard).join("") : `<div class="vtt-library-empty"><span>▧</span><strong>${room.assets?.length ? "Ничего не найдено" : "Библиотека пуста"}</strong><p>${room.assets?.length ? "Измени поиск или фильтр." : "Загрузи PNG, JPG, WebP или GIF с компьютера."}</p></div>`}</div>
        </aside>` : ""}
        <main class="vtt-board-panel">
          <div class="vtt-toolbar"><div><button type="button" id="vtt-zoom-out">−</button><button type="button" id="vtt-zoom-value">85%</button><button type="button" id="vtt-zoom-in">＋</button><button type="button" id="vtt-camera-reset">⌂</button></div><div><span>${grid.snap === false ? "Свободно" : "По сетке"}</span><span>${cell}px</span><span>Колесо — масштаб · пробел — панорама</span></div></div>
          <div id="vtt-viewport" class="vtt-viewport" tabindex="0">
            <div id="vtt-world" class="vtt-world ${grid.visible === false ? "grid-hidden" : ""}" style="width:${WORLD_WIDTH}px;height:${WORLD_HEIGHT}px;--cell:${cell}px;--grid-color:${esc(grid.color || "#d3ad6e")};--grid-opacity:${Number(grid.opacity || .22)};--grid-offset-x:${Number(grid.offsetX || 0)}px;--grid-offset-y:${Number(grid.offsetY || 0)}px;background-color:${esc(scene.backgroundColor || "#17120e")};${scene.backgroundUrl ? `background-image:linear-gradient(#09070544,#09070544),url(&quot;${esc(scene.backgroundUrl)}&quot;);` : ""}">
              <div class="vtt-origin" style="left:${ORIGIN_X}px;top:${ORIGIN_Y}px"></div>
              ${(scene.objects || []).map(object => objectMarkup(object, cell, selected, isDm)).join("")}
              ${(scene.tokens || []).map(token => tokenMarkup(token, cell, selected, scene.initiative?.currentTokenId, isDm, ctx.clientId)).join("")}
              ${!(scene.tokens || []).length && !(scene.objects || []).length ? `<div class="vtt-stage-empty" style="left:${ORIGIN_X}px;top:${ORIGIN_Y}px"><span>◇</span><strong>Пустая сцена</strong><p>${isDm ? "Перетащи ресурс из библиотеки или добавь партию." : "Ведущий ещё ничего не разместил."}</p></div>` : ""}
            </div>
          </div>
          <footer class="vtt-board-footer"><span>Сцена сохраняется автоматически</span><span>Клетка = 5 футов</span><span id="vtt-cursor-position">0 : 0</span></footer>
        </main>
        <aside class="vtt-side">
          <section class="vtt-side-panel"><div class="vtt-panel-head"><div><span class="eyebrow">Выбранный объект</span><h3>Инспектор</h3></div></div>${inspectorMarkup(selectedResolved, isDm, ctx.clientId)}</section>
          <section class="vtt-side-panel initiative-panel"><div class="vtt-panel-head"><div><span class="eyebrow">Порядок боя</span><h3>Инициатива</h3></div>${scene.initiative?.active ? `<b>Раунд ${Number(scene.initiative.round || 1)}</b>` : ""}</div>
            <div class="vtt-initiative-list">${order.length ? order.map((token,index) => `<article class="${token.id === scene.initiative?.currentTokenId ? "active" : ""}"><button type="button" data-vtt-focus-token="${esc(token.id)}"><small>${index+1}</small><span><strong>${esc(token.name)}</strong><em>${token.playerId ? "персонаж" : "NPC"}</em></span></button>${isDm ? `<input data-vtt-initiative="${esc(token.id)}" type="number" value="${Number(token.initiative)}">` : `<b>${Number(token.initiative)}</b>`}</article>`).join("") : `<div class="vtt-empty-side">Броски инициативы появятся здесь.</div>`}</div>
            ${isDm ? `<div class="vtt-initiative-actions"><button class="primary" id="vtt-next-turn" ${order.length ? "" : "disabled"}>Следующий ход</button><button id="vtt-clear-initiative" ${order.length ? "" : "disabled"}>Сбросить</button></div>` : ""}
          </section>
        </aside>
      </div>
    </div>`;

    bind(root, ctx, signal);
  }

  function bind(root, ctx, signal) {
    const room = ctx.room;
    const scene = room.scene;
    const grid = scene.grid || {};
    const cell = Number(grid.cellSize || 52);
    const isDm = room.dmId === ctx.clientId;
    const viewport = root.querySelector("#vtt-viewport");
    const world = root.querySelector("#vtt-world");
    const zoomValue = root.querySelector("#vtt-zoom-value");
    const camera = getCamera(room);

    const applyCamera = () => {
      world.style.transform = `translate(${camera.panX || 0}px,${camera.panY || 0}px) scale(${camera.zoom})`;
      zoomValue.textContent = `${Math.round(camera.zoom * 100)}%`;
    };
    const centerCamera = (x = 0, y = 0, zoom = camera.zoom) => {
      camera.zoom = clamp(zoom, .2, 3);
      camera.panX = viewport.clientWidth / 2 - (ORIGIN_X + x * cell) * camera.zoom;
      camera.panY = viewport.clientHeight / 2 - (ORIGIN_Y + y * cell) * camera.zoom;
      applyCamera();
    };
    if (camera.panX === null || camera.panY === null) requestAnimationFrame(() => centerCamera(0,0,.85));
    else applyCamera();

    const screenToCell = (clientX, clientY) => {
      const rect = viewport.getBoundingClientRect();
      const worldX = (clientX - rect.left - camera.panX) / camera.zoom;
      const worldY = (clientY - rect.top - camera.panY) / camera.zoom;
      const rawX = (worldX - ORIGIN_X) / cell;
      const rawY = (worldY - ORIGIN_Y) / cell;
      return {
        x:grid.snap === false ? Math.round(rawX*10)/10 : Math.round(rawX),
        y:grid.snap === false ? Math.round(rawY*10)/10 : Math.round(rawY)
      };
    };
    const cameraCenterCell = () => {
      const rect = viewport.getBoundingClientRect();
      return screenToCell(rect.left + rect.width/2, rect.top + rect.height/2);
    };

    root.querySelector("#vtt-zoom-in")?.addEventListener("click", () => { const c=cameraCenterCell(); centerCamera(c.x,c.y,camera.zoom*1.2); }, { signal });
    root.querySelector("#vtt-zoom-out")?.addEventListener("click", () => { const c=cameraCenterCell(); centerCamera(c.x,c.y,camera.zoom/1.2); }, { signal });
    root.querySelector("#vtt-zoom-value")?.addEventListener("click", () => centerCamera(0,0,1), { signal });
    root.querySelector("#vtt-camera-reset")?.addEventListener("click", () => centerCamera(0,0,.85), { signal });
    viewport.addEventListener("wheel", event => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const worldX = (pointerX - camera.panX) / camera.zoom;
      const worldY = (pointerY - camera.panY) / camera.zoom;
      const nextZoom = clamp(camera.zoom * (event.deltaY < 0 ? 1.12 : .89), .2, 3);
      camera.panX = pointerX - worldX * nextZoom;
      camera.panY = pointerY - worldY * nextZoom;
      camera.zoom = nextZoom;
      applyCamera();
    }, { signal, passive:false });

    document.addEventListener("keydown", event => { if (event.code === "Space" && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) { spaceHeld=true; event.preventDefault(); viewport.classList.add("is-pan-ready"); } }, { signal });
    document.addEventListener("keyup", event => { if (event.code === "Space") { spaceHeld=false; viewport.classList.remove("is-pan-ready"); } }, { signal });
    viewport.addEventListener("pointermove", event => {
      const point = screenToCell(event.clientX,event.clientY);
      const label = root.querySelector("#vtt-cursor-position");
      if (label) label.textContent = `${point.x} : ${point.y}`;
    }, { signal });
    viewport.addEventListener("pointerdown", event => {
      const pan = event.button === 1 || event.button === 0 && (spaceHeld || event.target === viewport || event.target === world);
      if (!pan) return;
      const startX=event.clientX, startY=event.clientY, startPanX=camera.panX, startPanY=camera.panY;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
      const move = pointer => { camera.panX=startPanX+pointer.clientX-startX; camera.panY=startPanY+pointer.clientY-startY; applyCamera(); };
      const up = pointer => { viewport.releasePointerCapture(pointer.pointerId); viewport.classList.remove("is-panning"); viewport.removeEventListener("pointermove",move); viewport.removeEventListener("pointerup",up); };
      viewport.addEventListener("pointermove",move);
      viewport.addEventListener("pointerup",up,{once:true});
      event.preventDefault();
    }, { signal });

    if (isDm) {
      viewport.addEventListener("dragover", event => { event.preventDefault(); viewport.classList.add("is-drag-over"); }, { signal });
      viewport.addEventListener("dragleave", () => viewport.classList.remove("is-drag-over"), { signal });
      viewport.addEventListener("drop", event => {
        event.preventDefault(); viewport.classList.remove("is-drag-over");
        const assetId = event.dataTransfer.getData("text/tabaxi-asset");
        if (!assetId) return;
        const point = screenToCell(event.clientX,event.clientY);
        emit(ctx,"scene:asset-place",{assetId,x:point.x,y:point.y},"Ресурс размещён");
      }, { signal });
    }

    const bindDrag = (element, kind, item) => {
      element.addEventListener("click", () => { setSelection(room,{kind,id:item.id}); render(root,ctx); }, { signal });
      if (element.dataset.vttMovable !== "1") return;
      element.addEventListener("pointerdown", event => {
        if (event.button !== 0 || spaceHeld) return;
        event.stopPropagation();
        const startX=event.clientX, startY=event.clientY, originalX=Number(item.x)||0, originalY=Number(item.y)||0;
        let nextX=originalX,nextY=originalY,moved=false;
        element.setPointerCapture(event.pointerId);
        const move = pointer => {
          const dx=(pointer.clientX-startX)/camera.zoom/cell, dy=(pointer.clientY-startY)/camera.zoom/cell;
          nextX=grid.snap===false?Math.round((originalX+dx)*10)/10:Math.round(originalX+dx);
          nextY=grid.snap===false?Math.round((originalY+dy)*10)/10:Math.round(originalY+dy);
          element.style.setProperty("--x",nextX); element.style.setProperty("--y",nextY); moved=true;
        };
        const up = pointer => {
          element.releasePointerCapture(pointer.pointerId); element.removeEventListener("pointermove",move); element.removeEventListener("pointerup",up);
          if (moved) emit(ctx,kind === "token" ? "scene:token-move" : "scene:object-move",kind === "token" ? {tokenId:item.id,x:nextX,y:nextY}:{objectId:item.id,x:nextX,y:nextY});
          else { setSelection(room,{kind,id:item.id}); render(root,ctx); }
        };
        element.addEventListener("pointermove",move); element.addEventListener("pointerup",up,{once:true});
        event.preventDefault();
      }, { signal });
    };
    root.querySelectorAll("[data-vtt-token]").forEach(element => bindDrag(element,"token",(scene.tokens||[]).find(entry=>entry.id===element.dataset.vttToken)));
    root.querySelectorAll("[data-vtt-object]").forEach(element => bindDrag(element,"object",(scene.objects||[]).find(entry=>entry.id===element.dataset.vttObject)));

    root.querySelectorAll("[data-vtt-scene]").forEach(button => button.addEventListener("click",()=>{
      if (!button.classList.contains("active") && isDm) emit(ctx,"scene:activate",{sceneId:button.dataset.vttScene},"Сцена показана игрокам");
    },{signal}));
    root.querySelector("#vtt-scene-new")?.addEventListener("click",()=>openSceneCreate(ctx),{signal});
    root.querySelector("#vtt-scene-copy")?.addEventListener("click",()=>emit(ctx,"scene:duplicate",{sceneId:scene.id},"Сцена скопирована"),{signal});
    root.querySelector("#vtt-scene-delete")?.addEventListener("click",()=>{ if(confirm(`Удалить сцену «${scene.name}»?`)) emit(ctx,"scene:remove",{sceneId:scene.id},"Сцена удалена"); },{signal});
    root.querySelector("#vtt-scene-settings")?.addEventListener("click",()=>openSceneSettings(ctx),{signal});
    root.querySelector("#vtt-add-party")?.addEventListener("click",()=>emit(ctx,"scene:party-add",{},"Токены партии добавлены"),{signal});
    root.querySelector("#vtt-own-initiative")?.addEventListener("click",()=>{ const token=(scene.tokens||[]).find(entry=>entry.playerId===ctx.clientId); if(token) emit(ctx,"initiative:roll",{tokenId:token.id}); },{signal});

    root.querySelectorAll("[data-vtt-asset-filter]").forEach(button=>button.addEventListener("click",()=>{assetFilter=button.dataset.vttAssetFilter;render(root,ctx);},{signal}));
    root.querySelector("#vtt-asset-search")?.addEventListener("input",event=>{const position=event.target.selectionStart;assetSearch=event.target.value;render(root,ctx);requestAnimationFrame(()=>{const next=root.querySelector("#vtt-asset-search");if(next){next.focus();next.setSelectionRange(position,position);}});},{signal});
    root.querySelectorAll("[data-vtt-asset]").forEach(card=>{
      card.addEventListener("dragstart",event=>{event.dataTransfer.setData("text/tabaxi-asset",card.dataset.vttAsset);event.dataTransfer.effectAllowed="copy";},{signal});
    });
    root.querySelectorAll("[data-vtt-place]").forEach(button=>button.addEventListener("click",()=>{const point=cameraCenterCell();emit(ctx,"scene:asset-place",{assetId:button.dataset.vttPlace,x:point.x,y:point.y},"Ресурс размещён");},{signal}));
    root.querySelectorAll("[data-vtt-asset-edit]").forEach(button=>button.addEventListener("click",()=>openAssetEditor(ctx,(room.assets||[]).find(asset=>asset.id===button.dataset.vttAssetEdit)),{signal}));

    let uploadCategory="token";
    const input=root.querySelector("#vtt-file-input");
    root.querySelectorAll("[data-vtt-upload]").forEach(button=>button.addEventListener("click",()=>{uploadCategory=button.dataset.vttUpload;input.click();},{signal}));
    input?.addEventListener("change",async()=>{
      const files=[...input.files]; input.value="";
      for(const file of files) await uploadAsset(ctx,file,uploadCategory);
    },{signal});

    root.querySelectorAll("[data-vtt-focus-token]").forEach(button=>button.addEventListener("click",()=>{
      const token=(scene.tokens||[]).find(entry=>entry.id===button.dataset.vttFocusToken); if(!token)return;
      setSelection(room,{kind:"token",id:token.id}); centerCamera(token.x,token.y,Math.max(camera.zoom,.85)); render(root,ctx);
    },{signal}));
    root.querySelectorAll("[data-vtt-initiative]").forEach(input=>input.addEventListener("change",()=>emit(ctx,"initiative:set",{tokenId:input.dataset.vttInitiative,value:input.value}),{signal}));
    root.querySelector("#vtt-next-turn")?.addEventListener("click",()=>emit(ctx,"initiative:next"),{signal});
    root.querySelector("#vtt-clear-initiative")?.addEventListener("click",()=>{if(confirm("Сбросить инициативу?"))emit(ctx,"initiative:clear");},{signal});

    root.querySelectorAll("[data-vtt-edit-token]").forEach(button=>button.addEventListener("click",()=>openTokenEditor(ctx,(scene.tokens||[]).find(token=>token.id===button.dataset.vttEditToken)),{signal}));
    root.querySelectorAll("[data-vtt-roll]").forEach(button=>button.addEventListener("click",()=>emit(ctx,"initiative:roll",{tokenId:button.dataset.vttRoll}),{signal}));
    root.querySelectorAll("[data-vtt-duplicate-token]").forEach(button=>button.addEventListener("click",()=>emit(ctx,"scene:token-duplicate",{tokenId:button.dataset.vttDuplicateToken,count:1},"Токен скопирован"),{signal}));
    root.querySelectorAll("[data-vtt-remove-token]").forEach(button=>button.addEventListener("click",()=>{const token=(scene.tokens||[]).find(entry=>entry.id===button.dataset.vttRemoveToken);if(token&&confirm(`Удалить «${token.name}»?`))emit(ctx,"scene:token-remove",{tokenId:token.id});},{signal}));
    root.querySelectorAll("[data-vtt-edit-object]").forEach(button=>button.addEventListener("click",()=>openObjectEditor(ctx,(scene.objects||[]).find(object=>object.id===button.dataset.vttEditObject)),{signal}));
    root.querySelectorAll("[data-vtt-duplicate-object]").forEach(button=>button.addEventListener("click",()=>emit(ctx,"scene:object-duplicate",{objectId:button.dataset.vttDuplicateObject},"Объект скопирован"),{signal}));
    root.querySelectorAll("[data-vtt-remove-object]").forEach(button=>button.addEventListener("click",()=>{const object=(scene.objects||[]).find(entry=>entry.id===button.dataset.vttRemoveObject);if(object&&confirm(`Удалить «${object.name}»?`))emit(ctx,"scene:object-remove",{objectId:object.id});},{signal}));
  }

  function openSceneCreate(ctx) {
    ctx.openModal("Новая сцена",`<div class="vtt-modal-form"><label>Название<input id="vtt-new-scene-name" value="Новая сцена"></label><label class="toggle-row"><span><strong>Сразу показать игрокам</strong><small>Сделает сцену активной</small></span><input id="vtt-new-scene-active" type="checkbox" checked><i></i></label><div class="modal-actions"><button id="vtt-new-scene-save" class="primary">Создать</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-new-scene-save")?.addEventListener("click",()=>{emit(ctx,"scene:create",{name:document.querySelector("#vtt-new-scene-name").value,activate:document.querySelector("#vtt-new-scene-active").checked},"Сцена создана");ctx.closeModal();});
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function openSceneSettings(ctx) {
    const scene=ctx.room.scene,grid=scene.grid||{};
    ctx.openModal("Настройки сцены",`<div class="vtt-modal-form"><label>Название<input id="vtt-scene-name" value="${esc(scene.name)}"></label><div class="two-col"><label>Цвет поля<input id="vtt-scene-color" type="color" value="${esc(scene.backgroundColor||"#17120e")}"></label><label>Размер клетки<input id="vtt-scene-cell" type="number" min="20" max="160" value="${Number(grid.cellSize||52)}"></label></div><div class="two-col"><label>Цвет сетки<input id="vtt-grid-color" type="color" value="${esc(grid.color||"#d3ad6e")}"></label><label>Прозрачность сетки<input id="vtt-grid-opacity" type="number" min="0.03" max="1" step="0.01" value="${Number(grid.opacity||.22)}"></label></div><div class="item-toggle-grid"><label class="toggle-row"><span><strong>Показывать сетку</strong><small>Можно скрыть поверх готовой карты</small></span><input id="vtt-grid-visible" type="checkbox" ${grid.visible!==false?"checked":""}><i></i></label><label class="toggle-row"><span><strong>Привязка к сетке</strong><small>Токены двигаются по клеткам</small></span><input id="vtt-grid-snap" type="checkbox" ${grid.snap!==false?"checked":""}><i></i></label></div><div class="modal-actions"><button id="vtt-scene-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-scene-save")?.addEventListener("click",()=>{emit(ctx,"scene:settings",{name:document.querySelector("#vtt-scene-name").value,backgroundColor:document.querySelector("#vtt-scene-color").value,grid:{cellSize:Number(document.querySelector("#vtt-scene-cell").value),color:document.querySelector("#vtt-grid-color").value,opacity:Number(document.querySelector("#vtt-grid-opacity").value),visible:document.querySelector("#vtt-grid-visible").checked,snap:document.querySelector("#vtt-grid-snap").checked}},"Сцена обновлена");ctx.closeModal();});
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function openTokenEditor(ctx, token) {
    if(!token)return;
    const isDm=ctx.room.dmId===ctx.clientId,npc=!token.playerId;
    ctx.openModal("Настройки токена",`<div class="vtt-modal-form">${npc?`<label>Имя<input id="vtt-token-name" value="${esc(token.name)}"></label><div class="two-col"><label>Цвет рамки<input id="vtt-token-color" type="color" value="${esc(token.color||"#9f7842")}"></label><label>Размер<input id="vtt-token-size" type="number" min="0.25" max="12" step="0.25" value="${Number(token.size||1)}"></label></div><div class="two-col"><label>Поворот<input id="vtt-token-rotation" type="number" value="${Number(token.rotation||0)}"></label><label>Прозрачность<input id="vtt-token-opacity" type="number" min="0.05" max="1" step="0.05" value="${Number(token.opacity||1)}"></label></div><div class="two-col"><label>Зрение<input id="vtt-token-vision" type="number" value="${Number(token.vision||0)}"></label><label>Бонус инициативы<input id="vtt-token-init" type="number" value="${Number(token.initiativeBonus||0)}"></label></div>`:`<div class="read-only">Имя и изображение связаны с листом персонажа. Ведущий может скрыть или заблокировать токен.</div>`}${isDm?`<div class="item-toggle-grid"><label class="toggle-row"><span><strong>Скрытый</strong><small>Не передаётся игрокам</small></span><input id="vtt-token-hidden" type="checkbox" ${token.hidden?"checked":""}><i></i></label><label class="toggle-row"><span><strong>Заблокирован</strong><small>Не двигается случайно</small></span><input id="vtt-token-locked" type="checkbox" ${token.locked?"checked":""}><i></i></label></div>`:""}<div class="modal-actions"><button id="vtt-token-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-token-save")?.addEventListener("click",()=>{emit(ctx,"scene:token-update",{tokenId:token.id,name:document.querySelector("#vtt-token-name")?.value,color:document.querySelector("#vtt-token-color")?.value,size:Number(document.querySelector("#vtt-token-size")?.value),rotation:Number(document.querySelector("#vtt-token-rotation")?.value),opacity:Number(document.querySelector("#vtt-token-opacity")?.value),vision:Number(document.querySelector("#vtt-token-vision")?.value),initiativeBonus:Number(document.querySelector("#vtt-token-init")?.value),hidden:document.querySelector("#vtt-token-hidden")?.checked,locked:document.querySelector("#vtt-token-locked")?.checked},"Токен обновлён");ctx.closeModal();});
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function openObjectEditor(ctx, object) {
    if(!object)return;
    ctx.openModal("Настройки объекта",`<div class="vtt-modal-form"><label>Название<input id="vtt-object-name" value="${esc(object.name)}"></label><div class="two-col"><label>Ширина, клеток<input id="vtt-object-width" type="number" min="0.25" max="200" step="0.25" value="${Number(object.width)}"></label><label>Высота, клеток<input id="vtt-object-height" type="number" min="0.25" max="200" step="0.25" value="${Number(object.height)}"></label></div><div class="two-col"><label>Поворот<input id="vtt-object-rotation" type="number" value="${Number(object.rotation||0)}"></label><label>Прозрачность<input id="vtt-object-opacity" type="number" min="0.03" max="1" step="0.05" value="${Number(object.opacity||1)}"></label></div><label>Слой<input id="vtt-object-z" type="number" min="-1000" max="1000" value="${Number(object.z||0)}"></label><div class="item-toggle-grid"><label class="toggle-row"><span><strong>Скрытый</strong><small>Виден только ведущему</small></span><input id="vtt-object-hidden" type="checkbox" ${object.hidden?"checked":""}><i></i></label><label class="toggle-row"><span><strong>Заблокирован</strong><small>Защита от случайного движения</small></span><input id="vtt-object-locked" type="checkbox" ${object.locked?"checked":""}><i></i></label></div><div class="modal-actions"><button id="vtt-object-save" class="primary">Сохранить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-object-save")?.addEventListener("click",()=>{emit(ctx,"scene:object-update",{objectId:object.id,name:document.querySelector("#vtt-object-name").value,width:Number(document.querySelector("#vtt-object-width").value),height:Number(document.querySelector("#vtt-object-height").value),rotation:Number(document.querySelector("#vtt-object-rotation").value),opacity:Number(document.querySelector("#vtt-object-opacity").value),z:Number(document.querySelector("#vtt-object-z").value),hidden:document.querySelector("#vtt-object-hidden").checked,locked:document.querySelector("#vtt-object-locked").checked},"Объект обновлён");ctx.closeModal();});
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  function openAssetEditor(ctx, asset) {
    if(!asset)return;
    ctx.openModal("Ресурс библиотеки",`<div class="vtt-modal-form"><div class="vtt-asset-large"><img src="${esc(asset.url)}" alt=""></div><label>Название<input id="vtt-asset-name" value="${esc(asset.name)}"></label><div class="two-col"><label>Категория<select id="vtt-asset-category"><option value="token" ${asset.category==="token"?"selected":""}>Токен</option><option value="map" ${asset.category==="map"?"selected":""}>Карта</option><option value="prop" ${asset.category==="prop"?"selected":""}>Объект</option></select></label><label>Размер по умолчанию<input id="vtt-asset-size" type="number" min="0.25" max="30" step="0.25" value="${Number(asset.defaultSize||1)}"></label></div><label>Теги через запятую<input id="vtt-asset-tags" value="${esc((asset.tags||[]).join(", "))}"></label><div class="modal-actions"><button id="vtt-asset-save" class="primary">Сохранить</button><button id="vtt-asset-delete" class="danger-action">Удалить</button><button id="vtt-modal-cancel">Отмена</button></div></div>`);
    document.querySelector("#vtt-asset-save")?.addEventListener("click",async()=>{const response=await fetch(`/api/rooms/${ctx.room.code}/assets/${asset.id}`,{method:"PATCH",headers:{"content-type":"application/json","x-client-id":ctx.clientId},body:JSON.stringify({name:document.querySelector("#vtt-asset-name").value,category:document.querySelector("#vtt-asset-category").value,defaultSize:Number(document.querySelector("#vtt-asset-size").value),tags:document.querySelector("#vtt-asset-tags").value.split(",").map(value=>value.trim()).filter(Boolean)})}).then(r=>r.json()).catch(()=>({ok:false,error:"Сеть недоступна"}));if(!response.ok)ctx.toast(response.error);else{ctx.toast("Ресурс обновлён");ctx.closeModal();}});
    document.querySelector("#vtt-asset-delete")?.addEventListener("click",async()=>{if(!confirm(`Удалить «${asset.name}» из библиотеки?`))return;let url=`/api/rooms/${ctx.room.code}/assets/${asset.id}`;let response=await fetch(url,{method:"DELETE",headers:{"x-client-id":ctx.clientId}}).then(r=>r.json());if(!response.ok&&response.usageCount&&confirm(`${response.error}. Удалить также все экземпляры со сцен?`))response=await fetch(`${url}?force=1`,{method:"DELETE",headers:{"x-client-id":ctx.clientId}}).then(r=>r.json());if(!response.ok)ctx.toast(response.error);else{ctx.toast("Ресурс удалён");ctx.closeModal();}});
    document.querySelector("#vtt-modal-cancel")?.addEventListener("click",ctx.closeModal);
  }

  async function uploadAsset(ctx, file, category) {
    if (!file.type.match(/^image\/(png|jpeg|webp|gif)$/)) return ctx.toast(`${file.name}: неподдерживаемый формат`);
    if (file.size > 15*1024*1024) return ctx.toast(`${file.name}: больше 15 МБ`);
    ctx.toast(`Загрузка: ${file.name}`);
    const dataUrl = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const dimensions = await new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve({width:0,height:0});image.src=dataUrl;});
    const response = await fetch(`/api/rooms/${ctx.room.code}/assets`,{method:"POST",headers:{"content-type":"application/json","x-client-id":ctx.clientId},body:JSON.stringify({name:file.name.replace(/\.[^.]+$/, ""),fileName:file.name,category,dataUrl,width:dimensions.width,height:dimensions.height,defaultSize:category==="map"?20:1})}).then(r=>r.json()).catch(()=>({ok:false,error:"Не удалось загрузить файл"}));
    if(!response.ok)ctx.toast(response.error);else ctx.toast(response.duplicate?"Такой ресурс уже есть":"Ресурс сохранён в библиотеке");
  }

  window.TT_VTT = { render };
})();
