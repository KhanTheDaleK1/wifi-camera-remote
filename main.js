const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;
let serverStarted = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "WiFi Camera Remote - Studio Master Hub",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Start checking the server
  checkServerAndLoad('http://localhost:3002/studio.html', 0);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function checkServerAndLoad(url, attempts) {
  if (attempts > 20) {
    dialog.showErrorBox("Server Error", "The background camera server failed to start after 10 seconds. Please check if another app is using port 3001 or 3002.");
    return;
  }

  http.get(url, (res) => {
    if (res.statusCode === 200) {
      mainWindow.loadURL(url);
      serverStarted = true;
    } else {
      setTimeout(() => checkServerAndLoad(url, attempts + 1), 500);
    }
  }).on('error', (err) => {
    setTimeout(() => checkServerAndLoad(url, attempts + 1), 500);
  });
}

app.on('ready', () => {
  try {
    const serverPath = path.join(__dirname, 'src', 'index.js'); 
    
    // Fork the background server process
    serverProcess = fork(serverPath, [], {
      env: { 
        ...process.env, 
        PORT: 3001, 
        HTTP_PORT: 3002,
        NODE_ENV: 'production' 
      },
      stdio: 'inherit'
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server process:', err);
    });

    serverProcess.on('exit', (code, signal) => {
      if (code !== 0 && !serverStarted) {
        console.error(`Server exited with code ${code} and signal ${signal}`);
      }
    });

    createWindow();
  } catch (e) {
    console.error('Main Process Error:', e);
  }
});

app.on('window-all-closed', function () {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});