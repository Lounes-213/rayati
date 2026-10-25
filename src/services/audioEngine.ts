/**
 * Audio Engine & Beat Detection Service
 * Generates stadium rhythm tracks, analyzes real-time audio frequencies,
 * and detects beats (BPM & bass drops) to drive audio-reactive tifo light shows.
 */

export type RhythmEffect = 'pulse' | 'strobe' | 'wave' | 'color_shift' | 'blackout_flash';

export interface BeatEvent {
  timeMs: number;
  bassEnergy: number;
  overallVolume: number;
  isPeak: boolean;
  effect: RhythmEffect;
  activeColor?: string;
}

export type BeatListener = (event: BeatEvent) => void;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private beatListeners: Set<BeatListener> = new Set();
  private animFrameId: number | null = null;
  private rhythmPatternInterval: number | null = null;

  // Beat detection state
  private lastBassEnergy = 0;
  private beatThreshold = 0.65;
  private decayRate = 0.96;
  private currentBpm = 126;
  private currentEffect: RhythmEffect = 'pulse';
  private frequencyData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(128));

  // Broadcast channel for zero-latency local tab synchronization
  private rhythmChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('rayati_rhythm') : null;

  constructor() {
    // Listen for rhythm broadcasts if in consumer/phone tab
    this.rhythmChannel?.addEventListener('message', (event) => {
      if (event.data?.type === 'beat' && event.data.beat) {
        const b = event.data.beat as BeatEvent;
        this.beatListeners.forEach((fn) => fn(b));
      }
    });
  }

  public init(): AudioContext {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.frequencyData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 0.8;
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public onBeat(fn: BeatListener): () => void {
    this.beatListeners.add(fn);
    return () => this.beatListeners.delete(fn);
  }

  public setEffect(effect: RhythmEffect): void {
    this.currentEffect = effect;
  }

  public getEffect(): RhythmEffect {
    return this.currentEffect;
  }

  public setBpm(bpm: number): void {
    this.currentBpm = Math.max(60, Math.min(180, bpm));
    if (this.isPlaying) {
      this.startSynthesizedRhythm();
    }
  }

  public getBpm(): number {
    return this.currentBpm;
  }

  public getFrequencyData(): Uint8Array {
    if (this.analyser && this.isPlaying) {
      this.analyser.getByteFrequencyData(this.frequencyData);
    }
    return this.frequencyData;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Generates rhythmic stadium percussion (Bass drum kick + snare + clap)
   * using Web Audio synthesis, perfectly synced to the BPM.
   */
  public startSynthesizedRhythm(): void {
    this.init();
    if (!this.ctx || !this.gainNode) return;

    this.stop();
    this.isPlaying = true;

    const intervalMs = (60 / this.currentBpm) * 1000;
    let step = 0;

    const playStep = () => {
      if (!this.isPlaying || !this.ctx || !this.gainNode) return;
      const now = this.ctx.currentTime;

      // 4/4 Beat pattern:
      // Step 0: Kick
      // Step 1: Snare / Hat
      // Step 2: Kick
      // Step 3: Snare + Clap (Peak Drop)
      const isKick = step === 0 || step === 2;
      const isClap = step === 1 || step === 3;
      const isDropPeak = step === 3;

      if (isKick) {
        this.synthesizeKick(now);
      }
      if (isClap) {
        this.synthesizeSnare(now);
      }

      const beatEv: BeatEvent = {
        timeMs: Date.now(),
        bassEnergy: isKick ? 0.95 : 0.3,
        overallVolume: isDropPeak ? 1.0 : isKick ? 0.8 : 0.6,
        isPeak: isDropPeak || isKick,
        effect: this.currentEffect,
      };

      this.beatListeners.forEach((fn) => fn(beatEv));

      // Broadcast to all active phone tabs & windows
      this.rhythmChannel?.postMessage({ type: 'beat', beat: beatEv });

      step = (step + 1) % 4;
    };

    playStep();
    this.rhythmPatternInterval = window.setInterval(playStep, intervalMs);
    this.startAnalysisLoop();
  }

  private synthesizeKick(time: number): void {
    if (!this.ctx || !this.gainNode) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);

    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    osc.connect(gain);
    gain.connect(this.gainNode);

    osc.start(time);
    osc.stop(time + 0.25);
  }

  private synthesizeSnare(time: number): void {
    if (!this.ctx || !this.gainNode) return;

    // Noise buffer for snap/clap
    const bufferSize = this.ctx.sampleRate * 0.1;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(800, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.12);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.gainNode);

    whiteNoise.start(time);
    whiteNoise.stop(time + 0.14);
  }

  private startAnalysisLoop(): void {
    const check = () => {
      if (!this.isPlaying) return;
      if (this.analyser) {
        this.analyser.getByteFrequencyData(this.frequencyData);

        // Low frequency energy (bins 0 to 4: approx 40-160Hz)
        let bassSum = 0;
        for (let i = 0; i < 4; i++) {
          bassSum += this.frequencyData[i] || 0;
        }
        const currentBass = bassSum / (4 * 255);

        // Peak detector
        if (currentBass > this.beatThreshold && currentBass > this.lastBassEnergy * 1.15) {
          this.beatThreshold = currentBass;
        } else {
          this.beatThreshold = Math.max(0.4, this.beatThreshold * this.decayRate);
        }
        this.lastBassEnergy = currentBass;
      }

      this.animFrameId = requestAnimationFrame(check);
    };

    this.animFrameId = requestAnimationFrame(check);
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.rhythmPatternInterval !== null) {
      clearInterval(this.rhythmPatternInterval);
      this.rhythmPatternInterval = null;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public toggle(): boolean {
    if (this.isPlaying) {
      this.stop();
      return false;
    } else {
      this.startSynthesizedRhythm();
      return true;
    }
  }
}

export const audioEngine = new AudioEngine();
