const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const settings=fs.readFileSync(path.join(__dirname,'..','settings.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
test('Settings offers live game edit mode, not mock controls',()=>{
  assert.match(settings,/id="settings-control-start"/);
  assert.match(settings,/BLOCKS_BEGIN_CONTROL_EDIT/);
  assert.doesNotMatch(settings,/settings-control-row|settings-control-key/);
});
test('Solo portrait live control editor isolates normal presses and touch capture',()=>{
  assert.match(app,/let controlEditing=false/);
  assert.match(app,/function press\(button\)\{\s*if\(controlEditing\)return/);
  assert.match(app,/function findControlStart\(target,x,y\)\{\s*if\(controlEditing\)return null/);
  assert.match(app,/window\.BLOCKS_BEGIN_CONTROL_EDIT/);
  assert.match(app,/if\(resumeGame\)game\.pause\(\)/);
  assert.match(app,/clearControlContacts\(\)/);
  assert.match(app,/const ghost=button\.cloneNode\(true\)/);
  assert.match(app,/window\.BLOCKS_RESET_CONTROL_ORDER/);
});
test('Preference and appearance are portrait-only and live control icon is cloned',()=>{
  assert.match(app,/blocks:control-order:v1:/);
  assert.match(css,/body:not\(\.two-player\):not\(\.remote-multiplayer\) #controls \.control/);
  assert.match(css,/blocks-control-wiggle/);
  assert.match(css,/body > \.control\.control-edit-ghost/);
});
