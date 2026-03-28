import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(passord: string): Promise<string> {
  return bcrypt.hash(passord, SALT_ROUNDS);
}

export async function verifyPassword(passord: string, hash: string): Promise<boolean> {
  return bcrypt.compare(passord, hash);
}

export function validatePasswordStrength(passord: string): { valid: boolean; message?: string } {
  if (passord.length < 8)
    return { valid: false, message: 'Passordet må være minst 8 tegn.' };
  if (!/[A-Z]/.test(passord))
    return { valid: false, message: 'Passordet må inneholde minst én stor bokstav.' };
  if (!/[0-9]/.test(passord))
    return { valid: false, message: 'Passordet må inneholde minst ett tall.' };
  return { valid: true };
}
