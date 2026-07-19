/**
 * "New recording" dialog.
 *
 * Lets the user pick an input device and start a fresh recording when no
 * track is loaded yet (sample rate, channels, live level meter).
 */

import { AudioEffectModal } from '../ui/modals.js';

const modalName = 'modalfx';
const modalEscapeKey = modalName + 'esc';

export function openRecordingModal(app) {
  const filterId = 'rec_tools';

  let audioStream = null;
  let audioContext = null;
  let scriptProcessor = null;
  let mediaStreamSource = null;
  let tempBuffers = [];
  let newbuff = null;
  let sampleRate = 44100;
  const bufferSize = 2048; // * 2 ?
  const inputChannelCount = 1;
  const outputChannelCount = 1;

  const stopAudio = function () {
    if (!audioStream) return;

    audioStream.getTracks().forEach(function (stream) {
      stream.stop();
    });

    if (scriptProcessor) {
      scriptProcessor.onaudioprocess = null;
    }
    mediaStreamSource && mediaStreamSource.disconnect();
    scriptProcessor && scriptProcessor.disconnect();
    mediaStreamSource = null;
    audioStream = null;
    audioContext = null;
  };

  const fxModal = AudioEffectModal(
    {
      id: filterId,
      title: 'New Recording',

      ondestroy: function (modal) {
        // destroy audio...
        stopAudio();

        tempBuffers = [];
        newbuff = null;

        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback(modalEscapeKey);

        app.fireEvent('RequestStop');
      },

      body:
        '<div class="pk_rec" style="user-select:none">' +
        '<div class="pk_row">' +
        '<label>Devices:</label>' +
        '<select style="max-width:220px"></select>' +
        '</div>' +
        '<div class="pk_row">' +
        '<div style="float:left"><label>Volume</label>' +
        '<canvas width="200" height="40"></canvas></div>' +
        '<div style="float:left;margin-left:20px;"><label>Time</label>' +
        '<span style="font-size: 24px;line-height: 50px;">0.0</span></div>' +
        '<div style="clear:both;height:10px"></div>' +
        '<div><label>Waveform</label><canvas width="1000" height="200" style="image-rendering:pixelated;width:500px;height:100px;display:block;background:#000"></canvas></div>' +
        '</div>' +
        '<div class="pk_row">' +
        '<a class="pk_tbsa pk_inact" style="text-align: center;">START RECORDING</a>' +
        '<a class="pk_tbsa pk_inact" style="margin-left: 24px; text-align: center;">PAUSE</a>' +
        '</div>' +
        '<div class="pk_row">' +
        '<a class="pk_tbsa" style="float:left;display:none;text-align:center;box-shadow:0 0 7px #3a6b79 inset;">OPEN RECORDING</a>' +
        '<a class="pk_tbsa" style="float:left;display:none;margin-left: 24px; text-align: center;">APPEND TO EXISTING</a>' +
        '</div>' +
        '</div>',

      //			buttons: [{
      //				title:'Apply EQ',
      //				className:'pk_modal_a_accpt',
      //				callback: function( modal ) {
      //					modal.Destroy ();
      //				}
      //			}],

      setup: function (modal) {
        let isReady = false;
        let isActive = false;
        let isPaused = false;
        let hasRecorded = false;

        const mainbtns = modal.bodyElement.getElementsByClassName('pk_tbsa');
        const buttonStart = mainbtns[0];
        const buttonPause = mainbtns[1];
        const buttonOpen = mainbtns[2];
        const buttonAdd = mainbtns[3];
        const timeSpan = modal.bodyElement.getElementsByTagName('span')[0];
        const devicesSelect = modal.bodyElement.getElementsByTagName('select')[0];
        const devices = [];
        const volcanvas = modal.bodyElement.getElementsByTagName('canvas')[0];
        const volumeContext = volcanvas.getContext('2d', { alpha: false, antialias: false });

        const freqcanvas = modal.bodyElement.getElementsByTagName('canvas')[1];
        const frequencyContext = freqcanvas.getContext('2d', { alpha: false, antialias: false });
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 500 * 2;
        tempCanvas.height = 100 * 2;
        const tempContext = tempCanvas.getContext('2d', { alpha: false, antialias: false });

        let firstSkip = 12;
        let currentOffset = 0;
        let tempBufferIndex = -1;
        let volume = 0;
        let currtime = 0;
        let hasDevices = false;

        const oldLeftTime = -999999;
        let oldRightTime = -999999;
        let peaks = [];
        const skipp = false;
        let remaining = 0;
        let debounce = false;

        tempBuffers = [];
        newbuff = null;

        const drawVolume = function () {
          volumeContext.fillStyle = '#000';
          volumeContext.fillRect(0, 0, 200, 40);

          if (!isActive) {
            return;
          }

          volumeContext.fillStyle = 'green';
          volumeContext.fillRect(0, 0, volume * 200 * 1.67, 40);

          timeSpan.innerText = ((currtime * 10) >> 0) / 10;

          window.requestAnimationFrame(drawVolume);
        };

        const fetchBufferFunction = function (ev) {
          if (firstSkip > 0) {
            --firstSkip;
            return;
          }

          if (isPaused) {
            return;
          }

          currentOffset += ev.inputBuffer.duration * sampleRate;
          const floatArray = ev.inputBuffer.getChannelData(0).slice(0);
          tempBuffers[++tempBufferIndex] = floatArray;

          let sum = 0;
          let x;

          for (let i = 0; i < bufferSize; i += 2) {
            x = floatArray[i];
            sum += x * x;
          }

          const rms = Math.sqrt(sum / (bufferSize / 2));
          volume = Math.max(rms, volume * 0.9);

          const currentTime = (tempBufferIndex * bufferSize) / sampleRate;
          currtime = currentTime;
          const width = 500;
          const height = 100;
          const halfHeight = (height / 2) * 2;
          let newWidth = width;
          let cachedIndex = 0;
          let pixels = 0;
          let rawPixels = 0;
          const limit = 3;

          const leftTime = currentTime - limit;
          const rightTime = currentTime; // + (limit/2);
          let quickRender = false;

          let startOffset = (leftTime * sampleRate) >> 0;
          let endOffset = ((leftTime + limit) * sampleRate) >> 0;
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

              startOffset = (oldRightTime * sampleRate) >> 0;
              endOffset = (rightTime * sampleRate) >> 0;
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
                const temp = newOffset + j;
                const temp2 = (temp / 2048) >> 0;
                const temp3 = temp % 2048;

                if (!tempBuffers[temp2]) continue;

                if (tempBuffers[temp2][temp3] > max) {
                  max = tempBuffers[temp2][temp3];
                } else if (tempBuffers[temp2][temp3] < min) {
                  min = tempBuffers[temp2][temp3];
                }
              }
            }

            peaks[2 * (i + cachedIndex)] = max;
            peaks[2 * (i + cachedIndex) + 1] = min;
          }

          if (quickRender) {
            // var imgdata = canvasContext.getImageData(0, 0, width, height);
            // tempContext.putImageData (imgdata, 0, 0);
            tempContext.drawImage(freqcanvas, 0, 0); //, width, height, 0, 0, width, height);
          }

          frequencyContext.fillStyle = '#000';
          // frequencyContext.clearRect( 0, 0, width, height );
          frequencyContext.fillRect(0, 0, width * 2, height * 2);
          frequencyContext.fillStyle = '#99c2c6';

          if (quickRender) {
            let forward = Math.round(rawPixels * 2);
            remaining += forward - rawPixels * 2;
            if (remaining > 1) {
              forward -= 1;
              remaining = 0;
            }

            // frequencyContext.translate(-1.5, 0);
            frequencyContext.translate(-forward, 0);
            frequencyContext.drawImage(tempCanvas, 0, 0); //, width, height, 0, 0, width, height);
            frequencyContext.setTransform(1, 0, 0, 1, 0, 0);

            //						frequencyContext.drawImage (tempCanvas, 0, 0, width, 100, -(rawPixels.toFixed(1)/1), 0, width, 100);

            frequencyContext.beginPath();

            let peak = peaks[(width - pixels - 2) * 2];
            let _h = Math.round(peak * halfHeight);
            frequencyContext.moveTo((width - pixels - 2) * 2, halfHeight - _h);

            for (let i = width - pixels - 1; i < width; ++i) {
              peak = peaks[i * 2];
              _h = Math.round(peak * halfHeight);
              frequencyContext.lineTo(i * 2, halfHeight - _h);
            }

            for (let i = width - 1; i >= width - pixels - 1; --i) {
              const peak = peaks[i * 2 + 1];
              const _h = Math.round(peak * halfHeight);
              frequencyContext.lineTo(i * 2, halfHeight - _h);
            }

            frequencyContext.closePath();
            frequencyContext.fill();
          } else {
            frequencyContext.beginPath();
            frequencyContext.moveTo(0, halfHeight);

            for (let i = 0; i < width; ++i) {
              const peak = peaks[i * 2];
              const _h = Math.round(peak * halfHeight);
              frequencyContext.lineTo(i * 2, halfHeight - _h);
            }

            for (let i = width - 1; i >= 0; --i) {
              const peak = peaks[i * 2 + 1];
              const _h = Math.round(peak * halfHeight);
              frequencyContext.lineTo(i * 2, halfHeight - _h);
            }

            frequencyContext.closePath();
            frequencyContext.fill();
          }
        };

        navigator.mediaDevices
          .getUserMedia({ audio: true, video: false })
          .then(function (_stream) {
            _stream.getTracks().forEach(function (stream) {
              stream.stop();
            });

            enumerate();
          })
          .catch(function (error) {
            alert('no microphone permissions found!');
          });

        const enumerate = function () {
          if (navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices().then((devices) => {
              devices = devices.filter((d) => d.kind === 'audioinput');
              hasDevices = true;

              const length = devices.length;
              for (let i = 0; i < length; ++i) {
                const element = document.createElement('option');
                element.value = devices[i].deviceId;
                element.innerText = devices[i].label;
                devicesSelect.appendChild(element);
              }

              isReady = true;
              buttonStart.classList.remove('pk_inact');
            });
          } else {
            devicesSelect.parentNode.style.display = 'none';
            hasDevices = false;
            isReady = true;
            buttonStart.classList.remove('pk_inact');
          }
        };

        const stop = function () {
          stopAudio();

          isActive = false;
          isPaused = false;
          firstSkip = 10;

          ++tempBufferIndex;
          let k = -1;
          newbuff = new Float32Array(tempBufferIndex * bufferSize);
          for (let i = 0; i < tempBufferIndex; ++i) {
            for (let j = 0; j < bufferSize; ++j) {
              newbuff[++k] = tempBuffers[i][j];
            }
          }

          tempBufferIndex = -1;
          tempBuffers = [];

          // ------
          buttonOpen.style.display = 'block';

          // check to see if we are ready
          if (app.engine.isReady) {
            buttonAdd.style.display = 'block';
          }

          hasRecorded = true;
        };
        // ---

        buttonStart.onclick = function () {
          if (!isReady) return;

          if (debounce) {
            return;
          }

          debounce = true;
          setTimeout(function () {
            debounce = false;
          }, 260);

          // check if recording exists - ask for confirmation
          if (hasRecorded) {
            if (!window.confirm('Are you sure? This will discard the current recording.')) {
              return;
            }
          }

          if (isActive) {
            stop();

            buttonPause.classList.add('pk_inact');
            buttonStart.innerText = 'START RECORDING';
            buttonStart.style.boxShadow = 'none';

            return;
          }

          tempBufferIndex = -1;
          tempBuffers = [];
          newbuff = null;
          volume = 0;

          buttonOpen.style.display = 'none';
          buttonAdd.style.display = 'none';

          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          sampleRate = audioContext.sampleRate;

          let audioConstraint = true;
          if (hasDevices) {
            audioConstraint = { deviceId: devicesSelect.value };
            // devicesSelect.options[devicesSelect.selectedIndex].value;
          }

          navigator.mediaDevices
            .getUserMedia({ audio: audioConstraint })
            .then(function (stream) {
              audioStream = stream;
              mediaStreamSource = audioContext.createMediaStreamSource(stream);

              scriptProcessor = audioContext.createScriptProcessor(
                bufferSize,
                inputChannelCount,
                outputChannelCount
              );

              mediaStreamSource.connect(scriptProcessor);
              scriptProcessor.connect(audioContext.destination);

              isActive = true;
              buttonPause.classList.remove('pk_inact');
              buttonStart.innerText = 'FINISH RECORDING';
              buttonStart.style.boxShadow = '#992222 0px 0px 6px inset';
              scriptProcessor.onaudioprocess = fetchBufferFunction;

              drawVolume();
            })
            .catch(function (error) {});
        };

        buttonPause.onclick = function () {
          if (!isReady) return;
          if (!isActive) return;

          isPaused = !isPaused;

          buttonPause.innerText = isPaused ? 'UN-PAUSE' : 'PAUSE';
        };

        buttonOpen.onclick = function () {
          if (debounce) {
            return;
          }

          debounce = true;
          setTimeout(function () {
            debounce = false;
          }, 150);

          app.engine.wavesurfer.backend._add = 0;
          app.engine.LoadDB({
            sampleRate: sampleRate,
            channelData: [newbuff.buffer],
          });

          // ----
          modal.Destroy();
        };

        buttonAdd.onclick = function () {
          if (debounce) {
            return;
          }

          debounce = true;
          setTimeout(function () {
            debounce = false;
          }, 150);

          app.engine.wavesurfer.backend._add = 1;
          app.engine.LoadDB({
            sampleRate: sampleRate,
            channelData: [newbuff.buffer],
          });

          // ----
          modal.Destroy();
        };

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
}
