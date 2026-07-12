import { studyEvent, uid } from './models.js';

function StudyRide(args = {}) {
    const now = args.now || (() => Date.now());
    let ride = null;
    let activeStartedAt = 0;

    function start({course, lecture, lecturePosition = 0} = {}) {
        if(ride?.status === 'active') return ride;
        const startedAt = now();
        activeStartedAt = startedAt;
        ride = {
            id: uid('ride'), status: 'active', course: {...course}, lecture: {...lecture},
            startTime: new Date(startedAt).toISOString(), endTime: null,
            lectureStartPosition: lecturePosition, lectureEndPosition: lecturePosition,
            cyclingDuration: 0, distance: 0, samples: [], events: [], pausedAt: null,
        };
        return ride;
    }

    function restore(snapshot) {
        ride = JSON.parse(JSON.stringify(snapshot));
        ride.status = 'paused';
        ride.pausedAt = now();
        activeStartedAt = 0;
        return ride;
    }

    function pause() {
        if(!ride || ride.status !== 'active') return ride;
        ride.cyclingDuration += Math.max(0, (now() - activeStartedAt) / 1000);
        ride.status = 'paused';
        ride.pausedAt = now();
        return ride;
    }

    function resume() {
        if(!ride || ride.status !== 'paused') return ride;
        ride.status = 'active';
        ride.pausedAt = null;
        activeStartedAt = now();
        return ride;
    }

    function addTelemetry(data) {
        if(!ride || ride.status !== 'active') return;
        ride.distance = Number(data.distance) || ride.distance;
        ride.samples.push({time: ride.cyclingDuration + Math.max(0, (now() - activeStartedAt) / 1000), power: data.power || 0, cadence: data.cadence || 0, heartRate: data.heartRate || 0, speed: data.speed || 0});
    }

    function addEvent(type, timestamp, text = '') {
        if(!ride) throw new Error('A Study Ride has not started');
        const event = studyEvent(type, timestamp, text);
        ride.events.push(event);
        return event;
    }

    function setLecturePosition(position) { if(ride) ride.lectureEndPosition = Math.max(0, Number(position) || 0); }
    function snapshot() { return ride ? JSON.parse(JSON.stringify(ride)) : null; }

    function stop(lecturePosition = 0) {
        if(!ride) return null;
        if(ride.status === 'active') ride.cyclingDuration += Math.max(0, (now() - activeStartedAt) / 1000);
        ride.status = 'complete';
        ride.endTime = new Date(now()).toISOString();
        ride.lectureEndPosition = Math.max(0, Number(lecturePosition) || 0);
        return summary(ride);
    }

    return Object.freeze({start, restore, pause, resume, stop, addTelemetry, addEvent, setLecturePosition, snapshot});
}

function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function summary(ride) {
    const samples = ride.samples || [];
    const powers = samples.map(sample => sample.power).filter(Number.isFinite);
    const cadences = samples.map(sample => sample.cadence).filter(Number.isFinite);
    const heartRates = samples.map(sample => sample.heartRate).filter(Number.isFinite);
    const watched = Math.max(0, (ride.lectureEndPosition || 0) - (ride.lectureStartPosition || 0));
    return {
        ...ride,
        lectureMinutesWatched: watched / 60,
        playbackProgressGained: ride.lecture?.duration ? watched / ride.lecture.duration : 0,
        averagePower: Math.round(average(powers)), maximumPower: powers.length ? Math.max(...powers) : 0,
        averageCadence: Math.round(average(cadences)),
        averageHeartRate: Math.round(average(heartRates)), maximumHeartRate: heartRates.length ? Math.max(...heartRates) : 0,
        bookmarks: ride.events.filter(event => event.type === 'bookmark'),
        confusionMarkers: ride.events.filter(event => event.type === 'confusion'),
        notes: ride.events.filter(event => event.type === 'note'),
    };
}

export { StudyRide, summary };
