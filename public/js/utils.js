
// Shared Logger
window.Logger = {
    source: 'Unknown',
    socket: null,
    
    init(socket, sourceName) {
        this.socket = socket;
        this.source = sourceName;
        
        // Hook Console
        const oldLog = console.log;
        const oldErr = console.error;
        
        console.log = (...args) => {
            oldLog.apply(console, args);
            this.emit('INFO', args);
        };
        
        console.error = (...args) => {
            oldErr.apply(console, args);
            this.emit('ERROR', args);
        };
        
        window.onerror = (msg, url, line) => {
            this.emit('FATAL', [`Uncaught: ${msg} @ ${line}`]);
        };
    },
    
    emit(level, args) {
        if (!this.socket) return;
        const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        this.socket.emit('log', { source: this.source, level, message });
    }
};
