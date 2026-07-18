"""
Player Piano Demo Server - main.py
Description: Minimal local Flask entry point to parse Standard MIDI files 
             and pipe unified, clear timelines to the browser front-end.
             Operates purely in memory with robust boundary validations.
Python Version: 3.12+
"""

import sys
import threading
import webbrowser
from typing import Dict, Any, List, Tuple, Optional
from flask import Flask, request, jsonify, render_template, Response

# Attempt external library imports with clear environmental warnings
try:
    import mido
except ImportError:
    print("CRITICAL: The 'mido' library is required to run this server.")
    print("Please install it using: pip install mido")
    sys.exit(1)

app = Flask(__name__)

# Enforce a secure maximum upload boundary limit (20 MB)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

# ==============================================================================
# MIDI PROCESSING CORE UTILITIES
# ==============================================================================

def parse_midi_file(file_stream, filename: str) -> Dict[str, Any]:
    """
    Parses an in-memory raw binary Standard MIDI payload stream using mido.
    Extracts explicit note blocks, continuous controllers, and structural taxonomy arrays.
    """
    mid = mido.MidiFile(file=file_stream)
    
    ppq: int = mid.ticks_per_beat
    duration: float = mid.length
    
    title: str = "Unknown Composition"
    initial_tempo: int = 120
    time_signature: List[int] = [4, 4]

    # Temporary structured states tracking active note pairs across simultaneous channels
    # Key mapping blueprint: (channel, pitch) -> (start_time_seconds, source_velocity)
    active_notes: Dict[Tuple[int, int], Tuple[float, int]] = {}
    
    # Active open pedal tracking structures
    active_sustain_start: Optional[float] = None
    active_soft_start: Optional[float] = None
    
    # Output arrays
    parsed_notes: List[Dict[str, Any]] = []
    sustain_intervals: List[Dict[str, float]] = []
    soft_intervals: List[Dict[str, float]] = []

    current_time: float = 0.0
    
    # By iterating over 'mid' directly, delta times are automatically converted to seconds
    for msg in mid:
        current_time += msg.time
        
        if msg.is_meta:
            if msg.type == 'track_name' and title == "Unknown Composition":
                title = msg.name
            elif msg.type == 'set_tempo':
                initial_tempo = round(mido.tempo2bpm(msg.tempo))
            elif msg.type == 'time_signature':
                time_signature = [msg.numerator, msg.denominator]
            continue
            
        if msg.type == 'note_on' and msg.velocity > 0:
            key = (msg.channel, msg.note)
            active_notes[key] = (current_time, msg.velocity)
            
        elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
            key = (msg.channel, msg.note)
            if key in active_notes:
                start_time, velocity = active_notes.pop(key)
                parsed_notes.append({
                    "pitch": msg.note,
                    "velocity": velocity,
                    "start": round(start_time, 3),
                    "end": round(current_time, 3)
                })
                
        elif msg.type == 'control_change':
            if msg.control == 64:
                if msg.value >= 64 and active_sustain_start is None:
                    active_sustain_start = current_time
                elif msg.value < 64 and active_sustain_start is not None:
                    sustain_intervals.append({
                        "start": round(active_sustain_start, 3),
                        "end": round(current_time, 3)
                    })
                    active_sustain_start = None
                    
            elif msg.control == 67:
                if msg.value >= 64 and active_soft_start is None:
                    active_soft_start = current_time
                elif msg.value < 64 and active_soft_start is not None:
                    soft_intervals.append({
                        "start": round(active_soft_start, 3),
                        "end": round(current_time, 3)
                    })
                    active_soft_start = None

    # Gracefully flush outstanding dangling elements to match performance bounds
    for key, (start_time, velocity) in active_notes.items():
        parsed_notes.append({
            "pitch": key[1],
            "velocity": velocity,
            "start": round(start_time, 3),
            "end": round(duration, 3)
        })
    if active_sustain_start is not None:
        sustain_intervals.append({"start": round(active_sustain_start, 3), "end": round(duration, 3)})
    if active_soft_start is not None:
        soft_intervals.append({"start": round(active_soft_start, 3), "end": round(duration, 3)})

    # Sort parsed array deterministically by timeline chronology, then by pitch height for stable chords
    parsed_notes.sort(key=lambda x: (x["start"], x["pitch"]))

    return {
        "filename": filename,
        "title": title.strip() or "Untitled Song",
        "ppq": ppq,
        "trackCount": len(mid.tracks),
        "duration": round(duration, 2),
        "tempo": initial_tempo,
        "timeSignature": time_signature,
        "noteCount": len(parsed_notes),
        "notes": parsed_notes,
        "pedals": {
            "sustain": sustain_intervals,
            "soft": soft_intervals
        }
    }

# ==============================================================================
# HTTP WEB ROUTING INTERFACES
# ==============================================================================

@app.route('/', methods=['GET'])
def index() -> str:
    """Serves the frontend template index.html directly from templates folder."""
    return render_template("index.html")

@app.route('/health', methods=['GET'])
def health() -> Response:
    """Returns baseline server status confirmation query."""
    return jsonify({"status": "ok"})

@app.route('/upload', methods=['POST'])
def upload() -> Response:
    """
    Accepts incoming multipart/form-data payloads carrying binary files under the 'midi' field key.
    Processes stream values into structurally accurate JSON metrics without local storage disk usage.
    """
    if 'midi' not in request.files:
        return jsonify({"success": False, "error": "Missing key parameter field 'midi' inside upload array."}), 400
        
    file = request.files['midi']
    if file.filename == '':
        return jsonify({"success": False, "error": "No data stream file package detected."}), 400

    # Strict structural assertion testing file configurations safely
    if not (file.filename.lower().endswith('.mid') or file.filename.lower().endswith('.midi')):
        return jsonify({"success": False, "error": "Invalid format criteria. File type target must be .mid or .midi."}), 400

    try:
        # Guarantee the data stream pointer position is safely bound at zero offset origin
        file.stream.seek(0)
        
        # Seek processing loops directly against raw memory buffer spaces
        song_payload = parse_midi_file(file.stream, file.filename)
        return jsonify({
            "success": True,
            "song": song_payload
        })
    except Exception as err:
        return jsonify({
            "success": False,
            "error": f"An unhandled execution error occurred while compiling track metrics: {str(err)}"
        }), 500

# ==============================================================================
# STARTUP SYSTEM ORCHESTRATION
# ==============================================================================

def open_browser() -> None:
    """Triggers browser opening hook on a delayed asynchronous worker process thread loop."""
    webbrowser.open("http://localhost:5000/")

if __name__ == '__main__':
    # Initialize thread loop configuration safely before engine bootups
    threading.Timer(1.5, open_browser).start()
    
    print("-------------------------------------------------------")
    print(" PLAYER PIANO BACKEND BRIDGE HOST STARTED SUCCESSFULLY")
    print(" Targets: http://localhost:5000/")
    print(" Enforcing in-memory serialization protocols exclusively.")
    print("-------------------------------------------------------")
    
    # Run secure isolated service with concurrency enabled and reloader explicitly blocked
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False,
        threaded=True,
        use_reloader=False
    )
