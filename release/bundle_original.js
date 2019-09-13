/**
 * SfxrParams
 *
 * Copyright 2010 Thomas Vian
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Thomas Vian
 */
/** @constructor */
function SfxrParams() {
  //--------------------------------------------------------------------------
  //
  //  Settings String Methods
  //
  //--------------------------------------------------------------------------

  /**
   * Parses a settings array into the parameters
   * @param array Array of the settings values, where elements 0 - 23 are
   *                a: waveType
   *                b: attackTime
   *                c: sustainTime
   *                d: sustainPunch
   *                e: decayTime
   *                f: startFrequency
   *                g: minFrequency
   *                h: slide
   *                i: deltaSlide
   *                j: vibratoDepth
   *                k: vibratoSpeed
   *                l: changeAmount
   *                m: changeSpeed
   *                n: squareDuty
   *                o: dutySweep
   *                p: repeatSpeed
   *                q: phaserOffset
   *                r: phaserSweep
   *                s: lpFilterCutoff
   *                t: lpFilterCutoffSweep
   *                u: lpFilterResonance
   *                v: hpFilterCutoff
   *                w: hpFilterCutoffSweep
   *                x: masterVolume
   * @return If the string successfully parsed
   */
  this.setSettings = function(values)
  {
    for ( var i = 0; i < 24; i++ )
    {
      this[String.fromCharCode( 97 + i )] = values[i] || 0;
    }

    // I moved this here from the reset(true) function
    if (this['c'] < .01) {
      this['c'] = .01;
    }

    var totalTime = this['b'] + this['c'] + this['e'];
    if (totalTime < .18) {
      var multiplier = .18 / totalTime;
      this['b']  *= multiplier;
      this['c'] *= multiplier;
      this['e']   *= multiplier;
    }
  }
}

/**
 * SfxrSynth
 *
 * Copyright 2010 Thomas Vian
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Thomas Vian
 */
/** @constructor */
function SfxrSynth() {
  // All variables are kept alive through function closures

  //--------------------------------------------------------------------------
  //
  //  Sound Parameters
  //
  //--------------------------------------------------------------------------

  this._params = new SfxrParams();  // Params instance

  //--------------------------------------------------------------------------
  //
  //  Synth Variables
  //
  //--------------------------------------------------------------------------

  var _envelopeLength0, // Length of the attack stage
      _envelopeLength1, // Length of the sustain stage
      _envelopeLength2, // Length of the decay stage

      _period,          // Period of the wave
      _maxPeriod,       // Maximum period before sound stops (from minFrequency)

      _slide,           // Note slide
      _deltaSlide,      // Change in slide

      _changeAmount,    // Amount to change the note by
      _changeTime,      // Counter for the note change
      _changeLimit,     // Once the time reaches this limit, the note changes

      _squareDuty,      // Offset of center switching point in the square wave
      _dutySweep;       // Amount to change the duty by

  //--------------------------------------------------------------------------
  //
  //  Synth Methods
  //
  //--------------------------------------------------------------------------

  /**
   * Resets the runing variables from the params
   * Used once at the start (total reset) and for the repeat effect (partial reset)
   */
  this.reset = function() {
    // Shorter reference
    var p = this._params;

    _period       = 100 / (p['f'] * p['f'] + .001);
    _maxPeriod    = 100 / (p['g']   * p['g']   + .001);

    _slide        = 1 - p['h'] * p['h'] * p['h'] * .01;
    _deltaSlide   = -p['i'] * p['i'] * p['i'] * .000001;

    if (!p['a']) {
      _squareDuty = .5 - p['n'] / 2;
      _dutySweep  = -p['o'] * .00005;
    }

    _changeAmount =  1 + p['l'] * p['l'] * (p['l'] > 0 ? -.9 : 10);
    _changeTime   = 0;
    _changeLimit  = p['m'] == 1 ? 0 : (1 - p['m']) * (1 - p['m']) * 20000 + 32;
  }

  // I split the reset() function into two functions for better readability
  this.totalReset = function() {
    this.reset();

    // Shorter reference
    var p = this._params;

    // Calculating the length is all that remained here, everything else moved somewhere
    _envelopeLength0 = p['b']  * p['b']  * 100000;
    _envelopeLength1 = p['c'] * p['c'] * 100000;
    _envelopeLength2 = p['e']   * p['e']   * 100000 + 12;
    // Full length of the volume envelop (and therefore sound)
    // Make sure the length can be divided by 3 so we will not need the padding "==" after base64 encode
    return ((_envelopeLength0 + _envelopeLength1 + _envelopeLength2) / 3 | 0) * 3;
  }

  /**
   * Writes the wave to the supplied buffer ByteArray
   * @param buffer A ByteArray to write the wave to
   * @return If the wave is finished
   */
  this.synthWave = function(buffer, length) {
    // Shorter reference
    var p = this._params;

    // If the filters are active
    var _filters = p['s'] != 1 || p['v'],
        // Cutoff multiplier which adjusts the amount the wave position can move
        _hpFilterCutoff = p['v'] * p['v'] * .1,
        // Speed of the high-pass cutoff multiplier
        _hpFilterDeltaCutoff = 1 + p['w'] * .0003,
        // Cutoff multiplier which adjusts the amount the wave position can move
        _lpFilterCutoff = p['s'] * p['s'] * p['s'] * .1,
        // Speed of the low-pass cutoff multiplier
        _lpFilterDeltaCutoff = 1 + p['t'] * .0001,
        // If the low pass filter is active
        _lpFilterOn = p['s'] != 1,
        // masterVolume * masterVolume (for quick calculations)
        _masterVolume = p['x'] * p['x'],
        // Minimum frequency before stopping
        _minFreqency = p['g'],
        // If the phaser is active
        _phaser = p['q'] || p['r'],
        // Change in phase offset
        _phaserDeltaOffset = p['r'] * p['r'] * p['r'] * .2,
        // Phase offset for phaser effect
        _phaserOffset = p['q'] * p['q'] * (p['q'] < 0 ? -1020 : 1020),
        // Once the time reaches this limit, some of the    iables are reset
        _repeatLimit = p['p'] ? ((1 - p['p']) * (1 - p['p']) * 20000 | 0) + 32 : 0,
        // The punch factor (louder at begining of sustain)
        _sustainPunch = p['d'],
        // Amount to change the period of the wave by at the peak of the vibrato wave
        _vibratoAmplitude = p['j'] / 2,
        // Speed at which the vibrato phase moves
        _vibratoSpeed = p['k'] * p['k'] * .01,
        // The type of wave to generate
        _waveType = p['a'];

    var _envelopeLength      = _envelopeLength0,     // Length of the current envelope stage
        _envelopeOverLength0 = 1 / _envelopeLength0, // (for quick calculations)
        _envelopeOverLength1 = 1 / _envelopeLength1, // (for quick calculations)
        _envelopeOverLength2 = 1 / _envelopeLength2; // (for quick calculations)

    // Damping muliplier which restricts how fast the wave position can move
    var _lpFilterDamping = 5 / (1 + p['u'] * p['u'] * 20) * (.01 + _lpFilterCutoff);
    if (_lpFilterDamping > .8) {
      _lpFilterDamping = .8;
    }
    _lpFilterDamping = 1 - _lpFilterDamping;

    var _finished = false,     // If the sound has finished
        _envelopeStage    = 0, // Current stage of the envelope (attack, sustain, decay, end)
        _envelopeTime     = 0, // Current time through current enelope stage
        _envelopeVolume   = 0, // Current volume of the envelope
        _hpFilterPos      = 0, // Adjusted wave position after high-pass filter
        _lpFilterDeltaPos = 0, // Change in low-pass wave position, as allowed by the cutoff and damping
        _lpFilterOldPos,       // Previous low-pass wave position
        _lpFilterPos      = 0, // Adjusted wave position after low-pass filter
        _periodTemp,           // Period modified by vibrato
        _phase            = 0, // Phase through the wave
        _phaserInt,            // Integer phaser offset, for bit maths
        _phaserPos        = 0, // Position through the phaser buffer
        _pos,                  // Phase expresed as a Number from 0-1, used for fast sin approx
        _repeatTime       = 0, // Counter for the repeats
        _sample,               // Sub-sample calculated 8 times per actual sample, averaged out to get the super sample
        _superSample,          // Actual sample writen to the wave
        _vibratoPhase     = 0; // Phase through the vibrato sine wave

    // Buffer of wave values used to create the out of phase second wave
    var _phaserBuffer = new Array(1024),
        // Buffer of random values used to generate noise
        _noiseBuffer  = new Array(32);
    for (var i = _phaserBuffer.length; i--; ) {
      _phaserBuffer[i] = 0;
    }
    for (var i = _noiseBuffer.length; i--; ) {
      _noiseBuffer[i] = Math.random() * 2 - 1;
    }

    for (var i = 0; i < length; i++) {
      if (_finished) {
        return i;
      }

      // Repeats every _repeatLimit times, partially resetting the sound parameters
      if (_repeatLimit) {
        if (++_repeatTime >= _repeatLimit) {
          _repeatTime = 0;
          this.reset();
        }
      }

      // If _changeLimit is reached, shifts the pitch
      if (_changeLimit) {
        if (++_changeTime >= _changeLimit) {
          _changeLimit = 0;
          _period *= _changeAmount;
        }
      }

      // Acccelerate and apply slide
      _slide += _deltaSlide;
      _period *= _slide;

      // Checks for frequency getting too low, and stops the sound if a minFrequency was set
      if (_period > _maxPeriod) {
        _period = _maxPeriod;
        if (_minFreqency > 0) {
          _finished = true;
        }
      }

      _periodTemp = _period;

      // Applies the vibrato effect
      if (_vibratoAmplitude > 0) {
        _vibratoPhase += _vibratoSpeed;
        _periodTemp *= 1 + Math.sin(_vibratoPhase) * _vibratoAmplitude;
      }

      _periodTemp |= 0;
      if (_periodTemp < 8) {
        _periodTemp = 8;
      }

      // Sweeps the square duty
      if (!_waveType) {
        _squareDuty += _dutySweep;
        if (_squareDuty < 0) {
          _squareDuty = 0;
        } else if (_squareDuty > .5) {
          _squareDuty = .5;
        }
      }

      // Moves through the different stages of the volume envelope
      if (++_envelopeTime > _envelopeLength) {
        _envelopeTime = 0;

        switch (++_envelopeStage)  {
          case 1:
            _envelopeLength = _envelopeLength1;
            break;
          case 2:
            _envelopeLength = _envelopeLength2;
        }
      }

      // Sets the volume based on the position in the envelope
      switch (_envelopeStage) {
        case 0:
          _envelopeVolume = _envelopeTime * _envelopeOverLength0;
          break;
        case 1:
          _envelopeVolume = 1 + (1 - _envelopeTime * _envelopeOverLength1) * 2 * _sustainPunch;
          break;
        case 2:
          _envelopeVolume = 1 - _envelopeTime * _envelopeOverLength2;
          break;
        case 3:
          _envelopeVolume = 0;
          _finished = true;
      }

      // Moves the phaser offset
      if (_phaser) {
        _phaserOffset += _phaserDeltaOffset;
        _phaserInt = _phaserOffset | 0;
        if (_phaserInt < 0) {
          _phaserInt = -_phaserInt;
        } else if (_phaserInt > 1023) {
          _phaserInt = 1023;
        }
      }

      // Moves the high-pass filter cutoff
      if (_filters && _hpFilterDeltaCutoff) {
        _hpFilterCutoff *= _hpFilterDeltaCutoff;
        if (_hpFilterCutoff < .00001) {
          _hpFilterCutoff = .00001;
        } else if (_hpFilterCutoff > .1) {
          _hpFilterCutoff = .1;
        }
      }

      _superSample = 0;
      for (var j = 8; j--; ) {
        // Cycles through the period
        _phase++;
        if (_phase >= _periodTemp) {
          _phase %= _periodTemp;

          // Generates new random noise for this period
          if (_waveType == 3) {
            for (var n = _noiseBuffer.length; n--; ) {
              _noiseBuffer[n] = Math.random() * 2 - 1;
            }
          }
        }

        // Gets the sample from the oscillator
        switch (_waveType) {
          case 0: // Square wave
            _sample = ((_phase / _periodTemp) < _squareDuty) ? .5 : -.5;
            break;
          case 1: // Saw wave
            _sample = 1 - _phase / _periodTemp * 2;
            break;
          case 2: // Sine wave (fast and accurate approx)
            _pos = _phase / _periodTemp;
            _pos = (_pos > .5 ? _pos - 1 : _pos) * 6.28318531;
            _sample = 1.27323954 * _pos + .405284735 * _pos * _pos * (_pos < 0 ? 1 : -1);
            _sample = .225 * ((_sample < 0 ? -1 : 1) * _sample * _sample  - _sample) + _sample;
            break;
          case 3: // Noise
            _sample = _noiseBuffer[Math.abs(_phase * 32 / _periodTemp | 0)];
        }

        // Applies the low and high pass filters
        if (_filters) {
          _lpFilterOldPos = _lpFilterPos;
          _lpFilterCutoff *= _lpFilterDeltaCutoff;
          if (_lpFilterCutoff < 0) {
            _lpFilterCutoff = 0;
          } else if (_lpFilterCutoff > .1) {
            _lpFilterCutoff = .1;
          }

          if (_lpFilterOn) {
            _lpFilterDeltaPos += (_sample - _lpFilterPos) * _lpFilterCutoff;
            _lpFilterDeltaPos *= _lpFilterDamping;
          } else {
            _lpFilterPos = _sample;
            _lpFilterDeltaPos = 0;
          }

          _lpFilterPos += _lpFilterDeltaPos;

          _hpFilterPos += _lpFilterPos - _lpFilterOldPos;
          _hpFilterPos *= 1 - _hpFilterCutoff;
          _sample = _hpFilterPos;
        }

        // Applies the phaser effect
        if (_phaser) {
          _phaserBuffer[_phaserPos % 1024] = _sample;
          _sample += _phaserBuffer[(_phaserPos - _phaserInt + 1024) % 1024];
          _phaserPos++;
        }

        _superSample += _sample;
      }

      // Averages out the super samples and applies volumes
      _superSample *= .125 * _envelopeVolume * _masterVolume;

      // Clipping if too loud
      buffer[i] = _superSample >= 1 ? 32767 : _superSample <= -1 ? -32768 : _superSample * 32767 | 0;
    }

    return length;
  }
}

// Adapted from http://codebase.es/riffwave/
var synth = new SfxrSynth();
// Export for the Closure Compiler
window['jsfxr'] = function(settings) {
  // Initialize SfxrParams
  synth._params.setSettings(settings);
  // Synthesize Wave
  var envelopeFullLength = synth.totalReset();
  var data = new Uint8Array(((envelopeFullLength + 1) / 2 | 0) * 4 + 44);
  var used = synth.synthWave(new Uint16Array(data.buffer, 44), envelopeFullLength) * 2;
  var dv = new Uint32Array(data.buffer, 0, 44);
  // Initialize header
  dv[0] = 0x46464952; // "RIFF"
  dv[1] = used + 36;  // put total size here
  dv[2] = 0x45564157; // "WAVE"
  dv[3] = 0x20746D66; // "fmt "
  dv[4] = 0x00000010; // size of the following
  dv[5] = 0x00010001; // Mono: 1 channel, PCM format
  dv[6] = 0x0000AC44; // 44,100 samples per second
  dv[7] = 0x00015888; // byte rate: two bytes per sample
  dv[8] = 0x00100002; // 16 bits per sample, aligned on every two bytes
  dv[9] = 0x61746164; // "data"
  dv[10] = used;      // put number of samples here

  // Base64 encoding written by me, @maettig
  used += 44;
  var i = 0,
      base64Characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
      output = 'data:audio/wav;base64,';
  for (; i < used; i += 3)
  {
    var a = data[i] << 16 | data[i + 1] << 8 | data[i + 2];
    output += base64Characters[a >> 18] + base64Characters[a >> 12 & 63] + base64Characters[a >> 6 & 63] + base64Characters[a & 63];
  }
  return output;
}



/**
 * @file jsfxrsequencer.js
 * @version 1.0.1
 * @author Donitz 2019
 */

/*
    Track:
        i * 4 + 0: Time since last [seconds / rate]
        i * 4 + 1: Duration [seconds / rate]
        i * 4 + 2: MIDI number
        i * 4 + 3: Volume [1 / 255]
*/

const jsfxrSequence = (data, maxElapsedSeconds = 0.1) => {
    const notePool = new Map(),
        notes = [];

    let notesToLoad = 0;

    data.tracks.map((track, ti) => {
        const settings = data.instruments[ti];

        let t = 0;

        for (let n = 0; n < track.length; n += 4) {
            t += track[n] / data.rate;

            const i = track[n + 2] + 256 * ti;

            let pool = notePool.get(i);
            if (pool === undefined) {
                // Midi to frequency: (probably wrong)
                // f = 2^((d-69)/12)*440
                const f = Math.pow(2, (track[n + 2] - 69) / 12) * 440;

                // Frequency to setting: (probably wrong)
                // f = Fs / (100 / (x * x + 0.001)) * 8
                // x = 0.1 * sqrt((1250 * f) / Fs - 0.1)
                const x = 0.1 * Math.sqrt((1250 * f) / data.fs - 0.1);
                settings[5] = x;

                const src = jsfxr(settings);

                pool = {
                    next: 0,
                    players: new Array(data.channelsPerNote).fill(null).map(() => {
                        const p = new Audio();
                        notesToLoad++;
                        let loaded = false;
                        p.addEventListener('canplaythrough', () => {
                            if (!loaded) {
                                loaded = true;
                                notesToLoad--;
                            }
                        });
                        p.src = src;
                        return p;
                    }),
                };
                notePool.set(i, pool);
            }

            notes.push({ time: t, pool, volume: track[n + 3] / 255 });
        }
    });

    notes.sort((a, b) => a.time - b.time);

    let totalSeconds,
        nextNote,
        lastTime,
        stopping,
        stopped = true,
        loop_,
        volume_ = 1.0;

    const restart = () => {
        totalSeconds = 0;
        nextNote = 0;
        lastTime = new Date();
        stopping = false;
        if (stopped) {
            stopped = false;
            update();
        }
    };

    const update = () => {
        const ready = notesToLoad === 0;

        if (stopping) {
            stopped = true;
            return;
        }

        const newTime = new Date(),
            elapsedSeconds = Math.min((newTime - lastTime) / 1000, maxElapsedSeconds);
        lastTime = newTime;

        if (ready) {
            totalSeconds += elapsedSeconds;

            while (totalSeconds >= notes[nextNote].time) {
                const note = notes[nextNote++];

                const p = note.pool.players[note.pool.next];
                note.pool.next = (note.pool.next + 1) % data.channelsPerNote;

                if (volume_ > 0 && (document.hidden === undefined || !document.hidden)) {
                    p.volume = note.volume * volume_;
                    p.play();
                }

                if (nextNote === notes.length) {
                    if (loop_) {
                        restart();
                    } else {
                        stopped = true;
                        return;
                    }
                }
            }
        }

        setTimeout(update, 1);
    };

    return {
        play: (loop = false) => {
            loop_ = loop;
            restart();
        },
        stop: () => {
            stopping = true;
        },
        setVolume: (volume) => {
            volume_ = volume;
        },
    };
};



/**
 * @file audio.js
 * @version 1.0.0
 * @author Donitz 2019
 */

let muted = false;

const createSound = (settings, count, volume) => {
    const src = jsfxr(settings);
    const players = new Array(count).fill(null).map(() => {
        const p = new Audio();
        p.src = src;
        return p;
    });
    let i = 0;
    return () => {
        if (muted) {
            return;
        }
        const p = players[i];
        i = (i + 1) % count;
        p.volume = volume;
        if (p.paused) {
            p.play();
        } else {
            p.currentTime = 0;
        }
    };
};

const musicList = [
    jsfxrSequence({rate:5,fs:44100,channelsPerNote:5,instruments:[null,null,[0,0.1,0.1,null,0.3,0.6,null,-0.1,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,0.5],null,null,[0,0.1,0.1,null,0.8,0.6,null,-0.1,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,0.2],null,null,null,null,null,null,null,null,null,null,null],tracks:[[],[],[3,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,1,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,2,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,1,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,2,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,1,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,2,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,1,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,2,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,1,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,2,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,1,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,2,1,55,51,0,1,43,51,1,1,62,51,0,1,55,51,1,1,67,51,0,1,62,51,1,1,62,51,0,1,55,51,2,1,74,51,0,1,65,51,1,1,71,51,0,1,62,51,1,1,55,51,0,1,43,51,1,1,62,51,0,1,55,51,2,1,67,51,0,1,62,51,1,1,62,51,0,1,55,51,1,1,74,51,0,1,65,51,1,1,71,51,0,1,62,51,2,1,55,51,0,1,43,51,1,1,62,51,0,1,55,51,1,1,67,51,0,1,62,51,1,1,62,51,0,1,55,51,2,1,74,51,0,1,65,51,1,1,71,51,0,1,62,51,1,1,55,51,0,1,43,51,1,1,62,51,0,1,55,51,2,1,67,51,0,1,62,51,1,1,62,51,0,1,55,51,1,1,74,51,0,1,65,51,1,1,71,51,0,1,62,51,2,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,1,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,2,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,1,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,2,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,1,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,2,1,48,51,0,1,56,51,1,1,63,51,0,1,56,51,1,1,63,51,0,1,72,51,1,1,56,51,0,1,63,51,2,1,75,51,0,1,68,51,1,1,72,51,0,1,63,51,1,1,48,51,0,1,56,51,1,1,63,51,0,1,56,51,2,1,63,51,0,1,72,51,1,1,56,51,0,1,63,51,1,1,75,51,0,1,68,51,1,1,72,51,0,1,63,51,2,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,1,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,2,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,1,1,48,51,0,1,55,51,1,1,55,51,0,1,63,51,2,1,63,51,0,1,72,51,1,1,67,51,0,1,55,51,1,1,67,51,0,1,75,51,1,1,72,51,0,1,63,51,2,1,43,51,0,1,55,51,1,1,50,51,0,1,59,51,1,1,55,51,0,1,65,51,1,1,62,51,0,1,43,51,2,1,74,51,0,1,65,51,1,1,71,51,0,1,55,51,1,1,43,51,0,1,55,51,1,1,50,51,0,1,59,51,2,1,55,51,0,1,65,51,1,1,62,51,0,1,43,51,1,1,74,51,0,1,65,51,1,1,71,51,0,1,55,51,2,1,43,51,0,1,55,51,1,1,50,51,0,1,59,51,1,1,55,51,0,1,65,51,1,1,62,51,0,1,43,51,2,1,74,51,0,1,65,51,1,1,71,51,0,1,55,51,1,1,55,51,0,1,74,51,0,1,79,51,1,1,50,51,0,1,59,51,0,1,74,51,2,1,55,51,0,1,65,51,1,1,62,51,0,1,43,51,1,1,74,51,0,1,65,51,1,1,71,51,0,1,55,51],[],[],[3,7,48,101,0,7,60,85,0,7,72,70,0,7,36,117,12,3,55,101,0,3,43,101,3,7,48,101,0,7,60,85,0,7,72,70,15,7,43,101,0,7,55,85,0,7,67,70,0,7,31,79,30,7,48,101,0,7,60,85,0,7,72,70,0,7,36,117,15,7,48,101,0,7,60,85,0,7,72,70,0,7,36,117,15,7,48,101,0,7,60,85,0,7,72,70,0,7,36,117,15,7,43,101,3,4,55,95,4,7,67,85,4,4,79,79,4,7,91,71,7,7,103,63],[],[],[],[],[],[],[],[],[],[]]}),
    jsfxrSequence({rate:256,fs:44100,channelsPerNote:5,instruments:[[0,null,0.1,null,0.3,0.6,null,-0.3,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,0.5],null,[0,null,0.1,null,0.3,0.6,null,-0.1,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,0.4],null,null,null,null,null,null,null,null,null,null,null,null,null,null],tracks:[[1536,319,69,161,320,63,64,161,64,255,68,161,256,63,69,161,64,63,68,161,64,319,67,161,320,63,62,161,64,191,66,161,192,47,64,161,48,47,66,161,48,47,67,161,48,47,68,161,48,255,69,161,256,63,69,161,64,63,64,161,64,255,68,161,256,63,69,161,64,63,68,161,64,255,67,161,256,63,67,161,64,63,62,161,64,191,66,161,192,47,64,161,48,47,66,161,48,47,67,161,48,47,68,161,48,255,69,161,256,63,69,161,64,63,64,161,64,255,68,161,256,63,69,161,64,63,68,161,64,255,67,161,256,63,67,161,64,63,62,161,64,47,64,161],[],[0,47,57,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,72,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,57,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,71,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,57,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,70,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,57,161,48,47,66,161,48,47,67,161,48,47,69,161,48,47,64,161,48,47,65,161,48,47,67,161,48,47,65,161,48,47,57,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,72,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,57,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,71,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,57,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,70,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,57,161,48,47,66,161,48,47,67,161,48,47,69,161,48,47,64,161,48,47,65,161,48,47,67,161,48,47,65,161,48,47,57,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,72,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,57,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,71,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,57,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,70,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,57,161,48,47,66,161,48,47,67,161,48,47,69,161,48,47,64,161,48,47,65,161,48,47,67,161,48,47,65,161,48,47,57,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,72,161,48,47,64,161,48,47,65,161,48,47,64,161,48,47,57,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,71,161,48,47,63,161,48,47,64,161,48,47,63,161,48,47,57,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,70,161,48,47,62,161,48,47,64,161,48,47,62,161,48,47,57,161],[],[],[],[],[],[],[],[],[],[],[],[],[]]}),
];

let currentMusic = null;
let musicPlaying = false;
let musicVolume = 0.5;

const playMusic = (music, volume = null) => {
    musicVolume = volume || musicVolume;
    if (currentMusic === music && musicPlaying) {
        return;
    }
    if (currentMusic !== null) {
        stopMusic();
    }
    currentMusic = music;
    music.setVolume(musicVolume);
    if (!muted) {
        music.play(true);
        musicPlaying = true;
    }
};

const stopMusic = (clear = true) => {
    if (currentMusic !== null) {
        currentMusic.stop();
        currentMusic = clear ? null : currentMusic;
        musicPlaying = false;
    }
};

const sounds = [
    () => playMusic(musicList[0], 0.7), // 0: Main title
    () => playMusic(musicList[1], 0.4), // 1: Boss
    () => stopMusic(), // 2: Stop music
    createSound([3,0.47,0.23,,0.69,0.53,,-0.18,-0.04,,,,,,,,,,1,,,,,0.29], 1, 0.75), // 3: Title
    createSound([0,0.49,0.33,,0.36,0.16,,0.1,,,,,,,,,,,1,,,,,0.3], 1, 0.75), // 4: Door
    createSound([3,,0.09,,0.3,0.74,,-0.5,,,,,,,,,,,1,,,0.22,,0.3], 1, 0.75), // 5: Killed
    createSound([3,,0.2,0.6,0.06,0.1,,0.13,,,,,,,,,,,1,,,,,0.29], 1, 0.75), // 6: Trigger
    createSound([3,,0.23,,0.17,0.4,,-0.4,,,,,,,,,,,1,,,,,0.29], 1, 0.75), // 7: Bite
    createSound([0,,0.03,,0.3,0.2,,0.2,,,,,,0.44,,,,,1,,,,,0.29], 1, 0.75), // 8: Slime chase
    createSound([3,1.5,0.31,,0.89,0.5,,-0.12,,,,,,,,,,,1,,,,,0.29], 1, 0.75), // 9: Lava rise
    createSound([3,,0.2,0.5,0.34,0.13,,0.2,,,,,,,,,,,1,,,,,0.29], 1, 0.75), // 10: Stomp
    createSound([3,,0.11,,0.2,0.42,,-0.32,0.1,,,,,,,,,,1,,,,,0.29], 1, 0.75), // 11: Clock
    createSound([2,0.29,0.51,0.43,0.67,0.35,,-0.14,,0.33,0.4,,,0.4,,,,,1,,,,,0.29], 3, 0.75), // 12: Ghost
    createSound([2,,0.11,,0.47,0.6,,-0.44,,,,,,,,,,,1,,,0.09,,0.29], 3, 0.75), // 13: Ball
    createSound([3,0.9,0.23,,0.69,0.53,,,-0.04,,,,,,,,,,1,,,,,0.5], 1, 0.2), // 14: Wind
    createSound([3,,0.24,0.13,0.78,0.1,,-0.2217,,,,,,,,0.7,0.27,-0.15,1,,,,,0.29], 1, 0.2), // 15: Bridge
];

const levelData = [64,7,128,128,128,130,130,0,1,161,0,13,124,111,126,110,130,110,132,111,134,114,132,114,132,121,135,126,128,124,120,126,123,121,123,114,122,114,0,128,112,128,138,138,1,1,160,0,13,125,123,120,123,125,121,126,118,128,119,130,118,131,121,136,123,131,123,130,128,129,130,127,130,126,128,1,9,4,3,128,3,132,2,125,0,128,132,113,128,138,138,1,1,160,0,8,125,129,128,126,129,128,130,132,133,133,135,132,134,136,128,134,1,9,4,2,128,4,138,2,118,0,128,130,122,128,138,138,1,1,160,0,9,126,127,128,126,130,127,131,135,130,136,132,138,126,138,127,136,126,136,1,9,4,2,128,4,118,2,138,0,128,125,122,128,138,138,1,1,160,0,9,126,127,128,126,130,127,130,135,129,136,131,138,125,138,126,136,125,136,1,9,4,2,128,4,138,2,118,0,128,124,113,136,138,138,1,1,160,0,8,126,128,128,126,129,128,130,132,133,133,135,132,134,136,128,135,1,9,4,2,136,4,125,2,145,0,136,128,128,128,131,131,1,3,0,0,2,128,128,128,132,0,0,0,0,0,0,0,0,0,0,0,15,128,128,128,181,181,6,7,0,0,2,128,128,128,132,0,128,128,128,176,177,6,0,0,0,2,128,128,128,132,0,128,128,128,163,163,6,7,0,0,2,128,128,128,132,0,128,128,128,137,137,3,0,0,0,2,128,128,128,132,0,128,128,128,148,148,6,7,0,0,2,128,128,128,132,0,128,128,128,138,138,0,0,128,0,4,136,125,136,131,119,131,119,125,1,2,2,11,131,0,131,122,115,120,138,138,6,0,0,0,5,123,125,133,128,141,137,136,138,124,130,0,150,128,128,138,138,0,0,0,0,4,124,124,147,124,147,132,124,132,0,132,140,124,138,138,6,0,0,0,5,120,123,132,126,134,130,122,130,117,125,0,129,152,128,138,138,0,0,0,0,4,123,122,131,122,131,128,123,128,0,118,118,119,130,144,0,7,0,0,4,124,124,132,124,132,132,124,132,0,133,134,155,130,144,6,7,0,0,4,124,124,132,124,132,128,125,128,0,123,123,119,130,144,6,7,0,0,4,124,124,132,124,132,128,125,128,0,128,114,128,130,144,6,7,0,0,4,124,124,132,124,132,128,125,128,0,137,138,119,130,144,0,7,0,0,4,124,124,132,124,132,132,124,132,0,15,128,128,128,138,138,0,0,0,0,25,124,104,132,104,132,107,136,107,136,109,135,110,135,113,136,114,136,149,120,149,120,146,111,146,111,152,105,152,105,146,104,145,104,141,105,140,120,140,120,114,121,113,121,110,120,109,120,107,124,107,0,125,113,128,138,138,0,0,13,1,4,124,126,138,126,138,132,124,132,0,145,108,128,138,138,0,7,32,1,8,128,126,130,126,132,124,140,124,142,126,144,126,144,128,128,128,2,7,2,2,145,0,120,8,3,2,108,68,108,0,140,122,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,3,158,37,158,0,98,128,137,128,138,138,3,7,32,0,8,128,126,144,126,144,128,142,128,141,130,131,130,130,128,128,128,0,123,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,10,158,37,158,0,98,125,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,29,158,37,158,0,98,128,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,15,158,37,158,0,98,130,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,3,158,37,158,0,98,132,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,18,158,37,158,0,98,134,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,6,158,37,157,0,98,127,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,45,158,37,158,0,98,129,158,128,138,138,0,7,96,1,5,127,124,129,124,130,126,128,132,126,126,1,8,3,37,158,37,158,0,98,140,109,128,138,138,0,2,0,0,4,124,122,150,122,150,139,124,139,0,92,156,128,138,138,0,2,54,1,4,124,124,132,124,132,132,124,132,1,13,4,2,127,3,127,2,138,0,127,12,128,128,128,138,138,0,8,0,0,8,105,104,111,104,111,107,169,107,169,149,87,149,87,107,105,107,0,116,117,128,138,138,0,8,13,6,4,124,124,132,124,132,156,124,156,0,128,128,128,138,138,0,7,0,0,19,114,144,127,146,144,144,157,145,169,146,169,111,156,112,142,113,131,111,117,115,113,113,112,107,170,107,170,149,86,149,86,107,104,107,103,114,103,141,0,132,118,128,138,138,6,7,160,6,11,131,126,135,130,139,127,142,130,146,127,148,130,152,127,146,141,136,146,123,143,130,130,1,9,4,8,128,2,135,10,128,0,128,132,118,128,138,118,6,7,183,6,11,130,126,131,130,135,126,139,129,142,126,146,129,148,126,152,129,146,142,137,145,124,144,2,9,4,8,128,2,121,10,128,0,128,13,5,9,127,2,127,3,138,6,127,0,127,81,138,128,138,138,0,7,177,6,5,128,102,136,118,128,133,68,133,68,102,2,0,5,7,129,3,118,2,183,8,125,0,128,13,3,2,127,8,127,0,138,143,140,128,138,138,0,7,224,6,5,125,126,127,116,127,128,130,162,125,162,1,1,3,5,48,4,208,0,48,161,115,128,138,138,0,7,96,6,5,127,128,124,97,131,97,129,134,127,141,1,1,5,15,148,26,134,55,127,14,128,0,108,129,115,128,138,138,0,7,224,6,5,126,128,126,97,131,97,129,127,129,141,1,1,4,4,128,2,183,4,73,0,128,127,103,128,138,138,0,8,0,0,4,124,107,168,107,168,132,124,132,0,124,153,128,138,138,0,8,0,0,4,124,124,168,124,168,132,124,132,0,92,156,128,138,138,0,2,18,0,4,124,124,132,124,132,132,124,132,1,13,3,4,129,6,129,0,127,0,0,0,0,0,11,91,108,128,138,138,0,8,0,0,4,124,124,206,124,206,172,124,172,0,90,128,128,138,138,0,0,0,0,10,124,124,130,124,130,126,128,126,128,129,131,129,131,132,129,132,129,134,124,134,0,140,148,128,138,138,0,3,0,0,44,123,123,126,117,134,115,139,119,143,124,148,126,151,125,154,121,151,106,150,96,142,89,131,91,124,97,114,94,103,93,96,95,91,96,86,100,80,104,75,104,75,84,157,84,157,132,75,132,75,112,78,112,83,119,86,123,92,125,98,127,104,125,107,119,121,107,132,103,136,99,142,99,143,103,132,110,125,109,117,113,110,119,108,126,108,129,124,129,0,113,128,128,138,138,0,3,0,0,10,124,124,127,121,133,121,138,123,138,126,131,132,127,138,120,137,116,134,115,130,0,159,140,128,138,138,0,7,198,0,6,127,125,129,125,131,127,130,129,126,129,125,127,3,10,5,10,138,2,138,2,135,1,145,0,138,11,5,10,138,2,138,2,144,1,136,0,138,12,5,10,138,2,129,1,123,2,157,0,138,128,128,128,131,132,5,2,0,0,8,125,125,127,127,129,125,130,127,133,124,130,128,129,126,127,128,0,119,117,128,138,138,0,7,198,0,6,127,125,129,125,131,127,130,129,126,129,125,127,3,10,5,10,138,2,138,2,135,1,145,0,138,11,5,10,138,2,138,2,144,1,136,0,138,12,5,10,138,2,129,1,123,2,157,0,138,101,141,128,138,138,0,7,198,0,6,127,125,129,125,131,127,130,129,126,129,125,127,3,10,5,10,138,2,138,2,135,1,145,0,138,11,5,10,138,2,138,2,144,1,136,0,138,12,5,10,138,2,129,1,123,2,157,0,138,128,128,128,131,132,7,2,0,0,8,125,125,127,127,129,125,130,127,133,124,130,128,129,126,127,128,0,128,128,128,131,132,8,2,0,0,8,125,125,127,127,129,125,130,127,133,124,130,128,129,126,127,128,0,92,156,128,138,138,0,2,152,0,4,124,124,132,124,132,132,124,132,1,13,4,12,127,1,127,2,138,0,127,5,128,128,128,138,138,0,8,0,0,4,169,104,169,152,87,152,87,104,0,127,159,128,138,138,0,7,217,0,14,86,124,95,122,102,122,109,122,116,123,123,122,130,121,138,122,148,123,156,122,162,121,172,124,172,172,86,172,2,8,3,70,159,10,118,0,159,13,5,10,127,2,127,2,138,66,127,0,127,126,111,128,138,138,0,7,64,0,6,122,124,130,123,137,124,137,126,130,128,122,126,0,152,138,128,138,138,0,0,0,0,2,124,124,124,132,2,7,11,80,152,20,153,60,109,10,109,70,138,10,138,15,162,5,162,50,148,10,148,0,132,8,10,80,138,20,138,60,128,10,128,70,136,10,136,70,124,10,124,60,133,0,112,113,109,128,138,138,0,3,0,0,28,103,124,136,124,136,130,133,130,131,132,129,130,113,130,111,132,109,130,105,130,105,168,180,168,180,162,181,162,181,154,180,154,180,130,176,130,174,132,172,130,156,130,154,132,152,130,149,130,149,124,183,124,183,170,103,170,0,7,128,128,128,138,138,0,8,0,0,8,90,107,166,107,166,124,169,124,169,132,166,132,166,149,90,149,0,128,128,128,138,138,0,7,0,0,37,85,146,94,147,104,145,108,127,117,118,111,128,107,145,120,147,132,135,141,122,147,120,141,126,127,145,145,144,153,142,161,135,166,132,166,149,84,149,84,107,166,107,166,124,159,124,151,130,144,135,154,125,159,114,149,111,135,113,123,128,117,139,120,128,128,112,118,110,106,111,98,109,85,111,0,129,140,128,138,138,5,7,128,0,11,131,126,135,130,139,127,142,130,145,127,147,130,151,127,147,140,139,146,125,142,130,130,1,9,4,8,128,2,135,10,128,0,128,129,140,128,138,117,5,7,151,0,10,130,130,135,126,139,129,142,126,145,129,147,126,151,129,147,140,139,146,125,142,2,9,4,8,128,2,121,10,128,0,128,13,5,9,127,2,127,1,138,8,127,0,127,62,117,128,138,138,0,7,128,0,5,66,124,130,124,133,139,128,154,66,154,1,0,5,6,128,4,119,2,183,8,125,0,128,77,144,125,138,138,0,7,198,0,9,51,136,81,136,101,140,120,136,138,139,118,138,100,142,80,138,65,138,2,12,2,10,138,0,138,9,3,10,125,10,131,0,125,76,109,131,138,138,0,7,198,0,9,43,116,81,115,101,119,120,115,138,118,118,117,100,121,80,117,65,117,2,12,2,10,138,0,138,9,3,10,131,10,125,0,131,0,0,0,0,0,0,13,128,128,128,138,138,0,0,0,0,22,87,137,95,137,95,107,156,107,156,134,114,134,114,137,159,137,159,126,161,124,169,124,169,132,166,132,166,149,106,149,106,122,148,122,148,119,103,119,103,143,101,145,87,145,0,116,122,128,138,138,0,7,128,0,4,128,128,130,128,130,140,128,140,1,7,3,20,116,20,145,0,115,116,107,128,138,138,0,7,128,0,4,128,128,130,128,130,140,128,140,1,7,3,20,116,20,145,0,116,145,137,128,138,138,0,7,128,0,4,128,128,130,128,130,140,128,140,1,7,3,20,145,20,115,0,145,145,122,128,138,138,0,7,128,0,4,128,128,130,128,130,140,128,140,1,7,3,20,145,20,115,0,145,128,128,128,138,138,2,0,128,0,4,128,128,130,128,130,133,128,133,1,8,3,10,128,10,135,0,128,115,137,128,138,138,0,7,128,0,4,128,128,130,128,130,140,128,140,1,7,3,20,115,20,145,0,115,145,107,128,138,138,0,7,128,0,4,128,128,130,128,130,140,128,140,1,7,3,20,145,20,114,0,145,128,128,128,138,138,3,0,128,0,4,128,128,130,128,130,133,128,133,1,8,3,10,128,10,135,0,128,128,135,128,138,138,8,0,128,0,4,128,128,130,128,130,133,128,133,1,8,3,10,135,10,128,0,135,128,135,128,138,138,5,0,128,0,4,128,128,130,128,130,133,128,133,1,8,3,10,135,10,128,0,135,128,135,128,138,138,7,0,128,0,4,128,128,130,128,130,133,128,133,1,8,3,10,135,10,128,0,135,128,128,128,138,138,4,0,128,0,4,128,128,130,128,130,133,128,133,1,8,3,10,128,10,135,0,128,9,128,128,128,138,138,0,0,0,0,6,90,124,166,124,169,124,169,132,166,132,90,132,0,129,113,128,138,138,0,0,0,0,5,122,120,168,119,168,134,129,134,122,122,0,157,107,128,138,138,0,2,160,7,16,117,128,121,125,120,120,125,121,128,117,131,121,136,120,135,125,139,128,135,131,136,136,131,135,128,139,125,135,120,136,121,131,1,2,2,10,138,0,138,138,107,133,138,138,0,2,160,7,16,117,128,121,125,120,120,125,121,128,117,131,121,136,120,135,125,139,128,135,131,136,136,131,135,128,139,125,135,120,136,121,131,1,2,2,10,118,0,118,156,128,128,138,138,0,2,32,7,4,127,122,132,122,132,134,127,134,1,1,2,20,128,0,140,143,128,128,138,138,0,0,11,7,4,125,124,131,124,131,132,125,132,0,142,124,128,138,138,0,1,0,0,4,132,131,132,133,126,133,126,131,0,143,127,119,133,138,0,1,54,7,4,127,124,129,124,129,129,127,129,2,2,2,8,143,0,143,13,4,2,127,2,127,2,138,0,127,93,156,128,138,138,0,2,18,0,4,124,124,132,124,132,132,124,132,1,13,2,5,129,0,129,0,11,128,127,128,138,138,0,0,0,0,12,90,133,107,128,126,126,144,128,158,130,169,130,169,138,157,137,142,134,125,132,108,134,90,140,0,93,105,128,138,138,0,7,0,0,17,122,127,204,127,198,138,193,129,187,143,180,131,175,137,170,129,164,139,160,130,152,141,145,130,141,140,136,128,130,140,128,132,122,141,0,159,145,128,138,138,0,2,128,0,4,121,121,135,121,135,132,121,132,1,9,4,10,128,10,129,10,127,0,128,128,125,128,138,138,3,1,0,0,7,128,126,130,128,129,128,129,130,127,130,127,128,126,128,0,133,129,146,138,138,3,1,0,0,7,128,126,130,128,129,128,129,130,127,130,127,128,126,128,0,123,129,110,138,138,3,1,0,0,7,128,126,130,128,129,128,129,130,127,130,127,128,126,128,0,128,130,164,138,138,3,1,0,0,7,128,126,130,128,129,128,129,130,127,130,127,128,126,128,0,165,133,146,138,138,0,1,0,0,7,128,126,130,128,129,128,129,130,127,130,127,128,126,128,0,92,148,110,136,135,0,1,0,0,8,128,126,133,126,130,128,133,130,128,130,130,129,129,128,130,127,0,96,148,110,134,133,0,1,0,0,6,129,126,133,126,133,128,136,131,127,131,129,128,0,92,156,128,138,138,0,2,158,0,4,124,124,132,124,132,132,124,132,1,13,5,20,127,3,127,3,138,44,127,0,127,14,124,150,128,138,138,0,7,128,0,41,125,104,127,102,130,102,132,104,139,108,138,110,144,112,146,111,148,103,147,100,148,96,148,100,150,96,150,99,152,97,150,102,147,113,145,116,143,114,135,113,132,115,128,116,124,116,118,114,121,112,119,106,118,104,120,103,123,98,122,97,124,92,123,96,127,92,125,95,129,94,126,96,123,102,123,104,122,105,122,109,124,109,2,11,3,56,138,2,138,0,128,0,4,3,131,2,125,1,130,0,126,131,114,128,137,153,1,7,0,0,9,127,129,132,128,134,129,130,131,130,132,128,132,127,131,122,130,123,129,0,132,132,128,138,138,2,7,0,0,4,125,129,127,129,128,130,126,130,0,190,128,128,138,138,0,0,26,0,9,121,120,135,118,139,120,145,123,154,124,151,129,149,135,110,129,112,125,4,7,4,30,190,12,191,12,146,0,130,8,6,29,128,21,120,3,109,3,101,1,100,0,146,9,3,57,128,1,128,0,126,13,4,56,127,2,127,2,138,0,127,141,116,133,138,138,4,0,0,0,10,121,126,120,93,138,89,145,126,145,130,141,129,133,132,125,132,121,131,118,130,0,128,150,128,128,128,0,7,0,0,4,87,82,169,82,169,130,87,130,2,10,3,57,128,1,128,0,138,11,3,57,128,2,128,0,138,113,94,126,147,148,6,3,64,0,6,124,124,132,124,129,126,129,132,127,132,127,126,0,127,95,129,144,148,6,3,64,0,12,124,124,126,124,127,127,130,127,130,124,132,123,133,132,131,132,130,129,127,130,127,132,124,132,0,148,95,130,148,152,6,3,64,0,9,124,124,129,124,126,126,129,128,126,129,126,130,130,131,129,132,124,132,0,115,116,127,146,151,6,3,64,0,9,124,124,129,124,126,126,129,128,126,129,126,130,130,131,129,132,124,132,0,130,116,128,150,153,6,3,64,0,8,124,124,128,129,128,124,130,125,130,131,126,129,126,132,124,132,0,146,117,129,150,151,6,3,64,0,6,124,124,128,124,130,127,130,130,129,132,124,132,0,127,130,128,138,138,12,7,0,0,4,127,124,128,124,129,128,127,128,0,92,156,128,138,138,0,2,18,0,4,124,124,132,124,132,132,124,132,1,13,2,10,129,0,129,54,128,128,128,138,138,0,0,128,0,4,124,124,132,124,132,132,124,132,1,2,4,29,133,11,130,15,123,0,133,128,128,128,138,138,0,8,0,0,4,90,107,166,107,166,149,90,149,0,128,128,128,138,138,0,0,192,0,10,128,107,129,113,130,115,129,116,130,126,128,128,126,126,127,116,126,115,127,113,1,2,2,10,228,0,228,128,128,146,138,138,0,0,192,0,10,128,112,129,116,130,118,129,119,130,125,128,128,126,125,127,119,126,118,127,116,1,2,2,10,141,0,141,132,123,128,138,138,3,8,0,0,4,124,121,125,130,124,131,123,130,0,132,123,128,138,138,4,8,0,0,4,124,124,125,130,124,131,123,130,0,128,128,128,138,138,0,0,64,0,3,127,107,129,107,128,112,0,128,128,137,138,138,0,0,64,0,3,127,107,129,107,128,112,0,128,128,146,138,138,0,0,64,0,3,127,107,129,107,128,112,0,128,128,155,138,138,0,0,64,0,3,127,107,129,107,128,112,0,128,128,92,138,138,0,0,64,0,3,127,107,129,107,128,112,0,128,128,101,138,138,0,0,64,0,3,127,107,129,107,128,112,0,128,128,110,138,138,0,0,64,0,3,127,107,129,107,128,112,0,136,120,124,118,138,21,7,128,0,6,117,125,119,127,129,126,128,129,119,129,117,131,1,9,3,10,124,10,138,0,123,128,128,118,138,138,0,0,64,0,3,127,107,129,107,128,112,0,128,128,128,138,138,0,4,192,0,8,106,124,110,123,114,124,115,128,114,132,110,133,106,132,105,128,1,2,2,10,138,0,139,128,125,128,128,128,0,1,138,0,2,128,128,128,131,2,10,6,160,128,1,128,19,255,1,255,29,128,0,128,11,6,160,128,1,128,19,255,1,255,29,128,0,128,118,120,132,138,138,21,7,128,0,6,117,125,119,127,129,126,128,129,119,129,117,131,1,9,3,10,132,5,118,0,133,126,129,128,138,138,18,8,0,0,3,121,127,129,126,129,127,0,127,129,128,138,138,14,8,0,0,3,121,127,129,126,129,127,0,127,128,126,131,131,0,7,192,0,15,113,117,120,114,122,109,124,105,128,103,132,105,134,110,135,114,142,117,135,125,130,119,128,120,126,120,124,119,119,125,4,9,3,10,126,10,132,0,126,7,3,10,127,10,129,0,127,3,2,10,129,0,129,4,2,10,129,0,129,128,110,128,138,138,21,8,0,0,7,125,125,128,124,131,125,132,132,129,134,126,134,123,132,0,117,128,139,138,138,18,7,128,0,14,115,125,117,127,126,127,128,125,128,131,126,129,117,129,116,130,111,132,115,129,114,127,110,125,114,126,112,122,1,9,3,10,139,10,130,0,139,124,129,128,138,138,23,8,0,0,3,121,127,131,126,130,127,0,128,128,128,138,138,22,7,128,0,3,125,126,127,129,125,128,1,9,3,10,128,10,132,0,128,128,128,128,118,138,22,7,128,0,3,125,126,127,129,125,128,1,9,3,10,128,10,124,0,128,128,128,128,138,138,21,7,0,0,12,124,120,126,121,128,121,130,120,133,124,132,127,129,125,128,129,127,129,126,125,122,127,121,124,0,128,130,130,138,138,27,7,128,0,6,124,127,127,128,128,128,131,127,128,130,127,130,1,9,3,10,130,10,127,0,130,128,131,131,138,138,28,7,128,0,6,125,127,127,128,128,128,130,127,128,130,127,130,1,9,3,10,131,10,125,0,131,128,131,131,138,138,29,7,128,0,6,126,127,127,128,128,128,129,127,128,130,127,130,1,9,3,10,131,10,125,0,131,117,128,139,138,138,14,7,128,0,14,115,125,117,127,126,127,128,125,128,131,126,129,117,129,116,130,111,132,115,129,114,127,110,125,114,126,112,122,1,9,3,10,139,5,126,0,139,124,129,128,138,138,31,8,0,0,3,121,127,131,126,130,127,0,128,124,128,129,129,27,7,0,0,2,128,128,128,130,2,10,4,130,129,1,129,29,255,0,255,11,4,130,129,1,129,29,255,0,255,128,128,128,133,158,1,7,0,0,2,128,152,128,155,1,11,3,20,158,40,158,0,128,128,128,121,133,158,1,7,0,0,2,128,152,128,155,1,11,3,25,158,40,158,0,128,128,128,115,133,158,1,7,0,0,2,128,152,128,155,1,11,3,20,158,40,158,0,128,128,128,100,133,158,1,7,0,0,2,128,152,128,155,1,11,3,20,158,40,158,0,128,128,128,163,133,158,1,7,0,0,2,128,152,128,155,1,11,3,25,158,40,158,0,128,128,128,154,133,158,1,7,0,0,2,128,152,128,155,1,11,3,20,158,40,158,0,128,128,128,140,133,158,1,7,0,0,2,128,152,128,155,1,11,3,20,158,40,158,0,128,128,128,125,133,158,1,7,0,0,2,128,152,128,155,1,11,3,5,158,40,158,0,128,128,128,95,133,158,1,7,0,0,2,128,152,128,155,1,11,3,5,158,40,158,0,128,128,128,149,133,158,1,7,0,0,2,128,152,128,155,1,11,3,5,158,40,158,0,128,128,128,111,133,158,1,7,0,0,2,128,152,128,155,1,11,3,5,158,40,158,0,128,128,128,136,133,158,1,7,0,0,2,128,152,128,155,1,11,3,0,158,40,158,0,128,92,103,128,138,138,0,2,0,0,4,124,130,204,130,204,132,124,132,0,92,147,128,138,138,0,2,0,0,4,124,130,204,130,204,132,124,132,0,92,145,128,138,138,0,2,0,0,4,124,90,126,90,126,132,124,132,0,170,145,128,138,138,0,2,0,0,4,124,90,126,90,126,132,124,132,0,86,128,128,138,138,0,7,8,0,6,124,124,130,124,132,127,132,129,130,132,124,132,1,12,2,10,134,0,134,136,128,128,138,128,50,7,211,0,8,123,127,136,127,187,127,205,126,205,129,192,128,154,128,123,129,2,11,5,10,128,2,128,7,136,1,136,0,128,13,6,10,127,2,127,4,132,1,132,3,127,0,127,128,103,146,138,138,0,7,7,0,6,124,124,130,124,132,127,132,129,130,132,124,132,1,12,2,10,134,0,134,128,128,128,138,128,52,7,192,0,8,123,127,136,127,187,127,205,126,205,129,192,128,154,128,123,129,1,11,5,10,128,2,128,7,136,1,136,0,128,92,156,128,138,138,0,2,17,0,4,124,124,132,124,132,132,124,132,1,13,2,10,129,0,129,4,92,109,128,138,138,0,7,0,0,4,123,123,205,123,205,171,123,171,0,128,128,128,138,138,0,0,64,0,8,121,127,122,115,134,115,135,127,132,127,132,153,124,153,124,127,0,128,121,128,138,138,0,1,74,0,4,124,124,132,124,132,132,124,132,0,128,122,128,138,138,0,3,64,0,10,123,122,133,122,133,132,131,132,131,126,130,124,126,124,125,126,125,132,123,132,0,13,128,128,128,138,138,0,0,0,0,7,150,147,132,147,132,149,124,149,124,147,90,147,90,108,0,90,104,128,138,138,0,7,0,0,13,125,128,207,128,207,176,180,176,180,171,174,163,165,160,153,165,143,162,134,164,128,164,128,160,125,160,0,128,109,128,138,138,0,0,64,0,4,124,121,132,121,132,136,123,133,0,102,138,128,130,138,0,0,223,0,4,132,131,132,125,124,125,124,131,2,10,5,10,130,4,130,15,143,16,130,0,130,13,5,10,127,2,127,2,138,31,127,0,127,103,134,131,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,5,12,130,4,130,15,143,14,130,0,130,105,132,138,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,5,14,130,4,130,15,143,12,130,0,130,109,129,138,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,5,16,130,4,130,15,143,10,130,0,130,112,127,142,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,5,18,130,4,130,15,143,8,130,0,130,117,125,142,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,5,20,130,4,130,15,143,6,130,0,130,120,123,138,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,5,22,130,4,130,15,143,4,130,0,130,123,120,135,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,5,24,130,4,130,15,143,2,130,0,130,126,116,133,130,138,0,0,192,0,4,132,131,132,125,124,125,124,131,1,10,4,26,130,4,130,15,143,0,130,92,156,128,138,138,0,2,18,0,4,124,124,132,124,132,132,124,132,1,13,2,10,129,0,129,19,128,128,128,138,138,0,0,0,0,24,124,104,132,104,132,108,148,125,169,125,169,131,153,131,151,133,148,133,132,148,132,152,124,152,124,148,108,133,104,133,102,131,87,131,87,125,108,125,109,120,104,117,107,112,112,115,124,108,0,128,128,128,181,181,0,0,0,0,2,128,128,128,132,0,128,128,128,141,141,0,7,0,0,2,128,128,128,132,0,124,105,148,138,138,0,3,0,0,4,128,128,132,128,132,131,128,130,1,9,2,25,148,0,128,129,124,128,138,138,0,0,0,0,7,124,127,127,126,130,127,130,133,128,135,126,135,124,133,0,132,105,108,118,138,0,3,0,0,4,128,128,132,128,132,131,128,130,1,9,2,25,108,0,128,128,128,128,130,133,0,1,0,0,4,124,89,132,89,132,97,124,97,0,128,128,137,130,133,0,7,0,0,4,124,89,132,89,132,97,124,97,0,128,128,146,130,133,0,1,0,0,4,124,89,132,89,132,97,124,97,0,128,128,155,130,133,0,7,0,0,4,124,89,132,89,132,97,124,97,0,128,128,92,130,133,0,1,0,0,4,124,89,132,89,132,97,124,97,0,128,128,101,130,133,0,7,0,0,4,124,89,132,89,132,97,124,97,0,128,128,110,130,133,0,1,0,0,4,124,89,132,89,132,97,124,97,0,128,128,119,130,133,0,7,0,0,4,124,89,132,89,132,97,124,97,0,128,128,128,138,138,0,7,187,7,15,126,112,127,111,128,107,129,111,130,112,129,114,129,122,132,125,132,126,129,124,127,124,124,126,124,125,127,122,127,114,2,2,6,5,128,3,128,3,120,2,180,2,120,0,128,13,6,9,127,1,127,3,138,0,127,2,127,0,127,128,128,128,138,138,0,7,187,8,15,126,117,127,115,128,112,129,115,130,117,129,118,129,122,132,125,132,126,129,124,127,124,124,126,124,125,127,122,127,118,1,2,6,110,128,3,128,3,120,2,180,2,120,0,128,153,137,128,138,138,0,2,32,8,4,124,123,129,123,129,132,124,132,1,1,2,10,128,0,113,107,137,128,138,138,0,2,32,7,4,123,123,128,123,128,132,123,132,1,1,2,10,128,0,113,128,128,128,138,138,0,4,0,0,2,128,128,128,134,0,8,128,128,128,138,138,0,0,0,0,20,124,104,132,104,132,107,150,115,143,124,169,124,169,132,143,132,150,141,132,146,132,149,124,149,124,146,106,141,113,132,87,132,87,124,113,124,106,115,124,107,0,128,134,128,138,138,0,2,0,0,12,125,123,125,121,119,113,119,111,137,111,137,113,131,121,131,123,137,130,137,132,119,132,119,130,0,126,132,128,138,118,0,4,64,0,8,123,124,137,124,131,131,131,133,137,141,123,141,129,133,129,131,0,105,132,128,138,138,0,2,32,7,4,120,124,139,124,132,133,120,133,2,1,2,20,128,0,132,0,2,20,128,0,125,105,124,128,138,118,0,2,32,7,4,120,124,139,124,132,133,120,133,2,1,2,20,128,0,124,0,2,20,128,0,125,151,132,128,118,138,0,2,32,8,4,120,124,139,124,132,133,120,133,2,1,2,20,128,0,132,0,2,20,128,0,131,151,124,128,118,118,0,2,32,8,4,120,124,139,124,132,133,120,133,2,1,2,20,128,0,124,0,2,20,128,0,131,92,156,128,138,138,0,2,16,0,4,124,124,132,124,132,132,124,132,1,13,2,10,129,0,129,24,128,128,128,138,138,0,0,0,0,6,125,145,126,138,131,138,132,145,132,149,124,149,0,130,137,128,138,138,0,1,10,0,4,124,122,129,122,129,129,124,129,0,91,108,128,138,138,0,7,0,0,25,124,124,206,124,206,150,204,146,201,151,197,145,193,158,193,144,195,144,189,137,183,137,179,140,175,136,162,136,159,140,155,137,147,137,141,144,143,144,143,157,138,147,136,153,130,145,128,150,124,144,0,102,116,130,132,133,0,8,64,0,6,114,115,128,117,127,122,137,128,125,126,124,132,0,108,115,130,132,133,0,8,64,0,9,116,117,127,115,120,119,122,122,132,121,125,125,126,128,137,128,124,132,0,114,115,131,132,133,0,8,64,0,5,112,117,128,112,124,116,128,130,119,118,0,126,112,132,132,133,0,8,64,0,6,120,124,124,118,133,119,138,128,132,134,124,132,0,127,127,132,130,132,7,7,64,0,4,111,115,144,117,154,130,123,129,0,133,115,133,132,133,0,8,64,0,8,114,115,121,122,124,121,124,114,133,128,126,123,124,125,124,132,0,138,115,133,132,133,0,8,64,0,5,120,114,124,113,135,129,126,123,124,132,0,124,122,132,127,131,10,7,64,0,3,111,115,144,117,116,124,0,145,115,134,133,134,0,8,64,0,7,116,117,125,126,128,125,125,115,132,126,128,131,123,129,0,151,116,135,133,134,0,8,64,0,6,116,117,126,123,124,114,132,127,121,122,123,130,0,120,120,132,139,146,4,7,64,0,3,126,127,132,126,131,129,0,120,115,132,132,133,0,8,64,0,6,114,115,128,117,127,122,137,128,125,126,124,132,0,120,120,132,139,146,15,7,64,0,3,126,127,132,126,131,129,0,157,117,135,132,133,0,8,64,0,5,112,117,128,112,124,116,128,130,119,118,0,149,128,128,138,138,0,7,0,0,4,126,124,131,124,130,129,127,129,0,128,130,128,138,138,18,2,0,0,8,128,124,129,121,129,124,132,125,129,125,128,128,128,125,126,125,0,113,127,128,138,138,0,7,0,0,4,126,124,131,124,130,129,127,129,0,92,129,128,138,138,18,2,0,0,8,128,124,129,121,129,124,132,125,129,125,128,128,128,125,126,125,0,103,99,128,138,138,0,8,19,0,9,112,133,154,133,156,140,155,146,151,155,143,158,125,159,114,158,112,151,2,0,3,10,128,60,128,0,93,13,4,22,127,2,127,6,142,0,127,151,99,128,117,138,0,8,0,0,9,112,133,154,133,156,140,155,146,150,150,135,158,125,159,114,158,112,151,1,0,3,10,128,60,128,0,163,132,135,128,138,138,0,2,20,0,4,121,124,128,124,128,132,121,132,2,10,3,60,138,19,138,0,128,13,4,60,127,3,127,4,138,0,127,2,128,128,128,138,138,0,0,0,0,21,133,104,134,111,142,117,153,122,156,126,156,131,152,136,136,144,119,146,101,141,87,135,87,127,102,134,119,138,136,136,145,132,148,129,147,126,139,124,128,115,123,104,0,92,156,128,138,138,0,2,158,0,4,124,124,132,124,132,132,124,132,1,13,5,20,127,4,127,3,138,43,127,0,127,0,0,0,0,4,128,128,128,138,138,0,0,0,0,12,87,124,90,124,90,105,166,105,166,124,169,124,169,132,166,132,166,151,90,151,90,132,87,132,0,92,130,128,138,138,0,5,64,0,28,124,121,132,123,145,131,157,135,166,136,170,131,160,126,153,118,154,112,163,109,179,110,193,119,202,123,204,124,204,129,194,127,181,117,167,114,160,117,164,121,176,127,178,133,174,138,168,143,155,142,141,137,130,131,124,130,0,97,106,128,138,138,0,7,64,0,12,118,106,200,106,200,133,190,131,180,132,172,132,158,130,151,132,140,132,129,133,124,132,118,130,1,1,3,1,128,10,148,0,148,159,152,92,138,138,0,7,64,0,13,118,107,200,107,200,134,190,132,180,134,173,134,166,132,159,134,153,135,146,135,140,133,129,134,118,131,1,1,3,1,128,10,108,0,108,12,128,128,128,138,138,0,0,0,0,4,87,124,166,124,166,132,87,132,0,102,128,128,138,138,0,2,32,8,4,122,122,127,122,127,134,122,134,1,1,2,20,128,0,140,111,128,128,138,138,0,0,11,8,4,126,124,132,124,132,132,126,132,0,111,131,128,138,138,0,1,0,0,4,126,124,132,124,132,126,126,126,0,112,127,120,133,138,0,1,54,8,4,127,125,129,125,129,129,127,129,2,2,2,8,143,0,143,13,4,1,127,2,127,2,138,0,127,91,108,128,138,138,0,0,0,0,5,124,124,167,124,167,133,163,141,124,141,0,123,118,128,138,138,0,2,160,8,4,123,124,129,124,129,131,123,131,1,8,3,5,118,5,109,0,118,124,108,128,138,138,0,2,0,0,4,124,124,126,124,126,141,124,141,0,112,108,128,138,138,0,2,0,0,4,124,124,126,124,126,141,124,141,0,100,108,128,138,138,0,2,0,0,4,124,124,126,124,126,141,124,141,0,111,109,128,138,138,0,2,160,8,4,123,124,129,124,129,131,123,131,1,8,3,5,109,5,118,0,109,99,118,128,138,138,0,2,160,8,4,123,124,129,124,129,131,123,131,1,8,3,5,118,5,109,0,118,0,0,0,0,0,9,136,153,128,138,138,0,3,0,0,4,79,79,161,79,161,127,79,127,0,128,128,128,138,138,0,7,0,0,10,105,135,105,121,117,107,166,107,166,122,169,122,169,134,166,134,166,149,117,149,0,130,124,128,138,138,0,8,0,0,8,126,117,128,111,138,111,135,120,131,123,128,133,124,132,127,122,0,128,128,128,138,138,0,3,128,0,8,127,120,129,120,130,127,130,129,129,130,127,130,126,129,126,127,1,2,2,10,133,0,133,128,120,104,138,138,4,3,128,0,8,127,120,129,120,130,127,130,129,129,130,127,130,126,129,126,127,1,2,2,10,133,0,133,128,120,108,138,138,5,3,128,0,8,127,120,129,120,130,127,130,129,129,130,127,130,126,129,126,127,1,2,2,10,133,0,133,128,148,128,138,138,0,0,0,0,4,124,124,132,124,132,132,124,132,0,165,128,128,138,138,0,0,0,0,12,116,124,121,124,121,123,125,123,125,124,132,124,132,132,125,132,125,133,121,133,121,132,116,132,0,128,122,128,138,138,6,0,0,0,4,124,124,132,124,132,132,124,132,0,8,128,128,128,138,138,0,8,13,1,4,87,104,169,104,169,152,87,152,0,107,141,128,141,141,0,0,6,2,2,128,128,128,132,1,12,2,10,133,0,133,94,126,128,138,138,0,0,0,0,4,124,126,130,126,130,134,124,134,0,111,118,128,138,138,0,3,0,0,22,104,113,186,113,186,162,183,159,183,125,174,117,149,117,149,114,141,114,141,129,149,138,138,146,124,132,113,132,113,134,107,134,107,142,109,142,109,159,183,159,186,162,104,162,0,157,140,128,138,138,0,7,38,1,11,123,125,124,123,126,122,130,122,132,123,133,125,133,134,130,132,128,134,126,132,123,134,1,12,2,4,128,0,158,127,131,128,130,129,5,2,60,1,8,124,124,127,127,130,124,131,127,134,124,131,129,129,127,127,129,3,11,3,2,129,2,129,0,138,10,3,2,130,2,130,0,138,13,4,1,127,2,127,2,138,0,127,128,124,128,118,128,5,2,32,1,3,125,128,127,131,124,129,1,11,3,2,128,1,128,0,138,128,124,128,138,128,5,2,32,1,3,125,128,127,131,124,130,1,11,3,2,128,1,128,0,138,20,128,128,128,138,138,0,0,0,0,12,166,124,169,124,169,132,166,132,166,149,90,149,90,132,87,132,87,124,90,124,90,107,166,107,0,150,119,128,138,138,0,0,13,6,4,124,125,132,125,132,149,124,149,0,127,141,128,138,138,0,3,0,0,4,91,128,167,128,167,132,91,132,0,127,111,128,138,138,0,3,0,0,4,91,128,167,128,167,132,91,132,0,95,109,92,138,138,0,7,36,6,4,124,127,132,127,132,129,124,129,1,12,3,10,140,4,130,0,140,95,147,128,138,138,0,7,36,4,4,124,127,132,127,132,129,124,129,1,12,3,10,138,2,130,0,138,104,147,128,138,138,0,7,36,3,4,124,127,132,127,132,129,124,129,1,12,3,10,143,3,132,0,143,104,109,92,138,138,0,7,36,5,4,124,127,132,127,132,129,124,129,1,12,3,10,141,2,131,0,141,128,125,128,133,133,7,7,189,3,2,128,128,128,132,2,1,5,1,128,30,90,2,166,23,90,0,167,13,8,1,127,1,127,2,138,28,127,1,127,2,138,21,127,0,127,94,124,128,138,138,0,2,32,3,4,124,124,128,124,128,132,124,132,1,1,2,10,128,0,117,94,132,128,138,138,0,2,32,3,4,124,124,128,124,128,132,124,132,1,1,2,10,128,0,139,166,118,128,138,138,0,2,32,6,4,124,124,128,124,128,132,124,132,1,1,2,10,129,0,139,166,138,128,138,138,0,2,32,6,4,124,124,128,124,128,132,124,132,1,1,2,10,128,0,117,96,160,128,138,138,0,0,46,3,2,124,124,124,132,1,12,3,50,127,10,127,0,138,104,160,128,138,138,0,0,46,4,2,124,124,124,132,1,12,3,50,127,10,127,0,138,112,160,128,138,138,0,0,46,5,2,124,124,124,132,1,12,3,50,127,10,127,0,138,120,160,128,138,138,0,0,46,6,2,124,124,124,132,1,12,3,50,127,10,127,0,138,128,125,128,133,133,6,7,189,4,2,128,128,128,132,2,1,5,1,128,30,90,2,166,23,90,0,167,13,8,1,127,1,127,2,138,28,127,1,127,2,138,21,127,0,127,128,125,164,133,133,8,7,189,5,2,128,128,128,132,2,1,5,1,128,30,90,2,166,23,90,0,167,13,8,1,127,1,127,2,138,28,127,1,127,2,138,21,127,0,127,128,125,164,133,133,5,7,189,6,2,128,128,128,132,2,1,5,1,128,30,90,2,166,23,90,0,167,13,8,1,127,1,127,2,138,28,127,1,127,2,138,21,127,0,127,0,0,0,0,0,5,128,128,128,138,138,0,0,0,0,18,110,108,166,108,166,149,137,149,137,132,132,132,132,152,124,152,124,124,145,124,145,141,158,141,158,116,118,116,118,132,87,132,87,124,110,124,0,149,145,128,138,138,0,4,64,0,6,124,124,132,124,133,128,132,132,124,132,123,128,0,122,112,128,138,138,0,4,64,0,6,124,124,132,124,133,128,132,132,124,132,123,128,0,81,148,128,138,138,0,7,128,0,4,128,77,132,77,132,132,128,132,1,0,2,10,141,0,141,178,128,128,138,138,4,7,0,0,4,128,77,132,77,132,132,128,132,0,20,128,128,128,182,182,0,3,0,0,2,128,128,128,130,0,128,128,128,138,138,0,0,0,0,4,132,104,132,152,124,152,124,104,0,128,128,128,179,179,0,0,0,0,2,128,128,128,131,0,128,128,128,179,179,0,6,0,0,2,128,128,128,131,0,128,128,132,138,138,0,7,128,0,2,128,128,128,132,1,2,2,10,153,0,153,128,115,128,135,135,5,7,128,0,2,128,128,128,132,1,2,2,10,148,0,148,128,140,128,135,135,5,7,128,0,2,128,128,128,132,1,2,2,10,148,0,148,141,128,128,135,135,5,7,128,0,2,128,128,128,132,1,2,2,10,108,0,108,115,128,128,135,135,5,7,128,0,2,128,128,128,132,1,2,2,10,108,0,108,120,128,128,133,133,9,7,0,0,2,126,128,126,132,0,136,128,128,133,133,9,7,0,0,2,130,128,130,132,0,128,136,128,133,133,6,7,0,0,2,128,130,128,134,0,128,120,128,133,133,6,7,0,0,2,128,126,128,130,0,136,128,128,133,133,8,7,0,0,2,130,128,130,132,0,120,128,128,133,133,8,7,0,0,2,126,128,126,132,0,128,120,128,133,133,7,7,0,0,2,128,126,128,130,0,128,136,128,133,133,7,7,0,0,2,128,130,128,134,0,156,139,128,138,138,0,7,128,0,10,124,124,125,128,129,127,133,128,136,125,134,131,131,129,129,131,127,128,124,132,1,2,2,5,132,0,124,128,119,128,138,138,18,7,0,0,3,124,124,128,129,126,131,0,133,120,128,119,139,18,7,0,0,3,124,124,128,128,126,130,0,21,128,128,128,138,138,0,0,0,0,16,124,104,132,104,132,107,166,107,166,149,103,149,103,134,91,134,90,132,87,132,87,124,90,124,91,122,103,122,103,107,124,107,0,100,122,128,138,138,0,2,32,1,8,128,128,130,128,130,130,131,131,131,137,130,138,130,140,128,140,1,1,2,10,128,0,153,96,122,128,138,138,0,2,32,2,8,128,128,130,128,130,130,131,131,131,137,130,138,130,140,128,140,1,1,2,10,128,0,153,92,122,128,138,138,0,2,32,3,8,128,128,130,128,130,130,131,131,131,137,130,138,130,140,128,140,1,1,2,10,128,0,153,160,113,128,138,138,0,0,13,1,4,124,124,132,124,132,132,124,132,0,159,111,128,138,138,0,1,0,0,4,127,130,131,130,132,132,126,132,0,160,112,128,138,138,0,1,54,1,4,127,127,129,127,129,129,127,129,2,1,2,3,128,0,138,13,4,1,127,1,127,1,138,0,127,160,143,128,138,138,0,0,13,3,4,124,124,132,124,132,132,124,132,0,159,141,128,138,138,0,1,0,0,4,127,130,131,130,132,132,126,132,0,109,143,128,138,138,0,0,13,2,4,124,124,132,124,132,132,124,132,0,108,141,128,138,138,0,1,0,0,4,127,130,131,130,132,132,126,132,0,160,142,128,138,138,0,1,54,3,4,127,127,129,127,129,129,127,129,2,1,2,3,128,0,138,13,4,1,127,1,127,1,138,0,127,109,142,128,138,138,0,1,54,2,4,127,127,129,127,129,129,127,129,2,1,2,3,128,0,138,13,4,1,127,1,127,1,138,0,127,147,144,128,138,138,0,7,0,0,12,124,91,135,91,135,119,147,119,147,123,135,123,135,133,124,133,124,123,84,123,84,119,124,119,0,132,135,128,138,138,0,0,0,0,4,128,128,139,128,139,132,128,132,2,7,3,2,132,14,132,0,143,8,3,17,135,3,135,0,131,107,120,128,138,138,0,7,0,0,6,124,124,136,124,136,115,145,115,145,128,124,128,0,115,116,128,138,138,0,0,44,12,4,124,124,128,124,128,128,124,128,2,7,3,15,115,6,115,0,119,8,4,12,116,10,120,4,120,0,116,107,111,128,138,138,0,4,64,0,8,124,124,131,124,136,124,135,128,135,132,131,132,124,132,124,128,0,129,116,128,138,138,0,0,32,12,4,123,124,128,124,128,128,123,128,1,7,2,8,129,0,124,162,134,128,138,138,0,0,32,1,4,124,124,129,124,129,128,124,128,1,8,2,4,134,0,139,160,121,128,138,138,0,0,11,12,4,124,124,132,124,132,126,124,126,0,0,0];


/**
 * @file common.js
 * @version 1.0.0
 * @author Donitz 2019
 */

/*
 * Levels structure:
 *  shape_count (byte)
 *  0: shapes [
 *      0: x (byte) -> (int8)
 *      1: y (byte) -> (int8)
 *      2: angle (byte) -> (int8)
 *      3: scale_x (byte) -> (int8)
 *      4: scale_y (byte) -> (int8)
 *      5: context
 *      6: time
 *      7: parent (byte) -> (object)
 *      8: type (byte) ->
 *          0: open 1
 *          1: open 2
 *          2: wall 1
 *          3: wall 2
 *          4: reverse
 *          5: stop
 *          6: superhot
 *          7: hazard
 *      9: special (byte) ->
 *          bit 6: timelock
 *          bit 7: wave
 *          bit 8: loop
 *          0: none
 *          1: player
 *          2: x time
 *          3: y time
 *          4: track x
 *          5: track y
 *          6: track xy
 *          7: track x timeless
 *          8: track y timeless
 *          9: track xy timeless
 *          10: exit
 *          11: proximity set key
 *          12: proximity unset key
 *          13: proximity temporary set key
 *          14: context set key - 1
 *          16-31: sound
 *      10: key (byte)
 *      vertex_count (byte)
 *      11: vertices [
 *          x0, y0, x1, y2... (byte) -> (int8)
 *      ]
 *      parameter_count (byte)
 *      12: parameters [
 *          0: parameter (byte)
 *          point_count (byte)
 *          1: points [
 *              0: duration (byte)
 *              1: y (byte) -> (int8)
 *          ]
 *      ]
 *  ]
 */

////////////////////////////////////////////////////////////////////////
// Helper functions

const lerp = (a, b, t) => a * (1 - t) + b * t;
const createArray = n => [...Array(n)];
const seq = (from, to) => [...Array(to - from)].map((_, i) => from + i);
const createPattern = (sizeX, sizeY, colorFunc) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = sizeX;
    canvas.height = sizeY;
    seq(0, sizeX).map(x => seq(0, sizeY).map(y => {
        ctx.fillStyle = colorFunc(x, y);
        ctx.fillRect(x, y, 1, 1);
    }));
    return ctx.createPattern(canvas, 'repeat');
};
const getRoot = shape => {
    while (shape[7]) {
        shape = shape[7];
    }
    return shape;
};
const isTimelocked = shape => !editor && (shape[9] & 32) && !(keys.has(shape[10]) || tempKeys.has(shape[10]));

////////////////////////////////////////////////////////////////////////
// Settings

const stepInterval = .05;

const arenaSizeX = 640;
const arenaSizeY = 368;

const positionStep = 8;
const scaleStep = .1;
const angleStep = 5;
const timeStep = .1;

////////////////////////////////////////////////////////////////////////
// Game state

let levels;
let shapes;
let step;
let totalSeconds;
let stepFraction;
let editor = false;
let keys = new Set();
let tempKeys = new Set();

////////////////////////////////////////////////////////////////////////
// Canvas

let cameraX = 0;
let cameraY = 0;

let canvas;
let ctx;

let typeFillStyle;
let typeStrokeStyle;
const typeLineWidth = [2, 0, 2, 7, 7, 7, 0, 0, 0];

const setupCanvas = () => {
    canvas = document.querySelector('canvas');
    ctx = canvas.getContext('2d');

    typeFillStyle = [
        '#4b0072',
        '#9800e5',
        '#000',
        createPattern(2, 2, (x, y) => (x + y) % 2 ? '#cf0d67' : '#000'),
        createPattern(1, 2, (x, y) => y % 2 ? 'transparent' : '#454a98'),
        createPattern(1, 2, (x, y) => y % 2 ? 'transparent' : '#864598'),
        createPattern(1, 2, (x, y) => y % 2 ? 'transparent' : '#458a98'),
        '#cf0d67',
        '#000'];
    typeStrokeStyle = typeFillStyle.map((color, i) => typeLineWidth[i] ? createPattern(2, 2, (x, y) => !((x + y) % 2) ? 'transparent' : color) : 'transparent');
};

////////////////////////////////////////////////////////////////////////
// Level loading

const loadLevels = () => {
    let i = 0;
    levels = createArray(levelData[i++]).map(
        () => createArray(levelData[i++]).map(
            () => [].concat(
                createArray(5).map(() => levelData[i++] - 128),
                0,
                0,
                createArray(4).map(() => levelData[i++]),
                [createArray(levelData[i++]).map(
                    () => createArray(2).map(() => levelData[i++] - 128))],
                [createArray(levelData[i++]).map(
                    () => [levelData[i++], createArray(levelData[i++]).map(
                        () => [levelData[i++], levelData[i++] - 128])])])));
}
loadLevels();

const startLevels = indices => {
    shapes = indices.map(i => {
        shapes = JSON.parse(JSON.stringify(levels[i]));
        shapes.map(shape => shape[7] = !shape[7] ? null : shapes[shape[7] - 1]);
        return shapes;
    }).flat(1);
    step = 0;
    totalSeconds = stepInterval;
};

////////////////////////////////////////////////////////////////////////
// Update game logic

const update = elapsedSeconds => {
    totalSeconds += elapsedSeconds;
    const targetStep = Math.floor(totalSeconds / stepInterval) + (elapsedSeconds > 0);
    stepFraction = Math.abs(totalSeconds - targetStep * stepInterval) / stepInterval;

    while (step !== targetStep) {
        const rate = (step < targetStep) * 2 - 1;
        step += rate;

        shapes.map((shape, si) => {
            seq(0, 7).map((v, i) => shape[13 + i] = shape[i]);

            const root = getRoot(shape);
            if (isTimelocked(shape)) {
                return;
            }

            const special = shape[9] & 31;
            shape[6] = (
                special === 2 && !editor ? root[0] * timeStep :
                special === 3 && !editor ? root[1] * timeStep :
                shape[6] + stepInterval * rate);
            shape[12].map(param => {
                const duration = param[1].reduce((sum, point) => sum + point[0] * timeStep, 0);
                let secondsLeft = shape[6 + 13 * (rate < 0)];
                if (shape[9] & 128) {
                    secondsLeft = (secondsLeft + duration * 1e8) % duration;
                }
                const l = param[1].length;
                seq(0, l).map(i => {
                    if (i === l - 1) {
                        return;
                    }
                    const point0 = param[1][i];
                    const point1 = param[1][(i + 1) % l];
                    if (secondsLeft >= 0 && secondsLeft < point0[0] * timeStep + 1e-10 && point0[0] > 0) {
                        const y = lerp(point0[1], point1[1], secondsLeft / point0[0] / timeStep);
                        const p = param[0];
                        if (p % 7 === 6) {
                            const t = new Date().getTime();
                            if (y > 0 && (!param[2] || t > param[2] + 1500)) {
                                param[2] = t;
                                const soundId = special - 16;
                                if (soundId >= 0 && soundId < sounds.length && !editor) {
                                    sounds[soundId]();
                                }
                            }
                        } else {
                            shape[p % 7] = p > 6 ? y : shape[p] + y * stepInterval * rate;
                        }
                    }
                    secondsLeft -= point0[0] * timeStep;
                });
            });

            if (special === 14 && shape[5] >= 0) {
                tempKeys.add(shape[10] - 1);
            }
        });
    }
};

////////////////////////////////////////////////////////////////////////
// Rendering

const setShapeTransform = shape => {
    const shapes = [];
    while (shape) {
        shapes.unshift(shape);
        shape = shape[7];
    }

    ctx.translate(-cameraX + arenaSizeX / 2, -cameraY + arenaSizeY / 2);
    ctx.scale(positionStep, positionStep);

    shapes.map(shape => {
        const [x, y, angle, scaleX, scaleY] = seq(0, 5).map(i => lerp(shape[i], shape[13 + i], stepFraction));

        ctx.translate(x, y);
        ctx.rotate(angle * angleStep * Math.PI / 180);
        ctx.scale(scaleX * scaleStep, scaleY * scaleStep);
    });
};

const wave = (a, b, c) => a + Math.sin((totalSeconds + a + b) * 5) * c;

const drawShape = (shape, fillStyle, strokeStyle, lineWidth) => {
    setShapeTransform(shape);

    const waveMagnitude = ((shape[9] & 64) > 0) / 2;

    ctx.beginPath();
    if (shape[11].length < 3) {
        const point = shape[11][0];
        ctx.arc(point[0], point[1], 4, 0, 2 * Math.PI);
    } else {
        shape[11].map((point, i) => {
            const x = wave(point[0], point[1], waveMagnitude);
            const y = wave(point[1], point[0], waveMagnitude);
            if (!i) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
    }
    ctx.closePath();

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
};



/**
 * @file game.js
 * @version 1.0.0
 * @author Donitz 2019
 */

////////////////////////////////////////////////////////////////////////
// Input

const keyHeld = new Set();

addEventListener('keydown', e => {
    keyHeld.add(e.keyCode)
    if (e.keyCode === 77) {
        muted = !muted;
        if (muted) {
            stopMusic(false);
        } else {
            playMusic(currentMusic);
        }
    }
});
addEventListener('keyup', e => keyHeld.delete(e.keyCode));

////////////////////////////////////////////////////////////////////////
// Game state

const trackSpecial = [[4, 6, 7, 9], [5, 6, 8, 9]];
const playerVelocity = 18;
const outroLevelIndex = 32;

let playerShape;
let timeRate = 1;
let restartLevel;
let interlacingPatterns;
let quake = 0;
let timeUntilStart = 0;
let mapX = 3;
let mapY = 7;
let playerDirection = 1;

////////////////////////////////////////////////////////////////////////
// Main loop

let lastTime = 0;
const render = time => {
    let elapsedSeconds = Math.min((time - lastTime) / 1000, .02);
    lastTime = time;

    elapsedSeconds *= (timeUntilStart -= elapsedSeconds) < 0;

    requestAnimationFrame(render);

    quake *= .95;
    cameraX = cameraX * .9 + (Math.random() - .5) * quake;
    cameraY = cameraY * .9 + (Math.random() - .5) * quake;

    update(-stepInterval);
    update(elapsedSeconds * timeRate + stepInterval);

    const oldTimeRate = timeRate;
    timeRate = 1;
    let pattern = 0;

    if (playerShape !== undefined) {
        shapes.forEach(shape => seq(0, 2).map(a => {
            const special = shape[9] & 31;
            if (trackSpecial[a].includes(special) && (oldTimeRate > 0 || special > 6) && !isTimelocked(shape)) {
                const d = playerShape[a] - shape[a];
                const v = elapsedSeconds * shape[5];
                shape[a] += Math.abs(d) < v ? d : v * Math.sign(d);
            }
        }));

        const input = [
            -(keyHeld.has(37) || keyHeld.has(65)) + (keyHeld.has(39) || keyHeld.has(68)),
            -(keyHeld.has(38) || keyHeld.has(87)) + (keyHeld.has(40) || keyHeld.has(83))];
        const velocity = input.map(v => v * playerVelocity * elapsedSeconds);
        const velocitySum = Math.abs(velocity[0]) + Math.abs(velocity[1]);

        let i = 0;
        playerShape[i] += velocity[i];
        i++;
        playerShape[i] += velocity[i];
        playerDirection = Math.sign(velocity[0]) || playerDirection;

        playerShape[16] = playerShape[3] = playerDirection * 2;

        tempKeys.add(0);
        if (!velocitySum && (playerShape[6] % 0.4) < 0.05) {
            tempKeys.delete(0);
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.lineJoin = 'round';

        shapes.map((shape, i) => getRoot(shape) !== playerShape && drawShape(shape, `rgb(0,${i + 1},0)`, '#f00', 2));

        if (timeUntilStart < 0) {
            for (let d = 0; d < 9; d++) {
                const x = playerShape[0] * positionStep + arenaSizeX / 2;
                const y = playerShape[1] * positionStep + arenaSizeY / 2;

                const dx = Math.cos(d / 4 * Math.PI) * 10 * (d < 8);
                const dy = Math.sin(d / 4 * Math.PI) * 10 * (d < 8);

                const pixel = ctx.getImageData(x + dx, y + dy, 1, 1).data;
                let blocked = !pixel[1] && !pixel[0];
                if (pixel[1] && !pixel[0]) {
                    const shape = shapes[pixel[1] - 1];
                    const type = shape[8];
                    const special = shape[9] & 31;
                    if (d === 8 && type === 7) {
                        quake = 10;
                        restartLevel();
                        sounds[5]();
                        timeUntilStart = 0.5;
                        return;
                    } else if (type === 2 || type === 3) {
                        blocked = true;
                    } else if (type === 4) {
                        timeRate = -1;
                        pattern = 1;
                    } else if (type === 5) {
                        timeRate = 0;
                        pattern = 2;
                    } else if (type === 6) {
                        timeRate = +(velocitySum > 0);
                        pattern = 3;
                    }
                    if (special === 10) {
                        playerShape[1] = -1000;
                    } else if (special === 11) {
                        keys.add(shape[10]);
                    } else if (special === 12) {
                        keys.delete(shape[10]);
                    } else if (special === 13) {
                        tempKeys.add(shape[10]);
                    }
                }
                if (blocked && d < 8) {
                    const l = Math.sqrt(dx ** 2 + dy ** 2);
                    playerShape[0] -= dx / l * elapsedSeconds * playerVelocity * 1.1;
                    playerShape[1] -= dy / l * elapsedSeconds * playerVelocity * 1.1;
                }
            }
        }

        const oldMapX = mapX;
        const oldMapY = mapY;
        mapX += -(playerShape[0] < -38) + (playerShape[0] > 38);
        mapY += -(playerShape[1] < -21) + (playerShape[1] > 21);
        if (oldMapX !== mapX || oldMapY !== mapY) {
            travel(
                oldMapX < mapX ? -36 : oldMapX > mapX ? 36 : playerShape[0],
                oldMapY < mapY ? -19 : oldMapY > mapY ? 19 : playerShape[1]);
            cameraX += (oldMapX - mapX) * arenaSizeX;
            cameraY += (oldMapY - mapY) * arenaSizeY;
            timeUntilStart = .7;
        }
    }

    ctx.fillStyle = typeFillStyle[2];
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    shapes.map(shape => drawShape(shape, typeFillStyle[shape[8]], typeStrokeStyle[shape[8]], typeLineWidth[shape[8]]));

    ctx.fillStyle = interlacingPatterns[pattern];
    ctx.translate(totalSeconds * 4, 0);
    ctx.fillRect(-totalSeconds * 4, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(0, 0, 0, .4)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
};

////////////////////////////////////////////////////////////////////////
// Start

const handleResize = () => {
    canvas.width = arenaSizeX;
    canvas.height = arenaSizeY;
    const a = arenaSizeX / arenaSizeY;
    let x = 0;
    let y = (innerHeight - innerWidth / a) / 2;
    let s = innerWidth / arenaSizeX;
    if ((innerWidth / innerHeight) > a) {
        x = (innerWidth - innerHeight * a) / 2;
        y = 0;
        s = innerHeight / arenaSizeY;
    }
    canvas.style.width = `${arenaSizeX * s}px`;
    canvas.style.height = `${arenaSizeY * s}px`;
    canvas.style.left = `${x}px`;
    canvas.style.top = `${y}px`;
};

const travel = (startX, startY) => {
    const oldKeys = keys;
    restartLevel = () => {
        const index = mapX * 8 + mapY;
        if (index < 0 || index > 63) {
            return;
        }

        keys = new Set(oldKeys);
        tempKeys.clear();

        startLevels(index === outroLevelIndex ? [index] : [index, 0]);

        playerShape = shapes.find(shape => (shape[9] & 31) === 1);
        if (playerShape !== undefined) {
            playerShape[0] = startX;
            playerShape[1] = startY;
        }
    };
    restartLevel();
};

addEventListener('load', () => {
    setupCanvas();

    interlacingPatterns = [0, 250, 300, 200].map(v => createPattern(100, 100, (x, y) =>
        `hsla(${v}, 100%, ${(v > 0) * 10}%, ${.1 + (y % 2) * .2 + Math.random() * .2})`));

    addEventListener('resize', handleResize);
    handleResize();

    travel(0, 0);
    render(0);
});

