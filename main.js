const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;

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

  // Wait for the local Node server to start before loading the UI
  checkServerAndLoad('http://localhost:3002/studio.html');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function checkServerAndLoad(url) {
  http.get(url, (res) => {
    if (res.statusCode === 200) {
      mainWindow.loadURL(url);
    } else {
      setTimeout(() => checkServerAndLoad(url), 500);
    }
  }).on('error', (err) => {
    setTimeout(() => checkServerAndLoad(url), 500);
  });
}

app.on('ready', () => {
  // 1. Start your existing Node.js server in the background
  const serverPath = path.join(__dirname, 'src', 'index.js'); 
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: 3001, HTTP_PORT: 3002 },
    stdio: 'inherit'
  });

  // 2. Open the desktop window
  createWindow();
});

// Clean up the background server when the app is closed
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