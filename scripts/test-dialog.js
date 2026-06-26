#!/usr/bin/env node

// Simple test to check if the dialog API works
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../dist/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // Test the dialog directly
  ipcMain.handle('dialog:show-open', async (event) => {
    console.log('[TEST] Dialog handler called');
    const window = BrowserWindow.fromWebContents(event.sender);
    console.log('[TEST] Window found:', !!window);
    
    if (!window) {
      console.error('[TEST] Could not find window for dialog');
      return null;
    }
    
    try {
      console.log('[TEST] Opening dialog...');
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['txt', 'md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      console.log('[TEST] Dialog result:', result);
      
      if (result.canceled || result.filePaths.length === 0) {
        console.log('[TEST] Dialog canceled or no file selected');
        return null;
      }
      
      console.log('[TEST] Selected file:', result.filePaths[0]);
      return result.filePaths[0];
    } catch (error) {
      console.error('[TEST] Error showing open dialog:', error);
      return null;
    }
  });

  // Load a simple HTML page
  win.loadURL('data:text/html,<html><body><h1>Test</h1><button onclick="test()">Test Dialog</button><script>async function test(){const path=await window.knowledgeBase.dialog.showOpenDialog();console.log("Got path:",path);alert("Selected: "+path);}</script></body></html>');
  
  win.webContents.openDevTools();

  win.on('closed', () => {
    app.quit();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
