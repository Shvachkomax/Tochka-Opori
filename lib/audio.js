import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const OpusScript = require("opusscript");
const { Decoder } = require("ebml");

const EBML_SIMPLEBLOCK = 0xA3;
const EBML_BLOCK = 0xA1;
const EBML_CLUSTER = 0x1F43B675;
const EBML_TRACKS = 0x1654AE6B;
const EBML_CODEC_ID = 0x86;
const EBML_AUDIO = 0xE1;
const EBML_SAMPLING_FREQ = 0xB5;
const EBML_CHANNELS = 0x9F;

function parseVint(buf, offset) {
  const first = buf[offset];
  let len = 1;
  if (first === 0) return null;
  while (!(first & (1 << (8 - len)))) {
    len++;
    if (len > 8) return null;
  }
  const mask = (1 << (8 - len)) - 1;
  let value = first & mask;
  for (let i = 1; i < len; i++) {
    value = (value << 8) | buf[offset + i];
  }
  return { value, length: len };
}

function findEbmlElement(buf, offset, targetId) {
  let pos = offset;
  while (pos < buf.length - 1) {
    try {
      const idResult = parseVint(buf, pos);
      if (!idResult) break;
      const id = idResult.value;
      pos += idResult.length;

      const sizeResult = parseVint(buf, pos);
      if (!sizeResult) break;
      const size = sizeResult.value;
      pos += sizeResult.length;

      if (size > buf.length - pos) break;

      if (id === targetId) {
        return { data: buf.slice(pos, pos + size), start: pos - idResult.length - sizeResult.length, end: pos + size };
      }

      pos += size;
    } catch {
      break;
    }
  }
  return null;
}

function parseSimpleBlock(data) {
  let pos = 0;
  const trackResult = parseVint(data, pos);
  if (!trackResult) return null;
  pos += trackResult.length;
  const track = trackResult.value;

  if (pos + 2 > data.length) return null;
  const timecode = data.readInt16BE(pos);
  pos += 2;

  if (pos >= data.length) return null;
  const flags = data[pos];
  pos++;

  const keyframe = !!(flags & 0x80);
  const frameData = data.slice(pos);

  return { track, timecode, keyframe, frameData };
}

function readPcmFromWav(wavBuffer) {
  if (wavBuffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (wavBuffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let pos = 12;
  while (pos < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", pos, pos + 4);
    const chunkSize = wavBuffer.readUInt32LE(pos + 4);
    if (chunkId === "data") {
      return {
        pcmData: wavBuffer.slice(pos + 8, pos + 8 + chunkSize),
        sampleRate: 0,
        channels: 0,
      };
    }
    pos += 8 + chunkSize;
  }
  return null;
}

function findFormatChunk(wavBuffer) {
  if (wavBuffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (wavBuffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let pos = 12;
  while (pos < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", pos, pos + 4);
    const chunkSize = wavBuffer.readUInt32LE(pos + 4);
    if (chunkId === "fmt ") {
      return {
        audioFormat: wavBuffer.readUInt16LE(pos + 8),
        numChannels: wavBuffer.readUInt16LE(pos + 10),
        sampleRate: wavBuffer.readUInt32LE(pos + 12),
        byteRate: wavBuffer.readUInt32LE(pos + 16),
        blockAlign: wavBuffer.readUInt16LE(pos + 20),
        bitsPerSample: wavBuffer.readUInt16LE(pos + 22),
      };
    }
    pos += 8 + chunkSize;
  }
  return null;
}

async function webmToWav(webmBuffer) {
  const decoder = new Decoder();
  const audioData = [];

  let codecId = null;
  let sampleRate = 48000;
  let channels = 1;

  decoder.on("data", (ev) => {
    if (ev[0] !== "tag") return;
    const tag = ev[1];

    if (tag.name === "CodecID" && tag.data) {
      codecId = tag.data.toString("utf-8");
    }
    if (tag.name === "SamplingFrequency") {
      if (tag.value !== undefined && !Number.isNaN(tag.value)) {
        sampleRate = tag.value;
      } else if (tag.data && tag.data.length >= 4) {
        sampleRate = tag.data.readFloatBE(0);
      }
    }
    if (tag.name === "Channels" && tag.value !== undefined) {
      channels = tag.value;
    }

    if (tag.name === "SimpleBlock" && tag.data) {
      audioData.push({ type: "simpleblock", data: tag.data });
    }
    if (tag.name === "Block" && tag.data) {
      audioData.push({ type: "block", data: tag.data });
    }
  });

  return new Promise((resolve, reject) => {
    decoder.on("error", (err) => reject(err));

    try {
      decoder.write(webmBuffer);
    } catch (err) {
      reject(err);
      return;
    }

    if (audioData.length === 0) {
      resolve(null);
      return;
    }

    try {
      const opus = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO);
      const decodedFrames = [];

      for (const entry of audioData) {
        const parsed = entry.type === "simpleblock"
          ? parseSimpleBlock(entry.data)
          : null;
        if (!parsed || !parsed.frameData || parsed.frameData.length === 0) continue;

        try {
          const pcm = opus.decode(parsed.frameData);
          if (pcm && pcm.length > 0) {
            decodedFrames.push(Buffer.from(pcm));
          }
        } catch {
          // skip failed frames
        }
      }

      opus.delete();

      if (decodedFrames.length === 0) {
        resolve(null);
        return;
      }

      const pcmData = Buffer.concat(decodedFrames);
      const wav = buildWav(pcmData, sampleRate, channels, 16);
      resolve(wav);
    } catch (err) {
      reject(err);
    }
  });
}

function buildWav(pcmData, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;

  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(fileSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmData.copy(wav, 44);

  return wav;
}

export { webmToWav, readPcmFromWav, findFormatChunk, buildWav };
