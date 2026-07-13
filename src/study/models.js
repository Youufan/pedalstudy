const uid = (prefix = 'ps') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const SAMPLE_COURSES = [
    {
        id: 'mh1810', code: 'MH1810', title: 'Mathematics', accent: '#2f7cff', order: 1,
        module: 'Mathematics for Computing', chapter: 'Neural Networks',
        lecture: {
            id: 'mh1810-lecture-1', courseId: 'mh1810', title: 'Neural Networks: Foundations',
            sourceType: 'youtube', source: 'https://www.youtube.com/watch?v=aircAruvnKk', duration: 1156,
            progress: 0.42, lastPosition: 486, lastStudied: null,
        },
    },
    {
        id: 'ph1011', code: 'PH1011', title: 'Physics', accent: '#8fc866', order: 2,
        module: 'Mechanics', chapter: 'Energy and Momentum',
        lecture: {
            id: 'ph1011-lecture-1', courseId: 'ph1011', title: 'Work, Energy and Conservation Laws',
            sourceType: 'youtube', source: 'https://www.youtube.com/watch?v=b1t41Q3xRM8', duration: 734,
            progress: 0.18, lastPosition: 132, lastStudied: null,
        },
    },
    {
        id: 'ms1013', code: 'MS1013', title: 'Materials Science', accent: '#72a7ff', order: 3,
        module: 'Structure of Materials', chapter: 'Crystal Structures',
        lecture: {
            id: 'ms1013-lecture-1', courseId: 'ms1013', title: 'Atomic Bonding and Crystal Structures',
            sourceType: 'youtube', source: 'https://www.youtube.com/watch?v=QqjcCvzWwww', duration: 988,
            progress: 0.08, lastPosition: 79, lastStudied: null,
        },
    },
];

function cloneSamples() {
    return SAMPLE_COURSES.map(course => ({...course, lecture: {...course.lecture}}));
}

function createLecture(input = {}) {
    const sourceType = input.sourceType || 'youtube';
    return {
        id: input.id || uid('lecture'),
        courseId: input.courseId,
        title: String(input.title || 'Untitled lecture').trim(),
        sourceType,
        source: String(input.source || '').trim(),
        duration: Number(input.duration) || 0,
        progress: Number(input.progress) || 0,
        lastPosition: Number(input.lastPosition) || 0,
        lastStudied: input.lastStudied || null,
        localName: input.localName || null,
    };
}

function studyEvent(type, timestamp, text = '') {
    if(!['bookmark', 'confusion', 'note'].includes(type)) throw new Error(`Unsupported study event: ${type}`);
    return {id: uid(type), type, timestamp: Math.max(0, Number(timestamp) || 0), text: String(text || '').trim(), createdAt: new Date().toISOString()};
}

function formatClock(seconds = 0) {
    const value = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export { SAMPLE_COURSES, cloneSamples, createLecture, formatClock, studyEvent, uid };
