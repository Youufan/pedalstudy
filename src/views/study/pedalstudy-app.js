import { xf } from '../../functions.js';
import { createLecture, formatClock } from '../../study/models.js';
import { LecturePlayer } from '../../study/lecture-player.js';
import { StudyPersistence } from '../../study/persistence.js';
import { StudyRide } from '../../study/ride.js';
import { SimulationTelemetry } from '../../study/simulation.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const isoDate = value => value ? new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric'}).format(new Date(value)) : 'Not studied yet';
const pct = value => `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`;
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; };

class PedalStudyApp extends HTMLElement {
    constructor() {
        super();
        this.persistence = StudyPersistence();
        this.ride = StudyRide();
        this.library = [];
        this.rides = [];
        this.view = 'home';
        this.selected = null;
        this.telemetry = {power:0, cadence:0, heartRate:0, speed:0, distance:0, connected:false, preset:'moderate'};
        this.elapsed = 0;
        this.lecturePosition = 0;
        this.lectureDuration = 0;
        this.player = null;
        this.rideTicker = null;
        this.pendingLocalFile = null;
        this.summary = null;
        this.rideSource = 'simulation';
        this.setupSource = 'simulation';
        this.studyGoal = '30 minute focus block';
        this.auukiTelemetry = {power:0,cadence:0,heartRate:0,speed:0,distance:0,connected:false,source:'auuki'};
        this.signalController = new AbortController();
        this.simulation = SimulationTelemetry({onData: data => this.onTelemetry(data)});
    }

    async connectedCallback() {
        this.setAttribute('aria-label', 'PedalStudy application');
        await this.persistence.start();
        await this.refresh();
        this.selected = this.firstLecture();
        this.restoreInterruptedRide();
        this.render();
        this.addEventListener('click', event => this.onClick(event), {signal: this.signalController.signal});
        this.addEventListener('submit', event => this.onSubmit(event), {signal: this.signalController.signal});
        this.addEventListener('change', event => this.onChange(event), {signal: this.signalController.signal});
        window.addEventListener('keydown', event => this.onKeydown(event), {signal: this.signalController.signal});
        window.addEventListener('beforeunload', event => {
            if(this.ride.snapshot()?.status === 'active') { event.preventDefault(); event.returnValue = ''; }
        }, {signal: this.signalController.signal});
        const subscription = {signal: this.signalController.signal};
        xf.sub('db:power1s', value => this.onAuukiTelemetry('power', value), subscription);
        xf.sub('db:cadence', value => this.onAuukiTelemetry('cadence', value), subscription);
        xf.sub('db:heartRate', value => this.onAuukiTelemetry('heartRate', value), subscription);
        xf.sub('db:speed', value => this.onAuukiTelemetry('speed', Number(value || 0) * 3.6), subscription);
        xf.sub('db:distance', value => this.onAuukiTelemetry('distance', Number(value || 0) / 1000), subscription);
        xf.sub('ble:controllable:connected', () => this.onAuukiTelemetry('connected', true), subscription);
        xf.sub('ble:controllable:disconnected', () => this.onAuukiTelemetry('connected', false), subscription);
    }

    disconnectedCallback() { this.signalController.abort(); this.player?.destroy(); this.simulation.disconnect(); clearInterval(this.rideTicker); }
    async refresh() { this.library = await this.persistence.library(); this.rides = (await this.persistence.all('studyRides')).sort((a,b) => String(b.endTime).localeCompare(String(a.endTime))); }
    firstLecture() { const course = this.library.find(item => item.lectures?.length); return course ? {course, lecture: course.lectures[0]} : null; }

    nav() {
        const items = [['home','⌂','Home'],['library','▣','Library'],['ride','▶','Start Ride'],['history','▤','History'],['settings','⚙','Settings']];
        return `<aside class="ps-nav"><button class="ps-brand" data-action="navigate" data-view="home" aria-label="PedalStudy home"><span class="ps-mark"><i></i></span><span>Pedal<span>Study</span></span></button><nav>${items.map(([id,icon,label]) => `<button data-action="navigate" data-view="${id}" class="${this.view === id ? 'active' : ''}" aria-label="${label}"><b>${icon}</b><span>${label}</span></button>`).join('')}</nav><div class="ps-nav-foot"><span>PS</span><small>Midnight Study Lab</small></div></aside>`;
    }

    render() {
        this.player?.destroy(); this.player = null;
        const body = this.view === 'home' ? this.home() : this.view === 'library' ? this.libraryView() : this.view === 'ride' ? this.rideView() : this.view === 'summary' ? this.summaryView() : this.view === 'history' ? this.historyView() : this.settingsView();
        this.innerHTML = `${this.nav()}<main class="ps-main">${body}</main>${this.setupDialog()}${this.noteDialog()}${document.body.classList.contains('ps-show-legacy')?'<button class="ps-legacy-return" data-action="legacy-toggle">Return to PedalStudy</button>':''}`;
        if(this.view === 'ride' && this.ride.snapshot()) this.mountPlayer();
    }

    header(title, kicker = '') { return `<header class="ps-page-head"><div><span class="ps-eyebrow">${esc(kicker)}</span><h1>${esc(title)}</h1></div><button class="ps-avatar" aria-label="Local profile">PS</button></header>`; }

    home() {
        const recent = this.selected || this.firstLecture();
        const weekStart = Date.now() - 7 * 86400000;
        const weekly = this.rides.filter(ride => new Date(ride.endTime || 0).getTime() >= weekStart);
        const cycleSeconds = weekly.reduce((sum, ride) => sum + (ride.cyclingDuration || 0), 0);
        const learningSeconds = weekly.reduce((sum, ride) => sum + (ride.lectureMinutesWatched || 0) * 60, 0);
        const studyDays = new Set(this.rides.map(ride => String(ride.endTime || '').slice(0,10))).size;
        const focus = this.rides.length ? Math.min(99, Math.round(62 + this.rides.reduce((sum, ride) => sum + (ride.events?.length || 0), 0) / this.rides.length * 4)) : null;
        const recovery = localStorage.getItem('pedalstudy:recoveryAvailable') === 'true' ? `<div class="ps-recovery"><div><strong>Interrupted Study Ride found</strong><span>Resume safely from a paused state or discard the local recovery.</span></div><button class="ps-primary" data-action="recover-ride">Resume ride</button><button data-action="discard-recovery">Discard</button></div>` : '';
        const progressCopy = recent?.lecture.progress > 0 ? `${pct(recent.lecture.progress)} complete · ${isoDate(recent.lecture.updatedAt || recent.lecture.lastStudied)}` : 'Not started';
        const weeklyCycling = cycleSeconds ? `<strong>${(cycleSeconds / 3600).toFixed(1)}</strong><small>hours this week</small>` : '<div class="ps-stat-empty"><strong>No rides yet</strong><small>Your weekly cycling total will appear here.</small></div>';
        const weeklyLearning = learningSeconds ? `<strong>${(learningSeconds / 3600).toFixed(1)}</strong><small>hours this week</small>` : '<div class="ps-stat-empty"><strong>No study time yet</strong><small>Complete a Study Ride to begin tracking learning time.</small></div>';
        return `${this.header(`${greeting()}.`, 'Focus. Pedal. Progress.')}${recovery}
        <section class="ps-home-grid">
            <article class="ps-panel ps-continue"><div class="ps-section-label">${recent?.lecture.progress > 0 ? 'Continue studying' : 'Next lecture'}</div>${recent ? `<div class="ps-course-art"><span>${esc(recent.course.code)}</span><div class="ps-orbit"></div></div><div class="ps-continue-copy"><small>${esc(recent.course.code)} · ${esc(recent.course.module)}</small><h2>${esc(recent.lecture.title)}</h2><div class="ps-progress"><i style="width:${pct(recent.lecture.progress)}"></i></div><p>${progressCopy}</p><button class="ps-primary" data-action="navigate" data-view="ride">${recent.lecture.progress > 0 ? 'Continue studying' : 'Prepare Study Ride'}</button></div>` : `<div class="ps-empty"><h2>Your next study ride starts here</h2><p>Add a lecture to the library, then combine focused learning with an indoor ride.</p><button class="ps-primary" data-action="navigate" data-view="library">Open Library</button></div>`}</article>
            <article class="ps-panel ps-stat"><span>Weekly cycling</span>${weeklyCycling}</article>
            <article class="ps-panel ps-stat"><span>Weekly learning</span>${weeklyLearning}</article>
            <article class="ps-panel ps-score"><div><span>Study Ride streak</span><strong>${studyDays}</strong><small>${studyDays === 1 ? 'day' : 'days'}</small></div><div><span>Focus score</span><strong>${focus ?? '—'}${focus ? '%' : ''}</strong><small>${focus ? 'based on completed rides' : 'complete a ride to unlock'}</small></div></article>
            <article class="ps-home-cta"><span class="ps-section-label">Quick Start</span><div class="ps-quick-row"><small>Selected lecture</small><strong>${esc(recent?.lecture.title || 'Choose a lecture')}</strong><span>${esc(recent?.course.code || 'Library empty')}</span></div><div class="ps-quick-row"><small>Cycling source</small><strong>Simulation</strong><span>No trainer required</span></div><div class="ps-quick-row"><small>Study goal</small><strong>${esc(this.studyGoal)}</strong><span>Adjust during setup</span></div><button class="ps-primary ps-large" data-action="navigate" data-view="ride">Start Study Ride <span>→</span></button></article>
        </section>`;
    }

    libraryView() {
        return `${this.header('Study Library', 'Your courses and lectures')}<div class="ps-library-toolbar"><p>${this.library.length} courses · ${this.library.reduce((n,c)=>n+c.lectures.length,0)} lectures</p><button class="ps-primary" data-action="new-lecture">Add lecture</button></div><section class="ps-library-grid">${this.library.map(course => `<article class="ps-panel ps-course-card" style="--course:${course.accent || '#2f7cff'}"><div class="ps-course-top"><span>${esc(course.code)}</span><button data-action="delete-course" data-course="${course.id}" aria-label="Delete ${esc(course.code)}">×</button></div><div class="ps-course-visual"><i></i><b>${esc(course.code.slice(0,2))}</b></div><h2>${esc(course.title)}</h2><p>${esc(course.module)} · ${esc(course.chapter)}</p>${course.lectures.map(lecture => `<div class="ps-lecture-row"><div><strong>${esc(lecture.title)}</strong><small>${esc(lecture.sourceType === 'youtube' ? 'YouTube' : lecture.sourceType === 'local' ? 'Local MP4' : 'Video URL')} · ${lecture.duration ? formatClock(lecture.duration) : 'Duration unknown'}</small><div class="ps-progress"><i style="width:${pct(lecture.progress)}"></i></div><small>${pct(lecture.progress)} · ${isoDate(lecture.updatedAt || lecture.lastStudied)}</small></div><button class="ps-icon-btn" data-action="setup" data-lecture="${lecture.id}" aria-label="Start ${esc(lecture.title)}">→</button><button class="ps-icon-btn danger" data-action="delete-lecture" data-lecture="${lecture.id}" aria-label="Delete ${esc(lecture.title)}">×</button></div>`).join('')}</article>`).join('')}</section>`;
    }

    rideView() {
        const current = this.ride.snapshot();
        if(!current) return this.startRideView();
        const events = current.events || [];
        const zone = this.telemetry.power < 110 ? 1 : this.telemetry.power < 150 ? 2 : this.telemetry.power < 195 ? 3 : this.telemetry.power < 240 ? 4 : 5;
        return `<header class="ps-ride-head"><div class="ps-wordmark">Pedal<span>Study</span></div><div><small>${esc(current.course.code)} · ${esc(current.course.chapter)}</small><h1>Live Study Ride</h1></div><time>${formatClock(this.elapsed)}</time></header>
        <section class="ps-ride-layout">
            <aside class="ps-telemetry ps-panel">${this.metric('Power',this.telemetry.power,'W')}${this.metric('Cadence',this.telemetry.cadence,'RPM')}${this.metric('Heart rate',this.telemetry.heartRate,'BPM')}<div class="ps-zone"><span>Zone</span><strong>${zone}</strong><div>${[1,2,3,4,5].map(i=>`<i class="${i<=zone?'on':''}"></i>`).join('')}</div></div>${this.metric('Speed',this.telemetry.speed.toFixed?.(1)||0,'KM/H')}${this.metric('Distance',this.telemetry.distance.toFixed?.(2)||0,'KM')}</aside>
            <div class="ps-lecture-stage ps-panel"><div class="ps-lecture-title"><span>${esc(current.course.title)}</span><h2>${esc(current.lecture.title)}</h2></div><div id="ps-player-host" class="ps-player-host"></div><div class="ps-player-meta"><span>${formatClock(this.lecturePosition)} / ${formatClock(this.lectureDuration || current.lecture.duration)}</span><label>Speed <select data-action="rate"><option>0.75</option><option selected>1</option><option>1.25</option><option>1.5</option><option>2</option></select></label></div></div>
            <aside class="ps-ride-side"><div class="ps-panel ps-connection"><span>Ride source</span><strong><i class="${this.telemetry.connected?'online':''}"></i>${this.telemetry.connected?(this.rideSource==='simulation'?'Simulation connected':'Auuki device connected'):'Disconnected'}</strong>${this.rideSource==='simulation'?`<label>Intensity<select data-action="preset"><option value="easy" ${this.telemetry.preset==='easy'?'selected':''}>Easy</option><option value="moderate" ${this.telemetry.preset==='moderate'?'selected':''}>Moderate</option><option value="hard" ${this.telemetry.preset==='hard'?'selected':''}>Hard</option></select></label>`:'<small>Connect and control hardware from the Cycling workspace.</small>'}</div><div class="ps-panel ps-route"><span>Session progress</span><svg viewBox="0 0 180 116"><path d="M8 104 C36 88 27 65 62 67 S89 44 112 47 S133 21 173 12"/><circle cx="8" cy="104" r="4"/><circle cx="112" cy="47" r="5"/></svg><small>${events.length} study moments saved</small></div></aside>
            <div class="ps-actions"><button data-action="study-event" data-type="bookmark"><b>⌑</b><span>Bookmark<small>B</small></span></button><button data-action="study-event" data-type="confusion"><b>?</b><span>Confusing<small>C</small></span></button><button data-action="note"><b>▤</b><span>Note<small>N</small></span></button><button data-action="lecture-toggle"><b>${this.player?.isPlaying()?'Ⅱ':'▶'}</b><span>Lecture<small>Space</small></span></button></div>
            <div class="ps-ride-controls"><button data-action="ride-toggle" class="ps-primary">${current.status === 'paused' ? 'Resume ride' : 'Pause ride'}</button><button data-action="end-ride" class="ps-danger">End session</button></div>
            <div class="ps-timeline ps-panel"><header><span>Session timeline</span><small>Select a moment to return to it</small></header><div>${events.length ? events.slice().reverse().map(event => `<button data-action="seek-event" data-time="${event.timestamp}"><i class="${event.type}">${event.type==='bookmark'?'⌑':event.type==='confusion'?'?':'▤'}</i><span>${esc(event.type === 'confusion' ? 'Confusing moment' : event.type === 'bookmark' ? 'Bookmark' : event.text)}<small>${formatClock(event.timestamp)}</small></span></button>`).join('') : `<p>No study moments yet. Use the large controls or keyboard shortcuts.</p>`}</div></div>
        </section>`;
    }

    startRideView() {
        const selectedId = this.selected?.lecture.id;
        return `${this.header('Start Ride', 'Choose a lecture and cycling source')}
        <section class="ps-start-layout">
            <div class="ps-start-main">
                <div class="ps-start-section-head"><div><span class="ps-section-label">1 · Lecture</span><h2>What are you studying?</h2></div><button data-action="navigate" data-view="library">Manage library</button></div>
                <div class="ps-start-lectures">${this.library.flatMap(course => course.lectures.map(lecture => `<button class="ps-panel ps-start-lecture ${selectedId===lecture.id?'selected':''}" data-action="select-start-lecture" data-lecture="${lecture.id}"><span>${esc(course.code)}</span><strong>${esc(lecture.title)}</strong><small>${esc(course.title)} · ${lecture.duration?formatClock(lecture.duration):'Duration unknown'}</small><i>${selectedId===lecture.id?'Selected':'Select'}</i></button>`)).join('')}</div>
                <div class="ps-start-section-head"><div><span class="ps-section-label">2 · Cycling source</span><h2>How are you riding?</h2></div></div>
                <div class="ps-source-options"><button class="ps-panel ${this.setupSource==='simulation'?'selected':''}" data-action="select-source" data-source="simulation"><b>SIM</b><span><strong>Simulation</strong><small>Ride without hardware</small></span></button><button class="ps-panel ${this.setupSource==='device'?'selected':''}" data-action="select-source" data-source="device"><b>TR</b><span><strong>Connect trainer</strong><small>Use the Auuki cycling engine</small></span></button><button class="ps-panel" data-action="advanced-cycling"><b>SN</b><span><strong>Connect sensors</strong><small>Power, cadence and heart rate</small></span></button></div>
            </div>
            <aside class="ps-panel ps-start-summary"><span class="ps-section-label">Ready to begin</span><h2>${esc(this.selected?.lecture.title || 'Select a lecture')}</h2><dl><div><dt>Course</dt><dd>${esc(this.selected?.course.code || '—')}</dd></div><div><dt>Cycling</dt><dd>${this.setupSource==='simulation'?'Simulation':'Connected trainer'}</dd></div><div><dt>Study goal</dt><dd>${esc(this.studyGoal)}</dd></div></dl><label>Study goal<select data-action="goal"><option value="20 minute focus block">20 minute focus block</option><option value="30 minute focus block" selected>30 minute focus block</option><option value="Finish this lecture">Finish this lecture</option></select></label><button class="ps-primary ps-large" data-action="start-direct">Start Study Ride <span>→</span></button></aside>
        </section>`;
    }

    metric(label,value,unit) { return `<div class="ps-metric"><span>${label}</span><strong>${value || 0}<small>${unit}</small></strong><svg viewBox="0 0 100 20"><polyline points="0,15 10,12 20,14 30,7 40,11 50,5 60,13 70,8 80,10 90,4 100,7"/></svg></div>`; }

    summaryView() {
        const s = this.summary || this.rides[0];
        if(!s) return `${this.header('Session Summary')}<div class="ps-empty ps-panel"><h2>No completed Study Rides yet</h2><button class="ps-primary" data-action="setup">Start your first ride</button></div>`;
        return `${this.header('Session Summary', `${s.course?.code || ''} · ${s.lecture?.title || ''}`)}<section class="ps-summary-grid"><aside class="ps-panel ps-summary-stats">${[['Duration',formatClock(s.cyclingDuration)],['Distance',`${Number(s.distance||0).toFixed(2)} km`],['Average power',`${s.averagePower||0} W`],['Maximum power',`${s.maximumPower||0} W`],['Average cadence',`${s.averageCadence||0} RPM`],['Average heart rate',`${s.averageHeartRate||0} BPM`],['Maximum heart rate',`${s.maximumHeartRate||0} BPM`]].map(([l,v])=>`<div><span>${l}</span><strong>${v}</strong></div>`).join('')}</aside><div class="ps-panel ps-chart"><header><div><h2>Cycling and learning, together</h2><p>Intensity trace with saved study moments</p></div></header>${this.chart(s)}<div class="ps-chart-legend"><span><i class="power"></i>Power</span><span><i class="study"></i>Study moment</span></div></div><aside class="ps-panel ps-learning-total"><span>Lecture watched</span><strong>${(s.lectureMinutesWatched||0).toFixed(1)}</strong><small>minutes</small><div class="ps-ring" style="--value:${Math.min(100,Math.round((s.playbackProgressGained||0)*100))}"><b>${Math.round((s.playbackProgressGained||0)*100)}%</b><span>progress gained</span></div>${[['Bookmarks',s.bookmarks?.length||0],['Confusing',s.confusionMarkers?.length||0],['Notes',s.notes?.length||0]].map(([l,v])=>`<div class="ps-learning-row"><span>${l}</span><strong>${v}</strong></div>`).join('')}</aside><div class="ps-panel ps-summary-events"><h2>Study timeline</h2>${(s.events||[]).length ? (s.events||[]).map(event=>`<button data-action="continue-at" data-lecture="${s.lecture.id}" data-time="${event.timestamp}"><i class="${event.type}">${event.type==='bookmark'?'⌑':event.type==='confusion'?'?':'▤'}</i><span><strong>${esc(event.type==='note'?event.text:event.type==='confusion'?'Confusing moment':'Bookmark')}</strong><small>${formatClock(event.timestamp)}</small></span></button>`).join('') : '<p>No study moments were saved in this ride.</p>'}</div><div class="ps-summary-actions"><button class="ps-primary" data-action="continue-lecture" data-lecture="${s.lecture.id}">Continue lecture</button><button data-action="navigate" data-view="home">Return home</button></div></section>`;
    }

    chart(s) {
        const samples = s.samples || [];
        if(samples.length < 2) return '<div class="ps-chart-empty">A cycling intensity trace appears after telemetry is recorded.</div>';
        const max = Math.max(250, ...samples.map(x=>x.power));
        const points = samples.map((x,i)=>`${(i/(samples.length-1)*600).toFixed(1)},${(190-(x.power/max*150)).toFixed(1)}`).join(' ');
        const events = (s.events||[]).map(event=>{ const x = s.lectureEndPosition>s.lectureStartPosition ? (event.timestamp-s.lectureStartPosition)/(s.lectureEndPosition-s.lectureStartPosition)*600 : 0; return `<line x1="${Math.max(0,Math.min(600,x))}" y1="24" x2="${Math.max(0,Math.min(600,x))}" y2="190"/><circle cx="${Math.max(0,Math.min(600,x))}" cy="24" r="6"/>`; }).join('');
        return `<svg class="ps-summary-chart" viewBox="0 0 600 210" preserveAspectRatio="none"><g class="grid"><line x1="0" y1="40" x2="600" y2="40"/><line x1="0" y1="90" x2="600" y2="90"/><line x1="0" y1="140" x2="600" y2="140"/><line x1="0" y1="190" x2="600" y2="190"/></g><polyline class="power-line" points="${points}"/><g class="event-lines">${events}</g></svg>`;
    }

    historyView() { return `${this.header('History','Completed Study Rides')}<section class="ps-history">${this.rides.length?this.rides.map(ride=>`<button class="ps-panel" data-action="open-summary" data-ride="${ride.id}"><span>${isoDate(ride.endTime)}</span><strong>${esc(ride.lecture.title)}</strong><small>${formatClock(ride.cyclingDuration)} cycling · ${(ride.lectureMinutesWatched||0).toFixed(1)} min learning</small><b>→</b></button>`).join(''):`<div class="ps-empty ps-panel"><span class="ps-empty-icon">▤</span><h2>No Study Rides yet</h2><p>Complete a ride to see cycling effort, lecture progress and saved study moments together.</p><button class="ps-primary" data-action="navigate" data-view="ride">Start your first Study Ride</button></div>`}</section>`; }
    cyclingView() { return `${this.header('Cycling','Auuki engine')}<div class="ps-cycling-bridge ps-panel"><div><span class="ps-status-dot"></span><h2>Auuki cycling console</h2><p>The original cycling workspace remains available with Bluetooth, Web Serial, FTMS, FE-C, Wahoo CPS, trainer control, workouts, and FIT recording intact.</p></div><button class="ps-primary" data-action="legacy-toggle">${document.body.classList.contains('ps-show-legacy')?'Return to PedalStudy':'Open cycling console'}</button></div>`; }
    settingsView() { return `${this.header('Settings','Device local preferences')}<section class="ps-settings"><article class="ps-panel"><span class="ps-section-label">Study preferences</span><h2>Midnight Study Lab</h2><p>PedalStudy keeps courses, lecture progress, notes and Study Rides on this device.</p><label>Default simulation intensity<select data-action="preset"><option value="easy">Easy</option><option value="moderate" selected>Moderate</option><option value="hard">Hard</option></select></label></article><article class="ps-panel ps-advanced-cycling"><span class="ps-section-label">Trainer and Advanced Cycling</span><h2>Auuki cycling console</h2><p>Connect trainers and sensors, run structured workouts, control ERG, resistance and grade simulation, and record FIT activities.</p><button class="ps-primary" data-action="legacy-toggle">Open cycling console</button></article><article class="ps-panel"><span class="ps-section-label">About and source</span><h2>Open source foundation</h2><p>PedalStudy extends Auuki, created by Dimitar Marinoff. Its cycling protocol implementations and FIT recording remain attributed to Auuki.</p><div class="ps-settings-links"><a href="https://github.com/Youufan/pedalstudy" target="_blank" rel="noreferrer">Source code</a><a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">GNU AGPL v3</a><a href="https://github.com/dvmarinoff/Auuki" target="_blank" rel="noreferrer">Original Auuki project</a></div></article></section>`; }

    setupDialog() { return `<dialog id="ps-setup-dialog" class="ps-dialog"><form method="dialog"><button class="ps-dialog-close" value="cancel" aria-label="Close">×</button><span class="ps-eyebrow">Study Ride setup</span><h2>Choose your lecture and ride source</h2><label>Lecture<select id="ps-lecture-select">${this.library.flatMap(c=>c.lectures.map(l=>`<option value="${l.id}" ${this.selected?.lecture.id===l.id?'selected':''}>${esc(c.code)} · ${esc(l.title)}</option>`)).join('')}</select></label><label>Ride source<select id="ps-source-select"><option value="simulation">Simulation</option><option value="device">Connected Auuki device</option></select></label><label>Intensity<select id="ps-intensity-select"><option value="easy">Easy</option><option value="moderate" selected>Moderate</option><option value="hard">Hard</option></select></label><div id="ps-local-reminder" class="ps-local-reminder"></div><button class="ps-primary" data-action="start-ride" value="cancel">Start Study Ride</button></form></dialog><dialog id="ps-lecture-dialog" class="ps-dialog"><form id="ps-lecture-form"><button type="button" class="ps-dialog-close" data-action="close-lecture-dialog" aria-label="Close">×</button><span class="ps-eyebrow">Study Library</span><h2>Add a lecture</h2><label>Course<select name="courseId">${this.library.map(c=>`<option value="${c.id}">${esc(c.code)} · ${esc(c.title)}</option>`).join('')}</select></label><label>Lecture title<input name="title" required maxlength="120" placeholder="Lecture title"></label><label>Lecture source<select name="sourceType" id="ps-source-type"><option value="youtube">YouTube URL</option><option value="video">Direct video URL</option><option value="local">Local MP4 for this session</option></select></label><label id="ps-source-url-label">Source URL<input name="source" type="url" placeholder="https://"></label><label id="ps-local-file-label" hidden>Local MP4<input name="localFile" type="file" accept="video/mp4,video/webm"></label><button class="ps-primary" type="submit">Save lecture</button></form></dialog>`; }
    noteDialog() { return `<dialog id="ps-note-dialog" class="ps-dialog ps-note-dialog"><form id="ps-note-form"><button type="button" class="ps-dialog-close" data-action="close-note" aria-label="Close">×</button><span class="ps-eyebrow">Timestamped note · ${formatClock(this.lecturePosition)}</span><h2>Capture the thought before it moves on</h2><textarea id="ps-note-text" required maxlength="800" placeholder="What matters here?"></textarea><button class="ps-primary" type="submit">Save note</button></form></dialog>`; }

    async onClick(event) {
        const target = event.target.closest('[data-action]'); if(!target) return;
        const action = target.dataset.action;
        if(action === 'navigate') { this.view = target.dataset.view; this.render(); }
        if(action === 'setup') { if(target.dataset.lecture) this.selectLecture(target.dataset.lecture); this.querySelector('#ps-setup-dialog')?.showModal(); }
        if(action === 'new-lecture') this.querySelector('#ps-lecture-dialog')?.showModal();
        if(action === 'close-lecture-dialog') this.querySelector('#ps-lecture-dialog')?.close();
        if(action === 'start-ride') this.startRide();
        if(action === 'study-event') this.addStudyEvent(target.dataset.type);
        if(action === 'note') this.openNote();
        if(action === 'close-note') this.closeNote();
        if(action === 'lecture-toggle') this.player?.toggle();
        if(action === 'ride-toggle') this.toggleRide();
        if(action === 'end-ride') await this.endRide();
        if(action === 'seek-event') this.player?.seek(Number(target.dataset.time));
        if(action === 'delete-lecture') await this.deleteLecture(target.dataset.lecture);
        if(action === 'delete-course') await this.deleteCourse(target.dataset.course);
        if(action === 'continue-lecture' || action === 'continue-at') { this.selectLecture(target.dataset.lecture, Number(target.dataset.time)||undefined); this.querySelector('#ps-setup-dialog')?.showModal(); }
        if(action === 'open-summary') { this.summary = this.rides.find(r=>r.id===target.dataset.ride); this.view='summary'; this.render(); }
        if(action === 'select-start-lecture') { this.selectLecture(target.dataset.lecture); this.render(); }
        if(action === 'select-source') { this.setupSource=target.dataset.source; this.render(); }
        if(action === 'advanced-cycling') { this.view='settings'; this.render(); }
        if(action === 'start-direct') this.startRide(true);
        if(action === 'legacy-toggle') { document.body.classList.toggle('ps-show-legacy'); this.render(); }
        if(action === 'recover-ride') this.recoverRide();
        if(action === 'discard-recovery') { localStorage.removeItem('pedalstudy:activeRide'); localStorage.removeItem('pedalstudy:recoveryAvailable'); this.render(); }
    }

    async onSubmit(event) {
        if(event.target.id === 'ps-note-form') { event.preventDefault(); const text = this.querySelector('#ps-note-text').value; this.addStudyEvent('note', text); this.closeNote(); }
        if(event.target.id === 'ps-lecture-form') { event.preventDefault(); const data = new FormData(event.target); const courseId = data.get('courseId'); const sourceType = data.get('sourceType'); const file = data.get('localFile'); const lecture = createLecture({courseId,title:data.get('title'),sourceType,source:sourceType==='local'?'':data.get('source'),localName:file?.name}); if(sourceType==='local' && file?.size) this.pendingLocalFile = file; await this.persistence.put('lectures',lecture); await this.refresh(); this.selectLecture(lecture.id); this.querySelector('#ps-lecture-dialog')?.close(); this.render(); }
    }

    onChange(event) {
        if(event.target.dataset.action === 'rate') this.player?.rate(Number(event.target.value));
        if(event.target.dataset.action === 'preset') { this.telemetry.preset=event.target.value; this.simulation.setPreset(event.target.value); }
        if(event.target.dataset.action === 'goal') this.studyGoal=event.target.value;
        if(event.target.id === 'ps-source-type') { const local = event.target.value==='local'; this.querySelector('#ps-local-file-label').hidden=!local; this.querySelector('#ps-source-url-label').hidden=local; }
    }

    onKeydown(event) {
        if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName) || this.view !== 'ride') { if(event.key==='Escape') this.closeNote(); return; }
        const key = event.key.toLowerCase();
        if(key==='b') this.addStudyEvent('bookmark');
        if(key==='c') this.addStudyEvent('confusion');
        if(key==='n') this.openNote();
        if(event.code==='Space') { event.preventDefault(); this.player?.toggle(); }
        if(event.key==='Escape') this.closeNote();
    }

    selectLecture(id, position) { for(const course of this.library) { const lecture=course.lectures.find(item=>item.id===id); if(lecture) { this.selected={course,lecture:{...lecture,lastPosition:position??lecture.position??lecture.lastPosition}}; return; } } }
    async deleteLecture(id) { if(!confirm('Delete this lecture and its saved progress?')) return; await this.persistence.remove('lectures',id); await this.persistence.remove('progress',id); await this.refresh(); this.selected=this.firstLecture(); this.render(); }
    async deleteCourse(id) { const course=this.library.find(c=>c.id===id); if(!course || !confirm(`Delete ${course.code} and its lectures?`)) return; for(const lecture of course.lectures) { await this.persistence.remove('lectures',lecture.id); await this.persistence.remove('progress',lecture.id); } await this.persistence.remove('courses',id); await this.refresh(); this.selected=this.firstLecture(); this.render(); }

    startRide(direct = false) {
        const select=this.querySelector('#ps-lecture-select'); if(select) this.selectLecture(select.value);
        if(!this.selected) return;
        const intensity=this.querySelector('#ps-intensity-select')?.value||'moderate'; this.rideSource=direct?this.setupSource:(this.querySelector('#ps-source-select')?.value||'simulation');
        this.simulation.reset(); this.simulation.setPreset(intensity); this.telemetry.preset=intensity;
        this.ride=StudyRide(); this.ride.start({course:this.selected.course,lecture:this.selected.lecture,lecturePosition:this.selected.lecture.position||this.selected.lecture.lastPosition||0});
        this.elapsed=0; this.lecturePosition=this.selected.lecture.position||this.selected.lecture.lastPosition||0; this.lectureDuration=this.selected.lecture.duration||0;
        if(this.rideSource==='simulation'){this.simulation.connect();this.simulation.start();}else{this.telemetry={...this.telemetry,...this.auukiTelemetry};} this.startTicker(); this.view='ride'; this.render(); this.saveRecovery();
    }

    mountPlayer() { const host=this.querySelector('#ps-player-host'); if(!host)return; this.player=LecturePlayer(host,{onProgress:({position,duration})=>{this.lecturePosition=position; this.lectureDuration=duration||this.lectureDuration; this.ride.setLecturePosition(position); const time=this.querySelector('.ps-player-meta > span'); if(time) time.textContent=`${formatClock(position)} / ${formatClock(this.lectureDuration)}`;}}); this.player.load(this.ride.snapshot().lecture,this.pendingLocalFile); }
    startTicker() { clearInterval(this.rideTicker); this.rideTicker=setInterval(()=>{ const current=this.ride.snapshot(); if(current?.status==='active'){this.elapsed+=1; const timer=this.querySelector('.ps-ride-head time'); if(timer)timer.textContent=formatClock(this.elapsed); if(this.elapsed%5===0)this.saveRecovery();}},1000); }
    onTelemetry(data) { this.telemetry={...this.telemetry,...data}; this.ride.addTelemetry(data); if(this.view==='ride') this.updateTelemetryDOM(); }
    onAuukiTelemetry(key,value) { this.auukiTelemetry[key]=Number.isFinite(Number(value))?Number(value):value; if(this.rideSource==='device'&&this.ride.snapshot()?.status==='active')this.onTelemetry(this.auukiTelemetry); }
    updateTelemetryDOM() { const values=[this.telemetry.power,this.telemetry.cadence,this.telemetry.heartRate,this.telemetry.speed.toFixed(1),this.telemetry.distance.toFixed(2)]; this.querySelectorAll('.ps-metric > strong').forEach((el,i)=>{const unit=el.querySelector('small')?.outerHTML||'';el.innerHTML=`${values[i]??0}${unit}`;}); }
    addStudyEvent(type,text='') { const event=this.ride.addEvent(type,this.player?.currentTime()??this.lecturePosition,text); this.saveRecovery(); this.render(); return event; }
    openNote() { this.querySelector('#ps-note-dialog')?.showModal(); setTimeout(()=>this.querySelector('#ps-note-text')?.focus(),0); }
    closeNote() { this.querySelector('#ps-note-dialog')?.close(); }
    toggleRide() { const current=this.ride.snapshot(); if(current?.status==='paused'){this.ride.resume();this.simulation.resume();}else{this.ride.pause();this.simulation.pause();}this.saveRecovery();this.render(); }
    async endRide() { this.simulation.stop(); clearInterval(this.rideTicker); this.player?.pause(); this.summary=this.ride.stop(this.player?.currentTime()??this.lecturePosition); await this.persistence.saveRide(this.summary); localStorage.removeItem('pedalstudy:activeRide'); localStorage.removeItem('pedalstudy:recoveryAvailable'); await this.refresh(); this.view='summary'; this.render(); }
    saveRecovery() { const snap=this.ride.snapshot(); if(snap)localStorage.setItem('pedalstudy:activeRide',JSON.stringify({...snap,rideSource:this.rideSource,recoveredAt:new Date().toISOString()})); }
    restoreInterruptedRide() { const raw=localStorage.getItem('pedalstudy:activeRide'); if(!raw)return; try { const saved=JSON.parse(raw); if(saved.status==='active'||saved.status==='paused') localStorage.setItem('pedalstudy:recoveryAvailable','true'); }catch(_){localStorage.removeItem('pedalstudy:activeRide');} }
    recoverRide() { try { const saved=JSON.parse(localStorage.getItem('pedalstudy:activeRide')); this.ride=StudyRide(); this.ride.restore(saved); this.rideSource=saved.rideSource||'simulation'; this.selected={course:saved.course,lecture:saved.lecture}; this.elapsed=Math.round(saved.cyclingDuration||0); this.lecturePosition=saved.lectureEndPosition||saved.lectureStartPosition||0; this.lectureDuration=saved.lecture?.duration||0; this.telemetry.distance=saved.distance||0; if(this.rideSource==='simulation'){this.simulation.connect();this.simulation.pause();}else{this.telemetry={...this.telemetry,...this.auukiTelemetry};} localStorage.removeItem('pedalstudy:recoveryAvailable'); this.view='ride'; this.startTicker(); this.render(); } catch(_) { localStorage.removeItem('pedalstudy:activeRide'); localStorage.removeItem('pedalstudy:recoveryAvailable'); this.render(); } }
}

customElements.define('pedalstudy-app', PedalStudyApp);
