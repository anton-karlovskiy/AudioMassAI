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

  this.element = app.element;
  this.app = app;

  // if mobile add proper class
  this.element.className += ' pk_app' + (app.isMobile ? ' pk_mobile' : '');

  // hold refferences to the event functions
  this.fireEvent = app.fireEvent;
  this.listenFor = app.listenFor;

  // keep track of the active UI element
  this.InteractionHandler = {
    on: false,
    by: null,
    stack: [],

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
        this.stack.push({
          on: this.on,
          by: this.by,
        });
      }

      this.on = true;
      this.by = _name;
    },

    forceUnset: function (_name) {
      if (this.check(_name)) {
        const previous = this.stack.pop();
        if (previous) {
          this.on = previous.on;
          this.by = previous.by;
        } else {
          this.on = false;
          this.by = null;
        }
      }
      // ---
    },
  };

  if (app.isMobile) {
    document.body.className = 'pk_standalone';
    const fxd = document.createElement('div');
    fxd.className = 'pk_fixed';
    fxd.appendChild(this.element);

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
      className: 'pk_modal_anim',
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
                  className: 'pk_modal_action_accept',
                  callback: function (modal) {
                    const input = modal.bodyElement.getElementsByTagName('input')[0];
                    const value = input.value.trim();

                    let format = 'mp3';
                    let kbps = 128;
                    let exportSelect = false;
                    let stereo = false;

                    const radios = modal.bodyElement.getElementsByClassName('pk_check');
                    let l = radios.length;
                    while (l-- > 0) {
                      if (radios[l].checked) {
                        if (radios[l].name == 'frmtex') {
                          format = radios[l].value;
                        } else if (radios[l].name == 'xport') {
                          if (radios[l].value === 'sel') {
                            const region = app.engine.wavesurfer.regions.list[0];
                            if (!region) exportSelect = false;
                            else exportSelect = [region.start, region.end];
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

                    app.engine.DownloadFile(value, format, kbps, exportSelect, stereo);
                    modal.Destroy();
                    // -
                  },
                },
              ],
              body:
                '<div class="pk_row"><label for="k0">File Name</label>' +
                '<input style="min-width:250px" placeholder="mp3 filename" value="audiomass-output.mp3" ' +
                'class="pk_text" type="text" id="k0" /></div>' +
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
                '<input type="range" class="pk_horizontal" min="0" max="8" step="1" value="5" id="flac-comp">' +
                '<span class="pk_value" style="float:left;margin-left:15px">5</span></div>' +
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
                const wavesurfer = app.engine.wavesurfer;
                //console.log( document.getElementById('frmtex') );

                // if no region
                const region = wavesurfer.regions.list[0];
                if (!region) {
                  const lbl = modal.bodyElement.getElementsByClassName('pk_lblmp3')[0];
                  lbl.className = 'pk_disabled';
                }

                const channelNumber = wavesurfer.backend.buffer.numberOfChannels;
                if (channelNumber === 2) {
                  modal.bodyElement.getElementsByClassName('pk_stereo')[0].checked = true;
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
                  if (!modal.element) return;
                  const inputtxt = modal.element.getElementsByTagName('input')[0];
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
          className: 'pk_inactive',
          setup: function (menuItemElement) {
            menuItemElement.setAttribute('data-id', 'dl');

            app.listenFor('DidUnloadFile', function () {
              menuItemElement.classList.add('pk_inactive');
            });
            app.listenFor('DidLoadFile', function () {
              menuItemElement.classList.remove('pk_inactive');
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
                  className: 'pk_modal_action_accept',
                  callback: function (modal) {
                    const input = modal.bodyElement.getElementsByTagName('input')[0];
                    const value = input.value.trim();

                    function isURL(value) {
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
                      if (!pattern.test(value)) {
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
                '<input style="min-width:250px" placeholder="Please insert url" class="pk_text" type="text" id="k00" />',
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
                    modal.elements.bottom[0].click();
                  },
                  [13]
                );

                setTimeout(function () {
                  modal.element && modal.element.getElementsByTagName('input')[0].focus();
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
          className: 'pk_inactive',
          action: function (e) {
            if (!app.engine.isReady) return;

            const saving = function (type, name) {
              let buff = app.engine.wavesurfer.backend.buffer;

              if (type === 'copy') buff = app.engine.GetCopyBuff();
              else if (type === 'sel') buff = app.engine.GetSel();

              const func = function (sessions) {
                const rr = Math.random().toString(36).substring(7);

                sessions.SaveSession(buff, rr, name);
                app.stopListeningFor('DidOpenDB', func);
              };

              app.listenFor('DidOpenDB', func);

              if (!app.sessions.on)
                app.sessions.Init(function (err) {
                  if (err) {
                    alert('db error');
                  }
                });
              else app.fireEvent('DidOpenDB', app.sessions);
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
                  className: 'pk_modal_action_accept',
                  callback: function (modal) {
                    let type = 'whole';
                    const input = modal.bodyElement.getElementsByTagName('input');
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
                'class="pk_text" type="text" id="slk0" /></div>',

              setup: function (modal) {
                // check if selection
                const wavesurfer = app.engine.wavesurfer;

                // if no region
                const region = wavesurfer.regions.list[0];
                const lblr = modal.bodyElement.getElementsByClassName('pk_lblsel')[0];
                if (!region) {
                  lblr.className = 'pk_disabled';
                } else {
                  modal.bodyElement.getElementsByClassName('pk_check')[1].checked = true;
                  lblr.childNodes[1].textContent =
                    app.ui.formatTime(region.start) + ' to ' + app.ui.formatTime(region.end);
                }

                // if no copy buffer
                const copy = app.engine.GetCopyBuff();
                if (!copy) {
                  const lbl = modal.bodyElement.getElementsByClassName('pk_lblsel2')[0];
                  lbl.className = 'pk_disabled';
                }

                if (!app.isMobile) {
                  setTimeout(function () {
                    modal.element && modal.element.getElementsByClassName('pk_text')[0].focus();
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

          setup: function (menuItemElement) {
            app.listenFor('DidUnloadFile', function () {
              menuItemElement.classList.add('pk_inactive');
            });
            app.listenFor('DidLoadFile', function () {
              menuItemElement.classList.remove('pk_inactive');
            });

            app.listenFor('DidStoreDB', function (storedSession, e) {
              const name = storedSession.id;
              const txt =
                '<div style="padding:2px 0">id: ' +
                name +
                '</div>' +
                '<div style="padding:2px 0"><span>durr: ' +
                storedSession.duration +
                's</span>' +
                '&nbsp;&nbsp;&nbsp;' +
                '<span>chan: ' +
                (storedSession.channelCount === 1 ? 'mono' : 'stereo') +
                '</span></div>' +
                '<div style="padding:2px 0"><img src="' +
                storedSession.thumbnail +
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
            const timeAgo = function (arg) {
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
            const func = function (sessions) {
              sessions.ListSessions(function (ret) {
                let message = '';
                if (ret.length === 0) {
                  message += 'No drafts found...';
                } else {
                  for (let i = 0; i < ret.length; ++i) {
                    const current = ret[i];
                    const date = new Date(current.created);
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
                    const agostr = timeAgo(date);
                    const filename = current.name || '-';
                    const duration = current.duration;
                    const thumbnail = current.thumbnail;
                    const chns = current.channelCount === 1 ? 'mono' : 'stereo';

                    message +=
                      '<div id="pk_' +
                      current.id +
                      '" class="pk_lcldrf">' +
                      '<div style="padding-bottom:2px"><span><i class="pk_field_label">name:</i>' +
                      filename +
                      '</span></div>' +
                      '<div><span class="pk_lcls"><i class="pk_field_label">id:</i><strong>' +
                      current.id +
                      '</strong><br/><i class="pk_field_label">chn:</i>' +
                      chns +
                      '</span>' +
                      '<span class="pk_lcls" style="width:50%;text-align:center"><i class="pk_field_label">date:</i><span>' +
                      datestr +
                      '<br/>' +
                      agostr +
                      '</span></span>' +
                      '<span style="text-align:right;float:right" class="pk_lcls"><i class="pk_field_label">durr:</i>' +
                      duration +
                      's</span></div><div>' +
                      '<img class="pk_lcli" src="' +
                      thumbnail +
                      '" />' +
                      '<a class="pk_lcla2" onclick="PKAudioEditor.fireEvent(\'LoadDraft\',\'' +
                      current.id +
                      '\', 3);">PLAY</a>' +
                      '<a class="pk_lcla" onclick="PKAudioEditor.fireEvent(\'LoadDraft\',\'' +
                      current.id +
                      '\');">Open</a>';

                    if (app.engine.isReady) {
                      message +=
                        "<a onclick=\"PKAudioEditor.fireEvent('LoadDraft','" +
                        current.id +
                        '\',1);" class="pk_lcla">Append to Current Track</a>';
                    }
                    message +=
                      '<a class="pk_lcla" style="color:#ad2b2b" onclick="PKAudioEditor.fireEvent(\'LoadDraft\',\'' +
                      current.id +
                      '\',2);">Del</a>';
                    message += '</div></div>';
                  }
                }

                let modal;
                const closeModal = function (value, val2) {
                  if (val2 === 2 || val2 === 3) return;

                  modal.Destroy();
                  modal = null;
                };

                const setActiveButton = function (name, state) {
                  let act;
                  if (!state) {
                    act = modal.bodyElement.getElementsByClassName('pk_active')[0];
                    if (act) {
                      act.classList.remove('pk_active');
                    }
                  } else {
                    const element = document.getElementById('pk_' + name);
                    if (element) {
                      act = element.getElementsByClassName('pk_lcla2')[0];
                      act && act.classList.add('pk_active');
                    }
                  }
                  // --
                };

                app.listenFor('_lclStart', setActiveButton);

                modal = new SimpleModal({
                  title: 'Local Drafts',
                  className: 'pk_bigger',

                  ondestroy: function (modal) {
                    app.fireEvent('_lclStop');

                    app.ui.InteractionHandler.on = false;
                    app.ui.KeyHandler.removeCallback('modalTempErr');
                    app.stopListeningFor('LoadDraft', closeModal);
                    app.stopListeningFor('_lclStart', setActiveButton);
                  },

                  buttons: [],

                  body: '<div>' + message + '</div>',
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

            if (!app.sessions.on)
              app.sessions.Init(function (err) {
                if (err) {
                  alert('db error');
                }
              });
            else app.fireEvent('DidOpenDB', app.sessions);
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
              app.sessions.Init(function (err) {
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

                  app.sessions.DelSession(name, function (name) {
                    const id = 'pk_' + name;
                    let element = document.getElementById(id);

                    if (element) {
                      if (element.parentNode.children.length === 1) {
                        element.parentNode.innerHTML = 'No drafts found...';
                      } else element.parentNode.removeChild(element);

                      element = null;
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
                  const providedAudioContext = new (
                    window.AudioContext || window.webkitAudioContext
                  )();
                  if (providedAudioContext && providedAudioContext.state == 'suspended') {
                    providedAudioContext.resume && providedAudioContext.resume();
                  }

                  app.sessions.GetSession(name, function (e) {
                    if (e && e.id === name) {
                      source.id = e.id;
                      source.aud = providedAudioContext;
                      source.src = app.engine.PlayBuff(
                        e.channelData,
                        e.channelCount,
                        e.sampleRate,
                        providedAudioContext
                      );
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
                    app.sessions.GetSession(name, function (e) {
                      if (e && e.id === name) {
                        app.engine.wavesurfer.backend._add = append ? 1 : 0;
                        app.engine.LoadDB(e);
                      }
                    });
                  };
                })(app, name, append);

                // --- ask if we want to click the first one
                if (app.engine.isReady && !append) {
                  const mm = new SimpleModal({
                    title: 'Open in Existing?',
                    body: '<div>Open in new window, or in the current one?</div>',
                    buttons: [
                      {
                        title: 'OPEN',
                        className: 'pk_modal_action_accept',
                        callback: function (modal) {
                          overwrite();

                          modal.Destroy();
                        },
                      },
                      {
                        title: 'OPEN IN NEW',
                        className: 'pk_modal_action_accept',
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
          className: 'pk_inactive',
          action: function () {
            app.fireEvent('RequestTranscription');
          },
          setup: function (menuItemElement) {
            menuItemElement.setAttribute('data-id', 'transcribe');

            app.listenFor('DidUnloadFile', function () {
              menuItemElement.classList.add('pk_inactive');
            });
            app.listenFor('DidLoadFile', function () {
              menuItemElement.classList.remove('pk_inactive');
            });
          },
        },
      ],
    },
    {
      name: 'Edit',
      children: [
        {
          name: 'Undo <span class="pk_shortcut">Shft+Z</span>',
          className: 'pk_inactive',
          action: function () {
            app.fireEvent('StateRequestUndo');
          },
          setup: function (menuItemElement) {
            app.listenFor('DidStateChange', function (undoStates, redoStates) {
              if (undoStates.length === 0) {
                menuItemElement.innerHTML = 'Undo <span class="pk_shortcut">Shft+Z</span>';
                menuItemElement.classList.add('pk_inactive');
              } else {
                menuItemElement.innerHTML =
                  'Undo&nbsp;<i style="pointer-events:none">' +
                  undoStates[undoStates.length - 1].desc +
                  '</i><span class="pk_shortcut">Shft+Z</span>';
                menuItemElement.classList.remove('pk_inactive');
              }
            });
          },
        },

        {
          name: 'Redo <span class="pk_shortcut">Shft+Y</span>',
          className: 'pk_inactive',
          action: function () {
            app.fireEvent('StateRequestRedo');
          },
          setup: function (menuItemElement) {
            app.listenFor('DidStateChange', function (undoStates, redoStates) {
              if (redoStates.length === 0) {
                menuItemElement.innerHTML = 'Redo <span class="pk_shortcut">Shft+Y</span>';
                menuItemElement.classList.add('pk_inactive');
              } else {
                menuItemElement.innerHTML =
                  'Redo&nbsp;<i style="pointer-events:none">' +
                  redoStates[0].desc +
                  '</i><span class="pk_shortcut">Shft+Y</span>';
                menuItemElement.classList.remove('pk_inactive');
              }
            });
          },
        },

        {
          name: 'Play <span class="pk_shortcut">Space</span>',
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
          name: 'Select All <span class="pk_shortcut">Shft+A</span>',
          action: function () {
            app.fireEvent('RequestSelect');
          },
        },

        {
          name: 'Deselect All <span class="pk_shortcut">~</span>',
          action: function () {
            app.fireEvent('RequestDeselect');
          },
        },

        {
          name: 'Channel Info/Flip',
          action: function () {
            app.fireEvent('RequestActionFXUI_Flip');
          },
          className: 'pk_inactive',
          setup: function (menuItemElement) {
            app.listenFor('DidUnloadFile', function () {
              menuItemElement.classList.add('pk_inactive');
            });
            app.listenFor('DidLoadFile', function () {
              menuItemElement.classList.remove('pk_inactive');
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
          action: function () {
            app.fireEvent('RequestViewFollowCursorToggle');
          },
          setup: function (menuItemElement) {
            // perhaps read from stored settings?

            app.listenFor('DidViewFollowCursorToggle', function (value) {
              const txt = 'Follow Cursor';

              if (value) {
                menuItemElement.innerHTML = txt + ' &#10004;';
              } else {
                menuItemElement.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Peak Separators &#10004;',
          action: function () {
            app.fireEvent('RequestViewPeakSeparatorToggle');
          },
          setup: function (menuItemElement) {
            app.listenFor('DidViewPeakSeparatorToggle', function (value) {
              const txt = 'Peak Separators';
              if (value) {
                menuItemElement.innerHTML = txt + ' &#10004;';
              } else {
                menuItemElement.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Timeline &#10004;',
          action: function () {
            app.fireEvent('RequestViewTimelineToggle');
          },
          setup: function (menuItemElement) {
            app.listenFor('DidViewTimelineToggle', function (value) {
              const txt = 'Timeline';
              if (value) {
                menuItemElement.innerHTML = txt + ' &#10004;';
              } else {
                menuItemElement.textContent = txt;
              }
            });
          },
        },

        {
          name: '---',
        },

        {
          name: 'Frequency Analyser',
          action: function () {
            app.fireEvent('RequestShowFreqAn', 'eq', [1]);
          },
          setup: function (menuItemElement) {
            app.listenFor('DidToggleFreqAn', function (url, value) {
              if (url !== 'eq') return;

              const txt = 'Frequency Analyser';
              if (value) {
                menuItemElement.innerHTML = txt + ' &#10004;';
              } else {
                menuItemElement.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Spectrum Analyser',
          action: function () {
            app.fireEvent('RequestShowFreqAn', 'sp', [1]);
          },
          setup: function (menuItemElement) {
            app.listenFor('DidToggleFreqAn', function (url, value) {
              if (url !== 'sp') return;

              const txt = 'Spectrum Analyser';
              if (value) {
                menuItemElement.innerHTML = txt + ' &#10004;';
              } else {
                menuItemElement.textContent = txt;
              }
            });
          },
        },

        {
          name: 'Tempo Tools',
          action: function () {
            app.fireEvent('RequestActionTempo');
          },
        },

        {
          name: 'ID3 Tags',
          action: function () {
            app.fireEvent('RequestActionID3');
          },
        },

        {
          name: '---',
        },

        {
          name: 'Center to Cursor <span class="pk_shortcut">[Tab]</span>',
          action: function () {
            app.fireEvent('RequestViewCenterToCursor');
          },
        },

        {
          name: 'Reset Zoom <span class="pk_shortcut">[0]</span>',
          action: function () {
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
function _makeUITopHeader(menuTree, UI) {
  const header = document.createElement('div');
  header.className = 'pk_header pk_noselect';

  const _name = 'TopHeader',
    _default_class = 'pk_button pk_noselect';

  let targetIndex = -1;
  let targetElement = null;
  let previousTargetElement = null;
  let targetOption = null;
  const topElements = [];
  const menu = this;

  // recursively build the interface
  function buildMenus(parentElementNode, treeObject, level) {
    for (let i = 0; i < treeObject.length; ++i) {
      const buttonContainer = document.createElement('div');
      const currentOption = treeObject[i];

      if (level === 0) {
        buttonContainer.className = _default_class;
        const button = document.createElement('button');
        button.innerHTML = currentOption.name;
        buttonContainer.appendChild(button);
      } else {
        buttonContainer.className = 'pk_menu_element';
        const button = document.createElement('button');
        button.className = 'pk_option ' + (currentOption.className ? currentOption.className : '');
        button.setAttribute('tab-index', '-1');
        button.setAttribute('data-index', i);
        button.innerHTML = currentOption.name;
        buttonContainer.appendChild(button);

        if (currentOption.action) {
          (function (button, action) {
            button.onclick = function (event) {
              if (this.classList.contains('pk_inactive')) return;

              menu.closeMenu();
              action(event);
            };
          })(button, currentOption.action);
        }
        if (currentOption.setup) {
          currentOption.setup(button);
        }
      }
      parentElementNode.appendChild(buttonContainer);

      if (level === 0) topElements[i] = buttonContainer.childNodes[0];

      if (currentOption.children) {
        const ch = currentOption.children;
        const list = document.createElement('div');
        list.className = 'pk_menu';

        buildMenus(list, currentOption.children, level + 1);
        buttonContainer.appendChild(list);
      }
      // ---
    }
  }
  buildMenus(header, menuTree, 0);

  this.getOpenElement = function () {
    return targetElement;
  };
  this.closeMenu = function () {
    if (!targetElement) return;

    targetElement.parentNode.className = _default_class;
    targetElement = previousTargetElement = null;

    if (targetOption) {
      targetOption.classList.remove('pk_active');
      targetOption = null;
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

  this.openMenu = function (index, isMouse) {
    if (targetElement) {
      targetElement.parentNode.className = _default_class;
    }

    if (index === -1) {
      index = targetIndex === -1 ? 0 : targetIndex;
    }

    const currentTarget = topElements[index];
    targetElement = currentTarget;

    const parent = currentTarget.parentNode;
    const left = parent.getBoundingClientRect().left;
    const max = window.innerWidth;
    let offset = 0;

    if (max - left < 200) {
      offset = (264 - (max - left)) >> 0;

      if (offset > 1) parent.getElementsByClassName('pk_menu')[0].style.left = -offset / 2 + 'px';
    }

    parent.className += ' pk_visible';
    setTimeout(function () {
      if (targetElement === currentTarget) parent.className += ' pk_active';
    }, 0);

    targetIndex = index;

    UI.InteractionHandler.checkAndSet(_name);

    if (!isMouse) document.addEventListener('mouseup', mouseup, false);

    // register keystrokes
    UI.KeyHandler.addCallback(
      _name + 1,
      function (key) {
        if (targetIndex === 0) targetIndex = topElements.length;

        menu.closeMenu();
        menu.openMenu(targetIndex - 1);
      },
      [37]
    );
    UI.KeyHandler.addCallback(
      _name + 2,
      function (key) {
        if (targetIndex === topElements.length - 1) targetIndex = -1;

        menu.closeMenu();
        menu.openMenu(targetIndex + 1);
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
        if (!targetOption) {
          const elements = targetElement.parentNode.getElementsByClassName('pk_option');
          if (elements[0]) {
            targetOption = elements[0];
            targetOption.classList.add('pk_active');
          }
        } else {
          const ind = targetOption.getAttribute('data-index') / 1;
          targetOption.classList.remove('pk_active');

          targetOption = targetElement.parentNode.getElementsByClassName('pk_option');
          if (ind - 1 < 0) {
            targetOption = targetOption[targetOption.length - 1];
          } else {
            targetOption = targetOption[ind - 1];
          }
          targetOption.classList.add('pk_active');
        }
      },
      [38]
    );
    UI.KeyHandler.addCallback(
      _name + 5,
      function (key, m, e) {
        if (!targetOption) {
          const elements = targetElement.parentNode.getElementsByClassName('pk_option');
          if (elements[0]) {
            targetOption = elements[0];
            targetOption.classList.add('pk_active');
          }
        } else {
          const ind = targetOption.getAttribute('data-index') / 1;
          targetOption.classList.remove('pk_active');

          targetOption = targetElement.parentNode.getElementsByClassName('pk_option');
          if (targetOption.length <= ind + 1) {
            targetOption = targetOption[0];
          } else {
            targetOption = targetOption[ind + 1];
          }
          targetOption.classList.add('pk_active');
        }
      },
      [40]
    );
    UI.KeyHandler.addCallback(
      _name + 6,
      function (key) {
        if (targetOption) targetOption.click();
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
    if (targetElement == x || !x) return false;

    let par = x.parentNode;
    while (par && targetElement) {
      if (targetElement.parentNode == par) {
        return false;
      }
      par = par.parentNode;
    }

    let l = topElements.length;
    while (l-- > 0) {
      if (topElements[l] === x) {
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

    if (targetElement || (UI.InteractionHandler.on && UI.InteractionHandler.by === _name)) {
      const x = e.target || e.srcElement;

      if (x.className.indexOf('pk_option') >= 0) {
        if (targetOption) targetOption.classList.remove('pk_active');

        targetOption = x;
        targetOption.classList.add('pk_active');
      } else {
        if (targetOption) targetOption.classList.remove('pk_active');
        targetOption = null;
      }

      return _checkForAct(x);
    }

    return false;
  };
  const mouseup = function (e) {
    const x = e.target || e.srcElement;

    if (targetElement) {
      // todo check for inner menu?
      let par = x;
      let found = false;
      while (par && targetElement) {
        if (targetElement.parentNode == par) {
          found = true;
          break;
        }
        par = par.parentNode;
      }

      if (!found || previousTargetElement === x) {
        menu.closeMenu();
      }
    } else {
      UI.InteractionHandler.on = false;
      document.removeEventListener('mouseup', mouseup);
    }

    previousTargetElement = null;
  };

  header.addEventListener('mousemove', mousemove, false);
  header.addEventListener(
    'mousedown',
    function (e) {
      if (!UI.InteractionHandler.checkAndSet(_name)) {
        return false;
      }

      document.removeEventListener('mouseup', mouseup);

      if (targetElement) {
        if (!_checkForAct(e.target || e.srcElement)) previousTargetElement = targetElement;
        else previousTargetElement = null;

        document.addEventListener('mouseup', mouseup, false);
      } else {
        previousTargetElement = null;
        document.addEventListener('mouseup', mouseup, false);
        _checkForAct(e.target || e.srcElement);
      }
      // -
    },
    false
  );

  UI.element.appendChild(header);
  // -
}

// ####
function _makeUIBarBottom(UI, app) {
  const bar = this;

  const barBottomElement = document.createElement('div');
  barBottomElement.className = 'pk_dock';
  UI.element.appendChild(barBottomElement);

  bar.element = barBottomElement;
  bar.on = false;
  bar.height = 130;

  bar.Show = function () {
    bar.on = true;
    barBottomElement.style.display = 'block';

    app.fireEvent('RequestResize');
  };
  bar.Hide = function () {
    bar.on = false;
    barBottomElement.style.display = 'none';

    app.fireEvent('RequestResize');
  };
}

function _makeUIMainView(UI, app) {
  const view = this;

  const audioContainer = document.createElement('div');
  audioContainer.className = 'pk_audio_view_container';
  UI.element.appendChild(audioContainer);

  const mainAudioView = document.createElement('div');
  mainAudioView.className = 'pk_audio_view pk_noselect';
  mainAudioView.id = 'pk_audio_view_' + app.id;
  audioContainer.appendChild(mainAudioView);

  const footer = document.createElement('div');
  footer.className = 'pk_footer pk_noselect';
  UI.element.appendChild(footer);

  // make panner buttons
  const buttonPannerContainer = document.createElement('div');
  buttonPannerContainer.className = 'pk_panner pk_noselect';

  const pannerColorLeft = document.createElement('div');
  pannerColorLeft.className = 'pk_pan_left';
  const pannerColorRight = document.createElement('div');
  pannerColorRight.className = 'pk_pan_right';

  const buttonPannerLeft = document.createElement('button');
  const buttonPannerRight = document.createElement('button');
  buttonPannerLeft.setAttribute('tabIndex', -1);
  buttonPannerRight.setAttribute('tabIndex', -1);
  buttonPannerLeft.className = 'pk_pan_button';
  buttonPannerRight.className = 'pk_pan_button';

  buttonPannerLeft.innerHTML = '<strong>L</strong> ON';
  buttonPannerRight.innerHTML = '<strong>R</strong> ON';

  pannerColorLeft.appendChild(buttonPannerLeft);
  pannerColorRight.appendChild(buttonPannerRight);
  buttonPannerContainer.appendChild(pannerColorLeft);
  buttonPannerContainer.appendChild(pannerColorRight);
  audioContainer.appendChild(buttonPannerContainer);

  buttonPannerLeft.onclick = function () {
    app.fireEvent('RequestChanToggle', 0);
    this.blur();
  };
  buttonPannerRight.onclick = function () {
    app.fireEvent('RequestChanToggle', 1);
    this.blur();
  };
  app.listenFor('DidChanToggle', function (chan, value) {
    if (chan === 0) {
      if (value) {
        buttonPannerLeft.classList.remove('pk_inactive');
        buttonPannerLeft.innerHTML = '<strong>L</strong> ON';
      } else {
        buttonPannerLeft.classList.add('pk_inactive');
        buttonPannerLeft.innerHTML = '<strong>L</strong> OFF';
      }
    } else {
      if (value) {
        buttonPannerRight.classList.remove('pk_inactive');
        buttonPannerRight.innerHTML = '<strong>R</strong> ON';
      } else {
        buttonPannerRight.classList.add('pk_inactive');
        buttonPannerRight.innerHTML = '<strong>R</strong> OFF';
      }
    }
  });

  // zoom btns
  const buttonZoomContainer = document.createElement('div');
  buttonZoomContainer.className = 'pk_zoom_buttons';

  const buttonZoomInHorizontal = document.createElement('button');
  buttonZoomInHorizontal.className = 'pk_button pk_zoom_in_h';
  buttonZoomInHorizontal.innerHTML = '+<span>Zoom In Horiz (+)</span>';
  buttonZoomInHorizontal.setAttribute('tabIndex', -1);
  buttonZoomInHorizontal.onclick = function () {
    app.fireEvent('RequestZoomUI', 'h', -1);
    this.blur();
  };

  const buttonZoomOutHorizontal = document.createElement('button');
  buttonZoomOutHorizontal.className = 'pk_button pk_zoom_out_h pk_inactive';
  buttonZoomOutHorizontal.innerHTML = '&ndash;<span>Zoom Out Horiz (-)</span>';
  buttonZoomOutHorizontal.setAttribute('tabIndex', -1);
  buttonZoomOutHorizontal.onclick = function () {
    app.fireEvent('RequestZoomUI', 'h', 1);
    this.blur();
  };

  const buttonZoomReset = document.createElement('button');
  buttonZoomReset.className = 'pk_button pk_zoom_reset pk_inactive';
  buttonZoomReset.innerHTML = '[R] <span>Reset Zoom (0)</span>';
  buttonZoomReset.setAttribute('tabIndex', -1);
  buttonZoomReset.onclick = function () {
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

  const buttonZoomInVertical = document.createElement('button');
  buttonZoomInVertical.className = 'pk_button pk_zoom_in_v';
  buttonZoomInVertical.innerHTML = '&#x2195; +<span>Zoom In Vertically</span>';
  buttonZoomInVertical.setAttribute('tabIndex', -1);
  buttonZoomInVertical.onclick = function () {
    app.fireEvent('RequestZoomUI', 'v', -1);
    this.blur();
  };

  const buttonZoomOutVertical = document.createElement('button');
  buttonZoomOutVertical.className = 'pk_button pk_zoom_out_v';
  buttonZoomOutVertical.innerHTML = '&#x2195; &ndash;<span>Zoom Out Vertically</span>';
  buttonZoomOutVertical.setAttribute('tabIndex', -1);
  buttonZoomOutVertical.onclick = function () {
    app.fireEvent('RequestZoomUI', 'v', 1);
    this.blur();
  };

  buttonZoomContainer.appendChild(buttonZoomInHorizontal);
  buttonZoomContainer.appendChild(buttonZoomOutHorizontal);
  buttonZoomContainer.appendChild(buttonZoomReset);
  buttonZoomContainer.appendChild(buttonZoomInVertical);
  buttonZoomContainer.appendChild(buttonZoomOutVertical);

  footer.appendChild(buttonZoomContainer);
  // end of zoom btns

  const wavezoom = document.createElement('div');
  wavezoom.className = 'pk_wave_scroll';

  let wavePointVisible = false;
  const wavepoint = document.createElement('div');
  wavepoint.className = 'pk_wave_point';

  const wavedrag = document.createElement('div');
  const waveDragStyle = wavedrag.style;
  wavedrag.className = 'pk_wave_drag pk_inactive';

  const waveDragLeft = document.createElement('div');
  waveDragLeft.className = 'pk_wave_drag_left';
  const waveDragRight = document.createElement('div');
  waveDragRight.className = 'pk_wave_drag_right';

  wavezoom.appendChild(wavepoint);
  wavedrag.appendChild(waveDragLeft);
  wavedrag.appendChild(waveDragRight);
  wavezoom.appendChild(wavedrag);
  footer.appendChild(wavezoom);

  let temp = 0;
  let waveDragWidth = 100;
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
      buttonZoomOutHorizontal.classList.add('pk_inactive');
      buttonZoomReset.classList.add('pk_inactive');
    } else {
      buttonZoomOutHorizontal.classList.remove('pk_inactive');
      buttonZoomReset.classList.remove('pk_inactive');
    }

    if (v[2] != 1) {
      buttonZoomReset.classList.remove('pk_inactive');
    }

    if (e === 1) {
      if (wavePointVisible) {
        wavepoint.style.display = 'none';
        wavePointVisible = false;
      }
    } else {
      if (!wavePointVisible) {
        wavepoint.style.display = 'block';
        const perc = app.engine.wavesurfer.getCurrentTime() / app.engine.wavesurfer.getDuration();
        // wavepoint.style.left = ((perc * 100).toFixed(2)/1) + '%';
        wavepoint.style.left = ((perc * 10000) >> 0) / 100 + '%';
        wavePointVisible = true;
      }
    }

    // get zoom value and left...
    if (100 / e > 99) {
      waveDragWidth = 100;
      waveDragStyle.width = '100%';
      waveDragStyle.left = '0%';
      //waveDragStyle.transform = 'translate(0,0)';
      wavedrag.classList.add('pk_inactive');
    } else {
      waveDragWidth = 100 / e;
      waveDragStyle.width = waveDragWidth + '%';
      waveDragStyle.left = o + '%';
      //waveDragStyle.transform = 'translate(' +  (e * o) + '%,0)';
      wavedrag.classList.remove('pk_inactive');
    }
  });
  UI.listenFor('DidCursorCenter', function (value, zoom) {
    requestAnimationFrame(function () {
      waveDragStyle.left = value * 100 + '%';
      //waveDragStyle.transform = 'translate(' + (value * zoom * 100) + '%,0)';
    });
  });

  let dragMode = 0;
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
      if (dragMode === 0) UI.fireEvent('RequestPan', diff, 1);
      else if (dragMode === -1) {
        UI.fireEvent('RequestZoom', diff, -1);
      } else if (dragMode === 1) {
        UI.fireEvent('RequestZoom', diff, 1);
      }

      startingX = clx;
    },
    waveScrollMouseUp = function (e) {
      if (e.touches && e.touches.length > 1) return;

      UI.app.engine.wavesurfer.Interacting &= ~(1 << 1);
      e.stopPropagation();
      e.preventDefault();
      dragMode = 0;
      temp = window.performance.now();

      wavedrag.classList.remove('pk_drag');

      document.removeEventListener('mousemove', waveScrollMouseMove);
      document.removeEventListener('mouseup', waveScrollMouseUp);

      document.removeEventListener('touchmove', waveScrollMouseMove, { passive: false });
      document.removeEventListener('touchend', waveScrollMouseUp);
    };

  const mdown = function (e) {
    if (!UI.app.engine.isReady) return;

    if (e.target === wavedrag) {
      dragMode = 0;
    } else if (e.target === waveDragLeft) {
      dragMode = -1;
    } else if (e.target === waveDragRight) {
      dragMode = 1;
    }

    wavedrag.className += ' pk_drag';

    startingX = e.clientX;
    UI.app.engine.wavesurfer.Interacting |= 1 << 1;

    if (e.isTouch) {
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
          isTouch: true,
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

  const volumeParent = document.createElement('div');

  this.volumeGauge.className = 'pk_volume_bar';
  this.volumeGauge2.className = 'pk_volume_bar';
  this.volumeGaugeInner.className = 'pk_volume';
  this.volumeGaugeInner2.className = 'pk_volume';
  this.volumeGaugePeaker.className = 'pk_peaker';
  this.volumeGaugePeaker2.className = 'pk_peaker';

  this.volumeGauge.appendChild(this.volumeGaugeInner);
  this.volumeGauge.appendChild(this.volumeGaugePeaker);

  this.volumeGauge2.appendChild(this.volumeGaugeInner2);
  this.volumeGauge2.appendChild(this.volumeGaugePeaker2);

  const markers = document.createElement('div');
  markers.className = 'pk_markers pk_noselect';

  let markup = '<span class="pk_marker">-Inf</span>';
  for (let i = 35; i >= 0; --i) {
    markup += '<span class="pk_marker ' + (i % 2 ? 'pk_odd' : '') + '">' + -(i * 2) + '</span>';
  }
  markers.innerHTML = markup;

  volumeParent.appendChild(this.volumeGauge);
  volumeParent.appendChild(this.volumeGauge2);
  volumeParent.appendChild(markers);

  volumeParent.onclick = function () {
    view.volumeGaugePeaker.className = 'pk_peaker';
    view.volumeGaugePeaker2.className = 'pk_peaker';
  };

  footer.appendChild(volumeParent);

  // change temp message, it's pretty ugly #### TODO
  const ttmp = document.createElement('div');
  ttmp.className = 'pk_tmpMsg';
  ttmp.innerHTML =
    'Drag n drop an Audio File in this window, or click ' +
    '<a style="white-space:nowrap;border:1px solid;border-radius:23px;padding:5px 18px;font-size:0.94em;margin-left:5px" ' +
    // Inline handler: evaluated at global scope, so it must use the
    // window.PKAudioEditor bridge rather than module imports.
    'onclick="PKAudioEditor.engine.LoadSample()">here to use a sample</a>';
  mainAudioView.appendChild(ttmp);

  const ttmp2 = document.createElement('div');
  ttmp2.className = 'pk_tmpMsg2';
  ttmp2.innerHTML =
    '<span>Please Wait...</span><div class="pk_modal_loading"><div></div></div>' +
    '<div class="pk_prc"><span>0%</span>' +
    '<button tabIndex="-1" class="pk_button" ' +
    'onclick="PKAudioEditor.fireEvent(\'RequestCancelModal\');">cancel</button></div>';

  document.body.appendChild(ttmp2);
  UI.loaderEl = ttmp2;

  UI.listenFor('WillDownloadFile', function () {
    UI.loaderEl.classList.add('pk_active');
    UI.loaderEl.getElementsByTagName('span')[1].style.display = 'none';
  });
  UI.listenFor('DidDownloadFile', function () {
    UI.loaderEl.classList.remove('pk_active');
  });
  UI.listenFor('DidProgressModal', function (value) {
    UI.loaderEl.getElementsByTagName('span')[1].style.display = 'block';
    UI.loaderEl.getElementsByTagName('span')[1].textContent = value + '%';
  });
}

function _makeUIToolbar(UI) {
  const container = document.createElement('div');
  container.className = 'pk_toolbar_container';

  const toolbar = document.createElement('div');
  toolbar.className = 'pk_toolbar pk_noselect';

  const buttonGroups = document.createElement('div');
  buttonGroups.className = 'pk_button_group';

  const transport = document.createElement('div');
  transport.className = 'pk_transport';

  // play button
  const buttonStop = document.createElement('button');
  buttonStop.setAttribute('tabIndex', -1);
  buttonStop.innerHTML = '<span>Stop Playback (Space)</span>';
  buttonStop.className = 'pk_button pk_stop icon-stop2';
  buttonStop.onclick = function () {
    UI.fireEvent('RequestStop');
  };
  transport.appendChild(buttonStop);

  const buttonPlay = document.createElement('button');
  buttonPlay.setAttribute('tabIndex', -1);
  buttonPlay.className = 'pk_button pk_play icon-play3';
  buttonPlay.innerHTML = '<span>Play (Space)</span>';
  transport.appendChild(buttonPlay);
  buttonPlay.onclick = function () {
    UI.fireEvent('RequestPlay');
    this.blur();
  };
  UI.listenFor('DidStopPlay', function () {
    buttonPlay.classList.remove('pk_active');
  });
  UI.listenFor('DidPlay', function () {
    buttonPlay.classList.add('pk_active');
  });

  const buttonPause = document.createElement('button');
  buttonPause.setAttribute('tabIndex', -1);
  buttonPause.className = 'pk_button pk_pause icon-pause2';
  buttonPause.innerHTML = '<span>Pause (Shift+Space)</span>';
  transport.appendChild(buttonPause);
  buttonPause.onclick = function () {
    UI.fireEvent('RequestPause');
    this.blur();
  };

  const buttonLoop = document.createElement('button');
  buttonLoop.setAttribute('tabIndex', -1);
  buttonLoop.className = 'pk_button pk_loop icon-loop';
  buttonLoop.innerHTML = '<span>Toggle Loop (L)</span>';
  transport.appendChild(buttonLoop);
  buttonLoop.onclick = function () {
    UI.fireEvent('RequestSetLoop');
    this.blur();
  };
  UI.listenFor('DidSetLoop', function (value) {
    value ? buttonLoop.classList.add('pk_active') : buttonLoop.classList.remove('pk_active');
  });

  const buttonBackJump = document.createElement('button');
  buttonBackJump.setAttribute('tabIndex', -1);
  buttonBackJump.className = 'pk_button pk_back_jump icon-backward2';
  buttonBackJump.innerHTML = '<span>Seek (left arrow)</span>';
  transport.appendChild(buttonBackJump);

  ///////////////////////////////////////////////////////////
  // REWING / BACK BTN
  let buttonBackFocus = false;
  let buttonBackTimer = null;
  buttonBackJump.onclick = function () {
    if (!buttonBackFocus) {
      if (buttonBackTimer) {
        clearTimeout(buttonBackTimer);
        buttonBackTimer = null;
      }

      let bigStep = UI.app.engine.wavesurfer.getDuration() / 20;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      bigStep /= zoom / 2 + 0.5;
      if (bigStep > 1) bigStep = bigStep << 0;

      UI.fireEvent('RequestSkipBack', bigStep);
    }

    this.blur();
    buttonBackFocus = false;
  };

  buttonBackJump.onmouseleave = function () {
    if (buttonBackTimer) {
      clearTimeout(buttonBackTimer);
      buttonBackTimer = null;
    }
    this.blur();
  };

  buttonBackJump.onfocus = function () {
    const button = this;
    buttonBackFocus = false;

    const step = function (number, count) {
      if (document.activeElement === button) {
        buttonBackFocus = true;

        UI.fireEvent('RequestSkipBack', number);

        const block = 4450;

        let middleStep = UI.app.engine.wavesurfer.getDuration() / block;
        const zoom = UI.app.engine.wavesurfer.ZoomFactor;
        middleStep /= zoom;

        if (count < 12) {
          middleStep = 0;
        }

        setTimeout(function () {
          step(number + middleStep, ++count);
        }, 40);
      }
    };
    buttonBackTimer = setTimeout(function () {
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

  const buttonFrontJump = document.createElement('button');
  buttonFrontJump.setAttribute('tabIndex', -1);
  buttonFrontJump.className = 'pk_button pk_front_jump icon-forward3';
  buttonFrontJump.innerHTML = '<span>Seek (right arrow)</span>';
  transport.appendChild(buttonFrontJump);

  let buttonFrontFocus = false;
  let buttonFrontTimer = null;
  buttonFrontJump.onclick = function () {
    if (!buttonFrontFocus) {
      if (buttonFrontTimer) {
        clearTimeout(buttonFrontTimer);
        buttonFrontTimer = null;
      }

      let bigStep = UI.app.engine.wavesurfer.getDuration() / 20;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      bigStep /= zoom / 2 + 0.5;
      if (bigStep > 1) bigStep = bigStep << 0;

      UI.fireEvent('RequestSkipFront', bigStep);
    }

    this.blur();
    buttonFrontFocus = false;
  };
  buttonFrontJump.onmouseleave = function () {
    if (buttonFrontTimer) {
      clearTimeout(buttonFrontTimer);
      buttonFrontTimer = null;
    }
    this.blur();
  };
  buttonFrontJump.onfocus = function () {
    const button = this;
    buttonFrontFocus = false;

    const step = function (number, count) {
      if (document.activeElement === button) {
        buttonFrontFocus = true;

        UI.fireEvent('RequestSkipFront', number);

        const block = 4450;

        let middleStep = UI.app.engine.wavesurfer.getDuration() / block;
        const zoom = UI.app.engine.wavesurfer.ZoomFactor;
        middleStep /= zoom;

        if (count < 12) {
          middleStep = 0;
        }

        setTimeout(function () {
          step(number + middleStep, ++count);
        }, 40);
      }
    };
    buttonFrontTimer = setTimeout(function () {
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

  let keyArrayBackTime = 0;
  let keyArrayBackMultiplier = 1;
  let keyArrayBackSkipFrames = 4;
  UI.KeyHandler.addCallback(
    'KeyArrowBack',
    function (key, c, ev) {
      if (UI.InteractionHandler.on || !UI.app.engine.isReady) return;

      const time = ev.timeStamp;
      const diff = time - keyArrayBackTime;

      if (diff > 158) {
        keyArrayBackMultiplier = 1;
        keyArrayBackSkipFrames = 4;
      } else {
        if (--keyArrayBackSkipFrames < 0 && keyArrayBackMultiplier < 6.0)
          keyArrayBackMultiplier += 0.05;
      }

      keyArrayBackTime = time;

      // get zoom factor
      let jump = 0.5;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      const totalDuration = UI.app.engine.wavesurfer.getDuration();

      jump = Math.max(totalDuration / 200, 0.05);
      jump /= zoom;
      jump *= keyArrayBackMultiplier;

      UI.fireEvent('RequestSkipBack', jump);
    },
    [37]
  );

  let keyArrayFrontTime = 0;
  let keyArrayFrontMultiplier = 1;
  let keyArrayFrontSkipFrames = 4;
  UI.KeyHandler.addCallback(
    'KeyArrowFront',
    function (key, c, ev) {
      if (UI.InteractionHandler.on || !UI.app.engine.isReady) return;

      const time = ev.timeStamp;
      const diff = time - keyArrayFrontTime;

      if (diff > 158) {
        keyArrayFrontMultiplier = 1;
        keyArrayFrontSkipFrames = 4;
      } else {
        if (--keyArrayFrontSkipFrames < 0 && keyArrayFrontMultiplier < 6.0)
          keyArrayFrontMultiplier += 0.05;
      }

      keyArrayFrontTime = time;

      let jump = 0.5;
      const zoom = UI.app.engine.wavesurfer.ZoomFactor;
      const totalDuration = UI.app.engine.wavesurfer.getDuration();

      jump = Math.max(totalDuration / 200, 0.05);

      jump /= zoom;
      jump *= keyArrayFrontMultiplier;

      UI.fireEvent('RequestSkipFront', jump);
    },
    [39]
  );
  UI.KeyHandler.addCallback(
    'KeyShiftArrowBack',
    function (key) {
      if (UI.InteractionHandler.on || !UI.app.engine.isReady) return;

      const region = UI.app.engine.wavesurfer.regions.list[0];
      if (region) {
        const position = UI.app.engine.wavesurfer.ActiveMarker;
        const totalDuration = UI.app.engine.wavesurfer.getDuration();

        let durr = region.end / totalDuration;

        if (position > durr + 0.004) {
          UI.fireEvent('RequestSeekTo', durr - 0.0001);
          return;
        }

        durr = region.start / totalDuration;

        if (position > durr + 0.004) {
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
      if (UI.InteractionHandler.on || !UI.app.engine.isReady) return;

      // if region skip to the region
      const region = UI.app.engine.wavesurfer.regions.list[0];
      if (region) {
        const position = UI.app.engine.wavesurfer.ActiveMarker;
        const totalDuration = UI.app.engine.wavesurfer.getDuration();

        let durr = region.start / totalDuration;

        if (position < durr - 0.004) {
          UI.fireEvent('RequestSeekTo', durr);
          return;
        }

        durr = region.end / totalDuration;

        if (position < durr - 0.004) {
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

  const buttonBackTotal = document.createElement('button');
  buttonBackTotal.setAttribute('tabIndex', -1);
  buttonBackTotal.className = 'pk_button icon-previous2';
  buttonBackTotal.innerHTML = '<span>Seek Start (Shift + left arrow)</span>';
  transport.appendChild(buttonBackTotal);
  buttonBackTotal.onclick = function () {
    UI.fireEvent('RequestRegionClear');
    UI.fireEvent('RequestSeekTo', 0);
    this.blur();
  };

  const buttonFrontTotal = document.createElement('button');
  buttonFrontTotal.setAttribute('tabIndex', -1);
  buttonFrontTotal.className = 'pk_button icon-next2';
  buttonFrontTotal.innerHTML = '<span>Seek End (Shift + right arrow)</span>';
  buttonFrontTotal.onclick = function () {
    UI.fireEvent('RequestRegionClear');
    UI.fireEvent('RequestSeekTo', 0.996);
    this.blur();
  };
  transport.appendChild(buttonFrontTotal);

  const buttonRecord = document.createElement('button');
  buttonRecord.setAttribute('tabIndex', -1);
  buttonRecord.className = 'pk_button icon-rec';
  buttonRecord.innerHTML = '<span>Record (R)</span>';
  buttonRecord.onclick = function () {
    if (this.getAttribute('disabled') === 'disabled') {
      this.blur();
      return;
    }

    UI.fireEvent('RequestActionRecordToggle');
    this.blur();
  };

  UI.listenFor('ErrorRec', function () {
    buttonRecord.style.opacity = 0.6;
    buttonRecord.setAttribute('disabled', 'disabled');
  });

  transport.appendChild(buttonRecord);
  UI.KeyHandler.addCallback(
    'KeyRecR',
    function (k) {
      if (UI.InteractionHandler.on) return;
      buttonRecord.click();
    },
    [82]
  );

  UI.listenFor('DidActionRecordStart', function () {
    buttonRecord.classList.add('pk_active');
  });
  UI.listenFor('DidActionRecordStop', function () {
    buttonRecord.classList.remove('pk_active');
  });

  UI.KeyHandler.addCallback(
    'KeyTab',
    function (key) {
      if (UI.InteractionHandler.on || !UI.app.engine.isReady) return;

      UI.fireEvent('RequestViewCenterToCursor');
    },
    [9]
  );

  const isChrome = !!window.chrome;
  const timing = document.createElement('div');
  timing.className = 'pk_time_container';

  const timingspan = document.createElement('span');

  if (!isChrome) {
    timingspan.textContent = '00:00:000';
    timingspan.className = 'pk_timing';
    timing.appendChild(timingspan);
  }

  /////
  const pk_timing_canvas = document.createElement('canvas');
  pk_timing_canvas.className = 'pk_timing_canvas';
  pk_timing_canvas.width = 150;
  pk_timing_canvas.height = 40;
  let pk_timing_number = '00:00:000';
  const pk_timing_context = pk_timing_canvas.getContext('2d', { alpha: false });
  const timingCaches = {};

  if (isChrome) {
    timing.appendChild(pk_timing_canvas);
    pk_timing_context.fillStyle = '#000';
    pk_timing_context.fillRect(0, 0, 150, 40);

    for (let ii = 0; ii < 11; ++ii) {
      const currentCache = document.createElement('canvas');
      currentCache.width = 18;
      currentCache.height = 26;
      const currentContext = currentCache.getContext('2d', { alpha: false });
      currentContext.font = '29px Helvetica, Arial, sans-serif';
      currentContext.textAlign = 'center';
      currentContext.fillStyle = '#000';
      currentContext.fillRect(0, 0, 18, 26);
      currentContext.fillStyle = '#fff';
      currentContext.textBaseline = 'middle';

      if (ii === 10) {
        currentContext.fillText(':', 8, 14);
        timingCaches[':'] = currentCache;
      } else {
        currentContext.fillText(ii + '', 9, 14);
        timingCaches[ii + ''] = currentCache;
      }
      // timingCaches.push (currentCache);
      // document.body.appendChild( currentCache );
    }

    (function (pk_timing_context, timingCaches) {
      const ttm = '00:00:000';
      for (let jk = 0; jk < ttm.length; ++jk) {
        pk_timing_context.drawImage(timingCaches[ttm[jk]], jk * 16, 10);
      }
    })(pk_timing_context, timingCaches);
  }
  /////

  const totalDuration = document.createElement('span');
  totalDuration.textContent = '00:00:000';
  totalDuration.className = 'pk_total_duration';
  timing.appendChild(totalDuration);

  const hoverDuration = document.createElement('span');
  hoverDuration.textContent = '00:00:000';
  hoverDuration.className = 'pk_hover_duration';
  timing.appendChild(hoverDuration);

  setTimeout(function () {
    UI.listenFor('DidZoom', function (v, f) {
      // do something smarter for f (event) ####
      if (f)
        hoverDuration.textContent = formatTime(
          UI.app.engine.wavesurfer.drawer.handleEvent(f) *
            UI.app.engine.wavesurfer.VisibleDuration +
            UI.app.engine.wavesurfer.LeftProgress
        );
    });

    let oldRefresh = 0;

    const avv = document.getElementsByClassName('pk_audio_view')[0];
    avv.addEventListener(
      'mousemove',
      function (e) {
        // re-run the mousemove fam on zoom based on the pointer position)

        // throttle this as well ####  violation
        const newRefresh = e.timeStamp;

        if (newRefresh - oldRefresh < 58) {
          return;
        }

        oldRefresh = newRefresh;

        hoverDuration.textContent = formatTime(
          UI.app.engine.wavesurfer.drawer.handleEvent(e) *
            UI.app.engine.wavesurfer.VisibleDuration +
            UI.app.engine.wavesurfer.LeftProgress
        );
      },
      false
    );

    const mainContext = new ContextMenu(avv);

    mainContext.addOption(
      'Select Visible View',
      function (e, x, i) {
        UI.fireEvent('RequestRegionSet');
      },
      false
    );

    mainContext.addOption(
      'Reset Zoom',
      function (e) {
        UI.fireEvent('RequestZoomUI', 0);
      },
      false
    );

    mainContext.addOption(
      'Set Volume/Gain',
      function (e) {
        UI.fireEvent('RequestFXUI_Gain');
      },
      false
    );

    mainContext.addOption(
      'Copy',
      function (e) {
        const region = UI.app.engine.wavesurfer.regions.list[0];
        if (!region) return;

        UI.fireEvent('RequestActionCopy');
      },
      false
    );
    mainContext.addOption(
      'Paste',
      function (e) {
        if (!copable) return;
        UI.fireEvent('RequestActionPaste');
      },
      false
    );
    mainContext.addOption(
      'Cut',
      function (e) {
        const region = UI.app.engine.wavesurfer.regions.list[0];
        if (!region) return;

        UI.fireEvent('RequestActionCut', 1);
      },
      false
    );
    mainContext.addOption(
      'Insert Silence',
      function (e) {
        UI.fireEvent('RequestFXUI_Silence', 0); // #### call effect
      },
      false
    );
    // ---

    let copable = false;
    UI.listenFor('DidSetClipboard', function (value) {
      if (value) copable = true;
      else copable = false;
    });

    mainContext.onOpen = function (menu, div) {
      const divs = div.childNodes;
      if (!copable) divs[4].className += ' pk_inactive';

      UI.fireEvent('RequestPause');

      const region = UI.app.engine.wavesurfer.regions.list[0];
      if (region) return;

      divs[3].className += ' pk_inactive';
      divs[5].className += ' pk_inactive';
    };
  }, 1000);

  UI.listenFor('DidUpdateLen', function (value) {
    totalDuration.textContent = formatTime(value);
  });

  function formatTime(time) {
    let timeSeconds = time >> 0;
    const miliseconds = time - timeSeconds;

    if (timeSeconds < 10) {
      if (time === 0) return '00:00:000';
      timeSeconds = '00:0' + timeSeconds;
    } else if (timeSeconds < 60) {
      timeSeconds = '00:' + timeSeconds;
    } else {
      const m = (timeSeconds / 60) >> 0;
      const s = timeSeconds % 60;
      timeSeconds = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' + s : s);
    }

    if (miliseconds < 0.1) {
      return timeSeconds + ':0' + (miliseconds < 0.01 ? '0' : '') + ((miliseconds * 1000) >> 0);
    }

    return timeSeconds + ':' + ((miliseconds * 1000) >> 0); // (miliseconds+'').substr(2, 3);
  }
  UI.formatTime = formatTime;

  let volume1 = 0;
  let volume2 = 0;
  let oldRefresh = 0;
  let wvpnt = document.querySelector('.pk_wave_point');

  UI.listenFor('DidAudioProcess', function (value) {
    const time = value[0];
    const loudness = value[1];

    const newRefresh = value[2] || window.performance.now();

    if (newRefresh - oldRefresh < 50) {
      return;
    }

    oldRefresh = newRefresh;

    if (time > -1) {
      if (!isChrome) {
        timingspan.textContent = formatTime(time);
      } else {
        const ttm = formatTime(time);
        let exit = false;

        for (let jk = 0; jk < ttm.length; ++jk) {
          if (!exit) {
            if (ttm[jk] === pk_timing_number[jk]) {
              continue;
            } else {
              // pk_timing_context.clearRect ((jk * 16), 10, (9 - jk) * 16, 35);
              exit = true;
            }
          }

          pk_timing_context.drawImage(timingCaches[ttm[jk]], jk * 16, 10);
        }
        pk_timing_number = ttm;
      }

      if (UI.app.engine.wavesurfer.ZoomFactor > 1) {
        const perc = time / UI.app.engine.wavesurfer.getDuration();

        if (!wvpnt) wvpnt = document.querySelector('.pk_wave_point');
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
      UI.footer.volumeGaugePeaker.className = 'pk_peaker pk_active';

      UI.footer.volumeGaugeInner.style.transform = 'translate3d(100%,0,0)';
      // UI.footer.volumeGaugeInner.style.width = '0%';
      volume1 = 100;

      UI.footer.volumeGaugePeaker.setAttribute(
        'title',
        'Peak at ' + UI.app.engine.wavesurfer.getCurrentTime().toFixed(2)
      );
      if (loudness[1] > 0) {
        UI.footer.volumeGaugePeaker2.className = 'pk_peaker pk_active';

        UI.footer.volumeGaugeInner2.style.transform = 'translate3d(100%,0,0)';
        // UI.footer.volumeGaugeInner2.style.width = '0%';
        volume2 = 100;

        UI.footer.volumeGaugePeaker2.setAttribute(
          'title',
          'Peak at ' + UI.app.engine.wavesurfer.getCurrentTime().toFixed(2)
        );
      }
    } else if (loudness[1] > 0) {
      UI.footer.volumeGaugePeaker2.className = 'pk_peaker pk_active';

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

  const copyButton = document.createElement('button');
  copyButton.setAttribute('tabIndex', -1);
  copyButton.className = 'pk_button icon-files-empty pk_inactive';
  copyButton.innerHTML = '<span>Copy Selection (Shift + C)</span>';
  actions.appendChild(copyButton);

  copyButton.onclick = function () {
    UI.fireEvent('RequestActionCopy');
    this.blur();
  };

  UI.listenFor('DidSetClipboard', function (value) {
    if (value) pasteButton.classList.remove('pk_inactive');
    else pasteButton.classList.add('pk_inactive');
  });

  const pasteButton = document.createElement('button');
  pasteButton.setAttribute('focusable', 'false');
  pasteButton.className = 'pk_button icon-file-text2 pk_inactive';
  pasteButton.innerHTML = '<span>Paste Selection (Shift + V)</span>';
  actions.appendChild(pasteButton);

  pasteButton.onclick = function () {
    UI.fireEvent('RequestActionPaste');
    this.blur();
  };

  const cutButton = document.createElement('button');
  cutButton.setAttribute('tabIndex', -1);
  cutButton.className = 'pk_button icon-scissors pk_inactive';
  cutButton.innerHTML = '<span>Cut Selection (Shift + X)</span>';
  actions.appendChild(cutButton);

  cutButton.onclick = function () {
    UI.fireEvent('RequestActionCut', 1);
    this.blur();
  };

  const silenceButton = document.createElement('button');
  silenceButton.setAttribute('tabIndex', -1);
  silenceButton.className = 'pk_button icon-silence';
  silenceButton.innerHTML = '<span>Insert Silence (Shift + N)</span>';
  actions.appendChild(silenceButton);

  UI.KeyHandler.addCallback(
    'KeyShiftN',
    function (k) {
      if (UI.InteractionHandler.on) return;

      silenceButton.click();
    },
    [16, 78]
  );

  silenceButton.onclick = function () {
    UI.fireEvent('RequestFXUI_Silence');
    this.blur();
  };

  const selection = document.createElement('div');
  selection.className = 'pk_selection';
  selection.innerHTML =
    '<div class="pk_select_list">' +
    '<span class="pk_title">Selection:</span>' +
    '<div><span class="title">Start:</span><span class="s_s pk_dat">-</span></div>' +
    '<div><span class="title">End:</span><span class="s_e pk_dat">-</span></div>' +
    '<div><span  class="title">Duration:</span><span class="s_d pk_dat">-</span></div>' +
    '</div>';

  const buttonClearSelection = document.createElement('button');
  buttonClearSelection.setAttribute('tabIndex', -1);
  buttonClearSelection.className = 'pk_button icon-clearsel pk_inactive';
  buttonClearSelection.innerHTML = '<span>Clear Selection (Q key)</span>';

  let selectedSpans = selection.getElementsByClassName('pk_dat');
  UI.listenFor('DidCreateRegion', function (region) {
    copyButton.classList.remove('pk_inactive');
    cutButton.classList.remove('pk_inactive');
    buttonClearSelection.classList.remove('pk_inactive');

    if (region) {
      if (!selectedSpans[0]) selectedSpans = document.querySelectorAll('.pk_select_list .pk_dat');
      selectedSpans[0].textContent = region.start.toFixed(3);
      selectedSpans[1].textContent = region.end.toFixed(3);
      selectedSpans[2].textContent = (region.end - region.start).toFixed(3);
    }
  });
  UI.listenFor('DidDestroyRegion', function () {
    copyButton.classList.add('pk_inactive');
    cutButton.classList.add('pk_inactive');
    buttonClearSelection.classList.add('pk_inactive');

    if (!selectedSpans[0]) selectedSpans = document.querySelectorAll('.pk_select_list .pk_dat');
    selectedSpans[0].textContent = '-';
    selectedSpans[1].textContent = '-';
    selectedSpans[2].textContent = '-';
  });

  buttonClearSelection.onclick = function () {
    UI.fireEvent('RequestRegionClear');
    this.blur();
  };
  selection.appendChild(buttonClearSelection);

  toolbar.appendChild(timing);

  UI.listenFor('DidChanToggle', function (chan, value) {
    const region = UI.app.engine.wavesurfer.regions.list[0];
    if (!region) return;

    if (value === 1) {
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
  toolbar.appendChild(buttonGroups);
  buttonGroups.appendChild(transport);
  buttonGroups.appendChild(actions);
  toolbar.appendChild(selection);

  container.appendChild(toolbar);

  UI.element.appendChild(container);

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
    const screenHeight = window.screen.height;
    const screenWidth = window.screen.width;

    const iw = window.innerWidth;
    const ih = window.innerHeight;

    let barsVisible = false;
    let ratio = 0;

    if (window.orientation === 0) {
      ratio = ih / screenHeight;
    } else if (window.orientation === 90 || window.orientation === -90) {
      ratio = ih / screenWidth;
    }
    if (ratio < 0.8) barsVisible = true;

    return barsVisible;
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
            const modalHeight = document.getElementsByClassName('pk_modal')[0].clientHeight;

            if (modalHeight - scrolled < window.innerHeight - 80) {
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
