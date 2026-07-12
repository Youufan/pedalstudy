import { SimulationTelemetry } from '../../src/study/simulation.js';

describe('SimulationTelemetry', () => {
    test('connects, emits plausible changing normalized telemetry, pauses and stops', () => {
        jest.useFakeTimers();
        const readings = [];
        const simulation = SimulationTelemetry({onData:value => readings.push(value), tickMs:1000});
        simulation.connect();
        simulation.start();
        jest.advanceTimersByTime(3000);
        expect(readings.length).toBeGreaterThanOrEqual(4);
        expect(readings.at(-1)).toEqual(expect.objectContaining({source:'simulation', connected:true, preset:'moderate'}));
        expect(readings.at(-1).power).toBeGreaterThan(80);
        expect(new Set(readings.map(value => value.power)).size).toBeGreaterThan(1);
        const pausedCount = readings.length;
        simulation.pause();
        jest.advanceTimersByTime(2000);
        expect(readings).toHaveLength(pausedCount);
        simulation.stop();
        expect(simulation.state().paused).toBe(true);
        jest.useRealTimers();
    });

    test('intensity presets change the effort', () => {
        const simulation = SimulationTelemetry();
        simulation.connect();
        simulation.setPreset('easy');
        const easy = simulation.sample();
        simulation.setPreset('hard');
        const hard = simulation.sample();
        expect(hard.power).toBeGreaterThan(easy.power);
        expect(hard.heartRate).toBeGreaterThan(easy.heartRate);
    });
});
