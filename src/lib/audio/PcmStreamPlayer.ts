import { estimateRms, getPcmF32DurationMs } from './pcmMath.js';

type PcmStreamPlayerOptions = {
  volume: number;
  onPlaybackStart?: (scheduledAtPerformanceMs: number) => void;
  onPlaybackEnd?: () => void;
  onLevel?: (level: number) => void;
};

export class PcmStreamPlayer {
  private audioContext: AudioContext;
  private gainNode: GainNode;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private started = false;
  private stopped = false;
  private queuedSources = 0;
  private endedSources = 0;
  private totalAudioMs = 0;
  private readonly onPlaybackStart?: (scheduledAtPerformanceMs: number) => void;
  private readonly onPlaybackEnd?: () => void;
  private readonly onLevel?: (level: number) => void;

  constructor(options: PcmStreamPlayerOptions) {
    this.audioContext = new AudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = options.volume;
    this.gainNode.connect(this.audioContext.destination);
    this.onPlaybackStart = options.onPlaybackStart;
    this.onPlaybackEnd = options.onPlaybackEnd;
    this.onLevel = options.onLevel;
  }

  get sampleRate(): number {
    return this.audioContext.sampleRate;
  }

  get estimatedAudioMs(): number {
    return this.totalAudioMs;
  }

  get isIdle(): boolean {
    return this.queuedSources > 0 && this.endedSources >= this.queuedSources;
  }

  async resume(): Promise<void> {
    if (this.audioContext.state !== 'running') {
      await this.audioContext.resume();
    }
  }

  setVolume(volume: number): void {
    this.gainNode.gain.setTargetAtTime(volume, this.audioContext.currentTime, 0.01);
  }

  enqueue(arrayBuffer: ArrayBuffer): void {
    if (this.stopped || arrayBuffer.byteLength === 0) {
      return;
    }

    const floats = new Float32Array(arrayBuffer.slice(0));
    const audioBuffer = this.audioContext.createBuffer(1, floats.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(floats);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    const safetyOffsetSeconds = this.started ? 0.004 : 0.018;
    const startTime = Math.max(this.nextStartTime, this.audioContext.currentTime + safetyOffsetSeconds);
    this.nextStartTime = startTime + audioBuffer.duration;
    this.totalAudioMs += getPcmF32DurationMs(arrayBuffer.byteLength, this.sampleRate);
    this.queuedSources += 1;

    source.onended = () => {
      this.sources.delete(source);
      this.endedSources += 1;
      if (!this.stopped && this.queuedSources > 0 && this.endedSources === this.queuedSources) {
        this.onPlaybackEnd?.();
      }
    };

    this.sources.add(source);

    if (!this.started) {
      this.started = true;
      const scheduledAtPerformanceMs =
        performance.now() + Math.max(0, startTime - this.audioContext.currentTime) * 1000;
      this.onPlaybackStart?.(scheduledAtPerformanceMs);
    }

    this.onLevel?.(Math.min(1, estimateRms(floats) * 4));
    source.start(startTime);
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
    }
    this.sources.clear();
    this.gainNode.disconnect();
    await this.audioContext.close();
  }
}
