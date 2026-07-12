function youtubeId(url = '') {
    try {
        const parsed = new URL(url);
        if(parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('/')[0];
        if(parsed.hostname.includes('youtube.com')) return parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).pop();
    } catch(_) {}
    return null;
}

function LecturePlayer(host, callbacks = {}) {
    let kind = 'none';
    let video;
    let iframe;
    let position = 0;
    let duration = 0;
    let playing = false;
    let poller;
    let localUrl;

    function emit() {
        callbacks.onProgress?.({position, duration, playing});
    }

    function clear() {
        clearInterval(poller);
        poller = undefined;
        if(localUrl) URL.revokeObjectURL(localUrl);
        localUrl = undefined;
        host.innerHTML = '';
        video = undefined;
        iframe = undefined;
        playing = false;
    }

    function load(lecture, file) {
        clear();
        position = Number(lecture.lastPosition) || 0;
        duration = Number(lecture.duration) || 0;
        if(lecture.sourceType === 'youtube') return loadYouTube(lecture);
        if(lecture.sourceType === 'local') {
            if(!file) return error('Select the local MP4 again to begin. PedalStudy stores progress, not large video files.');
            localUrl = URL.createObjectURL(file);
            return loadVideo(localUrl);
        }
        if(lecture.sourceType === 'video') return loadVideo(lecture.source);
        error('This lecture source is not supported.');
    }

    function loadVideo(src) {
        kind = 'video';
        video = document.createElement('video');
        video.className = 'ps-native-video';
        video.controls = true;
        video.preload = 'metadata';
        video.src = src;
        video.addEventListener('loadedmetadata', () => {
            duration = Number.isFinite(video.duration) ? video.duration : duration;
            video.currentTime = Math.min(position, Math.max(0, duration - 0.25));
            emit();
        });
        video.addEventListener('timeupdate', () => { position = video.currentTime; emit(); });
        video.addEventListener('play', () => { playing = true; emit(); });
        video.addEventListener('pause', () => { playing = false; emit(); });
        video.addEventListener('error', () => error('This video could not be played. Check the URL, file format, and browser support.'));
        host.append(video);
    }

    function loadYouTube(lecture) {
        const id = youtubeId(lecture.source);
        if(!id) return error('This YouTube URL is invalid.');
        kind = 'youtube';
        iframe = document.createElement('iframe');
        iframe.className = 'ps-youtube-player';
        iframe.title = lecture.title;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?enablejsapi=1&playsinline=1&rel=0&start=${Math.floor(position)}`;
        iframe.addEventListener('load', () => {
            post('getDuration'); post('getCurrentTime');
            poller = setInterval(() => { post('getCurrentTime'); post('getDuration'); }, 1000);
        });
        host.append(iframe);
    }

    function post(func, args = []) {
        iframe?.contentWindow?.postMessage(JSON.stringify({event: 'command', func, args}), 'https://www.youtube.com');
    }

    function onMessage(event) {
        if(!iframe || event.source !== iframe.contentWindow) return;
        try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if(data?.event === 'infoDelivery') {
                if(Number.isFinite(data.info?.currentTime)) position = data.info.currentTime;
                if(Number.isFinite(data.info?.duration) && data.info.duration > 0) duration = data.info.duration;
                if(Number.isFinite(data.info?.playerState)) playing = data.info.playerState === 1;
                emit();
            }
        } catch(_) {}
    }
    window.addEventListener('message', onMessage);

    function play() { if(kind === 'video') video?.play(); else if(kind === 'youtube') post('playVideo'); }
    function pause() { if(kind === 'video') video?.pause(); else if(kind === 'youtube') post('pauseVideo'); playing = false; emit(); }
    function toggle() { playing ? pause() : play(); }
    function seek(seconds) {
        position = Math.max(0, Number(seconds) || 0);
        if(kind === 'video' && video) video.currentTime = position;
        else if(kind === 'youtube') post('seekTo', [position, true]);
        emit();
    }
    function rate(value) { if(kind === 'video' && video) video.playbackRate = value; else if(kind === 'youtube') post('setPlaybackRate', [value]); }
    function currentTime() { return kind === 'video' && video ? video.currentTime : position; }
    function getDuration() { return kind === 'video' && video ? video.duration || duration : duration; }
    function isPlaying() { return playing; }
    function error(message) { kind = 'error'; host.innerHTML = `<div class="ps-player-error"><strong>Lecture unavailable</strong><span>${message}</span></div>`; callbacks.onError?.(message); }
    function destroy() { clear(); window.removeEventListener('message', onMessage); }

    return Object.freeze({load, play, pause, toggle, seek, rate, currentTime, duration: getDuration, isPlaying, destroy});
}

export { LecturePlayer, youtubeId };
