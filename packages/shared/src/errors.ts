/** Application error with a stable, user-safe message. Internal detail never reaches the client. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly userMessage?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
  toBody() {
    return {
      error: {
        code: this.code,
        // Financial errors must be explicit and actionable, never a bare 500.
        message: this.userMessage ?? this.message,
        ...(this.details ?? {}),
      },
    };
  }
}

export const Errors = {
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Missing or invalid credentials', 'Please sign in again.'),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials', 'Your details are not correct. Please try again.'),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'Not allowed', 'You do not have access to this.'),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`, `${what} not found.`),
  validation: (details?: Record<string, unknown>, message = 'Invalid request') =>
    new AppError(400, 'VALIDATION_ERROR', message, 'Some details look incorrect. Please check and try again.', details),
  conflict: (message: string, userMessage?: string) => new AppError(409, 'CONFLICT', message, userMessage ?? message),
  rateLimited: () => new AppError(429, 'RATE_LIMITED', 'Too many attempts', 'Too many attempts. Please wait and try again.'),
  stepUpRequired: (reason: string, userMessage: string) =>
    new AppError(403, 'STEP_UP_REQUIRED', reason, userMessage, { requiresStepUp: true }),
  providerUnavailable: () =>
    new AppError(503, 'PROVIDER_UNAVAILABLE', 'Payment provider unavailable',
      'We could not reach your payment provider. Your money has not been sent. Please try again shortly.'),
  paymentFailed: (userMessage: string) => new AppError(402, 'PAYMENT_FAILED', 'Payment failed', userMessage),
  internal: () => new AppError(500, 'INTERNAL_ERROR', 'Internal error', 'Something went wrong on our side. Please try again.'),
};
