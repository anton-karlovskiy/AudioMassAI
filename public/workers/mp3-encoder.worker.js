/**
 * MP3 encoder worker.
 *
 * Encodes raw 16-bit PCM samples to MP3 using the vendored lamejs library.
 *
 * Protocol:
 *  1. First message:  { sampleRate, kbps, channels } — configures the encoder.
 *  2. Second message: ArrayBuffer with left-channel (or mono) Int16 samples.
 *  3. Third message (stereo only): ArrayBuffer with right-channel Int16 samples.
 *  Progress is reported back as { percentage } messages; the final message is
 *  the encoded audio as a Blob.
 */

importScripts('../vendor/lame.js');

let sampleRate = 44100;
let bitrateKbps = 128;
let channelCount = 1;
let mp3Encoder = null;

let leftChannelSamples = null;
let rightChannelSamples = null;
let awaitingFirstBuffer = true;

onmessage = function (event) {
  if (!event.data) return;

  // Configuration message.
  if (event.data.sampleRate) {
    sampleRate = event.data.sampleRate / 1;
    bitrateKbps = event.data.kbps / 1;
    channelCount = event.data.channels / 1;
    return;
  }

  if (awaitingFirstBuffer) {
    leftChannelSamples = new Int16Array(event.data);
    awaitingFirstBuffer = false;

    // Stereo input: wait for the right channel before encoding.
    if (channelCount > 1) return;
  }

  if (event.data && channelCount > 1) {
    rightChannelSamples = new Int16Array(event.data);
  }

  if (!mp3Encoder) {
    mp3Encoder = new lamejs.Mp3Encoder(channelCount, sampleRate, bitrateKbps);
  }

  const sampleBlockSize = 1152 * 2;
  const mp3Chunks = [];
  let lastReportedPercentage = 0;

  let leftChunk = null;
  let rightChunk = null;

  for (let offset = 0; offset < leftChannelSamples.length; offset += sampleBlockSize) {
    leftChunk = leftChannelSamples.subarray(offset, offset + sampleBlockSize);

    if (rightChannelSamples) {
      rightChunk = rightChannelSamples.subarray(offset, offset + sampleBlockSize);
    }

    const mp3Buffer = mp3Encoder.encodeBuffer(leftChunk, rightChunk);

    const percentage = ((offset / leftChannelSamples.length) * 100) >> 0;
    if (percentage > lastReportedPercentage) {
      lastReportedPercentage = percentage;
      postMessage({ percentage: percentage });
    }

    if (mp3Buffer.length > 0) {
      mp3Chunks.push(mp3Buffer);
    }
  }

  const finalBuffer = mp3Encoder.flush();
  if (finalBuffer.length > 0) {
    mp3Chunks.push(finalBuffer);
  }

  postMessage(new Blob(mp3Chunks, { type: 'audio/mp3' }));
};
