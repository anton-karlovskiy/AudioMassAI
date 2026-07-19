/**
 * Effect dialog UIs.
 *
 * Registers listeners that open the dialog for each effect (gain, speed,
 * compressor, EQs, delay, reverb, distortion, hard limiter, ...), reading the
 * user's settings and firing the matching `RequestActionFX_*` engine event.
 * Also owns custom preset storage, the ID3 tag explorer, and the pop-out /
 * docked frequency & spectrum analyzer windows.
 */

import { showToast } from './toast.js';
import { SimpleModal, AudioEffectModal } from './modals.js';
import { openParagraphicEQ } from '../effects/paragraphic-eq.js';
import { openTempoTools } from '../effects/tempo-tools.js';
import { openRecordingModal } from '../effects/recording-modal.js';

// Custom FX presets, persisted in localStorage.
function FxPresetStore() {
  let presets = {};

  this.Set = function (filterId, preset) {
    let presetList = presets[filterId];

    if (!presetList) {
      presetList = [];
      presets[filterId] = presetList;
    }

    presetList.push(preset);
    localStorage.setItem('pk_presetfx', JSON.stringify(presets));

    return presetList;
  };

  this.Save = function () {
    localStorage.setItem('pk_presetfx', JSON.stringify(presets));
  };

  this.Get = function (filterId) {
    if (!filterId) return presets;
    return presets[filterId];
  };

  this.GetSingle = function (filterId, customId) {
    if (!filterId) return false;
    if (!customId) return false;

    const presetList = presets[filterId];
    let index = presetList.length;
    let found = null;

    while (index-- > 0) {
      if (presetList[index].id === customId) {
        found = presetList[index];
        break;
      }
    }

    if (found) return found;
    return false;
  };

  this.Del = function (filterId, customId) {
    if (!filterId) return presets;

    const presetList = presets[filterId];
    let index = presetList.length;
    let found = false;

    while (index-- > 0) {
      if (presetList[index].id === customId) {
        presetList.splice(index, 1);
        found = true;
        break;
      }
    }

    if (found) localStorage.setItem('pk_presetfx', JSON.stringify(presets));

    return presetList;
  };

  // loadCustomPresets
  if (!window.localStorage) {
    this.Set = function () {};
    return;
  }

  const json = window.localStorage.getItem('pk_presetfx');
  let tmp = null;

  if (!json) return;
  try {
    tmp = JSON.parse(json);
  } catch (e) {}

  if (tmp) presets = tmp;
}

export function registerEffectsUI(app) {
  const UI = app.ui;

  let currentFilterUi = null;
  const modalName = 'modalfx';
  const modalEscapeKey = modalName + 'esc';

  const customPresets = new FxPresetStore();

  app.listenFor('DidCloseFX_UI', function () {
    currentFilterUi = null;
  });

  app.listenFor('DidOpenFX_UI', function (modal) {
    currentFilterUi = modal;
  });

  app.listenFor('RequestFXUI_SELCUT', function () {
    const wavesurfer = app.engine.wavesurfer;
    const rate = wavesurfer.backend.buffer.sampleRate;

    const region = wavesurfer.regions.list[0];
    if (!region) return false;

    app.fireEvent('RequestPause');

    // mark the region as
    region.element.style.background = 'red';

    const reg = {
      pos: {
        start: (region.start * rate) >> 0,
        end: (region.end * rate) >> 0,
      },
      initpos: {
        start: (region.start * rate) >> 0,
        end: (region.end * rate) >> 0,
      },
    };

    wavesurfer.backend.reg = reg;

    const updateRegion = function (region) {
      reg.pos.start = (region.start * rate) >> 0;
      reg.pos.end = (region.end * rate) >> 0;

      wavesurfer.drawBuffer(true);
    };

    wavesurfer.on('region-updated', updateRegion);
    // -- now make sure we resize it if needed be
  });

  app.listenFor('RequestFXUI_Gain', function () {
    app.fireEvent('RequestSelect', 1);

    const filterId = 'gain';
    const auto = null;

    const getvalue = function (modal) {
      let value;

      if (auto) {
        value = auto.GetValue();
      } else {
        const input = modal.bodyElement.getElementsByTagName('input')[0];
        value = [{ val: input.value / 1 }];
      }

      return value;
    };

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Apply Gain to selected range',

        presets: [
          { name: 'Silence', val: 0 },
          { name: '-50%', val: 0.5 },
          { name: '-25%', val: 0.75 },
          { name: '+25%', val: 1.25 },
          { name: '+50%', val: 1.5 },
          { name: '+100%', val: 2 },
        ],
        customPresetList: customPresets.Get(filterId),
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        preview: function (modal) {
          const value = getvalue(modal);
          app.fireEvent('RequestActionFX_PREVIEW_GAIN', value);
        },
        buttons: [
          {
            title: 'Apply Gain',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const value = getvalue(modal);

              if (value[0].val != 1.0) app.fireEvent('RequestActionFX_GAIN', value);

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row" style="border:none"><label>Gain percentage</label>' +
          '<input type="range" class="pk_horizontal" min="0.0" max="2.5" step="0.01" value="1.0" />' +
          '<span class="pk_value">100%</span></div>' +
          '<div class="pk_row" style="border:none;padding:0">',

        setup: function (modal) {
          const range = modal.bodyElement.getElementsByTagName('input')[0];
          const span = modal.bodyElement.getElementsByTagName('span')[0];

          range.oninput = function () {
            span.innerHTML = ((range.value * 100) >> 0) + '%';
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', [{ val: range.value / 1 }]);
          };

          //};

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
  });

  app.listenFor('RequestActionFXUI_Rate', function () {
    app.fireEvent('RequestSelect', 1);

    const filterId = 'speed';

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Change Speed',
        presets: [
          { name: 'A lot slower', val: 0.65 },
          { name: 'Slightly slower', val: 0.85 },
          { name: 'Slightly faster', val: 1.15 },
          { name: 'Blazing Fast', val: 1.4 },
        ],
        customPresetList: customPresets.Get(filterId),
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        preview: function (modal) {
          const input = modal.bodyElement.getElementsByTagName('input')[0];
          const value = input.value.trim() / 1;
          app.fireEvent('RequestActionFX_PREVIEW_RATE', value);
        },

        buttons: [
          {
            title: 'Apply Rate',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const input = modal.bodyElement.getElementsByTagName('input')[0];
              const value = input.value.trim() / 1;

              if (value != 1.0) app.fireEvent('RequestActionFX_RATE', value);

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row" style="border:none"><label>Playback Rate</label>' +
          '<input type="range" class="pk_horizontal" min="0.2" max="2.0" step="0.05" value="1.0" />' +
          '<span class="pk_value">1.0</span></div>',
        setup: function (modal) {
          const range = modal.bodyElement.getElementsByTagName('input')[0];
          const span = modal.bodyElement.getElementsByTagName('span')[0];

          range.oninput = function () {
            span.innerHTML = range.value;
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', range.value / 1);
          };

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
  });

  app.listenFor('RequestActionFXUI_Speed', function () {
    app.fireEvent('RequestSelect', 1);

    const filterId = 'speed';

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Change Speed',
        presets: [
          { name: '-1/4', val: 0.25 },
          { name: '-1/2', val: 0.5 },
          { name: 'Slightly slower', val: 0.85 },
          { name: 'Slightly faster', val: 1.1 },
          { name: '+1/4', val: 1.25 },
          { name: '+1/2', val: 1.5 },
        ],
        customPresetList: customPresets.Get(filterId),
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        preview: function (modal) {
          const input = modal.bodyElement.getElementsByTagName('input')[0];
          const value = input.value.trim() / 1;
          app.fireEvent('RequestActionFX_PREVIEW_SPEED', value);
        },

        buttons: [
          {
            title: 'Apply Rate',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const input = modal.bodyElement.getElementsByTagName('input')[0];
              const value = input.value.trim() / 1;

              if (value != 1.0) app.fireEvent('RequestActionFX_SPEED', value);

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row" style="border:none"><label>Playback Rate</label>' +
          '<input type="range" class="pk_horizontal" min="0.2" max="2.0" step="0.05" value="1.0" />' +
          '<span class="pk_value">1.0</span></div>',
        setup: function (modal) {
          const range = modal.bodyElement.getElementsByTagName('input')[0];
          const span = modal.bodyElement.getElementsByTagName('span')[0];

          range.oninput = function () {
            span.innerHTML = range.value;
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', range.value / 1);
          };

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
  });

  app.listenFor('RequestActionFXUI_Flip', function () {
    if (!app.engine.isReady) return;

    app.fireEvent('RequestRegionClear');
    app.fireEvent('RequestSelect', 1);

    const filterId = 'flip';
    let mode = 0;

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Channel Info',
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        buttons: [
          {
            title: 'Apply Changes',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              if (mode === 1) {
                // check if we are doing force mono, or force flip
                const mono = modal.bodyElement.getElementsByClassName('pk_c_mm')[0];
                const flip = modal.bodyElement.getElementsByClassName('pk_c_fl')[0];

                if (mono.checked) {
                  const channelCount = modal.bodyElement.getElementsByClassName('pk_c_c');
                  // check which channel we pick

                  if (channelCount[0].checked) {
                    app.fireEvent('RequestActionFX_Flip', 'mono', 0);
                  } else if (channelCount[1].checked) {
                    app.fireEvent('RequestActionFX_Flip', 'mono', 1);
                  }
                } else if (flip.checked) {
                  app.fireEvent('RequestActionFX_Flip', 'flip');
                }
              } else if (mode === 2) {
                const stereo = modal.bodyElement.getElementsByClassName('pk_c_ms')[0];
                if (stereo.checked) {
                  app.fireEvent('RequestActionFX_Flip', 'stereo');
                }
              }

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row pk_mm" style="border:none;display:none">' +
          '<div class="pk_row">' +
          '<input type="checkbox" class="pk_check pk_c_mm" id="xmm" name="makeMono">' +
          '<label for="xmm">Make Mono</label></div>' +
          '<div class="pk_row" style="padding-left:30px">' +
          '<input type="radio" class="pk_check pk_c_c" id="kf6" name="chnl" value="left">' +
          '<label class="pk_disabled" for="kf6">Left Channel</label>' +
          '<input type="radio" class="pk_check pk_c_c" id="kf7" name="chnl" value="right">' +
          '<label class="pk_disabled" for="kf7">Right Channel</label>' +
          '</div>' +
          '<div class="pk_row"><input type="checkbox" class="pk_check pk_c_fl" id="xfc" name="flipChn">' +
          '<label for="xfc">Flip Channels</label></div>' +
          '</div>' +
          '<div class="pk_row pk_ms" style="border:none;display:none">' +
          '<div class="pk_row"><input type="checkbox" class="pk_check pk_c_ms" id="xms" checked name="makeStereo">' +
          '<label for="xms">Make Stereo</label></div>' +
          '</div>',
        setup: function (modal) {
          let main = null;
          const number = app.engine.wavesurfer.backend.buffer.numberOfChannels;
          if (number === 2) {
            mode = 1;
            main = modal.bodyElement.getElementsByClassName('pk_mm')[0];

            const mono = main.getElementsByClassName('pk_c_mm')[0];
            const flip = main.getElementsByClassName('pk_c_fl')[0];
            const channelCount = main.getElementsByClassName('pk_c_c');
            const tmp = main.getElementsByClassName('pk_disabled');
            const lbls = [tmp[0], tmp[1]];

            mono.onchange = function (e) {
              if (mono.checked) {
                flip.checked = false;
                channelCount[0].checked = true;
                lbls[0].className = '';
                lbls[1].className = '';
              } else {
                channelCount[0].checked = false;
                channelCount[1].checked = false;
                lbls[0].className = 'pk_disabled';
                lbls[1].className = 'pk_disabled';
              }
            };

            flip.onchange = function (e) {
              if (flip.checked) {
                mono.checked = false;
                mono.onchange();
              }
            };
          } else {
            mode = 2;
            main = modal.bodyElement.getElementsByClassName('pk_ms')[0];
          }

          main.style.display = 'block';

          // --

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
  });

  app.listenFor('RequestFXUI_Silence', function () {
    const fxModal = new SimpleModal({
      title: 'Insert Silence',
      ondestroy: function (modal) {
        UI.InteractionHandler.on = false;
        UI.KeyHandler.removeCallback('modalTemp');
      },
      buttons: [
        {
          title: 'Insert Silence',
          className: 'pk_modal_action_accept',
          callback: function (modal) {
            const input = modal.bodyElement.getElementsByClassName('pk_horizontal')[0];
            const value = input.value.trim() / 1;

            const radios = modal.bodyElement.getElementsByClassName('pk_check');
            let offset = 0;

            if (radios[1].checked) offset = app.engine.wavesurfer.getCurrentTime().toFixed(3) / 1;

            if (value > 0.001) UI.fireEvent('RequestActionSilence', offset, value);
            modal.Destroy();
          },
        },
      ],
      body:
        '<div class="pk_row"><input type="radio" class="pk_check" id="ifeq" name="rdslnc" value="beginning">' +
        '<label  for="ifeq">Insert silence at beginning</label><br/>' +
        '<input type="radio" class="pk_check"  id="vgdja" name="rdslnc" checked value="cursor">' +
        '<label for="vgdja">Insert silence at current cursor (<span class="pkcdpk"></span>)</label></div>' +
        '<div class="pk_row"><label>Silence in seconds</label>' +
        '<input type="range" min="0.0" max="30.0" class="pk_horizontal" step="0.01" value="5.0" />' +
        '<span class="pk_value">5s</span></div>',
      setup: function (modal) {
        const cursorPositionElement = modal.bodyElement.getElementsByClassName('pkcdpk')[0];
        cursorPositionElement.innerHTML = app.engine.wavesurfer.getCurrentTime().toFixed(2) + 's';

        const range = modal.bodyElement.getElementsByClassName('pk_horizontal')[0];
        const span = modal.bodyElement.getElementsByClassName('pk_value')[0];

        range.oninput = function () {
          span.innerHTML = (range.value / 1).toFixed(2) + 's';
        };

        UI.fireEvent('RequestPause');
        UI.InteractionHandler.checkAndSet('modal');
        UI.KeyHandler.addCallback(
          'modalTemp',
          function (e) {
            modal.Destroy();
          },
          [27]
        );
      },
    });
    fxModal.Show();
  });

  app.listenFor('RequestActionFXUI_Compressor', function () {
    app.fireEvent('RequestSelect', 1);

    const filterId = 'compressor';
    const auto = null;
    const getvalue = function (modal) {
      let value = [];

      if (auto) {
        value = auto.GetValue();
      } else {
        const inputs = modal.bodyElement.getElementsByTagName('input');
        value[0] = { val: inputs[0].value / 1 };
        value[1] = { val: inputs[1].value / 1 };
        value[2] = { val: inputs[2].value / 1 };
        value[3] = { val: inputs[3].value / 1 };
        value[4] = { val: inputs[4].value / 1 };
      }

      const ret = {
        threshold: value[0],
        knee: value[1],
        ratio: value[2],
        attack: value[3],
        release: value[4],
      };

      return ret;
    };

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Apply Compression to selected range',
        className: 'pk_bigger',
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        presets: [
          { name: 'Classic', val: '-40,5,7,0.002,0.1' },
          { name: 'Light', val: '-6,2,2.5,0.002,0.05' },
          { name: 'Dashed Distortion', val: '-45,26,2.05,0.233,0.0' },
          { name: 'Chaotic Distortion', val: '-60,14,11.07,0.036,0.00' },
        ],
        customPresetList: customPresets.Get(filterId),
        preview: function (modal) {
          const inputs = modal.bodyElement.getElementsByTagName('input');
          const value = getvalue(modal);
          app.fireEvent('RequestActionFX_PREVIEW_COMPRESSOR', value);
        },

        buttons: [
          {
            title: 'Apply',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const inputs = modal.bodyElement.getElementsByTagName('input');
              const value = getvalue(modal);

              app.fireEvent('RequestActionFX_Compressor', value);

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row"><label class="pk_line">Threshold</label>' +
          '<input class="pk_horizontal" type="range" min="-100" max="0" step="0.1" value="-24.0" />' +
          '<span class="pk_value">-24.0</span></div>' +
          '<div class="pk_row"><label class="pk_line">Knee</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="40.0" step="0.01" value="30.0" />' +
          '<span class="pk_value">30.0</span></div>' +
          '<div class="pk_row"><label class="pk_line">Ratio</label>' +
          '<input class="pk_horizontal" type="range" min="1.0" max="20.0" step="0.01" value="12.0" />' +
          '<span class="pk_value">12.0</span></div>' +
          '<div class="pk_row"><label class="pk_line">Attack</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="1.0" step="0.001" value="0.003" />' +
          '<span class="pk_value">0.003</span></div>' +
          '<div class="pk_row" style="border:none"><label class="pk_line">Release</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="1.0" step="0.001" value="0.25" />' +
          '<span class="pk_value">0.25</span></div>',
        setup: function (modal) {
          const inputs = modal.bodyElement.getElementsByTagName('input');
          for (let i = 0; i < inputs.length; ++i) {
            inputs[i].oninput = function () {
              const span = this.parentNode.getElementsByTagName('span')[0];
              span.innerHTML = (this.value / 1).toFixed(3);

              updateFilter();
            };
          }

          //};

          function updateFilter() {
            const value = getvalue(modal);
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', value);
          }

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
          // ---
        },
      },
      app
    );
    fxModal.Show();
  });

  app.listenFor('RequestActionFXUI_Normalize', function () {
    app.fireEvent('RequestSelect', 1);

    const fxModal = new SimpleModal({
      title: 'Normalize',
      ondestroy: function (modal) {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback('modalTemp');
      },
      buttons: [
        {
          title: 'Normalize Audio',
          className: 'pk_modal_action_accept',
          callback: function (modal) {
            const input = modal.bodyElement.getElementsByClassName('pk_horizontal')[0];
            const value = input.value / 1;

            const toggle = modal.bodyElement.getElementsByClassName('pk_check')[0].checked;
            app.fireEvent('RequestActionFX_Normalize', [toggle, value]);
            modal.Destroy();
          },
        },
      ],
      body:
        '<div class="pk_row">' +
        '<input type="checkbox" id="vhcjgs" class="pk_check" name="normEqually">' +
        '<label for="vhcjgs">Normalize L/R Equally</label></div>' +
        '<div class="pk_row" style="border:none"><label>Normalize to</label>' +
        '<input type="range" min="0.0" max="2.0" class="pk_horizontal" step="0.01" value="1.0" />' +
        '<span class="pk_value">100%</span></div>',
      setup: function (modal) {
        const range = modal.bodyElement.getElementsByClassName('pk_horizontal')[0];
        const span = modal.bodyElement.getElementsByClassName('pk_value')[0];

        range.oninput = function () {
          span.innerHTML = (((range.value / 1) * 100) >> 0) + '%';
        };

        app.fireEvent('RequestPause');
        app.ui.InteractionHandler.checkAndSet('modal');
        app.ui.KeyHandler.addCallback(
          'modalTemp',
          function (e) {
            modal.Destroy();
          },
          [27]
        );
      },
    });
    fxModal.Show();
  });

  app.listenFor('RequestActionFXUI_ParaGraphicEQ', function () {
    openParagraphicEQ(app, customPresets);
  });

  app.listenFor('RequestActionTempo', function () {
    openTempoTools(app);
  });

  app.listenFor('RequestActionNewRec', function () {
    openRecordingModal(app);
  });

  app.listenFor('RequestActionFXUI_GraphicEQ', function (bandCount) {
    app.fireEvent('RequestSelect', 1);

    let filterId = 'graph_eq';
    const auto = null;
    const getvalue = function (ranges) {
      let value = {};

      if (auto) {
        value = auto.GetValue();
      } else {
        value = [];
        const length = ranges.length;
        for (let i = 0; i < length; ++i) {
          const range = ranges[i];
          value.push({
            type: range.getAttribute('data-type'),
            freq: range.getAttribute('data-freq') / 1,
            val: range.value / 1,
            q: bandQ,
          });
        }
      }

      return value;
    };

    let bandsHtml =
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="32" data-type="lowshelf" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">< 32hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="64" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">64hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="125" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">125hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="250" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">250hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="500" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">500hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="1000" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">1000hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="2000" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">2000hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="4000" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">4000hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="8000" data-type="peaking" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm">8000hz</span></div>' +
      '<div class="pk_column"><span class="pk_value">0 db</span>' +
      '<input class="pk_vertical" data-freq="16000" data-type="highshelf" ' +
      'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
      '<span class="pk_btm"> >16000hz</span></div>';
    let presets = [
      { name: 'Reset', val: '0,0,0,0,0,0,0,0,0,0' },
      { name: 'Old Radio', val: '-25,-22,-20,-18,-9,0,8,10,-8,-25' },
      { name: 'Lo Fi', val: '-18,-12,0,2,0,4,4,-1,-6,-8' },
    ];
    let bandQ = 4.6;

    if (bandCount === 20) {
      filterId += '_2';
      presets = null; // maybe add presets?
      bandQ = 10.2;
      bandsHtml =
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="31" data-type="lowshelf" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">< 31hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="44" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">44hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="63" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">63hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="88" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">88hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="125" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">125hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="180" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">180hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="250" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">250hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="335" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">335hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="500" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">500hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="710" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">710hz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="1000" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">1khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="1400" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">1.4khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="2000" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">2khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="2800" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">2.8khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="4000" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">4khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="5600" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">5.6khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="8000" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">8khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="11300" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">11.3khz</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="16000" data-type="peaking" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm">16k</span></div>' +
        '<div class="pk_column"><span class="pk_value">0 db</span>' +
        '<input class="pk_vertical" data-freq="22000" data-type="highshelf" ' +
        'type="range" min="-25.0" max="25.0" step="0.01" value="0.0" />' +
        '<span class="pk_btm"> >22khz</span></div>';
    }

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Graphic EQ',
        className: bandCount === 20 ? 'pk_dens' : '',
        customPresetList: customPresets.Get(filterId),
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        preview: function (modal) {
          const ranges = modal.bodyElement.getElementsByTagName('input');
          const length = ranges.length;

          app.fireEvent('RequestActionFX_PREVIEW_PARAMEQ', getvalue(ranges));
        },

        buttons: [
          {
            title: 'Apply EQ',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const ranges = modal.bodyElement.getElementsByTagName('input');
              app.fireEvent('RequestActionFX_PARAMEQ', getvalue(ranges));

              modal.Destroy();
            },
          },
        ],
        presets: presets,
        body: '<div class="pk_height_200">' + bandsHtml + '<div style="clear:both;"></div></div>',
        setup: function (modal) {
          const ranges = modal.bodyElement.getElementsByTagName('input');
          const length = ranges.length;

          //			obj.type = range.getAttribute ('data-type');
          //			obj.freq = range.getAttribute ('data-freq')/1;
          //			obj.q    = bandQ;
          //		});
          //};

          for (let i = 0; i < length; ++i) {
            const range = ranges[i];

            range.oninput = function () {
              const span = this.parentNode.getElementsByTagName('span')[0];
              span.innerHTML = (this.value >> 0) + ' db';
              app.fireEvent('RequestActionFX_UPDATE_PREVIEW', getvalue(ranges));
            };
          }

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
  });

  app.listenFor('RequestActionFXUI_HardLimiter', function () {
    app.fireEvent('RequestSelect', 1);

    const fxModal = AudioEffectModal(
      {
        title: 'Hard Limiting',
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback('modalTemp');
        },
        buttons: [
          {
            title: 'Hard Limiting',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              app.fireEvent('RequestActionFX_HardLimit', modal.updateFilter(modal));
              modal.Destroy();
            },
          },
        ],
        preview: function (modal) {
          app.fireEvent('RequestActionFX_PREVIEW_HardLimit', modal.updateFilter(modal));
        },
        body:
          '<div class="pk_row"><input type="checkbox" class="pk_check" id="xighs" name="normEqually">' +
          '<label for="xighs">Hard Limiting</label></div>' +
          '<div class="pk_row"><label>Limit to</label>' +
          '<input type="range" min="0.1" max="1.0" class="pk_horizontal pk_width_180" step="0.01" value="0.99" />' +
          '<span class="pk_value">99%</span></div>' +
          '<div class="pk_row"><label>Ratio between lows and highs</label>' +
          '<input type="range" min="0.0" max="1.0" class="pk_horizontal pk_width_180" step="0.01" value="0.0" />' +
          '<span class="pk_value">Ratio 0%</span></div>' +
          '<div class="pk_row"><label>Look Ahead (ms)</label>' +
          '<input type="range" min="1.0" max="500.0" class="pk_horizontal pk_width_180" step="0.01" value="10.0" />' +
          '<span class="pk_value">10 ms</span></div>',
        updateFilter: function (modal) {
          const value = [modal.bodyElement.getElementsByClassName('pk_check')[0].checked];
          const ranges = modal.bodyElement.getElementsByClassName('pk_horizontal');

          for (let i = 0; i < ranges.length; ++i) {
            const range = ranges[i];
            value.push(range.value / 1);
          }
          return value;
        },
        setup: function (modal) {
          const ranges = modal.bodyElement.getElementsByClassName('pk_horizontal');

          ranges[0].oninput = function () {
            const span = this.parentNode.getElementsByTagName('span')[0];
            span.innerHTML = (((this.value / 1) * 100) >> 0) + '%';
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', modal.updateFilter(modal));
          };
          ranges[1].oninput = function () {
            const span = this.parentNode.getElementsByTagName('span')[0];
            span.innerHTML = 'Ratio ' + (((this.value / 1) * 100) >> 0) + '%';
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', modal.updateFilter(modal));
          };
          ranges[2].oninput = function () {
            const span = this.parentNode.getElementsByTagName('span')[0];
            span.innerHTML = this.value / 1 + 'ms';
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', modal.updateFilter(modal));
          };

          app.fireEvent('RequestPause');
          app.ui.InteractionHandler.checkAndSet('modal');
          app.ui.KeyHandler.addCallback(
            'modalTemp',
            function (e) {
              modal.Destroy();
            },
            [27]
          );
        },
      },
      app
    );
    fxModal.Show();
  });

  app.listenFor('RequestActionFXUI_Delay', function () {
    app.fireEvent('RequestSelect', 1);

    const filterId = 'delay';
    const auto = null;
    const getvalue = function (modal) {
      let value = [];

      if (auto) {
        value = auto.GetValue();
      } else {
        const inputs = modal.bodyElement.getElementsByTagName('input');
        value[0] = { val: inputs[0].value / 1 };
        value[1] = { val: inputs[1].value / 1 };
        value[2] = { val: inputs[2].value / 1 };
      }

      const ret = {
        delay: value[0],
        feedback: value[1],
        mix: value[2],
      };

      return ret;
    };

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Apply Delay to selected range',
        className: 'pk_bigger',
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        presets: [
          { name: 'Classic', val: '0.3,0.4,0.4' },
          { name: 'Spacey', val: '3.0,0.6,0.3' },
        ],
        customPresetList: customPresets.Get(filterId),
        preview: function (modal) {
          const value = getvalue(modal);

          app.fireEvent('RequestActionFX_PREVIEW_DELAY', value);
        },

        buttons: [
          {
            title: 'Apply',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const value = getvalue(modal);

              app.fireEvent('RequestActionFX_DELAY', value);

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row"><label class="pk_line">Delay Time</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="6.0" step="0.01" value="0.28" />' +
          '<span class="pk_value">0.28</span></div>' +
          '<div class="pk_row"><label class="pk_line">Feedback</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="1.0" step="0.01" value="0.5" />' +
          '<span class="pk_value">0.5</span></div>' +
          '<div class="pk_row"><label class="pk_line">Wet</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="1.0" step="0.01" value="0.4" />' +
          '<span class="pk_value">0.4</span></div>',
        setup: function (modal) {
          const inputs = modal.bodyElement.getElementsByTagName('input');
          for (let i = 0; i < inputs.length; ++i) {
            inputs[i].oninput = function () {
              const span = this.parentNode.getElementsByTagName('span')[0];
              span.innerHTML = (this.value / 1).toFixed(3);

              updateFilter();
            };
          }

          //};

          function updateFilter() {
            const value = getvalue(modal);
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', value);
          }

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
          // ---
        },
      },
      app
    );
    fxModal.Show();
  });

  app.listenFor('RequestActionFXUI_Distortion', function () {
    app.fireEvent('RequestSelect', 1);

    const filterId = 'dist';
    const auto = null;
    const getvalue = function (modal) {
      let value;

      if (auto) {
        value = auto.GetValue();
      } else {
        const input = modal.bodyElement.getElementsByTagName('input')[0];
        value = [{ val: input.value / 1 }];
      }

      return value;
    };

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Apply Distortion to selected range',
        className: 'pk_bigger',
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        preview: function (modal) {
          const value = getvalue(modal);
          app.fireEvent('RequestActionFX_PREVIEW_DISTORT', value);
        },

        buttons: [
          {
            title: 'Apply',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const value = getvalue(modal);
              app.fireEvent('RequestActionFX_DISTORT', value);

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row"><label class="pk_line">Gain</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="2.0" step="0.01" value="0.5" />' +
          '<span class="pk_value">0.5</span></div>',

        setup: function (modal) {
          const inputs = modal.bodyElement.getElementsByTagName('input');
          for (let i = 0; i < inputs.length; ++i) {
            inputs[i].oninput = function () {
              const span = this.parentNode.getElementsByTagName('span')[0];
              span.innerHTML = (this.value / 1).toFixed(2);

              updateFilter();
            };
          }

          //};

          function updateFilter() {
            const value = getvalue(modal);
            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', value);
          }

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
          // ---
        },
      },
      app
    );
    fxModal.Show();
  });

  app.listenFor('RequestActionFXUI_Reverb', function () {
    app.fireEvent('RequestSelect', 1);

    const filterId = 'reverb';

    const fxModal = AudioEffectModal(
      {
        id: filterId,
        title: 'Apply Reverb to selected range',
        className: 'pk_bigger',
        ondestroy: function (modal) {
          app.ui.InteractionHandler.on = false;
          app.ui.KeyHandler.removeCallback(modalEscapeKey);
        },
        presets: [
          { name: 'Classic', val: '0.3,0.4,0.4' },
          { name: 'Spacey', val: '3.0,0.6,0.3' },
        ],
        customPresetList: customPresets.Get(filterId),
        preview: function (modal) {
          const inputs = modal.bodyElement.getElementsByTagName('input');
          const value = {
            time: inputs[0].value / 1,
            decay: inputs[1].value / 1,
            mix: inputs[2].value / 1,
          };
          app.fireEvent('RequestActionFX_PREVIEW_REVERB', value);
        },

        buttons: [
          {
            title: 'Apply',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const inputs = modal.bodyElement.getElementsByTagName('input');
              const value = {
                time: inputs[0].value / 1,
                decay: inputs[1].value / 1,
                mix: inputs[2].value / 1,
              };

              app.fireEvent('RequestActionFX_REVERB', value);

              modal.Destroy();
            },
          },
        ],
        body:
          '<div class="pk_row"><label class="pk_line">Time</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="3.0" step="0.01" value="0.3" />' +
          '<span class="pk_value">0.3</span></div>' +
          '<div class="pk_row"><label class="pk_line">Decay</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="3.0" step="0.01" value="0.05" />' +
          '<span class="pk_value">0.05</span></div>' +
          '<div class="pk_row"><label class="pk_line">Wet</label>' +
          '<input class="pk_horizontal" type="range" min="0.0" max="1.0" step="0.01" value="0.6" />' +
          '<span class="pk_value">0.6</span></div>',
        setup: function (modal) {
          const inputs = modal.bodyElement.getElementsByTagName('input');
          for (let i = 0; i < inputs.length; ++i) {
            inputs[i].oninput = function () {
              const span = this.parentNode.getElementsByTagName('span')[0];
              span.innerHTML = (this.value / 1).toFixed(3);

              updateFilter();
            };
          }

          function updateFilter() {
            const inputs = modal.bodyElement.getElementsByTagName('input');
            const value = {
              time: inputs[0].value / 1,
              decay: inputs[1].value / 1,
              mix: inputs[2].value / 1,
            };

            app.fireEvent('RequestActionFX_UPDATE_PREVIEW', value);
          }

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
          // ---
        },
      },
      app
    );
    fxModal.Show();
  });

  // -----

  let currentTags = null;
  app.listenFor('RequestActionID3', function (flag, newTags) {
    if (flag) {
      currentTags = newTags;
      return;
    }

    const modalId = '_id3';

    const renderTags = function (element, tags) {
      let markup = '<div style="margin-top:18px">';

      markup +=
        '<div><span class="pk_id3ttl">Artist</span><span>' + (tags.artist || '-') + '</span></div>';
      markup +=
        '<div><span class="pk_id3ttl">Title</span><span>' + (tags.title || '-') + '</span></div>';
      markup +=
        '<div><span class="pk_id3ttl">Album</span><span>' + (tags.album || '-') + '</span></div>';
      markup +=
        '<div><span class="pk_id3ttl">Year</span><span>' + (tags.year || '-') + '</span></div>';
      markup +=
        '<div><span class="pk_id3ttl">Genre</span><span>' + (tags.genre || '-') + '</span></div>';
      markup +=
        '<div style="max-width:700px"><span class="pk_id3ttl">Comment</span><span>' +
        ((tags.comment || {}).text || '-') +
        '</span></div>';
      markup +=
        '<div><span class="pk_id3ttl">Track</span><span>' + (tags.track || '-') + '</span></div>';
      markup +=
        '<div style="max-width:700px"><span class="pk_id3ttl">Lyrics</span><span>' +
        ((tags.lyrics || {}).lyrics || '-') +
        '</span></div>';

      if ('picture' in tags) {
        const image = tags.picture;
        let base64str = '';
        for (let i = 0; i < image.data.length; ++i) {
          base64str += String.fromCharCode(image.data[i]);
        }

        markup +=
          '<div><span style="float:left" class="pk_id3ttl">Cover</span>' +
          '<span><img style="max-width:340px" src="data:' +
          image.format +
          ';base64,' +
          window.btoa(base64str) +
          '"/></span></div>';
      }

      element.innerHTML = markup + '</div>';
    };

    new SimpleModal({
      title: 'ID3 Metatags Explorer',

      ondestroy: function (modal) {
        app.ui.InteractionHandler.forceUnset(modalId);
        app.ui.KeyHandler.removeCallback(modalId + 'esc');
      },

      buttons: [],
      body:
        '<input type="file" accept="audio/*" />' +
        '<div class="pk_row pk_ttx">Choose file to view audio metatags!</div>',
      setup: function (modal) {
        const input = modal.bodyElement.getElementsByTagName('input')[0];
        const textElement = modal.bodyElement.getElementsByClassName('pk_ttx')[0];

        input.onchange = function (e) {
          const reader = new FileReader();

          reader.onload = function () {
            const tags = app.engine.ID3(this.result);

            if (!tags) {
              textElement.innerHTML =
                '<div style="padding:30px 0">No audio metadata found...</div>';
            } else {
              renderTags(textElement, tags);
            }
          };

          reader.readAsArrayBuffer(this.files[0]);
        };

        if (currentTags) {
          renderTags(textElement, currentTags);
        }

        app.ui.InteractionHandler.forceSet(modalId);
        app.ui.KeyHandler.addCallback(
          modalId + 'esc',
          function (e) {
            if (!app.ui.InteractionHandler.check(modalId)) return;
            modal.Destroy();
          },
          [27]
        );
      },
    }).Show();
  });

  // ---- save presets
  app.listenFor('RequestSavePreset', function () {
    if (!currentFilterUi) return;

    const element = currentFilterUi.bodyElement;
    if (!element) return;

    const escapeHtml = function (text) {
      const map = {
        '&': '&amplitude;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      };

      return text.replace(/[&<>"']/g, function (m) {
        return map[m];
      });
    };

    // check if the preset is custom
    let isNew = true;
    let customId = null;
    const presetSelectElement = currentFilterUi.presetSelectElement;
    const selectedOption = presetSelectElement.options[presetSelectElement.selectedIndex];

    const inputs = element.querySelectorAll('select, input');
    const presetObject = {
      target: currentFilterUi.id,
      name: 'My Preset',
      id: currentFilterUi.id + '_' + ((Math.random() * 99) >> 0),
      date: Date.now(),
      val: '',
    };

    if (selectedOption && selectedOption.getAttribute('data-custom')) {
      isNew = false;
      customId = selectedOption.getAttribute('data-custom');
    }

    // ----------
    for (let i = 0; i < inputs.length; ++i) {
      if (inputs[i].type === 'checkbox') {
        presetObject.val += (inputs[i].checked ? '1' : '0') + ',';
      } else {
        presetObject.val += inputs[i].value + ',';
      }
    }

    if (presetObject.val.length > 0) {
      presetObject.val = presetObject.val.substring(0, presetObject.val.length - 1);

      // open ui for setting preset name
      const modalId = '_ctPr';
      let defaultText = '';

      let buttonDelete = {};
      let buttonUpdate = {};
      let customObject = null;

      if (!isNew) {
        customObject = customPresets.GetSingle(presetObject.target, customId);
        defaultText = 'value="' + customObject.name + '"';

        buttonDelete = {
          title: 'Delete',
          className: 'pk_modal_action_danger',
          callback: function (modal) {
            showToast('Successfully deleted preset!', 1400);

            const custom = customPresets.Del(presetObject.target, customId);
            app.fireEvent('DidSetPresets', presetObject.target, custom);

            modal.Destroy();
            // -
          },
        };

        buttonUpdate = {
          title: 'Update',
          callback: function (modal) {
            if (customObject) {
              const input = modal.bodyElement.getElementsByTagName('input')[0];
              let value = input.value.trim();

              value = escapeHtml(value);

              if (value.length > 0) {
                showToast('Successfully updated preset!', 1400);

                // add preset to localStorage
                customObject.name = value;
                customObject.val = presetObject.val;

                customPresets.Save();

                const presetList = customPresets.Get(presetObject.target);
                app.fireEvent('DidSetPresets', presetObject.target, presetList);

                modal.Destroy();
              } else {
                showToast('Name is too short...', 1200);
              }
            }
            // -
          },
        };
      }

      let title = 'Save Custom Preset for filter "' + currentFilterUi.id + '"';
      if (!isNew) {
        const cname = customObject.name;
        title = 'Edit Custom Preset "' + cname + '", for filter "' + currentFilterUi.id + '"';
      }

      new SimpleModal({
        title: title,

        ondestroy: function (modal) {
          app.ui.InteractionHandler.forceUnset(modalId);

          app.ui.KeyHandler.removeCallback(modalId + 'esc');
          app.ui.KeyHandler.removeCallback(modalId + 'ent');
        },

        buttons: [
          {
            title: isNew ? 'Save' : 'Save As New',
            className: 'pk_modal_action_accept',
            callback: function (modal) {
              const input = modal.bodyElement.getElementsByTagName('input')[0];
              let value = input.value.trim();

              value = escapeHtml(value);

              if (value.length > 0) {
                showToast('Successfully saved preset!', 1400);

                // add preset to localStorage
                presetObject.name = value;

                const custom = customPresets.Set(presetObject.target, presetObject);

                app.fireEvent('DidSetPresets', presetObject.target, custom);
                app.fireEvent('RequestSetPresetActive', presetObject.target, presetObject.id);

                modal.Destroy();
              } else {
                showToast('Name is too short...', 1200);
              }
              // -
            },
          },

          buttonUpdate,
          buttonDelete,
        ],
        body:
          '<label for="k07">Preset Name</label>' +
          '<input style="min-width:340px" maxlength="16" placeholder="Please type a name, eg: My Preset" ' +
          defaultText +
          ' class="pk_text" type="text" id="k07" />',
        setup: function (modal) {
          // app.fireEvent ('RequestPause');

          app.ui.InteractionHandler.forceSet(modalId);

          app.ui.KeyHandler.addCallback(
            modalId + 'esc',
            function (e) {
              if (!app.ui.InteractionHandler.check(modalId)) return;

              modal.Destroy();
            },
            [27]
          );

          app.ui.KeyHandler.addCallback(
            modalId + 'en',
            function (e) {
              if (!app.ui.InteractionHandler.check(modalId)) return;

              modal.elements.bottom[0].click();
            },
            [13]
          );

          setTimeout(function () {
            if (modal.element) {
              const inp = modal.element.getElementsByTagName('input')[0];
              inp.focus();

              if (inp.value.length > 0) {
                inp.selectionStart = inp.selectionEnd = inp.value.length;
              }
            }
          }, 20);
        },
      }).Show();
      // ---
    }

    // document.querySelector('.pk_modal_main').getElementsByTagName('input')[0].value
  });

  // ---- windows ----

  let equalizerWindow = {};

  app.listenFor('WillUnload', function () {
    let current;

    for (const k in equalizerWindow) {
      current = equalizerWindow[k];
      if (current && !current.type) {
        current.destroy && current.destroy();
      }
    }

    equalizerWindow = {};
  });

  app.listenFor('RequestDragI', function (url) {
    if (app.isMobile) {
      alert('unsupported on mobile');
      return;
    }

    const currentWindow = equalizerWindow[url];

    if (!currentWindow || !currentWindow.element) return;

    currentWindow.element.style.pointerEvents = 'none';
    currentWindow.element.style.zIndex = '9';

    currentWindow.win.document.body.classList.add('c');

    let backdropElement = document.createElement('div');
    backdropElement.className = 'pk_modal_back';
    document.body.appendChild(backdropElement);

    let isDrag = true;
    let x = 0;
    let y = 0;
    let moved = 2;

    let top = parseInt(currentWindow.element.style.top) || 0;
    let left = parseInt(currentWindow.element.style.left) || 0;

    app.ui.InteractionHandler.on = true;

    setTimeout(function () {
      if (currentWindow && currentWindow.element) {
        currentWindow.element.style.display = 'none';
        setTimeout(function () {
          currentWindow.element.style.display = 'block';
        }, 0);
        backdropElement.focus();
      }
    }, 60);

    backdropElement.onmousemove = function (e) {
      if (!isDrag) return;

      if (x === 0 && y === 0) {
        x = e.pageX;
        y = e.pageY;

        return;
      }

      const distanceX = e.pageX - x;
      const distanceY = e.pageY - y;

      top += distanceY;
      left += distanceX;

      currentWindow.element.style.top = top + 'px';
      currentWindow.element.style.left = left + 'px';

      x = e.pageX;
      y = e.pageY;

      --moved;
    };

    backdropElement.onmouseup = function (e) {
      isDrag = false;

      currentWindow.win.document.body.classList.remove('c');
      currentWindow.element.style.pointerEvents = '';
      currentWindow.element.style.zIndex = '7';

      app.ui.InteractionHandler.on = false;

      document.body.removeChild(backdropElement);

      if (e.type === 'mouseup') {
        if (moved > 0) {
          currentWindow.element.style.top = '0px';

          const ch = app.ui.BarBtm.element.childNodes;

          let lw = 0;
          for (let ji = 0; ji < ch.length; ++ji) {
            if (currentWindow.element === ch[ji]) break;
            lw += ch[ji].clientWidth + 18;
          }

          currentWindow.element.style.left = lw + 'px';
          // ----
        }
        // check if we didn't move - in that return
      }

      backdropElement.onmousemove = null;
      backdropElement.onmouseleave = null;
      backdropElement.onmouseup = null;
      backdropElement = null;
    };

    backdropElement.onmouseleave = function (e) {
      backdropElement.onmouseup(e);
      app.fireEvent('RequestShowFreqAn', url, [
        [window.screenLeft + e.pageX || 0, window.screenTop + e.pageY || 0],
        0,
      ]);
    };
  });

  app.listenFor('RequestShowFreqAn', function (url, argsArray) {
    if (app.isMobile) {
      alert('Currently unsupported on mobile');
      return;
    }

    const toggle = argsArray[0];
    const type = argsArray[1];
    let title = 'Frequency Analysis';
    let currentWindow = equalizerWindow[url];

    if (url === 'sp') title = 'Spectrum Analysis';

    let toggled = false;
    if (currentWindow && toggle) {
      let ext = false;
      if (currentWindow.type === type) ext = true;

      currentWindow.destroy();
      currentWindow = null;

      equalizerWindow[url] = null;

      if (ext) return;
      toggled = true;
    }

    const frequencyCallback = function (_, freq) {
      currentWindow && currentWindow.win.update && currentWindow.win.update(freq);
    };

    const setEvents = function (analyzerWindow, _url) {
      analyzerWindow.win.destroy = function () {
        app.stopListeningFor('DidAudioProcess', frequencyCallback);
        app.fireEvent('DidToggleFreqAn', _url, null);

        // if (analyzerWindow && analyzerWindow.type === undefined) {
        if (analyzerWindow && analyzerWindow === equalizerWindow[url]) {
          equalizerWindow[url] = null;
        }

        let stop = true;
        for (const k in equalizerWindow) {
          if (equalizerWindow[k]) {
            stop = false;
            break;
          }
        }

        if (stop) app.engine.wavesurfer.backend.logFrequencies = false;
      };

      app.listenFor('DidAudioProcess', frequencyCallback);
      app.fireEvent('DidToggleFreqAn', _url, currentWindow);
      app.engine.wavesurfer.backend.logFrequencies = true;
    };

    if (!type) {
      const makePopup = function (dat) {
        let extra = '';
        if (dat && dat[0]) {
          dat[0] = Math.max(0, dat[0] - 200) >> 0;
          dat[1] = Math.max(0, dat[1]) >> 0;

          extra = ',left=' + dat[0] + ',top=' + dat[1];
        }

        const wnd = window.open(
          '/' + url + '.html',
          title,
          'directories=no,titlebar=no,toolbar=no,' +
            'location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=600,height=188' +
            extra
        );

        if (!wnd) {
          showToast('Please allow pop-ups for AudioMass!', 3600, 'pk_r');
          return;
        }

        equalizerWindow[url] = {
          type: type,
          element: null,
          win: wnd,
          destroy: function () {
            wnd && wnd.close && wnd.close();
          },
        };

        currentWindow = equalizerWindow[url];

        // wnd.moveTo(500, 100);

        setEvents(currentWindow, url);
      };

      if (!toggled) makePopup(toggle);
      else
        setTimeout(function () {
          makePopup(toggle);
        }, 130);
    } else if (type === 1) {
      let iframe = document.createElement('iframe');
      iframe.className = 'pk_frqan';
      iframe.id = 'pk_fr' + url;

      if (app.ui.BarBtm.on) {
        const ch = app.ui.BarBtm.element.childNodes;
        let lw = 0;
        for (let ji = 0; ji < ch.length; ++ji) {
          lw += ch[ji].clientWidth + 18;
        }

        iframe.style.left = lw + 'px';
      }

      app.ui.BarBtm.element.appendChild(iframe);
      app.ui.BarBtm.Show();

      equalizerWindow[url] = {
        type: type,
        element: iframe,
        win: null,
        destroy: function () {
          iframe.parentNode.removeChild(iframe);
          iframe = null;

          const ch = app.ui.BarBtm.element.childNodes;
          if (ch.length === 0) {
            app.ui.BarBtm.Hide();
            return;
          }

          setTimeout(function () {
            let lw = 0;
            for (let ji = 0; ji < ch.length; ++ji) {
              if (!ch[ji] || !ch[ji].parentNode) continue;

              if (ch[ji].offsetTop > -20) {
                ch[ji].style.top = '0px';
                ch[ji].style.left = lw + 'px';
              }

              lw += ch[ji].clientWidth + 18;
            }
          }, 198);
          // --
        },
      };

      currentWindow = equalizerWindow[url];

      iframe.onload = function (e) {
        if (currentWindow && currentWindow.type === type) {
          currentWindow.win = iframe.contentWindow;
          setEvents(currentWindow, url);
        }
      };
      iframe.src = '/' + url + '.html?iframe=1';
    }
    // ---
  });

  // ----
}
