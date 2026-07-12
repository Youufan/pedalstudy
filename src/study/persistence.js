import { IDB } from '../storage/idb.js';
import { cloneSamples } from './models.js';

const DATABASE = 'pedalstudy';
const VERSION = 1;
const STORES = ['courses', 'lectures', 'progress', 'studyRides', 'bookmarks', 'confusionMarkers', 'notes', 'settings'];

function StudyPersistence(args = {}) {
    const database = args.database || DATABASE;
    const db = args.db || IDB();

    async function start() {
        await db.start(database, VERSION, STORES);
        const courses = await db.getAll('courses');
        if(!courses?.length) await seed();
        return true;
    }

    async function seed() {
        for(const course of cloneSamples()) {
            const lecture = course.lecture;
            await db.put('courses', {...course, lecture: undefined});
            await db.put('lectures', lecture);
            await db.put('progress', {id: lecture.id, lectureId: lecture.id, position: lecture.lastPosition, progress: lecture.progress, updatedAt: null});
        }
    }

    const all = store => db.getAll(store);
    const put = (store, value) => db.put(store, value);
    const remove = (store, id) => db.remove(store, id);

    async function library() {
        const [courses, lectures, progress] = await Promise.all([all('courses'), all('lectures'), all('progress')]);
        return courses.sort((a,b) => (a.order || 99) - (b.order || 99)).map(course => ({...course, lectures: lectures.filter(lecture => lecture.courseId === course.id).map(lecture => ({...lecture, ...(progress.find(item => item.lectureId === lecture.id) || {})}))}));
    }

    async function saveRide(ride) {
        await put('studyRides', ride);
        for(const event of ride.events || []) {
            const store = event.type === 'bookmark' ? 'bookmarks' : event.type === 'confusion' ? 'confusionMarkers' : 'notes';
            await put(store, {...event, rideId: ride.id, lectureId: ride.lecture.id});
        }
        await put('progress', {id: ride.lecture.id, lectureId: ride.lecture.id, position: ride.lectureEndPosition, progress: ride.lecture.duration ? ride.lectureEndPosition / ride.lecture.duration : 0, updatedAt: ride.endTime});
        return ride;
    }

    return Object.freeze({start, seed, all, put, remove, library, saveRide, stores: STORES});
}

export { DATABASE, STORES, StudyPersistence };
