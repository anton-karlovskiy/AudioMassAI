/**
 * The audio engine.
 *
 * Owns the wavesurfer instance and translates the app's `Request*` events
 * into actual audio work: loading files/sessions, play/stop/seek, cut/copy/
 * paste, recording, every effect (via audioUtils.FXBank), zoom/pan, channel
 * toggling, undo/redo buffer swaps, and export.
 *
 * The `wavesurfer` build in public/vendor/ is patched by the AudioMass
 * author and calls back into this engine (e.g. `engine.ID3`,
 * `engine.wavesurfer.*`) through the global `PKAudioEditor` — keep those
 * property names stable.
 */

import { AudioUtils } from './audio-utils.js';
import { ID3v2, ID4 } from './id3-reader.js';
import { showToast } from '../ui/toast.js';
import { SimpleModal } from '../ui/modals.js';

export function AudioEngine(app) {
  const engine = this;

  const wavesurfer = WaveSurfer.create({
    container: '#' + 'pk_audio_view_' + app.id,
    scrollParent: false,
    hideScrollbar: true,
    partialRender: false,
    fillParent: false,
    pixelRatio: 1,
    progressColor: 'rgba(128,85,85,0.24)',
    splitChannels: true,
    autoCenter: true,
    height: window.innerHeight - 168,
    plugins: [
      WaveSurfer.regions.create({
        dragSelection: {
          slop: 5,
        },
      }),
    ],
  });
  this.wavesurfer = wavesurfer;

  const audioUtils = new AudioUtils(app, wavesurfer);
  engine.isReady = false;

  this.TrimTo = function (value, decimalPlaces) {
    const powersOfTen = { 0: 1, 1: 10, 2: 100, 3: 1000, 4: 10000, 5: 100000 };
    const multiplier = powersOfTen[decimalPlaces];
    return ((value * multiplier) >> 0) / multiplier;
  };

  // When a track is already loaded, ask whether to replace it or append
  // (choice is stored in wavesurfer.backend._add) before running loadFunc.
  const promptOpenOrAppend = function (loadFunc) {
    new SimpleModal({
      title: 'Open or append',
      className: 'pk_modal_anim pk_fnt10',
      ondestroy: function () {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback('modalTempErr');
      },
      buttons: [
        {
          title: 'OPEN NEW',
          callback: function (modal) {
            wavesurfer.backend._add = 0;
            loadFunc();
            modal.Destroy();
          },
        },
        {
          title: 'ADD IN EXISTING',
          callback: function (modal) {
            wavesurfer.backend._add = 1;
            loadFunc();
            modal.Destroy();
          },
        },
      ],
      body: '<p>Append file to existing track?</p>',
      setup: function (modal) {
        app.ui.InteractionHandler.checkAndSet('modal');
        app.ui.KeyHandler.addCallback(
          'modalTempErr',
          function () {
            modal.Destroy();
          },
          [27]
        );
      },
    }).Show();
  };

  this.LoadArrayBuffer = function (e) {
    const func = function () {
      app.listenFor('RequestCancelModal', function () {
        wavesurfer.cancelBufferLoad();
        if (wavesurfer.arraybuffer) engine.isReady = true;

        app.fireEvent('RequestResize');
        setTimeout(function () {
          app.fireEvent('DidDownloadFile');
        }, 12);
        app.stopListeningForName('RequestCancelModal');

        showToast('Canceled Loading', 1350);
      });

      app.fireEvent('RequestZoomUI', 0);

      app.fireEvent('WillDownloadFile');
      engine.isReady = false;
      wavesurfer.loadBlob(e);
      app.fireEvent('DidUnloadFile');

      wavesurfer.regions && wavesurfer.regions.clear();
    };

    if (engine.isReady) {
      promptOpenOrAppend(func);
      return;
    }

    wavesurfer.backend._add = 0;
    func();
    // ---
  };

  this.LoadDB = function (e) {
    const newBuffer = wavesurfer.backend.ac.createBuffer(
      e.channelData.length,
      e.channelData[0].byteLength / 4,
      e.sampleRate
    );

    for (let i = 0; i < e.channelData.length; ++i) {
      const channelSamples = new Float32Array(e.channelData[i]);

      if (newBuffer.copyToChannel) {
        newBuffer.copyToChannel(channelSamples, i, 0);
      } else {
        const channel = newBuffer.getChannelData(i);
        channel.set(channelSamples);
      }
    }

    const append = wavesurfer.backend._add;
    const oldDuration = wavesurfer.getDuration();

    wavesurfer.loadDecodedBuffer(newBuffer);
    computeActiveChannels();
    const newDuration = wavesurfer.getDuration();
    app.fireEvent('DidUpdateLen', newDuration);

    if (!append) app.fireEvent('RequestSeekTo', 0);
    else {
      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: oldDuration,
        end: newDuration,
        id: 't',
      });
    }
    // --------
  };

  this.LoadFile = function (e) {
    if (e.files.length > 0) {
      if (
        e.files[0].type == 'audio/mp3' ||
        e.files[0].type == 'audio/wave' ||
        e.files[0].type == 'audio/mpeg' ||
        e.files[0].type == 'audio/aiff' ||
        e.files[0].type == 'audio/flac' ||
        e.files[0].type == 'audio/ogg'
      ) {
        const func = function () {
          app.listenFor('RequestCancelModal', function () {
            wavesurfer.cancelBufferLoad();
            audioUtils.DownloadFileCancel();
            if (wavesurfer.arraybuffer) engine.isReady = true;

            app.fireEvent('RequestResize');
            setTimeout(function () {
              app.fireEvent('DidDownloadFile');
            }, 12);
            app.stopListeningForName('RequestCancelModal');

            showToast('Canceled Loading', 1350);
          });

          app.fireEvent('WillDownloadFile');
          engine.isReady = false;
          wavesurfer.loadBlob(e.files[0]);
          app.fireEvent('DidUnloadFile');
          wavesurfer.regions && wavesurfer.regions.clear();
        };

        if (engine.isReady) {
          promptOpenOrAppend(func);
          return;
        }

        wavesurfer.backend._add = 0;
        func();

        // ----
      }
    }
  };

  this.DownloadFile = function (name, format, kbps, selection, stereo) {
    if (!engine.isReady) return;

    app.fireEvent('WillDownloadFile');

    app.listenFor('RequestCancelModal', function () {
      audioUtils.DownloadFileCancel();
      if (wavesurfer.arraybuffer) engine.isReady = true;

      app.fireEvent('RequestResize');
      setTimeout(function () {
        app.fireEvent('DidDownloadFile');
      }, 12);
      app.stopListeningForName('RequestCancelModal');
    });

    setTimeout(function () {
      audioUtils.DownloadFile(name, format, kbps, selection, stereo, function (value) {
        if (value === 'done') {
          setTimeout(function () {
            app.fireEvent('DidDownloadFile');
          }, 12);
          app.stopListeningForName('RequestCancelModal');
        } else app.fireEvent('DidProgressModal', value);
      });
    }, 220);
  };
  this.LoadSample = function () {
    app.fireEvent('WillDownloadFile');

    setTimeout(function () {
      app.listenFor('RequestCancelModal', function () {
        if (wavesurfer.cancelAjax()) {
          if (wavesurfer.arraybuffer) engine.isReady = true;

          app.fireEvent('RequestResize');
          setTimeout(function () {
            app.fireEvent('DidDownloadFile');
          }, 12);
          app.stopListeningForName('RequestCancelModal');

          showToast('Canceled Loading', 1380);
        }
      });

      app.fireEvent('RequestZoomUI', 0);
      engine.isReady = false;
      wavesurfer.load('/samples/test.mp3');
    }, 180);
  };
  this.LoadURL = function (url) {
    app.fireEvent('WillDownloadFile');

    setTimeout(function () {
      app.listenFor('RequestCancelModal', function () {
        if (wavesurfer.cancelAjax()) {
          if (wavesurfer.arraybuffer) engine.isReady = true;

          app.fireEvent('RequestResize');
          setTimeout(function () {
            app.fireEvent('DidDownloadFile');
          }, 12);
          app.stopListeningForName('RequestCancelModal');

          showToast('Canceled Loading', 1350);
        }
      });

      wavesurfer.load(url);
      engine.isReady = false;
    }, 180);
  };

  app.listenFor('RequestResize', function () {
    wavesurfer.fireEvent('resize');

    const h = window.innerHeight;
    let bottom = 0;

    if (app.ui && app.ui.BarBtm) {
      bottom = app.ui.BarBtm.on ? app.ui.BarBtm.height : 0;
    }

    wavesurfer.setHeight((h < 280 ? 280 : h) - 168 - bottom);
    // app.fireEvent ('DidResize');
  });

  wavesurfer.on('ready', function () {
    app.fireEvent('DidReadyFire');

    if (wavesurfer.backend._add) {
      wavesurfer.backend._add = 0;
    }

    if (engine.isReady) return;
    engine.isReady = true;

    // dirty hack for default message
    let dirtymsg = document.getElementsByClassName('pk_tmpMsg');
    if (dirtymsg.length > 0) {
      dirtymsg = dirtymsg[0];
      dirtymsg.parentNode.removeChild(dirtymsg);
    }

    copyBuffer = null;
    app.fireEvent('DidDownloadFile');

    app.fireEvent('StateRequestClearAll');
    app.fireEvent('DidLoadFile');
    app.fireEvent('DidUpdateLen', wavesurfer.getDuration());
    app.fireEvent('DidSetClipboard', 0);
    app.fireEvent('RequestSeekTo', 0);

    app.fireEvent('RequestResize');
    wavesurfer.getWaveEl().style.opacity = '1';

    // loaded successfully
    app.stopListeningForName('RequestCancelModal');

    setTimeout(function () {
      showToast('Loaded Successfully');
    }, 180);

    // check if the audio file is mono or stereo and rebuild both UI and audio engine accordingly...
    if (wavesurfer.backend.buffer.numberOfChannels === 1) {
      wavesurfer.backend.SetNumberOfChannels(1);
      wavesurfer.ActiveChannels = [1];
      wavesurfer.drawer.params.ActiveChannels = wavesurfer.ActiveChannels;
      wavesurfer.SelectedChannelsLen = 1;

      app.element.classList.add('pk_mono');
    } else if (wavesurfer.backend.buffer.numberOfChannels === 2) {
      wavesurfer.backend.SetNumberOfChannels(2);
      wavesurfer.ActiveChannels = [1, 1];
      wavesurfer.drawer.params.ActiveChannels = wavesurfer.ActiveChannels;
      wavesurfer.SelectedChannelsLen = 2;

      app.element.classList.remove('pk_mono');
    }
    // ---
  });

  wavesurfer.on('pause', function () {
    app.fireEvent('DidStopPlay');
  });
  wavesurfer.on('play', function () {
    app.fireEvent('DidPlay');
  });
  wavesurfer.on('seek', function (where, stamp) {
    const time = wavesurfer.getCurrentTime();
    const loudness = wavesurfer.getLoudness();

    app.fireEvent('DidAudioProcess', [time, loudness, stamp]);
  });

  app.listenFor('RequestStop', function (value) {
    if (app.recorder.isActive()) {
      app.fireEvent('RequestActionRecordStop');
      return false;
    }

    const region = wavesurfer.regions.list[0];
    if (region) wavesurfer.ActiveMarker = region.start / wavesurfer.getDuration();

    wavesurfer.stop(value);
  });
  app.listenFor('RequestPlay', function (x) {
    // unique listener
    if (engine.inFx) return;

    app.fireEvent('RequestActionRecordStop');

    if (!x && wavesurfer.isPlaying()) {
      wavesurfer.stop();
      wavesurfer.play();
    } else {
      if (!app.recorder.isActive()) {
        wavesurfer.play();
      } else {
        setTimeout(function () {
          if (!app.recorder.isActive() && !x && !wavesurfer.isPlaying()) {
            wavesurfer.play();
          }
        }, 220);
      }
    }
  });
  app.listenFor('RequestPause', function () {
    app.fireEvent('RequestActionRecordStop');
    wavesurfer.pause();
  });

  app.listenFor('RequestSetLoop', function () {
    if (!engine.isReady) return;

    let skipSeek = false;

    if (wavesurfer.regions.list[0]) {
      if (wavesurfer.regions.list[0].loop) wavesurfer.regions.list[0].loop = false;
      else wavesurfer.regions.list[0].loop = true;
    } else {
      skipSeek = true;
      wavesurfer.regions.add({
        start: 0.01,
        end: wavesurfer.getDuration() - 0.01,
        id: 't',
      });
      wavesurfer.regions.list[0].loop = true;
    }

    const willLoop = wavesurfer.regions.list[0].loop;
    app.fireEvent('DidSetLoop', willLoop);
    if (willLoop && !skipSeek /*&& wavesurfer.isPlaying ()*/) {
      app.fireEvent('RequestSeekTo', wavesurfer.regions.list[0].start / wavesurfer.getDuration());
    }
  });
  app.listenFor('RequestSkipBack', function (value) {
    wavesurfer.skipBackward(value);
  });
  app.listenFor('RequestSkipFront', function (value) {
    wavesurfer.skipForward(value);
  });
  app.listenFor('RequestSeekTo', function (value) {
    if (value > 1.0) return;
    wavesurfer.seekTo(value);
  });
  app.ui.KeyHandler.addCallback(
    'zkA',
    function (key, m, e) {
      e.preventDefault();
    },
    [38]
  );
  app.ui.KeyHandler.addCallback(
    'zkD',
    function (key, m, e) {
      e.preventDefault();
    },
    [40]
  );
  app.ui.KeyHandler.addSingleCallback(
    'KeyPlayPause',
    function (e) {
      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();
      //e.stopPropagation();
    },
    32
  );

  app.ui.KeyHandler.addSingleCallback(
    'KeyTilda',
    function (e) {
      const openElement = app.ui.TopHeader.getOpenElement();

      if (openElement) {
        app.ui.TopHeader.closeMenu();
        e.preventDefault();
        return;
      }

      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();

      app.ui.TopHeader.openMenu(-1);
    },
    96
  );

  app.ui.KeyHandler.addSingleCallback(
    'KeyQ',
    function (e) {
      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();
      app.fireEvent('RequestDeselect');
    },
    113
  );

  app.ui.KeyHandler.addCallback(
    'KeyShiftSpace' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;
      wavesurfer.playPause();
    },
    [16, 32]
  );
  app.ui.KeyHandler.addCallback(
    'KeySpace' + app.id,
    function (key, map) {
      if (app.ui.InteractionHandler.on) return;
      if (map[16] === 1) return;

      if (wavesurfer.isPlaying()) {
        app.fireEvent('RequestStop');
      } else {
        app.fireEvent('RequestPlay');
      }
    },
    [32]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftCopy' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionCopy');
    },
    [16, 67]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftUndo' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('StateRequestUndo');
    },
    [16, 90]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftRedo' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('StateRequestRedo');
    },
    [16, 89]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftPaste' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionPaste');
    },
    [16, 86]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftCut' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionCut', 1);
    },
    [16, 88]
  );
  app.ui.KeyHandler.addCallback(
    'KeyDel' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionCut');
    },
    [8]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftSelectAll' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;
      app.fireEvent('RequestSelect');
    },
    [16, 65]
  );
  app.ui.KeyHandler.addSingleCallback(
    'KeyLoopToggle',
    function (e) {
      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();
      e.stopPropagation();
      app.fireEvent('RequestSetLoop');
    },
    108
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftSave' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      // fire event to open the save menu
      document.querySelector('.pk_opt[data-id="dl"]').click();
    },
    [16, 83]
  );

  wavesurfer.container.addEventListener(
    'mousedown',
    function (e) {
      if (e.which === 3) {
        // wavesurfer.regions.clear();
        e.preventDefault();
      }
    },
    false
  );

  // select all... ####
  app.listenFor('RequestSelect', function (ifnot, custom) {
    if (!engine.isReady) return;

    if (ifnot) {
      const region = wavesurfer.regions.list[0];
      if (region) return false;
    }

    if (!custom) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });

      if (!wavesurfer.isPlaying())
        setTimeout(function () {
          app.fireEvent('RequestSeekTo', 0.0);
        }, 0);
    } else {
      wavesurfer.regions.add({
        start: custom[0],
        end: custom[1],
        id: 't',
      });
      if (!wavesurfer.isPlaying())
        setTimeout(function () {
          app.fireEvent('RequestSeekTo', custom[0] / wavesurfer.getDuration());
        }, 0);
    }
  });
  app.listenFor('RequestDeselect', function () {
    wavesurfer.regions.clear();
    app.fireEvent('RequestSeekTo', 0);
  });

  (function () {
    let input = null;
    app.listenFor('RequestLoadLocalFile', function () {
      wavesurfer.pause();

      if (input) {
        input.parentNode.removeChild(input);
        input.onchange = null;
      }

      input = document.createElement('input');
      input.setAttribute('type', 'file');
      input.setAttribute('accept', 'audio/*');
      input.className = 'pk_inpfile';
      input.onchange = function () {
        engine.LoadFile(input);

        input.parentNode.removeChild(input);
        input.onchange = null;
        input = null;
      };
      app.element.appendChild(input); // maybe not append?

      input.click();
    });
  })();

  wavesurfer.container.addEventListener(
    'dblclick',
    function (e) {
      app.fireEvent('RequestSelect', false, [
        wavesurfer.LeftProgress,
        wavesurfer.LeftProgress + wavesurfer.VisibleDuration,
      ]);
    },
    false
  );
  wavesurfer.container.addEventListener(
    'click',
    function (e) {
      if (!engine.isReady) return;

      if (!app.ui.KeyHandler.keyMap[16]) wavesurfer.regions.clear();
    },
    false
  );

  let resizeDebounce = null;
  window.addEventListener(
    'resize',
    function () {
      if (!wavesurfer) return;

      if (resizeDebounce) {
        clearTimeout(resizeDebounce);
      }

      resizeDebounce = setTimeout(function () {
        //requestAnimationFrame(function (){
        app.fireEvent('RequestResize');

        if (app.isMobile) {
          window.scrollTo(0, 200);
        }
        //});
      }, 84);
    },
    false
  );

  //		window.addEventListener ('orientationchange', function () {
  //  			app.fireEvent ('RequestResize');
  //		});

  window.addEventListener('beforeunload', function (e) {
    app.fireEvent('WillUnload');

    // e.preventDefault();
    // e.returnValue = '';
  });

  wavesurfer.on('error', function (errorMessage) {
    // if loading - cancel loading
    setTimeout(function () {
      app.fireEvent('DidDownloadFile'); // just hides the interface
      engine.isReady = false;
    }, 20);

    app.fireEvent('ShowError', errorMessage);
  });

  wavesurfer.on('audioprocess', function (time, stamp) {
    // var time = wavesurfer.getCurrentTime();
    const loudness = wavesurfer.getLoudness();

    app.fireEvent('DidAudioProcess', [time, loudness, stamp], wavesurfer.backend.FreqArr);
  });
  wavesurfer.on('DidZoom', function (e) {
    app.fireEvent(
      'DidZoom',
      [
        wavesurfer.ZoomFactor,
        (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
        wavesurfer.params.verticalZoom,
      ],
      e
    );
  });
  wavesurfer.on('region-removed', function () {
    app.fireEvent('DidSetLoop', 0);
    app.fireEvent('DidDestroyRegion');
  });
  app.listenFor('RequestRegionClear', function () {
    wavesurfer.regions.clear();
  });
  app.listenFor('RequestRegionSet', function (start, end) {
    if (!engine.isReady) return;

    if (!start) {
      start = wavesurfer.LeftProgress / 1;
    }
    if (!end) {
      end = (wavesurfer.LeftProgress + wavesurfer.VisibleDuration) / 1;
    }

    // add a region where the paste happened
    wavesurfer.regions.clear();
    wavesurfer.regions.add({
      start: start,
      end: end,
      id: 't',
    });
  });

  let copyBuffer = null;

  this.GetCopyBuff = function () {
    return copyBuffer;
  };

  this.GetSel = function () {
    const region = wavesurfer.regions.list[0];
    if (!region) return false;

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    const copybuffer = audioUtils.Copy(start, end);

    return copybuffer;
  };

  this.PlayBuff = function (bufferArray, channelCount, sampleRate, providedAudioContext) {
    let audioContext;

    if (providedAudioContext) audioContext = providedAudioContext;
    else audioContext = new (window.AudioContext || window.webkitAudioContext)();

    if (!audioContext) return;

    const bytes = bufferArray[0].byteLength / 4;

    const buffer = audioContext.createBuffer(channelCount, bytes, sampleRate);

    for (let i = 0; i < channelCount; ++i) {
      buffer.getChannelData(i).set(new Float32Array(bufferArray[i]));
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    source.connect(audioContext.destination);
    source.start(0);

    return source;
  };

  this.GetFX = function (fx, value) {
    return audioUtils.FXBank[fx](value);
  };

  this.GetWave = function (buffer, ww, hh, offset, llen, cnv, cx) {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const peaks = [];
    const currentTime = 0;
    const width = ww || 200;
    const height = hh || 80;
    const halfHeight = height / 2;
    const newWidth = width;
    const pixels = 0;
    const rawPixels = 0;

    const startOffset = offset || 0;
    const endOffset = llen || (buffer.duration * sampleRate) >> 0;
    const length = endOffset - startOffset;
    const mod = (length / width) >> 0;

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

      peaks[2 * i] = max;
      peaks[2 * i + 1] = min;
    }

    let canvas = cnv;
    let canvasContext = cx;

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      canvasContext = canvas.getContext('2d', { alpha: false, antialias: false });
    }

    canvasContext.fillStyle = '#000';
    canvasContext.fillRect(0, 0, width, height);
    canvasContext.fillStyle = '#99c2c6';

    canvasContext.beginPath();
    canvasContext.moveTo(0, halfHeight);

    for (let i = 0; i < width; ++i) {
      const peak = peaks[i * 2];
      const _h = Math.round(peak * halfHeight);
      canvasContext.lineTo(i, halfHeight - _h);
    }

    for (let i = width - 1; i >= 0; --i) {
      const peak = peaks[i * 2 + 1];
      const _h = Math.round(peak * halfHeight);
      canvasContext.lineTo(i, halfHeight - _h);
    }

    canvasContext.closePath();
    canvasContext.fill();

    return canvas.toDataURL('image/jpeg', 0.56);
    // ---
  };

  app.listenFor('RequestActionCut', function (useClipboard) {
    if (!engine.isReady) return;

    const region = wavesurfer.regions.list[0];
    if (!region) return false;

    app.fireEvent('RequestPause');

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    app.fireEvent('StateRequestPush', {
      desc: useClipboard ? 'Cut' : 'Delete',
      meta: [start, end],
      data: wavesurfer.backend.buffer,
    });

    const cutbuffer = audioUtils.Trim(start, end);
    wavesurfer.regions.clear();

    let tmp = start - 0.03;
    if (tmp < 0) tmp = 0;

    app.fireEvent('RequestSeekTo', tmp / wavesurfer.getDuration());

    if (useClipboard) {
      copyBuffer = cutbuffer;

      app.fireEvent('DidSetClipboard', 1);
      app.fireEvent('DidCut', cutbuffer);

      showToast(
        'Cut :: ' + engine.TrimTo(start, 2) + ' to ' + engine.TrimTo(start / 1 + end / 1, 2),
        1100
      );
    } else {
      showToast(
        'Delete :: ' + engine.TrimTo(start, 2) + ' to ' + engine.TrimTo(start / 1 + end / 1, 2),
        1100
      );
    }
  });

  app.listenFor('RequestActionCopy', function () {
    if (!engine.isReady) return;

    const region = wavesurfer.regions.list[0];
    if (!region) return false;

    app.fireEvent('RequestPause');

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    const copybuffer = audioUtils.Copy(start, end);

    copyBuffer = copybuffer;
    app.fireEvent('DidSetClipboard', 1);
    app.fireEvent('DidCopy', copybuffer);

    showToast('Copied range');
  });

  app.listenFor('RequestActionSilence', function (offset, silenceDuration) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    const region = wavesurfer.regions.list[0];
    let dims = [0, 0];

    if (!silenceDuration || silenceDuration < 0) silenceDuration = 1;

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Silence',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    const start = offset;
    const end = silenceDuration;

    handleStateInline(start, end);
    dims = audioUtils.Insert(offset, audioUtils.MakeSilence(silenceDuration));

    // add a region where the paste happened
    wavesurfer.regions.clear();
    wavesurfer.regions.add({
      start: dims[0],
      end: dims[1],
      id: 't',
    });

    app.fireEvent('RequestSeekTo', dims[0] / wavesurfer.getDuration());

    showToast('Inserted Silence');
  });

  app.listenFor('RequestActionPaste', function () {
    if (!engine.isReady) return;
    if (!copyBuffer) return false;

    app.fireEvent('RequestPause');

    const region = wavesurfer.regions.list[0];
    let dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Paste',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      const offset = engine.TrimTo(wavesurfer.getCurrentTime(), 3);

      handleStateInline(offset);
      dims = audioUtils.Insert(offset, copyBuffer);
    } else {
      const start = engine.TrimTo(region.start, 3);
      const end = engine.TrimTo(region.end - region.start, 3);

      handleStateInline(start, end);

      dims = audioUtils.Replace(start, end, copyBuffer);
    }

    // add a region where the paste happened
    wavesurfer.regions.clear();
    wavesurfer.regions.add({
      start: dims[0],
      end: dims[1],
      id: 't',
    });

    let newSeek = 0;
    if (wavesurfer.getDuration() > 0.0001) {
      newSeek = dims[0] / wavesurfer.getDuration();
    }
    app.fireEvent('RequestSeekTo', newSeek);

    showToast('Paste to ' + dims[0].toFixed(2), 982);
  });

  let recordTogglePending = false;
  app.listenFor('RequestActionRecordToggle', function () {
    if (!engine.isReady) {
      // if not ready then bring up the new recording toggle!
      app.fireEvent('RequestActionNewRec');

      return;
    }

    if (app.recorder.isActive()) {
      app.fireEvent('RequestActionRecordStop');
    } else {
      // skipping the sounds of keyboard
      if (recordTogglePending) return;

      recordTogglePending = true;
      setTimeout(function () {
        app.fireEvent('RequestActionRecordStart');
        setTimeout(function () {
          recordTogglePending = false;
        }, 50);
      }, 26);
    }
  });

  app.listenFor('RequestActionRecordStop', function () {
    if (!engine.isReady) return;
    if (!app.recorder.isActive()) return false;

    app.recorder.stop();
  });

  app.listenFor('RequestActionRecordStart', function () {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    if (app.recorder.isActive()) return false;

    const position = wavesurfer.getCurrentTime() * wavesurfer.backend.buffer.sampleRate;
    app.recorder.start(
      position,
      function (offset, buffers) {
        // app.fireEvent ('RequestPause');
        function handleStateInline(start, end) {
          app.fireEvent('StateRequestPush', {
            desc: 'Record Audio',
            meta: [start, end],
            data: wavesurfer.backend.buffer,
          });
        }

        // fire did record event!
        app.fireEvent('DidActionRecordStop', !!buffers);
        if (!buffers) {
          return;
        }

        handleStateInline(offset);
        const dims = audioUtils.ReplaceFloatArrays(offset, buffers);

        // add a region where the paste happened
        wavesurfer.regions.clear();
        wavesurfer.regions.add({
          start: dims[0],
          end: dims[1],
          id: 't',
        });

        app.fireEvent('RequestSeekTo', dims[0] / wavesurfer.getDuration());
        showToast('Recorded Audio ' + dims[0].toFixed(2), 982);
      },
      function () {
        // on start
        app.fireEvent('DidActionRecordStart');
      }
    );

    // --- ending offset is song full duration...
    // if we have a selected area - mark that one as the end
    const region = wavesurfer.regions.list[0];
    if (region) app.recorder.setEndingOffset(region.end * wavesurfer.backend.buffer.sampleRate);
    else
      app.recorder.setEndingOffset(wavesurfer.getDuration() * wavesurfer.backend.buffer.sampleRate);
  });

  app.listenFor('RequestActionFX_PREVIEW_HardLimit', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.HardLimit(value));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_HardLimit', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Hard Limit (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.HardLimit(value));

    showToast('Applied Hard Limit (fx)');
  });

  app.listenFor('RequestActionFX_PARAMEQ', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Parametric EQ (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.ParametricEQ(value));

    showToast('Applied Parametric EQ (fx)');
  });
  app.listenFor('RequestActionFX_PREVIEW_PARAMEQ', function (value) {
    if (!engine.isReady || !value) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.ParametricEQ(value));
    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_PREVIEW_DISTORT', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Distortion(value));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_DISTORT', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Distortion (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Distortion(value));

    showToast('Applied Distortion (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_DELAY', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Delay(value));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_DELAY', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Delay (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Delay(value));

    showToast('Applied Delay (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_REVERB', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Reverb(value));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_REVERB', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Reverb (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Reverb(value));

    showToast('Applied Reverb (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_COMPRESSOR', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Compressor(value));
    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_Compressor', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Compressor (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Compressor(value));

    showToast('Applied Compressor (fx)');
  });
  app.listenFor('RequestActionFX_Normalize', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Normalize ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Normalize(value));

    showToast('Applied Normalize');
  });

  app.listenFor('RequestActionFX_Invert', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Invert ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Invert());

    showToast('Applied Invert');
  });

  app.listenFor('RequestActionFX_RemSil', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Remove Silence ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    let start = engine.TrimTo(region.start, 3);
    let end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);

    const originalBuffer = wavesurfer.backend.buffer;
    const silenceArray = [];
    const silenceOffset = 210;
    const volumeOffset = 56;
    let count = 0;
    let inverseCount = 0;
    start = 0;
    end = 0;
    let found = false;
    const jump = 500;

    for (let i = 0; i < 1; ++i) {
      const channel = originalBuffer.getChannelData(i);

      for (let j = 0; j < channel.length; ++j) {
        if (Math.abs(channel[j]) < 0.000368) {
          if (count === 0) {
            if (j > jump) start = j - jump;
            else start = j;
          }
          if (++count > silenceOffset) {
            inverseCount = 0;
            end = j;
            found = true;
          }
        } else {
          if (found) {
            if (++inverseCount > volumeOffset) {
              silenceArray.push([start, end]);
              j += jump;

              count = 0;
              start = 0;
              end = 0;
              found = false;
              inverseCount = 0;
            } else {
              end = j;
            }
          } else {
            count = 0;
            start = 0;
            end = 0;
            found = false;
            inverseCount = 0;
          }
        }
      }

      if (found) {
        silenceArray.push([start, end]);
      }
    }

    if (silenceArray.length > 0) {
      let reduce = 0;
      for (let i = 0; i < silenceArray.length; ++i) {
        reduce += silenceArray[i][1] - silenceArray[i][0];
      }

      const emptySegment = wavesurfer.backend.ac.createBuffer(
        originalBuffer.numberOfChannels,
        originalBuffer.length - reduce,
        originalBuffer.sampleRate
      );

      for (let i = 0; i < originalBuffer.numberOfChannels; ++i) {
        const channel = originalBuffer.getChannelData(i);
        const newChannel = emptySegment.getChannelData(i);

        let silenceOffset = 0;
        let o = 0;
        let currentSilence = silenceArray[o];
        let currentSilenceStart = currentSilence[0];
        let currentSilenceEnd = currentSilence[1];
        let h = 0;
        const useOld = false;
        const oldHeight = 0;

        for (let j = 0; j < newChannel.length; ++j) {
          h = j + silenceOffset;
          if (h > currentSilenceStart && h < currentSilenceEnd) {
            if (h < currentSilenceStart + jump) {
              const perc = (jump - (h - currentSilenceStart)) / jump;
              newChannel[j] = channel[h] * perc; // / (h - currentSilenceStart));
              newChannel[j] +=
                (1 - perc) *
                channel[j + (silenceOffset + (currentSilenceEnd - currentSilenceStart))];

              continue;
            } else {
              silenceOffset = silenceOffset + (currentSilenceEnd - currentSilenceStart);
              currentSilence = silenceArray[++o];
              if (currentSilence) {
                currentSilenceStart = currentSilence[0];
                currentSilenceEnd = currentSilence[1];
              }
              h = j + silenceOffset;
            }
          }

          newChannel[j] = channel[h];
        }
      }

      audioUtils.FullReplace(emptySegment);
    }

    setTimeout(function () {
      wavesurfer.drawBuffer();
    }, 40);

    showToast('Applied :: Remove Silence');
  });

  const computeActiveChannels = function () {
    const buff = wavesurfer.backend.buffer;
    const channelCount = buff.numberOfChannels;

    if (channelCount === 1) {
      wavesurfer.ActiveChannels = [1];
      app.element.classList.add('pk_mono');
    } else {
      wavesurfer.ActiveChannels = [1, 1];
      app.element.classList.remove('pk_mono');
    }

    wavesurfer.drawer.params.ActiveChannels = wavesurfer.ActiveChannels;
    wavesurfer.SelectedChannelsLen = channelCount;
  };

  app.listenFor('RequestActionFX_Flip', function (value, val2) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    const start = 0;
    const end = wavesurfer.getDuration();

    function handleStateInline(start, end, title, cb) {
      app.fireEvent('StateRequestPush', {
        desc: title,
        meta: [start, end],
        data: wavesurfer.backend.buffer,
        cb: cb,
      });
    }

    if (value === 'flip') {
      handleStateInline(start, end, 'Flip Channels');
      audioUtils.FX(start, end, audioUtils.FXBank.Flip(value));
    } else if (value === 'stereo') {
      handleStateInline(start, end, 'Make Stereo', function () {
        computeActiveChannels();
      });

      const originalBuffer = wavesurfer.backend.buffer;
      const emptySegment = wavesurfer.backend.ac.createBuffer(
        2,
        originalBuffer.length,
        originalBuffer.sampleRate
      );
      emptySegment.getChannelData(0).set(originalBuffer.getChannelData(0));
      emptySegment.getChannelData(1).set(originalBuffer.getChannelData(0));

      audioUtils.FullReplace(emptySegment);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: end,
        id: 't',
      });

      computeActiveChannels();

      app.fireEvent('RequestSeekTo', 0.0);
    } else if (value === 'mono') {
      handleStateInline(start, end, 'Make Mono', function () {
        computeActiveChannels();
      });

      const originalBuffer = wavesurfer.backend.buffer;
      const emptySegment = wavesurfer.backend.ac.createBuffer(
        1,
        originalBuffer.length,
        originalBuffer.sampleRate
      );
      emptySegment.getChannelData(0).set(originalBuffer.getChannelData(val2));
      audioUtils.FullReplace(emptySegment);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: end,
        id: 't',
      });

      computeActiveChannels();

      app.fireEvent('RequestSeekTo', 0.0);
    }

    showToast('Applied Channel Change: ' + value);
  });

  app.listenFor('RequestActionFX_Reverse', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Reverse ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Reverse());

    showToast('Applied Reverse');
  });

  // RNNoise-based noise reduction. The WASM build (~2MB) is loaded lazily
  // the first time the effect is used; `wasm_denoise_stream_perf` is the
  // global it exposes (see public/vendor/rnn_denoise.js).
  let rnnoiseLoaded = false;
  app.listenFor('RequestActionFX_NoiseRNN', function () {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    const applyDenoise = function () {
      let region = wavesurfer.regions.list[0];
      if (!region) {
        wavesurfer.regions.add({ start: 0, end: wavesurfer.getDuration(), id: 't' });
        region = wavesurfer.regions.list[0];
      }

      const start = engine.TrimTo(region.start, 3);
      const end = engine.TrimTo(region.end - region.start, 3);
      const duration = engine.TrimTo(region.end - region.start, 3);

      app.fireEvent('StateRequestPush', {
        desc: 'Apply Noise RNN (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });

      const segment = audioUtils.Copy(start, end);
      for (let i = 0; i < segment.numberOfChannels; i++) {
        const channelData = segment.getChannelData(i);
        const denoised = wasm_denoise_stream_perf(channelData);
        channelData.set(denoised);
      }
      audioUtils.Replace(start, end, segment);

      app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());
      wavesurfer.regions.clear();
      wavesurfer.regions.add({ start: start, end: start + duration, id: 't' });

      showToast('Applied Noise RNN (fx)');
    };

    if (rnnoiseLoaded) {
      applyDenoise();
      return;
    }

    const script = document.createElement('script');
    script.src = '/vendor/rnn_denoise.js';
    script.onload = function () {
      rnnoiseLoaded = true;

      // Wait until the Emscripten runtime is fully initialized.
      const waitForWasm = function () {
        if (window.Module && window.Module.asm && window.Module.asm.malloc) {
          applyDenoise();
        } else {
          setTimeout(waitForWasm, 350);
        }
      };
      setTimeout(waitForWasm, 100);
    };
    script.onerror = function () {
      alert('Could not download noise Reduction script');
    };
    document.head.appendChild(script);
  });

  app.listenFor('RequestActionFX_FadeIn', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Fade In (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.FadeIn());

    showToast('Applied Fade In (fx)');
  });
  app.listenFor('RequestActionFX_FadeOut', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Fade Out (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.FadeOut());

    showToast('Applied Fade Out (fx)');
  });

  let fxPreviewDebounce = null;
  app.listenFor('RequestActionFX_UPDATE_PREVIEW', function (value) {
    if (!audioUtils.previewing) return;

    clearTimeout(fxPreviewDebounce);
    fxPreviewDebounce = setTimeout(function () {
      audioUtils.FXPreviewUpdate(value);
    }, 44);
  });
  app.listenFor('RequestActionFX_TOGGLE', function (value) {
    if (value) {
      audioUtils.FXPreviewInit(true);
      return;
    }

    app.fireEvent('DidTogglePreview', audioUtils.FXPreviewToggle());
  });
  app.listenFor('RequestActionFX_PREVIEW_STOP', function () {
    audioUtils.FXPreviewStop();
    app.fireEvent('DidStopPreview');
  });
  app.listenFor('RequestActionFX_PREVIEW_GAIN', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Gain(value));

    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_GAIN', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Gain (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Gain(value));

    showToast('Applied Gain (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_SPEED', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Speed(value));

    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_RATE', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Rate (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);
    let duration = (region.end - region.start) / value;
    duration = engine.TrimTo(duration, 3);

    handleStateInline(start, end);

    let fxBuffer = audioUtils.Copy(start, end);
    const originalBuffer = wavesurfer.backend.buffer;
    const newOffset = ((start / 1) * originalBuffer.sampleRate) >> 0;
    const newLength = ((duration / 1) * originalBuffer.sampleRate) >> 0;
    const oldLength = ((end / 1) * originalBuffer.sampleRate) >> 0;
    const stretchRatio = newLength / oldLength;

    const getOfflineAudioContext = function (channels, sampleRate, duration) {
      return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        channels,
        duration,
        sampleRate
      );
    };
    const audioContext = getOfflineAudioContext(
      // offlineContext
      wavesurfer.SelectedChannelsLen, // originalBuffer.numberOfChannels,
      fxBuffer.sampleRate,
      newLength
    );

    const stretchAudio = function (inputBuffer, sampleRate, stretchRatio) {
      // Parameters (in seconds)
      const channelCount = inputBuffer.numberOfChannels;
      const samples = [inputBuffer.getChannelData(0)];
      for (let i = 1; i < channelCount; ++i) {
        samples.push(inputBuffer.getChannelData(i));
      }

      let grainDurationSec = 0.05; // 50 ms
      const analysisHopSec = 0.025; // 25 ms (50% overlap)
      const desiredOverlap = 0.5;
      const synthesisHopSec = analysisHopSec * stretchRatio; // output hop

      // Adjust grain duration for ratios > 1
      if (stretchRatio > 1) {
        grainDurationSec = synthesisHopSec / (1 - desiredOverlap);
      }

      // Convert durations to samples
      const grainSize = Math.floor(grainDurationSec * sampleRate);
      const analysisHop = Math.floor(analysisHopSec * sampleRate);
      const synthesisHop = Math.floor(synthesisHopSec * sampleRate);

      // Precompute Hann window
      const window = new Float32Array(grainSize);
      for (let i = 0; i < grainSize; i++) {
        // Using (grainSize - 1) so that the window spans [0, grainDurationSec]
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
      }

      // Estimate number of grains and output length
      const numGrains = Math.floor((samples[0].length - grainSize) / analysisHop);
      const outputLength = synthesisHop * numGrains + grainSize;
      const output = [new Float32Array(outputLength)];
      for (let i = 1; i < channelCount; ++i) {
        output.push(new Float32Array(outputLength));
      }

      // Process each grain: copy, window, and add to output
      let inputIndex = 0;
      let outputIndex = 0;
      for (let n = 0; n < numGrains; ++n) {
        // For each sample in the grain, multiply by the window and add to the output
        for (let i = 0; i < grainSize; ++i) {
          for (let j = 0; j < channelCount; ++j) {
            output[j][outputIndex + i] += samples[j][inputIndex + i] * window[i];
          }
        }
        inputIndex += analysisHop;
        outputIndex += synthesisHop;
      }

      return output;
    };

    /// -----
    let filter = [];
    //if (stretchRatio < 1) {
    //	var fx = audioUtils.FXBank.Rate( stretchRatio );
    //	var source = {buffer:null, disconnect:function(){}};
    //	source.buffer = fxBuffer;
    //	filter = fx.filter ( audioContext, audioContext.destination, source, duration );
    //}
    //else
    //{
    // use timestretcher here...
    // var ts = new TimeStretcher({windowSize:2048,overlapRatio:0.75,seekWindowMs:20}).stretch(fxBuffer,stretchRatio);
    const stretchedSamples = stretchAudio(fxBuffer, fxBuffer.sampleRate, stretchRatio);

    // Optionally, if you need an AudioBuffer from the stretchedSamples:
    // const offlineContext = new OfflineAudioContext(stretchedSamples.length, stretchedSamples[0].length, fxBuffer.sampleRate);
    const newBuffer = audioContext.createBuffer(
      stretchedSamples.length,
      stretchedSamples[0].length,
      fxBuffer.sampleRate
    );

    for (let i = 0; i < stretchedSamples.length; ++i) {
      newBuffer.copyToChannel(stretchedSamples[i], i);
    }

    const source = audioContext.createBufferSource();
    source.buffer = newBuffer;
    source.connect(audioContext.destination);
    source.start();
    //}

    engine.inFx = true;
    app.ui.InteractionHandler.on = true;
    // showToast ('Please wait, applying FX', 2600);

    const offlineCallback = function (renderedBuffer) {
      audioUtils.Replace(start, end, renderedBuffer);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: start + duration,
        id: 't',
      });

      app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());

      showToast('Applied Rate (fx)');

      if (filter.length > 0) {
        for (let i = 0; i < filter.length; ++i) filter[i].disconnect();
      } else filter && filter.disconnect && filter.disconnect();

      renderedBuffer = fxBuffer = filter = null;
      source.disconnect();

      engine.inFx = false;
      app.ui.InteractionHandler.on = false;
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
  });

  app.listenFor('RequestActionFX_PREVIEW_RATE', function (value) {
    if (!engine.isReady) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);
    const duration = (region.end - region.start) / value;

    const originalBuffer = wavesurfer.backend.buffer;
    const newOffset = ((start / 1) * originalBuffer.sampleRate) >> 0;
    const newLength = ((duration / 1) * originalBuffer.sampleRate) >> 0;
    const oldLength = ((end / 1) * originalBuffer.sampleRate) >> 0;

    // -----
    const stretchRatio = newLength / oldLength;

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Rate(stretchRatio));

    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_SPEED', function (value) {
    if (!engine.isReady) return;

    app.fireEvent('RequestPause');

    let region = wavesurfer.regions.list[0];
    const dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Speed (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    const start = engine.TrimTo(region.start, 3);
    const end = engine.TrimTo(region.end - region.start, 3);
    let duration = (region.end - region.start) / value;
    duration = engine.TrimTo(duration, 3);

    handleStateInline(start, end);

    let fxBuffer = audioUtils.Copy(start, end);
    const originalBuffer = wavesurfer.backend.buffer;
    const newOffset = ((start / 1) * originalBuffer.sampleRate) >> 0;
    const newLength = ((duration / 1) * originalBuffer.sampleRate) >> 0;
    const oldLength = ((end / 1) * originalBuffer.sampleRate) >> 0;

    /*
			var emptySegment = wavesurfer.backend.ac.createBuffer (
				wavesurfer.SelectedChannelsLen,
				newLength,
				originalBuffer.sampleRate
			);*/

    engine.inFx = true;
    app.ui.InteractionHandler.on = true;
    const fx = audioUtils.FXBank.Speed(value);

    const getOfflineAudioContext = function (channels, sampleRate, duration) {
      return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        channels,
        duration,
        sampleRate
      );
    };
    const audioContext = getOfflineAudioContext(
      wavesurfer.SelectedChannelsLen, // originalBuffer.numberOfChannels,
      originalBuffer.sampleRate,
      newLength
    );

    const source = audioContext.createBufferSource();
    source.buffer = fxBuffer;

    let filter = fx.filter(audioContext, audioContext.destination, source, duration);

    source.start();

    const offlineCallback = function (renderedBuffer) {
      audioUtils.Replace(start, end, renderedBuffer);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: start + duration,
        id: 't',
      });

      app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());

      showToast('Applied Speed (fx)');

      if (filter.length > 0) {
        for (let i = 0; i < filter.length; ++i) filter[i].disconnect();
      } else filter && filter.disconnect && filter.disconnect();

      // is this needed?
      renderedBuffer = fxBuffer = filter = null;
      source.disconnect();
      // audioContext.close ();
      // -
      engine.inFx = false;
      app.ui.InteractionHandler.on = false;
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
  });

  app.listenFor('StateDidPop', function (state, undo) {
    if (!engine.isReady) return;
    app.fireEvent('RequestPause');

    wavesurfer.regions.clear();
    wavesurfer.loadDecodedBuffer(state.data);

    if (state.cb) state.cb();

    let newDuration = wavesurfer.getDuration();
    app.fireEvent('DidUpdateLen', newDuration);

    if (state.meta && state.meta.length > 0) {
      if (state.meta[1]) {
        wavesurfer.regions.add({
          start: state.meta[0] / 1,
          end: state.meta[0] / 1 + state.meta[1] / 1,
          id: 't',
        });
      } else {
        if (!newDuration) newDuration = 0.0001;
        app.fireEvent('RequestSeekTo', state.meta[0] / newDuration);
      }
    }

    if (undo) showToast('Undo ' + state.desc);
    else showToast('Redo ' + state.desc);
  });

  // ---
  app.listenFor('RequestChanToggle', function (channelIndex, forceValue) {
    if (!engine.isReady) return false;

    if (wavesurfer.ActiveChannels.length <= channelIndex) return false;

    const oldval = wavesurfer.ActiveChannels[channelIndex];
    let value = -1;

    if (forceValue) value = forceValue;
    else {
      if (oldval === 1) value = 0;
      else value = 1;
    }

    if (oldval !== value) {
      wavesurfer.ActiveChannels[channelIndex] = value;
      if (value === 0) {
        --wavesurfer.SelectedChannelsLen;
        // silece the channel itself

        if (channelIndex === 0) {
          wavesurfer.backend.gainNode2.gain.value = 0.0;
        } else {
          wavesurfer.backend.gainNode1.gain.value = 0.0;
        }
      } else {
        ++wavesurfer.SelectedChannelsLen;

        if (channelIndex === 0) {
          wavesurfer.backend.gainNode2.gain.value = 1.0;
        } else {
          wavesurfer.backend.gainNode1.gain.value = 1.0;
        }
      }

      wavesurfer.ForceDraw();
      app.fireEvent('DidChanToggle', channelIndex, value);
    }
  });

  // ----
  wavesurfer.on('region-updated', function () {
    if (wavesurfer.regions.list[0]) {
      app.fireEvent('DidCreateRegion', wavesurfer.regions.list[0]);
    }
  });
  wavesurfer.on('region-update-end', function () {
    app.fireEvent('DidCreateRegion', wavesurfer.regions.list[0]);

    const start = wavesurfer.regions.list[0].start;
    if (!wavesurfer.isPlaying()) app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());
  });
  wavesurfer.on('cursorcenter', function (e) {
    app.fireEvent('DidCursorCenter', e, wavesurfer.ZoomFactor);
  });

  const wave = wavesurfer.drawer.canvases[0].wave.parentNode;

  let dragX = 0;
  const dragMove = function (e) {
    const diff = dragX - e.clientX;

    // find diff percentage from full width...

    // drag the waveform now
    app.fireEvent('RequestPan', diff);

    dragX = e.clientX;
  };

  app.listenFor('RequestZoom', function (diff, mode) {
    // compute new ZoomFactor...
    diff *= wavesurfer.ZoomFactor;

    // compute availabel left ZoomFactor
    if (mode === -1) {
      const width = wavesurfer.drawer.width;
      const availablePixels = width - width / wavesurfer.ZoomFactor;
      const target = wavesurfer.ZoomFactor - 1;
      if (target <= 0) return;

      const oldZoomFactor = wavesurfer.ZoomFactor;
      wavesurfer.ZoomFactor += (diff * target) / availablePixels;
      if (wavesurfer.ZoomFactor < 1) wavesurfer.ZoomFactor = 1;

      const newVisibleDuration = wavesurfer.getDuration() / wavesurfer.ZoomFactor;

      if (newVisibleDuration <= 0.5) {
        wavesurfer.ZoomFactor = oldZoomFactor;
        return;
      }

      wavesurfer.VisibleDuration = newVisibleDuration;

      const timeMoved = wavesurfer.VisibleDuration * (diff / wavesurfer.drawer.width);
      wavesurfer.LeftProgress += timeMoved;

      if (wavesurfer.LeftProgress + wavesurfer.VisibleDuration >= wavesurfer.getDuration()) {
        wavesurfer.LeftProgress = wavesurfer.getDuration() - wavesurfer.VisibleDuration;
      } else if (wavesurfer.LeftProgress < 0) {
        wavesurfer.LeftProgress = 0;
      }
    } else if (mode === 1) {
      const width = wavesurfer.drawer.width;
      const availablePixels = width - width / wavesurfer.ZoomFactor;
      const target = wavesurfer.ZoomFactor - 1;
      if (target <= 0) return;

      const oldFactor = wavesurfer.ZoomFactor;
      wavesurfer.ZoomFactor -= (diff * target) / availablePixels;
      if (wavesurfer.ZoomFactor < 1) wavesurfer.ZoomFactor = 1;
      const temp = wavesurfer.getDuration() / wavesurfer.ZoomFactor;
      if (temp + wavesurfer.LeftProgress > wavesurfer.getDuration()) {
        wavesurfer.ZoomFactor = oldFactor;
      } else {
        if (temp <= 0.5) {
          wavesurfer.ZoomFactor = oldFactor;
          return;
        }

        wavesurfer.VisibleDuration = temp;
      }
      // -
    }

    // wavesurfer.ZoomFactor -= Math.abs (diff / (wavesurfer.drawer.width / 2));
    // console.log( diff + " BLAH " + wavesurfer.ZoomFactor + '   ' +  (diff / wavesurfer.drawer.width) );
    wavesurfer.ForceDraw();
    app.fireEvent('DidZoom', [
      wavesurfer.ZoomFactor,
      (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
      wavesurfer.params.verticalZoom,
    ]);
  });

  app.listenFor('RequestPan', function (diff, mode) {
    if (mode === 1) diff *= wavesurfer.ZoomFactor;
    else if (mode === 2) {
      const timeMoved = wavesurfer.getDuration() * (diff / wavesurfer.drawer.width);
      wavesurfer.LeftProgress = timeMoved;

      wavesurfer.ForceDraw();
      app.fireEvent('DidZoom', [
        wavesurfer.ZoomFactor,
        (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
        wavesurfer.params.verticalZoom,
      ]);

      return;
    }

    if (wavesurfer.ZoomFactor > 0) {
      // drag and draw by X pixels...
      const timeMoved = wavesurfer.VisibleDuration * (diff / wavesurfer.drawer.width);
      wavesurfer.LeftProgress += timeMoved;

      if (wavesurfer.LeftProgress + wavesurfer.VisibleDuration >= wavesurfer.getDuration()) {
        wavesurfer.LeftProgress = wavesurfer.getDuration() - wavesurfer.VisibleDuration;
      } else if (wavesurfer.LeftProgress < 0) {
        wavesurfer.LeftProgress = 0;
      }

      wavesurfer.ForceDraw();
      app.fireEvent('DidZoom', [
        wavesurfer.ZoomFactor,
        (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
        wavesurfer.params.verticalZoom,
      ]);
    }
  });

  wave.addEventListener(
    'mousedown',
    function (e) {
      if (e.which === 3) {
        e.preventDefault();

        wavesurfer.Interacting |= 1 << 1;

        dragX = e.clientX;
        wave.className = 'pk_grabbing';

        document.addEventListener('mousemove', dragMove, false);
        return false;
      } else {
        app.fireEvent('MouseDown');
        app.fireEvent('RequestChanToggle', 0, 1);
        app.fireEvent('RequestChanToggle', 1, 1);
      }
    },
    false
  );
  wave.addEventListener(
    'mouseleave',
    function (e) {
      document.removeEventListener('mousemove', dragMove);

      if (wave.className !== '') {
        wave.className = '';
        setTimeout(function () {
          wavesurfer.Interacting &= ~(1 << 1);
        }, 20);
      }
    },
    false
  );
  wave.addEventListener(
    'mouseup',
    function (e) {
      if (e.which === 3) {
        if (wave.className !== '') {
          wave.className = '';
          setTimeout(function () {
            wavesurfer.Interacting &= ~(1 << 1);
          }, 20);
        }
        document.removeEventListener('mousemove', dragMove);
      }
    },
    false
  );

  app.fireEvent('RequestResize');

  app.listenFor('RequestViewFollowCursorToggle', function () {
    const value = !wavesurfer.FollowCursor;
    wavesurfer.FollowCursor = value;

    // jump to current cursor position
    if (value && engine.isReady) {
      wavesurfer.CursorCenter();
    }

    app.fireEvent('DidViewFollowCursorToggle', value);
  });
  app.listenFor('RequestViewPeakSeparatorToggle', function () {
    if (!engine.isReady) return;

    const value = !wavesurfer.params.limits;
    wavesurfer.params.limits = value;

    wavesurfer.ForceDraw();

    app.fireEvent('DidViewPeakSeparatorToggle', value);
  });

  app.listenFor('RequestViewTimelineToggle', function () {
    if (!engine.isReady) return;

    const value = !wavesurfer.params.timeline;
    wavesurfer.params.timeline = value;

    wavesurfer.ForceDraw();

    app.fireEvent('DidViewTimelineToggle', value);
  });

  app.listenFor('RequestViewCenterToCursor', function () {
    if (!engine.isReady) return;
    wavesurfer.CursorCenter();
  });

  app.listenFor('RequestZoomUI', function (type, value) {
    if (!engine.isReady) return;

    if (type === 0) {
      wavesurfer.ResetZoom();
      return;
    }

    if (type === 'h') {
      wavesurfer.SetZoom(0.5, value);
    }

    if (type === 'v') {
      wavesurfer.SetZoomVertical(value);
    }
  });
  // -

  this.ID3 = function (arraybuffer) {
    let tags = null;
    // var ttt = window.performance.now();

    let bytes = new Uint8Array(arraybuffer);
    if (bytes.length < 64) {
      app.fireEvent('RequestActionID3', 1, tags);
      return tags;
    }

    if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
      tags = ID3v2.ReadTags(arraybuffer);

      //console.log( window.performance.now() - ttt );
      // console.log( tags );
    } else if (
      bytes[4] === 102 &&
      bytes[5] === 116 &&
      bytes[6] === 121 &&
      bytes[7] === 112 &&
      bytes[8] === 77 &&
      bytes[9] === 52
    ) {
      tags = ID4.ReadTags(arraybuffer);
      // console.log( window.performance.now() - ttt );
      // console.log( tags );
    }
    bytes = null;

    app.fireEvent('RequestActionID3', 1, tags);

    return tags;
  };
  // ---
}
