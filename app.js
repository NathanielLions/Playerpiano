/**
 * Player Piano Visualizer - Core Frontend Orchestration Engine
 * Revision 1.2.0 (Status: Frozen Boundary Layer)
 */

// Visual Constants & Engine Calibration Scalars
const SCROLL_SPEED_PX_SEC = 120; 
const MIN_MIDI = 24;
const MAX_MIDI = 96;
const TOTAL_KEYS = 73;

// Absolute mapping array to determine white key progression fractions
const BLACK_KEYS_IN_OCTAVE = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#

// Application State Containers
let songData = null;
let renderNotes = [];
let isPlaying = false;
let startTime = 0;
let elapsedTime = 0;
let animationFrameId = null;

// DOM Cache Elements
const canvasContainer = document.getElementById('canvasContainer');
const canvas = document.getElementById('rollCanvas');
const ctx = canvas.getContext('2d');
const dropZone = document.getElementById('dropZone');
const midiInput = document.getElementById('midiInput');
const songInfo = document.getElementById('songInfo');
const playPauseBtn = document.getElementById('playPauseBtn');
const resetBtn = document.getElementById('resetBtn');
const controlsRow = document.getElementById('controlsRow');
const keyboardContainer = document.getElementById('pianoKeyboard');

// Procedural Off-White Paper Texture Cache
let paperPattern = null;
function createPaperTexture() {
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 128;
    pCanvas.height = 128;
    const pCtx = pCanvas.getContext('2d');
    pCtx.fillStyle = '#FBF7F0'; 
    pCtx.fillRect(0, 0, 128, 128);
    
    // Add micro fiber noise speckles
    pCtx.fillStyle = 'rgba(42, 34, 24, 0.03)';
    for (let i = 0; i < 40; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        pCtx.fillRect(x, y, 1.5, 1.5);
    }
    paperPattern = ctx.createPattern(pCanvas, 'repeat');
}

// ==============================================================================
// 1. MATHEMATICAL KEYBOARD GEOMETRY ENGINE
// ==============================================================================

/**
 * Counts white keys up to a specific MIDI note starting from MIN_MIDI (24)
 */
function getWhiteKeyCountBefore(targetMidi) {
    let count = 0;
    for (let midi = MIN_MIDI; midi < targetMidi; midi++) {
        if (!BLACK_KEYS_IN_OCTAVE.includes(midi % 12)) {
            count++;
        }
    }
    return count;
}

/**
 * Total white keys within the active hardware space (MIDI 24-96 incorporates 43 white keys)
 */
function getTotalWhiteKeys() {
    return getWhiteKeyCountBefore(MAX_MIDI + 1);
}

/**
 * Builds the responsive mathematical structural keyboard layout
 */
function buildKeyboardGeometry() {
    keyboardContainer.innerHTML = '';
    const containerWidth = keyboardContainer.clientWidth;
    const totalWhiteKeys = getTotalWhiteKeys();
    const whiteKeyWidth = containerWidth / totalWhiteKeys;
    const blackKeyWidth = whiteKeyWidth * 0.65; // Proportional black scaling factor

    for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
        const isBlack = BLACK_KEYS_IN_OCTAVE.includes(midi % 12);
        const keyEl = document.createElement('div');
        keyEl.id = `key-${midi}`;
        
        if (!isBlack) {
            const whiteIndex = getWhiteKeyCountBefore(midi);
            keyEl.className = 'key white';
            keyEl.style.width = `${whiteKeyWidth}px`;
            keyEl.style.left = `${whiteIndex * whiteKeyWidth}px`;
        } else {
            // Place black key symmetrically above white key divisions
            const precedingWhiteIndex = getWhiteKeyCountBefore(midi);
            keyEl.className = 'key black';
            keyEl.style.width = `${blackKeyWidth}px`;
            keyEl.style.left = `${(precedingWhiteIndex * whiteKeyWidth) - (blackKeyWidth / 2)}px`;
        }
        keyboardContainer.appendChild(keyEl);
    }
}

/**
 * Standardizes mapping from Note pitches directly into canvas pixel space fractions
 */
function midiToX(midi) {
    const totalWhiteKeys = getTotalWhiteKeys();
    const whiteKeyWidth = (canvas.width / (window.devicePixelRatio || 1)) / totalWhiteKeys;
    const isBlack = BLACK_KEYS_IN_OCTAVE.includes(midi % 12);
    
    if (!isBlack) {
        const whiteIndex = getWhiteKeyCountBefore(midi);
        return (whiteIndex * whiteKeyWidth) + (whiteKeyWidth / 2);
    } else {
        const precedingWhiteIndex = getWhiteKeyCountBefore(midi);
        return precedingWhiteIndex * whiteKeyWidth;
    }
}

function getLaneWidth() {
    const logicalWidth = canvas.width / (window.devicePixelRatio || 1);
    return (logicalWidth / getTotalWhiteKeys()) * 0.75;
}

// ==============================================================================
// 2. DATA PROCESSING & PRECOMPUTATION PIPELINE
// ==============================================================================

function precomputeNotes(notes) {
    const laneW = getLaneWidth();
    return notes
        .map(note => {
            // Filter out notes outside the valid 73-key target piano range
            if (note.pitch < MIN_MIDI || note.pitch > MAX_MIDI) {
                return null;
            }
            
            const x = midiToX(note.pitch);
            const yStart = note.start * SCROLL_SPEED_PX_SEC;
            const yEnd = note.end * SCROLL_SPEED_PX_SEC;
            const height = yEnd - yStart;
            
            return {
                midi: note.pitch,
                x: x - laneW / 2, 
                w: laneW,
                y: yStart,
                h: height,
                timeStart: note.start,
                timeEnd: note.end
            };
        })
        .filter(note => note !== null); // Strip cleanly skipped objects
}

// ==============================================================================
// 3. CANVAS ANIMATION CORE LOOP
// ==============================================================================

function resizeCanvasToContainer() {
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = canvasContainer.clientWidth;
    const logicalHeight = canvasContainer.clientHeight;
    
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    
    // Explicitly enforce hard transform resets prior to resolution updates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    paperPattern = null;
    
    if (songData) {
        renderNotes = precomputeNotes(songData.notes);
    }
    buildKeyboardGeometry();
    renderFrame();
}
window.addEventListener('resize', resizeCanvasToContainer);

function renderFrame() {
    const ch = canvas.height / (window.devicePixelRatio || 1);
    const cw = canvas.width / (window.devicePixelRatio || 1);
    
    // Explicit clean frame clearing pass
    ctx.clearRect(0, 0, cw, ch);
    
    if (!paperPattern) createPaperTexture();
    ctx.fillStyle = paperPattern;
    ctx.fillRect(0, 0, cw, ch);
    
    if (!songData) return;
    
    const currentScrollY = elapsedTime * SCROLL_SPEED_PX_SEC;
    const trackerLineY = ch - 40; 
    
    const activeFrameKeys = new Set();
    ctx.fillStyle = '#2A2218';
    
    renderNotes.forEach(note => {
        const localY = trackerLineY - (note.y + note.h - currentScrollY);
        
        if (localY + note.h >= 0 && localY <= ch) {
            const r = note.w / 2;
            ctx.beginPath();
            ctx.arc(note.x + r, localY + r, r, Math.PI, 0, false);
            ctx.lineTo(note.x + note.w, localY + note.h - r);
            ctx.arc(note.x + r, localY + note.h - r, r, 0, Math.PI, false);
            ctx.lineTo(note.x, localY + r);
            ctx.closePath();
            ctx.fill();
        }
        
        if (elapsedTime >= note.timeStart && elapsedTime <= note.timeEnd) {
            activeFrameKeys.add(note.midi);
        }
    });
    
    for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
        const el = document.getElementById(`key-${m}`);
        if (el) {
            if (activeFrameKeys.has(m)) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        }
    }
}

function animationTick(timestamp) {
    if (!isPlaying) return;
    
    if (!startTime) startTime = timestamp - elapsedTime * 1000;
    elapsedTime = (timestamp - startTime) / 1000;
    
    if (elapsedTime >= songData.duration) {
        elapsedTime = songData.duration;
        isPlaying = false;
        playPauseBtn.textContent = "Play";
        renderFrame();
        return;
    }
    
    renderFrame();
    animationFrameId = requestAnimationFrame(animationTick);
}

// ==============================================================================
// 4. HTTP SERVICE & IO ACTIONS
// ==============================================================================

async function handleMidiUpload(file) {
    const formData = new FormData();
    formData.append('midi', file);
    
    songInfo.innerHTML = `<div style="color:var(--state-warning)">Parsing file track parameters on host...</div>`;
    
    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (data.success) {
            songData = data.song;
            renderNotes = precomputeNotes(songData.notes);
            
            songInfo.innerHTML = `
                <strong>File:</strong> ${songData.filename}<br>
                <strong>Title:</strong> ${songData.title.substring(0, 24)}<br>
                <span>Notes: ${songData.noteCount} | Tracks: ${songData.trackCount} | Tempo: ${songData.tempo} BPM | Time Sig: ${songData.timeSignature.join('/')} | Duration: ${songData.duration}s</span>
            `;
            
            elapsedTime = 0;
            startTime = 0;
            isPlaying = false;
            playPauseBtn.textContent = "Play";
            controlsRow.style.display = 'flex';
            
            resizeCanvasToContainer();
        } else {
            songInfo.innerHTML = `<div style="color:var(--state-danger)">Error: ${data.error}</div>`;
        }
    } catch (err) {
        songInfo.innerHTML = `<div style="color:var(--state-danger)">Failed to connect to backend compiler server.</div>`;
    }
}

// Setup Interactive UI Listeners
dropZone.addEventListener('click', () => midiInput.click());
midiInput.addEventListener('change', (e) => { if (e.target.files.length) handleMidiUpload(e.target.files[0]); });

dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        midiInput.click();
    }
});

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border)'; });
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
    if (e.dataTransfer.files.length) handleMidiUpload(e.dataTransfer.files[0]);
});

playPauseBtn.addEventListener('click', () => {
    if (isPlaying) {
        isPlaying = false;
        playPauseBtn.textContent = "Play";
        cancelAnimationFrame(animationFrameId);
    } else {
        isPlaying = true;
        playPauseBtn.textContent = "Pause";
        startTime = 0; 
        animationFrameId = requestAnimationFrame(animationTick);
    }
});

resetBtn.addEventListener('click', () => {
    isPlaying = false;
    playPauseBtn.textContent = "Play";
    cancelAnimationFrame(animationFrameId);
    elapsedTime = 0;
    startTime = 0;
    renderFrame();
});

// Delay initial execution configurations until layout engine has finalized metrics maps
window.addEventListener('load', resizeCanvasToContainer);
