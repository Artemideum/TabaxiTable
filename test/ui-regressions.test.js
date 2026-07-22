const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("public/app.js", "utf8");
const vtt = fs.readFileSync("public/vtt.js", "utf8");
const vttCss = fs.readFileSync("public/vtt.css", "utf8");

test("полный лист фильтрует вкладки до привязки игровых контролов", () => {
  const applyIndex = app.indexOf("applySheetTab();", app.indexOf("function renderSheet"));
  const bindIndex = app.indexOf("if (mine) bindGameControls();", app.indexOf("function renderSheet"));
  assert.ok(applyIndex > -1 && bindIndex > -1 && applyIndex < bindIndex);
  assert.doesNotMatch(app, /\$\$\('\[data-death-pip\]'\s*,\s*root\)/);
  assert.match(app, /\$\$\('\[data-death-pip\]'\s*,\s*\$\('#sheet-view'\)\)/);
});

test("каждая страница быстрого листа имеет собственную прокрутку", () => {
  assert.match(vtt, /querySelectorAll\("\.vtt-character-page"\)/);
  assert.match(vtt, /event\.stopPropagation\(\)/);
  assert.match(vttCss, /\.vtt-floating-panel\.vtt-character-panel[\s\S]*height:calc\(100dvh - 144px\)/);
  assert.match(vttCss, /\.vtt-floating-panel\.vtt-character-panel \.vtt-character-page[\s\S]*overflow-y:scroll/);
  assert.match(vttCss, /scrollbar-gutter:stable/);
});

test("быстрый HP использует единый кегль для текущего и максимального значения", () => {
  assert.match(vtt, /data-vtt-token-hp-prompt[\s\S]*<strong><span>\$\{hp\}<\/span><i>\/<\/i><span>\$\{hpMax\}<\/span><\/strong>/);
  assert.doesNotMatch(vtt, /data-vtt-token-hp-prompt[\s\S]{0,180}<small>\/\$\{hpMax\}<\/small>/);
  assert.match(vttCss, /\.vtt-token-hp-actions strong[\s\S]*font:800 14px\/1 Unbounded/);
});
