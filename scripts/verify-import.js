#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('Verifying document import feature...\n');

// Check if preload has dialog API
const preloadPath = path.join(__dirname, '../dist/preload/preload.js');
const preloadContent = fs.readFileSync(preloadPath, 'utf-8');
const hasDialogAPI = preloadContent.includes('showOpenDialog');
console.log('✓ Preload has dialog API:', hasDialogAPI);

// Check if IPC handler has dialog handler
const ipcHandlersPath = path.join(__dirname, '../dist/main/ipc-handlers.js');
const ipcHandlersContent = fs.readFileSync(ipcHandlersPath, 'utf-8');
const hasDialogHandler = ipcHandlersContent.includes('SHOW_OPEN_DIALOG');
console.log('✓ IPC handlers have dialog handler:', hasDialogHandler);

// Check if types have the channel
const typesPath = path.join(__dirname, '../dist/shared/types.js');
const typesContent = fs.readFileSync(typesPath, 'utf-8');
const hasDialogChannel = typesContent.includes('SHOW_OPEN_DIALOG') || typesContent.includes('dialog:show-open');
console.log('✓ Types have dialog channel:', hasDialogChannel);

// Check renderer
const rendererPath = path.join(__dirname, '../dist/renderer/assets');
const rendererFiles = fs.readdirSync(rendererPath).filter(f => f.endsWith('.js'));
let hasDialogCall = false;
for (const file of rendererFiles) {
  const content = fs.readFileSync(path.join(rendererPath, file), 'utf-8');
  if (content.includes('showOpenDialog') || content.includes('dialog')) {
    hasDialogCall = true;
    break;
  }
}
console.log('✓ Renderer has dialog call:', hasDialogCall);

console.log('\n' + (hasDialogAPI && hasDialogHandler && hasDialogChannel && hasDialogCall 
  ? '✅ All checks passed! Document import should work.' 
  : '❌ Some checks failed. Please rebuild.'));
