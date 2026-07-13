import { StudyRide, summary } from '../../src/study/ride.js';

const course = {id:'course', code:'MH1810', title:'Mathematics'};
const lecture = {id:'lecture', title:'Neural Networks: Foundations', duration:600};

describe('StudyRide', () => {
    test('supports start, pause, resume and stop', () => {
        let time = 1000;
        const ride = StudyRide({now:() => time});
        expect(ride.start({course,lecture,lecturePosition:30}).status).toBe('active');
        time = 11000;
        expect(ride.pause().status).toBe('paused');
        time = 21000;
        expect(ride.resume().status).toBe('active');
        time = 31000;
        const result = ride.stop(90);
        expect(result.status).toBe('complete');
        expect(result.cyclingDuration).toBe(20);
        expect(result.lectureMinutesWatched).toBe(1);
    });

    test('records bookmarks, confusion markers and timestamped notes', () => {
        const ride = StudyRide({now:() => 1000});
        ride.start({course,lecture});
        ride.addEvent('bookmark', 12);
        ride.addEvent('confusion', 24);
        ride.addEvent('note', 36, 'Check the boundary condition');
        const result = ride.stop(60);
        expect(result.bookmarks[0].timestamp).toBe(12);
        expect(result.confusionMarkers[0].timestamp).toBe(24);
        expect(result.notes[0]).toMatchObject({timestamp:36,text:'Check the boundary condition'});
    });

    test('restores interrupted rides in a safe paused state', () => {
        const ride = StudyRide({now:() => 5000});
        const restored = ride.restore({id:'interrupted',status:'active',course,lecture,cyclingDuration:18,samples:[],events:[]});
        expect(restored.status).toBe('paused');
        expect(ride.snapshot()).toMatchObject({id:'interrupted',cyclingDuration:18});
    });

    test('calculates combined session metrics', () => {
        const result = summary({course,lecture,status:'complete',lectureStartPosition:0,lectureEndPosition:120,events:[],cyclingDuration:60,distance:0.5,samples:[{power:100,cadence:70,heartRate:110},{power:200,cadence:90,heartRate:150}]});
        expect(result).toMatchObject({averagePower:150,maximumPower:200,averageCadence:80,averageHeartRate:130,maximumHeartRate:150,lectureMinutesWatched:2});
        expect(result.playbackProgressGained).toBeCloseTo(.2);
    });
});
