import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { EngineInputError } from '@whatif/engine';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource.') => new AppError(403, 'forbidden', message);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);

/** Parses input with a zod schema, turning failures into a 400 with field-level details. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

export function validationError(err: ZodError): AppError {
  const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = fields[0];
  return new AppError(400, 'validation_error', first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid input.', { fields });
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    if (error.status >= 500) request.log.error({ err: error }, error.message);
    void reply.status(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    return;
  }
  if (error instanceof ZodError) {
    const e = validationError(error);
    void reply.status(400).send({ error: { code: e.code, message: e.message, details: e.details } });
    return;
  }
  if (error instanceof EngineInputError) {
    void reply.status(400).send({ error: { code: 'invalid_model', message: error.message, details: error.issues } });
    return;
  }
  const fe = error as FastifyError;
  if (fe.statusCode === 429) {
    void reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } });
    return;
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    void reply.status(fe.statusCode).send({ error: { code: fe.code ?? 'bad_request', message: fe.message } });
    return;
  }
  request.log.error({ err: error }, 'Unhandled error');
  void reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong on our side. The error has been logged.' } });
}
