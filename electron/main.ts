import { app, BrowserWindow, ipcMain, shell, safeStorage, session, Tray, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, exec } from 'child_process';
import { ValorantService } from './core/valorantService';

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
} else {
  // Handle second instance - focus the existing window
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashStartTime: number = 0;
let valorantService: ValorantService | null = null;
let tray: Tray | null = null;
let valorantMonitorInterval: NodeJS.Timeout | null = null;
let isAutoStartEnabled: boolean = true;
let isWindowsStartupEnabled: boolean = false;
let lastValorantStatus: string | null = null; // Track last Valorant status to detect transitions

const createSplashWindow = (): BrowserWindow => {
  const possibleLogoPaths = [
    path.resolve(__dirname, '../public/vRadar.png'), // From dist/electron -> root
    path.resolve(__dirname, '../../public/vRadar.png'), // From dist/electron -> root (alternative)
    path.join(process.cwd(), 'public/vRadar.png'), // From current working directory
    path.join(app.getAppPath(), 'public/vRadar.png'), // From app root
    path.join(process.resourcesPath || app.getAppPath(), 'public/vRadar.png'), // From resources
  ];
  
  let logoPath: string | null = null;
  for (const testPath of possibleLogoPaths) {
    if (fs.existsSync(testPath)) {
      logoPath = testPath;
      break;
    }
  }
  
  let imageBase64: string | null = null;
  if (logoPath) {
    try {
      const imageBuffer = fs.readFileSync(logoPath);
      imageBase64 = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
      console.error('Error reading logo file:', error);
    }
  }
  
  const splash = new BrowserWindow({
    width: 300,
    height: 300,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    backgroundColor: '#0f1317',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    show: false,
  });
  
  const splashHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          width: 100vw;
          height: 100vh;
          background: #0f1317;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }
        
        .splash-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }
        
        .splash-logo {
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        
        .splash-logo {
          animation: fadeIn 0.5s ease-in;
        }
      </style>
    </head>
    <body>
      <div class="splash-container">
        ${imageBase64 ? `<img src="${imageBase64}" alt="vRadar Logo" class="splash-logo" />` : '<div class="splash-logo" style="width: 200px; height: 200px; background: #ff4655; border-radius: 50%;"></div>'}
      </div>
    </body>
    </html>
  `;
  
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHTML)}`);
  splash.center();
  
  splash.once('ready-to-show', () => {
    splash.show();
    splash.focus();
    if (splashStartTime === 0) {
      splashStartTime = Date.now();
    }
  });
  
  splash.webContents.once('did-finish-load', () => {
    if (!splash.isVisible()) {
      splash.show();
      splash.focus();
    }
  });
  
  return splash;
};

const createWindow = () => {
  const isDev = process.env.NODE_ENV === 'development';
  const cspPolicy = isDev
    ? "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://media.valorant-api.com https://valorant-api.com https://cdn.henrikdev.xyz https://cmsassets.rgpub.io; " +
      "connect-src 'self' http://localhost:* ws://localhost:* https://valorant-api.com https://api.henrikdev.xyz https://cdn.henrikdev.xyz https://playvalorant.com; " +
      "font-src 'self' data: https://fonts.cdnfonts.com;"
    : "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://media.valorant-api.com https://valorant-api.com https://cdn.henrikdev.xyz https://cmsassets.rgpub.io; " +
      "connect-src 'self' https://valorant-api.com https://api.henrikdev.xyz https://cdn.henrikdev.xyz https://playvalorant.com; " +
      "font-src 'self' data: https://fonts.cdnfonts.com;";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspPolicy]
      }
    });
  });

  mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    minWidth: 1300,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    frame: false,
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, '../public/vRadar.ico'),
    show: false
  });

  const closeSplash = () => {
    if (!splashWindow || splashWindow.isDestroyed()) {
      // If splash is already closed, show main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
      return;
    }
    
    const minDisplayTime = 2000;
    const elapsed = Date.now() - splashStartTime;
    const remainingTime = Math.max(0, minDisplayTime - elapsed);
    
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    }, remainingTime);
  };
  
  mainWindow?.once('ready-to-show', () => {
    closeSplash();
    // Window is ready - if service has status to send, it will be sent now
    if (valorantService) {
      // Service might have already emitted status events, but window wasn't ready
      // The next status event will be received properly
    }
  });
  
  mainWindow?.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      closeSplash();
    }, 300);
  });
  
  // Store a reference to send queued events when window is ready
  mainWindow?.webContents.once('dom-ready', () => {
    // Window DOM is ready - events can now be received
    console.log('Main window DOM ready - can receive IPC messages');
    
    // If service is already running, request current status to ensure frontend gets it
    if (valorantService) {
      // Give it a moment, then request status update
      setTimeout(() => {
        // The service will emit status on its next check, but we can trigger it
        // by checking if we need to send current status
        if (valorantService) {
          // Service loop will handle status updates, but we ensure window is ready
        }
      }, 500);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow?.loadURL('http://localhost:5173');
    mainWindow?.webContents.openDevTools({ mode: 'detach' });
  } else {
    const possiblePaths = [
      path.resolve(__dirname, '../../dist-react/index.html'),
      path.resolve(__dirname, '../dist-react/index.html'),
      path.resolve(app.getAppPath(), 'dist-react/index.html'),
      path.join(process.cwd(), 'dist-react/index.html'),
      path.join(process.resourcesPath || app.getAppPath(), 'dist-react/index.html'),
    ];
    
    if (mainWindow) {
      let htmlPath: string | null = null;
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          htmlPath = testPath;
          break;
        }
      }
      
      if (htmlPath) {
        mainWindow.loadFile(htmlPath).catch((error) => {
          console.error(`Error loading HTML from ${htmlPath}:`, error);
        });
      } else {
        console.error('Could not find HTML file in any of the expected locations:', possiblePaths);
      }
    }
  }

  mainWindow?.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
};

app.whenReady().then(() => {
  isAutoStartEnabled = loadAutoStartSetting();
  isWindowsStartupEnabled = loadWindowsStartupSetting();
  
  // Enforce dependency: if Windows auto-start is disabled, disable Valorant auto-start
  if (!isWindowsStartupEnabled && isAutoStartEnabled) {
    isAutoStartEnabled = false;
    saveAutoStartSetting(false);
  }
  
  // Apply Windows startup setting
  if (isWindowsStartupEnabled) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true, // Start minimized to tray
      name: app.getName(),
      path: process.execPath
    });
  }
  
  createTray();
  
  try {
    splashWindow = createSplashWindow();
    splashStartTime = Date.now();
  } catch (error) {
    console.error('Error creating splash window:', error);
  }
  
  setTimeout(() => {
    const userDataConfigPath = path.join(app.getPath('userData'), 'config.json');
    if (!fs.existsSync(userDataConfigPath)) {
      const possibleSourcePaths = [
        path.join(process.cwd(), 'config.json'),
        path.join(app.getAppPath(), 'config.json'),
        path.join(process.resourcesPath || app.getAppPath(), 'config.json'),
        path.join(process.resourcesPath || app.getAppPath(), 'app.asar.unpacked', 'config.json'),
      ];
      
      for (const sourcePath of possibleSourcePaths) {
        if (fs.existsSync(sourcePath)) {
          try {
            const configContent = fs.readFileSync(sourcePath, 'utf-8');
            fs.writeFileSync(userDataConfigPath, configContent);
            break;
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`Failed to copy config.json from ${sourcePath}:`, errorMessage);
          }
        }
      }
    }
    
    try {
      createWindow();
      
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
          mainWindow.show();
        }
      }, 5000);
    } catch (error) {
      console.error('Error creating window:', error);
      const minDisplayTime = 2000;
      const elapsed = Date.now() - splashStartTime;
      const remainingTime = Math.max(0, minDisplayTime - elapsed);
      
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
      }, remainingTime);
    }
  }, 100);

  try {
    valorantService = new ValorantService();
    
    valorantService.on('matchData', (data) => {
      // Send even if window isn't ready yet - Electron will queue it
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        try {
        mainWindow.webContents.send('match-data', data);
        } catch (error) {
          console.error('Error sending match-data:', error);
        }
      }
    });

    valorantService.on('status', (data) => {
        // Send even if window isn't ready yet - Electron will queue it
        // This is critical for initial startup detection
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          try {
            mainWindow.webContents.send('status-update', data);
          } catch (error) {
            console.error('Error sending status-update:', error);
          }
        } else {
          // Window not ready yet - log it for debugging
          console.log('Status event received but window not ready:', data);
        }
        
        // Show window from tray when Valorant starts (if window is hidden and auto-start is enabled)
        const currentStatus = data.status;
        if (mainWindow && tray && !mainWindow.isDestroyed() && isAutoStartEnabled) {
          // Check if Valorant just started (transitioned from not_running to loading/connected)
          const valorantJustStarted = (lastValorantStatus === 'valorant_not_running' || lastValorantStatus === null) &&
                                      (currentStatus === 'loading' || currentStatus === 'connected');
          
          if (valorantJustStarted && !mainWindow.isVisible()) {
            // Valorant started and window is hidden - show it
            if (mainWindow.isMinimized()) {
              mainWindow.restore();
            }
            mainWindow.show();
            mainWindow.focus();
          }
        }
        
        // Update last status
        lastValorantStatus = currentStatus;
    });
    
    valorantService.on('matchFound', (data) => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          try {
            mainWindow.webContents.send('match-found', data);
          } catch (error) {
            console.error('Error sending match-found:', error);
          }
        }
    });
    
    // Start service - this is async but we don't wait for it
    valorantService.start().catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error('Error starting ValorantService:', error);
      console.error(`Error message: ${errorMessage}`);
      if (errorStack) {
        console.error(`Stack trace: ${errorStack}`);
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Error initializing ValorantService:', error);
    console.error(`Error message: ${errorMessage}`);
    if (errorStack) {
      console.error(`Stack trace: ${errorStack}`);
    }
  }
  
  if (isAutoStartEnabled) {
    startValorantMonitoring();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

const checkValorantRunning = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    
    exec('tasklist /FI "IMAGENAME eq Valorant.exe" /FO CSV', (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(stdout.includes('Valorant.exe'));
    });
  });
};

const createTray = () => {
  const iconPath = path.join(__dirname, '../public/vRadar.ico');
  const iconPaths = [
    iconPath,
    path.resolve(__dirname, '../../public/vRadar.ico'),
    path.join(process.cwd(), 'public/vRadar.ico'),
    path.join(app.getAppPath(), 'public/vRadar.ico'),
    path.join(process.resourcesPath || app.getAppPath(), 'public/vRadar.ico'),
  ];
  
  let trayIconPath: string | null = null;
  for (const testPath of iconPaths) {
    if (fs.existsSync(testPath)) {
      trayIconPath = testPath;
      break;
    }
  }
  
  if (!trayIconPath) {
    console.error('Could not find tray icon');
    return;
  }
  
  tray = new Tray(trayIconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show vRadar',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Auto-start with Valorant',
      type: 'checkbox',
      checked: isAutoStartEnabled,
      click: (item) => {
        isAutoStartEnabled = item.checked;
        saveAutoStartSetting(isAutoStartEnabled);
        if (isAutoStartEnabled) {
          startValorantMonitoring();
        } else {
          stopValorantMonitoring();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('vRadar');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });
};

const loadAutoStartSetting = (): boolean => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      return config.autoStartWithValorant !== false;
    }
  } catch (error) {
    console.error('Error loading auto-start setting:', error);
  }
  return true;
};

const saveAutoStartSetting = (enabled: boolean) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(configContent);
    }
    config.autoStartWithValorant = enabled;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
  } catch (error) {
    console.error('Error saving auto-start setting:', error);
  }
};

const loadWindowsStartupSetting = (): boolean => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      return config.autoStartWithWindows === true;
    }
  } catch (error) {
    console.error('Error loading Windows startup setting:', error);
  }
  return false;
};

const saveWindowsStartupSetting = (enabled: boolean) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    let config: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(configContent);
    }
    config.autoStartWithWindows = enabled;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
    
    // Apply the setting to Windows startup
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true, // Start minimized to tray
      name: app.getName(),
      path: process.execPath
    });
  } catch (error) {
    console.error('Error saving Windows startup setting:', error);
  }
};

const startValorantMonitoring = () => {
  if (valorantMonitorInterval) {
    return;
  }
  
  let wasValorantRunning = false;
  
  valorantMonitorInterval = setInterval(async () => {
    const isRunning = await checkValorantRunning();
    
    if (isRunning && !wasValorantRunning) {
      wasValorantRunning = true;
      console.log('Valorant.exe process detected - waiting for lockfile and notifying service');
      
      // Show window only if auto-start with Valorant is enabled
      if (isAutoStartEnabled) {
        if (mainWindow && !mainWindow.isVisible()) {
          mainWindow.show();
          mainWindow.focus();
        } else if (!mainWindow) {
          createWindow();
        }
      }
      
      // Valorant.exe is running, but lockfile might not be ready yet
      // Emit loading status immediately to let frontend know we detected Valorant
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        try {
          mainWindow.webContents.send('status-update', { status: "loading" });
        } catch (error) {
          console.error('Error sending loading status:', error);
        }
      }
      
      // The service loop will detect the lockfile when it's ready
      // It now also checks for Valorant.exe process, so it will be more patient
      console.log('Valorant.exe detected - service will wait for lockfile to be ready');
    } else if (!isRunning && wasValorantRunning) {
      wasValorantRunning = false;
      console.log('Valorant.exe process no longer running');
    }
  }, 2000); // Check every 2 seconds for faster detection
};

const stopValorantMonitoring = () => {
  if (valorantMonitorInterval) {
    clearInterval(valorantMonitorInterval);
    valorantMonitorInterval = null;
  }
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (tray) {
      mainWindow?.hide();
    } else {
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  stopValorantMonitoring();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

ipcMain.handle('get-local-account', async () => {
  if (!valorantService) return null;
  return await valorantService.getLocalAccount();
});

ipcMain.handle('get-lockfile-account', async () => {
  if (!valorantService) return null;
  return valorantService.getLastLockfileAccount();
});

ipcMain.handle('get-patch-version', async () => {
  if (!valorantService) return '6.9';
  return valorantService.getPatchVersion();
});

ipcMain.handle('get-patch-image', async (event, patchVersion: string) => {
  // Try to get patch image from service if available
  if (valorantService) {
    try {
      const result = await valorantService.getPatchImage(patchVersion);
      console.log('get-patch-image: result from service:', result ? `success - ${result.title}` : 'null');
      if (result && (result.image || result.title)) {
        return result;
      }
    } catch (error) {
      console.error('get-patch-image error from service:', error);
    }
  }
  
  // If service not available or returned null, try to fetch directly
  try {
    console.log('get-patch-image: service unavailable or returned null, fetching directly...');
    
    // Get API key
    let apiKey = '';
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const keyPath = path.join(app.getPath('userData'), 'henrik-api-key.encrypted');
        if (fs.existsSync(keyPath)) {
          const encrypted = fs.readFileSync(keyPath);
          apiKey = safeStorage.decryptString(encrypted);
        }
      }
    } catch (err) {
      console.error('Error loading API key:', err);
    }
    
    if (!apiKey) {
      const { EMBEDDED_API_KEY } = require('./core/constants');
      apiKey = EMBEDDED_API_KEY;
    }
    
    // Fetch patch notes directly using axios
    const axios = require('axios');
    const apiUrl = `https://api.henrikdev.xyz/valorant/v1/website/en-us`;
    console.log('Fetching patch notes directly from:', apiUrl);
    
    const response = await axios.get(apiUrl, {
      timeout: 30000,
      headers: { 'Authorization': apiKey }
    });
    
    console.log('Direct fetch response status:', response.status, 'data status:', response.data?.status);
    
    if (response.data && response.data.status === 200 && response.data.data && Array.isArray(response.data.data) && response.data.data.length > 0) {
      const firstArticle = response.data.data[0];
      const result = {
        image: firstArticle.banner_url || null,
        title: firstArticle.title || null,
        description: firstArticle.description || firstArticle.category || null,
        url: firstArticle.url || firstArticle.external_link || null
      };
      console.log('get-patch-image: direct fetch success:', result.title);
      return result;
    } else {
      console.log('get-patch-image: invalid response format', {
        hasData: !!response.data,
        status: response.data?.status,
        hasDataArray: !!response.data?.data,
        isArray: Array.isArray(response.data?.data),
        length: response.data?.data?.length
      });
    }
  } catch (error) {
    console.error('get-patch-image: direct fetch error:', error);
  }
  
  return null;
});

ipcMain.handle('get-local-match', async (event, gun) => {
  if (!valorantService) return null;
  if (gun) {
     const configResult = valorantService.getConfig();
     // getConfig() can return either a string (during migration) or a config object
     const config = typeof configResult === 'string' ? null : configResult;
     const oldGun = config?.selectedGun || 'vandal';
     valorantService.saveConfig({ selectedGun: gun });
     
     if (oldGun !== gun) {
       try {
         await valorantService.forceReprocess();
         await new Promise(resolve => setTimeout(resolve, 100));
       } catch (error: unknown) {
         const errorMessage = error instanceof Error ? error.message : String(error);
         const errorStack = error instanceof Error ? error.stack : undefined;
         console.error(`[IPC] Error during loadout refetch:`, errorMessage);
         console.error(`[IPC] Error stack:`, errorStack);
       }
     }
  }
  const latestData = valorantService.getLatestData();
  return latestData;
});

ipcMain.handle('get-config', async () => {
  if (!valorantService) return { autoStartWithValorant: isAutoStartEnabled, autoStartWithWindows: isWindowsStartupEnabled };
  const configResult = valorantService.getConfig();
  // getConfig() can return either a string (during migration) or a config object
  const config = typeof configResult === 'string' ? null : configResult;
  if (!config) {
    // If getConfig returned a string (migration case), return default config
    return { autoStartWithValorant: isAutoStartEnabled, autoStartWithWindows: isWindowsStartupEnabled };
  }
  return { ...config, autoStartWithValorant: isAutoStartEnabled, autoStartWithWindows: isWindowsStartupEnabled };
});

ipcMain.handle('get-rank-images', async () => {
  if (!valorantService) {
    try {
      const Content = (await import('./core/content')).Content;
      const Requests = (await import('./core/requestsV')).Requests;
      const Error = (await import('./core/errors')).Error;
      const { version } = await import('./core/constants');
      const log = (msg: string) => console.log(`[Content] ${msg}`);
      const errorSRC = new Error(log);
      const requests = new Requests(version, log, errorSRC);
      const content = new Content(requests, log);
      const rankImages = await content.get_rank_images();
      return rankImages;
    } catch (error) {
      console.error('Error loading rank images directly:', error);
      return {};
    }
  }
  const rankImages = valorantService.getRankImages();
  if (!rankImages || Object.keys(rankImages).length === 0) {
    try {
      const Content = (await import('./core/content')).Content;
      const Requests = (await import('./core/requestsV')).Requests;
      const Error = (await import('./core/errors')).Error;
      const { version } = await import('./core/constants');
      const log = (msg: string) => console.log(`[Content] ${msg}`);
      const errorSRC = new Error(log);
      const requests = new Requests(version, log, errorSRC);
      const content = new Content(requests, log);
      const rankImagesDirect = await content.get_rank_images();
      return rankImagesDirect;
    } catch (error) {
      console.error('Error loading rank images directly:', error);
    }
  }
  return rankImages;
});

ipcMain.handle('get-agent-images', async () => {
  if (!valorantService) {
    // Service not ready yet - try to load agent images directly
    try {
      const Content = (await import('./core/content')).Content;
      const Requests = (await import('./core/requestsV')).Requests;
      const Error = (await import('./core/errors')).Error;
      const { version } = await import('./core/constants');
      const log = (msg: string) => console.log(`[Content] ${msg}`);
      const errorSRC = new Error(log);
      const requests = new Requests(version, log, errorSRC);
      const content = new Content(requests, log);
      const agentImages = await content.get_agent_images();
      return agentImages;
    } catch (error) {
      console.error('Error loading agent images directly:', error);
    return {};
  }
  }
  const agentImages = valorantService.getAgentImages();
  // If service is ready but images aren't loaded yet, try loading directly
  if (!agentImages || Object.keys(agentImages).length === 0) {
    try {
      const Content = (await import('./core/content')).Content;
      const Requests = (await import('./core/requestsV')).Requests;
      const Error = (await import('./core/errors')).Error;
      const { version } = await import('./core/constants');
      const log = (msg: string) => console.log(`[Content] ${msg}`);
      const errorSRC = new Error(log);
      const requests = new Requests(version, log, errorSRC);
      const content = new Content(requests, log);
      const agentImagesDirect = await content.get_agent_images();
      return agentImagesDirect;
    } catch (error) {
      console.error('Error loading agent images directly:', error);
    }
  }
  return agentImages;
});

ipcMain.handle('get-match-history', async (event, puuid: string, startIndex: number, endIndex: number, queue: string) => {
  if (!valorantService) return null;
  return await valorantService.getMatchHistory(puuid, startIndex, endIndex, queue);
});

ipcMain.handle('save-config', async (event, config) => {
  if (!valorantService) return;
  valorantService.saveConfig(config);
  
  if (config.autoStartWithValorant !== undefined) {
    isAutoStartEnabled = config.autoStartWithValorant;
    saveAutoStartSetting(isAutoStartEnabled);
    if (isAutoStartEnabled) {
      startValorantMonitoring();
    } else {
      stopValorantMonitoring();
    }
  }
  
  if (config.autoStartWithWindows !== undefined) {
    isWindowsStartupEnabled = config.autoStartWithWindows;
    saveWindowsStartupSetting(isWindowsStartupEnabled);
    
    // If Windows auto-start is disabled, also disable Valorant auto-start
    if (!isWindowsStartupEnabled && isAutoStartEnabled) {
      isAutoStartEnabled = false;
      saveAutoStartSetting(false);
      stopValorantMonitoring();
      // Update config to reflect this change
      if (valorantService) {
        valorantService.saveConfig({ autoStartWithValorant: false });
      }
    }
  }
  
  // Update tray menu if auto-start with Valorant setting changed
  if (tray && config.autoStartWithValorant !== undefined) {
    const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Show vRadar',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            } else {
              createWindow();
            }
          }
        },
        {
          label: 'Auto-start with Valorant',
          type: 'checkbox',
          checked: isAutoStartEnabled,
          click: (item) => {
            isAutoStartEnabled = item.checked;
            saveAutoStartSetting(isAutoStartEnabled);
            if (isAutoStartEnabled) {
              startValorantMonitoring();
            } else {
              stopValorantMonitoring();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            app.quit();
          }
        }
      ]);
      tray.setContextMenu(contextMenu);
    }
});

ipcMain.handle('save-api-key', async (event, apiKey: string) => {
  try {
    const keyPath = path.join(app.getPath('userData'), 'henrik-api-key.encrypted');
    
    if (!apiKey || apiKey.trim() === '') {
      if (fs.existsSync(keyPath)) {
        fs.unlinkSync(keyPath);
      }
      return { success: true };
    }
    
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('Safe storage encryption is not available on this system');
      return { success: false, error: 'Encryption not available' };
    }
    
    const encrypted = safeStorage.encryptString(apiKey);
    fs.writeFileSync(keyPath, encrypted);
    
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        if (config.henrikApiKey) {
          delete config.henrikApiKey;
          fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        }
      } catch (err) {
        console.error('Error removing API key from config.json:', err);
      }
    }
    
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error saving API key to secure storage:', errorMessage);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-api-key', async () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      const { EMBEDDED_API_KEY } = require('./core/constants');
      return EMBEDDED_API_KEY;
    }
    
    const keyPath = path.join(app.getPath('userData'), 'henrik-api-key.encrypted');
    if (!fs.existsSync(keyPath)) {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          const configContent = fs.readFileSync(configPath, 'utf-8');
          const config = JSON.parse(configContent);
          if (config.henrikApiKey) {
            const encrypted = safeStorage.encryptString(config.henrikApiKey);
            fs.writeFileSync(keyPath, encrypted);
            delete config.henrikApiKey;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
            return config.henrikApiKey;
          }
        } catch (err) {
          console.error('Error migrating API key from config.json:', err);
        }
      }
      const { EMBEDDED_API_KEY } = require('./core/constants');
      return EMBEDDED_API_KEY;
    }
    
    const encrypted = fs.readFileSync(keyPath);
    const decrypted = safeStorage.decryptString(encrypted);
    return decrypted;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error reading API key from secure storage:', errorMessage);
    const { EMBEDDED_API_KEY } = require('./core/constants');
    return EMBEDDED_API_KEY;
  }
});

ipcMain.handle('get-latest-patch-notes', async () => {
  return null;
});

ipcMain.handle('open-external-url', async (event, url: string) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error opening external URL:', errorMessage);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) {
    if (tray) {
      mainWindow.hide();
    } else {
      mainWindow.close();
    }
  }
});

ipcMain.handle('launch-valorant', async () => {
  try {
    const primaryShortcutPath = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Riot Games\\VALORANT.lnk';
    
    if (fs.existsSync(primaryShortcutPath)) {
      try {
        exec(`start "" "${primaryShortcutPath}"`, (error) => {
          if (error) {
            console.error('Failed to launch Valorant shortcut:', error);
          } else {
            console.log('Successfully launched Valorant from shortcut:', primaryShortcutPath);
          }
        });
        return { success: true, method: 'shortcut', path: primaryShortcutPath };
      } catch (error) {
        console.error(`Failed to launch shortcut from ${primaryShortcutPath}:`, error);
      }
    }

    const shortcutPaths = [
      path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Riot Games', 'VALORANT.lnk'),
      path.join(os.homedir(), 'Desktop', 'VALORANT.lnk'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Riot Games', 'VALORANT', 'VALORANT.lnk'),
    ];

    for (const shortcutPath of shortcutPaths) {
      if (fs.existsSync(shortcutPath)) {
        try {
          exec(`start "" "${shortcutPath}"`, (error) => {
            if (error) {
              console.error('Failed to launch shortcut:', error);
            }
          });
          return { success: true, method: 'shortcut', path: shortcutPath };
        } catch (error) {
          console.error(`Failed to launch shortcut from ${shortcutPath}:`, error);
        }
      }
    }

    const protocolFormats = [
      'riotclient://launch/valorant',
      'riotclient://valorant',
      'valorant://',
    ];

    for (const protocol of protocolFormats) {
      try {
        await shell.openExternal(protocol);
        return { success: true, method: 'protocol', protocol };
      } catch (error) {
        console.log(`Protocol ${protocol} failed, trying next:`, error);
        continue;
      }
    }

    const riotClientPaths = [
      path.join(os.homedir(), 'AppData', 'Local', 'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
      'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Riot Games', 'Riot Client', 'RiotClientServices.exe'),
    ];

    for (const exePath of riotClientPaths) {
      if (fs.existsSync(exePath)) {
        try {
          const launchArgs = ['--launch-product=valorant', '--launch-patchline=live'];
          const child = spawn(exePath, launchArgs, {
            detached: true,
            stdio: 'ignore',
            windowsVerbatimArguments: false,
            shell: false
          });
          
          child.unref();
          await new Promise(resolve => setTimeout(resolve, 300));
          return { success: true, method: 'riot-client-services', path: exePath };
        } catch (error) {
          console.error(`Failed to launch from ${exePath}:`, error);
          continue;
        }
      }
    }

    try {
      exec('start "" "riotclient://launch/valorant"', (error) => {
        if (error) {
          console.error('Failed to launch with start command protocol:', error);
        }
      });
      return { success: true, method: 'start-protocol' };
    } catch (error) {
      console.error('Start command protocol failed:', error);
    }

    return { success: false, error: 'Could not launch Valorant. Please launch it manually from Riot Client.' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error launching Valorant:', errorMessage);
    return { success: false, error: errorMessage };
  }
});