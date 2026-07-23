(() => {
  "use strict";

  const OUTPUT_SIZE=512;
  const PRESETS=Object.freeze({
    none:{name:"Без рамки",icon:"◌",shape:"raw",fitMode:"contain",frameColor:"#d3ad6e",frameSecondary:"#17120e",backgroundColor:"#000000",frameWidth:0,glow:0,shadow:.35},
    thin:{name:"Тонкая",icon:"○",shape:"circle",fitMode:"cover",frameColor:"#d3ad6e",frameSecondary:"#2c1d11",backgroundColor:"#17120e",frameWidth:7,glow:.15,shadow:.45},
    classic:{name:"Классика",icon:"◉",shape:"circle",fitMode:"cover",frameColor:"#d3ad6e",frameSecondary:"#3a2415",backgroundColor:"#17120e",frameWidth:18,glow:.35,shadow:.65},
    double:{name:"Двойная",icon:"◎",shape:"circle",fitMode:"cover",frameColor:"#d2aa68",frameSecondary:"#24160e",backgroundColor:"#14100c",frameWidth:22,glow:.25,shadow:.68},
    silver:{name:"Серебро",icon:"◇",shape:"circle",fitMode:"cover",frameColor:"#cbd2da",frameSecondary:"#343b46",backgroundColor:"#10141a",frameWidth:17,glow:.24,shadow:.62},
    obsidian:{name:"Обсидиан",icon:"◆",shape:"hex",fitMode:"cover",frameColor:"#765f9e",frameSecondary:"#100d17",backgroundColor:"#08060d",frameWidth:21,glow:.43,shadow:.78},
    blood:{name:"Кровь",icon:"◈",shape:"circle",fitMode:"cover",frameColor:"#c45149",frameSecondary:"#35110f",backgroundColor:"#180807",frameWidth:20,glow:.34,shadow:.76},
    arcane:{name:"Аркана",icon:"✧",shape:"circle",fitMode:"cover",frameColor:"#a88ad9",frameSecondary:"#27183e",backgroundColor:"#110b1b",frameWidth:18,glow:.62,shadow:.55},
    nature:{name:"Природа",icon:"❧",shape:"circle",fitMode:"cover",frameColor:"#79b781",frameSecondary:"#1b3821",backgroundColor:"#0b180e",frameWidth:18,glow:.28,shadow:.62},
    artificer:{name:"Механизм",icon:"⚙",shape:"hex",fitMode:"cover",frameColor:"#d29a55",frameSecondary:"#3c2512",backgroundColor:"#15100a",frameWidth:22,glow:.29,shadow:.72},
    boss:{name:"Босс",icon:"♛",shape:"circle",fitMode:"cover",frameColor:"#e0b360",frameSecondary:"#4a160f",backgroundColor:"#160807",frameWidth:30,glow:.58,shadow:.88}
  });
  const DEFAULTS=Object.freeze({
    editingAssetId:"",editingAppearanceId:"",bestiaryKey:"",sourceAssetId:"",sourceUrl:"",sourceName:"",
    name:"Новый токен",appearanceName:"Основной облик",shape:"circle",fitMode:"cover",imageScale:1.15,offsetX:0,offsetY:0,rotation:0,
    framePreset:"classic",frameColor:"#d3ad6e",frameSecondary:"#3a2415",frameWidth:18,glow:.35,shadow:.65,backgroundColor:"#17120e",
    size:1,hpMax:10,hp:10,ac:10,vision:60,disposition:"hostile",showName:true,showHp:true,showAc:false,
    folder:"Кузница токенов",tags:"",busy:false,error:""
  });

  let state={...DEFAULTS};
  const imageCache=new Map();
  const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const numberOr=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const safeHex=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||""))?value:fallback;
  const relationLabel={friendly:"Союзник",neutral:"Нейтральный",hostile:"Противник"};

  function reset(ctx=null){
    const sheet=ctx?.ownSheet||{};
    const appearanceCount=Array.isArray(sheet.tokenAppearances)?sheet.tokenAppearances.length:0;
    state={...DEFAULTS,appearanceName:appearanceCount?`Альтернативный облик ${appearanceCount+1}`:"Основной облик",name:sheet.characterName||DEFAULTS.name,disposition:ctx?.isDm?"hostile":"friendly",hp:Number(sheet.hpCurrent)||10,hpMax:Number(sheet.hpMax)||10,ac:Number(sheet.ac)||10,vision:Number(sheet.tokenVision)||60,size:Number(sheet.tokenScale)||1};
  }

  function applyPreset(key){
    const preset=PRESETS[key]||PRESETS.classic;
    Object.assign(state,{framePreset:key,shape:preset.shape,fitMode:preset.fitMode,frameColor:preset.frameColor,frameSecondary:preset.frameSecondary,backgroundColor:preset.backgroundColor,frameWidth:preset.frameWidth,glow:preset.glow,shadow:preset.shadow});
  }

  function normalizeRecipe(recipe={}){
    const image=recipe.image||{},frame=recipe.frame||{},defaults=recipe.defaults||{};
    const preset=PRESETS[frame.preset]?frame.preset:"classic";
    return {...DEFAULTS,
      editingAssetId:String(recipe.editingAssetId||""),editingAppearanceId:String(recipe.editingAppearanceId||""),bestiaryKey:String(recipe.bestiaryKey||""),
      sourceAssetId:String(recipe.sourceAssetId||""),sourceUrl:String(recipe.sourceUrl||""),sourceName:String(recipe.sourceName||""),
      name:String(recipe.name||DEFAULTS.name).slice(0,80),appearanceName:String(recipe.appearanceName||recipe.name||DEFAULTS.appearanceName).slice(0,80),
      shape:["circle","square","hex","raw"].includes(recipe.shape)?recipe.shape:PRESETS[preset].shape,
      fitMode:["cover","contain"].includes(image.fit)?image.fit:(recipe.shape==="raw"?"contain":"cover"),
      imageScale:clamp(numberOr(image.scale??recipe.imageScale,DEFAULTS.imageScale),.35,5),offsetX:clamp(numberOr(image.offsetX??recipe.offsetX,0),-120,120),offsetY:clamp(numberOr(image.offsetY??recipe.offsetY,0),-120,120),rotation:clamp(numberOr(image.rotation??recipe.rotation,0),-180,180),
      framePreset:preset,frameColor:safeHex(frame.primary??recipe.frameColor,PRESETS[preset].frameColor),frameSecondary:safeHex(frame.secondary??recipe.frameSecondary,PRESETS[preset].frameSecondary),frameWidth:clamp(numberOr(frame.width??recipe.frameWidth,PRESETS[preset].frameWidth),0,48),glow:clamp(numberOr(frame.glow??recipe.glow,PRESETS[preset].glow),0,1),shadow:clamp(numberOr(frame.shadow??recipe.shadow,PRESETS[preset].shadow),0,1),backgroundColor:safeHex(recipe.backgroundColor,PRESETS[preset].backgroundColor),
      size:clamp(numberOr(defaults.size??recipe.size,1),.25,12),hpMax:clamp(numberOr(defaults.hpMax??recipe.hpMax,10),1,1000000),hp:clamp(numberOr(defaults.hp??recipe.hp,10),0,1000000),ac:clamp(numberOr(defaults.ac??recipe.ac,10),0,1000),vision:clamp(numberOr(defaults.vision??recipe.vision,60),0,10000),
      disposition:["friendly","neutral","hostile"].includes(defaults.disposition??recipe.disposition)?(defaults.disposition??recipe.disposition):"hostile",showName:(defaults.showName??recipe.showName)!==false,showHp:(defaults.showHp??recipe.showHp)!==false,showAc:Boolean(defaults.showAc??recipe.showAc),
      folder:String(recipe.folder||DEFAULTS.folder).slice(0,60),tags:Array.isArray(recipe.tags)?recipe.tags.join(", "):String(recipe.tags||""),busy:false,error:""
    };
  }

  function openAsset(asset,room){
    if(!asset)return;
    state=normalizeRecipe(asset.tokenRecipe||{});state.editingAssetId=asset.id;state.editingAppearanceId="";state.bestiaryKey=asset.bestiaryKey||state.bestiaryKey||"";state.name=asset.name||state.name;state.folder=asset.folder||state.folder;state.tags=Array.isArray(asset.tags)?asset.tags.join(", "):state.tags;
    const source=(room?.assets||[]).find(item=>item.id===state.sourceAssetId);
    if(source){state.sourceUrl=source.url;state.sourceName=source.name;}else if(!state.sourceUrl){state.sourceAssetId=asset.id;state.sourceUrl=asset.url;state.sourceName=asset.name;}
  }

  function openAppearance(appearance,room){
    if(!appearance)return;
    state=normalizeRecipe(appearance.tokenRecipe||{});state.editingAssetId="";state.editingAppearanceId=appearance.id;state.appearanceName=appearance.name||state.appearanceName;state.name=room?.players?.[room?.viewerId]?.sheet?.characterName||state.name;
    const source=(room?.assets||[]).find(item=>item.id===state.sourceAssetId);
    if(source){state.sourceUrl=source.url;state.sourceName=source.name;}else{state.sourceUrl=appearance.imageUrl;state.sourceName=appearance.name;state.sourceAssetId="";state.shape=appearance.tokenShape||state.shape;}
  }

  function openBestiary(monster,asset,room){
    if(!monster||!asset)return;
    const existing=(room?.assets||[]).find(item=>item.category==="token"&&item.bestiaryKey===monster.key);
    if(existing){openAsset(existing,room);return;}
    reset({isDm:true,ownSheet:{}});
    state.bestiaryKey=monster.key;
    state.sourceAssetId=asset.id||"";
    state.sourceUrl=asset.url||monster.portrait||monster.token||"";
    state.sourceName=asset.name||monster.name;
    state.name=monster.name;
    state.size=Number(monster.tokenDefaults?.size)||1;
    state.hpMax=Math.max(1,Number(monster.hp?.average)||1);
    state.hp=state.hpMax;
    state.ac=Math.max(0,Number(monster.ac?.value)||10);
    state.vision=Math.max(0,Number(monster.tokenDefaults?.vision)||0);
    state.disposition=monster.tokenDefaults?.disposition||"hostile";
    state.showAc=true;
    state.folder=`Бестиарий/${monster.typeLabel||monster.type||"Существа"}`;
    state.tags=`bestiary, ${monster.key}, ${monster.type||"creature"}`;
    state.appearanceName="";
  }

  function availableSources(ctx){
    const assets=(ctx.room?.assets||[]).filter(asset=>["token","prop","source"].includes(asset.category)&&(ctx.isDm||!asset.ownerId||asset.ownerId===ctx.clientId));
    const ownUrl=ctx.ownSheet?.tokenImageUrl||ctx.ownSheet?.portraitUrl;
    if(ownUrl&&!assets.some(asset=>asset.url===ownUrl))assets.unshift({id:"__own-current",name:"Текущий облик персонажа",url:ownUrl,category:"source",virtual:true});
    return assets;
  }

  function libraryFolders(ctx){
    return [...new Set((ctx.room?.assets||[]).map(asset=>String(asset.folder||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
  }

  function nextAppearanceName(ctx){
    const count=Array.isArray(ctx.ownSheet?.tokenAppearances)?ctx.ownSheet.tokenAppearances.length:0;
    return count?`Альтернативный облик ${count+1}`:"Основной облик";
  }

  function appearanceCards(ctx){
    const appearances=Array.isArray(ctx.ownSheet?.tokenAppearances)?ctx.ownSheet.tokenAppearances:[];
    if(!appearances.length)return '<div class="token-forge-empty">Сохрани первый облик — следующие можно будет переключать без изменения характеристик.</div>';
    return appearances.map(item=>`<article class="token-appearance-card ${item.id===ctx.ownSheet.activeTokenAppearanceId?"active":""}"><img src="${esc(item.imageUrl)}" alt=""><div><strong>${esc(item.name)}</strong><small>${item.id===ctx.ownSheet.activeTokenAppearanceId?"активный облик":item.tokenShape==="raw"?"готовый токен":item.tokenShape}</small></div><button type="button" data-appearance-edit="${esc(item.id)}" title="Редактировать">✎</button>${item.id!==ctx.ownSheet.activeTokenAppearanceId?`<button type="button" data-appearance-activate="${esc(item.id)}">Применить</button>`:""}</article>`).join("");
  }

  function markup(ctx){
    if(!state.name||state.name===DEFAULTS.name)state.name=ctx.ownSheet?.characterName||state.name;
    const sources=availableSources(ctx);
    const sourceOptions=sources.map(asset=>`<option value="${esc(asset.id)}" ${asset.id===state.sourceAssetId?"selected":""}>${esc(asset.name)}${asset.category==="source"?" · исходник":""}</option>`).join("");
    const sourceCards=sources.slice(-10).reverse().map(asset=>`<button type="button" class="token-forge-source-card ${asset.id===state.sourceAssetId?"active":""}" data-forge-source="${esc(asset.id)}"><img src="${esc(asset.url)}" alt=""><span>${esc(asset.name)}</span></button>`).join("");
    const shapeButton=(key,label,icon)=>`<button type="button" data-forge-shape="${key}" class="${state.shape===key?"active":""}"><span>${icon}</span>${label}</button>`;
    const presets=Object.entries(PRESETS).map(([key,preset])=>`<button type="button" class="token-frame-preset ${state.framePreset===key?"active":""}" data-frame-preset="${key}"><span>${preset.icon}</span><b>${preset.name}</b></button>`).join("");
    const folders=libraryFolders(ctx),folderIsExisting=folders.includes(state.folder),folderMode=!state.folder?"":folderIsExisting?state.folder:"__new__";
    const folderOptions=folders.map(folder=>`<option value="${esc(folder)}" ${folderMode===folder?"selected":""}>${esc(folder)}</option>`).join("");
    const editingAppearance=(ctx.ownSheet?.tokenAppearances||[]).find(item=>item.id===state.editingAppearanceId);
    return `<section class="token-forge-shell is-standalone">
      <header class="token-forge-head"><div><span class="eyebrow">TabaxiTable 2.5.1</span><h2>Кузница токенов</h2><p>Отдельный редактор токенов и альтернативных обликов персонажа.</p></div><button type="button" data-forge-close aria-label="Вернуться">×</button></header>
      <div class="token-forge-workspace">
        <aside class="token-forge-controls token-forge-source-panel">
          <section><div class="token-forge-section-head"><div><small>01</small><h3>Изображение</h3></div><button type="button" id="token-forge-upload">＋ Загрузить</button></div><input id="token-forge-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><label>Источник<select id="token-forge-source-select"><option value="">Монограмма без изображения</option>${sourceOptions}</select></label><div class="token-forge-source-grid">${sourceCards||'<div class="token-forge-empty">Загрузи портрет или выбери изображение из библиотеки.</div>'}</div></section>
          <section><div class="token-forge-section-head"><div><small>02</small><h3>Кадрирование</h3></div><button type="button" data-forge-reset-image>Сбросить</button></div><label>Масштаб <output data-forge-output="imageScale">${state.imageScale.toFixed(2)}×</output><input data-forge-field="imageScale" type="range" min="0.35" max="5" step="0.01" value="${state.imageScale}"></label><label>По горизонтали <output data-forge-output="offsetX">${Math.round(state.offsetX)}</output><input data-forge-field="offsetX" type="range" min="-120" max="120" value="${state.offsetX}"></label><label>По вертикали <output data-forge-output="offsetY">${Math.round(state.offsetY)}</output><input data-forge-field="offsetY" type="range" min="-120" max="120" value="${state.offsetY}"></label><label>Поворот <output data-forge-output="rotation">${Math.round(state.rotation)}°</output><input data-forge-field="rotation" type="range" min="-180" max="180" value="${state.rotation}"></label><p class="token-forge-tip">Тяни изображение мышью. Колесо меняет масштаб. Режим «Готовый» сохраняет прозрачный токен целиком.</p></section>
          ${state.bestiaryKey?`<section class="token-forge-bestiary-context"><div class="token-forge-section-head"><div><small>03</small><h3>Токен бестиария</h3></div></div><strong>${esc(state.name)}</strong><p>Кадрирование и рамка станут визуалом по умолчанию для всех новых экземпляров. Уже размещённые токены обновятся без сброса HP, позиции и инициативы.</p><code>${esc(state.bestiaryKey)}</code></section>`:`<section><div class="token-forge-section-head"><div><small>03</small><h3>Облики персонажа</h3></div><button type="button" data-appearance-new>＋ Новый слот</button></div>${editingAppearance?`<div class="token-appearance-editing"><span>Редактируется</span><strong>${esc(editingAppearance.name)}</strong></div>`:""}<label>Название облика<input data-forge-field="appearanceName" maxlength="80" value="${esc(state.appearanceName)}" placeholder="Скрытность, ярость, форма зверя…"></label><div class="token-appearance-list">${appearanceCards(ctx)}</div></section>`}
        </aside>
        <main class="token-forge-preview-column"><div class="token-forge-preview-head"><div><small>Живой предпросмотр</small><strong id="token-forge-preview-title">${esc(state.name)}</strong></div><span id="token-forge-status">${state.error?esc(state.error):"512 × 512 WebP"}</span></div><div class="token-forge-stage" data-forge-stage><div class="token-forge-grid-bg"></div><div class="token-forge-token-preview disposition-${state.disposition}" data-forge-token-preview><canvas id="token-forge-canvas" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}"></canvas><strong data-forge-preview-name>${esc(state.name)}</strong><span class="token-forge-hp" data-forge-preview-hp><i style="width:${Math.round(clamp(state.hp,0,state.hpMax)/Math.max(1,state.hpMax)*100)}%"></i><em>${state.hp}/${state.hpMax}</em></span><b data-forge-preview-ac>◈ ${state.ac}</b></div></div><div class="token-forge-shapes">${shapeButton("raw","Готовый","◌")}${shapeButton("circle","Круг","●")}${shapeButton("square","Квадрат","■")}${shapeButton("hex","Шестиугольник","⬢")}</div><div class="token-forge-preview-sizes"><span>На сетке</span>${[.5,1,2,3].map(size=>`<button type="button" data-forge-size="${size}" class="${Number(state.size)===size?"active":""}">${size}×${size}</button>`).join("")}</div></main>
        <aside class="token-forge-controls token-forge-style-panel">
          <section><div class="token-forge-section-head"><div><small>04</small><h3>Рамка</h3></div><button type="button" data-forge-random>Случайно</button></div><div class="token-frame-presets">${presets}</div><div class="token-forge-color-grid"><label>Основной<input data-forge-field="frameColor" type="color" value="${esc(state.frameColor)}"></label><label>Подложка<input data-forge-field="frameSecondary" type="color" value="${esc(state.frameSecondary)}"></label><label>Фон<input data-forge-field="backgroundColor" type="color" value="${esc(state.backgroundColor)}"></label></div><label>Толщина рамки <output data-forge-output="frameWidth">${Math.round(state.frameWidth)}</output><input data-forge-field="frameWidth" type="range" min="0" max="48" value="${state.frameWidth}"></label><label>Свечение <output data-forge-output="glow">${Math.round(state.glow*100)}%</output><input data-forge-field="glow" type="range" min="0" max="1" step=".01" value="${state.glow}"></label><label>Тень <output data-forge-output="shadow">${Math.round(state.shadow*100)}%</output><input data-forge-field="shadow" type="range" min="0" max="1" step=".01" value="${state.shadow}"></label></section>
          ${ctx.isDm?`<section><div class="token-forge-section-head"><div><small>05</small><h3>Параметры NPC</h3></div></div><label>Название<input data-forge-field="name" maxlength="80" value="${esc(state.name)}"></label><div class="token-forge-form-grid"><label>HP<input data-forge-field="hp" type="number" min="0" value="${state.hp}"></label><label>Макс. HP<input data-forge-field="hpMax" type="number" min="1" value="${state.hpMax}"></label><label>КД<input data-forge-field="ac" type="number" min="0" value="${state.ac}"></label><label>Зрение<input data-forge-field="vision" type="number" min="0" value="${state.vision}"></label></div><label>Отношение<select data-forge-field="disposition"><option value="friendly" ${state.disposition==="friendly"?"selected":""}>Союзник</option><option value="neutral" ${state.disposition==="neutral"?"selected":""}>Нейтральный</option><option value="hostile" ${state.disposition==="hostile"?"selected":""}>Противник</option></select></label><div class="token-forge-toggles"><label><input data-forge-field="showName" type="checkbox" ${state.showName?"checked":""}> Имя</label><label><input data-forge-field="showHp" type="checkbox" ${state.showHp?"checked":""}> HP</label><label><input data-forge-field="showAc" type="checkbox" ${state.showAc?"checked":""}> КД</label></div></section><section><div class="token-forge-section-head"><div><small>06</small><h3>Библиотека</h3></div></div><label>Папка<div class="token-forge-folder-picker"><select id="token-forge-folder-select"><option value="" ${folderMode===""?"selected":""}>Без папки</option>${folderOptions}<option value="__new__" ${folderMode==="__new__"?"selected":""}>＋ Создать новую…</option></select><input id="token-forge-folder-new" maxlength="60" value="${folderMode==="__new__"?esc(state.folder):""}" placeholder="Название новой папки" ${folderMode==="__new__"?"":"hidden"}></div></label><label>Теги<input data-forge-field="tags" maxlength="240" value="${esc(state.tags)}"></label></section>`:`<section class="token-character-note"><strong>${esc(ctx.ownSheet?.characterName||ctx.ownPlayer?.name||"Персонаж")}</strong><p>Применение меняет только изображение и форму токена. HP, КД, инвентарь, характеристики и остальные данные листа сохраняются.</p></section>`}
        </aside>
      </div>
      <footer class="token-forge-footer"><div>${ctx.isDm?`<button type="button" ${state.bestiaryKey?'class="primary" ':''}data-forge-save>${state.bestiaryKey?"Сохранить токен существа":"В библиотеку"}</button><button type="button" data-forge-save-place>${state.bestiaryKey?"Сохранить и поставить моба":"Сохранить и поставить"}</button>`:""}</div>${state.bestiaryKey?`<div><button type="button" data-forge-close>Вернуться в Бестиарий</button></div>`:`<div><button type="button" class="primary" data-forge-apply-character>Сохранить новым обликом</button>${state.editingAppearanceId?'<button type="button" data-forge-appearance-update>Обновить выбранный облик</button>':""}</div>`}</footer>
    </section>`;
  }

  function hexToRgba(hex,alpha=1){const value=safeHex(hex,"#000000").slice(1);return`rgba(${parseInt(value.slice(0,2),16)},${parseInt(value.slice(2,4),16)},${parseInt(value.slice(4,6),16)},${alpha})`;}
  function shapePath(context,shape,cx,cy,radius){context.beginPath();if(shape==="circle"){context.arc(cx,cy,radius,0,Math.PI*2);return;}if(shape==="square"){const side=radius*2;context.roundRect(cx-radius,cy-radius,side,side,Math.max(12,radius*.12));return;}for(let i=0;i<6;i+=1){const angle=-Math.PI/2+i*Math.PI/3,x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius;if(!i)context.moveTo(x,y);else context.lineTo(x,y);}context.closePath();}
  function loadImage(url){if(!url)return Promise.resolve(null);if(imageCache.has(url))return imageCache.get(url);const promise=new Promise((resolve,reject)=>{const image=new Image();if(!url.startsWith("data:")&&!url.startsWith("blob:")&&!url.startsWith("/"))image.crossOrigin="anonymous";image.onload=()=>resolve(image);image.onerror=()=>reject(new Error("Изображение не удалось открыть"));image.src=url;});imageCache.set(url,promise);return promise;}

  function drawDecorations(context,cx,cy,radius){
    const preset=state.framePreset;
    context.save();context.translate(cx,cy);context.strokeStyle=state.frameColor;context.fillStyle=state.frameColor;
    if(preset==="double"||preset==="boss"){context.lineWidth=Math.max(2,state.frameWidth*.2);context.globalAlpha=.75;context.beginPath();context.arc(0,0,radius-state.frameWidth-7,0,Math.PI*2);context.stroke();context.beginPath();context.arc(0,0,radius+5,0,Math.PI*2);context.stroke();}
    if(["arcane","nature","artificer","boss"].includes(preset)){
      const count=preset==="artificer"?16:preset==="boss"?12:10;
      for(let i=0;i<count;i+=1){const angle=i*Math.PI*2/count,x=Math.cos(angle)*(radius-state.frameWidth*.35),y=Math.sin(angle)*(radius-state.frameWidth*.35);context.save();context.translate(x,y);context.rotate(angle);context.globalAlpha=.78;if(preset==="artificer")context.fillRect(-5,-9,10,18);else if(preset==="nature"){context.beginPath();context.ellipse(0,0,4,10,.5,0,Math.PI*2);context.fill();}else{context.beginPath();context.arc(0,0,preset==="boss"?5:3,0,Math.PI*2);context.fill();}context.restore();}
    }
    if(preset==="boss"){context.globalAlpha=.9;context.font="700 34px Georgia";context.textAlign="center";context.fillText("♛",0,-radius+25);}
    context.restore();
  }

  let drawSequence=0;
  async function draw(canvas){
    if(!canvas)return;const sequence=++drawSequence;let image=null;try{image=await loadImage(state.sourceUrl);if(sequence===drawSequence)state.error="";}catch(error){if(sequence===drawSequence)state.error=error.message;}if(sequence!==drawSequence||!canvas.isConnected)return;
    const context=canvas.getContext("2d"),size=canvas.width,c=size/2,outer=size/2-32;context.clearRect(0,0,size,size);
    if(state.shape==="raw"){
      if(image){const fit=state.fitMode==="cover"?Math.max(size/image.naturalWidth,size/image.naturalHeight):Math.min(size/image.naturalWidth,size/image.naturalHeight);const scale=fit*state.imageScale,w=image.naturalWidth*scale,h=image.naturalHeight*scale;context.save();context.translate(c+state.offsetX*1.45,c+state.offsetY*1.45);context.rotate(state.rotation*Math.PI/180);context.shadowColor="#000";context.shadowBlur=state.shadow*24;context.shadowOffsetY=state.shadow*10;context.drawImage(image,-w/2,-h/2,w,h);context.restore();}else{context.fillStyle="#f2dfbd";context.textAlign="center";context.textBaseline="middle";context.font="700 170px Manrope";context.fillText((state.name||"?").trim().slice(0,1).toUpperCase(),c,c);}
      return;
    }
    context.save();context.shadowColor=hexToRgba(state.frameColor,.85);context.shadowBlur=state.glow*62;context.shadowOffsetY=state.shadow*16;shapePath(context,state.shape,c,c,outer);context.fillStyle=state.frameSecondary;context.fill();context.restore();
    const inner=Math.max(82,outer-state.frameWidth-8);context.save();shapePath(context,state.shape,c,c,inner);context.clip();context.fillStyle=state.backgroundColor;context.fillRect(0,0,size,size);
    if(image){const target=inner*2,fit=state.fitMode==="contain"?Math.min(target/image.naturalWidth,target/image.naturalHeight):Math.max(target/image.naturalWidth,target/image.naturalHeight),scale=fit*state.imageScale,w=image.naturalWidth*scale,h=image.naturalHeight*scale;context.translate(c+state.offsetX*1.45,c+state.offsetY*1.45);context.rotate(state.rotation*Math.PI/180);context.drawImage(image,-w/2,-h/2,w,h);}else{const gradient=context.createRadialGradient(c*.75,c*.7,10,c,c,inner*1.2);gradient.addColorStop(0,hexToRgba(state.frameColor,.5));gradient.addColorStop(1,state.backgroundColor);context.fillStyle=gradient;context.fillRect(0,0,size,size);context.fillStyle="#f2dfbd";context.textAlign="center";context.textBaseline="middle";context.font="700 170px Manrope";context.fillText((state.name||"?").trim().slice(0,1).toUpperCase(),c,c+8);}context.restore();
    context.save();shapePath(context,state.shape,c,c,outer-state.frameWidth/2);context.strokeStyle=state.frameSecondary;context.lineWidth=Math.max(4,state.frameWidth+10);context.stroke();shapePath(context,state.shape,c,c,outer-state.frameWidth/2);const gradient=context.createLinearGradient(70,70,size-70,size-70);gradient.addColorStop(0,"#fff4d066");gradient.addColorStop(.22,state.frameColor);gradient.addColorStop(.65,state.frameColor);gradient.addColorStop(1,"#00000077");context.strokeStyle=gradient;context.lineWidth=Math.max(2,state.frameWidth);context.stroke();context.restore();drawDecorations(context,c,c,outer);
  }

  function recipe(){return{version:2,bestiaryKey:state.bestiaryKey,sourceAssetId:state.sourceAssetId,sourceName:state.sourceName,sourceUrl:state.sourceUrl,name:state.name,appearanceName:state.appearanceName,shape:state.shape,image:{fit:state.fitMode,scale:state.imageScale,offsetX:state.offsetX,offsetY:state.offsetY,rotation:state.rotation},frame:{preset:state.framePreset,primary:state.frameColor,secondary:state.frameSecondary,width:state.frameWidth,glow:state.glow,shadow:state.shadow},backgroundColor:state.backgroundColor,defaults:{size:state.size,hp:Math.min(state.hp,state.hpMax),hpMax:state.hpMax,ac:state.ac,vision:state.vision,disposition:state.disposition,showName:state.showName,showHp:state.showHp,showAc:state.showAc},folder:state.folder,tags:state.tags.split(",").map(value=>value.trim()).filter(Boolean).slice(0,20)};}
  async function fileData(file){const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const dimensions=await new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve({width:0,height:0});image.src=dataUrl;});return{dataUrl,...dimensions};}
  async function uploadSource(ctx,file){if(!file?.type.match(/^image\/(png|jpeg|webp)$/))throw new Error("Нужен PNG, JPG или WebP");if(file.size>15*1024*1024)throw new Error("Исходник больше 15 МБ");const data=await fileData(file);const response=await fetch(`/api/rooms/${ctx.room.code}/assets`,{method:"POST",headers:{"content-type":"application/json","x-client-id":ctx.clientId},body:JSON.stringify({name:file.name.replace(/\.[^.]+$/,""),fileName:file.name,category:"source",characterSource:!ctx.isDm,dataUrl:data.dataUrl,width:data.width,height:data.height,defaultSize:1,folder:ctx.isDm?"Кузница токенов/Исходники":`Персонажи/${ctx.ownSheet?.characterName||ctx.ownPlayer?.name||"Герой"}/Исходники`,tags:["token-source"]})}).then(result=>result.json());if(!response.ok)throw new Error(response.error||"Исходник не загрузился");state.sourceAssetId=response.asset.id;state.sourceUrl=response.asset.url;state.sourceName=response.asset.name;if(!state.name||state.name===DEFAULTS.name)state.name=response.asset.name;return response.asset;}
  async function canvasData(){const canvas=document.querySelector("#token-forge-canvas");if(!canvas)throw new Error("Холст Кузницы не найден");await draw(canvas);try{return canvas.toDataURL("image/webp",.92);}catch{throw new Error("Исходник запрещает экспорт. Загрузи файл в Кузницу.");}}
  async function saveLibrary(ctx,helpers,place=false){if(!ctx.isDm)return;state.busy=true;helpers.refreshButtons?.(true);try{const placement=place?helpers.cameraCenterGrid():null,dataUrl=await canvasData(),payload={name:(state.name||"Новый токен").trim(),fileName:`${(state.name||"token").replace(/[^a-zа-яё0-9_-]+/gi,"-")}.webp`,category:"token",dataUrl,width:OUTPUT_SIZE,height:OUTPUT_SIZE,defaultSize:state.size,folder:state.folder,tags:recipe().tags,tokenRecipe:recipe(),bestiaryKey:state.bestiaryKey,replaceAssetId:state.editingAssetId};const response=await fetch(`/api/rooms/${ctx.room.code}/assets`,{method:"POST",headers:{"content-type":"application/json","x-client-id":ctx.clientId},body:JSON.stringify(payload)}).then(result=>result.json());if(!response.ok)throw new Error(response.error||"Токен не сохранился");state.editingAssetId=response.asset.id;if(place){let result;if(state.bestiaryKey)result=await helpers.emit("bestiary:place",{key:state.bestiaryKey,count:1,x:placement.x,y:placement.y,disposition:state.disposition});else{const defaults=recipe().defaults;result=await helpers.emit("scene:asset-place",{assetId:response.asset.id,x:placement.x,y:placement.y,...defaults,color:state.frameColor,tokenShape:state.shape,forged:true});}if(!result.ok)throw new Error(result.error||"Токен не поставился");helpers.toast(state.bestiaryKey?"Токен бестиария сохранён и размещён":"Токен сохранён и поставлен на карту");helpers.switchView?.("map");}else helpers.toast(state.bestiaryKey?(response.updated?"Токен существа обновлён":"Токен существа сохранён"):response.updated?"Токен обновлён":"Токен сохранён в библиотеке");}catch(error){state.error=error.message||"Ошибка Кузницы";helpers.toast(state.error);}finally{state.busy=false;helpers.refreshButtons?.(false);}}
  async function saveCharacter(ctx,helpers,mode="new"){state.busy=true;helpers.refreshButtons?.(true);try{if(mode==="update"&&!state.editingAppearanceId)throw new Error("Сначала выбери облик для обновления");const dataUrl=await canvasData(),appearanceId=mode==="update"?state.editingAppearanceId:"",response=await fetch(`/api/rooms/${ctx.room.code}/character-appearances`,{method:"POST",headers:{"content-type":"application/json","x-client-id":ctx.clientId},body:JSON.stringify({appearanceId,name:(state.appearanceName||"Облик").trim(),dataUrl,tokenRecipe:recipe(),setActive:true})}).then(result=>result.json());if(!response.ok)throw new Error(response.error||"Облик не сохранился");state.editingAppearanceId=response.appearance.id;helpers.toast(mode==="update"?`Облик «${response.appearance.name}» обновлён.`:`Облик «${response.appearance.name}» сохранён в новый слот.`);}catch(error){state.error=error.message||"Не удалось сохранить облик";helpers.toast(state.error);}finally{state.busy=false;helpers.refreshButtons?.(false);}}

  function updatePreview(shell){const title=shell.querySelector("#token-forge-preview-title");if(title)title.textContent=state.name||"Новый токен";const name=shell.querySelector("[data-forge-preview-name]");if(name){name.textContent=state.name||"Новый токен";name.hidden=!state.showName;}const hp=shell.querySelector("[data-forge-preview-hp]");if(hp){hp.hidden=!state.showHp;hp.querySelector("i").style.width=`${Math.round(clamp(state.hp,0,state.hpMax)/Math.max(1,state.hpMax)*100)}%`;hp.querySelector("em").textContent=`${Math.min(state.hp,state.hpMax)}/${state.hpMax}`;}const ac=shell.querySelector("[data-forge-preview-ac]");if(ac){ac.hidden=!state.showAc;ac.textContent=`◈ ${state.ac}`;}const preview=shell.querySelector("[data-forge-token-preview]");if(preview){preview.className=`token-forge-token-preview disposition-${state.disposition}`;preview.dataset.shape=state.shape;}const status=shell.querySelector("#token-forge-status");if(status)status.textContent=state.error||`${relationLabel[state.disposition]} · ${state.size}×${state.size}`;const formats={imageScale:`${state.imageScale.toFixed(2)}×`,offsetX:String(Math.round(state.offsetX)),offsetY:String(Math.round(state.offsetY)),rotation:`${Math.round(state.rotation)}°`,frameWidth:String(Math.round(state.frameWidth)),glow:`${Math.round(state.glow*100)}%`,shadow:`${Math.round(state.shadow*100)}%`};Object.entries(formats).forEach(([key,value])=>{const output=shell.querySelector(`[data-forge-output="${key}"]`);if(output)output.textContent=value;});}

  function bind(root,ctx,helpers){
    const shell=root.querySelector(".token-forge-shell");if(!shell)return;const canvas=shell.querySelector("#token-forge-canvas");const redraw=()=>{draw(canvas);updatePreview(shell);};const sources=availableSources(ctx);const setSource=asset=>{if(!asset){state.sourceAssetId="";state.sourceUrl="";state.sourceName="";}else{state.sourceAssetId=asset.virtual?"":asset.id;state.sourceUrl=asset.url;state.sourceName=asset.name;if(!state.name||state.name===DEFAULTS.name)state.name=asset.name;}redraw();};
    shell.querySelector("[data-forge-close]")?.addEventListener("click",helpers.close);shell.querySelector("[data-appearance-new]")?.addEventListener("click",()=>{state.editingAppearanceId="";state.appearanceName=nextAppearanceName(ctx);helpers.rerender();});shell.querySelector("[data-forge-reset-image]")?.addEventListener("click",()=>{state.imageScale=state.shape==="raw"?1:1.15;state.offsetX=0;state.offsetY=0;state.rotation=0;helpers.rerender();});
    shell.querySelector("[data-forge-random]")?.addEventListener("click",()=>{const keys=Object.keys(PRESETS).filter(key=>key!=="none");applyPreset(keys[Math.floor(Math.random()*keys.length)]);helpers.rerender();});shell.querySelectorAll("[data-frame-preset]").forEach(button=>button.addEventListener("click",()=>{applyPreset(button.dataset.framePreset);helpers.rerender();}));
    shell.querySelectorAll("[data-forge-shape]").forEach(button=>button.addEventListener("click",()=>{state.shape=button.dataset.forgeShape;state.fitMode=state.shape==="raw"?"contain":"cover";if(state.shape==="raw")state.framePreset="none";helpers.rerender();}));shell.querySelectorAll("[data-forge-size]").forEach(button=>button.addEventListener("click",()=>{state.size=Number(button.dataset.forgeSize)||1;helpers.rerender();}));shell.querySelectorAll("[data-forge-source]").forEach(button=>button.addEventListener("click",()=>setSource(sources.find(asset=>asset.id===button.dataset.forgeSource))));shell.querySelector("#token-forge-source-select")?.addEventListener("change",event=>setSource(sources.find(asset=>asset.id===event.target.value)));
    const fileInput=shell.querySelector("#token-forge-file");shell.querySelector("#token-forge-upload")?.addEventListener("click",()=>fileInput?.click());fileInput?.addEventListener("change",async()=>{const file=fileInput.files?.[0];fileInput.value="";if(!file)return;try{helpers.toast(`Загружаю ${file.name}`);await uploadSource(ctx,file);helpers.rerender();}catch(error){helpers.toast(error.message);}});
    shell.querySelectorAll("[data-forge-field]").forEach(input=>{const update=()=>{const key=input.dataset.forgeField;if(input.type==="checkbox")state[key]=input.checked;else if(input.type==="number"||input.type==="range")state[key]=Number(input.value);else state[key]=input.value;if(key==="hpMax")state.hp=Math.min(state.hp,Math.max(1,state.hpMax));if(["frameColor","frameSecondary","frameWidth","glow","shadow","backgroundColor"].includes(key)&&state.framePreset!=="none")state.framePreset="classic";redraw();};input.addEventListener(input.tagName==="SELECT"||input.type==="checkbox"||input.type==="color"?"change":"input",update);});
    const folderSelect=shell.querySelector("#token-forge-folder-select"),folderNew=shell.querySelector("#token-forge-folder-new");folderSelect?.addEventListener("change",()=>{if(folderSelect.value==="__new__"){folderNew.hidden=false;state.folder=folderNew.value.trim();folderNew.focus();}else{folderNew.hidden=true;state.folder=folderSelect.value;}});folderNew?.addEventListener("input",()=>{state.folder=folderNew.value.trim();});
    let drag=null;canvas?.addEventListener("pointerdown",event=>{drag={x:event.clientX,y:event.clientY,offsetX:state.offsetX,offsetY:state.offsetY};canvas.setPointerCapture(event.pointerId);});canvas?.addEventListener("pointermove",event=>{if(!drag)return;const rect=canvas.getBoundingClientRect();state.offsetX=clamp(drag.offsetX+(event.clientX-drag.x)/rect.width*100,-120,120);state.offsetY=clamp(drag.offsetY+(event.clientY-drag.y)/rect.height*100,-120,120);redraw();});const end=event=>{drag=null;if(canvas?.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};canvas?.addEventListener("pointerup",end);canvas?.addEventListener("pointercancel",end);canvas?.addEventListener("wheel",event=>{event.preventDefault();state.imageScale=clamp(state.imageScale+(event.deltaY<0?.08:-.08),.35,5);redraw();},{passive:false});
    shell.querySelectorAll("[data-appearance-edit]").forEach(button=>button.addEventListener("click",()=>{const appearance=(ctx.ownSheet?.tokenAppearances||[]).find(item=>item.id===button.dataset.appearanceEdit);openAppearance(appearance,ctx.room);helpers.rerender();}));shell.querySelectorAll("[data-appearance-activate]").forEach(button=>button.addEventListener("click",async()=>{const response=await fetch(`/api/rooms/${ctx.room.code}/character-appearances/${button.dataset.appearanceActivate}/activate`,{method:"PATCH",headers:{"x-client-id":ctx.clientId}}).then(result=>result.json());helpers.toast(response.ok?"Облик переключён":response.error||"Не удалось переключить облик");}));
    shell.querySelector("[data-forge-save]")?.addEventListener("click",()=>saveLibrary(ctx,helpers,false));shell.querySelector("[data-forge-save-place]")?.addEventListener("click",()=>saveLibrary(ctx,helpers,true));shell.querySelector("[data-forge-apply-character]")?.addEventListener("click",()=>saveCharacter(ctx,helpers,"new"));shell.querySelector("[data-forge-appearance-update]")?.addEventListener("click",()=>saveCharacter(ctx,helpers,"update"));redraw();
  }

  window.TT_TOKEN_FORGE={markup,bind,openAsset,openAppearance,openBestiary,reset,get state(){return state;},PRESETS};
})();
