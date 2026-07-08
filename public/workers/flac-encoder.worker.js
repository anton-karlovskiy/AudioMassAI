/**
 * FLAC encoder worker.
 *
 * Encodes raw 16-bit PCM samples to FLAC using the vendored libflac.js
 * (Emscripten) build.
 *
 * Protocol:
 *  1. First message:  { sample_rate, flac_compression, channels } — configures
 *     and initializes the encoder.
 *  2. Second message: ArrayBuffer with left-channel (or mono) Int16 samples.
 *  3. Third message (stereo only): ArrayBuffer with right-channel Int16 samples.
 *  Progress is reported back as { percentage } messages; the final message is
 *  the encoded audio as a Blob.
 */

// Tell libflac where to find its .wasm file before loading it.
self.FLAC_SCRIPT_LOCATION = '/vendor/';
importScripts('../vendor/libflac.js');

let flacEncoder;
let isEncoderInitialized = false;
let sampleRate = 44100;
let compressionLevel = 5; // FLAC compression level (0-8).
let channelCount = 1;
let encodedChunks = [];
let encodedByteCount = 0;
let awaitingFirstBuffer = true;
let leftChannelSamples = null;
let rightChannelSamples = null;

function initEncoder() {
  if (isEncoderInitialized) return true;

  // Args: sample rate, channels, bits/sample, compression, total samples (0 =
  // unknown), verify, block size (0 = auto).
  flacEncoder = Flac.create_libflac_encoder(
    sampleRate,
    channelCount,
    16,
    compressionLevel,
    0,
    true,
    0
  );
  if (flacEncoder != 0) {
    const status = Flac.init_encoder_stream(flacEncoder, function (buffer) {
      encodedChunks.push(new Uint8Array(buffer));
      encodedByteCount += buffer.byteLength;
    });

    isEncoderInitialized = true;
    return status == 0;
  }

  return false;
}

function interleave(leftSamples, rightSamples) {
  const length = leftSamples.length + rightSamples.length;
  const result = new Int32Array(length);

  let writeIndex = 0;
  let readIndex = 0;

  while (writeIndex < length) {
    result[writeIndex++] = leftSamples[readIndex];
    result[writeIndex++] = rightSamples[readIndex];
    ++readIndex;
  }
  return result;
}

onmessage = function (event) {
  if (!event.data) return;

  // Configuration message.
  if (event.data.sample_rate) {
    sampleRate = event.data.sample_rate / 1;
    compressionLevel = event.data.flac_compression;
    channelCount = event.data.channels / 1;

    initEncoder();
    return;
  }

  if (awaitingFirstBuffer) {
    leftChannelSamples = new Int16Array(event.data, 0);
    awaitingFirstBuffer = false;

    // Stereo input: wait for the right channel before encoding.
    if (channelCount > 1) return;
  }

  if (event.data && channelCount > 1) {
    rightChannelSamples = new Int16Array(event.data, 0);
  }

  if (!isEncoderInitialized) {
    postMessage({ percentage: 0 });
    return;
  }

  postMessage({ percentage: 50 });

  if (channelCount > 1) {
    const interleaved = interleave(leftChannelSamples, rightChannelSamples);
    Flac.FLAC__stream_encoder_process_interleaved(
      flacEncoder,
      interleaved,
      leftChannelSamples.length
    );
  } else {
    // libflac expects Int32 sample arrays.
    const monoSamples = new Int32Array(leftChannelSamples.length);
    let index = 0;
    while (index < leftChannelSamples.length) {
      monoSamples[index] = leftChannelSamples[index];
      ++index;
    }
    Flac.FLAC__stream_encoder_process(flacEncoder, [monoSamples], leftChannelSamples.length);
  }

  Flac.FLAC__stream_encoder_finish(flacEncoder);

  // Combine all encoded chunks into a single buffer.
  const outputData = new Uint8Array(encodedByteCount);
  let offset = 0;
  for (let i = 0; i < encodedChunks.length; i++) {
    outputData.set(encodedChunks[i], offset);
    offset += encodedChunks[i].length;
  }

  postMessage(new Blob([outputData], { type: 'audio/flac' }));

  Flac.FLAC__stream_encoder_delete(flacEncoder);
  isEncoderInitialized = false;
  encodedChunks = [];
  encodedByteCount = 0;
};
