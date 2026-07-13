import { createLecture, formatClock, studyEvent } from '../../src/study/models.js';

describe('PedalStudy models', () => {
    test('creates safe lecture metadata', () => {
        const lecture = createLecture({courseId:'course', title:'  Mechanics  ', sourceType:'youtube', source:'https://youtu.be/test'});
        expect(lecture.courseId).toBe('course');
        expect(lecture.title).toBe('Mechanics');
        expect(lecture.progress).toBe(0);
    });

    test('creates timestamped study events', () => {
        expect(studyEvent('bookmark', 42.5)).toMatchObject({type:'bookmark', timestamp:42.5});
        expect(studyEvent('confusion', 84)).toMatchObject({type:'confusion', timestamp:84});
        expect(studyEvent('note', 126, 'Revisit this derivation')).toMatchObject({type:'note', timestamp:126, text:'Revisit this derivation'});
    });

    test('formats lecture clocks', () => {
        expect(formatClock(65)).toBe('1:05');
        expect(formatClock(3661)).toBe('1:01:01');
    });
});
