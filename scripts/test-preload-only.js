#!/usr/bin/env node
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const preloadPath = path.join(__dirname, '../dist/preload/preload.js');
  console.log('[Test] Preload path:', preloadPath);
  console.log('[Test] File exists:', require('fs').existsSync(preloadPath));
  
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(path.join(__dirname, '../dist/test-preload.html'));
  win.webContents.openDevTools();
  
  win.on('closed', () => app.quit());
});

app.on('window-all-closed', () => app.quit());
