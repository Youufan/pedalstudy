function SimulationTelemetry(args = {}) {
    const onData = args.onData || (() => {});
    const tickMs = args.tickMs || 1000;
    const presets = {
        easy: {power: 105, cadence: 72, heartRate: 112, speed: 23},
        moderate: {power: 155, cadence: 84, heartRate: 138, speed: 29},
        hard: {power: 225, cadence: 94, heartRate: 165, speed: 35},
    };
    let preset = args.preset || 'moderate';
    let connected = false;
    let paused = true;
    let distance = 0;
    let timer;
    let step = 0;

    function sample() {
        const base = presets[preset];
        step += 1;
        const wave = Math.sin(step / 4) + Math.sin(step / 11) * 0.45;
        const jitter = Math.sin(step * 1.73) * 0.55;
        const speed = Math.max(0, base.speed + wave * 1.8 + jitter);
        distance += speed / 3600 * (tickMs / 1000);
        return {
            power: Math.max(0, Math.round(base.power + wave * 12 + jitter * 7)),
            cadence: Math.max(0, Math.round(base.cadence + wave * 3 + jitter * 2)),
            heartRate: Math.max(0, Math.round(base.heartRate + Math.sin(step / 13) * 5 + wave * 2)),
            speed: Number(speed.toFixed(1)),
            distance: Number(distance.toFixed(3)),
            source: 'simulation', connected, preset,
        };
    }

    function emit() { if(connected && !paused) onData(sample()); }
    function connect() { connected = true; paused = true; onData({...sample(), distance: Number(distance.toFixed(3))}); return true; }
    function disconnect() { stopTimer(); connected = false; paused = true; }
    function startTimer() { stopTimer(); timer = setInterval(emit, tickMs); }
    function stopTimer() { if(timer) clearInterval(timer); timer = undefined; }
    function start() { if(!connected) connect(); paused = false; startTimer(); }
    function pause() { paused = true; }
    function resume() { if(connected) { paused = false; startTimer(); } }
    function stop() { stopTimer(); paused = true; }
    function setPreset(value) { if(presets[value]) preset = value; }
    function reset() { distance = 0; step = 0; }
    function state() { return {connected, paused, preset, distance}; }

    return Object.freeze({connect, disconnect, start, pause, resume, stop, reset, sample, setPreset, state});
}

export { SimulationTelemetry };
