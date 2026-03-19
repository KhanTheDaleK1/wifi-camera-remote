// main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;

function startNodeServer() {
  // Forks your existing server process so it runs alongside the UI
  const serverPath = path.join(__dirname, 'src', 'index.js'); 
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: 3001, HTTP_PORT: 3002 }, // Use current defaults
    stdio: 'inherit'
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "WiFi Camera Remote - Studio Hub",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Wait for the local server to be ready before loading the UI
  const checkServer = setInterval(() => {
    http.get('http://localhost:3002/studio.html', (res) => {
      if (res.statusCode === 200) {
        clearInterval(checkServer);
        mainWindow.loadURL('http://localhost:3002/studio.html');
      }
    }).on('error', () => {
      // Server not ready yet, keep waiting
    });
  }, 500);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', () => {
  startNodeServer();
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