import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { colors } from '../theme';

const paths = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z',
  rooms: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm4 3h8M8 12h8M8 16h5',
  nearby: 'M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0v9m-4-4 4 4 4-4',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm8.1-2.1.1-1.1-.1-1.1 2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.9-1.1L15.4 3h-4l-.4 2.8a8 8 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.6-.1 1.1.1 1.1-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.9 1.1l.4 2.8h4l.4-2.8a8 8 0 0 0 1.9-1.1l2.4 1 2-3.4-2-1.6Z',
  plus: 'M12 5v14M5 12h14',
  arrowLeft: 'M19 12H5m7-7-7 7 7 7',
  arrowRight: 'M5 12h14m-7-7 7 7-7 7',
  chevronRight: 'm9 6 6 6-6 6',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  skipBack: 'M18 6v12L8 12l10-6ZM6 5v14',
  skipForward: 'M6 6v12l10-6L6 6Zm12-1v14',
  send: 'm3 3 18 9-18 9 4-9-4-9Zm4 9h14',
  users: 'M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-4A4.5 4.5 0 0 0 3 18.5V20m5.5-8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4.5 4.5 0 0 0-3-4.2M15.5 5.1a3.5 3.5 0 0 1 0 6.8',
  lock: 'M6 10V8a6 6 0 1 1 12 0v2m-13 0h14v11H5V10Z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0 0c3-2.7 4.5-6 4.5-10S15 4.7 12 2M12 22c-3-2.7-4.5-6-4.5-10S9 4.7 12 2M2.5 12h19',
  qr: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 3h3v3h-3v-3Zm3-3h3v3h-3v-3Z',
  link: 'M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2',
  share: 'M12 16V3m0 0L7 8m5-5 5 5M5 14v6h14v-6',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm-7-3a7 7 0 0 0 14 0M12 19v3m-4 0h8',
  micOff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.9-.7M5 12a7 7 0 0 0 10.6 6.1M19 12a7 7 0 0 1-.4 2.4M12 19v3m-4 0h8',
  chat: 'M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 9a8 8 0 0 0-16 0',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  volume: 'M11 5 6 9H2v6h4l5 4V5Zm4 3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14',
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  bluetooth: 'm7 7 10 10-5 5V2l5 5L7 17',
  check: 'm4 12 5 5L20 6',
  close: 'M6 6l12 12M18 6 6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V3h6v4',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  video: 'M3 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm13 5 5-3v8l-5-3v-2Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v4l3 2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z',
  spark: 'm12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 10 .9 2.1L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.9L19 13Z',
  copy: 'M8 8h12v12H8V8ZM4 16V4h12',
  wifiOff: 'M2 2l20 20M8.5 15.5a5 5 0 0 1 7 0M5 12a10 10 0 0 1 4-2.4M2 8.5A15 15 0 0 1 8.2 5M12 19h.01',
  power: 'M12 3v9m5.7-6.7a9 9 0 1 1-11.4 0',
  headphones: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H6a2 2 0 0 1-2-2v-4Zm16 0h-3v6h1a2 2 0 0 0 2-2v-4Z',
  headphonesOff: 'M3 3l18 18M4 14v-2a8 8 0 0 1 12.9-6.2M20 14v2a2 2 0 0 1-.7 1.5M16 20h-2M4 14h3v6H6a2 2 0 0 1-2-2v-4Z',
  maximize: 'M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5',
  minimize: 'M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5',
};

export default function Icon({
  name,
  size = 22,
  color = colors.offWhite,
  strokeWidth = 1.9,
  fill = 'none',
  style,
}) {
  const path = paths[name];
  if (!path) return null;
  const filled = name === 'play' || name === 'pause' || name === 'skipBack' || name === 'skipForward';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path
        d={path}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? color : fill}
      />
    </Svg>
  );
}

export function Dot({ size = 8, color = colors.yellow, style }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 8 8" style={style}>
      <Circle cx="4" cy="4" r="4" fill={color} />
    </Svg>
  );
}

export function Waveform({ width = 120, height = 32, color = colors.orange, bars = 18 }) {
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {Array.from({ length: bars }).map((_, index) => {
        const barHeight = 4 + ((index * 7) % 22);
        return (
          <Rect
            key={index}
            x={index * (width / bars)}
            y={(height - barHeight) / 2}
            width={2.2}
            height={barHeight}
            rx={1.1}
            fill={color}
            opacity={0.55 + (index % 3) * 0.15}
          />
        );
      })}
    </Svg>
  );
}
