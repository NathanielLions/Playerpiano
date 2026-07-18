/**
 * midi-loader.js - Pure browser MIDI parser.
 * Matches the JSON structure previously provided by the Flask backend.
 * Updated to handle normalized/raw CC values and dangling pedal states.
 */
export async function parseMidiFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const midi = new Midi(arrayBuffer);
    
    const parsedNotes = [];
    const sustain = [];
    const soft = [];
    
    midi.tracks.forEach(track => {
        track.notes.forEach(note => {
            parsedNotes.push({
                pitch: note.midi,
                velocity: Math.round(note.velocity * 127),
                start: note.time,
                end: note.time + note.duration
            });
        });
        
        // Pair sustain (64) and soft (67) pedal events
        [64, 67].forEach(ccNumber => {
            const events = track.controlChanges[ccNumber] || [];
            let pedalStart = null;
            
            events.forEach(cc => {
                // Determine if pedal is pressed, supporting both raw (0-127) and normalized (0-1) values
                const pressed = cc.value > 1 ? cc.value >= 64 : cc.value >= 0.5;
                
                if (pressed && pedalStart === null) {
                    pedalStart = cc.time;
                } else if (!pressed && pedalStart !== null) {
                    const interval = { start: pedalStart, end: cc.time };
                    if (ccNumber === 64) sustain.push(interval);
                    else soft.push(interval);
                    pedalStart = null;
                }
            });
            
            // Close dangling pedals held until end-of-file
            if (pedalStart !== null) {
                const interval = { start: pedalStart, end: midi.duration };
                if (ccNumber === 64) sustain.push(interval);
                else soft.push(interval);
            }
        });
    });

    // Deterministic sort for notes and pedals
    parsedNotes.sort((a, b) => (a.start - b.start) || (a.pitch - b.pitch));
    sustain.sort((a, b) => a.start - b.start);
    soft.sort((a, b) => a.start - b.start);

    return {
        filename: file.name,
        title: midi.header.name || "Untitled Song",
        ppq: midi.header.ppq,
        trackCount: midi.tracks.length,
        duration: midi.duration,
        tempo: Math.round(midi.header.tempos[0]?.bpm || 120),
        timeSignature: midi.header.timeSignatures[0]?.timeSignature || [4, 4],
        noteCount: parsedNotes.length,
        notes: parsedNotes,
        pedals: { sustain, soft }
    };
}
