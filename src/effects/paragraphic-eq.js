/**
 * Paragraphic EQ dialog.
 *
 * An interactive EQ curve editor rendered on canvas (ParagraphicEqGraph):
 * draggable band handles with per-band frequency / gain / Q / filter-type
 * controls, live preview wiring, and preset support.
 */

import { AudioEffectModal } from '../ui/modals.js';

const modal_name = 'modalfx';
const modal_esc_key = modal_name + 'esc';
const max_db_val = 35;

function ParagraphicEqGraph() {
  const q = this;
  let _id = 0;

  let _is_render_scheduled = false;
  let _is_render_scheduled2 = false;

  q.act = null;
  q.ranges = [];
  q.ui = {};

  this.Callback = function () {};

  this.Init = function (container) {
    const q = this;

    q.el = container;
    _make_ui(q);
    _make_evs(q);

    q.Render();
  };

  this.Add = function (type, is_on, freq, gain, qval, coords_x, coords_y) {
    const q = this;

    const new_range = {
      id: ++_id,
      type: type ? type : 'peaking',
      freq: freq || 0,
      gain: gain || 0,
      q: qval || 5,

      // interface
      _on: is_on,
      _hov: false,
      _el: null,
      _coords: {
        x: coords_x || 0,
        y: coords_y || 0,
      },
      _arr: [],
    };

    q.ranges.push(new_range);
    q.ranges.sort(_compare);

    if (q.act) {
      q.act.el.classList.remove('pk_act');
    }

    q.act = new_range;

    _range_compute_arr(new_range);
    new_range.el = _range_render_el(q, new_range, ' pk_act');

    q.Callback && q.Callback();

    q.Render();
  };

  this.Remove = function (range) {
    const q = this;

    let l = q.ranges.length;

    while (l-- > 0) {
      if (q.ranges[l] === range) {
        q.ranges.splice(l, 1);
        break;
      }
    }

    if (range.el) {
      range.el.parentNode.removeChild(range.el);
      range.el = null;
    }

    if (q.act && q.act === range) {
      q.act = null;
    }

    q.Render();
  };

  const _fillstyle = '#d9d955';

  const _anim_render = function () {
    _render(q);
  };

  this.Render = function () {
    const q = this;

    if (_is_render_scheduled) return;
    _is_render_scheduled = true;

    requestAnimationFrame(_anim_render);
  };

  this.RenderBars = function (_, freq) {
    const q = this;

    if (_is_render_scheduled2) return;
    _is_render_scheduled2 = true;

    requestAnimationFrame(function () {
      _render_bars(q, freq);
    });
  };

  const _render_bars = function (q, freq) {
    _is_render_scheduled2 = false;

    if (!freq) return;

    const ctx = q.ui.ctx_bars;
    const canvas = q.ui.canvas_bars;

    const cw = canvas.width;
    const ch = canvas.height;

    // ctx.fillStyle = '#000';
    // ctx.fillRect (0, 0, cw, ch);
    ctx.clearRect(0, 0, cw, ch);

    const bufferLength = 512; // 256
    const max_bars = 117 * 2;
    const barWidth = (cw / max_bars).toFixed(1) / 1;
    let barHeight = 0;
    let x = 0;

    //
    for (let i = 0; i < 117; ++i) {
      barHeight = freq[i];

      // map.push ( i * 43 );

      const newheight = ((barHeight / 256) * ch) >> 0;

      ctx.fillRect(x, ch - newheight, barWidth, newheight);
      x += barWidth; // + 1;
    }

    for (let i = 0; i < 117; ++i) {
      // (116*3.4)
      barHeight = freq[117 + ((i * 3.34) >> 0)];

      // map.push ( (120 + (i * 3)) * 43 );
      const newheight = ((barHeight / 256) * ch) >> 0;

      ctx.fillRect(x, ch - newheight, barWidth, newheight);
      x += barWidth; // + 1;
    }

    //			console.log( map );

    // what if we care for the small bars first
    /*
			var steps = (total_freq/bufferLength) >> 0;

			// we care for

			// 256 bars

			// 32
			// 64
			// 125
			// 250
			// 500
			// 1000
			// 2000
			// 4000
			// 8000
			// 16000
			// 20000
			var arr = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, 20000];
			var curr = 0;
			var curr_bars = 0;
			var bars_per_entry = (bufferLength / 10) >> 0;

			for (var i = 0; i < bufferLength; ++i) {

				if (++curr_bars < bars_per_entry)
				{

					var ff = arr[ curr ];
					var ff_next = arr[ curr + 1];

					var m = 0;
					for (; m < bufferLength; ++m)
					{
						if (m * steps > ff) {
							--m;
							break;
						}
					}

					barHeight = freq[ m ];

					var newheight = ((barHeight / 256) * ch) >> 0;
					ctx.fillRect (x, ch - newheight, barWidth, newheight);
					x += barWidth;// + 1;
				}
				else
				{
					++curr;
					curr_bars = 0;
				}
			}
*/

    //			for (var i = 0; i < bufferLength; ++i) {
    //				barHeight = freq[i];
    //				var newheight = ((barHeight / 256) * ch) >> 0;

    //				ctx.fillRect (x, ch - newheight, barWidth, newheight);
    //				x += barWidth;// + 1;
    //			}
  };

  const line_arr = new Array(1000);
  const _render = function (q) {
    _is_render_scheduled = false;

    const ctx = q.ui.ctx_eq;
    const canvas = q.ui.canvas_eq;

    const cw = canvas.width;
    const ch = canvas.height;

    const ch_half = ch / 2;

    // --------------------
    ctx.clearRect(0, 0, cw, ch);

    ctx.fillStyle = _fillstyle;

    if (q.ranges.length === 0) {
      ctx.beginPath();
      ctx.moveTo(0, ch_half);
      ctx.lineTo(cw, ch_half);
      ctx.stroke();

      return;
    }

    // render the line based on the elements
    let first = true;
    const arr = [];
    for (let i = 0; i < total; ++i) {
      arr[i] = 0;
    }

    for (let o = 0; o < q.ranges.length; ++o) {
      const curr = q.ranges[o];

      if (!curr._on) continue;

      if (first) {
        first = false;
        for (let i = 0; i < total; ++i) {
          line_arr[i] = curr._arr[i];
        }
      } else {
        for (let i = 0; i < total; ++i) {
          line_arr[i] += curr._arr[i];
        }
      }
      // ---
    }

    if (first) {
      ctx.beginPath();
      ctx.moveTo(0, ch_half);
      ctx.lineTo(cw, ch_half);
      ctx.stroke();
    } else {
      // --
      ctx.beginPath();
      ctx.moveTo(0, ch_half - line_arr[0] * (ch_half / max_db_val));

      for (let i = 0; i < total / 4; i += 1) {
        const el = line_arr[i];

        const x = i * 2 * (cw / total);
        const y = ch_half - el * (ch_half / max_db_val);

        ctx.lineTo(x, y);
      }

      let hh = 0;
      for (let i = total / 4; i < total; i += 3) {
        const el = line_arr[i];

        hh += 2;

        const x = (total / 2 + hh) * (cw / total);
        const y = ch_half - el * (ch_half / max_db_val);

        ctx.lineTo(x, y);
      }

      ctx.stroke();
    }
    // ---

    // draw the dots
    const radius = 6;
    for (let o = 0; o < q.ranges.length; ++o) {
      const curr = q.ranges[o];

      const center_x = curr._coords.x;
      const center_y = curr._coords.y;

      ctx.beginPath();
      ctx.arc(center_x, center_y, radius, 0, 2 * Math.PI, false);

      if (curr === q.act) {
        ctx.shadowBlur = 24;

        if (curr._on) ctx.fillStyle = '#fff';
        else ctx.fillStyle = '#686868';

        ctx.stroke();
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = _fillstyle;
      } else if (curr._hov) {
        if (curr._on) ctx.fillStyle = 'blue';
        else ctx.fillStyle = 'darkblue';

        ctx.stroke();
        ctx.fill();

        ctx.fillStyle = _fillstyle;
      } else if (curr._on) {
        ctx.fill();
      } else {
        ctx.fillStyle = '#555';
        ctx.fill();
        ctx.fillStyle = _fillstyle;
      }
    }

    // ---
  };

  ////////////////////////////////////////////
  // helpers
  let _dbncr = null;
  const total_freq = 20000; // 22000
  const total = 1000;
  const jump = (total_freq / total) >> 0;

  function _range_update(q, range, new_range, compute_coords) {
    let modified = false;
    let old_val = null;

    for (const key in new_range) {
      if (range[key] !== new_range[key]) {
        modified = true;
        old_val = range[key];
        range[key] = new_range[key];

        if (key === '_on') {
          const el = document.getElementById('pgon' + range.id);
          el.checked = range[key];
        } else if (key === 'freq') {
          const el = range.el.getElementsByClassName('pk_freq')[0];
          //requestAnimationFrame (function () {
          el.value = range[key];
          //});
        } else if (key === 'gain') {
          const el = range.el.getElementsByClassName('pk_gain')[0];
          //requestAnimationFrame (function () {
          el.value = range[key];
          //});
        } else if (key === 'q') {
          const el = range.el.getElementsByClassName('pk_q')[0];
          //requestAnimationFrame (function () {
          el.value = range[key];
          //});
        } else if (key === 'type') {
          // -----
          const el = range.el.getElementsByTagName('select')[0];
          if (range[key] === 'peaking') el.options[0].selected = true;
          else if (range[key] === 'lowpass') el.options[1].selected = true;
          else if (range[key] === 'highpass') el.options[2].selected = true;

          _range_compute_arr(range);
          q.ranges.sort(_compare);
        }
        // ---
      }
    }

    if (modified) {
      if (compute_coords) {
        // compute coords of the canvas
        const canvas = q.ui.canvas_eq;
        const cw = canvas.width;
        const ch = canvas.height;

        const tmp_x = 0;
        if (range.freq <= 5000) {
          range._coords.x = ((range.freq / 5000) * (cw / 2)).toFixed(1) / 1;
        } else {
          range._coords.x = (cw / 2 + ((range.freq - 5000) / 15000) * (cw / 2)).toFixed(1) / 1;
        }

        // range._coords.x = ((range.freq / total_freq) * cw).toFixed(1)/1;

        if (range.type === 'peaking')
          range._coords.y =
            ((1.0 - (range.gain + max_db_val) / (max_db_val * 2)) * ch).toFixed(1) / 1;
        else range._coords.y = (ch / 2).toFixed(1) / 1;
      }

      if (_dbncr) {
        clearTimeout(_dbncr);
      }

      _dbncr = setTimeout(function () {
        q.Callback();
        _dbncr = null;
      }, 38);

      q.Render();
    }
    // ---
  }

  function _ease(t) {
    return t * t * t * t * t;
  }
  function _ease_out(t) {
    return t * t * t * t;
  }

  function _range_compute_arr(range) {
    const arr = [];

    for (let i = 0; i < total; ++i) {
      arr[i] = 0;
    }

    range._arr = arr;

    // -------------
    const rounding = total_freq * (2 / range.q);
    const half_rounding = (rounding / jump) >> 0;

    if (range.type === 'peaking') {
      const edge_left = range.freq - rounding / 2;
      const edge_right = range.freq + rounding / 2;

      const start = (edge_left / jump) >> 0;
      const end = (edge_right / jump) >> 0;

      let j = 0;
      for (let i = start; i < end; ++i) {
        const ii = i * jump;
        if (ii < range.freq) {
          ++j;
          arr[i] += _ease(j / (half_rounding / 2)) * range.gain;
        } else {
          --j;
          arr[i] += _ease(j / (half_rounding / 2)) * range.gain;
        }
      }

      return;
    }

    if (range.type === 'highpass') {
      const edge_left = range.freq - rounding;
      const start = (edge_left / jump) >> 0;
      const end = (range.freq / jump) >> 0;

      for (let i = 0; i < start; ++i) {
        arr[i] = -max_db_val;
      }

      // todo improve this!!!
      let j = half_rounding;
      for (let i = start; i < end; ++i) {
        --j;
        arr[i] -= _ease_out(j / half_rounding) * max_db_val;
      }

      return;
    }

    if (range.type === 'lowpass') {
      const edge_right = range.freq + rounding;
      const start = (range.freq / jump) >> 0;
      const end = (edge_right / jump) >> 0;

      for (let i = end; i < total; ++i) {
        arr[i] = -max_db_val;
      }

      // todo improve this!!!
      let j = 0;
      for (let i = start; i < end; ++i) {
        ++j;
        arr[i] -= _ease_out(j / half_rounding) * max_db_val;
      }

      return;
    }

    // -------------
  }

  function _make_ui(q) {
    const el_drawer = document.createElement('div');
    el_drawer.className = 'pk_row';

    const canvas_bars = document.createElement('canvas');
    const canvas_eq = document.createElement('canvas');

    canvas_bars.className = 'pk_peq2';
    canvas_eq.className = 'pk_peq';

    canvas_bars.width = 450 / 2;
    canvas_bars.height = 224 / 2;

    canvas_eq.width = 450;
    canvas_eq.height = 225;

    const ctx_bars = canvas_bars.getContext('2d', { alpha: true, antialias: false });
    const ctx_eq = canvas_eq.getContext('2d', { alpha: true, antialias: false });

    ctx_bars.fillStyle = '#365457'; // '#486a6e';

    // ctx_eq.lineWidth = 2;
    ctx_eq.strokeStyle = '#FF0000';
    ctx_eq.shadowColor = '#FF2222';
    ctx_eq.shadowBlur = 0;

    // render the decibel and the frequencies
    const marker_freqs = document.createElement('div');
    marker_freqs.className = 'pk_peq3 pk_noselect';
    marker_freqs.innerHTML =
      '<span>32</span>' +
      //			'<span>32</span>' +
      //			'<span>64</span>' +
      //			'<span>128</span>' +
      //			'<span>250</span>' +
      //			'<span>500</span>' +
      '<span style="position:absolute;left:3.5%">500<span></span></span>' +
      '<span style="position:absolute;left:9%">1k<span></span></span>' +
      '<span style="position:absolute;left:19%">2k<span></span></span>' +
      '<span style="position:absolute;left:38%">4k<span></span></span>' +
      '<span style="position:absolute;left:50%">5k<span></span></span>' +
      '<span style="position:absolute;left:59%">8k<span></span></span>' +
      '<span style="position:absolute;left:72%">12k<span></span></span>' +
      '<span style="position:absolute;left:85%">16k<span></span></span>' +
      '<span style="float:right">20k</span>';

    const marker_dbs = document.createElement('div');
    marker_dbs.className = 'pk_peq4 pk_noselect';
    marker_dbs.innerHTML =
      '<span style="top:0">35</span>' +
      '<span style="top:10%">28<span></span></span>' +
      '<span style="top:20%">21<span></span></span>' +
      '<span style="top:30%">14<span></span></span>' +
      '<span style="top:40%">7<span></span></span>' +
      '<span>0<span></span></span>' +
      '<span style="top:60%">-7<span></span></span>' +
      '<span style="top:70%">-14<span></span></span>' +
      '<span style="top:80%">-21<span></span></span>' +
      '<span style="top:90%">-28<span></span></span>' +
      '<span style="top:100%">35</span>';

    el_drawer.appendChild(canvas_bars);
    el_drawer.appendChild(canvas_eq);
    el_drawer.appendChild(marker_freqs);
    el_drawer.appendChild(marker_dbs);

    q.el.appendChild(el_drawer);

    // element's area
    const el_list = document.createElement('div');
    el_list.className = 'pk_row pk_noselect pk_pglst';

    el_list.innerHTML =
      '<div class="pk_pgeq_els">' +
      '<span class="pk_txlft"> #</span><span>type</span><span>gain</span><span>freq</span><span>Q</span>' +
      '</div>';

    q.el.appendChild(el_list);

    q.ui.ctx_bars = ctx_bars;
    q.ui.ctx_eq = ctx_eq;

    q.ui.canvas_bars = canvas_bars;
    q.ui.canvas_eq = canvas_eq;
    q.ui.el_list = el_list;
  }

  function _make_evs(q) {
    const ctx = q.ui.ctx_eq;
    const canvas = q.ui.canvas_eq;

    let click_time = 0;
    let is_dragging = false;

    const _move = function (e) {
      if (!is_dragging || !q.act) return;

      let ex = 0;
      let ey = 0;

      if (e.touches) {
        if (e.touches.length > 1) {
          return;
        }

        ex = e.touches[0].clientX;
        ey = e.touches[0].clientY;
      } else {
        ex = e.clientX;
        ey = e.clientY;
      }

      const bounds = canvas.getBoundingClientRect();
      const cw = canvas.width;
      const ch = canvas.height;

      const posx = ex - bounds.left;
      const posy = ey - bounds.top;

      const rel_x = posx / cw;
      const rel_y = posy / ch;

      q.act._coords.x = posx;
      q.act._coords.y = posy;

      // up until half it's 0 - 5000, second half 5000 -> 2200
      let freq = 0;

      if (rel_x <= 0.5) {
        freq = (5000 * (rel_x * 2)) >> 0;
      } else {
        freq = 5000 + (((rel_x - 0.5) * 2 * 15000) >> 0);
      }

      //				var freq = (rel_x * (total_freq) + 0) >> 0; // + 16 (min freq)
      const gain = ((rel_y - 0.5) * -2 * max_db_val).toFixed(2) / 1;

      _range_update(q, q.act, {
        freq: freq,
        gain: gain,
      });
      _range_compute_arr(q.act);
    };

    const _end = function (e) {
      is_dragging = false;

      canvas.removeEventListener('mousemove', _move);
      canvas.removeEventListener('mouseup', _end);

      canvas.removeEventListener('touchmove', _move);
      canvas.removeEventListener('touchup', _end);
    };

    const mdown = function (e) {
      const unchecked = !!q.act;

      if (q.ranges.length === 0) {
        if (unchecked) q.Render();
        return;
      }

      const bounds = canvas.getBoundingClientRect();
      const cw = canvas.width;
      const ch = canvas.height;

      const posx = e.clientX - bounds.left;
      const posy = e.clientY - bounds.top;

      const dist_x = e.is_touch ? 20 : 10;
      const dist_y = e.is_touch ? 20 : 9;

      for (let o = 0; o < q.ranges.length; ++o) {
        const curr = q.ranges[o];

        if (Math.abs(curr._coords.x - posx) < dist_x && Math.abs(curr._coords.y - posy) < dist_y) {
          if (unchecked) {
            q.act.el.classList.remove('pk_act');
          }

          q.act = curr;
          q.act.el.classList.add('pk_act');

          is_dragging = true;

          q.Render();

          // check if we are targetting a circle

          if (!e.is_touch) {
            canvas.addEventListener('mousemove', _move, false);
            canvas.addEventListener('mouseup', _end, false);
          } else {
            e.ev.preventDefault();
            e.ev.stopPropagation();

            canvas.addEventListener('touchmove', _move, false);
            canvas.addEventListener('touchup', _end, false);
          }

          return;
        }
        // ---
      }

      if (unchecked) {
        q.act.el.classList.remove('pk_act');
        // un-highlight
        q.act = null;

        q.Render();
      }

      // ----
    };

    canvas.addEventListener('mousedown', mdown, false);

    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) {
        e.preventDefault();
        e.stopPropagation();

        return;
      }

      const ev = {
        clientX: e.touches[0].clientX,
        clientY: e.touches[0].clientY,
        is_touch: true,
        ev: e,
      };

      mdown(ev);
    });

    canvas.addEventListener(
      'click',
      function (e) {
        if (e.timeStamp - click_time < 260) {
          const bounds = canvas.getBoundingClientRect();
          const cw = canvas.width;
          const ch = canvas.height;
          const posx = e.clientX - bounds.left;
          const posy = e.clientY - bounds.top;

          const rel_x = posx / cw;
          const rel_y = posy / ch;

          let freq = 0;
          if (rel_x <= 0.5) {
            freq = (5000 * (rel_x * 2)) >> 0;
          } else {
            freq = 5000 + (((rel_x - 0.5) * 2 * 15000) >> 0);
          }

          // var freq = (rel_x * (total_freq) + 0) >> 0; // + 16 (min freq)
          const gain = ((rel_y - 0.5) * -2 * max_db_val).toFixed(2) / 1;
          const qval = 5;
          const type = 'peaking';

          q.Add(type, true, freq, gain, qval, posx, posy);
        }

        click_time = e.timeStamp;
      },
      false
    );

    // ---
  }

  function _range_render_el(q, range, clss) {
    const el_list = q.ui.el_list;

    const el = document.createElement('div');
    el.className = 'pk_pgeq_els' + (clss ? clss : '');
    el.setAttribute('data-id', range.id);

    el.addEventListener(
      'click',
      function (e) {
        if (!range.el) return;

        if (range !== q.act) {
          if (q.act) {
            q.act.el.classList.remove('pk_act');
          }

          q.act = range;
          q.act.el.classList.add('pk_act');

          q.Render();
        }
      },
      false
    );

    el.addEventListener(
      'mouseover',
      function (e) {
        if (!range.el) return;

        if (!range._hov) {
          range._hov = true;
          q.Render();
        }
      },
      false
    );

    el.addEventListener(
      'mouseleave',
      function (e) {
        if (!range.el) return;

        if (range._hov) {
          range._hov = false;
          q.Render();
        }
      },
      false
    );

    // # & on or off
    const chckd = range._on ? 'checked' : '';
    const num = '<i>' + range.id + '</i>';
    const el_num = document.createElement('div');
    el_num.className = 'pk_txlft';
    el_num.innerHTML =
      num +
      '<input type="checkbox" id="pgon' +
      range.id +
      '" class="pk_check" name="onoff" ' +
      chckd +
      '>' +
      '<label for="pgon' +
      range.id +
      '">ON</label>';

    el_num.getElementsByTagName('input')[0].onchange = function (e) {
      _range_update(q, range, { _on: !!this.checked });

      const lbl = this.parentNode.getElementsByTagName('label')[0];
      lbl.innerHTML = this.checked ? 'ON' : 'OFF';
    };
    el.appendChild(el_num);

    // type
    const sel1 = range.type === 'lowpass' ? 'selected' : '';
    const sel2 = range.type === 'highpass' ? 'selected' : '';
    const el_type = document.createElement('div');
    el_type.innerHTML =
      '<select><option>peaking</option><option ' +
      sel1 +
      '>lowpass</option><option ' +
      sel2 +
      '>highpass</option></select>';

    el_type.getElementsByTagName('select')[0].onchange = function (e) {
      const val = this.options[this.selectedIndex].value;

      if (val === 'peaking') {
        el.classList.remove('pk_dis');
      } else {
        el.classList.add('pk_dis');
      }

      _range_update(q, range, { type: val }, 1);
    };

    el.appendChild(el_type);

    // gain
    const el_gain = document.createElement('div');
    el_gain.innerHTML =
      '<input type="number" class="pk_val pk_gain" min="-35" max="35" value="' + range.gain + '">';

    el_gain.getElementsByClassName('pk_gain')[0].onchange = function (e) {
      if (!this.value) {
        this.value = 0;
      }

      if (this.hasAttribute('data-open')) {
        this.parentNode.getElementsByClassName('pk_horiz')[0].value = this.value;
      }

      _range_update(q, range, { gain: this.value / 1 }, 1);
      _range_compute_arr(range);
    };
    el_gain.getElementsByClassName('pk_gain')[0].onfocus = function (e) {
      if (this.hasAttribute('data-open')) return;

      const self = this;
      const parent = this.parentNode;
      const bar = document.createElement('div');
      bar.className = 'pk_pgeq_freq pk_gain';
      bar.innerHTML =
        '<div class="pk_arr"></div><input type="range" min="-35" max="35" class="pk_horiz pk_gain" step="0.1" value="' +
        range.gain +
        '">';

      bar.getElementsByClassName('pk_horiz')[0].oninput = function (e) {
        if (self.value != this.value) {
          self.value = this.value;
          self.onchange();
        }
      };

      parent.appendChild(bar);
      this.setAttribute('data-open', '1');

      const down = function (e) {
        if (
          !e.target.classList.contains('pk_gain') ||
          (e.target.type === self.type && e.target !== self)
        ) {
          self.removeAttribute('data-open');
          parent.removeChild(bar);
          q.el.removeEventListener('mousedown', down);
          return;
        }
      };
      q.el.addEventListener('mousedown', down, false);
    };
    el.appendChild(el_gain);

    // freq
    const el_freq = document.createElement('div');
    el_freq.innerHTML =
      '<input type="number" class="pk_val pk_freq" min="16" max="20000" value="' +
      range.freq +
      '">';
    el_freq.getElementsByClassName('pk_freq')[0].onchange = function (e) {
      if (!this.value) {
        this.value = 500;
      }

      if (this.hasAttribute('data-open')) {
        this.parentNode.getElementsByClassName('pk_horiz')[0].value = this.value;
      }

      _range_update(q, range, { freq: this.value / 1 }, 1);
      _range_compute_arr(range);
    };

    el_freq.getElementsByClassName('pk_freq')[0].onfocus = function (e) {
      if (this.hasAttribute('data-open')) return;

      const self = this;
      const parent = this.parentNode;
      const bar = document.createElement('div');
      bar.className = 'pk_pgeq_freq pk_freq';
      bar.innerHTML =
        '<div class="pk_arr"></div><input type="range" min="16" max="20000" class="pk_horiz pk_freq" step="1" value="' +
        range.freq +
        '">';

      bar.getElementsByClassName('pk_horiz')[0].oninput = function (e) {
        if (self.value != this.value) {
          self.value = this.value;
          self.onchange();
        }
      };

      parent.appendChild(bar);
      this.setAttribute('data-open', '1');

      const down = function (e) {
        if (
          !e.target.classList.contains('pk_freq') ||
          (e.target.type === self.type && e.target !== self)
        ) {
          self.removeAttribute('data-open');
          parent.removeChild(bar);
          q.el.removeEventListener('mousedown', down);
        }
      };
      q.el.addEventListener('mousedown', down, false);
    };

    el.appendChild(el_freq);

    // q
    const el_q = document.createElement('div');
    el_q.innerHTML =
      '<input type="number" class="pk_val pk_q" min="1" max="50" value="' + range.q + '">';
    el_q.getElementsByClassName('pk_q')[0].onchange = function (e) {
      if (!this.value) {
        this.value = 1;
      }

      if (this.hasAttribute('data-open')) {
        this.parentNode.getElementsByClassName('pk_horiz')[0].value = this.value;
      }

      _range_update(q, range, { q: this.value / 1 }, 1);
      _range_compute_arr(range);
    };

    el_q.getElementsByClassName('pk_q')[0].onfocus = function (e) {
      if (this.hasAttribute('data-open')) return;

      const self = this;
      const parent = this.parentNode;
      const bar = document.createElement('div');
      bar.className = 'pk_pgeq_freq pk_q';
      bar.innerHTML =
        '<div class="pk_arr"></div><input type="range" min="1" max="50" class="pk_horiz pk_q" step="0.1" value="' +
        range.q +
        '">';

      bar.getElementsByClassName('pk_horiz')[0].oninput = function (e) {
        if (self.value != this.value) {
          self.value = this.value;
          self.onchange();
        }
      };

      parent.appendChild(bar);
      this.setAttribute('data-open', '1');

      const down = function (e) {
        if (
          !e.target.classList.contains('pk_q') ||
          (e.target.type === self.type && e.target !== self)
        ) {
          self.removeAttribute('data-open');
          parent.removeChild(bar);
          q.el.removeEventListener('mousedown', down);
        }
      };
      q.el.addEventListener('mousedown', down, false);
    };
    el.appendChild(el_q);

    // delete
    const el_del = document.createElement('div');
    el_del.className = 'pk_del';
    el_del.innerHTML = '<a style="cursor:pointer">DELETE</a>';
    el_del.getElementsByTagName('a')[0].onclick = function (e) {
      q.Remove(range);
    };

    el.appendChild(el_del);

    // ----------------------
    el_list.appendChild(el);

    return el;
  }

  function _compare(a, b) {
    if (a.type === 'peaking' && b.type !== 'peaking') return -1;
    if (b.type === 'peaking' && a.type !== 'peaking') return 1;

    return 0;
  }
  // ---
}

export function openParagraphicEQ(app, custom_presets) {
  app.fireEvent('RequestSelect', 1);

  const filter_id = 'paragraphic_eq';

  // -------
  let PGEQ = new ParagraphicEqGraph();
  const DrawBars = function (_, freq) {
    PGEQ.RenderBars(_, freq);
  };
  const updateFilter = function () {
    if (!PGEQ) return;

    const val = [];
    const ranges = PGEQ.ranges;

    for (let i = 0; i < ranges.length; ++i) {
      const range = ranges[i];
      if (range._on) {
        val.push({
          type: range.type,
          freq: range.freq,
          val: range.gain,
          q: range.q,
        });
      }
    }
    return val;
  };

  const fxModal = AudioEffectModal(
    {
      id: filter_id,
      title: 'Paragraphic EQ',

      ondestroy: function (q) {
        app.stopListeningFor('DidAudioProcess', DrawBars);
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback(modal_esc_key);

        PGEQ = null;
      },

      preview: function (q) {
        app.fireEvent('RequestActionFX_PREVIEW_PARAMEQ', updateFilter());
      },

      body: '',

      presets: [{ name: 'Old Telephone', val: '1,highpass,0,5800,5.8,1,lowpass,0,7060,5' }],

      custom_pres: custom_presets.Get(filter_id),

      onpreset: function (val) {
        let l = PGEQ.ranges.length;
        while (l-- > 0) {
          PGEQ.Remove(PGEQ.ranges[l]);
        }

        const canvas = PGEQ.ui.canvas_eq;
        const cw = canvas.width;
        const ch = canvas.height;

        const list = val.split(',');
        const len = list.length;
        const els = (len / 5) >> 0;

        for (let j = 0; j < els; ++j) {
          const curr = [];
          const offset = j * 5;

          curr[0] = !!(list[offset + 0] / 1);
          curr[1] = list[offset + 1];
          curr[2] = list[offset + 2] / 1;
          curr[3] = list[offset + 3] / 1;
          curr[4] = list[offset + 4] / 1;

          let x = 0;
          let y = 0;

          if (curr[3] < 5000) {
            x = (curr[3] / 5000) * (cw / 2);
          } else {
            x = (cw / 2 + ((curr[3] - 5000) / 15000) * (cw / 2)).toFixed(1) / 1;
          }

          if (curr[1] === 'peaking')
            y = ((1.0 - (curr[2] / 1 + max_db_val) / (max_db_val * 2)) * ch).toFixed(1) / 1;
          else y = (ch / 2).toFixed(1) / 1;

          // (type, is_on, freq, gain, qval, coords_x, coords_y)
          PGEQ.Add(curr[1], !!curr[0], curr[3] / 1, curr[2] / 1, curr[4] / 1, x, y);
        }
      },

      buttons: [
        {
          title: 'Apply EQ',
          clss: 'pk_modal_a_accpt',
          callback: function (q) {
            app.fireEvent('RequestActionFX_PARAMEQ', updateFilter());
            q.Destroy();
          },
        },
      ],

      setup: function (q) {
        PGEQ.Init(q.el_body);

        PGEQ.Callback = function () {
          app.fireEvent('RequestActionFX_UPDATE_PREVIEW', updateFilter());
        };

        app.listenFor('DidAudioProcess', DrawBars);

        app.fireEvent('RequestPause');
        app.ui.InteractionHandler.checkAndSet(modal_name);
        app.ui.KeyHandler.addCallback(
          modal_esc_key,
          function (e) {
            if (!app.ui.InteractionHandler.check(modal_name)) return;
            q.Destroy();
          },
          [27]
        );
      },
    },
    app
  );

  fxModal.Show();
}
