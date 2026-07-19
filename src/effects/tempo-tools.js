/**
 * Tempo tools dialog.
 *
 * Beat/tempo analysis of the loaded track (onset detection over the raw
 * samples, grouped into rhythm candidates) with BPM readout and tap-tempo
 * style interaction.
 */

import { AudioEffectModal } from '../ui/modals.js';

const modalName = 'modalfx';
const modalEscapeKey = modalName + 'esc';

///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
function getOfflineAudioContext(channels, sampleRate, duration) {
  return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
    channels,
    duration,
    sampleRate
  );
}
function _normalize_array(data) {
  const newArray = [];
  for (let i = 0; i < data.length; ++i) {
    newArray.push(Math.abs(Math.round((data[i + 1] - data[i]) * 1000)));
  }

  return newArray;
}

function _normalize_array2(data) {
  const newArray = [];
  for (let i = 0; i < data.length; ++i) {
    newArray.push(Math.round(Math.abs(data[i] * 1000)));
  }

  return newArray;
}

function _group_rhythm(data, diffArray) {
  if (diffArray.length <= 1) return;

  let peakMedian = 0;
  for (let i = 0; i < data.length; ++i) {
    peakMedian += data[i];
  }

  peakMedian /= diffArray.length;
  peakMedian -= peakMedian * 0.2;

  let diffMedian = 0;
  for (let i = 0; i < diffArray.length; ++i) {
    diffMedian += diffArray[i];
  }

  diffMedian /= diffArray.length;
  if (diffMedian > 1) diffMedian -= diffMedian * 0.2;

  let existing = 0;
  for (let i = 0; i < diffArray.length; ++i) {
    if (diffArray[i] <= diffMedian) continue;
    ++existing;
  }

  // console.log (" DIFF MEDIAN IS ", diffMedian, "    and total beats: ", existing, "  out of: ", diffArray.length);
  // clean-up the drums array - based on the median.
  // console.log ( JSON.stringify( data ) );
  // console.log ("----------");

  for (let i = 0, j = 0; i < data.length; ++i) {
    if (data[i] !== 0) {
      if (diffArray[j] && diffArray[j] < diffMedian) {
        if (data[i] > peakMedian && diffArray[j] > diffMedian * 0.6) {
          //console.log ( 'ZEROEDC NOOOOT ', i, '    ',  data[i], ' with median ', peakMedian , '  but diff was  ', diffArray[j],  '   yet. ',  diffMedian );
        } else {
          //console.log ( 'ZEROEDC ', i, '    ',  data[i], ' with median ', peakMedian , '  but diff was  ', diffArray[j],  '   yet. ',  diffMedian );
          data[i] = 0;
        }
      }

      ++j;
    }
    // ----
  }

  // console.log( data );
  window.finalArray = data;

  // console.log ( JSON.stringify( data ) );

  // now count distance between peaks
  const distances = {};
  const uniqueDistances = [];
  let firstFound = 0;
  let isFirst = true;
  for (let i = 0; i < data.length - 1; ++i) // #### do not litter the last data
  {
    if (data[i] === 0) {
      ++firstFound;
      continue;
    }

    //if (firstFound < 1 && !isFirst) {
    //	continue;
    //}

    if (isFirst) {
      isFirst = false;
    }

    firstFound = 0;

    const own = [];
    uniqueDistances.push(own);

    // console.log ('----------------------------------');
    // console.log ('COMPUTING DISTANCE OF ' + i + '    value ' + data[i] );

    let interval = 0;
    let total = 12;
    let lastFound = 0;
    for (let j = i + 1; j < 1000; ++j) {
      if (data[j] === 0) {
        ++interval;
        ++lastFound;
        continue;
      } else if (!data[j]) {
        break;
      }

      if (lastFound < 0) {
        continue;
      }
      lastFound = 0;

      if (--total === 0) break;

      own.push(interval);

      // if it exists, immediately reach out for the next one.
      if (!distances[interval]) distances[interval] = 0;
      distances[interval] += 1;

      // console.log ('distance with index ' + j + '    value ' + data[j] + '    is ' + interval );
    }
    // break;
  }

  console.log(uniqueDistances);

  // grab only the big peaks.

  function getmax(a) {
    let m = -Infinity,
      i = 0;
    const n = a.length;

    for (; i != n; ++i) {
      if (a[i] > m) {
        m = a[i];
      }
    }
    return m;
  }

  function getmin(a) {
    let m = Infinity,
      i = 0;
    const n = a.length;

    for (; i != n; ++i) {
      if (a[i] !== 0 && a[i] < m) {
        m = a[i];
      }
    }
    return m;
  }

  const max = getmax(data);
  const min = getmin(data);
  const count = 0;
  const threshold = Math.round((max - min) * 0.3);

  const velocities = [];
  for (let i = 0; i < data.length; ++i) {
    if (data[i] === 0) continue;

    if (data[i] >= max - threshold) {
      velocities.push(3);
    } else if (data[i] >= max - threshold * 2) {
      velocities.push(2);
    } else if (data[i] >= max - threshold * 3) {
      velocities.push(1);
    } else {
      velocities.push(0);
    }
  }

  return [distances, velocities];
}

export function openTempoTools(app) {
  app.fireEvent('RequestSelect', 1);
  const filterId = 'tempo_tools';
  let activeIndex = 1;
  let activeTool = null;

  // ------
  const TempoMetro = function (app, modal) {
    const tool = this;
    tool.app = app;

    let bpm = 120;
    let tick = null;
    let count = 0;
    let time = ((60.0 / bpm) * 1000) >> 0;
    let audioContext = null; // new AudioContext();
    let osc = null;
    let amplitude = null;
    let ready = false;
    let volume = 0.5;
    let accentuate = true;

    let DidStopPlay = null;
    let DidPlay = null;
    let MetronomeAct = null;
    let MetronomeInAct = null;

    tool.Init = function (container) {
      const tool = this;

      tool.element = container;

      _make_ui(tool);
      _make_evs(tool);
    };

    tool.Destroy = function () {
      tool.app.stopListeningFor('DidStopPlay', DidStopPlay);
      tool.app.stopListeningFor('DidPlay', DidPlay);
      tool.app.stopListeningFor('DidStartMetro', MetronomeAct);
      tool.app.stopListeningFor('DidStopMetro', MetronomeInAct);

      DidStopPlay = null;
      DidPlay = null;
      MetronomeAct = null;
      MetronomeInAct = null;

      if (ready) {
        if (tick) {
          clearTimeout(tick);
          tick = null;
        }

        if (audioContext) {
          const now = audioContext.currentTime;
          osc.stop(now);

          amplitude.disconnect();
          osc.disconnect();

          audioContext = null;

          ready = false;
        }
      }

      if (tool.body) {
        tool.body.parentNode.removeChild(tool.body);
        tool.body = null;
      }

      tool.app = null;
    };

    function _make_ui(tool) {
      const drawerElement = document.createElement('div');
      drawerElement.className = 'pk_row';

      drawerElement.innerHTML =
        '<div class="pk_row">' +
        '<label>BPM</label>' +
        '<input type="range" min="20" max="300" class="pk_horiz" step="1" value="120" />' +
        '<span class="pk_val">120</span>' +
        '</div>' +
        '<div class="pk_row">' +
        '<label>Volume</label>' +
        '<input type="range" min="0.0" max="1.0" class="pk_horiz" step="0.1" value="0.5" />' +
        '<span class="pk_val">50%</span>' +
        '</div>' +
        '<div class="pk_row">' +
        '<input type="checkbox" id="xxcjgs" class="pk_check" checked name="metroAccent">' +
        '<label for="xxcjgs">Accentuate metronome click</label></div>' +
        '<div class="pk_row">' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Metronome</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Play Track</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Play Both</a>' +
        '</div>';

      tool.body = drawerElement;
      tool.element.appendChild(drawerElement);
    }

    function _make_evs(tool) {
      const range = tool.body.getElementsByClassName('pk_horiz')[0];
      const span = tool.body.getElementsByClassName('pk_val')[0];

      const range2 = tool.body.getElementsByClassName('pk_horiz')[1];
      const span2 = tool.body.getElementsByClassName('pk_val')[1];

      const checkbox = tool.body.getElementsByClassName('pk_check')[0];

      range.oninput = function () {
        bpm = range.value / 1;
        span.innerHTML = bpm;

        time = ((60.0 / bpm) * 1000) >> 0;
      };

      range2.oninput = function () {
        const value = range2.value / 1;
        volume = value;

        span2.innerHTML = ((value * 100) >> 0) + '%';
      };

      checkbox.oninput = function () {
        accentuate = checkbox.checked;
      };

      const metronomeButton = tool.body.getElementsByClassName('pk_modal_a_bottom')[0];
      const playButton = tool.body.getElementsByClassName('pk_modal_a_bottom')[1];
      const bothButton = tool.body.getElementsByClassName('pk_modal_a_bottom')[2];

      metronomeButton.onclick = function () {
        if (tick) {
          clearTimeout(tick);
          tick = null;
          count = 0;

          tool.app.fireEvent('DidStopMetro');
          return;
        }

        const play = function () {
          tick = setTimeout(function () {
            if (!tick) return;

            if (++count % 4 === 0) _metronome(1);
            else _metronome(0);

            play();
          }, time);
        };

        count = 0;
        if (!ready) _prepare();

        tool.app.fireEvent('DidStartMetro');

        _metronome(1);
        play();
      };

      MetronomeInAct = function () {
        metronomeButton.classList.remove('pk_act');
      };
      MetronomeAct = function () {
        metronomeButton.classList.add('pk_act');
      };
      tool.app.listenFor('DidStartMetro', MetronomeAct);
      tool.app.listenFor('DidStopMetro', MetronomeInAct);

      playButton.onclick = function () {
        if (app.engine.wavesurfer.isPlaying()) {
          tool.app.fireEvent('RequestStop');
        } else {
          tool.app.fireEvent('RequestPlay');
        }
      };
      if (!app.engine.wavesurfer.isReady) {
        playButton.className += ' pk_inact';
        bothButton.className += ' pk_inact';
      }

      if (app.engine.wavesurfer.isPlaying()) {
        playButton.className += ' pk_act';
      }

      DidStopPlay = function () {
        playButton.classList.remove('pk_act');
        playButton.innerText = 'Play Track';
      };
      DidPlay = function () {
        playButton.classList.add('pk_act');
        playButton.innerText = 'Stop Track';
      };
      tool.app.listenFor('DidStopPlay', DidStopPlay);
      tool.app.listenFor('DidPlay', DidPlay);

      bothButton.onclick = function () {
        if (tick) metronomeButton.onclick();
        if (app.engine.wavesurfer.isPlaying()) playButton.onclick();

        setTimeout(function () {
          if (!tick && !app.engine.wavesurfer.isPlaying()) {
            playButton.onclick();
            setTimeout(function () {
              metronomeButton.onclick();
            }, 0);
          }
        }, 66);
      };
    }

    function _metronome(type) {
      if (type === 1 && accentuate) {
        osc.frequency.value = 880.0;
      } else {
        osc.frequency.value = 440.0;
      }

      amplitude.gain.setValueAtTime(amplitude.gain.value, audioContext.currentTime);
      amplitude.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
      amplitude.gain.linearRampToValueAtTime(0.0, audioContext.currentTime + 0.12);
    }

    function _prepare() {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      osc = audioContext.createOscillator();
      amplitude = audioContext.createGain();
      amplitude.gain.value = 0;

      osc.connect(amplitude);
      amplitude.connect(audioContext.destination);

      osc.start(0);

      ready = true;
      // osc.stop( time + 0.05 );
    }
  };

  const TempoTap = function (app, modal) {
    const tool = this;
    tool.app = app;

    let DidStopPlay = null;
    let DidPlay = null;
    let DidSetLoop = null;
    let DidAudioProcess = null;

    tool.Init = function (container) {
      const tool = this;

      tool.element = container;

      _make_ui(tool);
      _make_evs(tool);
    };

    tool.Destroy = function () {
      tool.app.stopListeningFor('DidStopPlay', DidStopPlay);
      tool.app.stopListeningFor('DidPlay', DidPlay);
      tool.app.stopListeningFor('DidSetLoop', DidSetLoop);
      tool.app.stopListeningFor('DidAudioProcess', DidAudioProcess);

      DidStopPlay = null;
      DidPlay = null;
      DidSetLoop = null;
      DidAudioProcess = null;

      tool.app.ui.KeyHandler.removeCallback('tmpTap');

      if (tool.body) {
        tool.body.parentNode.removeChild(tool.body);
        tool.body = null;
      }

      tool.app = null;
    };

    function _make_ui(tool) {
      const drawerElement = document.createElement('div');
      drawerElement.className = 'pk_row';

      // Estimate tempo for selected area button
      drawerElement.innerHTML =
        '<div class="pk_row pk_pgeq_els">' +
        '<span>Average BPM</span>' +
        '<input style="margin-left:2px;min-width:64px;max-width:64px" ' +
        'type="text" class="pk_val pk_gain" value="-">' +
        '</div>' +
        '<div class="pk_row pk_pgeq_els">' +
        '<span>Nearest BPM</span>' +
        '<input style="margin-left:2px;min-width:64px;max-width:64px" ' +
        'type="text" class="pk_val pk_gain" value="-">' +
        '</div>' +
        '<div class="pk_row pk_pgeq_els">' +
        '<span>Timing Taps</span>' +
        '<input style="margin-left:2px;min-width:64px;max-width:64px" ' +
        'type="text" class="pk_val pk_gain" value="-">' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Reset</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Play Track</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Loop</a>' +
        '</div>' +
        '<div><div id="pk_tmp_tap">' +
        '<span style="opacity:0" class="pk_obj2">CLEARED...</span>' +
        '<span class="pk_obj2">STAND BY...</span>' +
        '</div>' +
        '<div id="pk_tmp_tap2" style="position:relative">' +
        '<canvas width="1000" height="200" style="image-rendering:pixelated;width:500px;height:100px;display:block;background:#000"></canvas>' +
        '<span style="z-index:3;background:red;position:absolute;display:block;width:2px;height:100px;' +
        'left:50%;margin-left:-1px;top:0"></span>' +
        '</div></div>' +
        '<div id="pk_tmp_tap3">' +
        '<span style="position:absolute;top:50%;display:block;width:80%;left:10%;font-size:12px;' +
        'margin-top:-20px;user-select:none;text-align:center;pointer-events:none;color:#ccc">' +
        'Tap in this area, or hit [SPACE] rhythmically, to measure BPM.' +
        '</span>' +
        '</div>';

      tool.body = drawerElement;
      tool.element.appendChild(drawerElement);
    }

    function _make_evs(tool) {
      const tapGraph = tool.body.querySelectorAll('#pk_tmp_tap')[0];
      const tapArea = tool.body.querySelectorAll('#pk_tmp_tap3')[0];
      const resetButton = tool.body.getElementsByClassName('pk_modal_a_bottom')[0];
      const playButton = tool.body.getElementsByClassName('pk_modal_a_bottom')[1];
      const loopButton = tool.body.getElementsByClassName('pk_modal_a_bottom')[2];

      const canvas = tool.body.getElementsByTagName('canvas')[0];
      const canvasContext = canvas.getContext('2d', { alpha: false, antialias: false });

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 500 * 2;
      tempCanvas.height = 100 * 2;
      const tempContext = tempCanvas.getContext('2d', { alpha: false, antialias: false });

      canvasContext.imageSmoothingEnabled = true;
      tempContext.imageSmoothingEnabled = true;

      const valueElements = tool.body.getElementsByClassName('pk_val');
      const tapMessage = tapGraph.getElementsByClassName('pk_obj2');
      const tapMessageSecondary = tapArea.getElementsByTagName('span')[0];

      const bpmElement = valueElements[0];
      const bpmElementRound = valueElements[1];
      const bpmElementCount = valueElements[2];
      const resetWait = 3000;

      let timeMillisecond = 0;
      let timeMillisecondPrevious = 0;
      let timeMillisecondFirst = 0;
      let count = 0;
      let bpm = 0;
      let stepsCount = 0;
      let first = true;
      let isPlaying = false;

      const _reset_count = function (force) {
        if (first) {
          tapMessage[1].style.opacity = '0';
        }

        count = 0;
        stepsCount = 0;
        first = true;

        setTimeout(
          function () {
            if (!first) return;

            tapMessage[0].style.opacity = '0.5';
            if (!force) {
              resetButton.className += ' pk_act';
              setTimeout(function () {
                resetButton.classList.remove('pk_act');
              }, 140);
            }

            setTimeout(
              function () {
                if (first) {
                  tapMessage[0].style.opacity = '0';
                  tapMessage[1].style.opacity = '0.5';
                } else {
                  tapMessage[0].style.opacity = '0';
                  tapMessage[1].style.opacity = '0';
                }
              },
              force ? 490 : 874
            );
          },
          force ? 0 : 150
        );

        if (force) {
          bpmElement.value = '-';
          bpmElementRound.value = '-';
          bpmElementCount.value = '-';

          const elements = tapGraph.parentNode.getElementsByClassName('pk_obj');
          let l = elements.length;

          while (l-- > 0) {
            if (elements[l]) {
              elements[l].parentNode.removeChild(elements[l]);
            }
          }
        }
      };

      resetButton.onclick = function () {
        _reset_count(true);
      };

      playButton.onclick = function () {
        if (app.engine.wavesurfer.isPlaying()) {
          tool.app.fireEvent('RequestStop');
        } else {
          tool.app.fireEvent('RequestPlay');
        }
      };

      if (!app.engine.wavesurfer.isReady) {
        playButton.className += ' pk_inact';
        loopButton.className += ' pk_inact';
      }
      if (app.engine.wavesurfer.isPlaying()) {
        playButton.className += ' pk_act';
      }

      DidStopPlay = function () {
        isPlaying = false;
        playButton.classList.remove('pk_act');
        playButton.innerText = 'Play Track';
      };
      DidPlay = function () {
        isPlaying = true;
        playButton.classList.add('pk_act');
        playButton.innerText = 'Stop Track';
      };

      tool.app.listenFor('DidStopPlay', DidStopPlay);
      tool.app.listenFor('DidPlay', DidPlay);

      const oldLeftTime = -999999;
      let oldRightTime = -999999;
      let peaks = [];
      const skipp = false;
      let remaining = 0;

      DidAudioProcess = function () {
        //if (skipp) {
        //	skipp = false;
        //	return ;
        //}
        //skipp = true;

        const wavesurfer = app.engine.wavesurfer;
        const buffer = wavesurfer.backend.buffer;
        const channelData = buffer.getChannelData(0);
        const sample_rate = buffer.sampleRate;

        const currentTime = wavesurfer.getCurrentTime();
        const width = 500;
        const height = 100;
        const halfHeight = (height / 2) * 2;
        let newWidth = width;
        let cachedIndex = 0;
        let pixels = 0;
        let rawPixels = 0;
        const limit = 3;

        const leftTime = currentTime - limit / 2;
        const rightTime = currentTime + limit / 2;
        let quickRender = false;

        let startOffset = (leftTime * sample_rate) >> 0;
        let endOffset = ((leftTime + limit) * sample_rate) >> 0;
        let length = endOffset - startOffset;
        let mod = (length / width) >> 0;

        if (leftTime < oldRightTime) {
          // find pixels
          const diff = rightTime - oldRightTime;
          // pixels = Math.round ( (diff / limit) * width);

          rawPixels = (diff / limit) * width;
          pixels = Math.round(rawPixels);

          rawPixels = ((rawPixels * 1000) >> 0) / 1000;

          if (pixels >= 0) {
            if (pixels === 0) return;

            newWidth = pixels;

            startOffset = (oldRightTime * sample_rate) >> 0;
            endOffset = (rightTime * sample_rate) >> 0;
            length = endOffset - startOffset;
            mod = (length / pixels) >> 0;

            peaks = peaks.slice(pixels * 2);
            cachedIndex = width - pixels;

            quickRender = true;
          }
        }

        oldRightTime = rightTime;

        let max = 0;
        let min = 0;

        for (let i = 0; i < newWidth; ++i) {
          const newOffset = startOffset + mod * i;

          max = 0;
          min = 0;

          if (newOffset >= 0) {
            for (let j = 0; j < mod; j += 3) {
              if (channelData[newOffset + j] > max) {
                max = channelData[newOffset + j];
              } else if (channelData[newOffset + j] < min) {
                min = channelData[newOffset + j];
              }
            }
          }

          peaks[2 * (i + cachedIndex)] = max;
          peaks[2 * (i + cachedIndex) + 1] = min;
        }

        if (quickRender) {
          // var imgdata = canvasContext.getImageData(0, 0, width, height);
          // tempContext.putImageData (imgdata, 0, 0);
          tempContext.drawImage(canvas, 0, 0); //, width, height, 0, 0, width, height);
        }

        canvasContext.fillStyle = '#000';
        // canvasContext.clearRect( 0, 0, width, height );
        canvasContext.fillRect(0, 0, width * 2, height * 2);
        canvasContext.fillStyle = '#99c2c6';

        if (quickRender) {
          let forward = Math.round(rawPixels * 2);
          remaining += forward - rawPixels * 2;
          if (remaining > 1) {
            forward -= 1;
            remaining = 0;
          }

          // canvasContext.translate(-1.5, 0);
          canvasContext.translate(-forward, 0);
          canvasContext.drawImage(tempCanvas, 0, 0); //, width, height, 0, 0, width, height);
          canvasContext.setTransform(1, 0, 0, 1, 0, 0);

          //						canvasContext.drawImage (tempCanvas, 0, 0, width, 100, -(rawPixels.toFixed(1)/1), 0, width, 100);

          canvasContext.beginPath();

          let peak = peaks[(width - pixels - 2) * 2];
          let _h = Math.round(peak * halfHeight);
          canvasContext.moveTo((width - pixels - 2) * 2, halfHeight - _h);

          for (let i = width - pixels - 1; i < width; ++i) {
            peak = peaks[i * 2];
            _h = Math.round(peak * halfHeight);
            canvasContext.lineTo(i * 2, halfHeight - _h);
          }

          for (let i = width - 1; i >= width - pixels - 1; --i) {
            const peak = peaks[i * 2 + 1];
            const _h = Math.round(peak * halfHeight);
            canvasContext.lineTo(i * 2, halfHeight - _h);
          }

          canvasContext.closePath();
          canvasContext.fill();
        } else {
          canvasContext.beginPath();
          canvasContext.moveTo(0, halfHeight);

          for (let i = 0; i < width; ++i) {
            const peak = peaks[i * 2];
            const _h = Math.round(peak * halfHeight);
            canvasContext.lineTo(i * 2, halfHeight - _h);
          }

          for (let i = width - 1; i >= 0; --i) {
            const peak = peaks[i * 2 + 1];
            const _h = Math.round(peak * halfHeight);
            canvasContext.lineTo(i * 2, halfHeight - _h);
          }

          canvasContext.closePath();
          canvasContext.fill();
        }

        //console.log( peaks );
      };

      tool.app.listenFor('DidAudioProcess', DidAudioProcess);

      if (app.engine.wavesurfer.regions.list[0]) {
        if (app.engine.wavesurfer.regions.list[0].loop) loopButton.className += ' pk_act';
      }
      loopButton.onclick = function () {
        tool.app.fireEvent('RequestSetLoop');
      };

      DidSetLoop = function (value) {
        value ? loopButton.classList.add('pk_act') : loopButton.classList.remove('pk_act');
      };
      tool.app.listenFor('DidSetLoop', DidSetLoop);

      tapGraph.parentNode.addEventListener('transitionend', function (e) {
        if (!tapGraph) return;

        const element = e.target;
        if (element.tagName !== 'DIV') return;

        element.parentNode.removeChild(element);
        --stepsCount;

        if (stepsCount === 0) {
          if (isPlaying)
            setTimeout(function () {
              if (stepsCount === 0) _reset_count();
            }, 1100);
          else _reset_count();
        }
      });

      tapArea.onclick = function (ev) {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }

        if (first) {
          first = false;
          tapMessage[1].style.opacity = '0';
        }

        timeMillisecond = Date.now();

        if (timeMillisecond - timeMillisecondPrevious > resetWait) {
          count = 0;
        }

        if (count === 0) {
          timeMillisecondFirst = timeMillisecond;
          count = 1;

          bpmElement.value = 'First Beat';
          bpmElementRound.value = 'First Beat';
          bpmElementCount.value = count;
        } else {
          bpm = (60000 * count) / (timeMillisecond - timeMillisecondFirst);
          ++count;

          bpmElement.value = Math.round(bpm * 100) / 100;
          bpmElementRound.value = Math.round(bpm);
          bpmElementCount.value = count;
        }

        const step = document.createElement('div');
        step.className = 'pk_obj';

        if (isPlaying) {
          canvas.parentNode.appendChild(step);
        } else {
          tapGraph.appendChild(step);
        }
        ++stepsCount;

        tapArea.classList.add('pk_act');

        requestAnimationFrame(function () {
          step.style.transform = 'translate3d(-10%,0,0)';

          setTimeout(function () {
            tapArea.classList.remove('pk_act');
          }, 56);
        });

        timeMillisecondPrevious = timeMillisecond;
      };

      app.ui.KeyHandler.addCallback(
        'tmpTap',
        function (e, o, ev) {
          if (!app.ui.InteractionHandler.check(modalName)) return;

          ev.preventDefault();
          ev.stopPropagation();

          tapArea.onclick(null);
        },
        [32]
      );

      // ---
    }
  };

  // events
  const TempoEstimation = function (app, modal) {
    const tool = this;
    tool.app = app;

    tool.Init = function (container) {
      const tool = this;

      tool.element = container;

      _make_ui(tool);
      _make_evs(tool);
    };

    tool.Destroy = function () {
      if (tool.body) {
        tool.body.parentNode.removeChild(tool.body);
        tool.body = null;
      }

      tool.app = null;
    };

    tool.Est = function (selection) {
      const tool = this;

      const wavesurfer = tool.app.engine.wavesurfer;
      const buffer = wavesurfer.backend.buffer;

      const startingTime = 20.375;
      const endingTime = wavesurfer.getDuration();
      const sample_rate = buffer.sampleRate;

      const lookAhead = 10 * sample_rate;
      const offsetRate = startingTime * sample_rate;
      const durationRate = endingTime * sample_rate;
      const distanceRhythm = {};

      // now run offline
      const audioContext = getOfflineAudioContext(1, buffer.sampleRate, buffer.length);

      const source = audioContext.createBufferSource();
      source.buffer = buffer;

      const filter = audioContext.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 50;
      filter.Q.value = 1.1;
      source.connect(filter);

      const filter2 = audioContext.createBiquadFilter();
      filter2.type = 'lowpass';
      filter2.frequency.value = 140;
      filter2.Q.value = 2.5;
      filter.connect(filter2);
      filter2.connect(audioContext.destination);

      source.start(0);

      const offlineCallback = function (renderedBuffer) {
        _pass(renderedBuffer, offsetRate, durationRate);
      };

      const _pass = function (renderedBuffer, offset, duration) {
        const channelData = renderedBuffer.getChannelData(0);
        const newArray = [];
        const diffArray = [];
        let currval = 0;
        let previousValue = 0;
        let bottom = 100000;
        let top = -100000;
        let foundPick = false;
        let goingUp = false;
        let peakDistance = 0;
        let peakPrevious = 0;
        const nextOffset = offset + lookAhead;

        let trimmedArray = [];
        const modulusCoefficient = Math.round(lookAhead / 200);
        const plusOne = lookAhead + modulusCoefficient;

        for (let i = 0; i < plusOne; ++i) {
          if (i % modulusCoefficient === 0) {
            // look into 50 neighboring entries for higher values.
            let cleanedValue = channelData[offset + i];
            let value = Math.abs(cleanedValue);

            //console.log( "was ", cleanedValue );

            let tempValue = 0;
            for (let uu = 1; uu < 50; ++uu) {
              tempValue = Math.abs(channelData[offset + i - uu]);

              if (tempValue > value) {
                cleanedValue = channelData[offset + i - uu];
                value = Math.abs(cleanedValue);
              }
            }

            for (let uu = 1; uu < 50; ++uu) {
              tempValue = Math.abs(channelData[offset + i + uu]);

              if (tempValue > value) {
                cleanedValue = channelData[offset + i + uu];
                value = Math.abs(cleanedValue);
              }
            }

            //console.log( "added ", cleanedValue );
            //console.log("-----");

            trimmedArray.push(cleanedValue);
          }
        }

        trimmedArray = _normalize_array2(trimmedArray);
        trimmedArray.pop();

        // ------------
        previousValue = trimmedArray[0];
        for (let j = 1; j < trimmedArray.length; ++j) {
          currval = trimmedArray[j];

          if (currval > previousValue) {
            if (!goingUp) {
              if (bottom > previousValue) {
                bottom = previousValue;
                top = -100000;
              }
            }

            goingUp = true;
          } else if (currval < previousValue) {
            if (goingUp) {
              // console.log (":: peak: ", previousValue.toFixed(2)/1, "  bottom: ", bottom.toFixed(2)/1, "  diff: ", Math.abs(previousValue-bottom).toFixed(2)/1 );

              foundPick = true;

              if (peakDistance < 3 && Math.abs(newArray[peakPrevious] - previousValue) < 150) {
                // debugger;

                if (previousValue > newArray[peakPrevious]) {
                  newArray[peakPrevious] = 0;
                  diffArray.pop();
                } else {
                  foundPick = false;
                }
              }

              if (foundPick) {
                diffArray.push(Math.abs(previousValue - bottom));

                peakDistance = 0;
                newArray.push(previousValue);

                peakPrevious = newArray.length - 1;

                if (previousValue > top) {
                  top = previousValue;
                  bottom = 100000;
                }
              }
              // -----
            }

            goingUp = false;
          }

          previousValue = currval;

          if (!foundPick) {
            newArray.push(0);
            //console.log( "ZEROED ", newArray.length - 1 );
            ++peakDistance;
          } else {
            foundPick = false;
          }
        }

        // console.log( trimmedArray );
        // console.log( newArray );
        // window.trimmedArray = trimmedArray;
        // window.newArray = newArray;
        // window.chan = channelData;

        // ----
        const ret = _group_rhythm(newArray, diffArray);
        if (!ret) {
          console.log('something weird happened, error 244');
          return;
        }

        const distances = ret[0];

        // console.log( diffArray );
        // console.log( ret[1] );

        for (const k in distances) {
          if (!distanceRhythm[k]) distanceRhythm[k] = 0;

          distanceRhythm[k] += distances[k];
        }

        console.log(distances);
        // console.log( ' ---------------- ' );
        // console.log ('--------- END OF PASS -------  ',  offset, ' / ', duration);

        if (nextOffset + lookAhead >= duration) {
          // Done...
          console.log(distanceRhythm);
        } else {
          // 	_pass ( renderedBuffer, nextOffset, duration );
        }
        // ----
      };

      const offlineRenderer = audioContext.startRendering();
      if (offlineRenderer)
        offlineRenderer.then(offlineCallback).catch(function (err) {
          console.log('Rendering failed: ' + err);
        });
      else
        audioContext.oncomplete = function (e) {
          offlineCallback(e.renderedBuffer);
        };
    };

    function _make_ui(tool) {
      const drawerElement = document.createElement('div');
      drawerElement.className = 'pk_row';

      // Estimate tempo for selected area button
      drawerElement.innerHTML =
        '<div class="pk_row">' +
        '<input type="radio" class="pk_check" id="tt4" name="xport" checked value="whole">' +
        '<label for="tt4">Whole track</label>' +
        '<input type="radio" class="pk_check" id="tt5" name="xport" value="sel">' +
        '<label class="pk_lblmp3" for="tt5">Estimate for Selection Only</label></div>' +
        '<div class="pk_row">' +
        '<a class="pk_modal_a_bottom" style="margin:0;float:left">Estimate</a>' +
        '</div>';

      tool.body = drawerElement;
      tool.element.appendChild(drawerElement);
    }

    function _make_evs(tool) {
      const buttonEstimate = tool.body.getElementsByTagName('a')[0];
      if (!buttonEstimate) return;

      buttonEstimate.onclick = function () {
        tool.Est && tool.Est(1);
        // tool.app && tool.app.fireEvent ('ReqEst', 1);
      };
    }
  };

  const fxModal = AudioEffectModal(
    {
      id: filterId,
      title: 'Tempo & Rhythm Tools',

      ondestroy: function (modal) {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback(modalEscapeKey);
        activeTool.Destroy();
        activeTool = null;

        app.fireEvent('RequestStop');
      },

      body:
        '<div class="pk_tbs">' +
        '<a class="pk_tbsa pk_inact">Tempo Estimation</a>' +
        '<a class="pk_tbsa">Tempo Tap</a>' +
        '<a class="pk_tbsa">Metronome</a></div>',

      //			buttons: [{
      //				title:'Apply EQ',
      //				className:'pk_modal_a_accpt',
      //				callback: function( modal ) {
      //					modal.Destroy ();
      //				}
      //			}],

      setup: function (modal) {
        const toplinks = modal.bodyElement.getElementsByClassName('pk_tbsa');

        const destroy = function () {
          if (activeTool) {
            activeTool.Destroy();
            activeTool = null;
            toplinks[activeIndex].classList.remove('pk_act');
          }
        };

        const activate = function () {
          // get the active state
          if (activeIndex === 0) {
            // toplinks[0].className += ' pk_act';
            // activeTool = new TempoEstimation ( app, modal );
            return;
          } else if (activeIndex === 1) {
            toplinks[1].className += ' pk_act';
            activeTool = new TempoTap(app, modal);
          } else if (activeIndex === 2) {
            toplinks[2].className += ' pk_act';
            activeTool = new TempoMetro(app, modal);
          }

          activeTool && activeTool.Init(modal.bodyElement);
        };

        //toplinks[0].onclick = function() {
        //	destroy ();
        //	activeIndex = 0;
        //	activate ();
        //};
        toplinks[1].onclick = function () {
          if (activeIndex === 1) return;

          destroy();
          activeIndex = 1;
          activate();
        };
        toplinks[2].onclick = function () {
          if (activeIndex === 2) return;

          destroy();
          activeIndex = 2;
          activate();
        };

        activate();

        // ---
        app.fireEvent('RequestPause');
        app.ui.InteractionHandler.checkAndSet(modalName);
        app.ui.KeyHandler.addCallback(
          modalEscapeKey,
          function (e) {
            if (!app.ui.InteractionHandler.check(modalName)) return;
            modal.Destroy();
          },
          [27]
        );
      },
    },
    app
  );

  fxModal.Show();
  // ------
}
