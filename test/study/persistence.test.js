import 'fake-indexeddb/auto';
import { StudyPersistence } from '../../src/study/persistence.js';

global.window = global;

describe('StudyPersistence', () => {
    test('seeds, persists and restores library and rides', async () => {
        const database = `pedalstudy-test-${Date.now()}-${Math.random()}`;
        const persistence = StudyPersistence({database});
        await persistence.start();
        const library = await persistence.library();
        expect(library.map(course => course.code)).toEqual(['MH1810','PH1011','MS1013']);
        const lecture = library[0].lectures[0];
        const ride = {id:'ride-1',status:'complete',course:library[0],lecture,lectureEndPosition:120,endTime:new Date().toISOString(),events:[{id:'bookmark-1',type:'bookmark',timestamp:42,text:''}]};
        await persistence.saveRide(ride);
        expect(await persistence.all('studyRides')).toContainEqual(ride);
        expect(await persistence.all('bookmarks')).toContainEqual(expect.objectContaining({rideId:'ride-1',timestamp:42}));
        const restored = await persistence.library();
        expect(restored[0].lectures[0].position).toBe(120);
    });
});
