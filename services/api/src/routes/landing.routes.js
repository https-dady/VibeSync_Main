'use strict';

const express = require('express');
const Room = require('../models/Room');

const router = express.Router();

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

router.get('/:roomId', async (req, res) => {
  const roomId = String(req.params.roomId || '').toUpperCase();
  const room = await Room.findOne({ roomId, status: 'active' }).populate('host', 'name');
  const deepLink = `vibesync://room/${encodeURIComponent(roomId)}`;
  const name = room ? escapeHtml(room.name) : 'Room unavailable';
  const host = room?.host?.name ? escapeHtml(room.host.name) : 'a VibeSync host';
  const description = room ? escapeHtml(room.description || 'Join the synchronized listening room.') : 'This room has ended or does not exist.';
  res
    .status(room ? 200 : 404)
    .type('html')
    .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta property="og:title" content="${name} · VibeSync" />
  <meta property="og:description" content="${description}" />
  <title>${name} · VibeSync</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #000; color: #F1F3F5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
    main { width: min(440px, 100%); background: #0c0c0c; border: 1px solid rgba(241,243,245,.12);
      border-radius: 28px; padding: 32px; box-shadow: 0 24px 80px rgba(0,0,0,.7); }
    .mark { width: 56px; height: 56px; border-radius: 18px; display: grid; place-items: center;
      background: linear-gradient(135deg, #FD8549, #FFC123); color: #000; font-weight: 800; font-size: 22px; }
    .code { display: inline-block; margin: 14px 0; padding: 8px 14px; border-radius: 999px;
      background: rgba(255,193,35,.12); color: #FFC123; font-weight: 700; letter-spacing: .18em; }
    h1 { font-size: 30px; line-height: 1.1; margin: 22px 0 10px; letter-spacing: -0.03em; }
    p { color: rgba(241,243,245,.65); line-height: 1.6; }
    a { display: flex; justify-content: center; gap: 8px; margin-top: 26px; padding: 16px 20px;
      border-radius: 16px; background: #FD8549; color: #000; font-weight: 800; text-decoration: none; }
    .note { font-size: 13px; margin-top: 18px; }
    .state { display: flex; align-items: center; gap: 8px; color: ${room ? '#FFC123' : '#FD8549'};
      font-size: 14px; font-weight: 600; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .host { margin-top: 8px; font-size: 14px; color: rgba(241,243,245,.55); }
  </style>
</head>
<body>
  <main>
    <div class="mark">VS</div>
    <div class="code">${escapeHtml(roomId)}</div>
    <h1>${name}</h1>
    <p>${description}</p>
    <div class="state"><span class="dot"></span>${room ? 'Room is live' : 'Room closed'}</div>
    <div class="host">Hosted by ${host}</div>
    <a href="${deepLink}">Open in VibeSync</a>
    <p class="note">The VibeSync app is required. If the button does not open the app, enter code ${escapeHtml(roomId)} in Join Room.</p>
  </main>
</body>
</html>`);
});

module.exports = router;
