export class InvalidSessionError extends Error {
  constructor() {
    super('Authentication is required.');
    this.name = 'InvalidSessionError';
  }
}
