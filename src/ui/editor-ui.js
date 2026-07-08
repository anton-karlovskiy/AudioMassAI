/**
 * The main editor UI.
 *
 * Builds the whole interface: top menu bar, transport/editing toolbar,
 * footer (time readout, volume meters, zoom), bottom dock for analyzer
 * iframes, waveform context menu, drag-and-drop loading, and mobile layout.
 * Also owns the InteractionHandler that gates keyboard shortcuts while a
 * modal or menu is open.
 */

import { KeyboardShortcuts } from './keyboard-shortcuts.js';
import { SimpleModal } from './modals.js';
import { ContextMenu } from './context-menu.js';
import { showToast } from './toast.js';
import { showWelcomeModal } from './welcome-modal.js';
import { enableFileDrop } from './drag-drop.js';

export function EditorUI(app) {
  const ui = this;

  this.el = app.el;
  this.app = app;

  // if mobile add proper class
  this.el.className += ' pk_app' + (app.isMobile ? ' pk_mob' : '');

  // hold refferences to the event functions
  this.fireEvent = app.fireEvent;
  this.listenFor = app.listenFor;

  // keep track of the active UI element
  this.InteractionHandler = {
    on: false,
    by: null,
    arr: [],

    check: function (_name) {
      if (this.on && this.by !== _name) {
        return false;
      }
      return true;
    },

    checkAndSet: function (_name) {
      if (!this.check(_name)) return false;

      this.on = true;
      this.by = _name;

      return true;
    },

    forceSet: function (_name) {
      if (this.on) {
        this.arr.push({
          on: this.on,
          by: this.by,
        });
      }

      this.on = true;
      this.by = _name;
    },

    forceUnset: function (_name) {
      if (this.check(_name)) {
        const prev = this.arr.pop();
        if (prev) {
          this.on = prev.on;
          this.by = prev.by;
        } else {
          this.on = false;
          this.by = null;
        }
      }
      // ---
    },
  };

  if (app.isMobile) {
    document.body.className = 'pk_stndln';
    const fxd = document.createElement('div');
    fxd.className = 'pk_fxd';
    fxd.appendChild(this.el);

    document.body.appendChild(fxd);

    _makeMobileScroll(this);
  }

  this.KeyHandler = new KeyboardShortcuts(); // global keyboard shortcuts
  this.TopHeader = new _makeUITopHeader(_topbarConfig(app), this); // topmost menu
  this.Toolbar = new _makeUIToolbar(this); // main toolbar and controls
  this.footer = new _makeUIMainView(this, app);
  this.BarBtm = new _makeUIBarBottom(this, app);

  this.Dock = function (id, arg1, arg2) {
    app.fireEvent(id, arg1, arg2);
  };

  app.listenFor('ShowError', function (message) {
    new SimpleModal({
      title: 'Oops! Something is not right',
      clss: 'pk_modal_anim',
      ondestroy: function (ui) {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback('modalTempErr');
      },
      buttons: [],
      body: '<p>' + message + '</p>',
      setup: function (ui) {
        app.fireEvent('RequestPause');
        app.fireEvent('RequestRegionClear');

        app.ui.InteractionHandler.checkAndSet('modal');
        app.ui.KeyHandler.addCallback(
          'modalTempErr',
          function (e) {
            ui.Destroy();
          },
          [27]
        );
      },
    }).Show();
  });

  app.listenFor('RequestKeyDown', function (key) {
    ui.KeyHandler.keyDown(key, null);
    ui.KeyHandler.keyUp(key);
  });
}

//top bar config list
function _topbarConfig(app, ui) {
  return [
    {
      name: 'File',
      children: [
        {
          name: 'Export / Download',
          action: function () {
            new SimpleModal({
              title: 'Export / Download',

              ondestroy: function (modal) {
                app.ui.InteractionHandler.on = false;
                app.ui.KeyHandler.removeCallback('modalTemp');
              },

              buttons: [
                {
                  title: 'Export',
                  clss: 'pk_modal_a_accpt',
                  callback: function (modal) {
                    const input = modal.el_body.getElementsByTagName('input')[0];
                    const value = input.value.trim();

                    let format = 'mp3';
                    let kbps = 128;
                    let export_sel = false;
                    let stereo = false;

                    const radios = modal.el_body.getElementsByClassName('pk_check');
                    let l = radios.length;
                    while (l-- > 0) {
                      if (radios[l].checked) {
                        if (radios[l].name == 'frmtex') {
                          format = radios[l].value;
                        } else if (radios[l].name == 'xport') {
                          if (radios[l].value === 'sel') {
                            const region = app.engine.wavesurfer.regions.list[0];
                            if (!region) export_sel = false;
                            else export_sel = [region.start, region.end];
                          }
                        } else if (radios[l].name == 'chnl') {
                          if (radios[l].value === 'stereo') {
                            stereo = true;
                          }
                        } else {
                          kbps = radios[l].value / 1;
                        }
                      }
                    }

                    if (format == 'flac') {
                      kbps = document.getElementById('flac-comp').value / 1;
                    }

                    app.engine.DownloadFile(value, format, kbps, export_sel, stereo);
                    modal.Destroy();
                    // -
                  },
                },
              ],
              body:
                '<div class="pk_row"><label for="k0">File Name</label>' +
                '<input style="min-width:250px" placeholder="mp3 filename" value="audiomass-output.mp3" ' +
                'class="pk_txt" type="text" id="k0" /></div>' +
                '<div class="pk_row" id="frmtex" style="padding-bottom:4px"><label style="display:inline">Format</label>' +
                '<input type="radio" class="pk_check" id="k01" name="frmtex" checked value="mp3">' +
                '<label for="k01">mp3</label>' +
                '<input type="radio" class="pk_check" id="k02" name="frmtex" value="wav">' +
                '<label for="k02">wav <i>(44100hz)</i></label>' +
                '<input type="radio" class="pk_check" id="k03" name="frmtex" value="flac">' +
                '<label for="k03">flac</i></label>' +
                '</div>' +
                '<div class="pk_row" id="frmtex-mp3"><input type="radio" class="pk_check" id="k1" name="rdslnc" checked value="128">' +
                '<label  for="k1">128kbps</label>' +
                '<input type="radio" class="pk_check"  id="k2" name="rdslnc" value="192">' +
                '<label for="k2">192kbps</label>' +
                '<input type="radio" class="pk_check"  id="k3" name="rdslnc" value="256">' +
                '<label for="k3">256kbps</label></div>' +
                '<div class="pk_row" style="display:none" id="frmtex-flac">' +
                '<label>Flac: Compression Level</label>' +
                '<input type="range" class="pk_horiz" min="0" max="8" step="1" value="5" id="flac-comp">' +
                '<span class="pk_val" style="float:left;margin-left:15px">5</span></div>' +
                '<div class="pk_row" style="padding-bottom:5px">' +
                '<input type="radio" class="pk_check" id="k6" name="chnl" checked value="mono">' +
                '<label for="k6">Mono</label>' +
                '<input type="radio" class="pk_check pk_stereo" id="k7" name="chnl" value="stereo">' +
                '<label for="k7">Stereo</label>' +
                '</div>' +
                '<div class="pk_row">' +
                '<input type="radio" class="pk_check" id="k4" name="xport" checked value="whole">' +
                '<label for="k4">Export whole file</label>' +
                '<input type="radio" class="pk_check" id="k5" name="xport" value="sel">' +
                '<label class="pk_lblmp3" for="k5">Export Selection Only</label></div>',

              setup: function (modal) {
                const wv = app.engine.wavesurfer;
                //console.log( document.getElementById('frmtex') );

                // if no region
                const region = wv.regions.list[0];
                if (!region) {
                  const lbl = modal.el_body.getElementsByClassName('pk_lblmp3')[0];
                  lbl.className = 'pk_dis';
                }

                const chan_num = wv.backend.buffer.numberOfChannels;
                if (chan_num === 2) {
                  modal.el_body.getElementsByClassName('pk_stereo')[0].checked = true;
                }

                app.fireEvent('RequestPause');
                app.ui.InteractionHandler.checkAndSet('modal');
                app.ui.KeyHandler.addCallback(
                  'modalTemp',
                  function (e) {
                    modal.Destroy();
                  },
                  [27]
                );

                setTimeout(function () {
                  if (!modal.el) return;
                  const inputtxt = modal.el.getElementsByTagName('input')[0];
                  inputtxt && inputtxt.select();

                  const format = document.getElementById('frmtex');
                  const mp3conf = document.getElementById('frmtex-mp3');
                  const flacconf = document.getElementById('frmtex-flac');

                  document.getElementById('flac-comp').oninput = function () {
                    this.parentNode.getElementsByTagName('span')[0].innerText = this.value;
                  };

                  format &&
                    format.addEventListener(
                      'change',
                      function (e) {
                        const inputs = this.getElementsByTagName('input');
                        for (let i = 0; i < inputs.length; ++i) {
                          if (inputs[i].checked) {
                            if (inputs[i].value === 'mp3') {
                              mp3conf.style.display = 'block';
                              flacconf.style.display = 'none';
                              inputtxt.value = inputtxt.value
                                .replace('.wav', '.mp3')
                                .replace('.flac', '.mp3');
                            } else if (inputs[i].value === 'flac') {
                              mp3conf.style.display = 'none';
                              flacconf.style.display = 'block';
                              inputtxt.value = inputtxt.value
                                .replace('.mp3', '.flac')
                                .replace('.wav', '.flac');
                            } else {
                              mp3conf.style.display = 'none';
                              flacconf.style.display = 'none';
                              inputtxt.value = inputtxt.value
                                .replace('.mp3', '.wav')
                                .replace('.flac', '.wav');
                            }
                          }
                        }
                      },
                      false
                    );
                }, 20);
              },
            }).Show();
          },
          clss: 'pk_inact',
          setup: function (obj) {
            obj.setAttribute('data-id', 'dl');

            app.listenFor('DidUnloadFile', function () {
              obj.classList.add('pk_inact');
            });
            app.listenFor('DidLoadFile', function () {
              obj.classList.remove('pk_inact');
            });
          },
        },

        {
          name: 'Load from Computer',
          type: 'file',
          action: function (e) {
            app.fireEvent('RequestLoadLocalFile');
          },
        },

        {
          name: 'Load Sample File',
          action: function (e) {
            app.engine.LoadSample();
          },
        },

        {
          name: 'Load From URL',
          action: function (e) {
            new SimpleModal({
              title: 'Load audio from remote url',

              ondestroy: function (modal) {
                app.ui.InteractionHandler.on = false;
                app.ui.KeyHandler.removeCallback('modalTemp');
                app.ui.KeyHandler.removeCallback('modalTempEnter');
              },

              buttons: [
                {
                  title: 'Load Asset',
                  clss: 'pk_modal_a_accpt',
                  callback: function (modal) {
                    const input = modal.el_body.getElementsByTagName('input')[0];
                    const value = input.value.trim();

                    function isURL(str) {
                      const pattern = new RegExp(
                        '^((https?:)?\\/\\/)?' + // protocol
                          '(?:\\S+(?::\\S*)?@)?' + // authentication
                          '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
                          '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
                          '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
                          '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
                          '(\\#[-a-z\\d_]*)?$',
                        'i'
                      ); // fragment locater
                      if (!pattern.test(str)) {
                        return false;
                      } else {
                        return true;
                      }
                    }

                    if (isURL(value)) {
                      // LOAD FROM URL....
                      app.engine.LoadURL(value);
                      modal.Destroy();
                    } else {
                      showToast('Invalid URL entered', 1100);
                    }
                    // -
                  },
                },
              ],
              body:
                '<label for="k00">Insert url</label>' +
                '<input style="min-width:250px" placeholder="Please insert url" class="pk_txt" type="text" id="k00" />',
              setup: function (modal) {
                app.fireEvent('RequestPause');
                app.ui.InteractionHandler.checkAndSet('modal');
                app.ui.KeyHandler.addCallback(
                  'modalTemp',
                  function (e) {
                    modal.Destroy();
                  },
                  [27]
                );

                app.ui.KeyHandler.addCallback(
                  'modalTempEnter',
                  function (e) {
                    modal.els.bottom[0].click();
                  },
                  [13]
                );

                setTimeout(function () {
                  modal.el && modal.el.getElementsByTagName('input')[0].focus();
                }, 20);
              },
            }).Show();
          },
          // ---
        },

        {
          name: 'New Recording',
          action: function (e) {
            app.fireEvent('RequestActionNewRec');
          },
        },

        {
          name: 'Save Draft Locally',
          clss: 'pk_inact',
          action: function (e) {
            if (!app.engine.is_ready) return;

            const saving = function (type, name) {
              let buff = app.engine.wavesurfer.backend.buffer;

              if (type === 'copy') buff = app.engine.GetCopyBuff();
              else if (type === 'sel') buff = app.engine.GetSel();

              const func = function (fls) {
                const rr = Math.random().toString(36).substring(7);

                fls.SaveSession(buff, rr, name);
                app.stopListeningFor('DidOpenDB', func);
              };

              app.listenFor('DidOpenDB', func);

              if (!app.fls.on)
                app.fls.Init(function (err) {
                  if (err) {
                    alert('db error');
                  }
                });
              else app.fireEvent('DidOpenDB', app.fls);
            };

            // modal that asks for - full file, selection, copy buffer
            new SimpleModal({
              title: 'Save Local Draft of...',

              ondestroy: function (modal) {
                app.ui.InteractionHandler.on = false;
                app.ui.KeyHandler.removeCallback('modalTempErr');
              },

              buttons: [
                {
                  title: 'Save',
                  clss: 'pk_modal_a_accpt',
                  callback: function (modal) {
                    let type = 'whole';
                    const input = modal.el_body.getElementsByTagName('input');
                    let name = input[input.length - 1].value;
                    if (name) {
                      name = name.trim();
                      if (name.length >= 100) name = name.substr(0, 99).trim();
                      if (name.length === 0) name = null;
                    } else {
                      name = null;
                    }

                    for (let i = 0; i < input.length; ++i) {
                      if (input[i].checked) {
                        type = input[i].value;
                        break;
                      }
                    }

                    saving(type, name);

                    modal.Destroy();
                  },
                },
              ],

              body:
                '<p>Please choose source...</p>' +
                '<div class="pk_row"><input type="radio" class="pk_check" id="sl1" name="rdslnc" checked value="whole">' +
                '<label style="vertical-align:top" for="sl1">Whole Track</label>' +
                '<input type="radio" class="pk_check"  id="sl2" name="rdslnc" value="sel">' +
                '<label style="vertical-align:top" class="pk_lblsel" for="sl2">Selection' +
                '<i style="display:block;font-size:11px;margin-top:-5px"></i></label>' +
                '<input type="radio" class="pk_check"  id="sl3" name="rdslnc" value="copy">' +
                '<label style="vertical-align:top" class="pk_lblsel2" for="sl3">"Copy" clipboard/buffer</label></div>' +
                '<div class="pk_row"><label for="slk0">Draft Name</label>' +
                '<input style="min-width:250px" placeholder="(optional) filename" maxlength="100" ' +
                'class="pk_txt" type="text" id="slk0" /></div>',

              setup: function (modal) {
                // check if selection
                const wv = app.engine.wavesurfer;

                // if no region
                const region = wv.regions.list[0];
                const lblr = modal.el_body.getElementsByClassName('pk_lblsel')[0];
                if (!region) {
                  lblr.className = 'pk_dis';
                } else {
                  modal.el_body.getElementsByClassName('pk_check')[1].checked = true;
                  lblr.childNodes[1].textContent =
                    app.ui.formatTime(region.start) + ' to ' + app.ui.formatTime(region.end);
                }

                // if no copy buffer
                const copy = app.engine.GetCopyBuff();
                if (!copy) {
                  const lbl = modal.el_body.getElementsByClassName('pk_lblsel2')[0];
                  lbl.className = 'pk_dis';
                }

                if (!app.isMobile) {
                  setTimeout(function () {
                    modal.el && modal.el.getElementsByClassName('pk_txt')[0].focus();
                  }, 20);
                }

                app.fireEvent('RequestPause');

                app.ui.InteractionHandler.checkAndSet('modal');
                app.ui.KeyHandler.addCallback(
                  'modalTempErr',
                  function (e) {
                    modal.Destroy();
                  },
                  [27]
                );
              },
            }).Show();

            return;
          },

          setup: function (obj) {
            app.listenFor('DidUnloadFile', function () {
              obj.classList.add('pk_inact');
            });
            app.listenFor('DidLoadFile', function () {
              obj.classList.remove('pk_inact');
            });

            app.listenFor('DidStoreDB', function (obj, e) {
              const name = obj.id;
              const txt =
                '<div style="padding:2px 0">id: ' +
                name +
                '</div>' +
                '<div style="padding:2px 0"><span>durr: ' +
                obj.durr +
                's</span>' +
                '&nbsp;&nbsp;&nbsp;' +
                '<span>chan: ' +
                (obj.chans === 1 ? 'mono' : 'stereo') +
                '</span></div>' +
                '<div style="padding:2px 0"><img src="' +
                obj.thumb +
                '" /></div>';

              new SimpleModal({
                title: 'Succesfully Stored',

                ondestroy: function (modal) {
                  app.ui.InteractionHandler.on = false;
                  app.ui.KeyHandler.removeCallback('modalTempErr');
                },

                buttons: [
                  {
                    title: 'OPEN IN NEW WINDOW',
                    callback: function (modal) {
                      window.open(window.location.pathname + '?local=' + name);

                      modal.Destroy();
                    },
                  },
                ],

                body: '<p>Open in new window?</p>' + txt,
                setup: function (modal) {
                  app.fireEvent('RequestPause');
                  app.fireEvent('RequestRegionClear');

                  app.ui.InteractionHandler.checkAndSet('modal');
                  app.ui.KeyHandler.addCallback(
                    'modalTempErr',
                    function (e) {
                      modal.Destroy();
                    },
                    [27]
                  );
                },
              }).Show();
            });
          },
        },

        {
          name: 'Open Local Drafts',
          action: function (e) {
            let datenow = new Date();
            const time_ago = function (arg) {
              let a = ((datenow - arg) / 1e3) >> 0;
              if (59 >= a) return ((datenow = 1 < a ? 's' : ''), a + ' second' + datenow + ' ago');
              if (60 <= a && 3599 >= a)
                return ((a = Math.floor(a / 60)), a + ' minute' + (1 < a ? 's' : '') + ' ago');
              if (3600 <= a && 86399 >= a)
                return ((a = Math.floor(a / 3600)), a + ' hour' + (1 < a ? 's' : '') + ' ago');
              if (86400 <= a && 2592030 >= a)
                return ((a = Math.floor(a / 86400)), a + ' day' + (1 < a ? 's' : '') + ' ago');
              if (2592031 <= a)
                return ((a = Math.floor(a / 2592e3)), a + ' month' + (1 < a ? 's' : '') + ' ago');
            };
            const func = function (fls) {
              fls.ListSessions(function (ret) {
                let msg = '';
                if (ret.length === 0) {
                  msg += 'No drafts found...';
                } else {
                  for (let i = 0; i < ret.length; ++i) {
                    const curr = ret[i];
                    const date = new Date(curr.created);
                    const datestr =
                      date.getMonth() +
                      1 +
                      '/' +
                      date.getDate() +
                      '/' +
                      date.getFullYear() +
                      '  ' +
                      date.getHours() +
                      ':' +
                      date.getMinutes() +
                      ':' +
                      date.getSeconds();
                    const agostr = time_ago(date);
                    const filename = curr.name || '-';
                    const duration = curr.durr;
                    const thumb = curr.thumb;
                    const chns = curr.chans === 1 ? 'mono' : 'stereo';

                    msg +=
                      '<div id="pk_' +
                      curr.id +
                      '" class="pk_lcldrf">' +
                      '<div style="padding-bottom:2px"><span><i class="pk_i">name:</i>' +
                      filename +
                      '</span></div>' +
                      '<div><span class="pk_lcls"><i class="pk_i">id:</i><strong>' +
                      curr.id +
                      '</strong><br/><i class="pk_i">chn:</i>' +
                      chns +
                      '</span>' +
                      '<span class="pk_lcls" style="width:50%;text-align:center"><i class="pk_i">date:</i><span>' +
                      datestr +
                      '<br/>' +
                      agostr +
                      '</span></span>' +
                      '<span style="text-align:right;float:right" class="pk_lcls"><i class="pk_i">durr:</i>' +
                      duration +
                      's</span></div><div>' +
                      '<img class="pk_lcli" src="' +
                      thumb +
                      '" />' +
                      '<a class="pk_lcla2" onclick="PKAudioEditor.fireEvent(\'LoadDraft\',\'' +
                      curr.id +
                      '\', 3);">PLAY</a>' +
                      '<a class="pk_lcla" onclick="PKAudioEditor.fireEvent(\'LoadDraft\',\'' +
                      curr.id +
                      '\');">Open</a>';

                    if (app.engine.is_ready) {
                      msg +=
                        "<a onclick=\"PKAudioEditor.fireEvent('LoadDraft','" +
                        curr.id +
                        '\',1);" class="pk_lcla">Append to Current Track</a>';
                    }
                    msg +=
                      '<a class="pk_lcla" style="color:#ad2b2b" onclick="PKAudioEditor.fireEvent(\'LoadDraft\',\'' +
                      curr.id +
                      '\',2);">Del</a>';
                    msg += '</div></div>';
                  }
                }

                let modal;
                const closeModal = function (val, val2) {
                  if (val2 === 2 || val2 === 3) return;

                  modal.Destroy();
                  modal = null;
                };

                const set_act_btn = function (name, state) {
                  let act;
                  if (!state) {
                    act = modal.el_body.getElementsByClassName('pk_act')[0];
                    if (act) {
                      act.classList.remove('pk_act');
                    }
                  } else {
                    const el = document.getElementById('pk_' + name);
                    if (el) {
                      act = el.getElementsByClassName('pk_lcla2')[0];
                      act && act.classList.add('pk_act');
                    }
                  }
                  // --
                };

                app.listenFor('_lclStart', set_act_btn);

                modal = new SimpleModal({
                  title: 'Local Drafts',
                  clss: 'pk_bigger',

                  ondestroy: function (modal) {
                    app.fireEvent('_lclStop');

                    app.ui.InteractionHandler.on = false;
                    app.ui.KeyHandler.removeCallback('modalTempErr');
                    app.stopListeningFor('LoadDraft', closeModal);
                    app.stopListeningFor('_lclStart', set_act_btn);
                  },

                  buttons: [],

                  body: '<div>' + msg + '</div>',
                  setup: function (modal) {
                    app.fireEvent('RequestPause');
                    app.fireEvent('RequestRegionClear');

                    app.listenFor('LoadDraft', closeModal);

                    app.ui.InteractionHandler.checkAndSet('modal');
                    app.ui.KeyHandler.addCallback(
                      'modalTempErr',
                      function (e) {
                        modal.Destroy();
                      },
                      [27]
                    );
                  },
                });

                modal.Show();
              });

              app.stopListeningFor('DidOpenDB', func);
            };

            app.listenFor('DidOpenDB', func);

            if (!app.fls.on)
              app.fls.Init(function (err) {
                if (err) {
                  alert('db error');
                }
              });
            else app.fireEvent('DidOpenDB', app.fls);
          },
          setup: function () {
            let source = {};

            app.listenFor('_lclStop', function (name, append) {
              if (source.src) {
                source.src.stop();
                source.src.disconnect();
                source.src.onended = null;
                source.aud.close && source.aud.close();
                source = {};
              }
            });

            app.listenFor('LoadDraft', function (name, append) {
              app.fls.Init(function (err) {
                if (err) return;

                if (append === 2) {
                  if (source.id === name) {
                    app.fireEvent('_lclStart', source.id, 0);
                    source.src.stop();
                    source.src.disconnect();
                    source.src.onended = null;
                    source.aud.close && source.aud.close();
                    source = {};
                  }

                  app.fls.DelSession(name, function (name) {
                    const id = 'pk_' + name;
                    let el = document.getElementById(id);

                    if (el) {
                      if (el.parentNode.children.length === 1) {
                        el.parentNode.innerHTML = 'No drafts found...';
                      } else el.parentNode.removeChild(el);

                      el = null;
                    }
                  });
                  return;
                }

                if (append === 3) {
                  if (source.id) {
                    let xt = false;
                    if (source.id === name) xt = true;

                    app.fireEvent('_lclStart', source.id, 0);
                    source.src.stop();
                    source.src.disconnect();
                    source.src.onended = null;
                    source.aud.close && source.aud.close();

                    source = {};

                    if (xt) return;
                  }

                  // generate audio context here...
                  const aud_cont = new (window.AudioContext || window.webkitAudioContext)();
                  if (aud_cont && aud_cont.state == 'suspended') {
                    aud_cont.resume && aud_cont.resume();
                  }

                  app.fls.GetSession(name, function (e) {
                    if (e && e.id === name) {
                      source.id = e.id;
                      source.aud = aud_cont;
                      source.src = app.engine.PlayBuff(e.data, e.chans, e.samplerate, aud_cont);
                      if (!source.src) {
                        source.aud && source.aud.close && source.aud.close();
                        source = {};

                        return;
                      }

                      source.src.onended = function (e) {
                        app.fireEvent('_lclStart', source.id, 0);
                        source.src.stop();
                        source.src.disconnect();
                        source.src.onended = null;
                        source.aud.close && source.aud.close();

                        source = {};
                      };

                      app.fireEvent('_lclStart', e.id, 1);
                    }
                  });
                  return;
                }

                let overwrite = (function (app, name, append) {
                  return function () {
                    app.fls.GetSession(name, function (e) {
                      if (e && e.id === name) {
                        app.engine.wavesurfer.backend._add = append ? 1 : 0;
                        app.engine.LoadDB(e);
                      }
                    });
                  };
                })(app, name, append);

                // --- ask if we want to click the first one
                if (app.engine.is_ready && !append) {
                  const mm = new SimpleModal({
                    title: 'Open in Existing?',
                    body: '<div>Open in new window, or in the current one?</div>',
                    buttons: [
                      {
                        title: 'OPEN',
                        clss: 'pk_modal_a_accpt',
                        callback: function (modal) {
                          overwrite();

                          modal.Destroy();
                        },
                      },
                      {
                        title: 'OPEN IN NEW',
                        clss: 'pk_modal_a_accpt',
                        callback: function (modal) {
                          window.open(window.location.pathname + '?local=' + name);
                          modal.Destroy();
                        },
                      },
                    ],
                    setup: function (modal) {
                      app.ui.InteractionHandler.checkAndSet('mm');
                      app.ui.KeyHandler.addCallback(
                        'mmErr',
                        function (e) {
                          modal.Destroy();
                        },
                        [27]
                      );
                    },
                    ondestroy: function (modal) {
                      overwrite = null;
                      app.ui.InteractionHandler.on = false;
                      app.ui.KeyHandler.removeCallback('mmErr');
                    },
                  });

                  setTimeout(function () {
                    mm.Show();
                  }, 0);
                  return;
                }

                overwrite();
                // --
              });
            });
            // ---
          },
        },
        {
          name: 'Transcribe (with AI)',
          clss: 'pk_inact',
          action: function () {
            app.fireEvent('RequestTranscription');
          },
          setup: function (obj) {
            obj.setAttribute('data-id', 'transcribe');

            app.listenFor('DidUnloadFile', function () {
              obj.classList.add('pk_inact');
            });
            app.listenFor('DidLoadFile', function () {
              obj.classList.remove('pk_inact');
            });
          },
        },
      ],
    },
    {
      name: 'Edit',
      children: [
        {
          name: 'Undo <span class="pk_shrtct">Shft+Z</span>',
          clss: 'pk_inact',
          action: function () {
            app.fireEvent('StateRequestUndo');
          },
          setup: function (obj) {
            app.listenFor('DidStateChange', function (undo_states, redo_states) {
              if (undo_states.length === 0) {
                obj.innerHTML = 'Undo <span class="pk_shrtct">Shft+Z</span>';
                obj.classList.add('pk_inact');
              } else {
                obj.innerHTML =
                  'Undo&nbsp;<i style="pointer-events:none">' +
                  undo_states[undo_states.length - 1].desc +
                  '</i><span class="pk_shrtct">Shft+Z</span>';
                obj.classList.remove('pk_inact');
              }
            });
          },
        },

        {
          name: 'Redo <span class="pk_shrtct">Shft+Y</span>',
          clss: 'pk_inact',
          action: function () {
            app.fireEvent('StateRequestRedo');
          },
          setup: function (obj) {
            app.listenFor('DidStateChange', function (undo_states, redo_states) {
              if (redo_states.length === 0) {
                obj.innerHTML = 'Redo <span class="pk_shrtct">Shft+Y</span>';
                obj.classList.add('pk_inact');
              } else {
                obj.innerHTML =
                  'Redo&nbsp;<i style="pointer-events:none">' +
                  redo_states[0].desc +
                  '</i><span class="pk_shrtct">Shft+Y</span>';
                obj.classList.remove('pk_inact');
              }
            });
          },
        },

        {
          name: 'Play <span class="pk_shrtct">Space</span>',
          action: function () {
            app.fireEvent('RequestPlay');
          },
        },

        {
          name: 'Stop',
          action: function () {
            app.fireEvent('RequestStop');
          },
        },

        {
          name: 'Select All <span class="pk_shrtct">Shft+A</span>',
          action: function () {
            app.fireEvent('RequestSelect');
          },
        },

        {
          name: 'Deselect All <span class="pk_shrtct">~</span>',
          action: function () {
            app.fireEvent('RequestDeselect');
          },
        },

        {
          name: 'Channel Info/Flip',
          action: function () {
            app.fireEvent('RequestActionFXUI_Flip');
          },
          clss: 'pk_inact',
          setup: function (obj) {
            app.listenFor('DidUnloadFile', function () {
              obj.classList.add('pk_inact');
            });
            app.listenFor('DidLoadFile', function () {
              obj.classList.remove('pk_inact');
            });
          },
        },
      ],
    },
    {
      name: 'Effects',
      children: [
        {
          name: 'Gain',
          action: function () {
            app.fireEvent('RequestFXUI_Gain');
          },
        },

        {
          name: 'Fade In',
          action: function () {
            app.fireEvent('RequestActionFX_FadeIn');
          },
        },

        {
          name: 'Fade Out',
          action: function () {
            app.fireEvent('RequestActionFX_FadeOut');
          },
        },

        {
          name: 'Noise Reduction (Voice)',
          action: function () {
            app.fireEvent('RequestActionFX_NoiseRNN');
          },
        },

        {
          name: 'Paragraphic EQ',
          action: function () {
            app.fireEvent('RequestActionFXUI_ParaGraphicEQ');
          },
        },

        {
          name: 'Compressor',
          action: function () {
            app.fireEvent('RequestActionFXUI_Compressor');
          },
        },

        {
          name: 'Normalize',
          action: function () {
            app.fireEvent('RequestActionFXUI_Normalize');
          },
        },

        {
          name: 'Graphic EQ',
          action: function () {
            app.fireEvent('RequestActionFXUI_GraphicEQ', 10);
          },
        },

        {
          name: 'Graphic EQ (20 bands)',
          action: function () {
            app.fireEvent('RequestActionFXUI_GraphicEQ', 20);
          },
        },

        {
          name: 'Hard Limiter',
          action: function () {
            app.fireEvent('RequestActionFXUI_HardLimiter');
          },
        },

        {
          name: 'Delay',
          action: function () {
            app.fireEvent('RequestActionFXUI_Delay');
          },
        },

        {
          name: 'Distortion',
          action: function () {
            app.fireEvent('RequestActionFXUI_Distortion');
          },
        },

        {
          name: 'Reverb',
          action: function () {
            app.fireEvent('RequestActionFXUI_Reverb');
          },
        },

        {
          name: 'Speed Up / Slow Down (pitch)',
          action: function () {
            app.fireEvent('RequestActionFXUI_Speed');
          },
        },

        {
          name: 'Playback Rate',
          action: function () {
            app.fireEvent('RequestActionFXUI_Rate');
          },
        },

        {
          name: 'Reverse',
          action: function () {
            app.fireEvent('RequestActionFX_Reverse');
          },
        },

        {
          name: 'Invert',
          action: function () {
            app.fireEvent('RequestActionFX_Invert');
          },
        },

        {
          name: 'Remove Silence',
          action: function () {
            app.fireEvent('RequestActionFX_RemSil');
          },
        },
      ],
    },
    {
      name: 'View',
      children: [
        {
          name: 'Follow Cursor  &#10004;',
          action: function (obj) {
            app.fireEvent('RequestViewFollowCursorToggle');
          },
          setup: function (obj) {
            // perhaps read from stored settings?

            app.listenFor('DidViewFollowCursorToggle', function (val) {
              const txt = 'Follow Cursor';

              if (val) {
                obj.innerHTML = txt + ' &#10004;';
              } else {
                obj.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Peak Separators &#10004;',
          action: function (obj) {
            app.fireEvent('RequestViewPeakSeparatorToggle');
          },
          setup: function (obj) {
            app.listenFor('DidViewPeakSeparatorToggle', function (val) {
              const txt = 'Peak Separators';
              if (val) {
                obj.innerHTML = txt + ' &#10004;';
              } else {
                obj.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Timeline &#10004;',
          action: function (obj) {
            app.fireEvent('RequestViewTimelineToggle');
          },
          setup: function (obj) {
            app.listenFor('DidViewTimelineToggle', function (val) {
              const txt = 'Timeline';
              if (val) {
                obj.innerHTML = txt + ' &#10004;';
              } else {
                obj.textContent = txt;
              }
            });
          },
        },

        {
          name: '---',
        },

        {
          name: 'Frequency Analyser',
          action: function (obj) {
            app.fireEvent('RequestShowFreqAn', 'eq', [1]);
          },
          setup: function (obj) {
            app.listenFor('DidToggleFreqAn', function (url, val) {
              if (url !== 'eq') return;

              const txt = 'Frequency Analyser';
              if (val) {
                obj.innerHTML = txt + ' &#10004;';
              } else {
                obj.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Spectrum Analyser',
          action: function (obj) {
            app.fireEvent('RequestShowFreqAn', 'sp', [1]);
          },
          setup: function (obj) {
            app.listenFor('DidToggleFreqAn', function (url, val) {
              if (url !== 'sp') return;

              const txt = 'Spectrum Analyser';
              if (val) {
                obj.innerHTML = txt + ' &#10004;';
              } else {
                obj.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Tempo Tools',
          action: function (obj) {
            app.fireEvent('RequestActionTempo');
          },
        },

        {
          name: 'ID3 Tags',
          action: function (obj) {
            app.fireEvent('RequestActionID3');
          },
        },

        {
          name: '---',
        },

        {
          name: 'Center to Cursor <span class="pk_shrtct">[Tab]</span>',
          action: function (obj) {
            app.fireEvent('RequestViewCenterToCursor');
          },
        },

        {
          name: 'Reset Zoom <span class="pk_shrtct">[0]</span>',
          action: function (obj) {
            app.fireEvent('RequestZoomUI', 0);
          },
        },
      ],
    },
    {
      name: 'Help',
      children: [
        {
          name: 'About',
          action: function () {
            window.open('/about.html');
          },
        },

        {
          name: 'See Welcome Message',
          action: function () {
            showWelcomeModal(app);
          },
        },
        {
          name: 'SourceCode on Github',
          action: function () {
            window.open('https://github.com/pkalogiros/audiomass');
          },
        },
      ],
    },
  ];
}

//
// TOP-BAR CLASS
//
function _makeUITopHeader(menu_tree, UI) {
  const header = document.createElement('div');
  header.className = 'pk_hdr pk_noselect';

  const _name = 'TopHeader',
    _default_class = 'pk_btn pk_noselect';

  let target_index = -1;
  let target_el = null;
  let target_el_old = null;
  let target_option = null;
  const top_els = [];
  const menu = this;

  // recursively build the interface
  function build_menus(parent_el, tree_obj, level) {
    for (let i = 0; i < tree_obj.length; ++i) {
      const btn_container = document.createElement('div');
      const curr_obj = tree_obj[i];

      if (level === 0) {
        btn_container.className = _default_class;
        const btn = document.createElement('button');
        btn.innerHTML = curr_obj.name;
        btn_container.appendChild(btn);
      } else {
        btn_container.className = 'pk_menu_el';
        const btn = document.createElement('button');
        btn.className = 'pk_opt ' + (curr_obj.clss ? curr_obj.clss : '');
        btn.setAttribute('tab-index', '-1');
        btn.setAttribute('data-index', i);
        btn.innerHTML = curr_obj.name;
        btn_container.appendChild(btn);

        if (curr_obj.action) {
          (function (btn, action) {
            btn.onclick = function (obj) {
              if (this.classList.contains('pk_inact')) return;

              menu.closeMenu();
              action(obj);
            };
          })(btn, curr_obj.action);
        }
        if (curr_obj.setup) {
          curr_obj.setup(btn);
        }
      }
      parent_el.appendChild(btn_container);

      if (level === 0) top_els[i] = btn_container.childNodes[0];

      if (curr_obj.children) {
        const ch = curr_obj.children;
        const list = document.createElement('div');
        list.className = 'pk_menu';

        build_menus(list, curr_obj.children, level + 1);
        btn_container.appendChild(list);
      }
      // ---
    }
  }
  build_menus(header, menu_tree, 0);

  this.getOpenElement = function () {
    return target_el;
  };
  this.closeMenu = function () {
    if (!target_el) return;

    target_el.parentNode.className = _default_class;
    target_el = target_el_old = null;

    if (target_option) {
      target_option.classList.remove('pk_act');
      target_option = null;
    }

    UI.InteractionHandler.on = false;
    document.removeEventListener('mouseup', mouseup);

    // de-register keys
    UI.KeyHandler.removeCallback(_name + 1);
    UI.KeyHandler.removeCallback(_name + 2);
    UI.KeyHandler.removeCallback(_name + 3);
    UI.KeyHandler.removeCallback(_name + 4);
    UI.KeyHandler.removeCallback(_name + 5);
    UI.KeyHandler.removeCallback(_name + 6);
  };

  this.openMenu = function (index, is_mouse) {
    if (target_el) {
      target_el.parentNode.className = _default_class;
    }

    if (index === -1) {
      index = target_index === -1 ? 0 : target_index;
    }

    const curr_target = top_els[index];
    target_el = curr_target;

    const parent = curr_target.parentNode;
    const left = parent.getBoundingClientRect().left;
    const max = window.innerWidth;
    let offset = 0;

    if (max - left < 200) {
      offset = (264 - (max - left)) >> 0;

      if (offset > 1) parent.getElementsByClassName('pk_menu')[0].style.left = -offset / 2 + 'px';
    }

    parent.className += ' pk_vis';
    setTimeout(function () {
      if (target_el === curr_target) parent.className += ' pk_act';
    }, 0);

    target_index = index;

    UI.InteractionHandler.checkAndSet(_name);

    if (!is_mouse) document.addEventListener('mouseup', mouseup, false);

    // register keystrokes
    UI.KeyHandler.addCallback(
      _name + 1,
      function (key) {
        if (target_index === 0) target_index = top_els.length;

        menu.closeMenu();
        menu.openMenu(target_index - 1);
      },
      [37]
    );
    UI.KeyHandler.addCallback(
      _name + 2,
      function (key) {
        if (target_index === top_els.length - 1) target_index = -1;

        menu.closeMenu();
        menu.openMenu(target_index + 1);
      },
      [39]
    );
    UI.KeyHandler.addCallback(
      _name + 3,
      function (key) {
        menu.closeMenu();
      },
      [27]
    );
    UI.KeyHandler.addCallback(
      _name + 4,
      function (key, m, e) {
        if (!target_option) {
          const els = target_el.parentNode.getElementsByClassName('pk_opt');
          if (els[0]) {
            target_option = els[0];
            target_option.classList.add('pk_act');
          }
        } else {
          const ind = target_option.getAttribute('data-index') / 1;
          target_option.classList.remove('pk_act');

          target_option = target_el.parentNode.getElementsByClassName('pk_opt');
          if (ind - 1 < 0) {
            target_option = target_option[target_option.length - 1];
          } else {
            target_option = target_option[ind - 1];
          }
          target_option.classList.add('pk_act');
        }
      },
      [38]
    );
    UI.KeyHandler.addCallback(
      _name + 5,
      function (key, m, e) {
        if (!target_option) {
          const els = target_el.parentNode.getElementsByClassName('pk_opt');
          if (els[0]) {
            target_option = els[0];
            target_option.classList.add('pk_act');
          }
        } else {
          const ind = target_option.getAttribute('data-index') / 1;
          target_option.classList.remove('pk_act');

          target_option = target_el.parentNode.getElementsByClassName('pk_opt');
          if (target_option.length <= ind + 1) {
            target_option = target_option[0];
          } else {
            target_option = target_option[ind + 1];
          }
          target_option.classList.add('pk_act');
        }
      },
      [40]
    );
    UI.KeyHandler.addCallback(
      _name + 6,
      function (key) {
        if (target_option) target_option.click();
        else menu.closeMenu();
      },
      [13]
    );

    return true;
  };

  UI.listenFor('DidReadyFire', function () {
    menu.closeMenu();
  });

  // register hot keys for opening the menu
  function _checkForAct(x) {
    if (target_el == x || !x) return false;

    let par = x.parentNode;
    while (par && target_el) {
      if (target_el.parentNode == par) {
        return false;
      }
      par = par.parentNode;
    }

    let l = top_els.length;
    while (l-- > 0) {
      if (top_els[l] === x) {
        return menu.openMenu(l, true);
      }
    }
    return false;
  }

  // now make the buttons interactive
  const mousemove = function (e) {
    if (!UI.InteractionHandler.check(_name)) {
      return false;
    }

    if (target_el || (UI.InteractionHandler.on && UI.InteractionHandler.by === _name)) {
      const x = e.target || e.srcElement;

      if (x.className.indexOf('pk_opt') >= 0) {
        if (target_option) target_option.classList.remove('pk_act');

        target_option = x;
        target_option.classList.add('pk_act');
      } else {
        if (target_option) target_option.classList.remove('pk_act');
        target_option = null;
      }

      return _checkForAct(x);
    }

    return false;
  };
  const mouseup = function (e) {
    const x = e.target || e.srcElement;

    if (target_el) {
      // todo check for inner menu?
      let par = x;
      let found = false;
      while (par && target_el) {
        if (target_el.parentNode == par) {
          found = true;
          break;
        }
        par = par.parentNode;
      }

      if (!found || target_el_old === x) {
        menu.closeMenu();
      }
    } else {
      UI.InteractionHandler.on = false;
      document.removeEventListener('mouseup', mouseup);
    }

    target_el_old = null;
  };

  header.addEventListener('mousemove', mousemove, false);
  header.addEventListener(
    'mousedown',
    function (e) {
      if (!UI.InteractionHandler.checkAndSet(_name)) {
        return false;
      }

      document.removeEventListener('mouseup', mouseup);

      if (target_el) {
        if (!_checkForAct(e.target || e.srcElement)) target_el_old = target_el;
        else target_el_old = null;

        document.addEventListener('mouseup', mouseup, false);
      } else {
        target_el_old = null;
        document.addEventListener('mouseup', mouseup, false);
        _checkForAct(e.target || e.srcElement);
      }
      // -
    },
    false
  );

  UI.el.appendChild(header);
  // -
}

// ####
function _makeUIBarBottom(UI, app) {
  const bar = this;

  const bar_bottom_el = document.createElement('div');
  bar_bottom_el.className = 'pk_dck';
  UI.el.appendChild(bar_bottom_el);

  bar.el = bar_bottom_el;
  bar.on = false;
  bar.height = 130;

  bar.Show = function () {
    bar.on = true;
    bar_bottom_el.style.display = 'block';

    app.fireEvent('RequestResize');
  };
  bar.Hide = function () {
    bar.on = false;
    bar_bottom_el.style.display = 'none';

    app.fireEvent('RequestResize');
  };
}

function _makeUIMainView(UI, app) {
  const view = this;

  const audio_container = document.createElement('div');
  audio_container.className = 'pk_av_cont';
  UI.el.appendChild(audio_container);

  const main_audio_view = document.createElement('div');
  main_audio_view.className = 'pk_av pk_noselect';
  main_audio_view.id = 'pk_av_' + app.id;
  audio_container.appendChild(main_audio_view);

  const footer = document.createElement('div');
  footer.className = 'pk_ftr pk_noselect';
  UI.el.appendChild(footer);

  // make panner buttons
  const btn_panner_cnt = document.createElement('div');
  btn_panner_cnt.className = 'pk_panner pk_noselect';

  const panner_col_left = document.createElement('div');
  panner_col_left.className = 'pk_pan_left';
  const panner_col_right = document.createElement('div');
  panner_col_right.className = 'pk_pan_right';

  const btn_panner_left = document.createElement('button');
  const btn_panner_right = document.createElement('button');
  btn_panner_left.setAttribute('tabIndex', -1);
  btn_panner_right.setAttribute('tabIndex', -1);
  btn_panner_left.className = 'pk_pan_btn';
  btn_panner_right.className = 'pk_pan_btn';

  btn_panner_left.innerHTML = '<strong>L</strong> ON';
  btn_panner_right.innerHTML = '<strong>R</strong> ON';

  panner_col_left.appendChild(btn_panner_left);
  panner_col_right.appendChild(btn_panner_right);
  btn_panner_cnt.appendChild(panner_col_left);
  btn_panner_cnt.appendChild(panner_col_right);
  audio_container.appendChild(btn_panner_cnt);

  btn_panner_left.onclick = function () {
    app.fireEvent('RequestChanToggle', 0);
    this.blur();
  };
  btn_panner_right.onclick = function () {
    app.fireEvent('RequestChanToggle', 1);
    this.blur();
  };
  app.listenFor('DidChanToggle', function (chan, val) {
    if (chan === 0) {
      if (val) {
        btn_panner_left.classList.remove('pk_inact');
        btn_panner_left.innerHTML = '<strong>L</strong> ON';
      } else {
        btn_panner_left.classList.add('pk_inact');
        btn_panner_left.innerHTML = '<strong>L</strong> OFF';
      }
    } else {
      if (val) {
        btn_panner_right.classList.remove('pk_inact');
        btn_panner_right.innerHTML = '<strong>R</strong> ON';
      } else {
        btn_panner_right.classList.add('pk_inact');
        btn_panner_right.innerHTML = '<strong>R</strong> OFF';
      }
    }
  });

  // zoom btns
  const btn_zoom_cnt = document.createElement('div');
  btn_zoom_cnt.className = 'pk_zoombtn';

  const btn_zoom_in_h = document.createElement('button');
  btn_zoom_in_h.className = 'pk_btn pk_zoom_in_h';
  btn_zoom_in_h.innerHTML = '+<span>Zoom In Horiz (+)</span>';
  btn_zoom_in_h.setAttribute('tabIndex', -1);
  btn_zoom_in_h.onclick = function () {
    app.fireEvent('RequestZoomUI', 'h', -1);
    this.blur();
  };

  const btn_zoom_out_h = document.createElement('button');
  btn_zoom_out_h.className = 'pk_btn pk_zoom_out_h pk_inact';
  btn_zoom_out_h.innerHTML = '&ndash;<span>Zoom Out Horiz (-)</span>';
  btn_zoom_out_h.setAttribute('tabIndex', -1);
  btn_zoom_out_h.onclick = function () {
    app.fireEvent('RequestZoomUI', 'h', 1);
    this.blur();
  };

  const btn_zoom_reset = document.createElement('button');
  btn_zoom_reset.className = 'pk_btn pk_zoom_reset pk_inact';
  btn_zoom_reset.innerHTML = '[R] <span>Reset Zoom (0)</span>';
  btn_zoom_reset.setAttribute('tabIndex', -1);
  btn_zoom_reset.onclick = function () {
    app.fireEvent('RequestZoomUI', 0);
    this.blur();
  };
  UI.KeyHandler.addCallback(
    'Key0',
    function (key) {
      if (UI.InteractionHandler.on) return;
      app.fireEvent('RequestZoomUI', 0);
    },
    [48]
  );

  UI.KeyHandler.addCallback(
    'KeyZO',
    function (key) {
      if (UI.InteractionHandler.on) return;
      app.fireEvent('RequestZoomUI', 'h', 1);
    },
    [189]
  );
  UI.KeyHandler.addCallback(
    'KeyZI',
    function (key) {
      if (UI.InteractionHandler.on) return;
      app.fireEvent('RequestZoomUI', 'h', -1);
    },
    [187]
  );

  const btn_zoom_in_v = document.createElement('button');
  btn_zoom_in_v.className = 'pk_btn pk_zoom_in_v';
  btn_zoom_in_v.innerHTML = '&#x2195; +<span>Zoom In Vertically</span>';
  btn_zoom_in_v.setAttribute('tabIndex', -1);
  btn_zoom_in_v.onclick = function () {
    app.fireEvent('RequestZoomUI', 'v', -1);
    this.blur();
  };

  const btn_zoom_out_v = document.createElement('button');
  btn_zoom_out_v.className = 'pk_btn pk_zoom_out_v';
  btn_zoom_out_v.innerHTML = '&#x2195; &ndash;<span>Zoom Out Vertically</span>';
  btn_zoom_out_v.setAttribute('tabIndex', -1);
  btn_zoom_out_v.onclick = function () {
    app.fireEvent('RequestZoomUI', 'v', 1);
    this.blur();
  };

  btn_zoom_cnt.appendChild(btn_zoom_in_h);
  btn_zoom_cnt.appendChild(btn_zoom_out_h);
  btn_zoom_cnt.appendChild(btn_zoom_reset);
  btn_zoom_cnt.appendChild(btn_zoom_in_v);
  btn_zoom_cnt.appendChild(btn_zoom_out_v);

  footer.appendChild(btn_zoom_cnt);
  // end of zoom btns

  const wavezoom = document.createElement('div');
  wavezoom.className = 'pk_wavescroll';

  let wavepoint_visible = false;
  const wavepoint = document.createElement('div');
  wavepoint.className = 'pk_wavepoint';

  const wavedrag = document.createElement('div');
  const wavedrag_style = wavedrag.style;
  wavedrag.className = 'pk_wavedrag pk_inact';

  const wavedrag_left = document.createElement('div');
  wavedrag_left.className = 'pk_wavedrag_l';
  const wavedrag_right = document.createElement('div');
  wavedrag_right.className = 'pk_wavedrag_r';

  wavezoom.appendChild(wavepoint);
  wavedrag.appendChild(wavedrag_left);
  wavedrag.appendChild(wavedrag_right);
  wavezoom.appendChild(wavedrag);
  footer.appendChild(wavezoom);

  let temp = 0;
  let wavedrag_width = 100;
  wavezoom.onclick = function (e) {
    if (window.performance.now() - temp < 20) {
      return;
    }

    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    UI.fireEvent('RequestPan', x, 2);
  };

  // add zoom event, and add seek event....
  UI.listenFor('DidZoom', function (v) {
    const e = v[0];
    const o = v[1];

    if (e === 1) {
      btn_zoom_out_h.classList.add('pk_inact');
      btn_zoom_reset.classList.add('pk_inact');
    } else {
      btn_zoom_out_h.classList.remove('pk_inact');
      btn_zoom_reset.classList.remove('pk_inact');
    }

    if (v[2] != 1) {
      btn_zoom_reset.classList.remove('pk_inact');
    }

    if (e === 1) {
      if (wavepoint_visible) {
        wavepoint.style.display = 'none';
        wavepoint_visible = false;
      }
    } else {
      if (!wavepoint_visible) {
        wavepoint.style.display = 'block';
        const perc = app.engine.wavesurfer.getCurrentTime() / app.engine.wavesurfer.getDuration();
        // wavepoint.style.left = ((perc * 100).toFixed(2)/1) + '%';
        wavepoint.style.left = ((perc * 10000) >> 0) / 100 + '%';
        wavepoint_visible = true;
      }
    }

    // get zoom value and left...
    if (100 / e > 99) {
      wavedrag_width = 100;
      wavedrag_style.width = '100%';
      wavedrag_style.left = '0%';
      //wavedrag_style.transform = 'translate(0,0)';
      wavedrag.classList.add('pk_inact');
    } else {
      wavedrag_width = 100 / e;
      wavedrag_style.width = wavedrag_width + '%';
      wavedrag_style.left = o + '%';
      //wavedrag_style.transform = 'translate(' +  (e * o) + '%,0)';
      wavedrag.classList.remove('pk_inact');
    }
  });
  UI.listenFor('DidCursorCenter', function (val, zoom) {
    requestAnimationFrame(function () {
      wavedrag_style.left = val * 100 + '%';
      //wavedrag_style.transform = 'translate(' + (val * zoom * 100) + '%,0)';
    });
  });

  let drag_mode = 0;
  let startingX = 0;
  const waveScrollMouseMove = function (e) {
      e.stopPropagation();
      e.preventDefault();

      let clx = e.clientX;

      if (e.touches) {
        if (e.touches.length > 1) return;

        clx = e.touches[0].clientX;
      }

      const diff = -startingX + clx;
      if (drag_mode === 0) UI.fireEvent('RequestPan', diff, 1);
      else if (drag_mode === -1) {
        UI.fireEvent('RequestZoom', diff, -1);
      } else if (drag_mode === 1) {
        UI.fireEvent('RequestZoom', diff, 1);
      }

      startingX = clx;
    },
    waveScrollMouseUp = function (e) {
      if (e.touches && e.touches.length > 1) return;

      UI.app.engine.wavesurfer.Interacting &= ~(1 << 1);
      e.stopPropagation();
      e.preventDefault();
      drag_mode = 0;
      temp = window.performance.now();

      wavedrag.classList.remove('pk_drag');

      document.removeEventListener('mousemove', waveScrollMouseMove);
      document.removeEventListener('mouseup', waveScrollMouseUp);

      document.removeEventListener('touchmove', waveScrollMouseMove, { passive: false });
      document.removeEventListener('touchend', waveScrollMouseUp);
    };

  const mdown = function (e) {
    if (!UI.app.engine.is_ready) return;

    if (e.target === wavedrag) {
      drag_mode = 0;
    } else if (e.target === wavedrag_left) {
      drag_mode = -1;
    } else if (e.target === wavedrag_right) {
      drag_mode = 1;
    }

    wavedrag.className += ' pk_drag';

    startingX = e.clientX;
    UI.app.engine.wavesurfer.Interacting |= 1 << 1;

    if (e.is_touch) {
      document.addEventListener('touchmove', waveScrollMouseMove, { passive: false });
      document.addEventListener('touchend', waveScrollMouseUp, false);
    } else {
      document.addEventListener('mousemove', waveScrollMouseMove, false);
      document.addEventListener('mouseup', waveScrollMouseUp, false);
    }
  };

  wavedrag.addEventListener('mousedown', mdown, false);

  if ('ontouchstart' in window) {
    wavedrag.addEventListener(
      'touchstart',
      function (e) {
        e.preventDefault();
        e.stopPropagation();

        if (e.touches.length > 1) {
          return;
        }

        const ev = {
          is_touch: true,
          target: wavedrag,
          clientX: e.touches[0].clientX,
        };
        mdown(ev);
      },
      false
    );
  }

  this.volumeGauge = document.createElement('div');
  this.volumeGauge2 = document.createElement('div');

  this.volumeGaugeInner = document.createElement('div');
  this.volumeGaugeInner2 = document.createElement('div');
  this.volumeGaugePeaker = document.createElement('div');
  this.volumeGaugePeaker2 = document.createElement('div');

  const volume_parent = document.createElement('div');

  this.volumeGauge.className = 'pk_volpar';
  this.volumeGauge2.className = 'pk_volpar';
  this.volumeGaugeInner.className = 'pk_vol';
  this.volumeGaugeInner2.className = 'pk_vol';
  this.volumeGaugePeaker.className = 'pk_peaker';
  this.volumeGaugePeaker2.className = 'pk_peaker';

  this.volumeGauge.appendChild(this.volumeGaugeInner);
  this.volumeGauge.appendChild(this.volumeGaugePeaker);

  this.volumeGauge2.appendChild(this.volumeGaugeInner2);
  this.volumeGauge2.appendChild(this.volumeGaugePeaker2);

  const markers = document.createElement('div');
  markers.className = 'pk_markers pk_noselect';

  let str = '<span class="pk_mark1">-Inf</span>';
  for (let i = 35; i >= 0; --i) {
    str += '<span class="pk_mark1 ' + (i % 2 ? 'pk_odd' : '') + '">' + -(i * 2) + '</span>';
  }
  markers.innerHTML = str;

  volume_parent.appendChild(this.volumeGauge);
  volume_parent.appendChild(this.volumeGauge2);
  volume_parent.appendChild(markers);

  volume_parent.onclick = function () {
    view.volumeGaugePeaker.className = 'pk_peaker';
    view.volumeGaugePeaker2.className = 'pk_peaker';
  };

  footer.appendChild(volume_parent);

  // change temp message, it's pretty ugly #### TODO
  const ttmp = document.createElement('div');
  ttmp.className = 'pk_tmpMsg';
  ttmp.innerHTML =
    'Drag n drop an Audio File in this window, or click ' +
    '<a style="white-space:nowrap;border:1px solid;border-radius:23px;padding:5px 18px;font-size:0.94em;margin-left:5px" ' +
    // Inline handler: evaluated at global scope, so it must use the
    // window.PKAudioEditor bridge rather than module imports.
    'onclick="PKAudioEditor.engine.LoadSample()">here to use a sample</a>';
  main_audio_view.appendChild(ttmp);

  const ttmp2 = document.createElement('div');
  ttmp2.className = 'pk_tmpMsg2';
  ttmp2.innerHTML =
    '<span>Please Wait...</span><div class="pk_mload"><div></div></div>' +
    '<div class="pk_prc"><span>0%</span>' +
    '<button tabIndex="-1" class="pk_btn" ' +
    'onclick="PKAudioEditor.fireEvent(\'RequestCancelModal\');">cancel</button></div>';

  document.body.appendChild(ttmp2);
  UI.loaderEl = ttmp2;

  UI.listenFor('WillDownloadFile', function () {
    UI.loaderEl.classList.add('pk_act');
    UI.loaderEl.getElementsByTagName('span')[1].style.display = 'none';
  });
  UI.listenFor('DidDownloadFile', function () {
    UI.loaderEl.classList.remove('pk_act');
  });
  UI.listenFor('DidProgressModal', function (val) {
    UI.loaderEl.getElementsByTagName('span')[1].style.display = 'block';
    UI.loaderEl.getElementsByTagName('span')[1].textContent = val + '%';
  });
}

function _makeUIToolbar(UI) {
  const container = document.createElement('div');
  container.className = 'pk_tbc';

  const toolbar = document.createElement('div');
  toolbar.className = 'pk_tb pk_noselect';

  const btn_groups = document.createElement('div');
  btn_groups.className = 'pk_btngroup';

  const transport = document.createElement('div');
  transport.className = 'pk_transport';

  // play button
  const btn_stop = document.createElement('button');
  btn_stop.setAttribute('tabIndex', -1);
  btn_stop.innerHTML = '<span>Stop Playback (Space)</span>';
  btn_stop.className = 'pk_btn pk_stop icon-stop2';
  btn_stop.onclick = function () {
    UI.fireEvent('RequestStop');
  };
  transport.appendChild(btn_stop);

  const btn_play = document.createElement('button');
  btn_play.setAttribute('tabIndex', -1);
  btn_play.className = 'pk_btn pk_play icon-play3';
  btn_play.innerHTML = '<span>Play (Space)</span>';
  transport.appendChild(btn_play);
  btn_play.onclick = function () {
    UI.fireEvent('RequestPlay');
    this.blur();
  };
  UI.listenFor('DidStopPlay', function () {
    btn_play.classList.remove('pk_act');
  });
  UI.listenFor('DidPlay', function () {
    btn_play.classList.add('pk_act');
  });

  const btn_pause = document.createElement('button');
  btn_pause.setAttribute('tabIndex', -1);
  btn_pause.className = 'pk_btn pk_pause icon-pause2';
  btn_pause.innerHTML = '<span>Pause (Shift+Space)</span>';
  transport.appendChild(btn_pause);
  btn_pause.onclick = function () {
    UI.fireEvent('RequestPause');
    this.blur();
  };

  const btn_loop = document.createElement('button');
  btn_loop.setAttribute('tabIndex', -1);
  btn_loop.className = 'pk_btn pk_loop icon-loop';
  btn_loop.innerHTML = '<span>Toggle Loop (L)</span>';
  transport.appendChild(btn_loop);
  btn_loop.onclick = function () {
    UI.fireEvent('RequestSetLoop');
    this.blur();
  };
  UI.listenFor('DidSetLoop', function (val) {
    val ? btn_loop.classList.add('pk_act') : btn_loop.classList.remove('pk_act');
  });

  const btn_back_jump = document.createElement('button');
  btn_back_jump.setAttribute('tabIndex', -1);
  btn_back_jump.className = 'pk_btn pk_back_jump icon-backward2';
  btn_back_jump.innerHTML = '<span>Seek (left arrow)</span>';
  transport.appendChild(btn_back_jump);

  ///////////////////////////////////////////////////////////
  // REWING / BACK BTN
  let btn_back_focus = false;
  let btn_back_tm = null;
  btn_back_jump.onclick = function () {
    if (!btn_back_focus) {
      if (btn_back_tm) {
        clearTimeout(btn_back_tm);
        btn_back_tm = null;
      }

      let big_step = UI.app.engine.wavesurfer.getDuration() / 20;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      big_step /= zoom / 2 + 0.5;
      if (big_step > 1) big_step = big_step << 0;

      UI.fireEvent('RequestSkipBack', big_step);
    }

    this.blur();
    btn_back_focus = false;
  };

  btn_back_jump.onmouseleave = function () {
    if (btn_back_tm) {
      clearTimeout(btn_back_tm);
      btn_back_tm = null;
    }
    this.blur();
  };

  btn_back_jump.onfocus = function () {
    const btn = this;
    btn_back_focus = false;

    const step = function (num, count) {
      if (document.activeElement === btn) {
        btn_back_focus = true;

        UI.fireEvent('RequestSkipBack', num);

        const block = 4450;

        let middle_step = UI.app.engine.wavesurfer.getDuration() / block;
        const zoom = UI.app.engine.wavesurfer.ZoomFactor;
        middle_step /= zoom;

        if (count < 12) {
          middle_step = 0;
        }

        setTimeout(function () {
          step(num + middle_step, ++count);
        }, 40);
      }
    };
    btn_back_tm = setTimeout(function () {
      let small = UI.app.engine.wavesurfer.getDuration() / 2000;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      small /= zoom;

      if (small < 0.01) {
        small = 0.01;
      }

      step(small, 0);
    }, 390);
  };
  ////////////////////////

  const btn_front_jump = document.createElement('button');
  btn_front_jump.setAttribute('tabIndex', -1);
  btn_front_jump.className = 'pk_btn pk_front_jump icon-forward3';
  btn_front_jump.innerHTML = '<span>Seek (right arrow)</span>';
  transport.appendChild(btn_front_jump);

  let btn_frnt_focus = false;
  let btn_frnt_tm = null;
  btn_front_jump.onclick = function () {
    if (!btn_frnt_focus) {
      if (btn_frnt_tm) {
        clearTimeout(btn_frnt_tm);
        btn_frnt_tm = null;
      }

      let big_step = UI.app.engine.wavesurfer.getDuration() / 20;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      big_step /= zoom / 2 + 0.5;
      if (big_step > 1) big_step = big_step << 0;

      UI.fireEvent('RequestSkipFront', big_step);
    }

    this.blur();
    btn_frnt_focus = false;
  };
  btn_front_jump.onmouseleave = function () {
    if (btn_frnt_tm) {
      clearTimeout(btn_frnt_tm);
      btn_frnt_tm = null;
    }
    this.blur();
  };
  btn_front_jump.onfocus = function () {
    const btn = this;
    btn_frnt_focus = false;

    const step = function (num, count) {
      if (document.activeElement === btn) {
        btn_frnt_focus = true;

        UI.fireEvent('RequestSkipFront', num);

        const block = 4450;

        let middle_step = UI.app.engine.wavesurfer.getDuration() / block;
        const zoom = UI.app.engine.wavesurfer.ZoomFactor;
        middle_step /= zoom;

        if (count < 12) {
          middle_step = 0;
        }

        setTimeout(function () {
          step(num + middle_step, ++count);
        }, 40);
      }
    };
    btn_frnt_tm = setTimeout(function () {
      let small = UI.app.engine.wavesurfer.getDuration() / 2000;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      small /= zoom;

      if (small < 0.01) {
        small = 0.01;
      }

      step(small, 0);
    }, 390);
  };
  ////////////////////////

  let k_arr_bck_time = 0;
  let k_arr_bck_mult = 1;
  let k_arr_bck_skip_frames = 4;
  UI.KeyHandler.addCallback(
    'KeyArrowBack',
    function (key, c, ev) {
      if (UI.InteractionHandler.on || !UI.app.engine.is_ready) return;

      const time = ev.timeStamp;
      const diff = time - k_arr_bck_time;

      if (diff > 158) {
        k_arr_bck_mult = 1;
        k_arr_bck_skip_frames = 4;
      } else {
        if (--k_arr_bck_skip_frames < 0 && k_arr_bck_mult < 6.0) k_arr_bck_mult += 0.05;
      }

      k_arr_bck_time = time;

      // get zoom factor
      let jump = 0.5;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      const total_dur = UI.app.engine.wavesurfer.getDuration();

      jump = Math.max(total_dur / 200, 0.05);
      jump /= zoom;
      jump *= k_arr_bck_mult;

      UI.fireEvent('RequestSkipBack', jump);
    },
    [37]
  );

  let k_arr_frnt_time = 0;
  let k_arr_frnt_mult = 1;
  let k_arr_frnt_skip_frames = 4;
  UI.KeyHandler.addCallback(
    'KeyArrowFront',
    function (key, c, ev) {
      if (UI.InteractionHandler.on || !UI.app.engine.is_ready) return;

      const time = ev.timeStamp;
      const diff = time - k_arr_frnt_time;

      if (diff > 158) {
        k_arr_frnt_mult = 1;
        k_arr_frnt_skip_frames = 4;
      } else {
        if (--k_arr_frnt_skip_frames < 0 && k_arr_frnt_mult < 6.0) k_arr_frnt_mult += 0.05;
      }

      k_arr_frnt_time = time;

      let jump = 0.5;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      const total_dur = UI.app.engine.wavesurfer.getDuration();

      jump = Math.max(total_dur / 200, 0.05);

      jump /= zoom;
      jump *= k_arr_frnt_mult;

      UI.fireEvent('RequestSkipFront', jump);
    },
    [39]
  );
  UI.KeyHandler.addCallback(
    'KeyShiftArrowBack',
    function (key) {
      if (UI.InteractionHandler.on || !UI.app.engine.is_ready) return;

      const region = UI.app.engine.wavesurfer.regions.list[0];
      if (region) {
        const pos = UI.app.engine.wavesurfer.ActiveMarker;
        const total_dur = UI.app.engine.wavesurfer.getDuration();

        let durr = region.end / total_dur;

        if (pos > durr + 0.004) {
          UI.fireEvent('RequestSeekTo', durr - 0.0001);
          return;
        }

        durr = region.start / total_dur;

        if (pos > durr + 0.004) {
          UI.fireEvent('RequestSeekTo', durr);
          return;
        }
      }

      UI.fireEvent('RequestSeekTo', 0);
    },
    [16, 37]
  );
  UI.KeyHandler.addCallback(
    'KeyShiftArrowFront',
    function (key) {
      if (UI.InteractionHandler.on || !UI.app.engine.is_ready) return;

      // if region skip to the region
      const region = UI.app.engine.wavesurfer.regions.list[0];
      if (region) {
        const pos = UI.app.engine.wavesurfer.ActiveMarker;
        const total_dur = UI.app.engine.wavesurfer.getDuration();

        let durr = region.start / total_dur;

        if (pos < durr - 0.004) {
          UI.fireEvent('RequestSeekTo', durr);
          return;
        }

        durr = region.end / total_dur;

        if (pos < durr - 0.004) {
          UI.fireEvent('RequestSeekTo', durr - 0.0001);
          return;
        }
      }

      UI.fireEvent('RequestSeekTo', 0.994);
    },
    [16, 39]
  );
  UI.KeyHandler.addCallback(
    'killctx',
    function (e) {
      const event = new Event('killCTX', { bubbles: true });
      document.body.dispatchEvent(event);
    },
    [27]
  );

  const btn_back_total = document.createElement('button');
  btn_back_total.setAttribute('tabIndex', -1);
  btn_back_total.className = 'pk_btn icon-previous2';
  btn_back_total.innerHTML = '<span>Seek Start (Shift + left arrow)</span>';
  transport.appendChild(btn_back_total);
  btn_back_total.onclick = function () {
    UI.fireEvent('RequestRegionClear');
    UI.fireEvent('RequestSeekTo', 0);
    this.blur();
  };

  const btn_front_total = document.createElement('button');
  btn_front_total.setAttribute('tabIndex', -1);
  btn_front_total.className = 'pk_btn icon-next2';
  btn_front_total.innerHTML = '<span>Seek End (Shift + right arrow)</span>';
  btn_front_total.onclick = function () {
    UI.fireEvent('RequestRegionClear');
    UI.fireEvent('RequestSeekTo', 0.996);
    this.blur();
  };
  transport.appendChild(btn_front_total);

  const btn_rec = document.createElement('button');
  btn_rec.setAttribute('tabIndex', -1);
  btn_rec.className = 'pk_btn icon-rec';
  btn_rec.innerHTML = '<span>Record (R)</span>';
  btn_rec.onclick = function () {
    if (this.getAttribute('disabled') === 'disabled') {
      this.blur();
      return;
    }

    UI.fireEvent('RequestActionRecordToggle');
    this.blur();
  };

  UI.listenFor('ErrorRec', function () {
    btn_rec.style.opacity = 0.6;
    btn_rec.setAttribute('disabled', 'disabled');
  });

  transport.appendChild(btn_rec);
  UI.KeyHandler.addCallback(
    'KeyRecR',
    function (k) {
      if (UI.InteractionHandler.on) return;
      btn_rec.click();
    },
    [82]
  );

  UI.listenFor('DidActionRecordStart', function () {
    btn_rec.classList.add('pk_act');
  });
  UI.listenFor('DidActionRecordStop', function () {
    btn_rec.classList.remove('pk_act');
  });

  UI.KeyHandler.addCallback(
    'KeyTab',
    function (key) {
      if (UI.InteractionHandler.on || !UI.app.engine.is_ready) return;

      UI.fireEvent('RequestViewCenterToCursor');
    },
    [9]
  );

  const is_chrome = !!window.chrome;
  const timing = document.createElement('div');
  timing.className = 'pk_timecontainer';

  const timingspan = document.createElement('span');

  if (!is_chrome) {
    timingspan.textContent = '00:00:000';
    timingspan.className = 'pk_timing';
    timing.appendChild(timingspan);
  }

  /////
  const pk_timingcnv = document.createElement('canvas');
  pk_timingcnv.className = 'pk_timingcnv';
  pk_timingcnv.width = 150;
  pk_timingcnv.height = 40;
  let pk_timingnum = '00:00:000';
  const pk_timingctx = pk_timingcnv.getContext('2d', { alpha: false });
  const timing_caches = {};

  if (is_chrome) {
    timing.appendChild(pk_timingcnv);
    pk_timingctx.fillStyle = '#000';
    pk_timingctx.fillRect(0, 0, 150, 40);

    for (let ii = 0; ii < 11; ++ii) {
      const curr_cache = document.createElement('canvas');
      curr_cache.width = 18;
      curr_cache.height = 26;
      const curr_ctx = curr_cache.getContext('2d', { alpha: false });
      curr_ctx.font = '29px Helvetica, Arial, sans-serif';
      curr_ctx.textAlign = 'center';
      curr_ctx.fillStyle = '#000';
      curr_ctx.fillRect(0, 0, 18, 26);
      curr_ctx.fillStyle = '#fff';
      curr_ctx.textBaseline = 'middle';

      if (ii === 10) {
        curr_ctx.fillText(':', 8, 14);
        timing_caches[':'] = curr_cache;
      } else {
        curr_ctx.fillText(ii + '', 9, 14);
        timing_caches[ii + ''] = curr_cache;
      }
      // timing_caches.push (curr_cache);
      // document.body.appendChild( curr_cache );
    }

    (function (pk_timingctx, timing_caches) {
      const ttm = '00:00:000';
      for (let jk = 0; jk < ttm.length; ++jk) {
        pk_timingctx.drawImage(timing_caches[ttm[jk]], jk * 16, 10);
      }
    })(pk_timingctx, timing_caches);
  }
  /////

  const total_duration = document.createElement('span');
  total_duration.textContent = '00:00:000';
  total_duration.className = 'pk_total_dur';
  timing.appendChild(total_duration);

  const hover_duration = document.createElement('span');
  hover_duration.textContent = '00:00:000';
  hover_duration.className = 'pk_hover_dur';
  timing.appendChild(hover_duration);

  setTimeout(function () {
    UI.listenFor('DidZoom', function (v, f) {
      // do something smarter for f (event) ####
      if (f)
        hover_duration.textContent = formatTime(
          UI.app.engine.wavesurfer.drawer.handleEvent(f) *
            UI.app.engine.wavesurfer.VisibleDuration +
            UI.app.engine.wavesurfer.LeftProgress
        );
    });

    let old_refresh = 0;

    const avv = document.getElementsByClassName('pk_av')[0];
    avv.addEventListener(
      'mousemove',
      function (e) {
        // re-run the mousemove fam on zoom based on the pointer position)

        // throttle this as well ####  violation
        const new_refresh = e.timeStamp;

        if (new_refresh - old_refresh < 58) {
          return;
        }

        old_refresh = new_refresh;

        hover_duration.textContent = formatTime(
          UI.app.engine.wavesurfer.drawer.handleEvent(e) *
            UI.app.engine.wavesurfer.VisibleDuration +
            UI.app.engine.wavesurfer.LeftProgress
        );
      },
      false
    );

    const main_context = new ContextMenu(avv);

    main_context.addOption(
      'Select Visible View',
      function (e, x, i) {
        UI.fireEvent('RequestRegionSet');
      },
      false
    );

    main_context.addOption(
      'Reset Zoom',
      function (e) {
        UI.fireEvent('RequestZoomUI', 0);
      },
      false
    );

    main_context.addOption(
      'Set Volume/Gain',
      function (e) {
        UI.fireEvent('RequestFXUI_Gain');
      },
      false
    );

    main_context.addOption(
      'Copy',
      function (e) {
        const region = UI.app.engine.wavesurfer.regions.list[0];
        if (!region) return;

        UI.fireEvent('RequestActionCopy');
      },
      false
    );
    main_context.addOption(
      'Paste',
      function (e) {
        if (!copable) return;
        UI.fireEvent('RequestActionPaste');
      },
      false
    );
    main_context.addOption(
      'Cut',
      function (e) {
        const region = UI.app.engine.wavesurfer.regions.list[0];
        if (!region) return;

        UI.fireEvent('RequestActionCut', 1);
      },
      false
    );
    main_context.addOption(
      'Insert Silence',
      function (e) {
        UI.fireEvent('RequestFXUI_Silence', 0); // #### call effect
      },
      false
    );
    // ---

    let copable = false;
    UI.listenFor('DidSetClipboard', function (val) {
      if (val) copable = true;
      else copable = false;
    });

    main_context.onOpen = function (menu, div) {
      const divs = div.childNodes;
      if (!copable) divs[4].className += ' pk_inact';

      UI.fireEvent('RequestPause');

      const region = UI.app.engine.wavesurfer.regions.list[0];
      if (region) return;

      divs[3].className += ' pk_inact';
      divs[5].className += ' pk_inact';
    };
  }, 1000);

  UI.listenFor('DidUpdateLen', function (val) {
    total_duration.textContent = formatTime(val);
  });

  function formatTime(time) {
    let time_s = time >> 0;
    const miliseconds = time - time_s;

    if (time_s < 10) {
      if (time === 0) return '00:00:000';
      time_s = '00:0' + time_s;
    } else if (time_s < 60) {
      time_s = '00:' + time_s;
    } else {
      const m = (time_s / 60) >> 0;
      const s = time_s % 60;
      time_s = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' + s : s);
    }

    if (miliseconds < 0.1) {
      return time_s + ':0' + (miliseconds < 0.01 ? '0' : '') + ((miliseconds * 1000) >> 0);
    }

    return time_s + ':' + ((miliseconds * 1000) >> 0); // (miliseconds+'').substr(2, 3);
  }
  UI.formatTime = formatTime;

  let volume1 = 0;
  let volume2 = 0;
  let old_refresh = 0;
  let wvpnt = document.querySelector('.pk_wavepoint');

  UI.listenFor('DidAudioProcess', function (val) {
    const time = val[0];
    const loudness = val[1];

    const new_refresh = val[2] || window.performance.now();

    if (new_refresh - old_refresh < 50) {
      return;
    }

    old_refresh = new_refresh;

    if (time > -1) {
      if (!is_chrome) {
        timingspan.textContent = formatTime(time);
      } else {
        const ttm = formatTime(time);
        let exit = false;

        for (let jk = 0; jk < ttm.length; ++jk) {
          if (!exit) {
            if (ttm[jk] === pk_timingnum[jk]) {
              continue;
            } else {
              // pk_timingctx.clearRect ((jk * 16), 10, (9 - jk) * 16, 35);
              exit = true;
            }
          }

          pk_timingctx.drawImage(timing_caches[ttm[jk]], jk * 16, 10);
        }
        pk_timingnum = ttm;
      }

      if (UI.app.engine.wavesurfer.ZoomFactor > 1) {
        const perc = time / UI.app.engine.wavesurfer.getDuration();

        if (!wvpnt) wvpnt = document.querySelector('.pk_wavepoint');
        wvpnt.style.left = ((perc * 10000) >> 0) / 100 + '%';
        // wvpnt.style.left = ((perc * 100).toFixed(2)/1) + '%';
      }
    }

    if (!loudness) {
      UI.footer.volumeGaugePeaker.className = 'pk_peaker';
      UI.footer.volumeGaugePeaker2.className = 'pk_peaker';

      UI.footer.volumeGaugeInner.style.transform = 'translate3d(0,0,0)';
      UI.footer.volumeGaugeInner2.style.transform = 'translate3d(0,0,0)';
      // UI.footer.volumeGaugeInner.style.width = '100%';
      // UI.footer.volumeGaugeInner2.style.width = '100%';
    } else if (loudness[0] > 0) {
      UI.footer.volumeGaugePeaker.className = 'pk_peaker pk_act';

      UI.footer.volumeGaugeInner.style.transform = 'translate3d(100%,0,0)';
      // UI.footer.volumeGaugeInner.style.width = '0%';
      volume1 = 100;

      UI.footer.volumeGaugePeaker.setAttribute(
        'title',
        'Peak at ' + UI.app.engine.wavesurfer.getCurrentTime().toFixed(2)
      );
      if (loudness[1] > 0) {
        UI.footer.volumeGaugePeaker2.className = 'pk_peaker pk_act';

        UI.footer.volumeGaugeInner2.style.transform = 'translate3d(100%,0,0)';
        // UI.footer.volumeGaugeInner2.style.width = '0%';
        volume2 = 100;

        UI.footer.volumeGaugePeaker2.setAttribute(
          'title',
          'Peak at ' + UI.app.engine.wavesurfer.getCurrentTime().toFixed(2)
        );
      }
    } else if (loudness[1] > 0) {
      UI.footer.volumeGaugePeaker2.className = 'pk_peaker pk_act';

      UI.footer.volumeGaugeInner2.style.transform = 'translate3d(100%,0,0)';
      // UI.footer.volumeGaugeInner2.style.width = '0%';
      volume2 = 100;

      UI.footer.volumeGaugePeaker2.setAttribute(
        'title',
        'Peak at ' + UI.app.engine.wavesurfer.getCurrentTime().toFixed(2)
      );
    } else {
      let tmp = 100 + loudness[0];
      if (tmp < -100)
        volume1 = 0; // tmp = -100;
      else {
        volume1 = volume1 + (tmp - volume1) / 4;
        if (isNaN(volume1)) volume1 = 0;
      }

      tmp = 100 + loudness[1];
      if (tmp < -100)
        volume2 = 0; //tmp = -100;
      else {
        volume2 = volume2 + (tmp - volume2) / 4;
        if (isNaN(volume2)) volume2 = 0;
      }

      UI.footer.volumeGaugeInner.style.transform = 'translate3d(' + volume1 + '%,0,0)';
      UI.footer.volumeGaugeInner2.style.transform = 'translate3d(' + volume2 + '%,0,0)';
      // UI.footer.volumeGaugeInner.style.width = (100 - volume1) + '%';
      // UI.footer.volumeGaugeInner2.style.width = (100 - volume2) + '%';
    }
  });

  const actions = document.createElement('div');
  actions.className = 'pk_ctns';

  const copy_btn = document.createElement('button');
  copy_btn.setAttribute('tabIndex', -1);
  copy_btn.className = 'pk_btn icon-files-empty pk_inact';
  copy_btn.innerHTML = '<span>Copy Selection (Shift + C)</span>';
  actions.appendChild(copy_btn);

  copy_btn.onclick = function () {
    UI.fireEvent('RequestActionCopy');
    this.blur();
  };

  UI.listenFor('DidSetClipboard', function (val) {
    if (val) paste_btn.classList.remove('pk_inact');
    else paste_btn.classList.add('pk_inact');
  });

  const paste_btn = document.createElement('button');
  paste_btn.setAttribute('focusable', 'false');
  paste_btn.className = 'pk_btn icon-file-text2 pk_inact';
  paste_btn.innerHTML = '<span>Paste Selection (Shift + V)</span>';
  actions.appendChild(paste_btn);

  paste_btn.onclick = function () {
    UI.fireEvent('RequestActionPaste');
    this.blur();
  };

  const cut_btn = document.createElement('button');
  cut_btn.setAttribute('tabIndex', -1);
  cut_btn.className = 'pk_btn icon-scissors pk_inact';
  cut_btn.innerHTML = '<span>Cut Selection (Shift + X)</span>';
  actions.appendChild(cut_btn);

  cut_btn.onclick = function () {
    UI.fireEvent('RequestActionCut', 1);
    this.blur();
  };

  const silence_btn = document.createElement('button');
  silence_btn.setAttribute('tabIndex', -1);
  silence_btn.className = 'pk_btn icon-silence';
  silence_btn.innerHTML = '<span>Insert Silence (Shift + N)</span>';
  actions.appendChild(silence_btn);

  UI.KeyHandler.addCallback(
    'KeyShiftN',
    function (k) {
      if (UI.InteractionHandler.on) return;

      silence_btn.click();
    },
    [16, 78]
  );

  silence_btn.onclick = function () {
    UI.fireEvent('RequestFXUI_Silence');
    this.blur();
  };

  const selection = document.createElement('div');
  selection.className = 'pk_selection';
  selection.innerHTML =
    '<div class="pk_sellist">' +
    '<span class="pk_title">Selection:</span>' +
    '<div><span class="title">Start:</span><span class="s_s pk_dat">-</span></div>' +
    '<div><span class="title">End:</span><span class="s_e pk_dat">-</span></div>' +
    '<div><span  class="title">Duration:</span><span class="s_d pk_dat">-</span></div>' +
    '</div>';

  const btn_clear_selection = document.createElement('button');
  btn_clear_selection.setAttribute('tabIndex', -1);
  btn_clear_selection.className = 'pk_btn icon-clearsel pk_inact';
  btn_clear_selection.innerHTML = '<span>Clear Selection (Q key)</span>';

  let sel_spans = selection.getElementsByClassName('pk_dat');
  UI.listenFor('DidCreateRegion', function (region) {
    copy_btn.classList.remove('pk_inact');
    cut_btn.classList.remove('pk_inact');
    btn_clear_selection.classList.remove('pk_inact');

    if (region) {
      if (!sel_spans[0]) sel_spans = document.querySelectorAll('.pk_sellist .pk_dat');
      sel_spans[0].textContent = region.start.toFixed(3);
      sel_spans[1].textContent = region.end.toFixed(3);
      sel_spans[2].textContent = (region.end - region.start).toFixed(3);
    }
  });
  UI.listenFor('DidDestroyRegion', function () {
    copy_btn.classList.add('pk_inact');
    cut_btn.classList.add('pk_inact');
    btn_clear_selection.classList.add('pk_inact');

    if (!sel_spans[0]) sel_spans = document.querySelectorAll('.pk_sellist .pk_dat');
    sel_spans[0].textContent = '-';
    sel_spans[1].textContent = '-';
    sel_spans[2].textContent = '-';
  });

  btn_clear_selection.onclick = function () {
    UI.fireEvent('RequestRegionClear');
    this.blur();
  };
  selection.appendChild(btn_clear_selection);

  toolbar.appendChild(timing);

  UI.listenFor('DidChanToggle', function (chan, val) {
    const region = UI.app.engine.wavesurfer.regions.list[0];
    if (!region) return;

    if (val === 1) {
      region.element.style.top = '0';
      region.element.style.height = '100%';
      return;
    }

    if (chan === 0) {
      region.element.style.top = '50%';
      region.element.style.height = '50%';
      return;
    }

    if (chan === 1) {
      region.element.style.top = '0';
      region.element.style.height = '50%';
    }
    //
  });

  // end
  toolbar.appendChild(btn_groups);
  btn_groups.appendChild(transport);
  btn_groups.appendChild(actions);
  toolbar.appendChild(selection);

  container.appendChild(toolbar);

  UI.el.appendChild(container);

  enableFileDrop(
    document.getElementById('app'),
    null,
    function (e) {
      UI.app.engine.LoadArrayBuffer(new Blob([e]));
    },
    'arrayBuffer'
  );

  // -
}

function _makeMobileScroll(UI) {
  const getFactor = function () {
    const screen_h = window.screen.height;
    const screen_w = window.screen.width;

    const iw = window.innerWidth;
    const ih = window.innerHeight;

    let bars_visible = false;
    let ratio = 0;

    if (window.orientation === 0) {
      ratio = ih / screen_h;
    } else if (window.orientation === 90 || window.orientation === -90) {
      ratio = ih / screen_w;
    }
    if (ratio < 0.8) bars_visible = true;

    return bars_visible;
  };

  let ex = -1;
  let ey = -1;

  let allow = false;
  // var first = false;
  document.body.addEventListener('touchstart', function (e) {
    ex = e.touches[0].pageX;
    ey = e.touches[0].pageY;

    // first = true;
    allow = false;
  });

  document.body.addEventListener('touchend', function (e) {
    ex = -1;
    ey = -1;

    // first = false;
    allow = false;
  });

  document.body.addEventListener(
    'touchmove',
    function (e) {
      if (e.target.tagName === 'INPUT') return;
      if (allow) return;

      const ny = e.touches[0].pageY;
      const nx = e.touches[0].pageX;
      const direction = ey - ny;
      const direction2 = ex - nx;

      // if (first) {
      //	first = false;
      // }

      if (
        direction === 0 ||
        (Math.abs(direction) < 3 && Math.abs(direction2) > 3) ||
        (Math.abs(direction) < 6 && Math.abs(direction2) > 10)
      ) {
        ey = ny;
        ex = nx;
        allow = true;

        return;
      }

      ey = ny;
      ex = nx;

      let xx = document.getElementsByClassName('pk_modal_back');

      if (xx[0]) {
        xx = xx[0];
        if (xx.scrollHeight > window.innerHeight) {
          const scrolled = xx.scrollTop;

          if (direction > 0) {
            const modal_h = document.getElementsByClassName('pk_modal')[0].clientHeight;

            if (modal_h - scrolled < window.innerHeight - 80) {
              e.preventDefault();
            }
          } else {
            if (scrolled <= 0) {
              e.preventDefault();
            }
          }

          allow = true;
          return;
        } else {
          e.preventDefault();

          allow = true;
          return;
        }
      }

      if (!getFactor()) {
        e.preventDefault();
        allow = true;
      }
    },
    { passive: false }
  );
}
// ---
