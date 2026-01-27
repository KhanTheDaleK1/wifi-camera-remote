// Shared Logger
window.Logger = {
    source: 'Unknown',
    socket: null,
    
    init(socket, sourceName) {
        this.socket = socket;
        this.source = sourceName;
        
        const debugEl = document.getElementById('debug-console');
        
        // Hook Console
        const oldLog = console.log;
        const oldErr = console.error;
        
        console.log = (...args) => {
            oldLog.apply(console, args);
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            if (debugEl) {
                const line = document.createElement('div');
                line.innerText = `> ${msg}`;
                debugEl.appendChild(line);
                debugEl.scrollTop = debugEl.scrollHeight;
            }
            this.emit('INFO', [msg]);
        };
        
        console.error = (...args) => {
            oldErr.apply(console, args);
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            if (debugEl) {
                const line = document.createElement('div');
                line.style.color = 'red';
                line.innerText = `! ${msg}`;
                debugEl.appendChild(line);
                debugEl.scrollTop = debugEl.scrollHeight;
            }
            this.emit('ERROR', [msg]);
        };
        
        window.onerror = (msg, url, line) => {
            console.error(`Uncaught: ${msg} @ ${line}`);
        };
    },
    
    emit(level, args) {
        if (!this.socket || !this.socket.connected) return;
        const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        this.socket.emit('log', { source: this.source, level, message });
    }
};