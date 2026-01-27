
function setupRemoteLogging(socket, sourceName) {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    function sendLog(level, args) {
        try {
            // Convert args to safe strings (handle circular refs if possible, or just simple stringify)
            const msg = args.map(a => {
                try {
                    return (typeof a === 'object') ? JSON.stringify(a) : String(a);
                } catch (e) {
                    return '[Circular/Unserializable]';
                }
            }).join(' ');
            
            socket.emit('client-log', {
                source: sourceName,
                level: level,
                message: msg
            });
        } catch (err) {
            // Failsafe
            originalError.call(console, 'Logging Error:', err);
        }
    }

    console.log = (...args) => {
        originalLog.apply(console, args);
        sendLog('INFO', args);
    };

    console.error = (...args) => {
        originalError.apply(console, args);
        sendLog('ERROR', args);
    };

    console.warn = (...args) => {
        originalWarn.apply(console, args);
        sendLog('WARN', args);
    };
    
    // Capture unhandled exceptions
    window.onerror = function (msg, url, lineNo, columnNo, error) {
        sendLog('FATAL', [`Msg: ${msg}`, `Line: ${lineNo}`, `Stack: ${error ? error.stack : ''}`]);
        return false;
    };
    
    // Capture unhandled promise rejections
    window.onunhandledrejection = function(event) {
        sendLog('PROMISE', [`Reason: ${event.reason}`]);
    };
    
    console.log(`${sourceName} Logger Initialized`);
}
