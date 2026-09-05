export type AuthMode = 'login' | 'register';
export type AuthField = 'name' | 'email' | 'password';
export type FieldErrors = Partial<Record<AuthField, string>>;

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  name: string;
}

// Matches the Zod email rule used by apps/api/src/auth/auth.schemas.ts.
const emailPattern =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export const fieldGuidance = {
  name: 'Use 2–100 characters for your name.',
  email: 'Enter a valid email address, up to 254 characters.',
  loginPassword: 'Enter your password (up to 128 characters).',
  registerPassword: 'Use 12–128 characters, including a letter (A–Z) and a number.',
};

export function validateAuthInput(mode: AuthMode, input: RegisterInput): FieldErrors {
  const errors: FieldErrors = {};

  if (mode === 'register' && (input.name.trim().length < 2 || input.name.trim().length > 100)) {
    errors.name = fieldGuidance.name;
  }
  if (input.email.length > 254 || !emailPattern.test(input.email)) {
    errors.email = fieldGuidance.email;
  }
  if (mode === 'login') {
    if (!input.password.length || input.password.length > 128) {
      errors.password = fieldGuidance.loginPassword;
    }
  } else if (
    input.password.length < 12 ||
    input.password.length > 128 ||
    !/[A-Za-z]/.test(input.password) ||
    !/[0-9]/.test(input.password)
  ) {
    errors.password = fieldGuidance.registerPassword;
  }

  return errors;
}
