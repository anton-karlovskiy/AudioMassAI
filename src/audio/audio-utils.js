/**
 * Audio buffer utilities and the effects bank.
 *
 * Provides the low-level buffer surgery every edit operation is built on
 * (trim / copy / insert / replace segments, respecting the currently active
 * channels), real-time effect previewing through an AnalyserNode tap,
 * offline effect rendering, the WebAudio effect bank (`FXBank`), and export
 * to MP3 / FLAC / WAV via encoder workers.
 *
 * Instantiated by the audio engine as `new AudioUtils(app, wavesurfer)`.
 */

const MP3_ENCODER_WORKER_URL = '/workers/mp3-encoder.worker.js';
const FLAC_ENCODER_WORKER_URL = '/workers/flac-encoder.worker.js';
const WAV_ENCODER_WORKER_URL = '/workers/wav-encoder.worker.js';

export function AudioUtils(app, wavesurfer) {
  // audio destination
  const audioDestination = wavesurfer.backend.analyser;
  const audioContext = wavesurfer.backend.ac;
  const audioScriptNode = audioContext.createScriptProcessor(256);

  function loadDecoded(newBuffer) {
    wavesurfer.loadDecodedBuffer(newBuffer);
    app.fireEvent('DidUpdateLen', wavesurfer.getDuration());
  }

  function OverwriteBufferWithSegment(_offset, _duration, withBuffer) {
    TrimBuffer(_offset, _duration, true);
    const ret = InsertSegmentToBuffer(_offset, withBuffer);

    setTimeout(function () {
      wavesurfer.drawBuffer();
    }, 40);

    return ret;
  }

  function OverwriteBuffer(withBuffer) {
    loadDecoded(withBuffer);
    setTimeout(function () {
      wavesurfer.drawBuffer();
    }, 40);
  }

  function MakeSilenceBuffer(_duration) {
    const originalBuffer = wavesurfer.backend.buffer;
    const emptySegment = wavesurfer.backend.ac.createBuffer(
      originalBuffer.numberOfChannels,
      _duration * originalBuffer.sampleRate,
      originalBuffer.sampleRate
    );

    return emptySegment;
  }

  function CopyBufferSegment(_offset, _duration) {
    const originalBuffer = wavesurfer.backend.buffer;

    const newLength = ((_duration / 1) * originalBuffer.sampleRate) >> 0;
    const newOffset = ((_offset / 1) * originalBuffer.sampleRate) >> 0;

    const emptySegment = wavesurfer.backend.ac.createBuffer(
      wavesurfer.SelectedChannelsLen,
      newLength,
      originalBuffer.sampleRate
    );

    for (let i = 0, u = 0; i < wavesurfer.ActiveChannels.length; ++i) {
      if (wavesurfer.ActiveChannels[i] === 0) continue;

      emptySegment
        .getChannelData(u)
        .set(originalBuffer.getChannelData(i).slice(newOffset, newLength + newOffset));

      ++u;
    }
    return emptySegment;
  }

  function TrimBuffer(_offset, _duration, force) {
    const originalBuffer = wavesurfer.backend.buffer;

    const newLength = ((_duration / 1) * originalBuffer.sampleRate) >> 0;
    const newOffset = ((_offset / 1) * originalBuffer.sampleRate) >> 0;

    const emptySegment = wavesurfer.backend.ac.createBuffer(
      !force ? wavesurfer.SelectedChannelsLen : originalBuffer.numberOfChannels,
      newLength,
      originalBuffer.sampleRate
    );

    let uberSegment = null;

    if (!force && wavesurfer.SelectedChannelsLen < originalBuffer.numberOfChannels) {
      uberSegment = wavesurfer.backend.ac.createBuffer(
        originalBuffer.numberOfChannels,
        originalBuffer.length,
        originalBuffer.sampleRate
      );

      for (let i = 0; i < originalBuffer.numberOfChannels; ++i) {
        const channelData = originalBuffer.getChannelData(i);
        const masterChannelData = uberSegment.getChannelData(i);

        if (wavesurfer.ActiveChannels[i] === 0) {
          masterChannelData.set(channelData);
        } else {
          const segmentChannelData = emptySegment.getChannelData(0);

          segmentChannelData.set(channelData.slice(newOffset, newOffset + newLength));

          masterChannelData.set(channelData.slice(0, newOffset));

          masterChannelData.set(channelData.slice(newOffset + newLength), newOffset + newLength);
        }
      }
    } else {
      uberSegment = wavesurfer.backend.ac.createBuffer(
        originalBuffer.numberOfChannels,
        originalBuffer.length - newLength,
        originalBuffer.sampleRate
      );

      for (let i = 0; i < originalBuffer.numberOfChannels; ++i) {
        const channelData = originalBuffer.getChannelData(i);
        const segmentChannelData = emptySegment.getChannelData(i);
        const masterChannelData = uberSegment.getChannelData(i);

        segmentChannelData.set(channelData.slice(newOffset, newOffset + newLength));

        masterChannelData.set(channelData.slice(0, newOffset));

        masterChannelData.set(channelData.slice(newOffset + newLength), newOffset);
      }
    }

    loadDecoded(uberSegment, originalBuffer);

    return emptySegment;
  }

  function InsertSegmentToBuffer(_offset, buffer) {
    const originalBuffer = wavesurfer.backend.buffer;
    const uberSegment = wavesurfer.backend.ac.createBuffer(
      originalBuffer.numberOfChannels,
      originalBuffer.length + buffer.length,
      originalBuffer.sampleRate
    );

    _offset = ((_offset / 1) * originalBuffer.sampleRate) >> 0;

    for (let i = 0; i < originalBuffer.numberOfChannels; ++i) {
      const channelData = originalBuffer.getChannelData(i);
      const uberChanData = uberSegment.getChannelData(i);
      let segmentChannelData = null;

      if (buffer.numberOfChannels === 1) segmentChannelData = buffer.getChannelData(0);
      else segmentChannelData = buffer.getChannelData(i);

      // check to see if we have only 1 channel selected
      if (wavesurfer.SelectedChannelsLen === 1) {
        // check if we have the selected channel
        if (wavesurfer.ActiveChannels[i] === 0) {
          // keep original
          uberChanData.set(channelData);

          continue;
        }
      }

      if (_offset > 0) {
        uberChanData.set(channelData.slice(0, _offset));
      }

      uberChanData.set(segmentChannelData, _offset);

      if (_offset < originalBuffer.length + buffer.length) {
        uberChanData.set(channelData.slice(_offset), _offset + segmentChannelData.length);
      }
    }

    loadDecoded(uberSegment, originalBuffer);

    return [
      _offset / originalBuffer.sampleRate,
      _offset / originalBuffer.sampleRate + buffer.length / originalBuffer.sampleRate,
    ];
  }

  function ReplaceFloatArrays(_offset, arrays) {
    const originalBuffer = wavesurfer.backend.buffer;
    const arrayLength = arrays.length;
    const sampleArray = arrays[0].length;

    const newLength = sampleArray * arrayLength;
    let bufferLength = originalBuffer.length;

    _offset = ((_offset / 1) * originalBuffer.sampleRate) >> 0;

    if (bufferLength < _offset + newLength) {
      bufferLength = _offset + newLength;
    }

    const uberSegment = wavesurfer.backend.ac.createBuffer(
      originalBuffer.numberOfChannels,
      bufferLength,
      originalBuffer.sampleRate
    );

    for (let i = 0; i < originalBuffer.numberOfChannels; i++) {
      const channelData = originalBuffer.getChannelData(i);
      const uberChanData = uberSegment.getChannelData(i);

      if (_offset > 0) {
        uberChanData.set(channelData.slice(0, _offset));
      }

      for (let j = 0; j < arrayLength; ++j) {
        uberChanData.set(arrays[j], _offset + j * sampleArray);
      }

      if (_offset < originalBuffer.length + newLength) {
        uberChanData.set(channelData.slice(_offset + newLength), _offset + newLength);
      }
    }

    loadDecoded(uberSegment, originalBuffer);

    return [
      _offset / originalBuffer.sampleRate,
      _offset / originalBuffer.sampleRate + newLength / originalBuffer.sampleRate,
    ];
  }

  function InsertFloatArrays(_offset, arrays) {
    const originalBuffer = wavesurfer.backend.buffer;
    const arrayLength = arrays.length;
    const sampleArray = arrays[0].length;

    const newLength = sampleArray * arrayLength;

    _offset = ((_offset / 1) * originalBuffer.sampleRate) >> 0;

    const uberSegment = wavesurfer.backend.ac.createBuffer(
      originalBuffer.numberOfChannels,
      originalBuffer.length + newLength,
      originalBuffer.sampleRate
    );

    for (let i = 0; i < originalBuffer.numberOfChannels; i++) {
      const channelData = originalBuffer.getChannelData(i);
      const uberChanData = uberSegment.getChannelData(i);

      if (_offset > 0) {
        uberChanData.set(channelData.slice(0, _offset));
      }

      for (let j = 0; j < arrayLength; ++j) {
        uberChanData.set(arrays[j], _offset + j * sampleArray);
      }

      if (_offset < originalBuffer.length + newLength) {
        uberChanData.set(channelData.slice(_offset), _offset + newLength);
      }
    }

    loadDecoded(uberSegment, originalBuffer);

    return [
      _offset / originalBuffer.sampleRate,
      _offset / originalBuffer.sampleRate + newLength / originalBuffer.sampleRate,
    ];
  }

  function getAudioContext() {
    if (!window.WaveSurferAudioContext) {
      window.WaveSurferAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return window.WaveSurferAudioContext;
  }
  function getOfflineAudioContext(channels, sampleRate, duration) {
    return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
      channels,
      duration,
      sampleRate
    );
  }

  function initPreview(value) {
    this.previewVal = value;
  }

  function stopPreview(_fx) {
    if (!this.previewing) return;

    if (_fx) {
      _fx.destroy && _fx.destroy();
    }

    if (this.PreviewFilter) {
      if (this.PreviewFilter.length > 0) {
        for (let ii = 0; ii < this.PreviewFilter.length; ++ii) this.PreviewFilter[ii].disconnect();
      } else this.PreviewFilter.disconnect();
    }

    const scriptNode = audioScriptNode; // wavesurfer.backend.scriptNode

    scriptNode.disconnect();
    wavesurfer.backend.scriptNode.connect(audioContext.destination);
    // wavesurfer.backend.scriptNode.connect (audioContext.destination);
    // wavesurfer.backend.scriptNode.onaudioprocess = null;

    this.PreviewSource.stop();
    this.PreviewSource.disconnect();

    this.PreviewDestination = this.PreviewSource = this.PreviewFilter = this.PreviewUpdate = null;
    this.previewing = 0;
  }
  function togglePreview() {
    if (!this.previewing) {
      this.previewVal = !this.previewVal;
      return this.previewVal;
    }

    if (this.previewing === 2) {
      //				if (this.PreviewFilter)
      //				{
      //					if (this.PreviewFilter.length > 0)
      //					{
      //						for (var ii = 0; ii < this.PreviewFilter.length; ++ii)
      //							this.PreviewFilter[ ii ].disconnect ();
      //					}
      //					else
      //						this.PreviewFilter.disconnect ();
      //				}

      if (this.PreviewTog) {
        this.PreviewTog(false, this.PreviewSource);
      }

      this.PreviewSource.disconnect();
      this.PreviewSource.connect(this.PreviewDestination);
      this.previewing = 1;
      this.previewVal = false;

      return false;
    } else {
      this.PreviewSource.disconnect();

      if (this.PreviewFilter) {
        if (this.PreviewFilter.length > 0) {
          !this.PreviewFilter[0].buffer && this.PreviewSource.connect(this.PreviewFilter[0]);
          //						var ii = 0;
          //						for (; ii < this.PreviewFilter.length - 1; ++ii)
          //						{
          //							this.PreviewFilter[ ii ].disconnect ();
          //							this.PreviewFilter[ ii ].connect (this.PreviewFilter[ ii + 1 ]);
          //						}
          //						this.PreviewFilter[ ii ].connect (this.PreviewDestination);
        } else {
          !this.PreviewFilter.buffer && this.PreviewSource.connect(this.PreviewFilter);
          this.PreviewFilter.disconnect();
          this.PreviewFilter.connect(this.PreviewDestination);
        }
      }

      if (this.PreviewTog) {
        this.PreviewTog(true, this.PreviewSource);
      }

      this.previewing = 2;
      this.previewVal = true;

      return true;
    }
  }

  function previewEffect(_offset, _duration, _fx) {
    if (this.previewing) stopPreview(_fx);

    const originalBuffer = wavesurfer.backend.buffer;

    if (!_offset && !_duration) {
      _offset = 0;
      _duration = (originalBuffer.length / originalBuffer.sampleRate) >> 0;
    }

    const scriptNode = audioScriptNode; //wavesurfer.backend.scriptNode;
    const fxBuffer = CopyBufferSegment(_offset, _duration);
    const audioContext = wavesurfer.backend.ac || getAudioContext();
    const source = audioContext.createBufferSource();
    source.buffer = fxBuffer;
    source.loop = true;

    this.PreviewFilter = this.PreviewTog = null;
    if (!_fx) source.connect(audioDestination);
    else {
      this.PreviewTog = _fx.preview;
      this.PreviewUpdate = _fx.update;
      this.PreviewFilter = _fx.filter(audioContext, audioDestination, source, _duration / 1);
    }

    scriptNode.disconnect();
    wavesurfer.backend.scriptNode.disconnect();
    scriptNode.connect(audioContext.destination);

    let skipp = 1;
    let previousFft = 0;
    let dataArray = null;

    scriptNode.onaudioprocess = (e) => {
      const loudness = [0, 0];
      let temp = 0;
      // var flip = false;
      --skipp;

      if (skipp === 0) {
        if (audioDestination.getFloatTimeDomainData) {
          if (previousFft !== audioDestination.fftSize) {
            dataArray = new Float32Array(audioDestination.fftSize); // Float32Array needs to be the same length as the fftSize
            previousFft = audioDestination.fftSize;
          }
          audioDestination.getFloatTimeDomainData(dataArray); // fill the Float32Array with data returned from getFloatTimeDomainData()

          for (let j = 0; j < audioDestination.fftSize; j += 1) {
            const x = dataArray[j];
            if (Math.abs(x) >= temp) {
              temp = Math.abs(x);
            }
          }

          loudness[0] = 20 * Math.log10(temp) + 0.001;
        } else {
          if (previousFft !== audioDestination.fftSize) {
            dataArray = new Uint8Array(audioDestination.fftSize); // Float32Array needs to be the same length as the fftSize
            previousFft = audioDestination.fftSize;
          }
          audioDestination.getByteTimeDomainData(dataArray); // fill the Float32Array with data returned from getFloatTimeDomainData()

          let totalFloat = 0;

          for (let j = 0; j < audioDestination.fftSize; j += 1) {
            const float = dataArray[j] / 0x80 - 1;
            totalFloat += float * float;
          }
          const rms = Math.sqrt(totalFloat / audioDestination.fftSize);
          loudness[0] = 20 * (Math.log(rms) / Math.log(10));
        }

        if (loudness[0] < -100) loudness[0] = -100;
        loudness[1] = loudness[0];

        // audioDestination.fftSize = 512;
        audioDestination.getByteFrequencyData(wavesurfer.backend.FreqArr);

        //wavesurfer.backend.peakFrequency = Math.max.apply( null, wavesurfer.backend.FreqArr );
        app.fireEvent('DidAudioProcess', [-1, loudness, e.timeStamp], wavesurfer.backend.FreqArr);
        // wavesurfer.backend.peakFrequency = [0, 0];
        skipp = 2;
      }
    };

    source.start();

    this.PreviewSource = source;
    this.PreviewDestination = audioDestination;
    this.previewing = 2;

    if (!this.previewVal) {
      togglePreview.call(this);
    }

    return source;
  }

  function applyEffect(_offset, _duration, _fx) {
    const originalBuffer = wavesurfer.backend.buffer;

    if (!_offset && !_duration) {
      _offset = 0;
      _duration = (originalBuffer.length / originalBuffer.sampleRate) >> 0;
    }

    if (_offset < 0) _offset = 0;
    if (wavesurfer.getDuration() < _duration) _duration = wavesurfer.getDuration();

    let fxBuffer = CopyBufferSegment(_offset, _duration);
    const newOffset = ((_offset / 1) * originalBuffer.sampleRate) >> 0;

    const audioContext = getOfflineAudioContext(
      wavesurfer.SelectedChannelsLen, // originalBuffer.numberOfChannels,
      originalBuffer.sampleRate,
      fxBuffer.length
    );

    const source = audioContext.createBufferSource();
    source.buffer = fxBuffer;

    let filter = null;
    if (_fx) {
      filter = _fx.filter(audioContext, audioContext.destination, source, _duration / 1);
      filter.destroy && filter.destroy();
    }

    source.start();

    const offlineCallback = function (renderedBuffer) {
      const masterBuffer = wavesurfer.backend.ac.createBuffer(
        originalBuffer.numberOfChannels,
        originalBuffer.length,
        originalBuffer.sampleRate
      );

      for (let i = 0; i < originalBuffer.numberOfChannels; ++i) {
        const masterChannelData = masterBuffer.getChannelData(i);
        const channelData = originalBuffer.getChannelData(i);

        // check if channel is active
        if (wavesurfer.ActiveChannels[i] === 0) {
          masterChannelData.set(channelData);
          continue;
        }

        let fxChannelData = null;
        if (renderedBuffer.numberOfChannels === 1) fxChannelData = renderedBuffer.getChannelData(0);
        else fxChannelData = renderedBuffer.getChannelData(i);

        masterChannelData.set(channelData);

        masterChannelData.set(fxChannelData, newOffset, fxChannelData.length - newOffset);
      }

      loadDecoded(masterBuffer);

      if (filter.length > 0) {
        for (let i = 0; i < filter.length; ++i) filter[i].disconnect();
      } else filter && filter.disconnect && filter.disconnect();

      // is this needed?
      renderedBuffer = fxBuffer = filter = null;
      source.disconnect();
      // audioContext.close ();
      // -
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
  }

  let worker = null;
  function DownloadFileCancel() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function DownloadFile(withName, format, kbps, selection, stereo, callback) {
    if (wavesurfer && wavesurfer.backend && wavesurfer.backend.buffer) {
    } else {
      return false;
    }

    if (format === 'mp3') {
      worker = new Worker(MP3_ENCODER_WORKER_URL);
    } else if (format === 'flac') {
      worker = new Worker(FLAC_ENCODER_WORKER_URL);
    } else {
      worker = new Worker(WAV_ENCODER_WORKER_URL);
    }

    const originalBuffer = wavesurfer.backend.buffer;
    const sampleRate = originalBuffer.sampleRate;

    let channels = originalBuffer.numberOfChannels;

    let dataLeft = originalBuffer.getChannelData(0);
    let dataRight = null;
    if (channels === 2) dataRight = originalBuffer.getChannelData(1);

    if (!stereo && channels === 2) {
      if (!wavesurfer.ActiveChannels[0] && wavesurfer.ActiveChannels[1]) {
        dataLeft = originalBuffer.getChannelData(1);
        dataRight = null;
        channels = 1;
      }
    }

    if (stereo && !dataRight) {
      dataRight = dataLeft;
      channels = 2;
    } else if (!stereo && dataRight) {
      dataRight = null;
      channels = 1;
    }

    let length = dataLeft.length,
      i = 0;
    let offset = 0;

    if (selection) {
      offset = (selection[0] * sampleRate) >> 0;
      length = ((selection[1] * sampleRate) >> 0) - offset;
    }

    const dataAsInt16ArrayLeft = new Int16Array(length);
    let dataAsInt16ArrayRight = null;

    if (dataRight) {
      dataAsInt16ArrayRight = new Int16Array(length);

      while (i < length) {
        dataAsInt16ArrayLeft[i] = convert(dataLeft[offset + i]);
        dataAsInt16ArrayRight[i] = convert(dataRight[offset + i]);
        ++i;
      }
    } else {
      while (i < length) {
        dataAsInt16ArrayLeft[i] = convert(dataLeft[offset + i]);
        ++i;
      }
    }
    function convert(n) {
      const v = n < 0 ? n * 32768 : n * 32767; // convert in range [-32768, 32767]
      return Math.max(-32768, Math.min(32768, v)); // clamp
    }

    worker.onmessage = function (ev) {
      if (ev.data.percentage) {
        callback && callback(ev.data.percentage);
        return;
      }
      forceDownload(ev.data);

      worker.terminate();
      worker = null;
    };

    worker.postMessage({
      sampleRate: sampleRate,
      kbps: !kbps ? 128 : kbps,
      flacCompression: kbps,
      channels: channels,
    });
    worker.postMessage(dataAsInt16ArrayLeft.buffer, [dataAsInt16ArrayLeft.buffer]);
    if (dataRight) worker.postMessage(dataAsInt16ArrayRight.buffer, [dataAsInt16ArrayRight.buffer]);
    else worker.postMessage(null);

    // function forceDownload ( mp3Data ) {
    // 	var blob = new Blob (mp3Data, {type:'audio/mp3'});
    function forceDownload(blob) {
      const url = (window.URL || window.webkitURL).createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = withName ? withName : 'output.mp3';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      callback && callback('done');
    }
  }

  function updatePreview(value) {
    if (!this.previewing) return;
    this.PreviewUpdate &&
      this.PreviewUpdate(this.PreviewFilter, audioContext, value, this.PreviewSource);
  }

  // EFFECTS LOGIC
  const FXBank = {
    Gain: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          const gain = audioContext.createGain();

          for (let k = 0; k < value.length; ++k) {
            const current = value[k];
            if (current.length) {
              for (let i = 0; i < current.length; ++i) {
                gain.gain.linearRampToValueAtTime(
                  current[i].val,
                  audioContext.currentTime + current[i].time
                );
              }
            } else {
              gain.gain.setValueAtTime(current.val, audioContext.currentTime);
            }
          }

          gain.connect(destination);
          source.connect(gain);

          return gain;
        },
        update: function (gain, audioContext, value) {
          for (let k = 0; k < value.length; ++k) {
            const current = value[k];
            if (current.length) {
              for (let i = 0; i < current.length; ++i) {
                gain.gain.linearRampToValueAtTime(
                  current[i].val,
                  audioContext.currentTime + current[i].time
                );
              }
            } else {
              gain.gain.setValueAtTime(current.val, audioContext.currentTime);
            }
          }
          // ----
        },
      };
    },

    FadeIn: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          const gain = audioContext.createGain();
          gain.gain.setValueAtTime(0, audioContext.currentTime);
          gain.gain.linearRampToValueAtTime(1, audioContext.currentTime + duration / 1);
          gain.connect(destination);
          source.connect(gain);

          return gain;
        },
      };
    },

    FadeOut: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          const gain = audioContext.createGain();
          gain.gain.setValueAtTime(1, audioContext.currentTime);
          gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1);
          gain.connect(destination);
          source.connect(gain);

          return gain;
        },
      };
    },

    Compressor: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          const compressor = audioContext.createDynamicsCompressor();

          for (const k in value) {
            if (value[k].length) {
              for (let i = 0; i < value[k].length; ++i) {
                const current = value[k][i];
                compressor[k].linearRampToValueAtTime(
                  current.val,
                  audioContext.currentTime + current.time
                );
              }
            } else {
              compressor[k].setValueAtTime(value[k].val, audioContext.currentTime);
            }
          }

          compressor.connect(destination);
          source.connect(compressor);

          return compressor;
        },
        update: function (compressor, audioContext, value) {
          for (const k in value) {
            if (value[k].length) {
              for (let i = 0; i < value[k].length; ++i) {
                const current = value[k][i];
                compressor[k].linearRampToValueAtTime(
                  current.val,
                  audioContext.currentTime + current.time
                );
              }
            } else {
              compressor[k].setValueAtTime(value[k].val, audioContext.currentTime);
            }
          }
          // ---
        },
      };
    },

    Reverse: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          for (let i = 0; i < source.buffer.numberOfChannels; ++i) {
            Array.prototype.reverse.call(source.buffer.getChannelData(i));
          }

          source.connect(destination);
          return source;
        },
        update: function () {},
      };
    },

    Invert: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          for (let i = 0; i < source.buffer.numberOfChannels; ++i) {
            const channel = source.buffer.getChannelData(i);

            for (let j = 0; j < channel.length; ++j) channel[j] *= -1;
          }

          source.connect(destination);
          return source;
        },
        update: function () {},
      };
    },

    Flip: function (value, val2) {
      return {
        filter: function (audioContext, destination, source, duration) {
          if (value === 'flip') {
            const chan0 = source.buffer.getChannelData(0);
            const chan1 = source.buffer.getChannelData(1);
            let tmp = 0;

            for (let j = 0; j < chan0.length; ++j) {
              tmp = chan0[j];
              chan0[j] = chan1[j];
              chan1[j] = tmp;
            }
          }

          source.connect(destination);
          return source;
        },
        update: function () {},
      };
    },

    Normalize: function (value) {
      //todo ASM JS??
      return {
        filter: function (audioContext, destination, source, duration) {
          const maxValue = value[1] || 1.0;
          const equally = value[0];
          let maxPeak = 0;

          for (let i = 0; i < source.buffer.numberOfChannels; ++i) {
            const channelData = source.buffer.getChannelData(i);

            // iterating faster first time...
            for (let k = 1, length = channelData.length; k < length; k = k + 10) {
              const current = Math.abs(channelData[k]);
              if (maxPeak < current) maxPeak = current;
            }

            const diff = maxValue / maxPeak;

            if (!equally) {
              for (let k = 0, length = channelData.length; k < length; ++k) {
                channelData[k] *= diff;
              }
              maxPeak = 0;
            }
          }

          if (equally) {
            const diff = maxValue / maxPeak;

            for (let i = 0; i < source.buffer.numberOfChannels; ++i) {
              const channelData = source.buffer.getChannelData(i);

              for (let k = 0, length = channelData.length; k < length; ++k) {
                channelData[k] *= diff;
              }
            }
          }

          source.connect(destination);
          return source;
        },
        update: function () {},
      };
    },

    HardLimit: function (value) {
      //todo ASM JS??
      return {
        filter: function (audioContext, destination, source, duration) {
          const maxValue = value[1] || 1.0;
          const ratio = value[2] || 0.0;
          let lookAhead = value[3] || 15; // ms
          const equally = false; //value[0];
          let maxPeak = 0;

          const buffer = audioContext.createBuffer(
            source.buffer.numberOfChannels,
            source.buffer.length,
            source.buffer.sampleRate
          );

          lookAhead = ((lookAhead * buffer.sampleRate) / 1000) >> 0;

          for (let i = 0; i < buffer.numberOfChannels; ++i) {
            const channelData = buffer.getChannelData(i);
            channelData.set(source.buffer.getChannelData(i));

            // iterating faster first time...
            for (let b = 0, length = channelData.length; b < length; ++b) {
              for (let k = 0; k < lookAhead; k = k + 10) {
                const current = Math.abs(channelData[b + k]);
                if (maxPeak < current) maxPeak = current;
              }

              const diff = maxValue / maxPeak;

              if (!equally) {
                for (let k = 0; k < lookAhead; ++k) {
                  const originalValue = channelData[b + k];
                  const newValue = originalValue * diff;

                  let peakDifference = maxValue - Math.abs(newValue);
                  peakDifference *= originalValue < 0 ? -ratio : ratio;

                  channelData[b + k] = newValue + peakDifference;
                }
                b += lookAhead;
                maxPeak = 0;
              }
            }
            // -----
          }

          // todo handle disconnected LEFT AND RIGHT
          const tempSource = audioContext.createBufferSource();
          tempSource.buffer = buffer;
          tempSource.loop = true;
          tempSource.start();

          tempSource.connect(destination);
          return tempSource;
        },
        update: function (filteredSource, audioContext, value, source) {
          // stop the existing onerror
          filteredSource.disconnect();
          filteredSource.buffer = null;
          filteredSource = null;

          const ff = this.FXBank.HardLimit(value);
          this.PreviewFilter = ff.filter(audioContext, audioDestination, source, 0);
        },
      };
    },

    ParametricEQ: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          const bands = [];
          const length = value.length;

          const makeEQ = function (band) {
            const eq = audioContext.createBiquadFilter();

            if (band.length) {
              for (let i = 0; i < band.length; ++i) {
                eq.gain.linearRampToValueAtTime(
                  ~~band[i].val,
                  audioContext.currentTime + band[i].time
                );
              }

              band = band[0];
            } else eq.gain.value = ~~band.val;

            eq.type = band.type;
            eq.Q.value = band.q || 1.0;
            eq.frequency.value = band.freq;

            return eq;
          };

          if (!value[0]) {
            value[0] = {
              type: 'peaking',
              val: 0,
              q: 1,
              freq: 500,
            };
          }

          let eq = makeEQ(value[0]);
          bands.push(eq);
          source.connect(eq);

          if (value.length === 1) {
            eq.connect(destination);
            return bands;
          }

          for (let i = 1; i < length - 1; ++i) {
            eq = makeEQ(value[i]);
            bands[i - 1].connect(eq);
            bands.push(eq);
          }
          eq = makeEQ(value[length - 1]);
          bands[bands.length - 1].connect(eq);
          bands.push(eq);
          eq.connect(destination);

          return bands;
        },
        update: function (bands, audioContext, value, source) {
          if (bands.length !== value.length) {
            const makeEQ = function (band) {
              const eq = audioContext.createBiquadFilter();
              return eq;
            };

            if (bands.length < value.length) {
              let l = value.length - bands.length;
              while (l-- > 0) {
                const eq = makeEQ();
                const connectTo = bands[0];
                bands.unshift(eq);
                eq.connect(connectTo);
              }

              source.disconnect();
              source.connect(bands[0]);
            } else {
              if (value.length > 0) {
                const l = bands.length - value.length;
                source.disconnect();

                for (let i = 0; i < l; ++i) {
                  const eq = bands.shift();
                  eq.disconnect();
                }

                source.connect(bands[0]);
              } else {
                value[0] = {
                  type: 'peaking',
                  val: 0,
                  q: 1,
                  freq: 500,
                };
              }
            }
          }

          const length = value.length;
          for (let i = 0; i < length; ++i) {
            const eq = bands[i];
            eq.type = value[i].type;
            eq.gain.value = ~~value[i].val;
            eq.Q.value = value[i].q || 1.0;
            eq.frequency.value = value[i].freq;
          }
          // -
        },
      };
    },

    Rate: function (value) {
      let previousValue = 1.0;
      let tempSource = [];

      return {
        filter: function (audioContext, destination, source, duration) {
          const fxBuffer = source.buffer;

          const stretchRatio = value;
          let grainDuration = 0.05; // 50 ms grain
          const analysisHop = 0.025; // 25 ms step (50% overlap)
          const desiredOverlap = 0.5; // 50% overlap
          const synthesisHop = analysisHop * stretchRatio; //  output hop

          if (stretchRatio > 1) {
            grainDuration = synthesisHop / (1 - desiredOverlap); // 0.15 sec (150 ms
          }

          const offlineContext = audioContext;
          const now = audioContext.currentTime;

          // var filter = fx.filter ( offlineContext, offlineContext.destination, null, duration );
          const applyHannWindowFast = function (gainNode, outputTime, grainDuration) {
            // The automation curve using a Hann window shape
            const numSteps = 50;

            for (let i = 0; i <= numSteps; i++) {
              const t = (i / numSteps) * grainDuration;
              const windowValue = 0.5 * (1 - Math.cos((2 * Math.PI * t) / grainDuration));
              gainNode.gain.linearRampToValueAtTime(windowValue, outputTime + t);
            }
          };

          // Schedule grains
          let grainIndex = 0;
          const filterChain = [];

          for (let t = 0; t < fxBuffer.duration; t += analysisHop) {
            const offset = t;
            const outputTime = grainIndex * synthesisHop;
            if (offset + grainDuration > fxBuffer.duration) break; // stop if beyond source

            const grainSource = offlineContext.createBufferSource();
            grainSource.buffer = fxBuffer;

            const grainGain = offlineContext.createGain();
            grainSource.connect(grainGain);
            grainGain.connect(offlineContext.destination);

            applyHannWindowFast(grainGain, now + outputTime, grainDuration);

            grainSource.start(now + outputTime, offset, grainDuration);
            filterChain.push(grainGain);
            tempSource[grainIndex] = grainSource;

            ++grainIndex;
          }

          return filterChain;
        },

        destroy: function () {
          tempSource = [];
        },

        update: function (filterChain, audioContext, value, source) {
          previousValue = 1 / value;
          const fxBuffer = source.buffer;

          let grainDuration = 0.05; // 50 ms grain
          const analysisHop = 0.025; // 25 ms step (50% overlap)
          const desiredOverlap = 0.5; // 50% overlap
          const synthesisHop = analysisHop * previousValue; //  output hop

          if (previousValue > 1) {
            grainDuration = synthesisHop / (1 - desiredOverlap); // 0.15 sec (150 ms
          }

          const now = audioContext.currentTime;

          // var filter = fx.filter ( offlineContext, offlineContext.destination, null, duration );
          const applyHannWindowFast = function (gainNode, outputTime, grainDuration) {
            // The automation curve using a Hann window shape
            const numSteps = 50;

            for (let i = 0; i <= numSteps; i++) {
              const t = (i / numSteps) * grainDuration;
              const windowValue = 0.5 * (1 - Math.cos((2 * Math.PI * t) / grainDuration));
              gainNode.gain.linearRampToValueAtTime(windowValue, outputTime + t);
            }
          };

          // Schedule grains
          const l = filterChain.length;
          let t = 0;
          for (let i = 0; i < l; ++i) {
            const offset = t;
            const outputTime = i * synthesisHop;
            //if (offset + grainDuration > fxBuffer.duration) break;
            const grainGain = filterChain[i];
            let grainSource = tempSource[i];
            grainSource.stop();

            grainSource = audioContext.createBufferSource();
            grainGain.gain.setValueAtTime(grainGain.gain.value, now);
            grainGain.gain.cancelScheduledValues(now);

            grainSource.buffer = fxBuffer;
            grainSource.connect(grainGain);
            tempSource[i] = grainSource;

            applyHannWindowFast(grainGain, outputTime + now, grainDuration);

            grainSource.start(now + outputTime, offset, grainDuration);
            t += analysisHop;
          }
          // --
        },
      };
    },

    Speed: function (value) {
      let previousValue = 1.0;

      return {
        filter: function (audioContext, destination, source, duration) {
          const inputNode = audioContext.createGain();

          source.playbackRate.value = value;
          source.connect(inputNode);

          // line in to dry mix
          inputNode.connect(destination);

          const filterChain = [inputNode];

          return filterChain;
        },

        preview: function (state, source) {
          if (!state) source.playbackRate.value = 1.0;
          else source.playbackRate.value = previousValue;
        },

        update: function (filterChain, audioContext, value, source) {
          previousValue = value;
          source.playbackRate.value = value;
        },
      };
    },

    Delay: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          const inputNode = audioContext.createGain();
          const outputNode = audioContext.createGain();
          const dryGainNode = audioContext.createGain();
          const wetGainNode = audioContext.createGain();
          const feedbackGainNode = audioContext.createGain();
          const delayNode = audioContext.createDelay();

          source.connect(inputNode);

          // line in to dry mix
          inputNode.connect(dryGainNode);
          // dry line out
          dryGainNode.connect(outputNode);

          // feedback loop
          delayNode.connect(feedbackGainNode);
          feedbackGainNode.connect(delayNode);

          // line in to wet mix
          inputNode.connect(delayNode);
          // wet out
          delayNode.connect(wetGainNode);

          // wet line out
          wetGainNode.connect(outputNode);
          outputNode.connect(destination);

          const filterChain = [
            inputNode,
            outputNode,
            dryGainNode,
            wetGainNode,
            feedbackGainNode,
            delayNode,
          ];

          if (!value.delay.length) delayNode.delayTime.value = value.delay.val;
          else {
            for (let i = 0; i < value.delay.length; ++i) {
              delayNode.delayTime.linearRampToValueAtTime(
                value.delay[i].val,
                value.delay[i].time + audioContext.currentTime
              );
            }
          }

          if (!value.feedback.length) feedbackGainNode.gain.value = value.feedback.val;
          else {
            for (let i = 0; i < value.feedback.length; ++i) {
              feedbackGainNode.gain.linearRampToValueAtTime(
                value.feedback[i].val,
                value.feedback[i].time + audioContext.currentTime
              );
            }
          }

          if (!value.mix.length) {
            dryGainNode.gain.value = 1 - (value.mix.val - 0.5) * 2;
            wetGainNode.gain.value = 1 - (0.5 - value.mix.val) * 2;
          } else {
            for (let i = 0; i < value.mix.length; ++i) {
              dryGainNode.gain.linearRampToValueAtTime(
                1 - (value.mix[i].val - 0.5) * 2,
                value.mix[i].time + audioContext.currentTime
              );
              wetGainNode.gain.linearRampToValueAtTime(
                1 - (0.5 - value.mix[i].val) * 2,
                value.mix[i].time + audioContext.currentTime
              );
            }
          }

          return filterChain;
        },

        update: function (filterChain, audioContext, value) {
          // update filter chain...
          const dryGainNode = filterChain[2];
          const wetGainNode = filterChain[3];
          const feedbackGainNode = filterChain[4];
          const delayNode = filterChain[5];

          if (!value.delay.length) delayNode.delayTime.value = value.delay.val;
          else {
            for (let i = 0; i < value.delay.length; ++i) {
              delayNode.delayTime.linearRampToValueAtTime(
                value.delay[i].val,
                value.delay[i].time + audioContext.currentTime
              );
            }
          }

          if (!value.feedback.length) feedbackGainNode.gain.value = value.feedback.val;
          else {
            for (let i = 0; i < value.feedback.length; ++i) {
              feedbackGainNode.gain.linearRampToValueAtTime(
                value.feedback[i].val,
                value.feedback[i].time + audioContext.currentTime
              );
            }
          }

          if (!value.mix.length) {
            dryGainNode.gain.value = 1 - (value.mix.val - 0.5) * 2;
            wetGainNode.gain.value = 1 - (0.5 - value.mix.val) * 2;
          } else {
            for (let i = 0; i < value.mix.length; ++i) {
              dryGainNode.gain.linearRampToValueAtTime(
                1 - (value.mix[i].val - 0.5) * 2,
                value.mix[i].time + audioContext.currentTime
              );
              wetGainNode.gain.linearRampToValueAtTime(
                1 - (0.5 - value.mix[i].val) * 2,
                value.mix[i].time + audioContext.currentTime
              );
            }
          }
          // ---
        },
      };
    },

    Distortion: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          const waveShaper = audioContext.createWaveShaper();
          // var gain = parseInt (0.5 * 100, 10);
          const computeDistance = function (value) {
            const gain = parseInt((value / 1) * 100, 10);
            const sampleCount = 44100;
            const curve = new Float32Array(sampleCount);
            const deg = Math.PI / 180;
            let x;

            for (let i = 0; i < sampleCount; ++i) {
              x = (i * 2) / sampleCount - 1;
              curve[i] = ((3 + gain) * x * 20 * deg) / (Math.PI + gain * Math.abs(x));
            }

            return curve;
          };

          for (let k = 0; k < value.length; ++k) {
            const current = value[k];
            if (current.length) {
              for (let i = 0; i < current.length; ++i) {
                waveShaper.curve.linearRampToValueAtTime(
                  computeDistance(current[i].val),
                  audioContext.currentTime + current[i].time
                );
              }
            } else {
              waveShaper.curve = computeDistance(current.val);
            }
          }

          source.connect(waveShaper);
          waveShaper.connect(destination);

          return waveShaper;
        },

        update: function (filter, audioContext, value) {
          const computeDistance = function (value) {
            const gain = parseInt((value / 1) * 100, 10);
            const sampleCount = 44100;
            const curve = new Float32Array(sampleCount);
            const deg = Math.PI / 180;
            let x;

            for (let i = 0; i < sampleCount; ++i) {
              x = (i * 2) / sampleCount - 1;
              curve[i] = ((3 + gain) * x * 20 * deg) / (Math.PI + gain * Math.abs(x));
            }

            return curve;
          };

          for (let k = 0; k < value.length; ++k) {
            const current = value[k];
            if (current.length) {
              for (let i = 0; i < current.length; ++i) {
                filter.curve.linearRampToValueAtTime(
                  computeDistance(current[i].val),
                  audioContext.currentTime + current[i].time
                );
              }
            } else {
              filter.curve = computeDistance(current.val);
            }
          }
          // ----
        },
      };
    },

    Reverb: function (value) {
      return {
        filter: function (audioContext, destination, source, duration) {
          // ----
          const inputNode = audioContext.createGain();
          const reverbNode = audioContext.createConvolver();
          const outputNode = audioContext.createGain();
          const wetGainNode = audioContext.createGain();
          const dryGainNode = audioContext.createGain();

          source.connect(inputNode);

          inputNode.connect(reverbNode);
          reverbNode.connect(wetGainNode);
          inputNode.connect(dryGainNode);
          dryGainNode.connect(outputNode);
          wetGainNode.connect(outputNode);
          outputNode.connect(destination);

          const filterChain = [inputNode, outputNode, reverbNode, dryGainNode, wetGainNode];

          // set defaults
          dryGainNode.gain.value = 1 - (value.mix - 0.5) * 2;
          wetGainNode.gain.value = 1 - (0.5 - value.mix) * 2;

          const length = audioContext.sampleRate * value.time;
          const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
          const impulseL = impulse.getChannelData(0);
          const impulseR = impulse.getChannelData(1);
          let n, i;

          for (i = 0; i < length; i++) {
            n = value.reverse ? length - i : i;
            impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, value.decay);
            impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, value.decay);
          }
          reverbNode.buffer = impulse;

          return filterChain;
        },

        update: function (filterChain, audioContext, value) {
          audioContext = wavesurfer.backend.ac;

          const reverbNode = filterChain[2];
          const dryGainNode = filterChain[3];
          const wetGainNode = filterChain[4];

          dryGainNode.gain.value = 1 - (value.mix - 0.5) * 2;
          wetGainNode.gain.value = 1 - (0.5 - value.mix) * 2;

          const length = audioContext.sampleRate * value.time;
          const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
          const impulseL = impulse.getChannelData(0);
          const impulseR = impulse.getChannelData(1);
          let n, i;

          for (i = 0; i < length; i++) {
            n = value.reverse ? length - i : i;
            impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, value.decay);
            impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, value.decay);
          }
          reverbNode.buffer = impulse;
        },
      };
    },
  };

  this.FXPreviewUpdate = updatePreview;
  this.FXPreviewStop = stopPreview;
  this.FXPreviewToggle = togglePreview;
  this.FXPreviewInit = initPreview;
  this.FXPreview = previewEffect;
  this.FX = applyEffect;
  this.FXBank = FXBank;

  this.Trim = TrimBuffer;
  this.Copy = CopyBufferSegment;
  this.Insert = InsertSegmentToBuffer;
  this.InsertFloatArrays = InsertFloatArrays;
  this.ReplaceFloatArrays = ReplaceFloatArrays;
  this.Replace = OverwriteBufferWithSegment;
  this.FullReplace = OverwriteBuffer;
  this.MakeSilence = MakeSilenceBuffer;
  this.DownloadFile = DownloadFile;
  this.DownloadFileCancel = DownloadFileCancel;
  // this.ComputeTopFrequencies = findTopFrequencies;
  // this.MatchTopFrequencies= killdTopFrequencies;
  // ---
}
