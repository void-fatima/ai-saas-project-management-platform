import { validateAuthInput, type RegisterInput } from './auth-validation';

const valid: RegisterInput = {
  name: 'Taylor',
  email: 'taylor@example.com',
  password: 'good-password-42',
};

describe('Authentication validation contract', () => {
  it.each(['short42', 'onlyletterslongenough', '123456789012', `${'a'.repeat(128)}1`])(
    'rejects registration password %s',
    (password) => {
      expect(validateAuthInput('register', { ...valid, password }).password).toBeDefined();
    },
  );

  it.each(['a', '  ', 'a'.repeat(101)])('rejects an out-of-range name', (name) => {
    expect(validateAuthInput('register', { ...valid, name }).name).toBeDefined();
  });

  it.each([
    'missing-at',
    'a@localhost',
    '.a@example.com',
    'a..b@example.com',
    `${'a'.repeat(243)}@example.com`,
  ])('rejects invalid email %s', (email) => {
    expect(validateAuthInput('login', { ...valid, email }).email).toBeDefined();
  });

  it('accepts backend boundary lengths and preserves the distinct login password rule', () => {
    expect(
      validateAuthInput('register', { ...valid, name: ' Ab ', password: `${'a'.repeat(11)}1` }),
    ).toEqual({});
    expect(
      validateAuthInput('register', {
        name: 'a'.repeat(100),
        email: `${'a'.repeat(242)}@example.com`,
        password: `${'a'.repeat(127)}1`,
      }),
    ).toEqual({});
    expect(validateAuthInput('login', { ...valid, name: '', password: 'x' })).toEqual({});
    expect(
      validateAuthInput('login', { ...valid, password: 'a'.repeat(129) }).password,
    ).toBeDefined();
  });
});
