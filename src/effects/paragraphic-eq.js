/**
 * Paragraphic EQ dialog.
 *
 * An interactive EQ curve editor rendered on canvas (ParagraphicEqGraph):
 * draggable band handles with per-band frequency / gain / Q / filter-type
 * controls, live preview wiring, and preset support.
 */

import { AudioEffectModal } from '../ui/modals.js';

const modalName = 'modalfx';
const modalEscapeKey = modalName + 'esc';
const maxDecibelValue = 35;

function ParagraphicEqGraph() {
  const graph = this;
  let _id = 0;

  let _is_render_scheduled = false;
  let _is_render_scheduled2 = false;

  graph.act = null;
  graph.ranges = [];
  graph.ui = {};

  this.Callback = function () {};

  this.Init = function (container) {
    const graph = this;

    graph.element = container;
    _make_ui(graph);
    _make_evs(graph);

    graph.Render();
  };

  this.Add = function (type, isOn, freq, gain, qval, coordinateX, coordinateY) {
    const graph = this;

    const newRange = {
      id: ++_id,
      type: type ? type : 'peaking',
      freq: freq || 0,
      gain: gain || 0,
      q: qval || 5,

      // interface
      _on: isOn,
      _hov: false,
      _el: null,
      _coords: {
        x: coordinateX || 0,
        y: coordinateY || 0,
      },
      _curve: [],
    };

    graph.ranges.push(newRange);
    graph.ranges.sort(_compare);

    if (graph.act) {
      graph.act.element.classList.remove('pk_active');
    }

    graph.act = newRange;

    _computeRangeCurve(newRange);
    newRange.element = _range_render_el(graph, newRange, ' pk_active');

    graph.Callback && graph.Callback();

    graph.Render();
  };

  this.Remove = function (range) {
    const graph = this;

    let l = graph.ranges.length;

    while (l-- > 0) {
      if (graph.ranges[l] === range) {
        graph.ranges.splice(l, 1);
        break;
      }
    }

    if (range.element) {
      range.element.parentNode.removeChild(range.element);
      range.element = null;
    }

    if (graph.act && graph.act === range) {
      graph.act = null;
    }

    graph.Render();
  };

  const _fillstyle = '#d9d955';

  const _anim_render = function () {
    _render(graph);
  };

  this.Render = function () {
    if (_is_render_scheduled) return;
    _is_render_scheduled = true;

    requestAnimationFrame(_anim_render);
  };

  this.RenderBars = function (_, freq) {
    const graph = this;

    if (_is_render_scheduled2) return;
    _is_render_scheduled2 = true;

    requestAnimationFrame(function () {
      _render_bars(graph, freq);
    });
  };

  const _render_bars = function (graph, freq) {
    _is_render_scheduled2 = false;

    if (!freq) return;

    const canvasContext = graph.ui.barsContext;
    const canvas = graph.ui.canvasBars;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // canvasContext.fillStyle = '#000';
    // canvasContext.fillRect (0, 0, canvasWidth, canvasHeight);
    canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);

    const maxBars = 117 * 2;
    const barWidth = (canvasWidth / maxBars).toFixed(1) / 1;
    let barHeight = 0;
    let x = 0;

    //
    for (let i = 0; i < 117; ++i) {
      barHeight = freq[i];

      // map.push ( i * 43 );

      const newheight = ((barHeight / 256) * canvasHeight) >> 0;

      canvasContext.fillRect(x, canvasHeight - newheight, barWidth, newheight);
      x += barWidth; // + 1;
    }

    for (let i = 0; i < 117; ++i) {
      // (116*3.4)
      barHeight = freq[117 + ((i * 3.34) >> 0)];

      // map.push ( (120 + (i * 3)) * 43 );
      const newheight = ((barHeight / 256) * canvasHeight) >> 0;

      canvasContext.fillRect(x, canvasHeight - newheight, barWidth, newheight);
      x += barWidth; // + 1;
    }

    //			console.log( map );

    // what if we care for the small bars first
    /*
			var steps = (totalFrequency/bufferLength) >> 0;

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
			var current = 0;
			var currentBars = 0;
			var barsPerEntry = (bufferLength / 10) >> 0;

			for (var i = 0; i < bufferLength; ++i) {

				if (++currentBars < barsPerEntry)
				{

					var ff = arr[ current ];
					var fastForwardNext = arr[ current + 1];

					var m = 0;
					for (; m < bufferLength; ++m)
					{
						if (m * steps > ff) {
							--m;
							break;
						}
					}

					barHeight = freq[ m ];

					var newheight = ((barHeight / 256) * canvasHeight) >> 0;
					canvasContext.fillRect (x, canvasHeight - newheight, barWidth, newheight);
					x += barWidth;// + 1;
				}
				else
				{
					++current;
					currentBars = 0;
				}
			}
*/

    //			for (var i = 0; i < bufferLength; ++i) {
    //				barHeight = freq[i];
    //				var newheight = ((barHeight / 256) * canvasHeight) >> 0;

    //				canvasContext.fillRect (x, canvasHeight - newheight, barWidth, newheight);
    //				x += barWidth;// + 1;
    //			}
  };

  const lineArray = new Array(1000);
  const _render = function (graph) {
    _is_render_scheduled = false;

    const canvasContext = graph.ui.equalizerContext;
    const canvas = graph.ui.canvasEqualizer;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    const halfCanvasHeight = canvasHeight / 2;

    // --------------------
    canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);

    canvasContext.fillStyle = _fillstyle;

    if (graph.ranges.length === 0) {
      canvasContext.beginPath();
      canvasContext.moveTo(0, halfCanvasHeight);
      canvasContext.lineTo(canvasWidth, halfCanvasHeight);
      canvasContext.stroke();

      return;
    }

    // render the line based on the elements
    let first = true;

    for (let o = 0; o < graph.ranges.length; ++o) {
      const current = graph.ranges[o];

      if (!current._on) continue;

      if (first) {
        first = false;
        for (let i = 0; i < total; ++i) {
          lineArray[i] = current._curve[i];
        }
      } else {
        for (let i = 0; i < total; ++i) {
          lineArray[i] += current._curve[i];
        }
      }
      // ---
    }

    if (first) {
      canvasContext.beginPath();
      canvasContext.moveTo(0, halfCanvasHeight);
      canvasContext.lineTo(canvasWidth, halfCanvasHeight);
      canvasContext.stroke();
    } else {
      // --
      canvasContext.beginPath();
      canvasContext.moveTo(
        0,
        halfCanvasHeight - lineArray[0] * (halfCanvasHeight / maxDecibelValue)
      );

      for (let i = 0; i < total / 4; i += 1) {
        const element = lineArray[i];

        const x = i * 2 * (canvasWidth / total);
        const y = halfCanvasHeight - element * (halfCanvasHeight / maxDecibelValue);

        canvasContext.lineTo(x, y);
      }

      let hh = 0;
      for (let i = total / 4; i < total; i += 3) {
        const element = lineArray[i];

        hh += 2;

        const x = (total / 2 + hh) * (canvasWidth / total);
        const y = halfCanvasHeight - element * (halfCanvasHeight / maxDecibelValue);

        canvasContext.lineTo(x, y);
      }

      canvasContext.stroke();
    }
    // ---

    // draw the dots
    const radius = 6;
    for (let o = 0; o < graph.ranges.length; ++o) {
      const current = graph.ranges[o];

      const centerX = current._coords.x;
      const centerY = current._coords.y;

      canvasContext.beginPath();
      canvasContext.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);

      if (current === graph.act) {
        canvasContext.shadowBlur = 24;

        if (current._on) canvasContext.fillStyle = '#fff';
        else canvasContext.fillStyle = '#686868';

        canvasContext.stroke();
        canvasContext.fill();

        canvasContext.shadowBlur = 0;
        canvasContext.fillStyle = _fillstyle;
      } else if (current._hov) {
        if (current._on) canvasContext.fillStyle = 'blue';
        else canvasContext.fillStyle = 'darkblue';

        canvasContext.stroke();
        canvasContext.fill();

        canvasContext.fillStyle = _fillstyle;
      } else if (current._on) {
        canvasContext.fill();
      } else {
        canvasContext.fillStyle = '#555';
        canvasContext.fill();
        canvasContext.fillStyle = _fillstyle;
      }
    }

    // ---
  };

  ////////////////////////////////////////////
  // helpers
  let _dbncr = null;
  const totalFrequency = 20000; // 22000
  const total = 1000;
  const jump = (totalFrequency / total) >> 0;

  function _range_update(graph, range, newRange, computeCoordinates) {
    let modified = false;

    for (const key in newRange) {
      if (range[key] !== newRange[key]) {
        modified = true;
        range[key] = newRange[key];

        if (key === '_on') {
          const element = document.getElementById('pgon' + range.id);
          element.checked = range[key];
        } else if (key === 'freq') {
          const element = range.element.getElementsByClassName('pk_frequency')[0];
          //requestAnimationFrame (function () {
          element.value = range[key];
          //});
        } else if (key === 'gain') {
          const element = range.element.getElementsByClassName('pk_gain')[0];
          //requestAnimationFrame (function () {
          element.value = range[key];
          //});
        } else if (key === 'q') {
          const element = range.element.getElementsByClassName('pk_q')[0];
          //requestAnimationFrame (function () {
          element.value = range[key];
          //});
        } else if (key === 'type') {
          // -----
          const element = range.element.getElementsByTagName('select')[0];
          if (range[key] === 'peaking') element.options[0].selected = true;
          else if (range[key] === 'lowpass') element.options[1].selected = true;
          else if (range[key] === 'highpass') element.options[2].selected = true;

          _computeRangeCurve(range);
          graph.ranges.sort(_compare);
        }
        // ---
      }
    }

    if (modified) {
      if (computeCoordinates) {
        // compute coords of the canvas
        const canvas = graph.ui.canvasEqualizer;
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        if (range.freq <= 5000) {
          range._coords.x = ((range.freq / 5000) * (canvasWidth / 2)).toFixed(1) / 1;
        } else {
          range._coords.x =
            (canvasWidth / 2 + ((range.freq - 5000) / 15000) * (canvasWidth / 2)).toFixed(1) / 1;
        }

        // range._coords.x = ((range.freq / totalFrequency) * canvasWidth).toFixed(1)/1;

        if (range.type === 'peaking')
          range._coords.y =
            ((1.0 - (range.gain + maxDecibelValue) / (maxDecibelValue * 2)) * canvasHeight).toFixed(
              1
            ) / 1;
        else range._coords.y = (canvasHeight / 2).toFixed(1) / 1;
      }

      if (_dbncr) {
        clearTimeout(_dbncr);
      }

      _dbncr = setTimeout(function () {
        graph.Callback();
        _dbncr = null;
      }, 38);

      graph.Render();
    }
    // ---
  }

  function _ease(t) {
    return t * t * t * t * t;
  }
  function _ease_out(t) {
    return t * t * t * t;
  }

  function _computeRangeCurve(range) {
    const curve = [];

    for (let i = 0; i < total; ++i) {
      curve[i] = 0;
    }

    range._curve = curve;

    // -------------
    const rounding = totalFrequency * (2 / range.q);
    const halfRounding = (rounding / jump) >> 0;

    if (range.type === 'peaking') {
      const edgeLeft = range.freq - rounding / 2;
      const edgeRight = range.freq + rounding / 2;

      const start = (edgeLeft / jump) >> 0;
      const end = (edgeRight / jump) >> 0;

      let j = 0;
      for (let i = start; i < end; ++i) {
        const ii = i * jump;
        if (ii < range.freq) {
          ++j;
          curve[i] += _ease(j / (halfRounding / 2)) * range.gain;
        } else {
          --j;
          curve[i] += _ease(j / (halfRounding / 2)) * range.gain;
        }
      }

      return;
    }

    if (range.type === 'highpass') {
      const edgeLeft = range.freq - rounding;
      const start = (edgeLeft / jump) >> 0;
      const end = (range.freq / jump) >> 0;

      for (let i = 0; i < start; ++i) {
        curve[i] = -maxDecibelValue;
      }

      // todo improve this!!!
      let j = halfRounding;
      for (let i = start; i < end; ++i) {
        --j;
        curve[i] -= _ease_out(j / halfRounding) * maxDecibelValue;
      }

      return;
    }

    if (range.type === 'lowpass') {
      const edgeRight = range.freq + rounding;
      const start = (range.freq / jump) >> 0;
      const end = (edgeRight / jump) >> 0;

      for (let i = end; i < total; ++i) {
        curve[i] = -maxDecibelValue;
      }

      // todo improve this!!!
      let j = 0;
      for (let i = start; i < end; ++i) {
        ++j;
        curve[i] -= _ease_out(j / halfRounding) * maxDecibelValue;
      }

      return;
    }

    // -------------
  }

  function _make_ui(graph) {
    const drawerElement = document.createElement('div');
    drawerElement.className = 'pk_row';

    const canvasBars = document.createElement('canvas');
    const canvasEqualizer = document.createElement('canvas');

    canvasBars.className = 'pk_pgeq_bars';
    canvasEqualizer.className = 'pk_pgeq_curve';

    canvasBars.width = 450 / 2;
    canvasBars.height = 224 / 2;

    canvasEqualizer.width = 450;
    canvasEqualizer.height = 225;

    const barsContext = canvasBars.getContext('2d', { alpha: true, antialias: false });
    const equalizerContext = canvasEqualizer.getContext('2d', { alpha: true, antialias: false });

    barsContext.fillStyle = '#365457'; // '#486a6e';

    // equalizerContext.lineWidth = 2;
    equalizerContext.strokeStyle = '#FF0000';
    equalizerContext.shadowColor = '#FF2222';
    equalizerContext.shadowBlur = 0;

    // render the decibel and the frequencies
    const markerFrequencies = document.createElement('div');
    markerFrequencies.className = 'pk_pgeq_frequency_markers pk_noselect';
    markerFrequencies.innerHTML =
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

    const markerDecibels = document.createElement('div');
    markerDecibels.className = 'pk_pgeq_decibel_markers pk_noselect';
    markerDecibels.innerHTML =
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

    drawerElement.appendChild(canvasBars);
    drawerElement.appendChild(canvasEqualizer);
    drawerElement.appendChild(markerFrequencies);
    drawerElement.appendChild(markerDecibels);

    graph.element.appendChild(drawerElement);

    // element's area
    const listElement = document.createElement('div');
    listElement.className = 'pk_row pk_noselect pk_pgeq_list';

    listElement.innerHTML =
      '<div class="pk_pgeq_element">' +
      '<span class="pk_text_left"> #</span><span>type</span><span>gain</span><span>freq</span><span>Q</span>' +
      '</div>';

    graph.element.appendChild(listElement);

    graph.ui.barsContext = barsContext;
    graph.ui.equalizerContext = equalizerContext;

    graph.ui.canvasBars = canvasBars;
    graph.ui.canvasEqualizer = canvasEqualizer;
    graph.ui.listElement = listElement;
  }

  function _make_evs(graph) {
    const canvas = graph.ui.canvasEqualizer;

    let clickTime = 0;
    let isDragging = false;

    const _move = function (e) {
      if (!isDragging || !graph.act) return;

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
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      const posx = ex - bounds.left;
      const posy = ey - bounds.top;

      const relativeX = posx / canvasWidth;
      const relativeY = posy / canvasHeight;

      graph.act._coords.x = posx;
      graph.act._coords.y = posy;

      // up until half it's 0 - 5000, second half 5000 -> 2200
      let freq = 0;

      if (relativeX <= 0.5) {
        freq = (5000 * (relativeX * 2)) >> 0;
      } else {
        freq = 5000 + (((relativeX - 0.5) * 2 * 15000) >> 0);
      }

      //				var freq = (relativeX * (totalFrequency) + 0) >> 0; // + 16 (min freq)
      const gain = ((relativeY - 0.5) * -2 * maxDecibelValue).toFixed(2) / 1;

      _range_update(graph, graph.act, {
        freq: freq,
        gain: gain,
      });
      _computeRangeCurve(graph.act);
    };

    const _end = function (e) {
      isDragging = false;

      canvas.removeEventListener('mousemove', _move);
      canvas.removeEventListener('mouseup', _end);

      canvas.removeEventListener('touchmove', _move);
      canvas.removeEventListener('touchup', _end);
    };

    const mdown = function (e) {
      const unchecked = !!graph.act;

      if (graph.ranges.length === 0) {
        if (unchecked) graph.Render();
        return;
      }

      const bounds = canvas.getBoundingClientRect();

      const posx = e.clientX - bounds.left;
      const posy = e.clientY - bounds.top;

      const distanceX = e.isTouch ? 20 : 10;
      const distanceY = e.isTouch ? 20 : 9;

      for (let o = 0; o < graph.ranges.length; ++o) {
        const current = graph.ranges[o];

        if (
          Math.abs(current._coords.x - posx) < distanceX &&
          Math.abs(current._coords.y - posy) < distanceY
        ) {
          if (unchecked) {
            graph.act.element.classList.remove('pk_active');
          }

          graph.act = current;
          graph.act.element.classList.add('pk_active');

          isDragging = true;

          graph.Render();

          // check if we are targetting a circle

          if (!e.isTouch) {
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
        graph.act.element.classList.remove('pk_active');
        // un-highlight
        graph.act = null;

        graph.Render();
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
        isTouch: true,
        ev: e,
      };

      mdown(ev);
    });

    canvas.addEventListener(
      'click',
      function (e) {
        if (e.timeStamp - clickTime < 260) {
          const bounds = canvas.getBoundingClientRect();
          const canvasWidth = canvas.width;
          const canvasHeight = canvas.height;
          const posx = e.clientX - bounds.left;
          const posy = e.clientY - bounds.top;

          const relativeX = posx / canvasWidth;
          const relativeY = posy / canvasHeight;

          let freq = 0;
          if (relativeX <= 0.5) {
            freq = (5000 * (relativeX * 2)) >> 0;
          } else {
            freq = 5000 + (((relativeX - 0.5) * 2 * 15000) >> 0);
          }

          // var freq = (relativeX * (totalFrequency) + 0) >> 0; // + 16 (min freq)
          const gain = ((relativeY - 0.5) * -2 * maxDecibelValue).toFixed(2) / 1;
          const qval = 5;
          const type = 'peaking';

          graph.Add(type, true, freq, gain, qval, posx, posy);
        }

        clickTime = e.timeStamp;
      },
      false
    );

    // ---
  }

  function _range_render_el(graph, range, className) {
    const listElement = graph.ui.listElement;

    const element = document.createElement('div');
    element.className = 'pk_pgeq_element' + (className ? className : '');
    element.setAttribute('data-id', range.id);

    element.addEventListener(
      'click',
      function (e) {
        if (!range.element) return;

        if (range !== graph.act) {
          if (graph.act) {
            graph.act.element.classList.remove('pk_active');
          }

          graph.act = range;
          graph.act.element.classList.add('pk_active');

          graph.Render();
        }
      },
      false
    );

    element.addEventListener(
      'mouseover',
      function (e) {
        if (!range.element) return;

        if (!range._hov) {
          range._hov = true;
          graph.Render();
        }
      },
      false
    );

    element.addEventListener(
      'mouseleave',
      function (e) {
        if (!range.element) return;

        if (range._hov) {
          range._hov = false;
          graph.Render();
        }
      },
      false
    );

    // # & on or off
    const chckd = range._on ? 'checked' : '';
    const number = '<i>' + range.id + '</i>';
    const numberElement = document.createElement('div');
    numberElement.className = 'pk_text_left';
    numberElement.innerHTML =
      number +
      '<input type="checkbox" id="pgon' +
      range.id +
      '" class="pk_check" name="onoff" ' +
      chckd +
      '>' +
      '<label for="pgon' +
      range.id +
      '">ON</label>';

    numberElement.getElementsByTagName('input')[0].onchange = function (e) {
      _range_update(graph, range, { _on: !!this.checked });

      const lbl = this.parentNode.getElementsByTagName('label')[0];
      lbl.innerHTML = this.checked ? 'ON' : 'OFF';
    };
    element.appendChild(numberElement);

    // type
    const sel1 = range.type === 'lowpass' ? 'selected' : '';
    const sel2 = range.type === 'highpass' ? 'selected' : '';
    const typeElement = document.createElement('div');
    typeElement.innerHTML =
      '<select><option>peaking</option><option ' +
      sel1 +
      '>lowpass</option><option ' +
      sel2 +
      '>highpass</option></select>';

    typeElement.getElementsByTagName('select')[0].onchange = function (e) {
      const value = this.options[this.selectedIndex].value;

      if (value === 'peaking') {
        element.classList.remove('pk_disabled');
      } else {
        element.classList.add('pk_disabled');
      }

      _range_update(graph, range, { type: value }, 1);
    };

    element.appendChild(typeElement);

    // gain
    const gainElement = document.createElement('div');
    gainElement.innerHTML =
      '<input type="number" class="pk_value pk_gain" min="-35" max="35" value="' +
      range.gain +
      '">';

    gainElement.getElementsByClassName('pk_gain')[0].onchange = function (e) {
      if (!this.value) {
        this.value = 0;
      }

      if (this.hasAttribute('data-open')) {
        this.parentNode.getElementsByClassName('pk_horizontal')[0].value = this.value;
      }

      _range_update(graph, range, { gain: this.value / 1 }, 1);
      _computeRangeCurve(range);
    };
    gainElement.getElementsByClassName('pk_gain')[0].onfocus = function (e) {
      if (this.hasAttribute('data-open')) return;

      const self = this;
      const parent = this.parentNode;
      const bar = document.createElement('div');
      bar.className = 'pk_pgeq_freq pk_gain';
      bar.innerHTML =
        '<div class="pk_arrow"></div><input type="range" min="-35" max="35" class="pk_horizontal pk_gain" step="0.1" value="' +
        range.gain +
        '">';

      bar.getElementsByClassName('pk_horizontal')[0].oninput = function (e) {
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
          graph.element.removeEventListener('mousedown', down);
          return;
        }
      };
      graph.element.addEventListener('mousedown', down, false);
    };
    element.appendChild(gainElement);

    // freq
    const frequencyElement = document.createElement('div');
    frequencyElement.innerHTML =
      '<input type="number" class="pk_value pk_frequency" min="16" max="20000" value="' +
      range.freq +
      '">';
    frequencyElement.getElementsByClassName('pk_frequency')[0].onchange = function (e) {
      if (!this.value) {
        this.value = 500;
      }

      if (this.hasAttribute('data-open')) {
        this.parentNode.getElementsByClassName('pk_horizontal')[0].value = this.value;
      }

      _range_update(graph, range, { freq: this.value / 1 }, 1);
      _computeRangeCurve(range);
    };

    frequencyElement.getElementsByClassName('pk_frequency')[0].onfocus = function (e) {
      if (this.hasAttribute('data-open')) return;

      const self = this;
      const parent = this.parentNode;
      const bar = document.createElement('div');
      bar.className = 'pk_pgeq_freq pk_frequency';
      bar.innerHTML =
        '<div class="pk_arrow"></div><input type="range" min="16" max="20000" class="pk_horizontal pk_frequency" step="1" value="' +
        range.freq +
        '">';

      bar.getElementsByClassName('pk_horizontal')[0].oninput = function (e) {
        if (self.value != this.value) {
          self.value = this.value;
          self.onchange();
        }
      };

      parent.appendChild(bar);
      this.setAttribute('data-open', '1');

      const down = function (e) {
        if (
          !e.target.classList.contains('pk_frequency') ||
          (e.target.type === self.type && e.target !== self)
        ) {
          self.removeAttribute('data-open');
          parent.removeChild(bar);
          graph.element.removeEventListener('mousedown', down);
        }
      };
      graph.element.addEventListener('mousedown', down, false);
    };

    element.appendChild(frequencyElement);

    // graph
    const qElement = document.createElement('div');
    qElement.innerHTML =
      '<input type="number" class="pk_value pk_q" min="1" max="50" value="' + range.q + '">';
    qElement.getElementsByClassName('pk_q')[0].onchange = function (e) {
      if (!this.value) {
        this.value = 1;
      }

      if (this.hasAttribute('data-open')) {
        this.parentNode.getElementsByClassName('pk_horizontal')[0].value = this.value;
      }

      _range_update(graph, range, { q: this.value / 1 }, 1);
      _computeRangeCurve(range);
    };

    qElement.getElementsByClassName('pk_q')[0].onfocus = function (e) {
      if (this.hasAttribute('data-open')) return;

      const self = this;
      const parent = this.parentNode;
      const bar = document.createElement('div');
      bar.className = 'pk_pgeq_freq pk_q';
      bar.innerHTML =
        '<div class="pk_arrow"></div><input type="range" min="1" max="50" class="pk_horizontal pk_q" step="0.1" value="' +
        range.q +
        '">';

      bar.getElementsByClassName('pk_horizontal')[0].oninput = function (e) {
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
          graph.element.removeEventListener('mousedown', down);
        }
      };
      graph.element.addEventListener('mousedown', down, false);
    };
    element.appendChild(qElement);

    // delete
    const deleteElement = document.createElement('div');
    deleteElement.className = 'pk_delete';
    deleteElement.innerHTML = '<a style="cursor:pointer">DELETE</a>';
    deleteElement.getElementsByTagName('a')[0].onclick = function (e) {
      graph.Remove(range);
    };

    element.appendChild(deleteElement);

    // ----------------------
    listElement.appendChild(element);

    return element;
  }

  function _compare(a, b) {
    if (a.type === 'peaking' && b.type !== 'peaking') return -1;
    if (b.type === 'peaking' && a.type !== 'peaking') return 1;

    return 0;
  }
  // ---
}

export function openParagraphicEQ(app, customPresets) {
  app.fireEvent('RequestSelect', 1);

  const filterId = 'paragraphic_eq';

  // -------
  let PGEQ = new ParagraphicEqGraph();
  const DrawBars = function (_, freq) {
    PGEQ.RenderBars(_, freq);
  };
  const updateFilter = function () {
    if (!PGEQ) return;

    const value = [];
    const ranges = PGEQ.ranges;

    for (let i = 0; i < ranges.length; ++i) {
      const range = ranges[i];
      if (range._on) {
        value.push({
          type: range.type,
          freq: range.freq,
          val: range.gain,
          q: range.q,
        });
      }
    }
    return value;
  };

  const fxModal = AudioEffectModal(
    {
      id: filterId,
      title: 'Paragraphic EQ',

      ondestroy: function (modal) {
        app.stopListeningFor('DidAudioProcess', DrawBars);
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback(modalEscapeKey);

        PGEQ = null;
      },

      preview: function (modal) {
        app.fireEvent('RequestActionFX_PREVIEW_PARAMEQ', updateFilter());
      },

      body: '',

      presets: [{ name: 'Old Telephone', val: '1,highpass,0,5800,5.8,1,lowpass,0,7060,5' }],

      customPresetList: customPresets.Get(filterId),

      onpreset: function (value) {
        let l = PGEQ.ranges.length;
        while (l-- > 0) {
          PGEQ.Remove(PGEQ.ranges[l]);
        }

        const canvas = PGEQ.ui.canvasEqualizer;
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;

        const list = value.split(',');
        const length = list.length;
        const elements = (length / 5) >> 0;

        for (let j = 0; j < elements; ++j) {
          const current = [];
          const offset = j * 5;

          current[0] = !!(list[offset + 0] / 1);
          current[1] = list[offset + 1];
          current[2] = list[offset + 2] / 1;
          current[3] = list[offset + 3] / 1;
          current[4] = list[offset + 4] / 1;

          let x = 0;
          let y = 0;

          if (current[3] < 5000) {
            x = (current[3] / 5000) * (canvasWidth / 2);
          } else {
            x =
              (canvasWidth / 2 + ((current[3] - 5000) / 15000) * (canvasWidth / 2)).toFixed(1) / 1;
          }

          if (current[1] === 'peaking')
            y =
              (
                (1.0 - (current[2] / 1 + maxDecibelValue) / (maxDecibelValue * 2)) *
                canvasHeight
              ).toFixed(1) / 1;
          else y = (canvasHeight / 2).toFixed(1) / 1;

          // (type, isOn, freq, gain, qval, coordinateX, coordinateY)
          PGEQ.Add(current[1], !!current[0], current[3] / 1, current[2] / 1, current[4] / 1, x, y);
        }
      },

      buttons: [
        {
          title: 'Apply EQ',
          className: 'pk_modal_action_accept',
          callback: function (modal) {
            app.fireEvent('RequestActionFX_PARAMEQ', updateFilter());
            modal.Destroy();
          },
        },
      ],

      setup: function (modal) {
        PGEQ.Init(modal.bodyElement);

        PGEQ.Callback = function () {
          app.fireEvent('RequestActionFX_UPDATE_PREVIEW', updateFilter());
        };

        app.listenFor('DidAudioProcess', DrawBars);

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
