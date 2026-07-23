(() => {
  "use strict";

  const OUTPUT_SIZE = 512;
  const DEFAULTS = Object.freeze({
    editingAssetId:"", sourceAssetId:"", sourceUrl:"", sourceName:"",
    name:"Новый токен", shape:"circle", imageScale:1.15, offsetX:0, offsetY:0, rotation:0,
    frameColor:"#d3ad6e", frameSecondary:"#3a2415", frameWidth:18, glow:.35, shadow:.65, backgroundColor:"#17120e",
    size:1, hpMax:10, hp:10, ac:10, vision:60, disposition:"hostile",
    showName:true, showHp:true, showAc:false, folder:"Кузница токенов", tags:"",
    busy:false, error:""
  });

  let state = { ...DEFAULTS };
  const imageCache = new Map();
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const clamp = (value,min,max) => Math.max(min,Math.min(max,Number(value)||0));
  const numberOr = (value,fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const safeHex = (value,fallback) => /^#[0-9a-f]{6}$/i.test(String(value||"")) ? value : fallback;
  const relationLabel = { friendly:"Союзник", neutral:"Нейтральный", hostile:"Противник" };

  function reset() { state = { ...DEFAULTS }; }

  function normalizeRecipe(recipe = {}) {
    const image = recipe.image || {};
    const frame = recipe.frame || {};
    const defaults = recipe.defaults || {};
    return {
      ...DEFAULTS,
      editingAssetId:String(recipe.editingAssetId || ""),
      sourceAssetId:String(recipe.sourceAssetId || ""),
      sourceUrl:String(recipe.sourceUrl || ""),
      sourceName:String(recipe.sourceName || ""),
      name:String(recipe.name || DEFAULTS.name).slice(0,80),
      shape:["circle","square","hex"].includes(recipe.shape) ? recipe.shape : DEFAULTS.shape,
      imageScale:clamp(numberOr(image.scale ?? recipe.imageScale,DEFAULTS.imageScale),.5,4),
      offsetX:clamp(numberOr(image.offsetX ?? recipe.offsetX,DEFAULTS.offsetX),-100,100),
      offsetY:clamp(numberOr(image.offsetY ?? recipe.offsetY,DEFAULTS.offsetY),-100,100),
      rotation:clamp(numberOr(image.rotation ?? recipe.rotation,DEFAULTS.rotation),-180,180),
      frameColor:safeHex(frame.primary ?? recipe.frameColor,DEFAULTS.frameColor),
      frameSecondary:safeHex(frame.secondary ?? recipe.frameSecondary,DEFAULTS.frameSecondary),
      frameWidth:clamp(numberOr(frame.width ?? recipe.frameWidth,DEFAULTS.frameWidth),0,42),
      glow:clamp(numberOr(frame.glow ?? recipe.glow,DEFAULTS.glow),0,1),
      shadow:clamp(numberOr(frame.shadow ?? recipe.shadow,DEFAULTS.shadow),0,1),
      backgroundColor:safeHex(recipe.backgroundColor,DEFAULTS.backgroundColor),
      size:clamp(numberOr(defaults.size ?? recipe.size,DEFAULTS.size),.25,12),
      hpMax:clamp(numberOr(defaults.hpMax ?? recipe.hpMax,DEFAULTS.hpMax),1,1000000),
      hp:clamp(numberOr(defaults.hp ?? recipe.hp,DEFAULTS.hp),0,1000000),
      ac:clamp(numberOr(defaults.ac ?? recipe.ac,DEFAULTS.ac),0,1000),
      vision:clamp(numberOr(defaults.vision ?? recipe.vision,DEFAULTS.vision),0,10000),
      disposition:["friendly","neutral","hostile"].includes(defaults.disposition ?? recipe.disposition) ? (defaults.disposition ?? recipe.disposition) : DEFAULTS.disposition,
      showName:(defaults.showName ?? recipe.showName) !== false,
      showHp:(defaults.showHp ?? recipe.showHp) !== false,
      showAc:Boolean(defaults.showAc ?? recipe.showAc),
      folder:String(recipe.folder || DEFAULTS.folder).slice(0,60),
      tags:Array.isArray(recipe.tags) ? recipe.tags.join(", ") : String(recipe.tags || ""),
      busy:false,error:""
    };
  }

  function openAsset(asset, room) {
    if (!asset) return;
    state = normalizeRecipe(asset.tokenRecipe || {});
    state.editingAssetId = asset.id;
    state.name = asset.name || state.name;
    state.folder = asset.folder || state.folder;
    state.tags = Array.isArray(asset.tags) ? asset.tags.join(", ") : state.tags;
    const source = (room?.assets || []).find(item => item.id === state.sourceAssetId);
    if (source) {
      state.sourceUrl = source.url;
      state.sourceName = source.name;
    } else if (!state.sourceUrl) {
      state.sourceAssetId = asset.id;
      state.sourceUrl = asset.url;
      state.sourceName = asset.name;
    }
  }

  function sourceAssets(room) {
    return (room?.assets || []).filter(asset => ["token","prop","source"].includes(asset.category));
  }

  function markup(ctx) {
    const sources = sourceAssets(ctx.room);
    const sourceOptions = sources.map(asset => `<option value="${esc(asset.id)}" ${asset.id===state.sourceAssetId?"selected":""}>${esc(asset.name)}${asset.category==="source"?" · исходник":""}</option>`).join("");
    const sourceCards = sources.slice(-8).reverse().map(asset => `<button type="button" class="token-forge-source-card ${asset.id===state.sourceAssetId?"active":""}" data-forge-source="${esc(asset.id)}" title="${esc(asset.name)}"><img src="${esc(asset.url)}" alt=""><span>${esc(asset.name)}</span></button>`).join("");
    const shapeButton = (key,label,icon) => `<button type="button" data-forge-shape="${key}" class="${state.shape===key?"active":""}"><span>${icon}</span>${label}</button>`;
    return `<section class="token-forge-shell">
      <header class="token-forge-head"><div><span class="eyebrow">TabaxiTable 2.4</span><h2>Кузница токенов</h2><p>Собери портрет, рамку и игровые параметры — рецепт останется редактируемым.</p></div><button type="button" data-forge-close aria-label="Закрыть">×</button></header>
      <div class="token-forge-workspace">
        <aside class="token-forge-controls token-forge-source-panel">
          <section><div class="token-forge-section-head"><div><small>01</small><h3>Изображение</h3></div><button type="button" id="token-forge-upload">＋ Загрузить</button></div>
            <input id="token-forge-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
            <label>Источник<select id="token-forge-source-select"><option value="">Монограмма без изображения</option>${sourceOptions}</select></label>
            <div class="token-forge-source-grid">${sourceCards || `<div class="token-forge-empty">Загрузи портрет или добавь изображение в библиотеку.</div>`}</div>
          </section>
          <section><div class="token-forge-section-head"><div><small>02</small><h3>Кадрирование</h3></div><button type="button" data-forge-reset-image>Сбросить</button></div>
            <label>Масштаб <output data-forge-output="imageScale">${state.imageScale.toFixed(2)}×</output><input data-forge-field="imageScale" type="range" min="0.5" max="4" step="0.01" value="${state.imageScale}"></label>
            <label>По горизонтали <output data-forge-output="offsetX">${Math.round(state.offsetX)}</output><input data-forge-field="offsetX" type="range" min="-100" max="100" step="1" value="${state.offsetX}"></label>
            <label>По вертикали <output data-forge-output="offsetY">${Math.round(state.offsetY)}</output><input data-forge-field="offsetY" type="range" min="-100" max="100" step="1" value="${state.offsetY}"></label>
            <label>Поворот <output data-forge-output="rotation">${Math.round(state.rotation)}°</output><input data-forge-field="rotation" type="range" min="-180" max="180" step="1" value="${state.rotation}"></label>
            <p class="token-forge-tip">Тяни изображение мышью. Колесо меняет масштаб.</p>
          </section>
        </aside>

        <main class="token-forge-preview-column">
          <div class="token-forge-preview-head"><div><small>Живой предпросмотр</small><strong id="token-forge-preview-title">${esc(state.name)}</strong></div><span id="token-forge-status">${state.error?esc(state.error):"512 × 512 WebP"}</span></div>
          <div class="token-forge-stage" data-forge-stage>
            <div class="token-forge-grid-bg"></div>
            <div class="token-forge-token-preview disposition-${state.disposition}" data-forge-token-preview>
              <canvas id="token-forge-canvas" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}"></canvas>
              <strong data-forge-preview-name>${esc(state.name)}</strong>
              <span class="token-forge-hp" data-forge-preview-hp><i style="width:${Math.round(clamp(state.hp,0,state.hpMax)/Math.max(1,state.hpMax)*100)}%"></i><em>${state.hp}/${state.hpMax}</em></span>
              <b data-forge-preview-ac>◈ ${state.ac}</b>
            </div>
          </div>
          <div class="token-forge-shapes">${shapeButton("circle","Круг","●")}${shapeButton("square","Квадрат","■")}${shapeButton("hex","Шестиугольник","⬢")}</div>
          <div class="token-forge-preview-sizes"><span>На сетке</span>${[.5,1,2,3].map(size=>`<button type="button" data-forge-size="${size}" class="${Number(state.size)===size?"active":""}">${size}×${size}</button>`).join("")}</div>
        </main>

        <aside class="token-forge-controls token-forge-style-panel">
          <section><div class="token-forge-section-head"><div><small>03</small><h3>Оформление</h3></div><button type="button" data-forge-random>Случайный стиль</button></div>
            <div class="token-forge-color-grid"><label>Рамка<input data-forge-field="frameColor" type="color" value="${esc(state.frameColor)}"></label><label>Подложка<input data-forge-field="frameSecondary" type="color" value="${esc(state.frameSecondary)}"></label><label>Фон<input data-forge-field="backgroundColor" type="color" value="${esc(state.backgroundColor)}"></label></div>
            <label>Толщина рамки <output data-forge-output="frameWidth">${Math.round(state.frameWidth)}</output><input data-forge-field="frameWidth" type="range" min="0" max="42" step="1" value="${state.frameWidth}"></label>
            <label>Свечение <output data-forge-output="glow">${Math.round(state.glow*100)}%</output><input data-forge-field="glow" type="range" min="0" max="1" step="0.01" value="${state.glow}"></label>
            <label>Тень <output data-forge-output="shadow">${Math.round(state.shadow*100)}%</output><input data-forge-field="shadow" type="range" min="0" max="1" step="0.01" value="${state.shadow}"></label>
          </section>
          <section><div class="token-forge-section-head"><div><small>04</small><h3>Параметры</h3></div></div>
            <label>Название<input data-forge-field="name" maxlength="80" value="${esc(state.name)}"></label>
            <div class="token-forge-form-grid"><label>HP<input data-forge-field="hp" type="number" min="0" max="1000000" value="${state.hp}"></label><label>Макс. HP<input data-forge-field="hpMax" type="number" min="1" max="1000000" value="${state.hpMax}"></label><label>КД<input data-forge-field="ac" type="number" min="0" max="1000" value="${state.ac}"></label><label>Зрение, фт.<input data-forge-field="vision" type="number" min="0" max="10000" value="${state.vision}"></label></div>
            <label>Отношение<select data-forge-field="disposition"><option value="friendly" ${state.disposition==="friendly"?"selected":""}>Союзник</option><option value="neutral" ${state.disposition==="neutral"?"selected":""}>Нейтральный</option><option value="hostile" ${state.disposition==="hostile"?"selected":""}>Противник</option></select></label>
            <div class="token-forge-toggles"><label><input data-forge-field="showName" type="checkbox" ${state.showName?"checked":""}> Имя</label><label><input data-forge-field="showHp" type="checkbox" ${state.showHp?"checked":""}> HP</label><label><input data-forge-field="showAc" type="checkbox" ${state.showAc?"checked":""}> КД</label></div>
          </section>
          <section><div class="token-forge-section-head"><div><small>05</small><h3>Библиотека</h3></div></div>
            <label>Папка<input data-forge-field="folder" maxlength="60" value="${esc(state.folder)}"></label>
            <label>Теги<input data-forge-field="tags" maxlength="240" value="${esc(state.tags)}" placeholder="гоблин, подземелье, босс"></label>
          </section>
        </aside>
      </div>
      <footer class="token-forge-footer"><div><button type="button" data-forge-reset>Новый рецепт</button><span>Исходник и параметры сохраняются отдельно от готового WebP.</span></div><div><button type="button" data-forge-save ${state.busy?"disabled":""}>Сохранить в библиотеку</button><button type="button" class="primary" data-forge-save-place ${state.busy?"disabled":""}>Сохранить и поставить</button></div></footer>
    </section>`;
  }

  function hexToRgba(hex,alpha=1) {
    const value = safeHex(hex,"#000000").slice(1);
    return `rgba(${parseInt(value.slice(0,2),16)},${parseInt(value.slice(2,4),16)},${parseInt(value.slice(4,6),16)},${alpha})`;
  }

  function shapePath(context, shape, centerX, centerY, radius) {
    context.beginPath();
    if (shape === "circle") {
      context.arc(centerX,centerY,radius,0,Math.PI*2);
      return;
    }
    if (shape === "square") {
      const side=radius*2, x=centerX-radius, y=centerY-radius, corner=Math.max(12,radius*.12);
      context.roundRect(x,y,side,side,corner);
      return;
    }
    for (let index=0;index<6;index+=1) {
      const angle=-Math.PI/2+index*Math.PI/3;
      const x=centerX+Math.cos(angle)*radius, y=centerY+Math.sin(angle)*radius;
      if (!index) context.moveTo(x,y); else context.lineTo(x,y);
    }
    context.closePath();
  }

  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve,reject) => {
      const image = new Image();
      if (!url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("/")) image.crossOrigin="anonymous";
      image.onload=()=>resolve(image);
      image.onerror=()=>reject(new Error("Изображение не удалось открыть"));
      image.src=url;
    });
    imageCache.set(url,promise);
    return promise;
  }

  let drawSequence = 0;
  async function draw(canvas) {
    if (!canvas) return;
    const sequence = ++drawSequence;
    let image=null;
    try { image=await loadImage(state.sourceUrl); if (sequence === drawSequence) state.error=""; }
    catch (error) { if (sequence === drawSequence) state.error=error.message; }
    if (sequence !== drawSequence || !canvas.isConnected) return;
    const context=canvas.getContext("2d");
    const size=canvas.width, center=size/2, outerRadius=size/2-32;
    context.clearRect(0,0,size,size);
    context.save();
    context.shadowColor=hexToRgba(state.frameColor,.85);
    context.shadowBlur=state.glow*62;
    context.shadowOffsetY=state.shadow*16;
    shapePath(context,state.shape,center,center,outerRadius);
    context.fillStyle=state.frameSecondary;
    context.fill();
    context.restore();

    const innerRadius=Math.max(90,outerRadius-state.frameWidth-8);
    context.save();
    shapePath(context,state.shape,center,center,innerRadius);
    context.clip();
    context.fillStyle=state.backgroundColor;
    context.fillRect(0,0,size,size);
    if (image) {
      const target=innerRadius*2;
      const baseScale=Math.max(target/image.naturalWidth,target/image.naturalHeight)*state.imageScale;
      const width=image.naturalWidth*baseScale, height=image.naturalHeight*baseScale;
      context.translate(center+state.offsetX*1.45,center+state.offsetY*1.45);
      context.rotate(state.rotation*Math.PI/180);
      context.drawImage(image,-width/2,-height/2,width,height);
    } else {
      const gradient=context.createRadialGradient(center*.75,center*.7,10,center,center,innerRadius*1.2);
      gradient.addColorStop(0,hexToRgba(state.frameColor,.5)); gradient.addColorStop(1,state.backgroundColor);
      context.fillStyle=gradient; context.fillRect(0,0,size,size);
      context.fillStyle="#f2dfbd"; context.textAlign="center"; context.textBaseline="middle"; context.font="700 170px Manrope";
      context.fillText((state.name||"?").trim().slice(0,1).toUpperCase(),center,center+8);
    }
    context.restore();

    context.save();
    shapePath(context,state.shape,center,center,outerRadius-state.frameWidth/2);
    context.strokeStyle=state.frameSecondary;
    context.lineWidth=Math.max(6,state.frameWidth+10);
    context.stroke();
    shapePath(context,state.shape,center,center,outerRadius-state.frameWidth/2);
    const frameGradient=context.createLinearGradient(70,70,size-70,size-70);
    frameGradient.addColorStop(0,"#fff4d055"); frameGradient.addColorStop(.22,state.frameColor); frameGradient.addColorStop(.65,state.frameColor); frameGradient.addColorStop(1,"#00000066");
    context.strokeStyle=frameGradient;
    context.lineWidth=Math.max(2,state.frameWidth);
    context.stroke();
    context.restore();
  }

  function recipe() {
    return {
      version:1, sourceAssetId:state.sourceAssetId, sourceName:state.sourceName, name:state.name, shape:state.shape,
      image:{ scale:state.imageScale, offsetX:state.offsetX, offsetY:state.offsetY, rotation:state.rotation },
      frame:{ primary:state.frameColor, secondary:state.frameSecondary, width:state.frameWidth, glow:state.glow, shadow:state.shadow },
      backgroundColor:state.backgroundColor,
      defaults:{ size:state.size, hp:Math.min(state.hp,state.hpMax), hpMax:state.hpMax, ac:state.ac, vision:state.vision, disposition:state.disposition, showName:state.showName, showHp:state.showHp, showAc:state.showAc },
      folder:state.folder, tags:state.tags.split(",").map(value=>value.trim()).filter(Boolean).slice(0,20)
    };
  }

  async function fileData(file) {
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const dimensions=await new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve({width:0,height:0});image.src=dataUrl;});
    return {dataUrl,...dimensions};
  }

  async function uploadSource(ctx,file) {
    if (!file?.type.match(/^image\/(png|jpeg|webp)$/)) throw new Error("Нужен PNG, JPG или WebP");
    if (file.size>15*1024*1024) throw new Error("Исходник больше 15 МБ");
    const data=await fileData(file);
    const response=await fetch(`/api/rooms/${ctx.room.code}/assets`,{method:"POST",headers:{"content-type":"application/json","x-client-id":ctx.clientId},body:JSON.stringify({name:file.name.replace(/\.[^.]+$/,""),fileName:file.name,category:"source",dataUrl:data.dataUrl,width:data.width,height:data.height,defaultSize:1,folder:"Кузница токенов/Исходники",tags:["token-source"]})}).then(result=>result.json());
    if (!response.ok) throw new Error(response.error||"Исходник не загрузился");
    state.sourceAssetId=response.asset.id; state.sourceUrl=response.asset.url; state.sourceName=response.asset.name;
    if (!state.name || state.name===DEFAULTS.name) state.name=response.asset.name;
    return response.asset;
  }

  async function save(ctx,helpers,place=false) {
    const canvas=document.querySelector("#token-forge-canvas");
    if (!canvas) return;
    state.busy=true; helpers.refreshButtons?.(true);
    try {
      const placementPoint=place ? helpers.cameraCenterGrid() : null;
      await draw(canvas);
      let dataUrl;
      try { dataUrl=canvas.toDataURL("image/webp",.92); } catch { throw new Error("Исходник запрещает экспорт. Сначала загрузи его в библиотеку."); }
      const payload={name:(state.name||"Новый токен").trim(),fileName:`${(state.name||"token").replace(/[^a-zа-яё0-9_-]+/gi,"-")}.webp`,category:"token",dataUrl,width:OUTPUT_SIZE,height:OUTPUT_SIZE,defaultSize:state.size,folder:state.folder,tags:state.tags.split(",").map(value=>value.trim()).filter(Boolean),tokenRecipe:recipe(),replaceAssetId:state.editingAssetId};
      const response=await fetch(`/api/rooms/${ctx.room.code}/assets`,{method:"POST",headers:{"content-type":"application/json","x-client-id":ctx.clientId},body:JSON.stringify(payload)}).then(result=>result.json());
      if (!response.ok) throw new Error(response.error||"Токен не сохранился");
      state.editingAssetId=response.asset.id;
      if (place) {
        const defaults=recipe().defaults;
        const result=await helpers.emit("scene:asset-place",{assetId:response.asset.id,x:placementPoint.x,y:placementPoint.y,...defaults,color:state.frameColor,tokenShape:state.shape,forged:true});
        if (!result.ok) throw new Error(result.error||"Токен не поставился на карту");
        helpers.toast("Токен сохранён и поставлен на карту");
      } else helpers.toast(response.duplicate?"Рецепт обновлён в библиотеке":"Токен сохранён в библиотеке");
    } catch (error) {
      state.error=error.message||"Ошибка Кузницы";
      helpers.toast(state.error);
      const status=document.querySelector("#token-forge-status"); if(status)status.textContent=state.error;
    } finally { state.busy=false; helpers.refreshButtons?.(false); }
  }

  function bind(root,ctx,helpers) {
    const shell=root.querySelector(".token-forge-shell");
    if (!shell) return;
    const canvas=shell.querySelector("#token-forge-canvas");
    const redraw=()=>{draw(canvas);updatePreview(shell);};
    const setSource=asset=>{ if(!asset){state.sourceAssetId="";state.sourceUrl="";state.sourceName="";}else{state.sourceAssetId=asset.id;state.sourceUrl=asset.url;state.sourceName=asset.name;if(!state.name||state.name===DEFAULTS.name)state.name=asset.name;} redraw(); };
    shell.querySelector("[data-forge-close]")?.addEventListener("click",helpers.close);
    shell.querySelector("[data-forge-reset]")?.addEventListener("click",()=>{reset();helpers.rerender();});
    shell.querySelector("[data-forge-reset-image]")?.addEventListener("click",()=>{state.imageScale=1.15;state.offsetX=0;state.offsetY=0;state.rotation=0;helpers.rerender();});
    shell.querySelector("[data-forge-random]")?.addEventListener("click",()=>{
      const styles=[["#d3ad6e","#3a2415","#17120e"],["#aeb7c8","#232936","#0f131b"],["#b95750","#351714","#190b0a"],["#72b184","#183322","#0d170f"],["#8d72c8","#251a3b","#120e1d"],["#c68a4a","#3b2110","#17100a"]];
      const [primary,secondary,background]=styles[Math.floor(Math.random()*styles.length)];
      Object.assign(state,{frameColor:primary,frameSecondary:secondary,backgroundColor:background,frameWidth:14+Math.floor(Math.random()*15),glow:.18+Math.random()*.42,shadow:.45+Math.random()*.4}); helpers.rerender();
    });
    shell.querySelectorAll("[data-forge-shape]").forEach(button=>button.addEventListener("click",()=>{state.shape=button.dataset.forgeShape;helpers.rerender();}));
    shell.querySelectorAll("[data-forge-size]").forEach(button=>button.addEventListener("click",()=>{state.size=Number(button.dataset.forgeSize)||1;helpers.rerender();}));
    shell.querySelectorAll("[data-forge-source]").forEach(button=>button.addEventListener("click",()=>setSource((ctx.room.assets||[]).find(asset=>asset.id===button.dataset.forgeSource))));
    shell.querySelector("#token-forge-source-select")?.addEventListener("change",event=>setSource((ctx.room.assets||[]).find(asset=>asset.id===event.target.value)));
    const fileInput=shell.querySelector("#token-forge-file");
    shell.querySelector("#token-forge-upload")?.addEventListener("click",()=>fileInput?.click());
    fileInput?.addEventListener("change",async()=>{const file=fileInput.files?.[0];fileInput.value="";if(!file)return;try{helpers.toast(`Загружаю ${file.name}`);await uploadSource(ctx,file);helpers.rerender();}catch(error){helpers.toast(error.message);}});
    shell.querySelectorAll("[data-forge-field]").forEach(input=>{
      const update=()=>{
        const key=input.dataset.forgeField;
        if(input.type==="checkbox")state[key]=input.checked;
        else if(input.type==="number"||input.type==="range")state[key]=Number(input.value);
        else state[key]=input.value;
        if(key==="hpMax")state.hp=Math.min(state.hp,Math.max(1,state.hpMax));
        redraw();
      };
      input.addEventListener(input.tagName==="SELECT"||input.type==="checkbox"||input.type==="color"?"change":"input",update);
    });
    let drag=null;
    canvas?.addEventListener("pointerdown",event=>{drag={x:event.clientX,y:event.clientY,offsetX:state.offsetX,offsetY:state.offsetY};canvas.setPointerCapture(event.pointerId);});
    canvas?.addEventListener("pointermove",event=>{if(!drag)return;const rect=canvas.getBoundingClientRect();state.offsetX=clamp(drag.offsetX+(event.clientX-drag.x)/rect.width*100,-100,100);state.offsetY=clamp(drag.offsetY+(event.clientY-drag.y)/rect.height*100,-100,100);redraw();});
    const endDrag=event=>{drag=null;if(canvas?.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
    canvas?.addEventListener("pointerup",endDrag); canvas?.addEventListener("pointercancel",endDrag);
    canvas?.addEventListener("wheel",event=>{event.preventDefault();state.imageScale=clamp(state.imageScale+(event.deltaY<0?.08:-.08),.5,4);redraw();},{passive:false});
    shell.querySelector("[data-forge-save]")?.addEventListener("click",()=>save(ctx,helpers,false));
    shell.querySelector("[data-forge-save-place]")?.addEventListener("click",()=>save(ctx,helpers,true));
    redraw();
  }

  function updatePreview(shell) {
    const title=shell.querySelector("#token-forge-preview-title"); if(title)title.textContent=state.name||"Новый токен";
    const name=shell.querySelector("[data-forge-preview-name]"); if(name){name.textContent=state.name||"Новый токен";name.hidden=!state.showName;}
    const hp=shell.querySelector("[data-forge-preview-hp]"); if(hp){hp.hidden=!state.showHp;hp.querySelector("i").style.width=`${Math.round(clamp(state.hp,0,state.hpMax)/Math.max(1,state.hpMax)*100)}%`;hp.querySelector("em").textContent=`${Math.min(state.hp,state.hpMax)}/${state.hpMax}`;}
    const ac=shell.querySelector("[data-forge-preview-ac]"); if(ac){ac.hidden=!state.showAc;ac.textContent=`◈ ${state.ac}`;}
    const preview=shell.querySelector("[data-forge-token-preview]"); if(preview){preview.className=`token-forge-token-preview disposition-${state.disposition}`;preview.dataset.shape=state.shape;}
    const status=shell.querySelector("#token-forge-status"); if(status)status.textContent=state.error||`${relationLabel[state.disposition]} · ${state.size}×${state.size}`;
    const formats={imageScale:`${state.imageScale.toFixed(2)}×`,offsetX:String(Math.round(state.offsetX)),offsetY:String(Math.round(state.offsetY)),rotation:`${Math.round(state.rotation)}°`,frameWidth:String(Math.round(state.frameWidth)),glow:`${Math.round(state.glow*100)}%`,shadow:`${Math.round(state.shadow*100)}%`};
    Object.entries(formats).forEach(([key,value])=>{const output=shell.querySelector(`[data-forge-output="${key}"]`);if(output)output.textContent=value;const input=shell.querySelector(`[data-forge-field="${key}"]`);if(input&&document.activeElement!==input)input.value=state[key];});
  }

  window.TT_TOKEN_FORGE={ markup,bind,openAsset,reset,get state(){return state;} };
})();
