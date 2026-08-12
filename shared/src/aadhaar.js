// Verhoeff checksum — the algorithm UIDAI uses for the 12th digit of an Aadhaar.
// D is the Dihedral group D5 multiplication table, P the permutation table,
// INV the multiplicative inverse table. These are fixed constants of the algorithm.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Check digit for a digit string that does NOT yet include one. */
export function verhoeffCheckDigit(digits) {
  let c = 0;
  const reversed = String(digits).split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[(i + 1) % 8][Number(reversed[i])]];
  }
  return INV[c];
}

/** True when a full digit string (check digit included) has a valid checksum. */
export function verhoeffValidate(numStr) {
  let c = 0;
  const reversed = String(numStr).split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

/** Strip the formatting users naturally type. */
export function normalizeAadhaar(value) {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
}

/** Full Aadhaar validation: 12 digits, never starting 0 or 1, valid Verhoeff checksum. */
export function isValidAadhaar(value) {
  const s = normalizeAadhaar(value);
  if (!/^[2-9]\d{11}$/.test(s)) return false;
  return verhoeffValidate(s);
}

/** Display form. Only the last four digits may ever be shown. */
export function maskAadhaar(value) {
  const s = normalizeAadhaar(value);
  return `XXXX XXXX ${s.slice(-4)}`;
}
