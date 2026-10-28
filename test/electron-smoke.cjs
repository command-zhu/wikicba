// Run with Electron on a Windows desktop/CI runner, never against real user data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wikicba-desktop-"));
app.setPath("userData", root);
const timeout = setTimeout(() => {
  console.error("Desktop smoke timed out");
  app.exit(1);
}, 30000);
require("../electron/main.cjs");
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win);
    if (win.webContents.isLoading())
      await new Promise((resolve, reject) => {
        win.webContents.once("did-finish-load", resolve);
        win.webContents.once("did-fail-load", (_, code, message) =>
          reject(Error(`${code}: ${message}`)),
        );
      });
    const result = await win.webContents.executeJavaScript(`(async()=>{
  const wait=()=>new Promise(r=>setTimeout(r,100));
  for(let i=0;i<50&&!document.querySelector('h1');i++)await wait();
  if(!window.desktop)throw Error('Preload bridge unavailable');
  if(!document.body.textContent.includes('把资料放到对的地方'))throw Error('UI did not render');
  await window.desktop.call('task',{title:'Native smoke task',q:1});
  let state=await window.desktop.call('state');
  if(state.tasks.length!==1)throw Error('Task IPC failed');
  await window.desktop.call('task',{id:state.tasks[0].id,q:2,done:true});
  state=await window.desktop.call('state');
  if(state.tasks[0].q!==2||!state.tasks[0].done)throw Error('Task update failed');
  await window.desktop.call('side');
  return true;
 })()`);
    assert.equal(result, true);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    console.log(
      "PASS: native preload, rendered UI, task IPC and floating window",
    );
    clearTimeout(timeout);
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(0);
  } catch (e) {
    console.error(e);
    clearTimeout(timeout);
    app.exit(1);
  }
});
