import { HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, string>;
}

export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: Record<string, string>) {
    const body: ApiErrorBody = details ? { code, message, details } : { code, message };
    super(body, status);
  }

  static badRequest(code: string, message: string, details?: Record<string, string>): ApiError {
    return new ApiError(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static unauthorized(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, code, message);
  }

  static forbidden(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, code, message);
  }

  static notFound(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, code, message);
  }

  static conflict(code: string, message: string, details?: Record<string, string>): ApiError {
    return new ApiError(HttpStatus.CONFLICT, code, message, details);
  }

  static gone(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.GONE, code, message);
  }

  static unavailable(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.SERVICE_UNAVAILABLE, code, message);
  }
}
