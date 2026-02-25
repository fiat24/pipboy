'use client';

import { useState, useRef, useEffect, useCallback, useMemo, KeyboardEvent } from 'react';
import Image from 'next/image';
import {
  GiPistolGun,
  GiCrosshair,
  GiHelmet,
  GiShield,
  GiLightningTrio,
  GiRadioactive
} from 'react-icons/gi';
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  duration?: number;
  model?: string;
}

interface InventoryItem {
  name: string;
  qty: number;
  cnd: number;
  wt: number;
  val: number;
  desc: string;
}

interface RadioStation {
  name: string;
  freq: string;
  genre: string;
  signal: number;
  desc: string;
  tracks: RadioTrack[];
}

interface RadioTrack {
  title: string;
  artist: string;
  duration: number;
  src: string;
}

interface MapSite {
  name: string;
  bearing: string;
  dist: string;
  threat: 'LOW' | 'MED' | 'HIGH';
  x: number;
  y: number;
  code: string;
  icon: 'vault' | 'city' | 'factory' | 'tower' | 'medical' | 'camp' | 'workshop' | 'airport' | 'military' | 'ruins';
  dynamic?: boolean;
  expiresAt?: number;
}

type WearMode = 'field' | 'worn' | 'relic';
type ScreenFxMode = 'standard' | 'tube' | 'damaged';
type UiSfxKind = 'tab' | 'dial' | 'ok' | 'deny' | 'move';
type UiToneShape = {
  from: number;
  to?: number;
  duration: number;
  volume: number;
  type: OscillatorType;
  offset?: number;
  band?: number;
  q?: number;
  detune?: number;
};
type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function fDate() {
  const d = new Date();
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getDate().toString().padStart(2, '0')}.${d.getFullYear() + 261}`;
}
function fTime() {
  const d = new Date();
  const h = d.getHours(), m = d.getMinutes().toString().padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

const specialDetails: Record<string, string> = {
  Strength: "Strength is a measure of your raw physical power. It affects how much you can carry, and the damage of all melee attacks.",
  Perception: "Perception is your environmental awareness and 'sixth sense', and affects weapon accuracy in V.A.T.S.",
  Endurance: "Endurance is a measure of your overall physical fitness. It affects your total Health and the Action Point drain from sprinting.",
  Charisma: "Charisma is your ability to charm and convince others. It affects your success to persuade in dialogue and prices when you barter.",
  Intelligence: "Intelligence is a measure of your overall mental acuity, and affects the number of Experience Points earned.",
  Agility: "Agility is a measure of your overall finesse and reflexes. It affects the number of Action Points in V.A.T.S. and your ability to sneak.",
  Luck: "Luck is a measure of your general good fortune. It affects the recharge rate of Critical Hits."
};

const specials = [
  { l: 'Strength', v: '7' },
  { l: 'Perception', v: '8' },
  { l: 'Endurance', v: '10' },
  { l: 'Charisma', v: '9' },
  { l: 'Intelligence', v: '10' },
  { l: 'Agility', v: '6' },
  { l: 'Luck', v: '?' },
];

const MAP_PAN_LIMIT = { x: 136, y: 84 };
const MAP_PAN_STEP = 7;
const MAP_RADAR_RANGE = 108;
const MAP_SWEEP_HALF = 22;
const MAP_LOG_LIMIT = 6;
const PLAYER_POS = { x: 112, y: 74 } as const;

export default function PipBoyTerminal() {
  // Preview mode: run the live UI inside the real-shell frame image.
  const photoShellMode = true;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [booted, setBooted] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [showModelDD, setShowModelDD] = useState(false);
  const [lineCounter, setLineCounter] = useState(1);
  const [uptime, setUptime] = useState('00:00:00');
  const [startTime] = useState(new Date());
  const [clock, setClock] = useState(fTime());

  const [mainTab, setMainTab] = useState<'stat' | 'inv' | 'data' | 'map' | 'radio'>('data');
  const [subTab, setSubTab] = useState<string>('terminal');
  const [invCat, setInvCat] = useState('Weapons');
  const [selectedSpecial, setSelectedSpecial] = useState('Strength');
  const [selectedPerkIdx, setSelectedPerkIdx] = useState(0);
  const [selectedInvIdx, setSelectedInvIdx] = useState(0);
  const [selectedStationIdx, setSelectedStationIdx] = useState(0);
  const [selectedTrackIdx, setSelectedTrackIdx] = useState(0);
  const [selectedMapIdx, setSelectedMapIdx] = useState(2);
  const [selectedMapCode, setSelectedMapCode] = useState('RR-15');
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const [playerHeading, setPlayerHeading] = useState(0);
  const [radarAngle, setRadarAngle] = useState(0);
  const [dynamicSites, setDynamicSites] = useState<MapSite[]>([]);
  const [scanHeat, setScanHeat] = useState<Record<string, number>>({});
  const [interactionHeat, setInteractionHeat] = useState<Record<string, number>>({});
  const [discoveredCodes, setDiscoveredCodes] = useState<Record<string, true>>({});
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [songElapsed, setSongElapsed] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isRadioPlaying, setIsRadioPlaying] = useState(true);
  const [wearMode, setWearMode] = useState<WearMode>('worn');
  const [screenFxMode, setScreenFxMode] = useState<ScreenFxMode>('tube');

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);
  const pipRef = useRef<HTMLDivElement>(null);
  const radioAudioRef = useRef<HTMLAudioElement>(null);
  const uiAudioCtxRef = useRef<AudioContext | null>(null);
  const uiSfxGateRef = useRef<Record<UiSfxKind, number>>({
    tab: 0,
    dial: 0,
    ok: 0,
    deny: 0,
    move: 0,
  });

  const ensureUiAudio = useCallback(() => {
    const Ctx = window.AudioContext || (window as AudioWindow).webkitAudioContext;
    if (!Ctx) return null;
    if (!uiAudioCtxRef.current) uiAudioCtxRef.current = new Ctx();
    const ctx = uiAudioCtxRef.current;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { });
    }
    return ctx;
  }, []);

  const fireTone = useCallback((ctx: AudioContext, tone: UiToneShape) => {
    const startAt = ctx.currentTime + (tone.offset || 0);
    const endAt = startAt + tone.duration;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = tone.type;
    const targetFreq = Math.max(40, tone.to || tone.from);
    osc.frequency.setValueAtTime(Math.max(40, tone.from), startAt);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, endAt);
    if (typeof tone.detune === 'number') osc.detune.setValueAtTime(tone.detune, startAt);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(tone.band || 1800, startAt);
    filter.Q.value = tone.q || 1.3;

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, tone.volume), startAt + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);
  }, []);

  const playUiSfx = useCallback((kind: UiSfxKind) => {
    const gateMs = kind === 'move' ? 58 : kind === 'dial' ? 34 : 0;
    const now = performance.now();
    if (gateMs > 0 && now - uiSfxGateRef.current[kind] < gateMs) return;
    uiSfxGateRef.current[kind] = now;

    const ctx = ensureUiAudio();
    if (!ctx) return;

    if (kind === 'tab') {
      fireTone(ctx, { from: 1740, to: 1320, duration: 0.028, volume: 0.032, type: 'square', band: 1900, q: 1.6 });
      fireTone(ctx, { from: 1520, to: 1180, duration: 0.024, volume: 0.022, type: 'square', band: 1750, q: 1.4, offset: 0.02 });
      return;
    }

    if (kind === 'dial') {
      fireTone(ctx, { from: 940, to: 720, duration: 0.018, volume: 0.025, type: 'sawtooth', band: 1200, q: 1.1 });
      fireTone(ctx, { from: 230, to: 170, duration: 0.02, volume: 0.015, type: 'triangle', band: 420, q: 0.8, offset: 0.002 });
      return;
    }

    if (kind === 'ok') {
      fireTone(ctx, { from: 760, to: 1040, duration: 0.044, volume: 0.026, type: 'triangle', band: 1450, q: 1.1 });
      fireTone(ctx, { from: 980, to: 1380, duration: 0.04, volume: 0.024, type: 'triangle', band: 1700, q: 1.2, offset: 0.048 });
      return;
    }

    if (kind === 'deny') {
      fireTone(ctx, { from: 900, to: 320, duration: 0.082, volume: 0.026, type: 'sawtooth', band: 980, q: 0.9 });
      fireTone(ctx, { from: 520, to: 260, duration: 0.05, volume: 0.018, type: 'square', band: 800, q: 0.85, offset: 0.03 });
      return;
    }

    fireTone(ctx, { from: 1230, to: 950, duration: 0.012, volume: 0.012, type: 'square', band: 1850, q: 1.4 });
  }, [ensureUiAudio, fireTone]);

  // Responsive scaling: fit the active shell viewport into current screen.
  useEffect(() => {
    const resize = () => {
      if (!pipRef.current) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const baseW = photoShellMode ? 902 : 640;
      const baseH = photoShellMode ? 803 : 460;
      const fitPad = photoShellMode ? 1.0 : 0.85;
      const s = Math.min(vw / baseW, vh / baseH) * fitPad;
      pipRef.current.style.transform = `scale(${s})`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [photoShellMode]);

  useEffect(() => { fetch('/api/models').then(r => r.json()).then(d => { setModels(d.models || []); setSelectedModel(d.default || '') }).catch(() => { }) }, []);
  useEffect(() => { const t = setTimeout(() => { setBooted(true); inputRef.current?.focus() }, 800); return () => clearTimeout(t) }, []);
  useEffect(() => {
    if (endRef.current) {
      const container = endRef.current.closest('.chat-scroll');
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      } else {
        endRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [messages]);
  useEffect(() => {
    const h = () => { if (!isStreaming && mainTab === 'data' && subTab === 'terminal') inputRef.current?.focus() };
    document.addEventListener('click', h); return () => document.removeEventListener('click', h);
  }, [isStreaming, mainTab, subTab]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ddRef.current && !ddRef.current.contains(e.target as Node)) setShowModelDD(false) };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => {
    const i = setInterval(() => {
      const d = Date.now() - startTime.getTime();
      setUptime(`${Math.floor(d / 3600000).toString().padStart(2, '0')}:${Math.floor((d % 3600000) / 60000).toString().padStart(2, '0')}:${Math.floor((d % 60000) / 1000).toString().padStart(2, '0')}`);
      setClock(fTime());
    }, 1000);
    return () => clearInterval(i);
  }, [startTime]);
  useEffect(() => {
    setSelectedInvIdx(0);
  }, [invCat]);
  useEffect(() => {
    setSelectedTrackIdx(0);
    setSongElapsed(0);
    setAudioDuration(0);
  }, [selectedStationIdx]);
  useEffect(() => {
    setMapOffset({ x: 0, y: 0 });
    setPlayerHeading(0);
    setRadarAngle(0);
    setDynamicSites([]);
    setScanHeat({});
    setInteractionHeat({});
    setDiscoveredCodes({});
    setSelectedMapCode('RR-15');
    setScanLog([]);
  }, [mainTab]);

  const clearTerm = useCallback(() => { setMessages([]); setLineCounter(1) }, []);
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => { if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearTerm() } };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [clearTerm]);

  const sendMessage = useCallback(async () => {
    if (isStreaming) {
      playUiSfx('deny');
      return;
    }
    if (!input.trim()) return;
    playUiSfx('ok');
    const um: Message = { role: 'user', content: input.trim(), timestamp: new Date() };
    setMessages(p => [...p, um]); setLineCounter(p => p + 1); setInput(''); setIsStreaming(true);
    const am: Message = { role: 'assistant', content: '', timestamp: new Date(), model: selectedModel };
    setMessages(p => [...p, am]);
    const t0 = performance.now();
    try {
      const cm = [...messages, um].map(m => ({ role: m.role, content: m.content }));
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: cm, model: selectedModel }) });
      if (!r.ok) {
        const raw = await r.text().catch(() => '');
        if (raw) {
          let detail = '';
          try {
            const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
            const nested = parsed.error && typeof parsed.error === 'object' ? (parsed.error as { message?: unknown }).message : undefined;
            const hit = [parsed.error, parsed.message, nested].find(v => typeof v === 'string' && v.trim());
            if (typeof hit === 'string') detail = hit;
          } catch {
            // fall through to raw response text
          }
          throw new Error(detail || raw);
        }
        throw new Error(`Request failed with status ${r.status}`);
      }
      const rd = r.body?.getReader(); const dc = new TextDecoder();
      if (!rd) throw new Error('no body');
      let full = '', buf = '';
      while (true) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dc.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t || t === 'data: [DONE]' || !t.startsWith('data: ')) continue;
          let d: { content?: string; error?: string } | null = null;
          try { d = JSON.parse(t.slice(6)) as { content?: string; error?: string } } catch { d = null }
          if (!d) continue;
          if (d.error) throw new Error(d.error);
          if (d.content) {
            full += d.content;
            setMessages(p => { const u = [...p]; const l = u[u.length - 1]; if (l.role === 'assistant') l.content = full; return u });
          }
        }
      }
      const dur = (performance.now() - t0) / 1000;
      setMessages(p => { const u = [...p]; const l = u[u.length - 1]; if (l.role === 'assistant') l.duration = dur; return u });
      setLineCounter(p => p + full.split('\n').length + 2);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Terminal malfunction.';
      const compact = raw.replace(/\s+/g, ' ').trim();
      const detail = compact.length > 280 ? `${compact.slice(0, 277)}...` : compact;
      setMessages(p => { const u = [...p]; const l = u[u.length - 1]; if (l.role === 'assistant') l.content = `[ERROR] ${detail || 'Terminal malfunction.'}`; return u });
      setLineCounter(p => p + 2);
    } finally { setIsStreaming(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [input, isStreaming, messages, selectedModel, playUiSfx]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } };

  // Build chat lines
  let cur = 1;
  const ml: { ln: number; text: string; type: 'user' | 'assistant' | 'meta'; last: boolean }[] = [];
  messages.forEach((msg, idx) => {
    const isLast = idx === messages.length - 1;
    if (msg.role === 'user') { ml.push({ ln: cur++, text: msg.content, type: 'user', last: false }) }
    else {
      ml.push({ ln: cur++, text: `[${msg.model || selectedModel}]:`, type: 'meta', last: false });
      msg.content.split('\n').forEach((line, li, arr) => { ml.push({ ln: cur++, text: line, type: 'assistant', last: isLast && li === arr.length - 1 }) });
      if (msg.duration) ml.push({ ln: cur++, text: `// ${msg.duration.toFixed(1)}s`, type: 'meta', last: false });
      ml.push({ ln: cur++, text: '', type: 'meta', last: false });
    }
  });

  const statusReadouts = [
    { l: 'RADS', v: '0.14 Sv' },
    { l: 'TEMP', v: '36.7C' },
    { l: 'CORE', v: '78%' },
    { l: 'WGT', v: '162/235' },
    { l: 'CLOCK', v: clock },
    { l: 'UPTIME', v: uptime },
  ];

  const invData: Record<string, InventoryItem[]> = {
    Weapons: [
      { name: '10mm Pistol', qty: 1, cnd: 78, wt: 4.2, val: 53, desc: 'Standard sidearm. Worn grip, reliable feed.' },
      { name: 'Laser Rifle', qty: 1, cnd: 64, wt: 8.4, val: 157, desc: 'Refitted with cracked lens housing and copper coil patch.' },
      { name: 'Combat Knife', qty: 2, cnd: 81, wt: 1.0, val: 37, desc: 'Utility blade with nicked edge. No lock-up wobble.' },
      { name: 'Fat Man', qty: 1, cnd: 42, wt: 30.0, val: 515, desc: 'Portable nuke catapult. Frame corrosion at hinge point.' },
      { name: 'Plasma Grenade', qty: 4, cnd: 97, wt: 0.5, val: 125, desc: 'Military-grade sphere charge. Keep pin assembly clean.' },
    ],
    Aid: [
      { name: 'Stimpak', qty: 12, cnd: 100, wt: 0.1, val: 35, desc: 'Restores health quickly. Auto-injector pressure stable.' },
      { name: 'RadAway', qty: 5, cnd: 100, wt: 0.2, val: 55, desc: 'Flushes radiation dose over time. Bitter aftertaste guaranteed.' },
      { name: 'Rad-X', qty: 3, cnd: 100, wt: 0.1, val: 45, desc: 'Temporary rad resistance enhancer. Use before hot zones.' },
      { name: 'Nuka-Cola', qty: 7, cnd: 100, wt: 1.0, val: 12, desc: 'Pre-war cola. One bottle has visible sediment.' },
      { name: 'Mentats', qty: 2, cnd: 100, wt: 0.0, val: 25, desc: 'Boosts focus and cognition. Keep out of direct sunlight.' },
    ],
    Misc: [
      { name: 'Bobby Pin', qty: 15, cnd: 69, wt: 0.0, val: 1, desc: 'Lockpick staple. 4 pieces slightly bent.' },
      { name: 'Bottle Cap', qty: 347, cnd: 100, wt: 0.0, val: 347, desc: 'Common wasteland currency. Sorted by mint marks.' },
      { name: 'Duct Tape', qty: 8, cnd: 86, wt: 0.5, val: 10, desc: 'Universal fixer. Cloth backing still adhesive.' },
      { name: 'Wonderglue', qty: 3, cnd: 92, wt: 0.2, val: 15, desc: 'Industrial adhesive for armor and weapon maintenance.' },
      { name: 'Sensor Module', qty: 1, cnd: 58, wt: 1.8, val: 90, desc: 'Salvaged targeting sensor. Requires calibration.' },
    ],
    Ammo: [
      { name: '10mm Round', qty: 89, cnd: 100, wt: 0.0, val: 1, desc: 'Sidearm cartridge. Mixed lots, mostly dry storage.' },
      { name: 'Fusion Cell', qty: 44, cnd: 100, wt: 0.0, val: 3, desc: 'Energy weapon micro-cell. Nominal output 73%.' },
      { name: '.308 Round', qty: 23, cnd: 100, wt: 0.0, val: 2, desc: 'High-caliber rifle round. Jacket wear acceptable.' },
      { name: 'Mini Nuke', qty: 2, cnd: 100, wt: 12.0, val: 100, desc: 'Tactical payload. Transport lock engaged.' },
      { name: 'Shotgun Shell', qty: 33, cnd: 100, wt: 0.0, val: 2, desc: '12 gauge shell. Brass tarnishing visible.' },
    ],
  };

  const mapSites = useMemo<MapSite[]>(() => ([
    { name: 'Vault 111', code: 'VT-111', bearing: 'NNE', dist: '2.8mi', threat: 'LOW', x: 42, y: 18, icon: 'vault' },
    { name: 'Sanctuary', code: 'SAN-01', bearing: 'NW', dist: '4.1mi', threat: 'LOW', x: 26, y: 32, icon: 'city' },
    { name: 'Red Rocket', code: 'RR-15', bearing: 'NW', dist: '4.8mi', threat: 'LOW', x: 52, y: 44, icon: 'workshop' },
    { name: 'Concord', code: 'CNC-11', bearing: 'W', dist: '5.2mi', threat: 'MED', x: 68, y: 58, icon: 'city' },
    { name: 'Abernathy Farm', code: 'ABR-21', bearing: 'WSW', dist: '5.9mi', threat: 'LOW', x: 62, y: 86, icon: 'camp' },
    { name: 'Lexington', code: 'LEX-32', bearing: 'W', dist: '6.5mi', threat: 'MED', x: 88, y: 44, icon: 'ruins' },
    { name: 'Corvega Plant', code: 'CRV-44', bearing: 'SE', dist: '6.2mi', threat: 'HIGH', x: 118, y: 54, icon: 'factory' },
    { name: 'Cambridge PD', code: 'CPD-22', bearing: 'SSE', dist: '7.3mi', threat: 'HIGH', x: 94, y: 72, icon: 'tower' },
    { name: 'Graygarden', code: 'GRY-04', bearing: 'SW', dist: '8.2mi', threat: 'LOW', x: 78, y: 100, icon: 'workshop' },
    { name: 'Bunker Hill', code: 'BNK-19', bearing: 'E', dist: '8.4mi', threat: 'MED', x: 126, y: 44, icon: 'camp' },
    { name: 'Goodneighbor', code: 'GDN-07', bearing: 'ESE', dist: '9.1mi', threat: 'MED', x: 142, y: 66, icon: 'city' },
    { name: 'CIT Ruins', code: 'CIT-77', bearing: 'ESE', dist: '10.3mi', threat: 'MED', x: 152, y: 56, icon: 'ruins' },
    { name: 'Diamond City', code: 'DC-001', bearing: 'S', dist: '11.0mi', threat: 'MED', x: 152, y: 40, icon: 'medical' },
    { name: 'Mass Fusion', code: 'MSF-09', bearing: 'E', dist: '11.8mi', threat: 'HIGH', x: 170, y: 52, icon: 'factory' },
    { name: 'Fort Hagen', code: 'FHG-58', bearing: 'SW', dist: '12.6mi', threat: 'HIGH', x: 76, y: 26, icon: 'military' },
    { name: 'Boston Airport', code: 'AIR-13', bearing: 'E', dist: '12.9mi', threat: 'MED', x: 186, y: 30, icon: 'airport' },
    { name: 'The Castle', code: 'CST-84', bearing: 'SE', dist: '14.0mi', threat: 'HIGH', x: 178, y: 86, icon: 'military' },
    { name: 'Jamaica Plain', code: 'JMP-33', bearing: 'S', dist: '14.3mi', threat: 'MED', x: 158, y: 96, icon: 'ruins' },
    { name: 'Quincy Ruins', code: 'QNC-77', bearing: 'SSE', dist: '16.5mi', threat: 'HIGH', x: 174, y: 106, icon: 'ruins' },
    { name: 'Vault 81', code: 'VT-081', bearing: 'SW', dist: '13.2mi', threat: 'LOW', x: 126, y: 98, icon: 'vault' },
    { name: 'Fort Strong', code: 'FST-65', bearing: 'ESE', dist: '15.8mi', threat: 'HIGH', x: 198, y: 70, icon: 'military' },
    { name: 'Salem Museum', code: 'SLM-09', bearing: 'NE', dist: '15.6mi', threat: 'MED', x: 198, y: 20, icon: 'ruins' },
    { name: 'Taffington', code: 'TAF-08', bearing: 'NE', dist: '14.7mi', threat: 'MED', x: 166, y: 18, icon: 'camp' },
    { name: 'Revere Satellite', code: 'RVR-90', bearing: 'ENE', dist: '18.1mi', threat: 'HIGH', x: 216, y: 28, icon: 'tower' },
    { name: 'Malden Center', code: 'MLD-31', bearing: 'E', dist: '16.2mi', threat: 'HIGH', x: 188, y: 44, icon: 'ruins' },
    { name: 'National Guard Yard', code: 'NGY-55', bearing: 'ENE', dist: '20.0mi', threat: 'HIGH', x: 234, y: 34, icon: 'military' },
    { name: 'Finch Farm', code: 'FNF-12', bearing: 'ENE', dist: '22.4mi', threat: 'LOW', x: 256, y: 24, icon: 'camp' },
    { name: 'Vault 95', code: 'VT-095', bearing: 'SSW', dist: '22.1mi', threat: 'MED', x: 126, y: 138, icon: 'vault' },
    { name: 'Atom Cats Garage', code: 'ACG-23', bearing: 'SE', dist: '24.3mi', threat: 'LOW', x: 222, y: 126, icon: 'workshop' },
    { name: 'Spectacle Island', code: 'SPI-66', bearing: 'SE', dist: '18.2mi', threat: 'MED', x: 208, y: 118, icon: 'camp' },
  ]), []);
  const randomSignalNames = useMemo(() => ([
    'Unknown Beacon',
    'Caravan Ping',
    'Hostile Broadcast',
    'Distress Signal',
    'Relay Fragment',
    'Military Echo',
    'Salvage Marker',
    'Power Signature',
  ]), []);

  const toLocalAudioSrc = (title: string) => `/audio/${encodeURIComponent(title)}.mp3`;

  const localTrackLibrary: RadioTrack[] = [
    { title: "I Don't Want To Set The World On Fire", artist: 'The Ink Spots', duration: 180, src: toLocalAudioSrc("I Don't Want To Set The World On Fire") },
    { title: 'Dear Hearts And Gentle People', artist: 'Bob Crosby & The Bobcats', duration: 160, src: toLocalAudioSrc('Dear Hearts And Gentle People') },
    { title: "Good rockin' tonight", artist: 'Roy Brown', duration: 170, src: toLocalAudioSrc("Good rockin' tonight") },
  ];

  const radioStations: RadioStation[] = [
    {
      name: 'Galaxy News Radio',
      freq: '95.6',
      genre: 'News / Swing',
      signal: 81,
      desc: 'Three Dog relay. Emergency beacons and local bulletins.',
      tracks: [
        localTrackLibrary[0],
        localTrackLibrary[1],
        localTrackLibrary[2],
      ],
    },
    {
      name: 'Diamond City Radio',
      freq: '102.7',
      genre: 'Classics',
      signal: 67,
      desc: 'Settlement gossip, market reports, and old world records.',
      tracks: [
        localTrackLibrary[1],
        localTrackLibrary[0],
        localTrackLibrary[2],
      ],
    },
    {
      name: 'Mojave Music Relay',
      freq: '96.4',
      genre: 'Western Swing',
      signal: 58,
      desc: 'Long-range caravan relay from Mojave repeater towers.',
      tracks: [
        localTrackLibrary[2],
        localTrackLibrary[1],
        localTrackLibrary[0],
      ],
    },
    {
      name: 'Atomic Hits Relay',
      freq: '88.3',
      genre: 'Nuclear Pop',
      signal: 39,
      desc: 'Weak signal with old world novelty hits and static bursts.',
      tracks: [
        localTrackLibrary[0],
        localTrackLibrary[2],
        localTrackLibrary[1],
      ],
    },
  ];

  const currentInvItems = invData[invCat] || [];
  const selectedInvItem = currentInvItems[Math.min(selectedInvIdx, Math.max(currentInvItems.length - 1, 0))];
  const activeStation = radioStations[selectedStationIdx] || radioStations[0];
  const activeTracks = activeStation?.tracks || [];
  const activeTrack = activeTracks[Math.min(selectedTrackIdx, Math.max(activeTracks.length - 1, 0))];
  const buildDynamicSite = useCallback((): MapSite => {
    const icons: MapSite['icon'][] = ['tower', 'camp', 'workshop', 'airport', 'military', 'ruins', 'factory'];
    const x = Math.round(-90 + Math.random() * 420);
    const y = Math.round(-64 + Math.random() * 260);
    const dx = x - PLAYER_POS.x;
    const dy = y - PLAYER_POS.y;
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const compass = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    const sigId = `${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 10)}`;
    return {
      name: randomSignalNames[Math.floor(Math.random() * randomSignalNames.length)],
      code: `SIG-${sigId}`,
      bearing: compass[Math.round(angle / 45) % compass.length],
      dist: `${(Math.hypot(dx, dy) / 8).toFixed(1)}mi`,
      threat: Math.random() > 0.7 ? 'HIGH' : Math.random() > 0.45 ? 'MED' : 'LOW',
      x,
      y,
      icon: icons[Math.floor(Math.random() * icons.length)],
      dynamic: true,
      expiresAt: Date.now() + 25000,
    };
  }, [randomSignalNames]);
  const pushScanLog = useCallback((entries: string | string[]) => {
    const lines = Array.isArray(entries) ? entries : [entries];
    setScanLog(prev => [...lines, ...prev].slice(0, MAP_LOG_LIMIT));
  }, []);
  const compassRose = useMemo(
    () => ['E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'],
    [],
  );
  const getBearingLabel = useCallback(
    (angle: number) => compassRose[Math.round(angle / 22.5) % compassRose.length],
    [compassRose],
  );
  const getContactVector = useCallback((site: MapSite) => {
    const dx = site.x + mapOffset.x - PLAYER_POS.x;
    const dy = site.y + mapOffset.y - PLAYER_POS.y;
    const distance = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    return { dx, dy, distance, angle };
  }, [mapOffset.x, mapOffset.y]);
  const allMapContacts = useMemo(() => [...mapSites, ...dynamicSites], [mapSites, dynamicSites]);
  const selectedMapSite = mapSites[Math.min(selectedMapIdx, Math.max(mapSites.length - 1, 0))];
  const selectedMapContact = useMemo(
    () => allMapContacts.find(site => site.code === selectedMapCode) || selectedMapSite,
    [allMapContacts, selectedMapCode, selectedMapSite],
  );
  const selectedVector = getContactVector(selectedMapContact);
  const selectedDistLive = `${(selectedVector.distance / 8).toFixed(1)}mi`;
  const selectedBearingLive = getBearingLabel(selectedVector.angle);
  const nowTs = Date.now();
  const activeScanCodes = Object.entries(scanHeat).filter(([, until]) => until > nowTs).map(([code]) => code);
  const activeInteractionCodes = Object.entries(interactionHeat).filter(([, until]) => until > nowTs).map(([code]) => code);
  const mapContactsForDisplay = useMemo(() => {
    const keep = new Set<string>([selectedMapContact.code, ...activeScanCodes, ...activeInteractionCodes]);
    const nearest = [...allMapContacts]
      .sort((a, b) => getContactVector(a).distance - getContactVector(b).distance)
      .slice(0, photoShellMode ? 8 : 14);
    for (const site of nearest) keep.add(site.code);
    return allMapContacts.filter(site => keep.has(site.code));
  }, [allMapContacts, activeInteractionCodes, activeScanCodes, getContactVector, photoShellMode, selectedMapContact.code]);
  const latestMapLog = scanLog[0] || '';
  const selectedContactScanned = activeScanCodes.includes(selectedMapContact.code);
  const questHeading = playerHeading;
  const mapGridXCount = photoShellMode ? 24 : 42;
  const mapGridYCount = photoShellMode ? 18 : 34;
  const mapGridXStep = photoShellMode ? 36 : 22;
  const mapGridYStep = photoShellMode ? 28 : 16;
  const mapRoadPaths = photoShellMode
    ? [
      '-142 -130 L-102 266',
      '126 -140 L118 274',
      '-260 86 L580 94',
      '-80 -48 L332 198',
      '18 -90 L430 168',
    ]
    : [
      '-142 -130 L-102 266',
      '-8 -140 L-2 272',
      '126 -140 L118 274',
      '256 -140 L246 278',
      '388 -128 L366 286',
      '-260 34 L580 26',
      '-260 86 L580 94',
      '-260 142 L580 152',
      '-260 198 L580 210',
      '-80 -48 L332 198',
      '18 -90 L430 168',
    ];
  const renderMapSiteGlyph = (site: MapSite) => {
    if (photoShellMode) {
      if (site.threat === 'HIGH') return <path d="M0 -5 L4.8 3.8 L-4.8 3.8 Z" />;
      if (site.dynamic) return <circle r="3.4" />;
      return <path d="M0 -4.2 L4.2 0 L0 4.2 L-4.2 0 Z" />;
    }

    if (site.icon === 'vault') return <path d="M0 -6 L5 -1 L0 6 L-5 -1 Z" />;
    if (site.icon === 'city') return <path d="M-6 5 L-6 -3 L-2 -3 L-2 1 L2 1 L2 -5 L6 -5 L6 5 Z" />;
    if (site.icon === 'factory') return <path d="M-6 5 L-6 -2 L-2 0 L0 -4 L2 0 L6 -2 L6 5 Z" />;
    if (site.icon === 'tower') return <path d="M0 -6 L4 5 L-4 5 Z M-2 -1 L2 -1" />;
    if (site.icon === 'medical') return <path d="M-2 -6 H2 V-2 H6 V2 H2 V6 H-2 V2 H-6 V-2 H-2 Z" />;
    if (site.icon === 'camp') return <path d="M-6 5 L0 -6 L6 5 Z" />;
    if (site.icon === 'workshop') return <path d="M-5 -2 H5 V2 H-5 Z M-3 -5 H3 V-2 H-3 Z M-3 2 H3 V5 H-3 Z" />;
    if (site.icon === 'airport') return <path d="M-7 0 L7 0 M0 -7 L0 7 M-4 -4 L4 4 M-4 4 L4 -4" />;
    if (site.icon === 'military') return <path d="M0 -7 L2 -1 L7 -1 L3 2 L5 7 L0 4 L-5 7 L-3 2 L-7 -1 L-2 -1 Z" />;
    return <path d="M-6 5 L-6 -2 L-2 -1 L0 -5 L2 -2 L6 -4 L6 5 Z" />;
  };
  const trackDuration = Math.max(1, Math.round(audioDuration || activeTrack?.duration || 180));
  const trackProgress = Math.min(100, (songElapsed / trackDuration) * 100);
  const signalProfile = activeStation.signal >= 75 ? 'CLEAR' : activeStation.signal >= 50 ? 'FADED' : 'NOISY';
  const statTabs: Array<'status' | 'special' | 'perks'> = ['status', 'special', 'perks'];
  const perks = [
    { name: 'RIFLEMAN', rank: 3, desc: 'Non-automatic rifles now hit harder and ignore a portion of armor.' },
    { name: 'GUN NUT', rank: 2, desc: 'Advanced weapon mods can be crafted at workbenches.' },
    { name: 'LONE WANDERER', rank: 1, desc: 'When traveling alone, take less damage and carry more.' },
    { name: 'AQUABOY', rank: 1, desc: 'No radiation from swimming and can breathe underwater.' },
    { name: 'SCROUNGER', rank: 2, desc: 'Containers and corpses yield more ammunition.' },
  ];
  const activePerk = perks[Math.min(selectedPerkIdx, Math.max(perks.length - 1, 0))];

  const invCategoryTabs = [
    { label: 'WEAPONS', key: 'Weapons' },
    { label: 'APPAREL', key: 'Misc' },
    { label: 'AID', key: 'Aid' },
  ] as const;

  const carryWeight = currentInvItems.reduce((sum, it) => sum + it.wt * it.qty, 0);
  const invDamage = Math.max(0, Math.round(((selectedInvItem?.cnd || 0) * 0.24) + ((selectedInvItem?.val || 0) * 0.07)));
  const invFireRate = Math.max(0, Math.round(30 + (selectedInvItem?.cnd || 0) * 1.2));
  const invRange = Math.max(0, Math.round(25 + (selectedInvItem?.wt ? 65 - selectedInvItem.wt * 5 : 20)));
  const invAccuracy = Math.max(0, Math.round((selectedInvItem?.cnd || 0) * 0.62));
  const invAmmo = selectedInvItem?.name.includes('Laser') ? 'Fusion Cell' : selectedInvItem?.name.includes('Shotgun') ? '12 Gauge' : '10mm';
  const marker = (value: number, hi: number, mid: number) => value >= hi ? '+++' : value >= mid ? '--' : '---';
  const invStatsRows = [
    { label: 'Damage', value: String(invDamage), mark: marker(invDamage, 45, 22) },
    { label: invAmmo, value: String(Math.max(0, selectedInvItem?.qty || 0)), mark: '' },
    { label: 'Fire Rate', value: String(invFireRate), mark: marker(invFireRate, 95, 55) },
    { label: 'Range', value: String(invRange), mark: marker(invRange, 68, 40) },
    { label: 'Accuracy', value: String(invAccuracy), mark: marker(invAccuracy, 75, 42) },
    { label: 'Weight', value: (selectedInvItem?.wt || 0).toFixed(1), mark: marker(100 - (selectedInvItem?.wt || 0) * 10, 70, 40) },
    { label: 'Value', value: String(selectedInvItem?.val || 0), mark: marker(selectedInvItem?.val || 0, 140, 60) },
  ];
  const formatMMSS = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
  const tabs: Array<typeof mainTab> = ['stat', 'inv', 'data', 'map', 'radio'];

  const cycleMainTab = (dir: 1 | -1, sfx: UiSfxKind = 'tab') => {
    const cur = tabs.indexOf(mainTab);
    const idx = (cur + dir + tabs.length) % tabs.length;
    switchTab(tabs[idx], sfx);
  };
  const cycleStation = (dir: 1 | -1, sfx: UiSfxKind = 'dial') => {
    setSelectedStationIdx(prev => (prev + dir + radioStations.length) % radioStations.length);
    playUiSfx(sfx);
  };
  const cycleTrack = (dir: 1 | -1, sfx: UiSfxKind = 'dial') => {
    const len = activeTracks.length || 1;
    setSelectedTrackIdx(prev => (prev + dir + len) % len);
    setSongElapsed(0);
    setAudioDuration(0);
    playUiSfx(sfx);
  };
  const cycleMapTarget = (dir: 1 | -1, sfx: UiSfxKind = 'dial') => {
    setSelectedMapIdx(prev => {
      const next = (prev + dir + mapSites.length) % mapSites.length;
      setSelectedMapCode(mapSites[next].code);
      return next;
    });
    playUiSfx(sfx);
  };
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const panMapBy = useCallback((dx: number, dy: number) => {
    setMapOffset(prev => ({
      x: clamp(prev.x + dx, -MAP_PAN_LIMIT.x, MAP_PAN_LIMIT.x),
      y: clamp(prev.y + dy, -MAP_PAN_LIMIT.y, MAP_PAN_LIMIT.y),
    }));
  }, []);
  const interactWithMapSite = useCallback((site: MapSite, via: 'KEY' | 'CLICK') => {
    const lockUntil = scanHeat[site.code] || 0;
    if (lockUntil <= Date.now()) {
      pushScanLog(`NO LOCK ${site.code} ${site.name}`);
      playUiSfx('deny');
      return;
    }

    setSelectedMapCode(site.code);
    const staticIdx = mapSites.findIndex(point => point.code === site.code);
    if (staticIdx >= 0) setSelectedMapIdx(staticIdx);
    setDiscoveredCodes(prev => ({ ...prev, [site.code]: true }));
    setInteractionHeat(prev => ({ ...prev, [site.code]: Date.now() + 2600 }));
    playUiSfx('ok');

    if (site.dynamic) {
      const dynamicEvents = [
        `SALVAGE ${site.code} +${24 + Math.floor(Math.random() * 41)} CAPS`,
        `DECRYPT ${site.code} ROUTE DATA UPDATED`,
        `ENCOUNTER ${site.code} THREAT SHADOWED`,
        `RELAY ${site.code} SIGNAL STABILIZED`,
      ];
      const event = dynamicEvents[Math.floor(Math.random() * dynamicEvents.length)];
      pushScanLog([`${via} INTERACT ${site.code} ${site.name}`, event]);
      setDynamicSites(prev => prev.filter(entry => entry.code !== site.code));
      if (Math.random() < 0.55) {
        setTimeout(() => {
          setDynamicSites(prev => [...prev, buildDynamicSite()].slice(-12));
        }, 380);
      }
      return;
    }

    const staticEvents = [
      `LOG UPDATE ${site.code} AREA CHARTED`,
      `QUEST NOTE ${site.code} CHECKPOINT SET`,
      `TACTICAL ${site.code} WATCHLIST REFRESH`,
    ];
    const event = staticEvents[Math.floor(Math.random() * staticEvents.length)];
    pushScanLog([`${via} TRACK ${site.code} ${site.name}`, event]);
  }, [scanHeat, pushScanLog, mapSites, buildDynamicSite, playUiSfx]);
  const cycleFxMode = (sfx: UiSfxKind = 'dial') => {
    setScreenFxMode(prev => prev === 'standard' ? 'tube' : prev === 'tube' ? 'damaged' : 'standard');
    playUiSfx(sfx);
  };
  const handleLeftWheel = () => {
    if (mainTab === 'map') {
      cycleMapTarget(-1, 'dial');
      return;
    }
    if (mainTab === 'radio') {
      cycleStation(-1, 'dial');
      return;
    }
    cycleMainTab(-1, 'dial');
  };
  const handleRightWheel = () => {
    if (mainTab === 'map') {
      cycleMapTarget(1, 'dial');
      return;
    }
    if (mainTab === 'radio') {
      cycleStation(1, 'dial');
      return;
    }
    cycleMainTab(1, 'dial');
  };
  const handleTuneWheel = () => {
    if (mainTab !== 'radio') {
      switchTab('radio', 'dial');
      return;
    }
    cycleTrack(1, 'dial');
  };
  const onHardwareActivate = (e: KeyboardEvent<HTMLElement>, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  useEffect(() => {
    const audio = radioAudioRef.current;
    if (!audio) return;

    if (!activeTrack?.src) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setSongElapsed(0);
      setAudioDuration(0);
      return;
    }

    audio.src = activeTrack.src;
    audio.currentTime = 0;
    audio.load();
    setSongElapsed(0);
    setAudioDuration(activeTrack.duration || 0);
  }, [activeTrack?.src, activeTrack?.duration]);

  useEffect(() => {
    const audio = radioAudioRef.current;
    if (!audio || !activeTrack?.src) return;

    if (isRadioPlaying) {
      audio.play().catch(() => {
        setIsRadioPlaying(false);
      });
      return;
    }

    audio.pause();
  }, [isRadioPlaying, activeTrack?.src]);

  useEffect(() => {
    const audio = radioAudioRef.current;
    if (!audio) return;

    const syncTime = () => setSongElapsed(audio.currentTime || 0);
    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setSelectedTrackIdx(prev => (activeTracks.length > 0 ? (prev + 1) % activeTracks.length : 0));
    };

    audio.addEventListener('timeupdate', syncTime);
    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', syncTime);
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('durationchange', syncDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [activeTracks.length]);

  useEffect(() => {
    const audio = radioAudioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  useEffect(() => {
    return () => {
      const ctx = uiAudioCtxRef.current;
      uiAudioCtxRef.current = null;
      if (ctx) {
        void ctx.close().catch(() => { });
      }
    };
  }, []);

  useEffect(() => {
    const site = mapSites[Math.min(selectedMapIdx, Math.max(mapSites.length - 1, 0))];
    if (!site) return;
    setSelectedMapCode(site.code);
  }, [selectedMapIdx, mapSites]);

  useEffect(() => {
    if (allMapContacts.some(site => site.code === selectedMapCode)) return;
    setSelectedMapCode(selectedMapSite.code);
  }, [allMapContacts, selectedMapCode, selectedMapSite.code]);

  useEffect(() => {
    const onMapKeys = (e: globalThis.KeyboardEvent) => {
      if (mainTab !== 'map') return;

      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const key = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'r', 'e'].includes(key)) return;
      e.preventDefault();

      const step = e.shiftKey ? MAP_PAN_STEP * 2 : MAP_PAN_STEP;
      if (key === 'r') {
        setMapOffset({ x: 0, y: 0 });
        setPlayerHeading(0);
        playUiSfx('ok');
        return;
      }

      if (key === 'e') {
        const scanned = allMapContacts
          .map(site => ({ site, d: getContactVector(site).distance }))
          .filter(({ site }) => (scanHeat[site.code] || 0) > Date.now())
          .sort((a, b) => a.d - b.d);

        const closest = scanned[0];
        if (!closest) {
          pushScanLog('NO ACTIVE TARGET LOCK');
          playUiSfx('deny');
          return;
        }

        interactWithMapSite(closest.site, 'KEY');
        return;
      }

      if (key === 'w' || key === 'arrowup') {
        panMapBy(0, step);
        setPlayerHeading(-90);
        playUiSfx('move');
      }
      if (key === 's' || key === 'arrowdown') {
        panMapBy(0, -step);
        setPlayerHeading(90);
        playUiSfx('move');
      }
      if (key === 'a' || key === 'arrowleft') {
        panMapBy(step, 0);
        setPlayerHeading(180);
        playUiSfx('move');
      }
      if (key === 'd' || key === 'arrowright') {
        panMapBy(-step, 0);
        setPlayerHeading(0);
        playUiSfx('move');
      }
    };

    document.addEventListener('keydown', onMapKeys);
    return () => document.removeEventListener('keydown', onMapKeys);
  }, [mainTab, panMapBy, allMapContacts, getContactVector, interactWithMapSite, pushScanLog, scanHeat, playUiSfx]);

  useEffect(() => {
    if (mainTab !== 'map') return;
    const t = setInterval(() => {
      setRadarAngle(prev => (prev + 5) % 360);
    }, 70);
    return () => clearInterval(t);
  }, [mainTab]);

  useEffect(() => {
    if (mainTab !== 'map') return;
    const spawnTicker = setInterval(() => {
      setDynamicSites(prev => {
        const now = Date.now();
        const next = prev.filter(site => !site.expiresAt || site.expiresAt > now);
        if (Math.random() < 0.9) next.push(buildDynamicSite());
        if (Math.random() < 0.34) next.push(buildDynamicSite());
        return next.slice(-14);
      });
    }, 3600);

    const driftTicker = setInterval(() => {
      setDynamicSites(prev => prev
        .filter(site => !site.expiresAt || site.expiresAt > Date.now())
        .map(site => ({
          ...site,
          x: clamp(site.x + Math.round((Math.random() - 0.5) * 6), -110, 340),
          y: clamp(site.y + Math.round((Math.random() - 0.5) * 6), -80, 220),
        })));
    }, 820);

    return () => {
      clearInterval(spawnTicker);
      clearInterval(driftTicker);
    };
  }, [mainTab, buildDynamicSite]);

  useEffect(() => {
    if (mainTab !== 'map') return;
    const now = Date.now();
    const hits = allMapContacts
      .map(site => {
        const { distance, angle } = getContactVector(site);
        const diff = Math.abs(((angle - radarAngle + 540) % 360) - 180);
        return { site, distance, diff };
      })
      .filter(({ distance, diff }) => distance <= MAP_RADAR_RANGE && diff <= MAP_SWEEP_HALF)
      .map(({ site }) => site)
      .slice(0, 8);

    const newLocks: string[] = [];
    setScanHeat(prev => {
      const next: Record<string, number> = {};
      for (const [code, until] of Object.entries(prev)) {
        if (until > now) next[code] = until;
      }
      for (const site of hits) {
        if (!next[site.code]) newLocks.push(site.code);
        next[site.code] = now + 2500;
      }
      return next;
    });
    setInteractionHeat(prev => Object.fromEntries(Object.entries(prev).filter(([, until]) => until > now)));

    if (newLocks.length > 0) {
      const nameMap = new Map(allMapContacts.map(site => [site.code, site.name]));
      const threatMap = new Map(allMapContacts.map(site => [site.code, site.threat]));
      setDiscoveredCodes(prev => {
        const next = { ...prev };
        for (const code of newLocks) next[code] = true;
        return next;
      });
      pushScanLog(newLocks.slice(0, 2).map(code => `SCAN LOCK ${code} ${nameMap.get(code) || 'UNKNOWN'}`));

      if (newLocks.some(code => threatMap.get(code) === 'HIGH')) {
        if (Math.random() < 0.55) {
          pushScanLog('HOSTILE RETURN PING DETECTED');
        }
      }
    }
  }, [mainTab, radarAngle, allMapContacts, getContactVector, pushScanLog]);

  const switchTab = (t: typeof mainTab, sfx: UiSfxKind = 'tab') => {
    if (t !== mainTab) playUiSfx(sfx);
    setMainTab(t);
    if (t === 'data') setSubTab('terminal');
    else if (t === 'stat') setSubTab('status');
    else setSubTab('');
  };

  const activePhotoButton: 'stat' | 'inv' | 'data' =
    mainTab === 'stat' ? 'stat' : mainTab === 'inv' ? 'inv' : 'data';

  return (
    <div className={`pip-wrapper ${photoShellMode ? 'photo-shell-mode' : ''}`}>
      <div ref={pipRef} className={`pip wear-${wearMode}`}>
        {/* Grime overlay */}
        <div className="casing-grime" />

        <div className="pipfront">
          <div className="top"><div className="top-panel" /></div>
          <div className="top-button" />
          <div className="screw1" /><div className="screw2" />

          <div className="screen-chassis">
            <div className="side-rail side-rail-l"><span /><span /><span /></div>
            <div className="side-rail side-rail-r"><span /><span /><span /></div>
            <div className="screen-latch latch-tl" />
            <div className="screen-latch latch-tr" />
            <div className="screen-latch latch-bl" />
            <div className="screen-latch latch-br" />

            <div className="screen-border">
              <div className={`screen fx-${screenFxMode} tab-${mainTab}`}>
                <div className="screen-reflection" />
                <div className="phosphor-grid" />
                <div className="glass-smudges" />
                {mainTab !== 'map' && !(photoShellMode && mainTab === 'stat') && <div className="scan-sweep" />}

                <div className="terminal-ui">
                  {/* Nav tabs */}
                  <div className="screen-nav">
                    {(['stat', 'inv', 'data', 'map', 'radio'] as const).map(t => (
                      <button key={t} className={`nav-tab ${mainTab === t ? 'active' : ''}`} onClick={() => switchTab(t)}>
                        {mainTab === t ? `[${t.toUpperCase()}]` : t.toUpperCase()}
                      </button>
                    ))}
                    <div className="screen-nav-meta">{fDate()} {'|'} {clock} {'|'} LN {lineCounter}</div>
                  </div>

                  {/* ═══ STAT MODE ═══ */}
                  {mainTab === 'stat' && (
                    <div className="stat-view fo-stat-view">
                      <div className="fo-stat-subtabs">
                        {statTabs.map(t => (
                          <button
                            key={t}
                            className={`fo-stat-subtab ${subTab === t ? 'active' : ''}`}
                            onClick={() => {
                              if (subTab === t) return;
                              setSubTab(t);
                              playUiSfx('tab');
                            }}
                          >
                            {t.toUpperCase()}
                          </button>
                        ))}
                      </div>

                      {subTab === 'status' && (
                        <>
                          <div className="vaultboy-wrap">
                            <div className="vaultboy" />
                            <div className="vb-bar vb-bar1" />
                            <div className="vb-bar vb-bar2" />
                            <div className="vb-bar vb-bar3" />
                            <div className="vb-bar vb-bar4" />
                            <div className="vb-bar vb-bar5" />
                            <div className="vb-bar vb-bar6" />
                          </div>
                          <div className="vb-info-bar">
                            <div className="vb-icon"><GiPistolGun className="pix-ico" style={{ width: '22px', height: '16px' }} /><span className="val" style={{ visibility: 'hidden' }}>0</span></div>
                            <div className="vb-icon"><GiCrosshair className="pix-ico" style={{ width: '14px', height: '14px' }} /><span className="val">21</span></div>
                            <div className="vb-icon"><GiHelmet className="pix-ico" style={{ width: '20px', height: '16px' }} /><span className="val" style={{ visibility: 'hidden' }}>0</span></div>
                            <div className="vb-icon"><GiShield className="pix-ico" style={{ width: '14px', height: '14px' }} /><span className="val">110</span></div>
                            <div className="vb-icon"><GiLightningTrio className="pix-ico" style={{ width: '14px', height: '14px' }} /><span className="val">126</span></div>
                            <div className="vb-icon"><GiRadioactive className="pix-ico" style={{ width: '14px', height: '14px' }} /><span className="val">35</span></div>
                          </div>
                          <div className="vb-supplies">
                            <span className="vb-supply">STIMPAK (0)</span>
                            <span className="vb-supply">RADAWAY (0)</span>
                            <span className="vb-supply">SHOW EFFECTS</span>
                          </div>
                          <div className="status-readouts">
                            {statusReadouts.map(r => (
                              <div key={r.l} className="status-chip">
                                <span>{r.l}</span>
                                <strong>{r.v}</strong>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {subTab === 'special' && (
                        <div className="special-view">
                          <div className="special-list scrollable pip-scroll">
                            {specials.map(s => (
                              <div
                                key={s.l}
                                className={`special-item ${selectedSpecial === s.l ? 'active' : ''}`}
                                onMouseEnter={() => setSelectedSpecial(s.l)}
                                onClick={() => {
                                  if (selectedSpecial === s.l) return;
                                  setSelectedSpecial(s.l);
                                  playUiSfx('tab');
                                }}
                              >
                                <span className="special-name">{s.l}</span>
                                <span className="special-val">{s.v}</span>
                              </div>
                            ))}
                          </div>
                          <div className="special-desc-container pip-scroll">
                            <div className="vaultboy-special" />
                            <div className="special-desc-text">
                              {specialDetails[selectedSpecial]}
                            </div>
                          </div>
                        </div>
                      )}

                      {subTab === 'perks' && (
                        <div className="fo-perks-view">
                          <div className="fo-perks-list pip-scroll">
                            {perks.map((perk, idx) => (
                              <button
                                key={perk.name}
                                className={`fo-perk-item ${idx === selectedPerkIdx ? 'active' : ''}`}
                                onClick={() => {
                                  if (idx === selectedPerkIdx) return;
                                  setSelectedPerkIdx(idx);
                                  playUiSfx('tab');
                                }}
                              >
                                <span>{perk.name}</span>
                                <strong>R{perk.rank}</strong>
                              </button>
                            ))}
                          </div>
                          <div className="fo-perk-detail">
                            <div className="fo-perk-title">{activePerk.name}</div>
                            <div className="fo-perk-rank">RANK {activePerk.rank}</div>
                            <p>{activePerk.desc}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ═══ INV ═══ */}
                  {mainTab === 'inv' && (
                    <div className="screen-content fo-inv-screen">
                      <div className="fo-inv-tabs">
                        {invCategoryTabs.map(tab => (
                          <button
                            key={tab.key}
                            className={`fo-inv-tab ${invCat === tab.key ? 'active' : ''}`}
                            onClick={() => {
                              if (invCat === tab.key) return;
                              setInvCat(tab.key);
                              playUiSfx('tab');
                            }}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                      <div className="fo-inv-main">
                        <div className="fo-inv-list pip-scroll">
                          {currentInvItems.map((it, i) => (
                            <button
                              key={`${it.name}-${i}`}
                              className={`fo-inv-item ${i === selectedInvIdx ? 'active' : ''}`}
                              onMouseEnter={() => setSelectedInvIdx(i)}
                              onClick={() => {
                                if (i === selectedInvIdx) return;
                                setSelectedInvIdx(i);
                                playUiSfx('tab');
                              }}
                            >
                              {it.name}{it.qty > 1 ? ` (${it.qty})` : ''}
                            </button>
                          ))}
                        </div>
                        <div className="fo-inv-side">
                          <div className="fo-inv-statbox">
                            {invStatsRows.map(row => (
                              <div key={row.label} className="fo-inv-statrow">
                                <span>{row.label}</span>
                                <strong>{row.value}</strong>
                                <em>{row.mark}</em>
                              </div>
                            ))}
                          </div>
                          <p className="fo-inv-desc">{selectedInvItem?.desc || 'No diagnostic data.'}</p>
                        </div>
                      </div>
                      <div className="fo-inv-actions">
                        <button className="fo-inv-action" onClick={() => playUiSfx('deny')}>DROP</button>
                        <button className="fo-inv-action" onClick={() => playUiSfx('deny')}>FAV</button>
                        <button className="fo-inv-action" onClick={() => playUiSfx('deny')}>SORT</button>
                      </div>
                      <div className="fo-inv-footer">
                        <span>WGT {carryWeight.toFixed(0)}/330</span>
                        <span>CAPS 4880</span>
                        <span>AMMO 110</span>
                      </div>
                    </div>
                  )}

                  {/* ═══ DATA ═══ */}
                  {mainTab === 'data' && (
                    <>
                      <div className="sub-nav">
                        <button
                          className={`sub-tab ${subTab === 'terminal' ? 'active' : ''}`}
                          onClick={() => {
                            if (subTab === 'terminal') return;
                            setSubTab('terminal');
                            playUiSfx('tab');
                          }}
                        >
                          Terminal
                        </button>
                        <button
                          className={`sub-tab ${subTab === 'logs' ? 'active' : ''}`}
                          onClick={() => {
                            if (subTab === 'logs') return;
                            setSubTab('logs');
                            playUiSfx('tab');
                          }}
                        >
                          Logs
                        </button>
                        <button
                          className={`sub-tab ${subTab === 'settings' ? 'active' : ''}`}
                          onClick={() => {
                            if (subTab === 'settings') return;
                            setSubTab('settings');
                            playUiSfx('tab');
                          }}
                        >
                          Setting
                        </button>
                      </div>
                      <div className="screen-content">
                        {subTab === 'logs' ? (
                          <div className="logs-view pip-scroll">
                            {[{ t: 100, m: '[INIT] Bootloader OK' }, { t: 220, m: '[V-TEC] OS v4.77' }, { t: 350, m: '[MEM] 64k RAM' }, { t: 500, m: '[AI] Cognitive net online' }, { t: 800, m: '[NET] Sub-ether relay up' }].map((l, i) => (
                              <div className="log-entry" key={i}><span className="log-time">{new Date(startTime.getTime() + l.t).toISOString().substring(11, 19)}</span><span className="log-msg">{l.m}</span></div>
                            ))}
                            {messages.map((m, i) => (
                              <div className="log-entry" key={`ml-${i}`}><span className="log-time">{m.timestamp.toISOString().substring(11, 19)}</span><span className="log-msg">[{m.role.toUpperCase()}] {m.role === 'assistant' ? `${m.duration?.toFixed(1) || '—'}s` : m.content.substring(0, 30)}</span></div>
                            ))}
                          </div>
                        ) : subTab === 'settings' ? (
                          <div className="data-settings-view pip-scroll">
                            <div className="data-settings-title">SYSTEM SETTINGS</div>
                            <div className="data-settings-card">
                              <div className="data-setting-row">
                                <span className="data-setting-key">MODEL CORE</span>
                                {models.length > 0 ? (
                                  <div ref={ddRef} className="model-selector data-model-selector">
                                    <button
                                      className="model-btn"
                                      onClick={() => {
                                        setShowModelDD(!showModelDD);
                                        playUiSfx('dial');
                                      }}
                                    >
                                      [{selectedModel || 'Select model'}] ▼
                                    </button>
                                    {showModelDD && (
                                      <div className="model-dropdown">
                                        {models.map(m => (
                                          <button
                                            key={m}
                                            className={`model-option ${m === selectedModel ? 'selected' : ''}`}
                                            onClick={() => {
                                              if (m !== selectedModel) playUiSfx('tab');
                                              setSelectedModel(m);
                                              setShowModelDD(false);
                                            }}
                                          >
                                            {m === selectedModel ? '● ' : '  '}
                                            {m}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="data-setting-value">LOADING MODELS...</span>
                                )}
                              </div>
                              <div className="data-setting-row">
                                <span className="data-setting-key">ACTIVE MODEL</span>
                                <span className="data-setting-value">{selectedModel || 'N/A'}</span>
                              </div>
                              <div className="data-setting-row">
                                <span className="data-setting-key">STATUS</span>
                                <span className="data-setting-value">{isStreaming ? 'PROCESSING' : 'STANDBY'}</span>
                              </div>
                              <div className="data-setting-row">
                                <span className="data-setting-key">AVAILABLE</span>
                                <span className="data-setting-value">{models.length}</span>
                              </div>
                            </div>
                            <div className="data-settings-note">
                              Model selection moved from RADIO to DATA/SETTINGS.
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="chat-scroll pip-scroll">
                              {messages.length === 0 ? (
                                <div className="chat-welcome">
                                  <div className="bright">&gt; SYSTEM BOOT COMPLETE<br />&gt; AI MODULE v4.77<br />&gt; 64K RAM | 38911 BYTES FREE<br />&gt; BIOMETRIC LINK: STABLE</div><br />
                                  WELCOME, VAULT DWELLER.<br />
                                  ACTIVE QUEST: REACH DIAMOND CITY.<br /><br />
                                  Pip-Boy AI Assistant ONLINE.<br />
                                  DATA BUS // ROBCO INDUSTRIES // NOMINAL<br />
                                  <span className="bright">&gt;&gt;</span> Type below.
                                </div>
                              ) : (
                                <>{ml.map((l, i) => (<div key={i} className={`chat-line msg-${l.type}`}><div className="chat-gutter">{l.ln}</div><div className="chat-text">{l.type === 'meta' ? <span>{l.text}</span> : <span className="msg-content">{l.text}{l.last && isStreaming && <span className="cursor-blink" />}</span>}</div></div>))}<div ref={endRef} /></>
                              )}
                            </div>
                            <div className="chat-input"><span className="input-prompt">&gt;</span><input ref={inputRef} className="input-field" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={!booted || isStreaming} />{!input && !isStreaming && booted && <span className="cursor-blink" />}</div>
                          </>
                        )}
                      </div>
                    </>
                  )}

                  {/* ═══ MAP — RETRO GRID ═══ */}
                  {mainTab === 'map' && (
                    <div className="screen-content map-tab-content fo-map-tab">
                      <div className={`fo-map-panel ${photoShellMode ? 'fo-map-panel-lite' : ''}`}>
                        <svg className="fo-map-svg" viewBox="0 0 228 132" aria-label="Local map">
                          <rect x="0" y="0" width="228" height="132" className="fo-map-bg" />
                          <g className="fo-map-pan" transform={`translate(${mapOffset.x} ${mapOffset.y})`}>
                            <rect x="-260" y="-190" width="840" height="500" className="fo-map-extended" />
                            <g className="fo-map-grid">
                              {[...Array(mapGridXCount)].map((_, i) => <line key={`mv-${i}`} x1={-240 + mapGridXStep * i} y1="-190" x2={-240 + mapGridXStep * i} y2="300" />)}
                              {[...Array(mapGridYCount)].map((_, i) => <line key={`mh-${i}`} x1="-260" y1={-182 + mapGridYStep * i} x2="580" y2={-182 + mapGridYStep * i} />)}
                            </g>
                            <g className="fo-map-terrain">
                              <path d="M-220 -24 C-166 -42, -88 -2, -30 -18 S66 -40, 138 -14 S254 26, 338 -2 S452 -36, 560 -10" />
                              <path d="M-248 26 C-172 0, -112 38, -34 18 S86 -8, 174 30 S288 70, 374 44 S474 18, 558 52" />
                              <path d="M-220 84 C-140 56, -68 98, 6 78 S118 52, 210 92 S332 126, 430 104" />
                              <path d="M-252 134 C-162 104, -84 148, 8 126 S132 100, 232 144 S366 172, 498 148" />
                              <path d="M-238 186 C-132 164, -26 198, 86 184 S246 158, 368 196 S504 220, 588 212" />
                            </g>
                            <g className="fo-map-roads">
                              {mapRoadPaths.map((d, idx) => <path key={`road-${idx}`} d={d} />)}
                            </g>
                            {!photoShellMode && (
                              <g className="fo-map-landmarks">
                                <circle cx="58" cy="14" r="8" />
                                <circle cx="176" cy="18" r="10" />
                                <circle cx="212" cy="104" r="12" />
                                <path d="M-40 116 h28 v10 h-28 z" />
                                <path d="M222 58 h32 v12 h-32 z" />
                                <path d="M258 120 h24 v8 h-24 z" />
                                <path d="M88 128 h34 v12 h-34 z" />
                              </g>
                            )}
                            <g className="fo-map-sites">
                              {mapContactsForDisplay.map(site => (
                                <g
                                  key={site.code}
                                  className={`fo-map-site ${site.code === selectedMapContact.code ? 'active' : ''} ${site.threat === 'HIGH' ? 'hostile' : ''} ${activeScanCodes.includes(site.code) ? 'scanned' : ''} ${activeInteractionCodes.includes(site.code) ? 'interacted' : ''} ${discoveredCodes[site.code] ? 'discovered' : ''} ${site.dynamic ? 'dynamic' : ''}`}
                                  transform={`translate(${site.x} ${site.y})`}
                                  onClick={() => {
                                    if (site.code !== selectedMapCode) playUiSfx('tab');
                                    const staticIdx = mapSites.findIndex(m => m.code === site.code);
                                    if (staticIdx >= 0) setSelectedMapIdx(staticIdx);
                                    setSelectedMapCode(site.code);
                                    if (!activeScanCodes.includes(site.code)) {
                                      pushScanLog(`LOCK REQUIRED ${site.code}`);
                                      playUiSfx('deny');
                                      return;
                                    }
                                    interactWithMapSite(site, 'CLICK');
                                  }}
                                >
                                  {renderMapSiteGlyph(site)}
                                  {!photoShellMode && activeScanCodes.includes(site.code) && <circle className="fo-map-contact-ping" r="8.2" />}
                                  {!photoShellMode && activeInteractionCodes.includes(site.code) && <circle className="fo-map-contact-ping active" r="11.6" />}
                                </g>
                              ))}
                            </g>
                            <circle className="fo-map-selected-ring" cx={selectedMapContact.x} cy={selectedMapContact.y} r="8" />
                          </g>
                          <g className="fo-map-radar" transform={`translate(${PLAYER_POS.x} ${PLAYER_POS.y})`}>
                            <circle className="fo-map-radar-core" r="3.4" />
                            <circle className="fo-map-radar-ring" r="32" />
                            {!photoShellMode && <circle className="fo-map-radar-ring faint" r="68" />}
                            {!photoShellMode && <circle className="fo-map-radar-ring faint" r={MAP_RADAR_RANGE} />}
                            <path
                              className="fo-map-radar-sweep"
                              d={`M0 0 L${MAP_RADAR_RANGE} -26 A${MAP_RADAR_RANGE + 4} ${MAP_RADAR_RANGE + 4} 0 0 1 ${MAP_RADAR_RANGE} 26 Z`}
                              transform={`rotate(${radarAngle})`}
                            />
                          </g>
                          <g className="fo-map-cursor" transform={`translate(${PLAYER_POS.x} ${PLAYER_POS.y}) rotate(${questHeading})`}>
                            <path d="M-4 -2.4 L11 0 L-4 2.4 Z" />
                          </g>
                        </svg>
                        <div className="fo-map-overlay">
                          <div className="fo-map-overlay-row">
                            <span>TARGET</span>
                            <strong>{selectedMapContact.code} {selectedMapContact.name}</strong>
                          </div>
                          <div className="fo-map-overlay-row">
                            <span>DIST {selectedDistLive}</span>
                            <span>{selectedBearingLive} {selectedMapContact.threat}</span>
                          </div>
                          <div className="fo-map-overlay-row">
                            <span>LOCK</span>
                            <span>{selectedContactScanned ? 'STABLE' : 'SEARCHING'} {selectedMapContact.dynamic ? '| SIGNAL' : '| SITE'}</span>
                          </div>
                          {photoShellMode
                            ? (latestMapLog ? <div className="fo-map-logline">{latestMapLog}</div> : null)
                            : scanLog.map((line, idx) => (
                              <div key={`${line}-${idx}`} className="fo-map-logline">{line}</div>
                            ))}
                        </div>
                        <div className={`fo-map-footer ${photoShellMode ? 'lite' : ''}`}>
                          <span>{fDate()}</span>
                          <span>{clock} {'|'} PAN {mapOffset.x},{mapOffset.y} {'|'} HDG {Math.round((playerHeading + 360) % 360)}°</span>
                          {!photoShellMode && <span className="active">WASD MOVE | E INTERACT | R RESET</span>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ═══ RADIO ═══ */}
                  {mainTab === 'radio' && (
                    <div className="screen-content">
                      <div className="radio-view">
                        <div className="radio-title">WASTELAND RECEIVER</div>
                        <div className="radio-grid">
                          <div className="radio-list pip-scroll">
                            {radioStations.map((station, idx) => (
                              <button
                                key={station.name}
                                className={`radio-item ${idx === selectedStationIdx ? 'active' : ''}`}
                                onClick={() => {
                                  if (idx === selectedStationIdx) return;
                                  setSelectedStationIdx(idx);
                                  playUiSfx('dial');
                                }}
                              >
                                <span className="radio-item-freq">{station.freq} MHz</span>
                                <span className="radio-item-name">{station.name}</span>
                                <span className="radio-item-sig">SIG {station.signal}%</span>
                              </button>
                            ))}
                          </div>
                          <div className="radio-detail">
                            <div className="radio-now">{activeStation.name}</div>
                            <div className="radio-sub">{activeStation.genre} {'|'} {activeStation.freq} MHz</div>
                            <div className="radio-song">
                              <span>NOW PLAYING: {activeTrack?.title || 'Carrier Wave'}</span>
                              <span className={`radio-live ${isRadioPlaying ? 'live' : ''}`}>{isRadioPlaying ? 'ON AIR' : 'PAUSED'}</span>
                            </div>
                            <div className="radio-artist">{activeTrack?.artist || 'Unknown Artist'}</div>
                            <div className="radio-progress">
                              <span>{formatMMSS(songElapsed)}</span>
                              <div className="radio-progress-track"><span style={{ width: `${trackProgress}%` }} /></div>
                              <span>{formatMMSS(trackDuration)}</span>
                            </div>
                            <div className="radio-signal">
                              <span>SIGNAL</span>
                              <div className="radio-signal-track"><span style={{ width: `${activeStation.signal}%` }} /></div>
                              <strong>{activeStation.signal}% {signalProfile}</strong>
                            </div>
                            <p className="radio-desc">{activeStation.desc}</p>
                            <div className="radio-tracklist pip-scroll">
                              {activeTracks.map((track, idx) => (
                                <button
                                  key={`${track.title}-${idx}`}
                                  className={`radio-track-item ${idx === selectedTrackIdx ? 'active' : ''}`}
                                  onClick={() => {
                                    if (idx === selectedTrackIdx) return;
                                    setSelectedTrackIdx(idx);
                                    setSongElapsed(0);
                                    setAudioDuration(0);
                                    playUiSfx('dial');
                                  }}
                                >
                                  <span>{track.title}</span>
                                  <span>{track.artist} {'|'} {formatMMSS(track.duration)}</span>
                                </button>
                              ))}
                            </div>
                            <div className="radio-meta">
                              <span>AUDIO LINK: {activeTrack?.src ? 'ACTIVE' : 'OFFLINE'}</span>
                              <span>SIGNAL PROFILE: {signalProfile}</span>
                              <span>AI CORE: {selectedModel || '—'}</span>
                              <span>STATUS: {isStreaming ? 'PROCESSING' : 'STANDBY'}</span>
                            </div>
                            <div className="wear-controls">
                              <span className="wear-label">Casing</span>
                              {(['field', 'worn', 'relic'] as const).map(mode => (
                                <button
                                  key={mode}
                                  className={`wear-btn ${wearMode === mode ? 'active' : ''}`}
                                  onClick={() => {
                                    if (mode === wearMode) return;
                                    setWearMode(mode);
                                    playUiSfx('dial');
                                  }}
                                >
                                  {mode.toUpperCase()}
                                </button>
                              ))}
                              <button
                                className={`wear-btn ${isRadioPlaying ? 'active' : ''}`}
                                onClick={() => {
                                  setIsRadioPlaying(!isRadioPlaying);
                                  playUiSfx(isRadioPlaying ? 'deny' : 'ok');
                                }}
                              >
                                {isRadioPlaying ? 'PAUSE' : 'PLAY'}
                              </button>
                            </div>
                            <div className="screen-controls">
                              <span className="wear-label">CRT</span>
                              {(['standard', 'tube', 'damaged'] as const).map(mode => (
                                <button
                                  key={mode}
                                  className={`wear-btn ${screenFxMode === mode ? 'active' : ''}`}
                                  onClick={() => {
                                    if (mode === screenFxMode) return;
                                    setScreenFxMode(mode);
                                    playUiSfx('dial');
                                  }}
                                >
                                  {mode.toUpperCase()}
                                </button>
                              ))}
                            </div>
                            <div className="hardware-hint">L/R: TAB or TARGET | TUNE: NEXT TRACK | POWER: CRT MODE</div>
                            <audio ref={radioAudioRef} className="radio-audio" preload="metadata" />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* HUD Bar */}
                  {mainTab !== 'map' && mainTab !== 'inv' && (
                    <div className="hud-bar">
                      <span>HP 365/365</span>
                      <span className="hud-lv">LEVEL 48 <span className="hud-lv-bar"><span className="hud-lv-fill" style={{ width: '80%' }} /></span></span>
                      <span>AP 110/110</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="screen-shadow-plate" />
          </div>

          <div
            className="power hardware-control"
            role="button"
            tabIndex={0}
            title="Power: cycle CRT profile"
            onClick={() => cycleFxMode()}
            onKeyDown={(e) => onHardwareActivate(e, cycleFxMode)}
          />
          <div className="screw4" /><div className="screw5" />
        </div>

        {/* Left wheel */}
        <div
          className="left-wheel hardware-control"
          role="button"
          tabIndex={0}
          title="Left wheel: previous tab/target/station"
          onClick={handleLeftWheel}
          onKeyDown={(e) => onHardwareActivate(e, handleLeftWheel)}
        >
          {[0, 1, 2, 3].map(i => <div key={i} className="left-wheel-shadow" />)}
        </div>

        {/* Right wheel */}
        <div
          className="wheel hardware-control"
          role="button"
          tabIndex={0}
          title="Right wheel: next tab/target/station"
          onClick={handleRightWheel}
          onKeyDown={(e) => onHardwareActivate(e, handleRightWheel)}
        >
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="wheel-shadow" />)}
          <div className="wheel-plug" />
        </div>

        {/* Rads meter */}
        <div className="rads"><div className="rads-meter" /></div>

        {/* Speakers */}
        <div className="speakers">
          {[0, 1, 2, 3].map(i => <div key={i} className="speaker-slot-r" />)}
        </div>
        <div className="left-speakers">
          {[0, 1, 2, 3].map(i => <div key={i} className="speaker-slot-l" />)}
          <div className="screw3" />
        </div>

        {/* Bumps & misc */}
        <div className="bump2" /><div className="bump3" />
        <div className="tune-meter" />
        <div
          className="tune-wheel hardware-control"
          role="button"
          tabIndex={0}
          title="Tune wheel: next track"
          onClick={handleTuneWheel}
          onKeyDown={(e) => onHardwareActivate(e, handleTuneWheel)}
        />
        <div className="bottom">
          <div className="bottom-clips">
            {[0, 1, 2, 3].map(i => <div key={i} className="bottom-clip"><span /></div>)}
          </div>
          <div className="bottom-switch" />
          <div className="bump4" /><div className="bump5" />
        </div>
        <div className="roulette" />
        <div className="top-right" />
        <div className="spike-wheel" />
        {photoShellMode && (
          <>
            <Image
              className="photo-shell-frame"
              src="/image-shell-nostand-proto-hollow-defringed.png"
              alt=""
              width={902}
              height={803}
              aria-hidden="true"
            />
            <div className="photo-shell-hotspots">
              <div
                className="photo-hotspot photo-hotspot-left-knob hardware-control"
                role="button"
                tabIndex={0}
                title="Left knob: previous tab/target/station"
                onClick={handleLeftWheel}
                onKeyDown={(e) => onHardwareActivate(e, handleLeftWheel)}
              />
              <div
                className="photo-hotspot photo-hotspot-right-wheel hardware-control"
                role="button"
                tabIndex={0}
                title="Right wheel: next tab/target/station"
                onClick={handleRightWheel}
                onKeyDown={(e) => onHardwareActivate(e, handleRightWheel)}
              />
              <div
                className="photo-hotspot photo-hotspot-tune hardware-control"
                role="button"
                tabIndex={0}
                title="Tune wheel: next track / open radio"
                onClick={handleTuneWheel}
                onKeyDown={(e) => onHardwareActivate(e, handleTuneWheel)}
              />
              <div
                className={`photo-hotspot photo-hotspot-btn photo-hotspot-btn-stat hardware-control ${activePhotoButton === 'stat' ? 'is-active' : 'is-inactive'}`}
                role="button"
                tabIndex={0}
                title="STAT"
                onClick={() => switchTab('stat')}
                onKeyDown={(e) => onHardwareActivate(e, () => switchTab('stat'))}
              />
              <div
                className={`photo-hotspot photo-hotspot-btn photo-hotspot-btn-inv hardware-control ${activePhotoButton === 'inv' ? 'is-active' : 'is-inactive'}`}
                role="button"
                tabIndex={0}
                title="INV"
                onClick={() => switchTab('inv')}
                onKeyDown={(e) => onHardwareActivate(e, () => switchTab('inv'))}
              />
              <div
                className={`photo-hotspot photo-hotspot-btn photo-hotspot-btn-data hardware-control ${activePhotoButton === 'data' ? 'is-active' : 'is-inactive'}`}
                role="button"
                tabIndex={0}
                title="DATA"
                onClick={() => switchTab('data')}
                onKeyDown={(e) => onHardwareActivate(e, () => switchTab('data'))}
              />
            </div>
          </>
        )}
      </div>
    </div >
  );
}
