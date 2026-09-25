import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorBody } from './api-error';
import { ContextAccessError, ParticipantBusyError } from './domain-error';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const body = toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.message : 'Unhandled error');
    }
    response.status(body.statusCode).json(body.payload);
  }
}

export function toErrorBody(exception: unknown): { statusCode: number; payload: ApiErrorBody & { statusCode: number } } {
  if (exception instanceof ContextAccessError) {
    return payload(contextStatus(exception.code), exception.code, exception.message);
  }
  if (exception instanceof ParticipantBusyError) {
    return payload(HttpStatus.CONFLICT, exception.code, exception.message);
  }
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    if (isApiErrorBody(response)) {
      return {
        statusCode,
        payload: {
          statusCode,
          code: response.code,
          message: response.message,
          ...(response.details ? { details: response.details } : {}),
        },
      };
    }
    return payload(statusCode, codeForStatus(statusCode), messageFrom(response));
  }
  return payload(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', 'Something went wrong. Try again.');
}

function payload(statusCode: number, code: string, message: string) {
  return { statusCode, payload: { statusCode, code, message } };
}

function contextStatus(code: ContextAccessError['code']): number {
  return code === 'CONTEXT_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value
    && typeof (value as ApiErrorBody).code === 'string'
    && typeof (value as ApiErrorBody).message === 'string';
}

function messageFrom(body: string | object): string {
  if (typeof body === 'string' && body.trim()) return body;
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && message.length) return message.map(String).join(' ');
  }
  return 'The request could not be completed.';
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'INVALID_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.GONE:
      return 'GONE';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL' : 'REQUEST_FAILED';
  }
}
