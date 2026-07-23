(() => {
  "use strict";

  const state = {
    catalog:null,
    manifest:null,
    selectedKey:"",
    selected:null,
    query:"",
    type:"all",
    size:"all",
    cr:"all",
    disposition:"hostile",
    busy:false,
    error:""
  };

  const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const signed = value => `${Number(value) >= 0 ? "+" : ""}${Number(value) || 0}`;
  const abilityMod = value => Math.floor((Number(value || 10) - 10) / 2);
  const crLabel = value => Number(value) === .125 ? "1/8" : Number(value) === .25 ? "1/4" : Number(value) === .5 ? "1/2" : String(value);
  const sizeLabels = { tiny:"Крошечный", small:"Маленький", medium:"Средний", large:"Большой", huge:"Огромный", gargantuan:"Громадный" };
  const speedLabels = { walk:"ходьба", fly:"полёт", swim:"плавание", climb:"лазание", burrow:"копание" };
  const abilityLabels = { str:"СИЛ", dex:"ЛОВ", con:"ТЕЛ", int:"ИНТ", wis:"МДР", cha:"ХАР" };

  async function json(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Не удалось загрузить бестиарий");
    return payload;
  }

  async function ensureCatalog() {
    if (state.catalog) return;
    const payload = await json("/api/bestiary/catalog");
    state.catalog = Array.isArray(payload.monsters) ? payload.monsters : [];
    state.manifest = payload.manifest || {};
    if (!state.selectedKey && state.catalog.length) state.selectedKey = state.catalog[0].key;
  }

  async function ensureSelected() {
    if (!state.selectedKey) return;
    if (state.selected?.key === state.selectedKey) return;
    const payload = await json(`/api/bestiary/${encodeURIComponent(state.selectedKey)}`);
    state.selected = payload.monster || null;
  }

  function filteredCatalog() {
    const query = state.query.trim().toLocaleLowerCase("ru");
    return (state.catalog || []).filter(monster => {
      if (query && !`${monster.name} ${monster.enName} ${monster.typeLabel} ${monster.subtype}`.toLocaleLowerCase("ru").includes(query)) return false;
      if (state.type !== "all" && monster.type !== state.type) return false;
      if (state.size !== "all" && monster.size !== state.size) return false;
      if (state.cr !== "all") {
        const [min,max] = state.cr.split(":").map(Number);
        if (Number(monster.cr) < min || Number(monster.cr) > max) return false;
      }
      return true;
    });
  }

  function optionValues(items, key, label) {
    const values = [...new Map(items.map(item => [item[key], item])).values()].sort((a,b) => String(label(a)).localeCompare(String(label(b)),"ru"));
    return values.map(item => `<option value="${esc(item[key])}">${esc(label(item))}</option>`).join("");
  }

  function catalogMarkup() {
    const filtered = filteredCatalog();
    return filtered.length ? filtered.map(monster => `<button type="button" class="bestiary-entry ${monster.key === state.selectedKey ? "active" : ""}" data-bestiary-select="${esc(monster.key)}">
      <span class="bestiary-entry-image">${monster.portrait ? `<img loading="lazy" src="${esc(monster.portrait)}" alt="">` : `<b>${esc(monster.name[0] || "?")}</b>`}</span>
      <span class="bestiary-entry-main"><strong>${esc(monster.name)}</strong><small>${esc(sizeLabels[monster.size] || monster.size)} · ${esc(monster.typeLabel)}${monster.subtype ? ` (${esc(monster.subtype)})` : ""}</small></span>
      <span class="bestiary-entry-stats"><b>CR ${esc(crLabel(monster.cr))}</b><small>${Number(monster.hp)} HP · КД ${Number(monster.ac)}</small></span>
    </button>`).join("") : `<div class="bestiary-empty">По этим фильтрам никого нет.</div>`;
  }

  function defenseRow(monster) {
    const parts = [];
    if (monster.vulnerabilities?.length) parts.push(`<span><b>Уязвимости</b>${esc(monster.vulnerabilities.join(", "))}</span>`);
    if (monster.resistances?.length) parts.push(`<span><b>Сопротивления</b>${esc(monster.resistances.join(", "))}</span>`);
    if (monster.immunities?.length) parts.push(`<span><b>Иммунитеты</b>${esc(monster.immunities.join(", "))}</span>`);
    if (monster.conditionImmunities?.length) parts.push(`<span><b>Иммунитеты к состояниям</b>${esc(monster.conditionImmunities.join(", "))}</span>`);
    return parts.length ? `<div class="bestiary-defenses">${parts.join("")}</div>` : "";
  }

  function featureSection(title, items) {
    if (!items?.length) return "";
    return `<section class="bestiary-detail-section"><h3>${esc(title)}</h3><div class="bestiary-feature-list">${items.map(item => `<article><strong>${esc(item.name)}</strong>${item.attackFormula ? `<div class="bestiary-action-formulas"><code>${esc(item.attackFormula)}</code>${item.damageFormula ? `<code>${esc(item.damageFormula)} ${esc(item.damageType)}</code>` : ""}</div>` : item.formula ? `<div class="bestiary-action-formulas"><code>${esc(item.formula)}</code></div>` : ""}<p>${esc(item.text)}</p></article>`).join("")}</div></section>`;
  }

  function detailMarkup(ctx) {
    const monster = state.selected;
    if (!monster) return `<div class="bestiary-detail-loading">Выбери существо.</div>`;
    const speed = Object.entries(monster.speed || {}).filter(([,value]) => Number(value)>0).map(([key,value]) => `${speedLabels[key] || key} ${value} фт.`).join(", ") || "—";
    const senses = [monster.senses?.darkvision ? `тёмное зрение ${monster.senses.darkvision} фт.` : "",monster.senses?.blindsight ? `слепое зрение ${monster.senses.blindsight} фт.` : "",monster.senses?.tremorsense ? `чувство вибрации ${monster.senses.tremorsense} фт.` : "",monster.senses?.truesight ? `истинное зрение ${monster.senses.truesight} фт.` : "",`пассивное Восприятие ${monster.senses?.passivePerception || 10}`].filter(Boolean).join(", ");
    return `<article class="bestiary-detail-card">
      <header class="bestiary-detail-hero">
        <div class="bestiary-portrait">${monster.portrait ? `<img src="${esc(monster.portrait)}" alt="${esc(monster.name)}">` : `<b>${esc(monster.name[0] || "?")}</b>`}</div>
        <div class="bestiary-detail-title"><span class="eyebrow">${esc(monster.source)} · CR ${esc(crLabel(monster.cr))}</span><h2>${esc(monster.name)}</h2><p>${esc(monster.enName)}</p><small>${esc(sizeLabels[monster.size] || monster.size)} ${esc(monster.typeLabel.toLowerCase())}${monster.subtype ? ` (${esc(monster.subtype)})` : ""}, ${esc(monster.alignment)}</small></div>
      </header>
      <div class="bestiary-vitals"><span><small>КД</small><strong>${monster.ac.value}</strong><i>${esc(monster.ac.note || "—")}</i></span><span><small>HP</small><strong>${monster.hp.average}</strong><i>${esc(monster.hp.formula)}</i></span><span><small>Скорость</small><strong>${esc(speed)}</strong><i>${monster.xp} опыта</i></span></div>
      <div class="bestiary-abilities">${Object.entries(monster.abilities || {}).map(([key,value]) => `<span><small>${abilityLabels[key] || key}</small><strong>${value}</strong><b>${signed(abilityMod(value))}</b></span>`).join("")}</div>
      <div class="bestiary-meta"><span><b>Чувства</b>${esc(senses)}</span><span><b>Языки</b>${esc(monster.languages?.join(", ") || "—")}</span><span><b>Местность</b>${esc(monster.environment?.join(", ") || "—")}</span></div>
      ${defenseRow(monster)}
      ${featureSection("Особенности",monster.traits)}
      ${featureSection("Действия",monster.actions)}
      ${featureSection("Бонусные действия",monster.bonusActions)}
      ${featureSection("Реакции",monster.reactions)}
      ${featureSection("Легендарные действия",monster.legendaryActions)}
      ${monster.description ? `<section class="bestiary-detail-section bestiary-description"><h3>Кратко</h3><p>${esc(monster.description)}</p></section>` : ""}
      <footer class="bestiary-place-panel">
        ${ctx.isDm ? `<div><label>Отношение<select data-bestiary-disposition><option value="hostile" ${state.disposition==="hostile"?"selected":""}>Противник</option><option value="neutral" ${state.disposition==="neutral"?"selected":""}>Нейтральный</option><option value="friendly" ${state.disposition==="friendly"?"selected":""}>Союзник</option></select></label></div><div class="bestiary-place-buttons"><button type="button" class="primary" data-bestiary-place="1">Поставить</button><button type="button" data-bestiary-place="3">×3</button><button type="button" data-bestiary-place="5">×5</button></div>` : `<div class="read-only">Размещать существ на карте может ведущий.</div>`}
        ${monster.sourceUrl ? `<a href="${esc(monster.sourceUrl)}" target="_blank" rel="noreferrer">Открыть источник ↗</a>` : ""}
      </footer>
    </article>`;
  }

  function shellMarkup(ctx) {
    const items = state.catalog || [];
    return `<div class="bestiary-shell">
      <header class="bestiary-head"><div><span class="eyebrow">TabaxiTable 2.5</span><h1>Бестиарий</h1><p>${esc(state.manifest?.name || "Каталог существ")} · ${items.length} существ</p></div><div class="bestiary-head-mark">☷</div></header>
      <section class="bestiary-browser">
        <aside class="bestiary-sidebar">
          <div class="bestiary-filters"><input type="search" data-bestiary-search value="${esc(state.query)}" placeholder="Поиск по имени или типу"><select data-bestiary-type><option value="all">Все типы</option>${optionValues(items,"type",item=>item.typeLabel)}</select><select data-bestiary-size><option value="all">Все размеры</option>${optionValues(items,"size",item=>sizeLabels[item.size]||item.size)}</select><select data-bestiary-cr><option value="all">Любая опасность</option><option value="0:0.5">CR 0–1/2</option><option value="1:4">CR 1–4</option><option value="5:10">CR 5–10</option><option value="11:30">CR 11+</option></select></div>
          <div class="bestiary-result-count">Найдено: <b>${filteredCatalog().length}</b></div>
          <div class="bestiary-list">${catalogMarkup()}</div>
        </aside>
        <main class="bestiary-detail">${detailMarkup(ctx)}</main>
      </section>
    </div>`;
  }

  function bind(root, ctx, helpers) {
    root.querySelector("[data-bestiary-search]")?.addEventListener("input", event => { state.query=event.target.value; paint(root,ctx,helpers,false); });
    root.querySelector("[data-bestiary-type]")?.addEventListener("change", event => { state.type=event.target.value; paint(root,ctx,helpers,false); });
    root.querySelector("[data-bestiary-size]")?.addEventListener("change", event => { state.size=event.target.value; paint(root,ctx,helpers,false); });
    root.querySelector("[data-bestiary-cr]")?.addEventListener("change", event => { state.cr=event.target.value; paint(root,ctx,helpers,false); });
    root.querySelectorAll("[data-bestiary-select]").forEach(button => button.addEventListener("click", async () => {
      state.selectedKey=button.dataset.bestiarySelect;
      state.selected=null;
      root.querySelector(".bestiary-detail").innerHTML='<div class="bestiary-detail-loading">Открываю статблок…</div>';
      try { await ensureSelected(); } catch(error) { state.error=error.message; helpers.toast(error.message); }
      paint(root,ctx,helpers,false);
    }));
    root.querySelector("[data-bestiary-disposition]")?.addEventListener("change", event => { state.disposition=event.target.value; });
    root.querySelectorAll("[data-bestiary-place]").forEach(button => button.addEventListener("click", async () => {
      if (state.busy || !state.selectedKey) return;
      state.busy=true;
      root.querySelectorAll("[data-bestiary-place]").forEach(item=>item.disabled=true);
      const point=helpers.cameraCenterGrid?.()||{x:0,y:0};
      const response=await helpers.emit("bestiary:place",{key:state.selectedKey,count:Number(button.dataset.bestiaryPlace)||1,x:point.x,y:point.y,disposition:state.disposition});
      state.busy=false;
      if (!response?.ok) { helpers.toast(response?.error||"Не удалось разместить существо"); paint(root,ctx,helpers,false); return; }
      helpers.toast(`${response.monster?.name||"Существо"} размещён`);
      helpers.switchView("map");
    }));
    root.querySelectorAll("img").forEach(image => image.addEventListener("error",()=>image.closest(".bestiary-entry-image,.bestiary-portrait")?.classList.add("image-missing"),{once:true}));
  }

  function paint(root,ctx,helpers,scrollTop=true) {
    const sidebarScroll=root.querySelector(".bestiary-list")?.scrollTop||0;
    root.innerHTML=shellMarkup(ctx);
    if (!scrollTop) root.querySelector(".bestiary-list")?.scrollTo(0,sidebarScroll);
    const type=root.querySelector("[data-bestiary-type]"); if(type) type.value=state.type;
    const size=root.querySelector("[data-bestiary-size]"); if(size) size.value=state.size;
    const cr=root.querySelector("[data-bestiary-cr]"); if(cr) cr.value=state.cr;
    bind(root,ctx,helpers);
  }

  async function render(root,ctx,helpers) {
    root.innerHTML='<div class="bestiary-loading"><span>☷</span><strong>Открываю бестиарий…</strong></div>';
    try {
      await ensureCatalog();
      await ensureSelected();
      paint(root,ctx,helpers);
    } catch(error) {
      state.error=error.message;
      root.innerHTML=`<div class="bestiary-error"><strong>Бестиарий не загрузился</strong><p>${esc(error.message)}</p><button type="button" data-bestiary-retry>Повторить</button></div>`;
      root.querySelector("[data-bestiary-retry]")?.addEventListener("click",()=>{state.catalog=null;state.selected=null;render(root,ctx,helpers);});
    }
  }

  function open(key) {
    if (key) { state.selectedKey=String(key); state.selected=null; }
  }

  window.TT_BESTIARY={render,open};
})();
