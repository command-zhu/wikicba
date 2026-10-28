const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { Store } = require("./store.cjs");
let store,
  main,
  side,
  tray,
  quitting = false;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => {
  if (main) {
    main.show();
    main.focus();
  }
});
function windowFor(sidebar = false) {
  const w = new BrowserWindow({
    width: sidebar ? 380 : 1200,
    height: sidebar ? 700 : 820,
    minWidth: sidebar ? 200 : 850,
    alwaysOnTop: sidebar,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.loadFile(path.join(__dirname, "../dist/index.html"), {
    query: sidebar ? { side: "1" } : {},
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });
  return w;
}
if (gotLock)
  app.whenReady().then(() => {
    store = new Store(app.getPath("userData"));
    main = windowFor();
    tray = new Tray(
      nativeImage.createFromPath(path.join(__dirname, "icon.png")),
    );
    tray.setToolTip("WikiCBA");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "打开工作台", click: () => main.show() },
        {
          label: "悬浮窗",
          click: () => {
            if (!side) side = windowFor(true);
            side.show();
          },
        },
        {
          label: "退出",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on("click", () => main.show());
  });
app.on("before-quit", () => (quitting = true));
ipcMain.handle("api", async (event, method, d = {}) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  switch (method) {
    case "state":
      return { ...store.state, inbox: store.inbox };
    case "pick":
      return (
        await dialog.showOpenDialog(w, {
          properties: ["openDirectory", "multiSelections"],
        })
      ).filePaths;
    case "project":
      store.project(d.name, d.dirs);
      break;
    case "rule":
      if (
        !store.state.projects.some((p) => p.dirs.includes(d.target)) ||
        !d.pattern?.trim() ||
        !["extension", "keyword"].includes(d.kind) ||
        !Number.isFinite(Number(d.priority))
      )
        throw Error("规则无效");
      store.state.rules.push({
        ...d,
        priority: Number(d.priority),
        id: crypto.randomUUID(),
      });
      store.save();
      break;
    case "deleteRule":
      store.state.rules = store.state.rules.filter((r) => r.id !== d.id);
      store.save();
      break;
    case "plan":
      return store.plan(d.source, d.projectId, d.target);
    case "transfer":
      return store.transfer(
        d.source,
        store.plan(d.source, d.projectId, d.target),
        d.mode,
      );
    case "undo":
      store.undo(d.id);
      break;
    case "task":
      store.task(d);
      break;
    case "files": {
      const dirs = [
        store.inbox,
        ...store.state.projects.flatMap((p) => p.dirs),
      ];
      if (!dirs.includes(d.dir)) throw Error("目录未绑定");
      return fs
        .readdirSync(d.dir, { withFileTypes: true })
        .filter((f) => f.isFile())
        .map((f) => ({ name: f.name, path: path.join(d.dir, f.name) }));
    }
    case "reveal":
      if (
        ![store.inbox, ...store.state.projects.flatMap((p) => p.dirs)].some(
          (dir) => d.path.startsWith(dir + path.sep),
        )
      )
        throw Error("路径未绑定");
      shell.showItemInFolder(d.path);
      break;
    case "side":
      if (!side) side = windowFor(true);
      side.show();
      break;
    case "pin":
      w.setAlwaysOnTop(!!d.value);
      break;
    case "dock": {
      const { screen } = require("electron");
      const area = screen.getDisplayMatching(w.getBounds()).workArea;
      w.setPosition(
        d.left ? area.x : area.x + area.width - w.getBounds().width,
        area.y,
      );
      break;
    }
    case "startup":
      app.setLoginItemSettings({ openAtLogin: !!d.value });
      break;
    default:
      throw Error("未知操作");
  }
  return true;
});
