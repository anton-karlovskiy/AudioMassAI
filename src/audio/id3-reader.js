/**
 * Audio metadata tag readers.
 *
 * - `ID3v2`: parses ID3v1/ID3v2 tags from MP3 files (frames, comments,
 *   attached pictures, lyrics, ...).
 * - `ID4`:   parses iTunes-style metadata atoms from MP4/M4A containers.
 *
 * Parsing internals adapted from the original AudioMass implementation.
 */

const StringUtils = {
  readUTF16String: function (bytes, bigEndian, maxBytes) {
    let ix = 0;
    let offset1 = 1,
      offset2 = 0;
    maxBytes = Math.min(maxBytes || bytes.length, bytes.length);

    if (bytes[0] == 0xfe && bytes[1] == 0xff) {
      bigEndian = true;
      ix = 2;
    } else if (bytes[0] == 0xff && bytes[1] == 0xfe) {
      bigEndian = false;
      ix = 2;
    }
    if (bigEndian) {
      offset1 = 0;
      offset2 = 1;
    }

    const characters = [];
    for (let j = 0; ix < maxBytes; j++) {
      const byte1 = bytes[ix + offset1];
      const byte2 = bytes[ix + offset2];
      const word1 = (byte1 << 8) + byte2;
      ix += 2;
      if (word1 == 0x0000) {
        break;
      } else if (byte1 < 0xd8 || byte1 >= 0xe0) {
        characters[j] = String.fromCharCode(word1);
      } else {
        const byte3 = bytes[ix + offset1];
        const byte4 = bytes[ix + offset2];
        const word2 = (byte3 << 8) + byte4;
        ix += 2;
        characters[j] = String.fromCharCode(word1, word2);
      }
    }
    const string = new String(characters.join(''));
    string.bytesReadCount = ix;
    return string;
  },
  readUTF8String: function (bytes, maxBytes) {
    let ix = 0;
    maxBytes = Math.min(maxBytes || bytes.length, bytes.length);

    if (bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf) {
      ix = 3;
    }

    const characters = [];
    for (let j = 0; ix < maxBytes; j++) {
      const byte1 = bytes[ix++];
      if (byte1 == 0x00) {
        break;
      } else if (byte1 < 0x80) {
        characters[j] = String.fromCharCode(byte1);
      } else if (byte1 >= 0xc2 && byte1 < 0xe0) {
        const byte2 = bytes[ix++];
        characters[j] = String.fromCharCode(((byte1 & 0x1f) << 6) + (byte2 & 0x3f));
      } else if (byte1 >= 0xe0 && byte1 < 0xf0) {
        const byte2 = bytes[ix++];
        const byte3 = bytes[ix++];
        characters[j] = String.fromCharCode(
          ((byte1 & 0xff) << 12) + ((byte2 & 0x3f) << 6) + (byte3 & 0x3f)
        );
      } else if (byte1 >= 0xf0 && byte1 < 0xf5) {
        const byte2 = bytes[ix++];
        const byte3 = bytes[ix++];
        const byte4 = bytes[ix++];
        const codepoint =
          ((byte1 & 0x07) << 18) +
          ((byte2 & 0x3f) << 12) +
          ((byte3 & 0x3f) << 6) +
          (byte4 & 0x3f) -
          0x10000;
        characters[j] = String.fromCharCode(
          (codepoint >> 10) + 0xd800,
          (codepoint & 0x3ff) + 0xdc00
        );
      }
    }
    const string = new String(characters.join(''));
    string.bytesReadCount = ix;
    return string;
  },
  readNullTerminatedString: function (bytes, maxBytes) {
    const characters = [];
    maxBytes = maxBytes || bytes.length;
    let i = 0;
    for (; i < maxBytes;) {
      const byte1 = bytes[i++];
      if (byte1 == 0x00) break;
      characters[i - 1] = String.fromCharCode(byte1);
    }
    const string = new String(characters.join(''));
    string.bytesReadCount = i;
    return string;
  },
};

const getBytesAt = function (data, iOffset, iLength) {
  const bytes = new Array(iLength);
  for (let i = 0; i < iLength; i++) {
    bytes[i] = data.getUint8(iOffset + i);
  }
  return bytes;
};
const getStringWithCharsetAt = function (data, iOffset, iLength, iCharset) {
  const bytes = getBytesAt(data, iOffset, iLength);
  let sString;

  switch (iCharset.toLowerCase()) {
    case 'utf-16':
    case 'utf-16le':
    case 'utf-16be':
      sString = StringUtils.readUTF16String(bytes, iCharset);
      break;

    case 'utf-8':
      sString = StringUtils.readUTF8String(bytes);
      break;

    default:
      sString = StringUtils.readNullTerminatedString(bytes);
      break;
  }

  return sString;
};

const ID3v2 = {
  readFrameData: {},
};

ID3v2.frames = {
  // v2.2
  BUF: 'Recommended buffer size',
  CNT: 'Play counter',
  COM: 'Comments',
  CRA: 'Audio encryption',
  CRM: 'Encrypted meta frame',
  ETC: 'Event timing codes',
  EQU: 'Equalization',
  GEO: 'General encapsulated object',
  IPL: 'Involved people list',
  LNK: 'Linked information',
  MCI: 'Music CD Identifier',
  MLL: 'MPEG location lookup table',
  PIC: 'Attached picture',
  POP: 'Popularimeter',
  REV: 'Reverb',
  RVA: 'Relative volume adjustment',
  SLT: 'Synchronized lyric/text',
  STC: 'Synced tempo codes',
  TAL: 'Album/Movie/Show title',
  TBP: 'BPM (Beats Per Minute)',
  TCM: 'Composer',
  TCO: 'Content type',
  TCR: 'Copyright message',
  TDA: 'Date',
  TDY: 'Playlist delay',
  TEN: 'Encoded by',
  TFT: 'File type',
  TIM: 'Time',
  TKE: 'Initial key',
  TLA: 'Language(s)',
  TLE: 'Length',
  TMT: 'Media type',
  TOA: 'Original artist(s)/performer(s)',
  TOF: 'Original filename',
  TOL: 'Original Lyricist(s)/text writer(s)',
  TOR: 'Original release year',
  TOT: 'Original album/Movie/Show title',
  TP1: 'Lead artist(s)/Lead performer(s)/Soloist(s)/Performing group',
  TP2: 'Band/Orchestra/Accompaniment',
  TP3: 'Conductor/Performer refinement',
  TP4: 'Interpreted, remixed, or otherwise modified by',
  TPA: 'Part of a set',
  TPB: 'Publisher',
  TRC: 'ISRC (International Standard Recording Code)',
  TRD: 'Recording dates',
  TRK: 'Track number/Position in set',
  TSI: 'Size',
  TSS: 'Software/hardware and settings used for encoding',
  TT1: 'Content group description',
  TT2: 'Title/Songname/Content description',
  TT3: 'Subtitle/Description refinement',
  TXT: 'Lyricist/text writer',
  TXX: 'User defined text information frame',
  TYE: 'Year',
  UFI: 'Unique file identifier',
  ULT: 'Unsychronized lyric/text transcription',
  WAF: 'Official audio file webpage',
  WAR: 'Official artist/performer webpage',
  WAS: 'Official audio source webpage',
  WCM: 'Commercial information',
  WCP: 'Copyright/Legal information',
  WPB: 'Publishers official webpage',
  WXX: 'User defined URL link frame',
  // v2.3
  AENC: 'Audio encryption',
  APIC: 'Attached picture',
  COMM: 'Comments',
  COMR: 'Commercial frame',
  ENCR: 'Encryption method registration',
  EQUA: 'Equalization',
  ETCO: 'Event timing codes',
  GEOB: 'General encapsulated object',
  GRID: 'Group identification registration',
  IPLS: 'Involved people list',
  LINK: 'Linked information',
  MCDI: 'Music CD identifier',
  MLLT: 'MPEG location lookup table',
  OWNE: 'Ownership frame',
  PRIV: 'Private frame',
  PCNT: 'Play counter',
  POPM: 'Popularimeter',
  POSS: 'Position synchronisation frame',
  RBUF: 'Recommended buffer size',
  RVAD: 'Relative volume adjustment',
  RVRB: 'Reverb',
  SYLT: 'Synchronized lyric/text',
  SYTC: 'Synchronized tempo codes',
  TALB: 'Album/Movie/Show title',
  TBPM: 'BPM (beats per minute)',
  TCOM: 'Composer',
  TCON: 'Content type',
  TCOP: 'Copyright message',
  TDAT: 'Date',
  TDLY: 'Playlist delay',
  TENC: 'Encoded by',
  TEXT: 'Lyricist/Text writer',
  TFLT: 'File type',
  TIME: 'Time',
  TIT1: 'Content group description',
  TIT2: 'Title/songname/content description',
  TIT3: 'Subtitle/Description refinement',
  TKEY: 'Initial key',
  TLAN: 'Language(s)',
  TLEN: 'Length',
  TMED: 'Media type',
  TOAL: 'Original album/movie/show title',
  TOFN: 'Original filename',
  TOLY: 'Original lyricist(s)/text writer(s)',
  TOPE: 'Original artist(s)/performer(s)',
  TORY: 'Original release year',
  TOWN: 'File owner/licensee',
  TPE1: 'Lead performer(s)/Soloist(s)',
  TPE2: 'Band/orchestra/accompaniment',
  TPE3: 'Conductor/performer refinement',
  TPE4: 'Interpreted, remixed, or otherwise modified by',
  TPOS: 'Part of a set',
  TPUB: 'Publisher',
  TRCK: 'Track number/Position in set',
  TRDA: 'Recording dates',
  TRSN: 'Internet radio station name',
  TRSO: 'Internet radio station owner',
  TSIZ: 'Size',
  TSRC: 'ISRC (international standard recording code)',
  TSSE: 'Software/Hardware and settings used for encoding',
  TYER: 'Year',
  TXXX: 'User defined text information frame',
  UFID: 'Unique file identifier',
  USER: 'Terms of use',
  USLT: 'Unsychronized lyric/text transcription',
  WCOM: 'Commercial information',
  WCOP: 'Copyright/Legal information',
  WOAF: 'Official audio file webpage',
  WOAR: 'Official artist/performer webpage',
  WOAS: 'Official audio source webpage',
  WORS: 'Official internet radio station homepage',
  WPAY: 'Payment',
  WPUB: 'Publishers official webpage',
  WXXX: 'User defined URL link frame',
};

const pictureType = [
  "32x32 pixels 'file icon' (PNG only)",
  'Other file icon',
  'Cover (front)',
  'Cover (back)',
  'Leaflet page',
  'Media (e.g. lable side of CD)',
  'Lead artist/lead performer/soloist',
  'Artist/performer',
  'Conductor',
  'Band/Orchestra',
  'Composer',
  'Lyricist/text writer',
  'Recording Location',
  'During recording',
  'During performance',
  'Movie/video screen capture',
  'A bright coloured fish',
  'Illustration',
  'Band/artist logotype',
  'Publisher/Studio logotype',
];

const getStringAt = function (data, iOffset, iLength) {
  const aStr = [];
  for (let i = iOffset, j = 0; i < iOffset + iLength; i++, j++) {
    aStr[j] = String.fromCharCode(data.getUint8(i));
  }
  return aStr.join('');
};
const getLongAt = function (data, iOffset, bBigEndian) {
  const iByte1 = data.getUint8(iOffset),
    iByte2 = data.getUint8(iOffset + 1),
    iByte3 = data.getUint8(iOffset + 2),
    iByte4 = data.getUint8(iOffset + 3);

  let iLong = bBigEndian
    ? (((((iByte1 << 8) + iByte2) << 8) + iByte3) << 8) + iByte4
    : (((((iByte4 << 8) + iByte3) << 8) + iByte2) << 8) + iByte1;
  if (iLong < 0) iLong += 4294967296;
  return iLong;
};
const getSLongAt = function (data, iOffset, bBigEndian) {
  const iULong = getLongAt(data, iOffset, bBigEndian);
  if (iULong > 2147483647) return iULong - 4294967296;
  else return iULong;
};
const getShortAt = function (data, iOffset, bBigEndian) {
  let iShort = bBigEndian
    ? (data.getUint8(iOffset) << 8) + data.getUint8(iOffset + 1)
    : (data.getUint8(iOffset + 1) << 8) + data.getUint8(iOffset);
  if (iShort < 0) iShort += 65536;
  return iShort;
};
const getInteger24At = function (data, iOffset, bBigEndian) {
  const iByte1 = data.getUint8(iOffset),
    iByte2 = data.getUint8(iOffset + 1),
    iByte3 = data.getUint8(iOffset + 2);

  let iInteger = bBigEndian
    ? (((iByte1 << 8) + iByte2) << 8) + iByte3
    : (((iByte3 << 8) + iByte2) << 8) + iByte1;
  if (iInteger < 0) iInteger += 16777216;
  return iInteger;
};
const isBitSetAt = function (dataview, offset, bit) {
  const ibyte = dataview.getUint8(offset);
  return (ibyte & (1 << bit)) != 0;
};
const readSynchsafeInteger32At = function (offset, data) {
  const size1 = data.getUint8(offset);
  const size2 = data.getUint8(offset + 1);
  const size3 = data.getUint8(offset + 2);
  const size4 = data.getUint8(offset + 3);
  // 0x7f = 0b01111111
  const size =
    (size4 & 0x7f) | ((size3 & 0x7f) << 7) | ((size2 & 0x7f) << 14) | ((size1 & 0x7f) << 21);

  return size;
};
const readFrameFlags = function (data, offset) {
  const flags = {
    message: {
      tagAlterPreservation: isBitSetAt(data, offset, 6),
      fileAlterPreservation: isBitSetAt(data, offset, 5),
      readOnly: isBitSetAt(data, offset, 4),
    },
    format: {
      groupingIdentity: isBitSetAt(data, offset + 1, 7),
      compression: isBitSetAt(data, offset + 1, 3),
      encription: isBitSetAt(data, offset + 1, 2),
      unsynchronisation: isBitSetAt(data, offset + 1, 1),
      dataLengthIndicator: isBitSetAt(data, offset + 1, 0),
    },
  };

  return flags;
};
const _shortcuts = {
  title: ['TIT2', 'TT2'],
  artist: ['TPE1', 'TP1'],
  album: ['TALB', 'TAL'],
  year: ['TYER', 'TYE'],
  comment: ['COMM', 'COM'],
  track: ['TRCK', 'TRK'],
  genre: ['TCON', 'TCO'],
  picture: ['APIC', 'PIC'],
  lyrics: ['USLT', 'ULT'],
};
const _defaultShortcuts = ['title', 'artist', 'album', 'track'];

const getTagsFromShortcuts = function (shortcuts) {
  let tags = [];
  for (let i = 0, shortcut; (shortcut = shortcuts[i]); i++) {
    tags = tags.concat(_shortcuts[shortcut] || [shortcut]);
  }
  return tags;
};
const getFrameData = function (frames, ids) {
  if (typeof ids == 'string') {
    ids = [ids];
  }

  for (let i = 0, id; (id = ids[i]); i++) {
    if (id in frames) {
      return frames[id].data;
    }
  }
};
const readFrames = function (offset, end, data, id3header, tags) {
  const frames = {};
  let frameDataSize;
  const major = id3header['major'];

  tags = getTagsFromShortcuts(tags || _defaultShortcuts);

  while (offset < end) {
    let readFrameFunc = null;
    const frameData = data;
    let frameDataOffset = offset;
    let flags = null;

    let frameID = '';
    let frameSize = 0;
    let frameHeaderSize = 0;
    switch (major) {
      case 2:
        frameID = getStringAt(frameData, frameDataOffset, 3);
        frameSize = getInteger24At(frameData, frameDataOffset + 3, true);
        frameHeaderSize = 6;
        break;

      case 3:
        frameID = getStringAt(frameData, frameDataOffset, 4);
        frameSize = getLongAt(frameData, frameDataOffset + 4, true);
        frameHeaderSize = 10;
        break;

      case 4:
        frameID = getStringAt(frameData, frameDataOffset, 4);
        frameSize = readSynchsafeInteger32At(frameDataOffset + 4, frameData);
        frameHeaderSize = 10;
        break;
    }
    // if last frame GTFO
    if (frameID == '') {
      break;
    }

    // advance data offset to the next frame data
    offset += frameHeaderSize + frameSize;
    // skip unwanted tags
    if (tags.indexOf(frameID) < 0) {
      continue;
    }

    // read frame message and format flags
    if (major > 2) {
      flags = readFrameFlags(frameData, frameDataOffset + 8);
    }

    frameDataOffset += frameHeaderSize;

    // the first 4 bytes are the real data size
    // (after unsynchronisation && encryption)
    if (flags && flags.format.dataLengthIndicator) {
      frameDataSize = readSynchsafeInteger32At(frameDataOffset, frameData);
      frameDataOffset += 4;
      frameSize -= 4;
    }

    // TODO: support unsynchronisation
    if (flags && flags.format.unsynchronisation) {
      //frameData = removeUnsynchronisation(frameData, frameSize);
      continue;
    }

    // find frame parsing function

    if (frameID in ID3v2.readFrameData) {
      readFrameFunc = ID3v2.readFrameData[frameID];
    } else if (frameID[0] == 'T') {
      readFrameFunc = ID3v2.readFrameData['T*'];
    }

    const parsedData = readFrameFunc
      ? readFrameFunc(frameDataOffset, frameSize, frameData, flags)
      : undefined;
    const desc = frameID in ID3v2.frames ? ID3v2.frames[frameID] : 'Unknown';

    const frame = {
      id: frameID,
      size: frameSize,
      description: desc,
      data: parsedData,
    };

    if (frameID in frames) {
      if (frames[frameID].id) {
        frames[frameID] = [frames[frameID]];
      }
      frames[frameID].push(frame);
    } else {
      frames[frameID] = frame;
    }
  }

  return frames;
};

function getTextEncoding(bite) {
  let charset;
  switch (bite) {
    case 0x00:
      charset = 'iso-8859-1';
      break;

    case 0x01:
      charset = 'utf-16';
      break;

    case 0x02:
      charset = 'utf-16be';
      break;

    case 0x03:
      charset = 'utf-8';
      break;
  }

  return charset;
}

function getTime(duration) {
  duration = duration / 1000;
  const seconds = Math.floor(duration) % 60,
    minutes = Math.floor(duration / 60) % 60,
    hours = Math.floor(duration / 3600);

  return {
    seconds: seconds,
    minutes: minutes,
    hours: hours,
  };
}

function formatTime(time) {
  const seconds = time.seconds < 10 ? '0' + time.seconds : time.seconds;
  const minutes = time.hours > 0 && time.minutes < 10 ? '0' + time.minutes : time.minutes;

  return (time.hours > 0 ? time.hours + ':' : '') + minutes + ':' + seconds;
}

ID3v2.readFrameData['APIC'] = function readPictureFrame(offset, length, data, flags, v) {
  v = v || '3';

  const start = offset;
  const charset = getTextEncoding(data.getUint8(offset));
  let format;
  switch (v) {
    case '2':
      format = getStringAt(data, offset + 1, 3);
      offset += 4;
      break;

    case '3':
    case '4':
      format = getStringWithCharsetAt(data, offset + 1, length - (offset - start), '');
      offset += 1 + format.bytesReadCount;
      break;
  }
  const bite = data.getUint8(offset, 1);
  const type = pictureType[bite];
  const desc = getStringWithCharsetAt(data, offset + 1, length - (offset - start), charset);

  offset += 1 + desc.bytesReadCount;

  return {
    format: format.toString(),
    type: type,
    description: desc.toString(),
    data: getBytesAt(data, offset, start + length - offset),
  };
};

ID3v2.readFrameData['COMM'] = function readCommentsFrame(offset, length, data) {
  const start = offset;
  const charset = getTextEncoding(data.getUint8(offset));
  const language = getStringAt(data, offset + 1, 3);
  const shortdesc = getStringWithCharsetAt(data, offset + 4, length - 4, charset);

  offset += 4 + shortdesc.bytesReadCount;
  const text = getStringWithCharsetAt(data, offset, start + length - offset, charset);

  return {
    language: language,
    shortDescription: shortdesc.toString(),
    text: text.toString(),
  };
};

ID3v2.readFrameData['COM'] = ID3v2.readFrameData['COMM'];

ID3v2.readFrameData['PIC'] = function (offset, length, data, flags) {
  return ID3v2.readFrameData['APIC'](offset, length, data, flags, '2');
};

ID3v2.readFrameData['PCNT'] = function readCounterFrame(offset, length, data) {
  // FIXME: implement the rest of the spec
  return data.getInteger32At(offset);
};

ID3v2.readFrameData['CNT'] = ID3v2.readFrameData['PCNT'];

ID3v2.readFrameData['T*'] = function readTextFrame(offset, length, data) {
  const charset = getTextEncoding(data.getUint8(offset));

  return getStringWithCharsetAt(data, offset + 1, length - 1, charset).toString();
};

ID3v2.readFrameData['TCON'] = function readGenreFrame(offset, length, data) {
  const text = ID3v2.readFrameData['T*'].apply(this, arguments);
  return text.replace(/^\(\d+\)/, '');
};

ID3v2.readFrameData['TCO'] = ID3v2.readFrameData['TCON'];

//ID3v2.readFrameData['TLEN'] = function readLengthFrame(offset, length, data) {
//    var text = ID3v2.readFrameData['T*'].apply( this, arguments );
//
//    return {
//        text : text,
//        parsed : formatTime( getTime(parseInt(text)) )
//    };
//};

ID3v2.readFrameData['USLT'] = function readLyricsFrame(offset, length, data) {
  const start = offset;
  const charset = getTextEncoding(data.getUint8(offset));
  const language = getStringAt(data, offset + 1, 3);
  const descriptor = getStringWithCharsetAt(data, offset + 4, length - 4, charset);

  offset += 4 + descriptor.bytesReadCount;
  const lyrics = getStringWithCharsetAt(data, offset, start + length - offset, charset);

  return {
    language: language,
    descriptor: descriptor.toString(),
    lyrics: lyrics.toString(),
  };
};

ID3v2.readFrameData['ULT'] = ID3v2.readFrameData['USLT'];

ID3v2.ReadTags = function (arraybuffer) {
  const data = new DataView(arraybuffer);
  let offset = 0;

  const major = data.getUint8(offset + 3);
  if (major > 4) {
    return { version: '>2.4' };
  }
  const revision = data.getUint8(offset + 4);
  const unsynch = isBitSetAt(data, offset + 5, 7);
  const xheader = isBitSetAt(data, offset + 5, 6);
  const xindicator = isBitSetAt(data, offset + 5, 5);
  const size = readSynchsafeInteger32At(offset + 6, data);
  offset += 10;

  if (xheader) {
    const xheadersize = data.getInt32(offset, true); //data.getLongAt(offset, true);
    // The 'Extended header size', currently 6 or 10 bytes, excludes itself.
    offset += xheadersize + 4;
  }

  const id3 = {
    version: '2.' + major + '.' + revision,
    major: major,
    revision: revision,
    flags: {
      unsynchronisation: unsynch,
      extendedHeader: xheader,
      experimentalIndicator: xindicator,
    },
    size: size,
  };

  const frames = unsynch ? {} : readFrames(offset, size - 10, data, id3);
  // create shortcuts for most common data
  for (const name in _shortcuts)
    if (_shortcuts.hasOwnProperty(name)) {
      const frameData = getFrameData(frames, _shortcuts[name]);
      if (frameData) id3[name] = frameData;
    }

  for (const frame in frames) {
    if (frames.hasOwnProperty(frame)) {
      id3[frame] = frames[frame];
    }
  }

  return id3;
};

/// -------

const ID4 = {};

ID4.types = {
  0: 'uint8',
  1: 'text',
  13: 'jpeg',
  14: 'png',
  21: 'uint8',
};
ID4.atom = {
  '©alb': ['album'],
  '©art': ['artist'],
  '©ART': ['artist'],
  aART: ['artist'],
  '©day': ['year'],
  '©nam': ['title'],
  '©gen': ['genre'],
  trkn: ['track'],
  '©wrt': ['composer'],
  '©too': ['encoder'],
  cprt: ['copyright'],
  covr: ['picture'],
  '©grp': ['grouping'],
  keyw: ['keyword'],
  '©lyr': ['lyrics'],
  '©cmt': ['comment'],
  tmpo: ['tempo'],
  cpil: ['compilation'],
  disk: ['disc'],
};

ID4.loadData = function (arraybuffer, callback) {
  const data = new DataView(arraybuffer);
  // load the header of the first block
  loadAtom(data, 0, data.byteLength, callback);
};

/**
 * Make sure that the [offset, offset+7] bytes (the block header) are
 * already loaded before calling this function.
 */
function loadAtom(data, offset, length, callback) {
  // 8 is the size of the atomSize and atomName fields.
  // When reading the current block we always read 8 more bytes in order
  // to also read the header of the next block.
  const atomSize = getLongAt(data, offset, true);
  if (atomSize == 0) return callback();
  const atomName = getStringAt(data, offset + 4, 4);

  // Container atoms
  if (['moov', 'udta', 'meta', 'ilst'].indexOf(atomName) > -1) {
    if (atomName == 'meta') offset += 4; // nextItemId (uint32)
    // data.loadRange([offset+8, offset+8 + 8], function() {
    loadAtom(data, offset + 8, atomSize - 8, callback);
    // });
  } else {
    // Value atoms
    const readAtom = atomName in ID4.atom;
    // data.loadRange([offset+(readAtom?0:atomSize), offset+atomSize + 8], function() {
    loadAtom(data, offset + atomSize, length, callback);
    // });
  }
}

ID4.ReadTags = function (arraybuffer) {
  const data = new DataView(arraybuffer);
  const tag = {};
  readAtom(tag, data, 0, data.byteLength);
  return tag;
};

function readAtom(tag, data, offset, length, indent) {
  // debugger;

  indent = indent === undefined ? '' : indent + '  ';
  let seek = offset;
  while (seek < offset + length) {
    const atomSize = data.getInt32(seek); // getLongAt(data, seek, true);
    if (atomSize == 0) return;
    const atomName = getStringAt(data, seek + 4, 4);
    // Container atoms
    if (atomName === 'meta') {
      seek += 4; // nextItemId (uint32)
      readAtom(tag, data, seek + 8, atomSize - 8, indent);
      return;
    }
    if (
      atomName === 'moov' ||
      atomName === 'udta' ||
      atomName === 'ilst'
    ) // ['moov', 'udta', 'meta', 'ilst'].indexOf(atomName) > -1)
    {
      readAtom(tag, data, seek + 8, atomSize - 8, indent);
      return;
    }

    /*
            if (['moov', 'udta', 'meta', 'ilst'].indexOf(atomName) > -1)
            {
                if (atomName === 'meta') seek += 4; // nextItemId (uint32)
                readAtom(tag, data, seek + 8, atomSize - 8, indent);
                return;
            }
            */

    // Value atoms
    if (ID4.atom[atomName]) {
      const klass = getInteger24At(data, seek + 16 + 1, true);
      const atom = ID4.atom[atomName];
      const type = ID4.types[klass];
      if (atomName === 'trkn') {
        tag[atom[0]] = data.getUint8(seek + 16 + 11);
        tag['count'] = data.getUint8(seek + 16 + 13);
      } else {
        // 16: name + size + "data" + size (4 bytes each)
        // 4: atom version (1 byte) + atom flags (3 bytes)
        // 4: NULL (usually locale indicator)
        const dataStart = seek + 16 + 4 + 4;
        const dataEnd = atomSize - 16 - 4 - 4;
        let atomData;
        switch (type) {
          case 'text':
            atomData = getStringWithCharsetAt(data, dataStart, dataEnd, 'UTF-8');
            break;

          case 'uint8':
            atomData = getShortAt(data, dataStart);
            break;

          case 'jpeg':
          case 'png':
            atomData = {
              format: 'image/' + type,
              data: getBytesAt(data, dataStart, dataEnd),
            };
            break;
        }

        if (atom[0] === 'comment') {
          tag[atom[0]] = {
            text: atomData,
          };
        } else {
          tag[atom[0]] = atomData;
        }
      }
    }
    seek += atomSize;
  }
}

export { ID3v2, ID4 };
